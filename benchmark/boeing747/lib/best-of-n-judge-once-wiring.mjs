// LIVE wiring for the BRU-3 BEST-OF-N JUDGE-ONCE actor step (frozen-gemma
// track, DEFAULT DISABLED via loadBestOfNJudgeOnceConfig). This module owns
// the side-effecting seams — copy candidate files, run the retry-wrapped
// actor, maintain the elites archive, promote the winner — and hands every
// decision to the PURE lib/best-of-n-judge-once.mjs + lib/elites.mjs
// functions. Kept OUT of loop-runner-terransoul.mjs so the pure decisions
// stay unit-testable with mocks and the loop file stays lean (same precedent
// as lib/best-of-n-wiring.mjs for the pairwise track).
//
// JUDGE-CALL INVARIANT: this module NEVER calls a judge. The promoted
// survivor is judged EXACTLY ONCE by the normal panel at the next
// iteration's judge step — enabling best-of-N changes actor-call counts
// only, never judge-call counts. Disabled => maybeRunBestOfNJudgeOnce
// returns null before touching anything, so a bare run is byte-identical.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../rig/render-rig.mjs';
// FROZEN contract validator — called, never modified (BRU-3 requirement).
import { validatePlaneSource } from './contract.mjs';
import { smokeCheckPlaneSource } from './candidate-smoke.mjs';
import { loadRejectedEdits } from './edit-gate.mjs';
import { appendElite, loadElites, pickSamplingBase, saveElites } from './elites.mjs';
import { evaluateCandidateEdit, recentRejectedShas, selectSurvivor } from './best-of-n-judge-once.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DEFAULT_FS = { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync };

/**
 * ELITES MAINTENANCE (BRU-4's deferred half, append-on-accept): when the
 * edit-gate ACCEPTED the previous edit this iteration, snapshot the accepted
 * geometry into results/<actor>/elites/ and append {sha, total, iter, path}
 * to the capped elites.json archive. Fail-open throughout — an archive miss
 * never breaks the loop. Returns the (possibly updated) archive.
 */
export function maintainElitesOnAccept({
  lastGateDecision,
  planePath,
  acceptedTotal,
  iterNum,
  elitesPath,
  elitesDir,
  cap,
  fsImpl = DEFAULT_FS,
  sha256Fn = sha256,
  logger = () => {},
}) {
  const elites = loadElites({ elitesPath, fsImpl });
  if (lastGateDecision !== 'accept' || !isNum(acceptedTotal)) return elites;
  try {
    const source = fsImpl.readFileSync(path.resolve(planePath), 'utf8');
    const sha = sha256Fn(source);
    const snapshotPath = path.join(elitesDir, `elite-${sha.slice(0, 12)}.js`);
    if (!fsImpl.existsSync(elitesDir)) fsImpl.mkdirSync(elitesDir, { recursive: true });
    if (!fsImpl.existsSync(snapshotPath)) fsImpl.copyFileSync(path.resolve(planePath), snapshotPath);
    const next = appendElite({ elites, entry: { sha, total: acceptedTotal, iter: iterNum, path: snapshotPath }, cap });
    saveElites({ elitesPath, elites: next, fsImpl });
    logger(`  ELITES: banked accepted candidate ${sha.slice(0, 8)} @ ${acceptedTotal}/100 (archive ${next.length}${cap ? `/${cap}` : ''})`);
    return next;
  } catch (err) {
    logger(`  ELITES: archive update skipped (fail-open): ${String(err?.message || err)}`);
    return elites;
  }
}

/**
 * The BEST-OF-N JUDGE-ONCE actor step. Returns `{actorResult, info}` when it
 * ran (config enabled), or null (config absent/disabled) — in which case the
 * caller runs its normal single-edit path BYTE-IDENTICALLY.
 *
 * Flow (per sampling round k = 1..n):
 *   base   — round 1 edits from the incumbent; round k>1 may edit from a
 *            uniformly picked elite (config use_elites; pickSamplingBase).
 *   copy   — the base is copied to a throwaway file; the REAL candidate is
 *            only ever written by the final promotion, so a fully-filtered
 *            round leaves it untouched (no restore needed).
 *   actor  — ONE retry-wrapped actor edit on the copy (the injected
 *            runActorWithRetries — the loop's own wrapper, same prompt
 *            sections as the direct path).
 *   filter — the FREE cascade (status/contract/runtime/novelty) via the
 *            frozen validatePlaneSource + the shared smoke check; novelty
 *            compares against the incumbent sha and the rejected-edits
 *            ledger's recent shas.
 * Then ONE survivor (prefer novel > first) is promoted onto the real
 * candidate. NO judge call happens here — see the module header.
 *
 * @param {Object} ctx
 * @param {{enabled:boolean, n:number, useElites:boolean, elitesCap:number, source:string}} ctx.config
 * @param {string} ctx.planePath @param {number} ctx.iterNum @param {string} ctx.gemmaDir
 * @param {string|null} ctx.lastGateDecision  this iteration's gate decision ('accept'|'reject'|'within_noise'|null).
 * @param {number|null} ctx.acceptedTotal     this iteration's judged gating total.
 * @param {Object} ctx.retryCfg @param {Object} ctx.actorBase
 * @param {Function} ctx.runActorWithRetries
 * @param {Function} [ctx.logger]
 * @param {Object} [ctx.fsImpl] @param {Function} [ctx.sha256Fn] injectable seams (tests)
 * @param {Function} [ctx.validateFn] @param {Function} [ctx.smokeFn] @param {Function} [ctx.rng]
 * @param {Function} [ctx.tempPathFor]
 * @returns {Promise<{actorResult:Object, info:Object}|null>}
 */
export async function maybeRunBestOfNJudgeOnce(ctx) {
  const {
    config,
    planePath,
    iterNum,
    gemmaDir,
    lastGateDecision = null,
    acceptedTotal = null,
    retryCfg,
    actorBase,
    runActorWithRetries,
    logger = () => {},
    fsImpl = DEFAULT_FS,
    sha256Fn = sha256,
    validateFn = validatePlaneSource,
    smokeFn = smokeCheckPlaneSource,
    rng = Math.random,
    tempPathFor,
    loadLedgerFn = (ledgerPath) => loadRejectedEdits({ ledgerPath }),
  } = ctx || {};

  if (!config || config.enabled !== true) return null;

  const elitesPath = path.join(gemmaDir, 'elites.json');
  const elitesDir = path.join(gemmaDir, 'elites');
  const elites = maintainElitesOnAccept({
    lastGateDecision,
    planePath,
    acceptedTotal,
    iterNum,
    elitesPath,
    elitesDir,
    cap: config.elitesCap,
    fsImpl,
    sha256Fn,
    logger,
  });

  const incumbentAbs = path.resolve(planePath);
  const incumbentSha = sha256Fn(fsImpl.readFileSync(incumbentAbs, 'utf8'));
  const rejectedShas = recentRejectedShas(loadLedgerFn(path.join(gemmaDir, 'rejected-edits.json')));
  const destFor =
    tempPathFor ||
    ((round) => path.join(gemmaDir, 'bon-samples', `iter-${iterNum}`, `round-${round}`, path.basename(planePath)));

  logger(
    `actor: BEST-OF-N JUDGE-ONCE — sampling ${config.n} candidate edit(s) through the free ` +
      `contract/runtime/novelty filters (elites: ${config.useElites ? `on, ${elites.length} banked` : 'off'}; ` +
      `judge panel still runs EXACTLY once, on the promoted survivor; config source=${config.source})`,
  );

  const started = Date.now();
  const rounds = [];
  for (let k = 1; k <= config.n; k++) {
    const base = pickSamplingBase({
      round: k,
      incumbentPath: incumbentAbs,
      elites,
      useElites: config.useElites,
      rng,
      existsFn: fsImpl.existsSync,
    });
    const dest = destFor(k);
    fsImpl.mkdirSync(path.dirname(dest), { recursive: true });
    fsImpl.copyFileSync(path.resolve(base.path), dest);
    logger(`  round ${k}/${config.n}: actor edit on a fresh copy (base=${base.kind}${base.elite ? ` ${String(base.elite.sha).slice(0, 8)} @ ${base.elite.total}/100` : ''})`);
    const actorResult = await runActorWithRetries({ retryCfg, ...actorBase, candidatePath: dest });
    let source;
    try {
      source = fsImpl.readFileSync(dest, 'utf8');
    } catch {
      source = null;
    }
    const candidateSha = source ? sha256Fn(source) : null;
    const evaluation = evaluateCandidateEdit({
      source,
      sha: candidateSha,
      status: actorResult.status,
      incumbentSha,
      rejectedShas,
      validateFn,
      smokeFn,
    });
    rounds.push({ round: k, base: base.kind, dest, actorResult, sha: candidateSha, evaluation });
    logger(
      `  round ${k}/${config.n}: ${evaluation.pass ? `SURVIVOR${evaluation.novel ? ' (novel)' : ' (not novel)'}` : 'filtered'}` +
        `${evaluation.reasons.length ? ` — ${evaluation.reasons.join('; ')}` : ''}`,
    );
  }

  const selection = selectSurvivor(rounds.map((r) => r.evaluation));
  const winner = selection.index >= 0 ? rounds[selection.index] : null;
  if (winner) {
    fsImpl.copyFileSync(winner.dest, incumbentAbs);
    logger(`  BEST-OF-N JUDGE-ONCE: PROMOTED round ${winner.round}'s edit (${selection.novel ? 'novel' : 'first'} survivor ${String(winner.sha).slice(0, 8)}) — the panel judges it once next iteration`);
  } else {
    logger('  BEST-OF-N JUDGE-ONCE: no survivor cleared the free filters — candidate unchanged (kept incumbent)');
  }

  const allExhausted =
    rounds.length > 0 && rounds.every((r) => r.actorResult.status === 'actor_exhausted_retries');
  const attempts = rounds.flatMap((r) =>
    (Array.isArray(r.actorResult.attempts) ? r.actorResult.attempts : []).map((a) => ({ ...a, round: r.round })),
  );
  const totalCost = rounds.reduce((c, r) => c + (isNum(r.actorResult.cost_usd) ? r.actorResult.cost_usd : 0), 0);
  const info = {
    enabled: true,
    n: config.n,
    use_elites: config.useElites,
    config_source: config.source,
    incumbent_sha256: incumbentSha,
    promoted: Boolean(winner),
    selected_round: winner ? winner.round : null,
    selected_novel: winner ? selection.novel : null,
    rounds: rounds.map((r) => ({
      round: r.round,
      base: r.base,
      status: r.actorResult.status,
      sha256: r.sha,
      pass: r.evaluation.pass,
      novel: r.evaluation.novel,
      reasons: r.evaluation.reasons,
    })),
  };
  return {
    actorResult: {
      // Non-promotion mirrors the pairwise best-of-N convention ('no_change':
      // the REAL candidate was never touched) EXCEPT when every round was a
      // pure infra failure — then the honest terminal status is preserved so
      // the stop-condition exclusion mechanism (lib/actor-retry.mjs) still
      // keeps these iterations out of the stall/patience counters.
      status: winner ? 'edited' : allExhausted ? 'actor_exhausted_retries' : 'no_change',
      changed: Boolean(winner),
      cost_usd: Math.round(totalCost * 1e6) / 1e6,
      ms: Date.now() - started,
      attempts,
      retry_config: retryCfg,
      plane_sha256_before: incumbentSha,
      plane_sha256_after: winner ? winner.sha : incumbentSha,
      claude_result_text: winner ? (winner.actorResult.claude_result_text ?? null) : null,
      observability: winner ? (winner.actorResult.observability ?? null) : null,
      ...(allExhausted && !winner ? { actor_error: rounds[rounds.length - 1].actorResult.actor_error ?? null } : {}),
      best_of_n_judge_once: info,
    },
    info,
  };
}
