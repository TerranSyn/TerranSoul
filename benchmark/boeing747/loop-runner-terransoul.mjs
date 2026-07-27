// FULLY AUTONOMOUS "TerranSoul-Agent-driven" orchestrator for the Boeing 747
// primitives vision benchmark.
//
// Unlike loop-runner-claude.mjs / loop-runner.mjs (which the coordinator
// calls ONCE per iteration, after a human/agent hand-edits plane.js between
// calls — see benchmark/BOEING-COMPARISON.md's 2026-07-05 ACTOR-FIDELITY
// CORRECTION note), this script IS the loop end-to-end: it renders, judges on
// BOTH tracks, drives the actor's own edit, gates the edit against the frozen
// contract, and repeats — with no human touching plane.js between iterations.
//
// One iteration:
//   runRig (frozen rig/render-rig.mjs, ONE render, shared by both judges)
//     -> judgeShots (frozen gemma4 judge, judge/judge.mjs)
//     -> judgeShotsClaude({ model: 'claude-fable-5' }) (judge/judge-claude.mjs,
//        honest judge_track label from Task 1's fix)
//     -> runActorWithRetries (retry-with-backoff wrapper around
//        actor/actor-claude.mjs's runActorEdit: TerranSoul's OWN generic
//        agentic-edit CLI capability, `terransoul --agent-task`
//        (WIRE-CLI-PARITY-GAP-3 rewire, 2026-07-10 — replaces the OLD
//        bespoke direct `claude` spawn), its own vision inspection,
//        Read+Edit only, gated end-to-end through the `action_trust`
//        earned-autonomy ledger)
//     -> contract gate (actor-claude.mjs already restores + records on
//        violation; the loop just reads the resulting status)
//     -> evaluateStopConditions (frozen lib/stop-conditions.mjs, EXACTLY the
//        thresholds/patience/budget loop-runner-claude.mjs already uses) —
//        fed ONLY genuine iterations (see LESSON BOEING-747-ACTOR-RETRY-1)
//
// LESSON BOEING-747-ACTOR-RETRY-1 (mcp-data/shared/memory-seed.sql): the
// committed terransoul-fable5 run stalled on 4 straight actor-timeout
// iterations that never produced a genuine attempt, yet were fed into
// evaluateStopConditions as ordinary non-improving scores — a measurement
// artifact, not a demonstrated capability ceiling. This file now: (1)
// retries a timed-out actor call with backoff instead of re-rendering/
// re-judging (lib/actor-retry.mjs), (2) tags every iteration with an
// actor_status and excludes actor_exhausted_retries entries from the arrays
// passed to evaluateStopConditions, firing a SEPARATE, honestly-labeled
// actor_exhausted_retries_cap stop reason instead of corrupting `stall`
// (WIRE-CLI-PARITY-GAP-3 rewire: an `action_trust` DENIAL is a NEW member of
// this same excluded bucket — see `denied` on actorResult/attempts — and
// short-circuits the retry loop immediately, since no timeout can fix a
// ledger decision; lib/actor-retry.mjs's `shouldRetryActor`), (3) gets
// streaming observability on every actor call (lib/actor-stream.mjs, wired
// inside actor-claude.mjs itself; rewritten for the terransoul
// stderr-progress-line format — see that module's header), and (4) surfaces
// prior-attempt context to the actor and records a lesson once an edit's
// effect becomes observable (lib/self-learning.mjs, generic MCP brain
// plumbing) — unchanged by the CLI rewire, still runs alongside it.
//
// Results land under NEW actor-name directories so nothing existing is
// touched: results/<actor>/ (gemma4 track, mirrors terransoul-opus48/'s shape)
// and results/<actor>-claude/ (Fable-5-vision track, mirrors
// terransoul-opus48-claude/'s shape).
//
// Judge calls stay strictly sequential (existing discipline — the GPU/CLI may
// be shared); this script itself is the only thing looping, so there is
// exactly one `terransoul --agent-task` subprocess in flight at any time.
//
// CLI:
//   node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5]
//     [--model claude-fable-5] [--effort max] [--max-iter N] [--max-actor-retries N]
//     [--cli-bin <path>] [--cli-data-dir <dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActorEdit } from './actor/actor-claude.mjs';
import { judgeShotsClaude } from './judge/judge-claude.mjs';
import { judgeShotsPairwise } from './judge/judge-pairwise.mjs';
import { criticPass, judgeShots, loadRubric } from './judge/judge.mjs';
import {
  computeAttemptTimeoutMs,
  computeTrailingExhaustionStreak,
  filterGenuineIterationsForStopConditions,
  loadActorRetryConfig,
  shouldRetryActor,
} from './lib/actor-retry.mjs';
// opus-pairwise-only modules (all gated behind pairwiseMode; the frozen gemma
// default and the opus-panel path never touch them, so their tracks stay
// byte-identical): the SkillOpt EDIT-GATE (accept/reject + backtrack-to-best +
// rejected-edit ledger), the pairwise calibration SIDECAR loader, and the ACE /
// Dynamic-Cheatsheet strategy memory (event fold/rank/format/purity-guard).
import {
  appendRejectedEdit,
  assertGateStateEra,
  decideEditAcceptance,
  formatRejectedEditsSection,
  loadRejectedEdits,
  restoreBest,
  snapshotBest,
} from './lib/edit-gate.mjs';
import { resolvePrevActorAttempt, runFrozenGemmaGate } from './lib/gemma-gate-wiring.mjs';
import { acquireRunLock } from './lib/run-lock.mjs';
import { PARITY_ANCHOR_SCORE, loadPairwiseConfig } from './lib/pairwise-config.mjs';
// PURE statistical-rigor certification primitives (July-2026 findings): the
// worst-view Agresti-Coull LCB / IUT (R1), the sequential betting e-process for
// straddling views (R2), and the paired-test resolution + judge flip-rate noise
// budget (R7). Consumed ONLY on the opus-pairwise CONFIRMATION path below; the
// frozen gemma and opus-panel tracks never reach it, so they stay byte-identical.
import { DEFAULT_ALPHA, DEFAULT_K_CONFIRM, DEFAULT_P_FLOOR } from './lib/certification-stats.mjs';
// PURE plateau-breaking BEST-OF-N orchestration (July-2026 findings; sourced in the
// lib/best-of-n.mjs + lib/best-of-n-orchestrate.mjs headers): the worst-view-LCB
// candidate ranker (#1), the difficulty-aware budget allocator + plateau detector
// (#2), and the reward-hack divergence guard (#8), composed into the plateau-break
// actor step. Consumed ONLY on the opus-pairwise path AND only when the new
// --best-of-n flag is > 0; the frozen gemma default, the opus-panel path, and the
// single-edit opus-pairwise path (flag == 0) never reach any of this, so they stay
// byte-identical. Re-exported so the pure decision stays vitest-covered against this
// module (loop-runner-bestofn.test.mjs) without a live judge/actor.
// R2/R3/R7 confirmation-set certifier — extracted to lib/pairwise-confirm.mjs to keep
// this file within its size budget; imported for the loop's own confirmation path and
// re-exported below so its test import (loop-runner-pairwise.test.mjs) is unchanged.
import { certifyPairwiseConfirmed } from './lib/pairwise-confirm.mjs';
export { certifyPairwiseConfirmed };
// Certification/stop-fold primitives (CONTESTED_PERSIST_THRESHOLD / _isNum /
// certifyPairwiseStop / computePairwiseStop / formatResolution) — extracted
// VERBATIM to lib/pairwise-certify.mjs (max-lines refactor, 2026-07-18) and
// re-exported so loop-runner-pairwise.test.mjs's imports are unchanged.
import { _isNum, certifyPairwiseStop, computePairwiseStop, formatResolution } from './lib/pairwise-certify.mjs';
export { CONTESTED_PERSIST_THRESHOLD, certifyPairwiseStop, computePairwiseStop } from './lib/pairwise-certify.mjs';
// Plateau-escalation directives (open-track mesh + frozen-track recompose) —
// extracted VERBATIM to lib/plateau-escalation.mjs (max-lines refactor,
// 2026-07-18) and re-exported so loop-runner-escalation.test.mjs's imports are
// unchanged.
import { MESH_ESCALATION_GAP, buildFrozenEscalation, buildMeshEscalation, meshEscalationStreak } from './lib/plateau-escalation.mjs';
export { MESH_ESCALATION_GAP, buildFrozenEscalation, buildMeshEscalation, meshEscalationStreak };
// EDIT-GATE state IO + the ungated-iteration resolution rule — extracted
// VERBATIM to lib/gate-state.mjs (max-lines refactor, 2026-07-18);
// resolveUngatedGateState is re-exported so loop-runner-record.test.mjs's
// import is unchanged.
import { loadGateState, reportSnapshot, resolveUngatedGateState, saveGateState } from './lib/gate-state.mjs';
export { resolveUngatedGateState };
// Per-track iteration-record IO (history / iter-N.json / record-plane
// snapshot / actor-status patch) — extracted VERBATIM to lib/track-records.mjs
// (max-lines refactor, 2026-07-18); bookkeepTrack is re-exported so
// loop-runner-record.test.mjs's import is unchanged.
import { bookkeepTrack, loadHistory, patchActorStatus } from './lib/track-records.mjs';
export { bookkeepTrack };
// Fix-4 cross-iteration self-learning seams + the genuine-actor-status set —
// extracted VERBATIM to lib/runner-self-learning.mjs (max-lines refactor,
// 2026-07-18).
import {
  GENUINE_ACTOR_STATUSES,
  buildPriorAttemptsSection,
  maybeIngestPriorIterationLesson,
  topAnchorText,
} from './lib/runner-self-learning.mjs';
// The PURE best-of-N orchestration decision (planBestOfNBudget / runBestOfNCandidates
// / decideBestOfNPromotion / runBestOfNActorStep / buildBestOfNDiversityInstruction /
// BEST_OF_N_CAP) lives in lib/best-of-n-orchestrate.mjs and is unit-tested there
// (loop-runner-bestofn.test.mjs); the LIVE rig/judge/actor/fs wiring is in
// lib/best-of-n-wiring.mjs. This file only invokes the wiring seam.
import { maybeRunBestOfN } from './lib/best-of-n-wiring.mjs';
import {
  classifyOutcome,
  foldStrategyEvents,
  formatBadAttemptsSection,
  formatStrategyCheatsheetSection,
  rankStrategies,
  strategyFingerprint,
} from './lib/strategy-cheatsheet.mjs';
import { fetchStrategyEvents, ingestStrategyEvent } from './lib/self-learning.mjs';
import { buildDesignReferenceSection } from './lib/design-reference.mjs';
import { computeSentinelView, formatLastEditEffectSection, formatSentinelLine } from './lib/actor-feedback.mjs';
import { formatBurstStatusSection, loadRebuildBurstConfig } from './lib/rebuild-burst.mjs';
// BRU-6 flatline health-check (2026-07-17 campaign, lesson 25201): a run of
// consecutive within-noise judge deltas with an UNCHANGED candidate sha is an
// ACTOR-HEALTH failure signature (wedged transport/process — restarts
// re-activated the actor 3x observed, records followed), NOT plateau/patience
// evidence. Detection-only: the loop logs a loud reclassification line and
// NEVER alters a stop/gate decision from this signal.
import { detectFlatline, flatlineItersFromRecords, loadFlatlineHealthConfig } from './lib/flatline-health.mjs';
// BRU-3 best-of-N judge-once (frozen-gemma track; default DISABLED so bare
// runs stay byte-identical): sample N candidate edits through the FREE
// contract/runtime/novelty filters, promote ONE survivor, and let the normal
// panel judge it EXACTLY once (next iteration's judge step — judge-call
// counts never change). Folds in BRU-4's deferred archive-of-elites parent
// selection. Pure decisions in lib/best-of-n-judge-once.mjs + lib/elites.mjs;
// live seams in lib/best-of-n-judge-once-wiring.mjs.
import { loadBestOfNJudgeOnceConfig } from './lib/best-of-n-judge-once.mjs';
import { maybeRunBestOfNJudgeOnce } from './lib/best-of-n-judge-once-wiring.mjs';
// SCORING v3 (measurement fidelity, 2026-07-16): a view whose judge call
// SUCCEEDED but returned all-null is "unassessable geometry" (rubric 0-anchor
// = absent) and counts as 0 in the /100 mean; only a FAILED judge call keeps
// the v2 null-drop + renormalization. Applied to every mean-aggregated judge
// (gemma + claude-vision) — NEVER to the pairwise parity total, which is not a
// view mean. v3 totals are NOT numerically comparable to v2 records (see the
// README's scoring-v3 note); the v3 era runs in its own results track.
import { SCORING_VERSION, applyScoringV3 } from './lib/scoring.mjs';
import { evaluateStopConditions } from './lib/stop-conditions.mjs';
import { runRig, sha256 } from './rig/render-rig.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
// Repo root — the base the opus-pairwise SIDECAR stores its ref_shots_dir
// relative to (calibrate-opus-pairwise.mjs writes a REPO_ROOT-relative path so
// the committed sidecar is portable). Resolve against this, NOT the CWD, or the
// path doubles when the loop runs from benchmark/boeing747.
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');
// Relaxed-contract track (OPEN-VARIANT-DESIGN.md). `--contract open` swaps ONLY
// the candidate contract validator + the actor-prompt contract text passed to
// runActorEdit; every measurement artifact (rig, rubric, cameras, scoring,
// judges, stop conditions) is byte-identical to the frozen track. Default is
// frozen — the frozen path never references this module.
const CONTRACT_OPEN_PATH = path.join(BENCH_DIR, 'lib', 'contract-open.mjs');
const DEFAULT_ACTOR = 'terransoul-fable5';
const DEFAULT_MODEL = 'claude-fable-5';
const DEFAULT_EFFORT = 'max';
const CLAUDE_JUDGE_SAMPLES = 1;

// --- opus-pairwise track constants (pairwise-only; the frozen gemma and
// opus-panel paths never read these). ---------------------------------------
// The calibrated bar / measured noise / gemma reference scores / cached
// reference-shots dir live in this SIDECAR (NOT rubric.json, which stays frozen
// v2 so the gemma track's stamped rubric_sha256 never drifts).
const PAIRWISE_SIDECAR_PATH = path.join(BENCH_DIR, 'calibration', 'opus-pairwise.json');
// Domain-specific ONLY as argument VALUES passed to the GENERIC self-learning /
// strategy-cheatsheet functions (rules/brain-driven-self-improvement.md,
// rules/bench-agi-purity.md) — those modules never hardcode these strings.
const STRATEGY_EVENT_TAG = 'boeing747-strategy-event';
const STRATEGY_ANTI_TAG = 'boeing747-anti';

/**
 * Fix 1 (retry-with-backoff): retry the SAME actor call — same rendered
 * shots + already-computed judge results passed straight through, so NO
 * re-render/re-judge happens per retry — up to `retryCfg.maxRetries` times,
 * with computeAttemptTimeoutMs's backoff schedule. Only once every attempt
 * has come back 'actor_failed' does this resolve to the new terminal
 * 'actor_exhausted_retries' status; any genuine outcome (edited/no_change/
 * contract_failed) short-circuits immediately. Every attempt is recorded in
 * the returned `attempts` array for full audit (including each attempt's
 * streaming observability from actor-claude.mjs).
 */
async function runActorWithRetries({ retryCfg, ...actorArgs }) {
  const attempts = [];
  let attemptIdx = 0;
  let result;
  for (;;) {
    const timeoutMs = computeAttemptTimeoutMs(attemptIdx, retryCfg.baseTimeoutMs, retryCfg.timeoutCapMs);
    // Sequential by design (existing discipline): one `terransoul
    // --agent-task` subprocess in flight at a time.
    result = await runActorEdit({ ...actorArgs, timeoutMs });
    attempts.push({
      attempt: attemptIdx + 1,
      timeout_ms: timeoutMs,
      status: result.status,
      ms: result.ms,
      actor_error: result.actor_error || null,
      timed_out: Boolean(result.timed_out),
      denied: Boolean(result.denied),
      observability: result.observability || null,
    });
    if (result.status !== 'actor_failed') break; // genuine outcome — stop retrying
    // WIRE-CLI-PARITY-GAP-3 rewire: an `action_trust` ledger DENIAL is
    // passed through so shouldRetryActor can short-circuit immediately — a
    // longer per-attempt timeout can never change a trust decision, unlike a
    // genuine subprocess timeout, which a longer budget might legitimately
    // fix.
    if (!shouldRetryActor(attemptIdx, retryCfg.maxRetries, { denied: Boolean(result.denied) })) break;
    console.log(
      `  actor attempt ${attemptIdx + 1}/${retryCfg.maxRetries + 1} failed (${result.actor_error}) — retrying with a longer timeout...`,
    );
    attemptIdx += 1;
  }
  const exhausted = result.status === 'actor_failed';
  return {
    ...result,
    status: exhausted ? 'actor_exhausted_retries' : result.status,
    attempts,
    retry_config: retryCfg,
  };
}

/** ONE full autonomous iteration: render (shared) -> gemma judge -> Fable-5-vision judge -> actor edit. */
export async function runIterationTerransoul({
  planePath,
  iter,
  actor,
  model,
  effort,
  maxActorRetries,
  cliBinary,
  cliDataDir,
  contractModulePath,
  contractLabel,
  patience,
  budget,
  judgeMode,
  judgeSamples,
  bestOfN, secondaryJudge, designReference,
  judgeCache = null,
}) {
  const { rubric, rubricSha256 } = loadRubric();
  const effPatience = patience || rubric.stall_patience;
  const effBudget = budget || rubric.iteration_budget;
  // --secondary-judge none: skip the Claude/Fable-5 vision judge ENTIRELY —
  // zero Anthropic API calls for the whole iteration. Only legal when gemma
  // is already the sole gating judge (default judgeMode); opus-panel and
  // opus-pairwise REQUIRE Claude to gate, so disable is refused there rather
  // than silently gating on nothing.
  const secondaryJudgeDisabled = secondaryJudge === 'none';
  // Opus-4.8 PANEL judge mode (owner decision 2026-07-12): Opus 4.8 vision
  // (reference-anchored, judge/judge-claude.mjs) becomes the GATING judge, run
  // as a median-of-N panel, with a per-view CALIBRATED bar; gemma4:12b stays a
  // reported, non-gating diversity cross-check. Default 'gemma' keeps the frozen
  // track byte-identical.
  const opusPanel = judgeMode === 'opus-panel';
  // --- opus-pairwise GATING track (PAIRWISE_JUDGE_SPEC). Everything below is
  // gated behind pairwiseMode; the frozen gemma default and the opus-panel path
  // stay byte-identical. The SIDECAR (loadPairwiseConfig, NOT rubric.json) holds
  // the per-view CALIBRATED bar, the measured noise epsilons, the gemma
  // reference scores + veto band, K, and the cached reference-shots dir; it
  // throws a clear, actionable error when the track was never calibrated (we
  // REFUSE to gate uncalibrated rather than silently fall back to a uniform bar).
  const pairwiseMode = judgeMode === 'opus-pairwise';
  const pairwiseCfg = pairwiseMode ? loadPairwiseConfig(PAIRWISE_SIDECAR_PATH) : null;
  // Both Opus tracks (panel + pairwise) make Claude Opus 4.8 the GATING judge;
  // gemma4 stays a reported diversity cross-check (pairwise adds the persistence-
  // gated CONTESTED veto on top). Default 'gemma' keeps the frozen track intact.
  const claudeGates = opusPanel || pairwiseMode;
  if (secondaryJudgeDisabled && claudeGates) {
    throw new Error(
      `--secondary-judge none is incompatible with --judge ${judgeMode} — Claude is the GATING judge in that mode, not a skippable secondary`,
    );
  }
  const opusSamples =
    Number.isInteger(judgeSamples) && judgeSamples > 0
      ? judgeSamples
      : pairwiseMode
        ? pairwiseCfg.K
        : opusPanel
          ? 3
          : CLAUDE_JUDGE_SAMPLES;
  const opusJudgeModel = claudeGates ? 'claude-opus-4-8' : model || DEFAULT_MODEL;
  const calibratedBar = pairwiseMode
    ? pairwiseCfg.view_threshold_calibrated_pairwise
    : opusPanel && Array.isArray(rubric.view_threshold_calibrated)
      ? rubric.view_threshold_calibrated
      : rubric.view_threshold;
  const actorName = actor || DEFAULT_ACTOR;
  const gemmaDir = path.join(BENCH_DIR, 'results', actorName);
  const claudeDir = path.join(BENCH_DIR, 'results', `${actorName}-claude`);
  mkdirSync(gemmaDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  const gemmaHistory = loadHistory(gemmaDir);
  const claudeHistory = loadHistory(claudeDir);
  const iterNum = iter ?? (gemmaHistory.length > 0 ? gemmaHistory[gemmaHistory.length - 1].iter + 1 : 1);
  if (gemmaHistory.some((h) => h.iter === iterNum) || claudeHistory.some((h) => h.iter === iterNum)) {
    throw new Error(`iteration ${iterNum} already recorded for actor ${actorName}`);
  }

  const runId = `${actorName}-iter-${iterNum}-${Date.now().toString(36)}`;
  console.log(`\n=== ITER ${iterNum} (${actorName}) ===`);
  console.log(`rig: rendering ${planePath} as ${runId}`);
  const rig = await runRig({ planePath, runId, contractModulePath });

  // JUDGE CACHE (v4, 2026-07-17): re-judging IDENTICAL geometry is the same
  // measurement — the panel is deterministic within one model-load geometry
  // (proven live: |delta| 0.03-0.07 across identical shas) — so a no_change
  // iteration was burning ~45 panel calls (~5 min) to reproduce a known
  // number. `judgeCache` is an in-process, single-entry cache owned by
  // runLoopTerransoul (lost on relaunch by design: one fresh judgment per
  // process anchors the regime). Keyed by plane sha + rubric sha.
  const rigMeta = JSON.parse(readFileSync(path.join(rig.outDir, 'meta.json'), 'utf8'));
  const cacheHit = Boolean(
    judgeCache && judgeCache.judged && judgeCache.sha === rigMeta.planeSha256 && judgeCache.rubricSha === rubricSha256,
  );
  let gemmaJudged;
  if (cacheHit) {
    gemmaJudged = structuredClone(judgeCache.judged);
    console.log(
      `judge (gemma4): CACHE HIT — plane sha ${String(rigMeta.planeSha256).slice(0, 8)} unchanged, reusing previous panel judgment + critique`,
    );
  } else {
    console.log(
      `judge (gemma4${claudeGates ? ', reported diversity cross-check' : ', frozen primary'}): scoring 9 views (${rubric.judge_panel ? `panel k=${rubric.judge_panel.k} @ temp ${rubric.judge_panel.temperature}` : `median of seeds ${rubric.judge_seeds.join('/')}`})`,
    );
    gemmaJudged = applyScoringV3(await judgeShots({ shotsDir: rig.outDir }));
    if (!gemmaJudged) throw new Error('gemma judge did not complete all 9 views');

    // CRITIC WIRING (live-caught fix, 2026-07-16): criticPass existed only as a
    // CLI mode — the live loop's critic was ALWAYS bookkeepTrack's deterministic
    // anchorHint, so the structured render-vs-reference critique (and even the
    // legacy LLM contact-sheet critique) never actually steered the actor. Run
    // it on the frozen-gemma gating path. Fail-open: any error leaves
    // gemmaJudged.critic undefined → bookkeepTrack's anchorHint fallback →
    // byte-identical prior behavior.
    if (!claudeGates) {
      try {
        gemmaJudged.critic = await criticPass({
          resultsFile: path.join(rig.outDir, 'judge', 'results.json'),
          shotsDir: rig.outDir,
        });
      } catch (err) {
        console.log(`  critic pass skipped (fail-open to anchor hint): ${String(err.message || err)}`);
      }
    }
    if (judgeCache) {
      judgeCache.sha = rigMeta.planeSha256;
      judgeCache.rubricSha = rubricSha256;
      judgeCache.judged = structuredClone(gemmaJudged);
    }
  }

  let claudeJudged = null;
  if (secondaryJudgeDisabled) {
    console.log('judge (secondary Claude/Fable-5 vision): SKIPPED (--secondary-judge none — zero Anthropic API calls)');
  } else {
    console.log(
      `judge (${opusJudgeModel} vision${pairwiseMode ? ' PAIRWISE, gating' : opusPanel ? ' PANEL, gating' : ''}): scoring 9 views (samples=${opusSamples})`,
    );
    // opus-pairwise: BLIND, ORDER-SWAPPED, candidate-vs-cached-reference-BUILD
    // judging (the cached reference shots come from the sidecar; judgeShotsPairwise
    // itself refuses to score against a rig-mismatched stale cache — review fix #6).
    claudeJudged = pairwiseMode
      ? await judgeShotsPairwise({
          shotsDir: rig.outDir,
          referenceShotsDir: path.resolve(REPO_ROOT, pairwiseCfg.ref_shots_dir),
          samples: opusSamples,
          model: opusJudgeModel,
        })
      : // claude-vision is a view MEAN like gemma, so it takes the same v3
        // aggregation; the pairwise branch above is a parity total and must
        // NOT be v3-rewritten (applyScoringV3's own contract).
        applyScoringV3(
          await judgeShotsClaude({
            shotsDir: rig.outDir,
            samples: opusSamples,
            model: opusJudgeModel,
          }),
        );
    if (!claudeJudged) throw new Error('claude vision judge did not complete all 9 views');
  }

  let gemmaRecord = bookkeepTrack({
    actorDir: gemmaDir,
    iterNum,
    runId,
    judged: gemmaJudged,
    judgeTrack: undefined,
    rubric,
    rubricSha256,
    planePath,
  });
  let claudeRecord = claudeJudged
    ? bookkeepTrack({
        actorDir: claudeDir,
        iterNum,
        runId,
        judged: claudeJudged,
        judgeTrack: claudeJudged.judge_track,
        rubric,
        rubricSha256,
        planePath,
      })
    : null;

  console.log(
    `ITER ${iterNum} gemma4=${gemmaRecord.total_0_100}/100 (best ${gemmaRecord.best_total_after})` +
      (claudeJudged
        ? ` | ${claudeJudged.judge_track}=${claudeRecord.total_0_100}/100 (best ${claudeRecord.best_total_after})`
        : ' | secondary judge skipped'),
  );

  // Fix 4 (write half): learn from the PREVIOUS iteration's actor edit now
  // that this iteration's fresh scores make its effect observable. Fails
  // open — an MCP error here must never break the bench loop.
  try {
    await maybeIngestPriorIterationLesson({
      gemmaDir,
      gemmaHistory,
      claudeHistory,
      gemmaRecord,
      claudeRecord,
      iterNum,
      actorName,
    });
  } catch (err) {
    console.log(`  self-learning lesson ingest skipped: ${String(err.message || err)}`);
  }

  // --- opus-pairwise EDIT-GATE + certification prep (pairwise-only) ----------
  // Judging THIS candidate IS the evaluation of the PREVIOUS iteration's edit
  // (judge-then-edit ordering — the SAME seam maybeIngestPriorIterationLesson
  // hooks). Right here, after the fresh pairwise total for N-1's geometry is
  // known and BEFORE iteration N's actor runs, we: (1) compute the per-view
  // certification/contested state; (2) accept / within-noise / reject N-1's edit,
  // BACKTRACKING the candidate to best-plane.js on a REJECT so N edits from the
  // BEST geometry (the reverted FILE never touches the recorded totals —
  // iter-N.json still records the TRUE measured regressed number, so stop
  // semantics are preserved exactly); (3) ledger a rejected edit as an
  // anti-example; and (4) ingest ONE strategy EVENT from the gate signal (the
  // single source that keeps the gate and the strategy memory consistent). All
  // fail-open and pairwise-only.
  let pairwiseCertify = null;
  let gateState;
  // BRU-5: the gated edit's measured per-view effect (gemma track only —
  // returned by runFrozenGemmaGate; stays null on other paths).
  let lastEditEffect = null;
  const bestPlanePath = path.join(claudeDir, 'best-plane.js');
  const rejectedLedgerPath = path.join(claudeDir, 'rejected-edits.json');
  const gemmaRejectedLedgerPath = path.join(gemmaDir, 'rejected-edits.json');

  const { prevGemma, hasPriorIter, prevActor } = resolvePrevActorAttempt({ gemmaDir, gemmaHistory, iterNum });

  if (pairwiseMode) {
    gateState = loadGateState(claudeDir);
    const gatePerView = claudeJudged.per_view.map((v) => v.score);
    const gateTotal = claudeJudged.total_0_100;
    const gemmaTotal = gemmaJudged.total_0_100;
    pairwiseCertify = certifyPairwiseStop({
      perView: claudeJudged.per_view,
      bars: calibratedBar,
      gemmaCandidatePerView: gemmaJudged.per_view.map((v) => v.score),
      gemmaReferencePerView: pairwiseCfg.gemma_reference_per_view,
      gemmaVetoBand: pairwiseCfg.gemma_veto_band,
      priorContestedStreaks: gateState?.contested_streaks || [],
    });

    const canGate = Boolean(gateState) && hasPriorIter && prevActor && GENUINE_ACTOR_STATUSES.has(prevActor.status);

    if (!canGate) {
      // Nothing genuine to gate against this iteration. canGate goes false for
      // several innocuous reasons — the previous actor exhausted its retries, the
      // run was resumed and the iterations are not contiguous, an actor record is
      // missing — none of which is evidence that the current geometry is good.
      //
      // This branch used to re-baseline UNCONDITIONALLY: it overwrote best_total
      // with the current iteration's score, with no comparison. On a real run
      // iter-9's actor exhausted its retries, so iter-10 took this branch and a
      // 56.49 silently replaced a 59.39 best — the ratchet leaked downward, which
      // lowers the acceptance bar for every later iteration and un-protects the
      // per-view bars already cleared.
      //
      // Establish a baseline only when there is genuinely no best to protect.
      // Otherwise HOLD the existing best and refresh nothing but the streaks.
      const resolved = resolveUngatedGateState({
        gateState,
        gateTotal,
        gatePerView,
        gemmaTotal,
        contestedStreaks: pairwiseCertify.contestedStreaks,
        iterNum,
      });
      gateState = resolved.state;
      if (resolved.action === 'baseline') {
        reportSnapshot(snapshotBest({ candidatePath: planePath, bestPlanePath }), iterNum);
        console.log(`  EDIT-GATE: baseline established (best=${gateTotal}/100 from iter ${iterNum})`);
      } else {
        console.log(
          `  EDIT-GATE: cannot gate this iter (no genuine prior actor) — HOLDING best=${gateState.best_total}/100 ` +
            `from iter ${gateState.best_iter} (this iter scored ${gateTotal}/100)`,
        );
      }
      saveGateState(claudeDir, gateState);
    } else {
      const decision = decideEditAcceptance({
        gateTotal,
        gatePerView,
        bestTotal: gateState.best_total,
        bestPerView: gateState.best_per_view,
        clearedViewsBar: calibratedBar,
        gemmaTotal,
        prevGemmaBest: gateState.best_gemma_total,
        epsilonTotal: pairwiseCfg.epsilon_total,
        epsilonView: pairwiseCfg.epsilon_view,
        epsilonGemma: pairwiseCfg.gemma_veto_band,
        escalationArmed: Boolean(prevActor.escalation_armed),
        priorGemmaDownsideStreak: gateState.gemma_downside_streak || 0,
      });

      const weakestTargeted = prevGemma.weakest_feature?.id || null;
      const editSummary =
        prevActor.claude_result_text ||
        (prevActor.status === 'no_change'
          ? 'actor made no change to the candidate'
          : prevActor.status === 'contract_failed'
            ? 'edit rejected by the frozen contract'
            : prevActor.status === 'runtime_failed'
              ? 'edit rejected — buildPlane(THREE) threw at runtime'
              : 'actor edit (no summary)');
      // ONE strategy event from the gate signal (accept/improve -> 'strategy';
      // reject/regress -> 'anti'). classifyOutcome shares the calibration epsilon
      // with the gate so the two can never disagree about noise.
      const outcome = classifyOutcome(decision.totalDelta, pairwiseCfg.epsilon_total);
      try {
        await ingestStrategyEvent({
          tag: decision.decision === 'reject' || outcome === 'harmful' ? STRATEGY_ANTI_TAG : STRATEGY_EVENT_TAG,
          strategyId: strategyFingerprint(editSummary),
          criterion: weakestTargeted,
          technique: editSummary.slice(0, 400),
          outcome,
          gateDelta: decision.totalDelta,
          iter: prevGemma.iter,
          runId,
          actorName,
        });
      } catch (err) {
        console.log(`  strategy-event ingest skipped: ${String(err.message || err)}`);
      }

      if (decision.decision === 'accept') {
        // Advance best: the current geometry becomes the new backtrack anchor.
        reportSnapshot(snapshotBest({ candidatePath: planePath, bestPlanePath }), iterNum);
        gateState.best_total = gateTotal;
        gateState.best_per_view = gatePerView;
        gateState.best_gemma_total = gemmaTotal;
        gateState.best_iter = iterNum;
      } else if (decision.decision === 'reject') {
        let rejectedSha;
        try {
          rejectedSha = sha256(readFileSync(path.resolve(planePath), 'utf8'));
        } catch {
          rejectedSha = null;
        }
        appendRejectedEdit({
          ledgerPath: rejectedLedgerPath,
          entry: {
            iter: prevGemma.iter,
            weakest_feature_targeted: weakestTargeted,
            edit_summary: editSummary,
            rejected_sha256: rejectedSha,
            per_view_delta: decision.perViewDelta,
            gating_delta: decision.totalDelta,
            gemma_delta:
              Number.isFinite(gemmaTotal) && Number.isFinite(gateState.best_gemma_total)
                ? Math.round((gemmaTotal - gateState.best_gemma_total) * 100) / 100
                : null,
            reason: decision.reason,
            created_at: new Date().toISOString(),
          },
        });
        // Backtrack: restore the candidate to the best geometry so iteration N's
        // actor edits from best, not from the regression.
        restoreBest({ bestPlanePath, candidatePath: planePath });
      }
      // within_noise: keep the working file (exploration), do NOT advance best.

      gateState.gemma_downside_streak = decision.gemmaDownsideStreak;
      gateState.contested_streaks = pairwiseCertify.contestedStreaks;
      saveGateState(claudeDir, gateState);
      console.log(`  EDIT-GATE iter ${prevGemma.iter}: ${decision.decision} — ${decision.reason}`);
    }
  } else if (!claudeGates) {
    // Frozen gemma track: same accept/reject-against-best gate as pairwise
    // above, gated on gemma's own total (see lib/gemma-gate-wiring.mjs).
    // v4: the gate also writes ONE strategy event per gated genuine edit so
    // this track's cheatsheet fold (below) has credit to rank.
    const gemmaGateRun = await runFrozenGemmaGate({
      gemmaDir, gemmaJudged, rubric, prevGemma, prevActor, hasPriorIter, planePath, iterNum, runId, actorName, strategyEventTag: STRATEGY_EVENT_TAG, strategyAntiTag: STRATEGY_ANTI_TAG, genuineActorStatuses: GENUINE_ACTOR_STATUSES, loadGateState, saveGateState, reportSnapshot, resolveUngatedGateState,
    });
    gateState = gemmaGateRun.gateState;
    lastEditEffect = gemmaGateRun.lastEditEffect ?? null;
  }

  // Primary (gating) vs secondary (reported) judge track. In opus-panel/
  // opus-pairwise mode the Opus 4.8 vision judge gates the loop (weakest feature,
  // critic, escalation, stop threshold); gemma4:12b is the reported diversity
  // cross-check. Default: gemma gates (frozen behavior).
  const primaryJudged = claudeGates ? claudeJudged : gemmaJudged;
  const primaryRecord = claudeGates ? claudeRecord : gemmaRecord;
  const primaryHistory = claudeGates ? claudeHistory : gemmaHistory;

  // Fix 4 (read half): surface prior attempts on this weakest feature.
  const weakestId =
    primaryJudged.weakest_feature?.id || gemmaJudged.weakest_feature?.id || claudeJudged?.weakest_feature?.id;
  const priorAttemptsSection = await buildPriorAttemptsSection({ weakestId, actorName });
  // Criterion-aware retrieval (2026-07-16): hand the RAG query builder the
  // weakest criterion's own rubric name + top-anchor prose so technique-shaped
  // criteria (craftsmanship-class) retrieve on their actual subject — the old
  // fixed "geometry, dimensions, proportions" template was a documented live
  // retrieval miss for those (milestones BOEING-100 expansion note, bug #1).
  const weakestCriterion = (rubric.criteria || []).find((c) => c.id === weakestId) || null;
  const designReferenceSection = designReference
    ? await buildDesignReferenceSection({
        weakestId,
        subject: 'Boeing 747',
        criterionLabel: weakestCriterion?.name,
        criterionText: topAnchorText(weakestCriterion),
        cliBinary,
        cliDataDir,
      })
    : null;

  // BOEING-747-REBUILD-BURST-1 feedback half: when a rebuild burst is live,
  // tell the actor where it stands (attempts used/remaining, the incumbent
  // total to beat, recover-coherence-first priority). Null outside bursts —
  // the prompt stays byte-identical.
  const burstStatusSection = formatBurstStatusSection({
    burst: gateState?.burst ?? null,
    maxDepth: loadRebuildBurstConfig().maxDepth,
    bestTotal: gateState?.best_total,
    currentTotal: gemmaJudged.total_0_100,
  });

  // BRU-5: numeric credit assignment — what the actor's LAST gated edit
  // measurably did per view, plus the ledger-derived sentinel-view
  // pre-commit check. Both null until there is data; the prompt stays
  // byte-identical without them.
  const viewLabels = gemmaJudged.per_view.map((v) => ({ view: v.view, key: v.key }));
  const measuredFeedbackSection = [
    formatLastEditEffectSection({ lastEditEffect, views: viewLabels }),
    formatSentinelLine({
      sentinel: computeSentinelView(loadRejectedEdits({ ledgerPath: gemmaRejectedLedgerPath })),
      views: viewLabels,
    }),
  ]
    .filter(Boolean)
    .join('\n\n') || null;

  // opus-pairwise strategy-cheatsheet (ACE / Dynamic-Cheatsheet) + rejected-edit
  // anti-examples, folded FRESH from the brain each iteration and re-injected
  // into the actor prompt via the additive buildActorPrompt params (undefined on
  // every non-pairwise path => byte-identical prompt). Fail-open: brain down =>
  // empty sections this iteration (same discipline as the prior-attempts fetch).
  let strategyCheatsheetSection = null;
  let badAttemptsSection = null;
  let rejectedEditsSection = null;
  if (pairwiseMode) {
    try {
      const events = await fetchStrategyEvents({ criterion: weakestId, limit: 20, tag: STRATEGY_EVENT_TAG });
      const folded = foldStrategyEvents(events);
      // R5 strategy-persistence PROMOTION GATE: only re-inject a strategy once it
      // has a CERTIFIED win-rate LCB above floor over >= N independent fresh gate
      // observations, deflated by the candidate-pool size (selection premium). The
      // gate reads its knobs from the calibrated sidecar's certification block.
      const strategyCertCfg = pairwiseCfg.certification || {};
      const promoted = rankStrategies(folded, {
        scope: 'strategy',
        criterion: weakestId,
        limit: 5,
        promote: true,
        minEpisodes: strategyCertCfg.strategy_min_episodes,
        winrateFloor: strategyCertCfg.strategy_winrate_floor,
        alpha: strategyCertCfg.alpha,
      });
      strategyCheatsheetSection = formatStrategyCheatsheetSection(promoted);
      badAttemptsSection = formatBadAttemptsSection(
        rankStrategies(folded, { scope: 'anti', criterion: weakestId, limit: 3 }),
      );
      console.log(
        `  strategy cheatsheet: folded ${folded.length} strategy item(s), ${promoted.length} PROMOTED ` +
          `(certified R5 win-rate LCB) for '${weakestId || 'general'}'`,
      );
    } catch (err) {
      console.log(`  strategy cheatsheet fold skipped: ${String(err.message || err)}`);
    }
    rejectedEditsSection = formatRejectedEditsSection(loadRejectedEdits({ ledgerPath: rejectedLedgerPath }));
  } else if (!claudeGates) {
    // v4: full strategy memory on the frozen-gemma track too — the write half
    // now ingests gate events (lib/gemma-gate-wiring.mjs), so the read half
    // folds the same credit-ranked, PROMOTION-GATED cheatsheet + contrastive
    // anti-examples the pairwise track gets. Certification knobs come from
    // rubric.strategy_certification (protocol data, not source literals);
    // absent knobs fall back to rankStrategies' own defaults. TRACK-SCOPED
    // via actorTag so another era's gate events never steer this actor.
    // Fail-open: brain down ⇒ no sections this iteration.
    try {
      const events = await fetchStrategyEvents({ criterion: weakestId, limit: 20, tag: STRATEGY_EVENT_TAG, actorTag: actorName });
      const folded = foldStrategyEvents(events);
      const certCfg = rubric.strategy_certification || {};
      const promoted = rankStrategies(folded, {
        scope: 'strategy',
        criterion: weakestId,
        limit: 5,
        promote: true,
        minEpisodes: certCfg.strategy_min_episodes,
        winrateFloor: certCfg.strategy_winrate_floor,
        alpha: certCfg.alpha,
      });
      strategyCheatsheetSection = formatStrategyCheatsheetSection(promoted);
      badAttemptsSection = formatBadAttemptsSection(
        rankStrategies(folded, { scope: 'anti', criterion: weakestId, limit: 3 }),
      );
      if (folded.length > 0) {
        console.log(
          `  strategy cheatsheet (gemma track): folded ${folded.length} item(s), ${promoted.length} PROMOTED for '${weakestId || 'general'}'`,
        );
      }
    } catch (err) {
      console.log(`  strategy cheatsheet fold skipped (gemma track): ${String(err.message || err)}`);
    }
    rejectedEditsSection = formatRejectedEditsSection(loadRejectedEdits({ ledgerPath: gemmaRejectedLedgerPath }));
  }

  // Plateau escalation. Open track: mesh escalation (below). Frozen gemma
  // track (v4, 2026-07-17): a frozen-contract-safe PRIMITIVE RECOMPOSITION
  // directive, armed when the gate's accepted best has stalled for
  // rubric.frozen_escalation.min_stall_iters genuine iterations — the plateau
  // breaker this track never had. Driven by the gating judge's weakest feature.
  let plateauEscalation = null;
  if (!claudeGates && !contractModulePath && rubric.frozen_escalation && gateState && Number.isFinite(gateState.best_iter)) {
    const weakest = primaryJudged.weakest_feature;
    const stallIters = iterNum - gateState.best_iter;
    const minStall = Number.isFinite(rubric.frozen_escalation.min_stall_iters)
      ? rubric.frozen_escalation.min_stall_iters
      : 6;
    if (weakest && typeof weakest.mean === 'number' && stallIters >= minStall) {
      const genuineChain = filterGenuineIterationsForStopConditions([...primaryHistory, primaryRecord]);
      const streak = meshEscalationStreak(genuineChain, weakest.id);
      const gap = rubric.view_threshold - weakest.mean;
      plateauEscalation = buildFrozenEscalation({ weakest, streak, gap, viewThreshold: rubric.view_threshold, stallIters });
      console.log(
        `  PLATEAU ESCALATION armed (frozen track) for '${weakest.id}' (mean ${weakest.mean}/10, stall ${stallIters} >= ${minStall}) ` +
          `-- actor directed to recompose it from primitives`,
      );
    }
  }
  if (contractModulePath) {
    const weakest = primaryJudged.weakest_feature;
    if (weakest && typeof weakest.mean === 'number') {
      const genuineChain = filterGenuineIterationsForStopConditions([...primaryHistory, primaryRecord]);
      const streak = meshEscalationStreak(genuineChain, weakest.id);
      // In opus-pairwise mode the score is a PARITY RATIO vs the reference build
      // (5.0 == parity), so the structural-gap target is the parity anchor, not
      // the frozen uniform 8.0 (which pairwise parity scores rarely approach —
      // using 8.0 would over-fire escalation every iteration). Non-pairwise paths
      // keep rubric.view_threshold exactly (byte-identical behavior).
      const escalationTarget = pairwiseMode ? PARITY_ANCHOR_SCORE : rubric.view_threshold;
      const gap = escalationTarget - weakest.mean;
      if (gap > MESH_ESCALATION_GAP || streak >= Math.max(2, effPatience - 1)) {
        plateauEscalation = buildMeshEscalation({ weakest, streak, gap, viewThreshold: escalationTarget });
        console.log(
          `  PLATEAU ESCALATION armed for '${weakest.id}' (mean ${weakest.mean}/10, gap ${gap.toFixed(1)}, streak ${streak}) ` +
            `-- actor directed to rebuild it as a computed mesh`,
        );
      }
    }
  }

  // Fix 1: retry-with-backoff instead of a single all-or-nothing call.
  const retryCfg = loadActorRetryConfig({ overrideMaxRetries: maxActorRetries });

  // --- opus-pairwise BEST-OF-N plateau break (pairwise-only, gated behind
  // --best-of-n N). maybeRunBestOfN returns null unless the flag is armed AND a
  // worst view has PLATEAUED — so when the flag is 0/absent, or nothing is stuck,
  // the SINGLE-edit path below runs BYTE-IDENTICALLY (the frozen/opus-panel/
  // single-edit-pairwise tracks never change). When it fires it samples N DIVERSE
  // candidate edits (each on a fresh COPY so they never stomp each other), selects
  // the worst-view-LCB winner minus caution, and promotes it ONLY if it passes the
  // edit-gate (no total regression) AND the reward-hack guardrail. All live
  // rig/judge/actor/fs seams live in lib/best-of-n-wiring.mjs (keeps the pure
  // decision unit-testable and this file under its size budget). ---
  const bestOfNStep = pairwiseMode
    ? await maybeRunBestOfN({
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
        repoRoot: REPO_ROOT,
        actorBase: {
          shotsDir: rig.outDir,
          gemmaResult: gemmaJudged,
          claudeResult: claudeJudged,
          model: model || DEFAULT_MODEL,
          effort: effort || DEFAULT_EFFORT,
          priorAttemptsSection,
          designReferenceSection,
          strategyCheatsheetSection,
          badAttemptsSection,
          rejectedEditsSection,
          cliBinary,
          cliDataDir,
          contractModulePath,
          contractLabel,
        },
        runActorWithRetries,
        logger: (msg) => console.log(msg),
      })
    : null;

  // BRU-3 BEST-OF-N JUDGE-ONCE. Config is loaded ONLY off the pairwise
  // best-of-N path on the non-Claude-gating (frozen gemma) track under the
  // FROZEN contract (the wiring's filter cascade re-checks candidates with
  // the frozen lib/contract.mjs validator, which would wrongly filter
  // open-contract geometry — the open track is intentionally not wired). It
  // fails open to enabled:false, so a bare run reaches the direct single-edit
  // call below BYTE-IDENTICALLY (the disabled path never builds the step ctx).
  const judgeOnceCfg =
    !bestOfNStep && !claudeGates && !contractModulePath ? loadBestOfNJudgeOnceConfig() : null;
  const judgeOnceStep = judgeOnceCfg?.enabled
    ? await maybeRunBestOfNJudgeOnce({
        config: judgeOnceCfg,
        planePath,
        iterNum,
        gemmaDir,
        lastGateDecision: lastEditEffect?.decision ?? null,
        acceptedTotal: gemmaJudged.total_0_100,
        retryCfg,
        actorBase: {
          shotsDir: rig.outDir,
          gemmaResult: gemmaJudged,
          claudeResult: claudeJudged,
          model: model || DEFAULT_MODEL,
          effort: effort || DEFAULT_EFFORT,
          priorAttemptsSection,
          designReferenceSection,
          strategyCheatsheetSection,
          badAttemptsSection,
          rejectedEditsSection,
          plateauEscalation,
          burstStatusSection,
          measuredFeedbackSection,
          cliBinary,
          cliDataDir,
          contractModulePath,
          contractLabel,
        },
        runActorWithRetries,
        logger: (msg) => console.log(msg),
      })
    : null;

  let actorResult;
  if (bestOfNStep) {
    actorResult = bestOfNStep.actorResult;
  } else if (judgeOnceStep) {
    actorResult = judgeOnceStep.actorResult;
  } else {
    console.log(
      `actor: driving ${model || DEFAULT_MODEL} (--effort ${effort || DEFAULT_EFFORT}) to edit ${planePath} ` +
        `(retry policy: ${retryCfg.maxRetries} retries, base ${retryCfg.baseTimeoutMs}ms, cap ${retryCfg.timeoutCapMs}ms, source=${retryCfg.source})`,
    );
    actorResult = await runActorWithRetries({
      retryCfg,
      candidatePath: planePath,
      shotsDir: rig.outDir,
      gemmaResult: gemmaJudged,
      claudeResult: claudeJudged,
      model: model || DEFAULT_MODEL,
      effort: effort || DEFAULT_EFFORT,
      priorAttemptsSection,
      // LIVE-CAUGHT OMISSION (2026-07-17): this direct path built the
      // design-reference section every iteration (the RAG --ask ran and was
      // paid for) but never passed it — only the best-of-N actorBase did.
      // The taught channel was retrieval-connected, injection-disconnected.
      designReferenceSection,
      strategyCheatsheetSection,
      badAttemptsSection,
      rejectedEditsSection,
      plateauEscalation,
      burstStatusSection,
      measuredFeedbackSection,
      cliBinary,
      cliDataDir,
      contractModulePath,
      contractLabel,
    });
  }
  console.log(
    `actor status: ${actorResult.status} (changed=${actorResult.changed}, $${actorResult.cost_usd}, ` +
      `${Math.round(actorResult.ms / 1000)}s, attempts=${actorResult.attempts.length})`,
  );
  if (actorResult.status === 'contract_failed') {
    console.log(`  CONTRACT VIOLATIONS (edit rejected, previous candidate restored):`);
    for (const v of actorResult.contract_violations) console.log(`    - ${v}`);
  }
  if (actorResult.status === 'runtime_failed') {
    console.log(`  RUNTIME ERROR (edit rejected, previous candidate restored): ${actorResult.runtime_error}`);
  }
  if (actorResult.status === 'actor_exhausted_retries') {
    // WIRE-CLI-PARITY-GAP-3 rewire: distinguish a `action_trust` ledger
    // DENIAL (no retry was even attempted — shouldRetryActor short-circuits
    // it, see lib/actor-retry.mjs) from a genuine infra timeout/crash that
    // burned the full retry budget, in the human-readable log only — both
    // still share the SAME `actor_exhausted_retries` status for the
    // stop-condition exclusion mechanism (lib/actor-retry.mjs's
    // filterGenuineIterationsForStopConditions/computeTrailingExhaustionStreak).
    const deniedRun = actorResult.attempts.some((a) => a.denied);
    console.log(
      deniedRun
        ? `  ACTOR CALL DENIED by the action_trust ledger (no retry attempted — a longer timeout cannot change a ` +
            `trust decision) — NOT fed into evaluateStopConditions as a capability signal: ${actorResult.actor_error}`
        : `  ACTOR EXHAUSTED ALL ${actorResult.attempts.length} RETRIES (no change applied) — infra failure, ` +
            `NOT fed into evaluateStopConditions as a capability signal: ${actorResult.actor_error}`,
    );
  }
  // Stamp whether escalation was armed THIS iteration so the NEXT iteration's
  // edit-gate applies the escalation-aggregate exemption to this edit (a bold
  // rebuild is gated on AGGREGATE total, not per-view dips). Originally
  // pairwise-only; the frozen track stamps too since it now escalates
  // (2026-07-17) — the promise "a transient one-view dip will not be scored
  // as a regression" must be honored by its gate as well.
  if (pairwiseMode || (!claudeGates && rubric.frozen_escalation)) {
    actorResult.escalation_armed = Boolean(plateauEscalation);
  }
  writeFileSync(path.join(gemmaDir, `iter-${iterNum}-actor.json`), JSON.stringify(actorResult, null, 2));

  // Fix 2: tag both tracks' records with the actor outcome so the stall/
  // threshold/budget counters (evaluateStopConditions, FROZEN) only ever see
  // genuine attempts — an actor_exhausted_retries iteration is excluded from
  // the arrays below, on THIS call and every future loadHistory() call.
  gemmaRecord = patchActorStatus(gemmaDir, iterNum, gemmaRecord, actorResult.status);
  claudeRecord = claudeRecord ? patchActorStatus(claudeDir, iterNum, claudeRecord, actorResult.status) : null;

  const gemmaIterations = filterGenuineIterationsForStopConditions([...gemmaHistory, gemmaRecord]);
  // gemma always uses its uniform bar; the Opus track uses the per-view
  // CALIBRATED bar in opus-panel mode (else the same uniform bar).
  const gemmaStopCfg = { viewThreshold: rubric.view_threshold, patience: effPatience, budget: effBudget };
  const claudeStopCfg = { viewThreshold: calibratedBar, patience: effPatience, budget: effBudget };
  const gemmaStop = evaluateStopConditions(gemmaIterations, gemmaStopCfg);
  // secondary judge skipped: a harmless placeholder in evaluateStopConditions's
  // OWN return shape — never contributes a stop/reason, matching "not computed".
  const claudeIterations = claudeJudged ? filterGenuineIterationsForStopConditions([...claudeHistory, claudeRecord]) : [];
  const claudeStop = claudeJudged
    ? evaluateStopConditions(claudeIterations, claudeStopCfg)
    : { stop: false, reasons: [], bestTotal: null, consecutiveNonImproving: 0, remainingBudget: effBudget };

  // A SEPARATE, explicit exhaustion cap — distinct from `stall` — so a
  // genuinely broken/unreachable `claude` CLI cannot spin the loop forever,
  // while a single exhausted iteration (a transient infra hiccup) does NOT
  // by itself end the loop the way a real stall does.
  const exhaustionStreak = computeTrailingExhaustionStreak([...gemmaHistory, gemmaRecord]);
  const exhaustionCapped = exhaustionStreak >= retryCfg.exhaustionCap;
  const exhaustionReason = exhaustionCapped
    ? [
        `actor_exhausted_retries_cap: ${exhaustionStreak} consecutive iteration(s) fully exhausted actor retries ` +
          `(cap ${retryCfg.exhaustionCap}) — infra failure, NOT a demonstrated capability ceiling`,
      ]
    : [];

  // GATING. Default (gemma primary): stop when EITHER track's own stop fires
  // (a threshold on either judge is a legitimate "done"; a stall/budget on
  // either legitimately stops the loop). opus-panel: the Opus 4.8 vision panel
  // is the SOLE gating judge (threshold on its per-view calibrated bar / stall /
  // budget); gemma is reported only and never gates. The exhaustion cap always
  // applies. Nothing is silently enforced — every reason is printed.
  let stop;
  if (pairwiseMode) {
    // opus-pairwise: the Opus 4.8 pairwise panel is the SOLE gating judge, but a
    // THRESHOLD "done" is CERTIFIED only when every view clears its calibrated
    // bar with NO inconclusive (coin-flip) view and NO persistently gemma-
    // CONTESTED view ("100%" definition). stall/budget still stop the loop; gemma
    // is reported (its persistence-gated veto already folded into pairwiseCertify).
    //
    // R2/R3 CONFIRMATION RE-JUDGE: a single all-cleared pass is a candidate-100%
    // EVENT, not a certified 100%. Before banking a threshold stop we re-judge the
    // SAME rendered candidate with k_confirm ADDITIONAL independent pairwise passes
    // (fresh Opus order-swaps/seeds; force:true so the per-view cache is NOT reused)
    // and certify on the pooled worst-view Agresti-Coull LCB (never the peak). Only
    // fired on an all-cleared pass, so the extra judge cost is paid at most once per
    // 100% event; the extra passes overwrite the disposable shots-dir judge cache
    // AFTER bookkeeping already recorded the true pass-1 totals, so no measurement
    // artifact is mutated.
    let pairwiseConfirmed = null;
    if (pairwiseCertify.allCleared) {
      const certCfg = pairwiseCfg.certification || {};
      const kConfirm =
        Number.isInteger(certCfg.k_confirm) && certCfg.k_confirm >= 0 ? certCfg.k_confirm : DEFAULT_K_CONFIRM;
      const refShotsDir = path.resolve(REPO_ROOT, pairwiseCfg.ref_shots_dir);
      const confirmPasses = [claudeJudged.per_view];
      console.log(
        `  CONFIRMATION: candidate-100% single pass — running ${kConfirm} independent confirmation pass(es) on the SAME render`,
      );
      for (let c = 0; c < kConfirm; c++) {
        const extra = await judgeShotsPairwise({
          shotsDir: rig.outDir,
          referenceShotsDir: refShotsDir,
          samples: opusSamples,
          model: opusJudgeModel,
          force: true,
        });
        if (extra && Array.isArray(extra.per_view)) {
          confirmPasses.push(extra.per_view);
          console.log(`    confirmation pass ${c + 1}/${kConfirm}: ${extra.total_0_100}/100`);
        } else {
          console.log(`    confirmation pass ${c + 1}/${kConfirm}: judge returned no per_view — skipped`);
        }
      }
      pairwiseConfirmed = certifyPairwiseConfirmed({
        passes: confirmPasses,
        bars: calibratedBar,
        contestedViews: pairwiseCertify.contestedViews,
        pFloor: _isNum(certCfg.p_floor) ? certCfg.p_floor : DEFAULT_P_FLOOR,
        alpha: _isNum(certCfg.alpha) ? certCfg.alpha : DEFAULT_ALPHA,
      });
      console.log(
        `  CONFIRMATION VERDICT: certified=${pairwiseConfirmed.certified} ` +
          `worst-view LCB=${pairwiseConfirmed.worstViewLCB.toFixed(3)} over ${pairwiseConfirmed.passesUsed} passes` +
          `${pairwiseConfirmed.inconclusiveViews.length ? ` inconclusive[${pairwiseConfirmed.inconclusiveViews.join(',')}]` : ''}` +
          `${pairwiseConfirmed.escalatedViews.length ? ` escalated[${pairwiseConfirmed.escalatedViews.join(',')}]` : ''}` +
          ` — resolution ${formatResolution(pairwiseConfirmed.resolution)}`,
      );
    }
    const pw = computePairwiseStop({ claudeStop, certify: pairwiseCertify, confirmed: pairwiseConfirmed });
    stop = {
      stop: pw.stop || exhaustionCapped,
      reasons: [
        ...gemmaStop.reasons.map((r) => `gemma4 (reported): ${r}`),
        ...pw.reasons.map((r) => `${claudeJudged.judge_track} (gating): ${r}`),
        ...exhaustionReason,
      ],
      gemma: gemmaStop,
      claude: claudeStop,
      certify: pairwiseCertify,
      // R7: the fresh confirmation resolution + noise-budget record travels with
      // the stop so a certified "100%" is reported at its stated resolution.
      confirmed: pairwiseConfirmed,
      actor_exhausted_retries_cap: exhaustionCapped,
    };
    console.log(
      `  PAIRWISE CERT: cleared ${pairwiseCertify.clearedViews}/${pairwiseCertify.totalViews}` +
        `${pairwiseCertify.inconclusiveViews.length ? ` inconclusive[${pairwiseCertify.inconclusiveViews.join(',')}]` : ''}` +
        `${pairwiseCertify.contestedViews.length ? ` contested[${pairwiseCertify.contestedViews.join(',')}]` : ''}` +
        `${pairwiseCertify.softFlaggedViews.length ? ` soft-flag[${pairwiseCertify.softFlaggedViews.join(',')}]` : ''}` +
        ` -> single-pass allCleared=${pairwiseCertify.allCleared}` +
        `${pairwiseConfirmed ? ` confirmed=${pairwiseConfirmed.certified}` : ''}`,
    );
  } else {
    const primaryStop = opusPanel ? claudeStop : { stop: gemmaStop.stop || claudeStop.stop };
    stop = {
      stop: primaryStop.stop || exhaustionCapped,
      reasons: [
        ...gemmaStop.reasons.map((r) => `gemma4${opusPanel ? ' (reported)' : ''}: ${r}`),
        ...claudeStop.reasons.map((r) => `${claudeJudged?.judge_track ?? 'secondary-judge'}${opusPanel ? ' (gating)' : ''}: ${r}`),
        ...exhaustionReason,
      ],
      gemma: gemmaStop,
      claude: claudeStop,
      actor_exhausted_retries_cap: exhaustionCapped,
    };
  }
  console.log(
    `STOP-CHECK stop=${stop.stop} gemma[nonImproving=${gemmaStop.consecutiveNonImproving}/${effPatience} budget=${gemmaIterations.length}/${effBudget}] ` +
      `${claudeJudged?.judge_track ?? 'secondary-judge(skipped)'}[nonImproving=${claudeStop.consecutiveNonImproving}/${effPatience} budget=${claudeIterations.length}/${effBudget}] ` +
      `exhaustionStreak=${exhaustionStreak}/${retryCfg.exhaustionCap}`,
  );
  for (const reason of stop.reasons) console.log(`  STOP REASON: ${reason}`);

  // BRU-6 FLATLINE HEALTH-CHECK. Runs right where the stop-check/patience
  // evidence is logged so the two readings can never drift apart. The streak
  // definition is: consecutive iterations whose judge delta stayed within the
  // SAME noise epsilon the edit-gate uses AND whose candidate sha never
  // changed — the actor kept producing no effective edit. The 2026-07-17
  // campaign proved that chain is usually a wedged transport/process (a
  // process restart re-activated the actor 3x observed, records followed),
  // so counting it as plateau/patience evidence misreads infra health as a
  // capability ceiling. DETECTION-ONLY: stop decisions above are computed
  // BEFORE this block and are never altered by it (stop semantics may not
  // change silently); the loud line reclassifies the streak for the
  // operator/agent driving the run.
  const flatlineCfg = loadFlatlineHealthConfig();
  if (flatlineCfg.enabled) {
    const flatlineEpsilon = Number.isFinite(gemmaJudged.panel_se_total)
      ? (rubric.judge_panel?.epsilon_se_coefficient ?? 1) * gemmaJudged.panel_se_total
      : (rubric.total_noise_epsilon ?? 0);
    const flatline = detectFlatline({
      recentIters: flatlineItersFromRecords([...gemmaHistory, gemmaRecord]),
      epsilon: flatlineEpsilon,
      threshold: flatlineCfg.threshold,
    });
    if (flatline.flatline) {
      console.log(
        `  FLATLINE HEALTH-CHECK: ${flatline.reason} — ACTOR-HEALTH failure signature (wedged transport/process), ` +
          `NOT capability-plateau evidence; RESTART the actor process/transport before reading this stretch as a ` +
          `ceiling (these ${flatline.streak} iteration(s) are RECLASSIFIED as actor-health, not patience evidence; ` +
          `config source=${flatlineCfg.source})`,
      );
    }
  }

  return { iterNum, gemmaRecord, claudeRecord, actorResult, stop };
}

/** Drive the loop to ITS OWN stop condition (threshold / stall / budget / exhaustion cap) — never forced early, never fabricated. */
export async function runLoopTerransoul({
  planePath,
  actor,
  model,
  effort,
  maxIter,
  maxActorRetries,
  cliBinary,
  cliDataDir,
  contractModulePath,
  contractLabel,
  patience,
  budget,
  judgeMode,
  judgeSamples,
  bestOfN, secondaryJudge, designReference,
}) {
  // ONE WRITER PER CANDIDATE PLANE. Two concurrent runs sharing this file corrupted a
  // real run: an actor's Read and Edit interleaved with the other process's write, and
  // both processes clobbered gate-state.json. Refuse to start rather than produce
  // iterations nobody can trust.
  const lock = acquireRunLock({ candidatePath: planePath, actorName: actor });
  if (!lock.ok) {
    throw new Error(`refusing to start a second bench run on the same candidate: ${lock.reason}`);
  }
  // ERA GUARD (adversarial-review fix 2026-07-16): refuse — BEFORE any
  // iteration is rendered, judged, or recorded — to resume a frozen-gemma-gated
  // results dir whose persisted gate-state was written under a different
  // scoring_version. Resuming e.g. the v2-era terransoul-gemma-taught dir with
  // v3 aggregation would gate every fresh (v3) total against the v2-inflated
  // 55.64 bar and false-reject everything — re-bricking the loop the way the
  // 239-iteration stall did. opus-panel/opus-pairwise are exempt: their gating
  // totals are not v3-rewritten (parity/calibrated-bar semantics unchanged).
  if (judgeMode !== 'opus-panel' && judgeMode !== 'opus-pairwise') {
    const eraActor = actor || DEFAULT_ACTOR;
    try {
      assertGateStateEra(loadGateState(path.join(BENCH_DIR, 'results', eraActor)), {
        expectedVersion: SCORING_VERSION,
        stateLabel: `results/${eraActor}/gate-state.json`,
      });
    } catch (err) {
      lock.release();
      throw err;
    }
  }
  // Nothing in this harness handles SIGINT/SIGTERM, so a Ctrl-C on a multi-hour bench
  // would otherwise leave the lock behind and block the next run.
  const onSignal = (sig) => {
    lock.release();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const { rubric } = loadRubric();
    const effBudget = budget || rubric.iteration_budget;
    const hardCap = maxIter ? Math.min(maxIter, effBudget) : effBudget;
    // Single-entry judge cache shared across this process's iterations (see
    // the JUDGE CACHE note in runIterationTerransoul).
    const judgeCache = {};
    let last = null;
    for (let i = 0; i < hardCap; i++) {
      last = await runIterationTerransoul({
        planePath,
        actor,
        model,
        effort,
        maxActorRetries,
        cliBinary,
        cliDataDir,
        contractModulePath,
        contractLabel,
        patience,
        budget,
        judgeMode,
        judgeSamples,
        bestOfN, secondaryJudge, designReference,
        judgeCache,
      });
      if (last.stop.stop) break;
    }
    return last;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    lock.release();
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plane) {
    console.error(
      'usage: node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5] [--model claude-fable-5] ' +
        '[--effort max] [--max-iter N] [--max-actor-retries N] [--cli-bin <path>] [--cli-data-dir <dir>] [--contract open|frozen] [--budget N] [--patience N] [--judge gemma|opus-panel|opus-pairwise] [--judge-samples N] [--best-of-n N] [--secondary-judge claude|none] [--design-reference]',
    );
    process.exit(2);
  }
  // --secondary-judge none: zero Anthropic API calls for the whole run — only
  // legal with the default --judge gemma (Claude gates opus-panel/opus-pairwise,
  // so it cannot be a skippable secondary there; runIterationTerransoul refuses
  // that combination with a clear error rather than silently gating on nothing).
  const secondaryJudge = args['secondary-judge'] === 'none' ? 'none' : 'claude';
  // --contract open swaps ONLY the candidate contract validator + actor-prompt
  // contract text (OPEN-VARIANT-DESIGN.md); default frozen leaves both undefined
  // so runActorEdit takes its byte-identical frozen path.
  const contractChoice = typeof args.contract === 'string' ? args.contract.toLowerCase() : 'frozen';
  if (contractChoice !== 'open' && contractChoice !== 'frozen') {
    console.error(`--contract must be 'open' or 'frozen' (got: ${args.contract})`);
    process.exit(2);
  }
  const contractModulePath = contractChoice === 'open' ? CONTRACT_OPEN_PATH : undefined;
  const contractLabel = contractChoice === 'open' ? 'lib/contract-open.mjs' : undefined;
  console.log(`contract track: ${contractChoice}${contractModulePath ? ` (${contractModulePath})` : ''}`);
  runLoopTerransoul({
    planePath: args.plane,
    actor: args.actor,
    model: typeof args.model === 'string' ? args.model : undefined,
    effort: typeof args.effort === 'string' ? args.effort : undefined,
    maxIter: args['max-iter'] ? Number(args['max-iter']) : undefined,
    maxActorRetries: args['max-actor-retries'] ? Number(args['max-actor-retries']) : undefined,
    cliBinary: typeof args['cli-bin'] === 'string' ? args['cli-bin'] : undefined,
    cliDataDir: typeof args['cli-data-dir'] === 'string' ? args['cli-data-dir'] : undefined,
    contractModulePath,
    contractLabel,
    patience: args.patience ? Number(args.patience) : undefined,
    budget: args.budget ? Number(args.budget) : undefined,
    judgeMode:
      args.judge === 'opus-panel' ? 'opus-panel' : args.judge === 'opus-pairwise' ? 'opus-pairwise' : 'gemma',
    judgeSamples: args['judge-samples'] ? Number(args['judge-samples']) : undefined,
    // --best-of-n N: opus-pairwise plateau-breaking budget. Default 0 = OFF =
    // current single-edit behavior (byte-identical). Capped to BEST_OF_N_CAP inside
    // planBestOfNBudget; only fires when a worst view has plateaued.
    bestOfN: args['best-of-n'] ? Number(args['best-of-n']) : 0,
    // --design-reference: ask TerranSoul's own memory (pointed at THIS run's
    // --cli-data-dir) for reference material an operator ingested ahead of
    // time via `terransoul --ingest-resume <path>`, scoped to the current
    // weakest feature, and inject the answer into the actor prompt. Default
    // OFF — a bare run stays byte-identical to every prior track. See
    // buildDesignReferenceSection / lib/design-reference.mjs.
    secondaryJudge, designReference: Boolean(args['design-reference']),
  })
    .then((last) => {
      console.log('\nLOOP DONE');
      if (last) {
        console.log(
          `final iter=${last.iterNum} gemma4=${last.gemmaRecord.total_0_100}/100` +
            (last.claudeRecord ? ` opus/claude-vision=${last.claudeRecord.total_0_100}/100` : ' (secondary judge skipped)'),
        );
      }
    })
    .catch((err) => {
      console.error(`LOOP_TERRANSOUL_FAIL ${err.message}`);
      process.exit(1);
    });
}
