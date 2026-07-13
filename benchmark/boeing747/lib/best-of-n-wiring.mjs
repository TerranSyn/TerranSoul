// LIVE wiring for the opus-pairwise BEST-OF-N plateau break (pairwise-only, gated
// behind --best-of-n N). This module owns the REAL side-effecting seams — copy a
// candidate file, render (runRig) + judge (judgeShotsPairwise) each copy, promote
// the winner — and hands them to the PURE lib/best-of-n-orchestrate.mjs decision.
// It is kept OUT of loop-runner-terransoul.mjs on purpose so the pure decision
// stays unit-testable with mocks (loop-runner-bestofn.test.mjs) while the loop file
// stays under its size budget. The real candidate file is only ever written by the
// injected promoteFn, so a non-promotion leaves it untouched (keep-best/backtrack).
//
// Reached ONLY on the opus-pairwise path AND only when --best-of-n > 0; every other
// track never imports a behavior from here, so they stay byte-identical.

import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { judgeShotsPairwise } from '../judge/judge-pairwise.mjs';
import { runRig } from '../rig/render-rig.mjs';
import { filterGenuineIterationsForStopConditions } from './actor-retry.mjs';
import { DEFAULT_ALPHA, DEFAULT_P_FLOOR } from './certification-stats.mjs';
import { planBestOfNBudget, runBestOfNActorStep, worstViewScore } from './best-of-n-orchestrate.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Decide + (if a worst view has plateaued) RUN the best-of-N actor step with live
 * rig/judge/actor seams. Returns the step's `{actorResult, info}` when best-of-N
 * fired, or `null` when it did not — in which case the caller runs its normal
 * single-edit path BYTE-IDENTICALLY.
 *
 * @param {Object} ctx  the loop iteration context (see loop-runner-terransoul.mjs).
 * @param {number} ctx.bestOfN            the --best-of-n budget (> 0 to arm).
 * @param {number} ctx.effPatience        plateau patience.
 * @param {string} ctx.planePath          the real candidate file.
 * @param {string} ctx.runId @param {number} ctx.iterNum @param {string} ctx.claudeDir
 * @param {number|number[]} ctx.calibratedBar
 * @param {Array} ctx.primaryHistory @param {Object} ctx.primaryRecord @param {Object} ctx.primaryJudged
 * @param {string} ctx.weakestId
 * @param {Object} ctx.pairwiseCfg @param {Object} ctx.gateState
 * @param {number} ctx.opusSamples @param {string} ctx.opusJudgeModel
 * @param {string} [ctx.contractModulePath] @param {Object} ctx.retryCfg
 * @param {string} ctx.repoRoot
 * @param {Object} ctx.actorBase          base args merged into every actor call.
 * @param {function} ctx.runActorWithRetries  the loop's retry-wrapped actor runner.
 * @param {function} [ctx.logger]
 * @returns {Promise<{actorResult:Object, info:Object}|null>}
 */
export async function maybeRunBestOfN(ctx) {
  const {
    bestOfN,
    effPatience,
    planePath,
    runId,
    iterNum,
    claudeDir,
    calibratedBar,
    primaryHistory,
    primaryRecord,
    primaryJudged,
    weakestId,
    pairwiseCfg,
    gateState,
    opusSamples,
    opusJudgeModel,
    contractModulePath,
    retryCfg,
    repoRoot,
    actorBase,
    runActorWithRetries,
    logger = () => {},
  } = ctx;

  if (!isNum(bestOfN) || bestOfN <= 0) return null;

  const genuinePrimary = filterGenuineIterationsForStopConditions([...primaryHistory, primaryRecord]);
  const perViewHistory = genuinePrimary.map((r) =>
    Array.isArray(r.per_view) ? r.per_view.map((v) => ({ view: v.view, score: v.score })) : [],
  );
  const plan = planBestOfNBudget({
    perViewHistory,
    bars: calibratedBar,
    latestPerView: primaryJudged.per_view.map((v) => ({ view: v.view, score: v.score })),
    totalN: bestOfN,
    patience: effPatience,
  });
  if (!plan.triggered) return null;

  const refShotsDir = path.resolve(repoRoot, pairwiseCfg.ref_shots_dir);
  const certCfg = pairwiseCfg.certification || {};
  logger(
    `actor: BEST-OF-N plateau break — sampling ${plan.perView.reduce((s, a) => s + a.n, 0)} diverse ` +
      `candidate(s) for view(s) [${plan.plateauViews.join(', ')}] (worst view ${plan.worstView})`,
  );

  const runActorFn = (args) => runActorWithRetries({ retryCfg, ...actorBase, ...args });
  const renderJudgeFn = async ({ candidatePath, slot }) => {
    const r = await runRig({ planePath: candidatePath, runId: `${runId}-bon-${slot}`, contractModulePath });
    const j = await judgeShotsPairwise({
      shotsDir: r.outDir,
      referenceShotsDir: refShotsDir,
      samples: opusSamples,
      model: opusJudgeModel,
    });
    return { per_view: j ? j.per_view : [], total_0_100: j ? j.total_0_100 : null, shotsDir: r.outDir };
  };
  const heldOutJudgeFn = async ({ winner }) => {
    const shotsDir = winner.judged && winner.judged.shotsDir;
    if (!shotsDir) return worstViewScore(winner.perView);
    const j = await judgeShotsPairwise({
      shotsDir,
      referenceShotsDir: refShotsDir,
      samples: opusSamples,
      model: opusJudgeModel,
      force: true,
    });
    return j ? worstViewScore(j.per_view) : worstViewScore(winner.perView);
  };

  const step = await runBestOfNActorStep({
    plan,
    candidatePath: planePath,
    bars: calibratedBar,
    worstFeatureId: weakestId,
    cautionWeight: isNum(certCfg.caution_weight) ? certCfg.caution_weight : 0,
    pFloor: isNum(certCfg.p_floor) ? certCfg.p_floor : DEFAULT_P_FLOOR,
    alpha: isNum(certCfg.alpha) ? certCfg.alpha : DEFAULT_ALPHA,
    bestTotal: isNum(gateState?.best_total) ? gateState.best_total : primaryRecord.total_0_100,
    epsilonTotal: isNum(pairwiseCfg.epsilon_total) ? pairwiseCfg.epsilon_total : 0,
    baselineWorstViewScore: worstViewScore(primaryJudged.per_view),
    divergenceThreshold: isNum(certCfg.reward_hack_threshold) ? certCfg.reward_hack_threshold : 0,
    copyCandidate: (src, dest) => {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.resolve(src), dest);
    },
    tempPathFor: (slot) =>
      path.join(claudeDir, 'bestofn', `iter-${iterNum}`, `slot-${slot}`, path.basename(planePath)),
    runActorFn,
    renderJudgeFn,
    heldOutJudgeFn,
    promoteFn: (winnerDest) => copyFileSync(winnerDest, path.resolve(planePath)),
    logger,
  });
  return { ...step, actorResult: { ...step.actorResult, retry_config: retryCfg } };
}
