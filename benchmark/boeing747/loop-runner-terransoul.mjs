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
//        agentic-edit CLI capability, `terransoul-cli --agent-task`
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
// inside actor-claude.mjs itself; rewritten for the terransoul-cli
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
// exactly one `terransoul-cli --agent-task` subprocess in flight at any time.
//
// CLI:
//   node loop-runner-terransoul.mjs --plane <plane.js> [--actor terransoul-fable5]
//     [--model claude-fable-5] [--effort max] [--max-iter N] [--max-actor-retries N]
//     [--cli-bin <path>] [--cli-data-dir <dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActorEdit } from './actor/actor-claude.mjs';
import { judgeShotsClaude } from './judge/judge-claude.mjs';
import { judgeShotsPairwise } from './judge/judge-pairwise.mjs';
import { judgeShots, loadRubric } from './judge/judge.mjs';
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
  decideEditAcceptance,
  formatRejectedEditsSection,
  loadRejectedEdits,
  restoreBest,
  snapshotBest,
} from './lib/edit-gate.mjs';
import { PARITY_ANCHOR_SCORE, loadPairwiseConfig } from './lib/pairwise-config.mjs';
// PURE statistical-rigor certification primitives (July-2026 findings): the
// worst-view Agresti-Coull LCB / IUT (R1), the sequential betting e-process for
// straddling views (R2), and the paired-test resolution + judge flip-rate noise
// budget (R7). Consumed ONLY on the opus-pairwise CONFIRMATION path below; the
// frozen gemma and opus-panel tracks never reach it, so they stay byte-identical.
import {
  DEFAULT_ALPHA,
  DEFAULT_K_CONFIRM,
  DEFAULT_P_FLOOR,
  agrestiCoullInterval,
  agrestiCoullLCB,
  certifyIUT,
  eProcess,
  pairedResolution,
} from './lib/certification-stats.mjs';
import {
  classifyOutcome,
  foldStrategyEvents,
  formatBadAttemptsSection,
  formatStrategyCheatsheetSection,
  rankStrategies,
  strategyFingerprint,
} from './lib/strategy-cheatsheet.mjs';
import {
  fetchPriorAttempts,
  fetchStrategyEvents,
  formatPriorAttemptsSection,
  ingestAttemptLesson,
  ingestStrategyEvent,
} from './lib/self-learning.mjs';
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
// Domain-specific ONLY as an argument value passed to the generic
// lib/self-learning.mjs functions — those functions never hardcode this
// string themselves (rules/brain-driven-self-improvement.md,
// rules/bench-agi-purity.md).
const SELF_LEARNING_TAG = 'boeing747-actor-attempt';
// Statuses actor-claude.mjs/runActorWithRetries can produce that reflect a
// REAL attempt (as opposed to a pure infra failure never worth learning from
// or counting toward stall/threshold/budget).
const GENUINE_ACTOR_STATUSES = new Set(['edited', 'no_change', 'contract_failed']);

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
// A gemma cross-family CONTESTED flag on an Opus-cleared view must PERSIST across
// this many consecutive iterations before it can BLOCK threshold certification
// (adversarial-review fixes #4/#5: a single-iteration gemma dip is noise relative
// to gemma's own band — it is only a logged soft-flag, never a hard reject).
export const CONTESTED_PERSIST_THRESHOLD = 2;

/**
 * Load the opus-pairwise EDIT-GATE state (the total/per-view of the geometry
 * snapshotted in best-plane.js, the gemma total at that best, and the gemma-
 * downside / gemma-contested persistence streaks). PAIRWISE-ONLY. Fails open to
 * null on any missing file / parse error — a state miss simply re-establishes
 * the baseline from the current geometry.
 */
function loadGateState(claudeDir) {
  const p = path.join(claudeDir, 'gate-state.json');
  try {
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist the edit-gate state (fail-open — a write miss never breaks the loop). */
function saveGateState(claudeDir, state) {
  try {
    writeFileSync(path.join(claudeDir, 'gate-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // fail-open: a state-write miss must not break the bench loop.
  }
}

function loadHistory(actorDir) {
  if (!existsSync(actorDir)) return [];
  return readdirSync(actorDir)
    .filter((f) => /^iter-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(path.join(actorDir, f), 'utf8')))
    .sort((a, b) => a.iter - b.iter);
}

function anchorHint(rubric, weakest) {
  if (!weakest) return null;
  const criterion = rubric.criteria.find((c) => c.id === weakest.id);
  if (!criterion) return null;
  return {
    weakest_feature: weakest.id,
    fix_suggestion:
      `Improve '${criterion.name}' (mean ${weakest.mean}/10). Target the 8 anchor: ` +
      `${criterion.anchors['8']}; then the 10 anchor: ${criterion.anchors['10']}.`,
    source: 'anchor',
  };
}

// --- Plateau -> computed-mesh escalation (AGI-pure, open-track ONLY) --------
// A GENERIC loop-engineering escalation: when the single weakest feature sits
// far below the view target, or has stayed weakest across several primitive
// edits, a parameter tweak is the wrong tool -- the actor is told to change
// strategy and REBUILD that one feature as a computed mesh. It names only the
// strategy and the rubric's own feature id; it seeds NO geometry, coordinates,
// or 747-specific shape -- the actor must derive the profile from the reference
// photos itself. Fires only under the open contract; the frozen track never
// sees it (plateauEscalation stays null), so the frozen number is untouched.
export const MESH_ESCALATION_GAP = 2.0; // a feature > 2/10 below the view target is a structural gap, not a tweakable one

export function meshEscalationStreak(genuineChain, weakestId) {
  if (!weakestId) return 0;
  let streak = 0;
  for (let i = genuineChain.length - 1; i >= 0; i--) {
    if (genuineChain[i]?.weakest_feature?.id !== weakestId) break;
    streak += 1;
  }
  return streak;
}

export function buildMeshEscalation({ weakest, streak, gap, viewThreshold }) {
  const persisted =
    streak >= 2
      ? ` It has stayed the single weakest feature for ${streak} consecutive iterations of primitive edits -- primitive-tweaking has plateaued on it.`
      : '';
  return [
    'PLATEAU ESCALATION (open medium -- change of strategy required):',
    `The weakest feature '${weakest.id}' is at mean ${weakest.mean}/10, ${gap.toFixed(1)} below the ${viewThreshold}/10 view target.${persisted}`,
    'A gap this size is STRUCTURAL, not a parameter you can nudge. STOP adjusting primitive dimensions/positions for this feature.',
    'REBUILD this one feature from scratch as COMPUTED MESH geometry -- a hand-built THREE.BufferGeometry, a THREE.LatheGeometry sweeping a 2-D profile you define, or a THREE.Shape + ExtrudeGeometry (all permitted by the open contract).',
    'Derive the profile/cross-section YOURSELF by inspecting the reference photos for this view -- there are no coordinates in these instructions to copy. A bold re-architecture of THIS feature is expected and will NOT be scored as a regression.',
  ].join('\n');
}

// --- opus-pairwise CERTIFICATION ("100%" definition) -----------------------
// PURE + exported so the certification rule is directly vitest-covered without a
// live judge. A candidate is "100%" ONLY when every one of the 9 views clears
// its per-view CALIBRATED bar (parity >= Bar_v) with NO inconclusive view (a
// coin-flip: pairwise decided_fraction < 0.5) and NO persistently gemma-CONTESTED
// view — NOT total_0_100 == 100. This is stricter than the frozen
// evaluateStopConditions threshold (which only checks score >= bar); the extra
// inconclusive/contested gates close the hollow-100% path (adversarial-review
// fix #1) and add the cross-family veto (fix #4/#5) WITHOUT letting a single
// noisy gemma dip block a clear (it must persist >= contestedPersistThreshold).

const _isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Compute the per-view cleared / inconclusive / gemma-contested flags and the
 * overall certification verdict from ONE iteration's Opus-pairwise per-view
 * scores, the calibrated bars, and the reported gemma cross-family scores.
 *
 * @param {Object} p
 * @param {Array<{view?:number, score:number|null, inconclusive?:boolean}>} p.perView
 *   the Opus-pairwise per-view objects (from judgeShotsPairwise).
 * @param {number|number[]} p.bars   per-view calibrated bar(s) (a scalar broadcasts).
 * @param {Array<number|null>} [p.gemmaCandidatePerView]  reported gemma per-view scores (candidate).
 * @param {Array<number|null>} [p.gemmaReferencePerView]  gemma per-view scores at the reference build (sidecar).
 * @param {number} [p.gemmaVetoBand]  a cleared view is CONTESTED-now when gemmaCand < gemmaRef - band.
 * @param {Array<number>} [p.priorContestedStreaks]  each view's contested streak from the previous iteration.
 * @param {number} [p.contestedPersistThreshold]  streak length a contested flag must reach to BLOCK.
 * @returns {{certified:boolean, allCleared:boolean, clearedViews:number, totalViews:number,
 *   inconclusiveViews:number[], contestedViews:number[], softFlaggedViews:number[],
 *   contestedStreaks:number[], flags:Array<Object>}}
 */
export function certifyPairwiseStop({
  perView = [],
  bars,
  gemmaCandidatePerView = [],
  gemmaReferencePerView = [],
  gemmaVetoBand = 1.0,
  priorContestedStreaks = [],
  contestedPersistThreshold = CONTESTED_PERSIST_THRESHOLD,
} = {}) {
  const views = Array.isArray(perView) ? perView : [];
  const barFor = (i) => (Array.isArray(bars) ? bars[i] : bars);
  const flags = views.map((v, i) => {
    const score = v && _isNum(v.score) ? v.score : null;
    const bar = barFor(i);
    const cleared = _isNum(score) && _isNum(bar) && score >= bar;
    // A view with no finite score, or explicitly flagged inconclusive (pairwise
    // decided_fraction < 0.5), is NOT certifiable — a clear on coin-flips is void.
    const inconclusive = Boolean(v && v.inconclusive) || !_isNum(score);
    const gc = gemmaCandidatePerView[i];
    const gr = gemmaReferencePerView[i];
    // Cross-family CONTESTED (fix #4/#5): only meaningful on an Opus-cleared view,
    // only when BOTH gemma numbers are confidently parsed (fail-open otherwise),
    // and only a downside beyond the veto band counts. It is a SOFT flag that must
    // PERSIST before it blocks — a single-iteration gemma dip never vetoes.
    const contestedNow = cleared && _isNum(gc) && _isNum(gr) && gc < gr - gemmaVetoBand;
    const priorStreak = _isNum(priorContestedStreaks[i]) ? Math.max(0, priorContestedStreaks[i]) : 0;
    const contestedStreak = contestedNow ? priorStreak + 1 : 0;
    const contestedBlocking = contestedStreak >= Math.max(1, contestedPersistThreshold);
    return {
      view: v && _isNum(v.view) ? v.view : i + 1,
      score,
      bar: _isNum(bar) ? bar : null,
      cleared,
      inconclusive,
      contestedNow,
      contestedStreak,
      contestedBlocking,
    };
  });
  const clearedViews = flags.filter((f) => f.cleared).length;
  const inconclusiveViews = flags.filter((f) => f.inconclusive).map((f) => f.view);
  const contestedViews = flags.filter((f) => f.contestedBlocking).map((f) => f.view);
  const softFlaggedViews = flags.filter((f) => f.contestedNow && !f.contestedBlocking).map((f) => f.view);
  const allCleared = flags.length > 0 && flags.every((f) => f.cleared);
  const certified = allCleared && inconclusiveViews.length === 0 && contestedViews.length === 0;
  return {
    certified,
    allCleared,
    clearedViews,
    totalViews: flags.length,
    inconclusiveViews,
    contestedViews,
    softFlaggedViews,
    contestedStreaks: flags.map((f) => f.contestedStreak),
    flags,
  };
}

/**
 * PURE + exported: fold the FROZEN evaluateStopConditions verdict together with
 * the pairwise certification into the loop's actual stop decision. stall/budget
 * reasons stop the loop unchanged; a THRESHOLD reason only stops (and is kept)
 * when the certification passed — otherwise it is DOWNGRADED to a "not certified
 * (continuing)" note naming the blocking views, so a hollow / gemma-contested /
 * coin-flip "all bars met" can never bank a false 100%.
 *
 * When a `confirmed` verdict (certifyPairwiseConfirmed) is supplied — the loop
 * computes it ONLY after a single all-cleared pass, the candidate-100% event — the
 * threshold banks a stop iff the pooled (1 + k_confirm) LCB CONFIRMATION passes
 * (R2/R3): we report the FRESH confirmation verdict at its stated resolution, never
 * the triggering peak. Absent `confirmed`, the legacy single-pass certify gate is
 * used unchanged (byte-identical for every non-confirmed caller/test).
 *
 * @param {{reasons:string[]}} p.claudeStop  the evaluateStopConditions result (calibrated bar).
 * @param {{certified:boolean, allCleared:boolean, inconclusiveViews:number[], contestedViews:number[]}} p.certify
 * @param {Object} [p.confirmed]  certifyPairwiseConfirmed() output (R2/R3/R7); optional.
 * @returns {{stop:boolean, reasons:string[], certified:boolean}}
 */
export function computePairwiseStop({ claudeStop, certify, confirmed }) {
  const reasons = [];
  let stop = false;
  const cert = certify || { certified: false, allCleared: false, inconclusiveViews: [], contestedViews: [] };
  for (const r of (claudeStop && Array.isArray(claudeStop.reasons) ? claudeStop.reasons : [])) {
    if (String(r).startsWith('threshold:')) {
      if (confirmed) {
        // R2/R3: gate the threshold on the CONFIRMATION-set certification (LCB over
        // 1+k_confirm independent passes), never the single-pass peak.
        if (confirmed.certified) {
          reasons.push(
            `${r} — CONFIRMED (worst-view AC LCB ${confirmed.worstViewLCB.toFixed(3)} over ` +
              `${confirmed.passesUsed} independent passes; 100% at resolution ${formatResolution(confirmed.resolution)})`,
          );
          stop = true;
        } else {
          const inc = new Set(confirmed.inconclusiveViews);
          const con = new Set(confirmed.contestedViews);
          const unresolved = confirmed.blockingViews.filter((v) => !inc.has(v) && !con.has(v));
          const blockers = [];
          if (unresolved.length > 0) blockers.push(`views below the LCB floor [${unresolved.join(', ')}]`);
          if (confirmed.inconclusiveViews.length > 0) {
            blockers.push(`inconclusive after e-process [${confirmed.inconclusiveViews.join(', ')}]`);
          }
          if (confirmed.contestedViews.length > 0) {
            blockers.push(`gemma-contested views [${confirmed.contestedViews.join(', ')}]`);
          }
          if (!confirmed.resolution.resolvable) {
            const mde = Number.isFinite(confirmed.resolution.mde) ? confirmed.resolution.mde.toFixed(3) : 'inf';
            blockers.push(`worst-view margin ${confirmed.resolution.worstViewMargin.toFixed(3)} below resolution ${mde}`);
          }
          reasons.push(
            `threshold NOT confirmed over ${confirmed.passesUsed} passes ` +
              `(${blockers.join('; ') || 'confirmation failed'}) — continuing`,
          );
        }
      } else if (cert.certified) {
        reasons.push(r);
        stop = true;
      } else {
        const blockers = [];
        if (!cert.allCleared) blockers.push('not every view cleared its bar');
        if (cert.inconclusiveViews.length > 0) blockers.push(`inconclusive views [${cert.inconclusiveViews.join(', ')}]`);
        if (cert.contestedViews.length > 0) blockers.push(`gemma-contested views [${cert.contestedViews.join(', ')}]`);
        reasons.push(`threshold NOT certified (${blockers.join('; ') || 'certification failed'}) — continuing`);
      }
    } else {
      // stall / budget: a legitimate loop stop regardless of certification.
      reasons.push(r);
      stop = true;
    }
  }
  return { stop, reasons, certified: confirmed ? confirmed.certified : cert.certified };
}

/** Human-readable one-liner for an R7 resolution record (log/report only). */
function formatResolution(res) {
  if (!res) return 'n/a';
  const mde = Number.isFinite(res.mde) ? res.mde.toFixed(3) : 'inf';
  const flip = _isNum(res.flipRate) ? res.flipRate.toFixed(3) : '?';
  return `MDE ${mde} (n=${res.n}, flip~=${flip}, power=${res.power})`;
}

/**
 * PURE + exported: the R2/R3/R7 CONFIRMATION-SET certifier. A single all-cleared
 * pass is a candidate-100% EVENT, not a certified 100% — the loop re-judges the
 * SAME rendered candidate with (1 + k_confirm) INDEPENDENT pairwise passes (fresh
 * Opus order-swaps/seeds) and hands the pooled per-view results here.
 *
 * The rule (all math in lib/certification-stats.mjs; citations in that header):
 *   - Per view, count how many of the n passes CLEARED the calibrated bar (a
 *     null/inconclusive score never counts — a coin-flip clear is void).
 *   - R1 IUT: certify a view on its one-sided AGRESTI-COULL lower bound — no
 *     cross-view Bonferroni; the worst view's LCB is the max-p statistic. A view
 *     whose AC-LCB >= p_floor is certified outright.
 *   - R2: a view whose AC-LCB is below the floor but whose two-sided interval
 *     STILL reaches above it STRADDLES — escalate to the sequential betting
 *     e-process. If E_t reaches 1/alpha it is certified (escalated); otherwise it
 *     is INCONCLUSIVE (never passes on an underpowered coin-flip). A view whose
 *     whole interval sits below the floor is a plain uncleared fail.
 *   - Persistently gemma-CONTESTED views (from the single-pass certify) BLOCK.
 *   - R3: certification is on the LCB, never the raw peak — the loop reports THIS
 *     fresh confirmation verdict, not the triggering peak score.
 *   - R7: attach the paired-test resolution (alpha, power) over the judge flip-
 *     rate noise budget; the worst-view margin above the floor must exceed it, so
 *     a "100%" is reported at a stated resolution rather than bare.
 *
 * NOTE (honest, by design): at the default k_confirm=2 (n=3 total passes) even a
 * unanimous 3/3 sweep sits below the AC-LCB floor (0.47 < 0.5) and the e-process
 * cannot reach 1/alpha, so it reports INCONCLUSIVE and the loop CONTINUES — LCB
 * certification needs roughly five unanimous passes. That underpowered-at-n=3
 * behavior is the intended R3 deflation, not a bug.
 *
 * @param {Object} p
 * @param {Array<Array<{view?:number, score:number|null, inconclusive?:boolean}>>} p.passes
 *   (1 + k_confirm) independent pairwise passes, each a per-view score array.
 * @param {number|number[]} p.bars   per-view calibrated bar(s) (a scalar broadcasts).
 * @param {number[]} [p.contestedViews]  1-based view numbers persistently gemma-contested.
 * @param {number} [p.pFloor]  pass-probability floor (default 0.5).
 * @param {number} [p.alpha]   one-sided level (default 0.05).
 * @param {number} [p.power]   R7 target power (default 0.8).
 * @param {number} [p.flipRate]  measured judge flip rate; omit to estimate from the passes.
 * @returns {{certified:boolean, worstViewLCB:number, worstViewIndex:number|null,
 *   passesUsed:number, totalViews:number, clearedCounts:number[], perView:Array<Object>,
 *   inconclusiveViews:number[], contestedViews:number[], escalatedViews:number[],
 *   blockingViews:number[], resolution:Object}}
 */
export function certifyPairwiseConfirmed({
  passes = [],
  bars,
  contestedViews = [],
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  power = 0.8,
  flipRate,
} = {}) {
  const passList = (Array.isArray(passes) ? passes : []).filter((p) => Array.isArray(p));
  const n = passList.length;
  const nViews = passList.reduce((m, p) => Math.max(m, p.length), 0);
  const barFor = (i) => (Array.isArray(bars) ? bars[i] : bars);
  const contestedSet = new Set(
    (Array.isArray(contestedViews) ? contestedViews : [])
      .map((v) => v - 1)
      .filter((i) => Number.isInteger(i) && i >= 0),
  );

  // Per-view 0/1 "cleared the bar this pass" observations. A null or inconclusive
  // (decided_fraction < 0.5) score is NOT a clear — a clear on coin-flips is void.
  const perViewObs = [];
  for (let i = 0; i < nViews; i++) {
    perViewObs.push(
      passList.map((pass) => {
        const v = pass[i];
        const score = v && _isNum(v.score) ? v.score : null;
        const bar = barFor(i);
        const inconclusive = Boolean(v && v.inconclusive) || !_isNum(score);
        return !inconclusive && _isNum(bar) && score >= bar ? 1 : 0;
      }),
    );
  }
  const clearedCounts = perViewObs.map((obs) => obs.reduce((a, b) => a + b, 0));

  const perView = perViewObs.map((obs, i) => {
    const clearedCount = clearedCounts[i];
    const passRate = n > 0 ? clearedCount / n : 0;
    const lcb = agrestiCoullLCB(clearedCount, n, alpha);
    const interval = agrestiCoullInterval(clearedCount, n, alpha);
    const certifiedByLCB = n > 0 && lcb + 1e-9 >= pFloor;
    let straddles = false;
    let escalated = false;
    let eValue = null;
    let inconclusive = false;
    let cleared = certifiedByLCB;
    if (!certifiedByLCB && n > 0) {
      // AC-LCB below the floor, but the two-sided interval still reaches above it
      // => AMBIGUOUS. Escalate to the e-process instead of rejecting on a small-n
      // bound. If the whole interval sits below the floor it is a plain fail.
      straddles = interval.upper + 1e-9 >= pFloor;
      if (straddles) {
        const ep = eProcess({ observations: obs, pFloor, alpha });
        eValue = ep.eValue;
        if (ep.aboveBar) {
          cleared = true;
          escalated = true;
        } else {
          inconclusive = true;
        }
      }
    }
    const contested = contestedSet.has(i);
    return {
      view: i + 1,
      clearedCount,
      n,
      passRate,
      lcb,
      intervalLower: interval.lower,
      intervalUpper: interval.upper,
      certifiedByLCB,
      straddles,
      escalated,
      eValue,
      inconclusive,
      contested,
      cleared: cleared && !contested,
    };
  });

  // R1 IUT worst-view (max-p) statistic — reused for the reported worst-view LCB /
  // index (contested views flagged so the report matches the block decision).
  const iut = certifyIUT({
    perViewClearedCounts: clearedCounts,
    n,
    pFloor,
    alpha,
    contestedViews: [...contestedSet],
  });

  const inconclusiveViews = perView.filter((v) => v.inconclusive).map((v) => v.view);
  const escalatedViews = perView.filter((v) => v.escalated).map((v) => v.view);
  const contestedOut = perView.filter((v) => v.contested).map((v) => v.view);
  const blockingViews = perView.filter((v) => !v.cleared).map((v) => v.view);

  // R7 resolution + judge flip-rate noise budget. With no supplied flip rate,
  // estimate it EMPIRICALLY from these very draws — the probability two
  // independent Bernoulli(passRate) draws disagree is 2p(1-p), averaged over views
  // (no hardcoded noise number; AGI-pure). The worst view (smallest LCB) sets the
  // margin above the floor a "100%" must resolve.
  const empiricalFlip =
    perView.length > 0
      ? perView.reduce((s, v) => s + 2 * v.passRate * (1 - v.passRate), 0) / perView.length
      : 0;
  const usedFlip = _isNum(flipRate) ? flipRate : empiricalFlip;
  const mde = pairedResolution({ n, alpha, power, flipRate: usedFlip });
  const worstView = iut.worstViewIndex !== null ? perView[iut.worstViewIndex] : null;
  const worstViewPassRate = worstView ? worstView.passRate : 0;
  const worstViewMargin = worstViewPassRate - pFloor;
  const resolvable = Number.isFinite(mde) && worstViewMargin + 1e-9 >= mde;

  const certified = perView.length > 0 && n > 0 && perView.every((v) => v.cleared) && resolvable;

  return {
    certified,
    worstViewLCB: iut.worstViewLCB,
    worstViewIndex: iut.worstViewIndex,
    passesUsed: n,
    totalViews: nViews,
    clearedCounts,
    perView,
    inconclusiveViews,
    contestedViews: contestedOut,
    escalatedViews,
    blockingViews,
    resolution: {
      alpha,
      power,
      n,
      flipRate: usedFlip,
      mde,
      worstViewPassRate,
      worstViewMargin,
      resolvable,
    },
  };
}

function bookkeepTrack({ actorDir, iterNum, runId, judged, judgeTrack, rubric, rubricSha256 }) {
  mkdirSync(actorDir, { recursive: true });
  const bestFile = path.join(actorDir, 'best.json');
  const prevBest = existsSync(bestFile) ? JSON.parse(readFileSync(bestFile, 'utf8')) : null;
  const total = judged.total_0_100;
  const improved = typeof total === 'number' && (!prevBest || total > prevBest.total_0_100);
  const regressed = prevBest !== null && !improved;

  const record = {
    actor: path.basename(actorDir),
    ...(judgeTrack ? { judge_track: judgeTrack } : {}),
    iter: iterNum,
    run_id: runId,
    plane_sha256: judged.plane_sha256,
    rubric_sha256: judged.rubric_sha256 ?? rubricSha256,
    total_0_100: total,
    per_view: judged.per_view.map((v) => ({
      view: v.view,
      key: v.key,
      score: v.score,
      ...(v.notes !== undefined ? { notes: v.notes } : {}),
    })),
    weakest_feature: judged.weakest_feature,
    critic: judged.critic ?? anchorHint(rubric, judged.weakest_feature),
    ...(judged.total_cost_usd !== undefined ? { total_cost_usd: judged.total_cost_usd } : {}),
    regressed,
    best_total_after: improved ? total : prevBest ? prevBest.total_0_100 : total,
    created_at: new Date().toISOString(),
  };
  writeFileSync(path.join(actorDir, `iter-${iterNum}.json`), JSON.stringify(record, null, 2));
  if (improved) {
    writeFileSync(
      bestFile,
      JSON.stringify(
        { iter: iterNum, run_id: runId, plane_sha256: judged.plane_sha256, total_0_100: total, per_view: record.per_view },
        null,
        2,
      ),
    );
  }
  return record;
}

/**
 * Stamp the (by-then-known) actor outcome onto an already-written iter-N.json
 * record, both in-memory (the caller keeps using the returned/mutated object
 * this call) and on disk (so a FUTURE loadHistory() call — i.e. the next
 * iteration, or a resumed run — sees it too). This is the mechanism fix 2
 * relies on: gemmaIterations/claudeIterations are filtered on this field.
 */
function patchActorStatus(actorDir, iterNum, record, actorStatus) {
  record.actor_status = actorStatus;
  writeFileSync(path.join(actorDir, `iter-${iterNum}.json`), JSON.stringify(record, null, 2));
  return record;
}

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
    // Sequential by design (existing discipline): one `terransoul-cli
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

/**
 * Fix 4 (cross-iteration self-learning, read half): fetch prior attempts on
 * THIS weakest feature from the brain and format them into a prompt section.
 * Fails open (fetchPriorAttempts never throws) — a down/unreachable MCP tray
 * simply means no prior-attempts section this iteration.
 */
async function buildPriorAttemptsSection({ weakestId }) {
  const query = `${SELF_LEARNING_TAG} ${weakestId || 'general'}`;
  const priorAttempts = await fetchPriorAttempts({ query, limit: 5 });
  return formatPriorAttemptsSection(priorAttempts);
}

/**
 * Fix 4 (cross-iteration self-learning, write half): a self-improve loop
 * only learns whether iteration N-1's edit helped once iteration N's judge
 * has re-scored the (possibly now-edited) candidate — so this runs at the
 * START of iteration N, right after judging, using the PREVIOUS iteration's
 * recorded actor outcome (iter-{N-1}-actor.json) plus this iteration's fresh
 * scores. Skips silently (no lesson) when there is no previous iteration, or
 * the previous iteration's actor outcome was a pure infra failure (nothing
 * genuine to learn from) — never breaks the bench loop on an MCP error.
 */
async function maybeIngestPriorIterationLesson({ gemmaDir, gemmaHistory, claudeHistory, gemmaRecord, claudeRecord, iterNum, actorName }) {
  if (gemmaHistory.length === 0) return;
  const prevGemma = gemmaHistory[gemmaHistory.length - 1];
  if (!prevGemma || prevGemma.iter !== iterNum - 1) return;
  const prevActorPath = path.join(gemmaDir, `iter-${prevGemma.iter}-actor.json`);
  if (!existsSync(prevActorPath)) return;
  let prevActor;
  try {
    prevActor = JSON.parse(readFileSync(prevActorPath, 'utf8'));
  } catch {
    return;
  }
  if (!GENUINE_ACTOR_STATUSES.has(prevActor.status)) return; // infra exhaustion — nothing to learn

  const prevClaude = claudeHistory[claudeHistory.length - 1];
  const gemmaDelta =
    typeof gemmaRecord.total_0_100 === 'number' && typeof prevGemma.total_0_100 === 'number'
      ? Math.round((gemmaRecord.total_0_100 - prevGemma.total_0_100) * 100) / 100
      : null;
  const claudeDelta =
    prevClaude && typeof claudeRecord.total_0_100 === 'number' && typeof prevClaude.total_0_100 === 'number'
      ? Math.round((claudeRecord.total_0_100 - prevClaude.total_0_100) * 100) / 100
      : null;

  const summary =
    prevActor.status === 'edited'
      ? prevActor.claude_result_text || '(no summary text returned)'
      : prevActor.status === 'contract_failed'
        ? `edit rejected by the frozen contract: ${(prevActor.contract_violations || []).join('; ')}`
        : 'actor made no change to the candidate';

  await ingestAttemptLesson({
    tag: SELF_LEARNING_TAG,
    category: 'self-improve-attempt',
    criterion: prevGemma.weakest_feature?.id,
    summary,
    scoreDeltas: { gemma4: gemmaDelta, [prevClaude?.judge_track || 'claude-vision']: claudeDelta },
    outcome: prevActor.status,
    extraTags: [actorName],
  });
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
}) {
  const { rubric, rubricSha256 } = loadRubric();
  const effPatience = patience || rubric.stall_patience;
  const effBudget = budget || rubric.iteration_budget;
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

  console.log(
    `judge (gemma4${claudeGates ? ', reported diversity cross-check' : ', frozen primary'}): scoring 9 views (median of seeds ${rubric.judge_seeds.join('/')})`,
  );
  const gemmaJudged = await judgeShots({ shotsDir: rig.outDir });
  if (!gemmaJudged) throw new Error('gemma judge did not complete all 9 views');

  console.log(
    `judge (${opusJudgeModel} vision${pairwiseMode ? ' PAIRWISE, gating' : opusPanel ? ' PANEL, gating' : ''}): scoring 9 views (samples=${opusSamples})`,
  );
  // opus-pairwise: BLIND, ORDER-SWAPPED, candidate-vs-cached-reference-BUILD
  // judging (the cached reference shots come from the sidecar; judgeShotsPairwise
  // itself refuses to score against a rig-mismatched stale cache — review fix #6).
  const claudeJudged = pairwiseMode
    ? await judgeShotsPairwise({
        shotsDir: rig.outDir,
        referenceShotsDir: path.resolve(REPO_ROOT, pairwiseCfg.ref_shots_dir),
        samples: opusSamples,
        model: opusJudgeModel,
      })
    : await judgeShotsClaude({
        shotsDir: rig.outDir,
        samples: opusSamples,
        model: opusJudgeModel,
      });
  if (!claudeJudged) throw new Error('claude vision judge did not complete all 9 views');

  let gemmaRecord = bookkeepTrack({
    actorDir: gemmaDir,
    iterNum,
    runId,
    judged: gemmaJudged,
    judgeTrack: undefined,
    rubric,
    rubricSha256,
  });
  let claudeRecord = bookkeepTrack({
    actorDir: claudeDir,
    iterNum,
    runId,
    judged: claudeJudged,
    judgeTrack: claudeJudged.judge_track,
    rubric,
    rubricSha256,
  });

  console.log(
    `ITER ${iterNum} gemma4=${gemmaRecord.total_0_100}/100 (best ${gemmaRecord.best_total_after}) | ` +
      `${claudeJudged.judge_track}=${claudeRecord.total_0_100}/100 (best ${claudeRecord.best_total_after})`,
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
  const bestPlanePath = path.join(claudeDir, 'best-plane.js');
  const rejectedLedgerPath = path.join(claudeDir, 'rejected-edits.json');
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

    const prevGemma = gemmaHistory[gemmaHistory.length - 1];
    const hasPriorIter = Boolean(prevGemma) && prevGemma.iter === iterNum - 1;
    let prevActor = null;
    if (hasPriorIter) {
      const prevActorPath = path.join(gemmaDir, `iter-${prevGemma.iter}-actor.json`);
      if (existsSync(prevActorPath)) {
        try {
          prevActor = JSON.parse(readFileSync(prevActorPath, 'utf8'));
        } catch {
          prevActor = null;
        }
      }
    }
    const canGate = Boolean(gateState) && hasPriorIter && prevActor && GENUINE_ACTOR_STATUSES.has(prevActor.status);

    if (!canGate) {
      // BASELINE: nothing genuine to gate yet — snapshot the current geometry as
      // best so a later backtrack always has a target (EDIT_GATE_SPEC init).
      snapshotBest({ candidatePath: planePath, bestPlanePath });
      gateState = {
        best_total: gateTotal,
        best_per_view: gatePerView,
        best_gemma_total: gemmaTotal,
        gemma_downside_streak: 0,
        contested_streaks: pairwiseCertify.contestedStreaks,
        best_iter: iterNum,
      };
      saveGateState(claudeDir, gateState);
      console.log(`  EDIT-GATE: baseline established (best=${gateTotal}/100 from iter ${iterNum})`);
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
        snapshotBest({ candidatePath: planePath, bestPlanePath });
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
    primaryJudged.weakest_feature?.id || gemmaJudged.weakest_feature?.id || claudeJudged.weakest_feature?.id;
  const priorAttemptsSection = await buildPriorAttemptsSection({ weakestId });

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
      const events = await fetchStrategyEvents({ criterion: weakestId, limit: 20 });
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
  }

  // Plateau -> mesh escalation (open track ONLY). Uses the SAME genuine-iteration
  // filter the stop conditions use, so an infra-failed iteration never counts.
  // Driven by the PRIMARY (gating) judge's weakest feature.
  let plateauEscalation = null;
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
  console.log(
    `actor: driving ${model || DEFAULT_MODEL} (--effort ${effort || DEFAULT_EFFORT}) to edit ${planePath} ` +
      `(retry policy: ${retryCfg.maxRetries} retries, base ${retryCfg.baseTimeoutMs}ms, cap ${retryCfg.timeoutCapMs}ms, source=${retryCfg.source})`,
  );
  const actorResult = await runActorWithRetries({
    retryCfg,
    candidatePath: planePath,
    shotsDir: rig.outDir,
    gemmaResult: gemmaJudged,
    claudeResult: claudeJudged,
    model: model || DEFAULT_MODEL,
    effort: effort || DEFAULT_EFFORT,
    priorAttemptsSection,
    strategyCheatsheetSection,
    badAttemptsSection,
    rejectedEditsSection,
    plateauEscalation,
    cliBinary,
    cliDataDir,
    contractModulePath,
    contractLabel,
  });
  console.log(
    `actor status: ${actorResult.status} (changed=${actorResult.changed}, $${actorResult.cost_usd}, ` +
      `${Math.round(actorResult.ms / 1000)}s, attempts=${actorResult.attempts.length})`,
  );
  if (actorResult.status === 'contract_failed') {
    console.log(`  CONTRACT VIOLATIONS (edit rejected, previous candidate restored):`);
    for (const v of actorResult.contract_violations) console.log(`    - ${v}`);
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
  // Pairwise-only: stamp whether escalation was armed THIS iteration so the NEXT
  // iteration's edit-gate applies the escalation-aggregate exemption to this edit
  // (a bold mesh rebuild is gated on AGGREGATE total, not per-cleared-view dips).
  // Guarded so the frozen/opus-panel actor.json shape stays byte-identical.
  if (pairwiseMode) actorResult.escalation_armed = Boolean(plateauEscalation);
  writeFileSync(path.join(gemmaDir, `iter-${iterNum}-actor.json`), JSON.stringify(actorResult, null, 2));

  // Fix 2: tag both tracks' records with the actor outcome so the stall/
  // threshold/budget counters (evaluateStopConditions, FROZEN) only ever see
  // genuine attempts — an actor_exhausted_retries iteration is excluded from
  // the arrays below, on THIS call and every future loadHistory() call.
  gemmaRecord = patchActorStatus(gemmaDir, iterNum, gemmaRecord, actorResult.status);
  claudeRecord = patchActorStatus(claudeDir, iterNum, claudeRecord, actorResult.status);

  const gemmaIterations = filterGenuineIterationsForStopConditions([...gemmaHistory, gemmaRecord]);
  const claudeIterations = filterGenuineIterationsForStopConditions([...claudeHistory, claudeRecord]);
  // gemma always uses its uniform bar; the Opus track uses the per-view
  // CALIBRATED bar in opus-panel mode (else the same uniform bar).
  const gemmaStopCfg = { viewThreshold: rubric.view_threshold, patience: effPatience, budget: effBudget };
  const claudeStopCfg = { viewThreshold: calibratedBar, patience: effPatience, budget: effBudget };
  const gemmaStop = evaluateStopConditions(gemmaIterations, gemmaStopCfg);
  const claudeStop = evaluateStopConditions(claudeIterations, claudeStopCfg);

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
        ...claudeStop.reasons.map((r) => `${claudeJudged.judge_track}${opusPanel ? ' (gating)' : ''}: ${r}`),
        ...exhaustionReason,
      ],
      gemma: gemmaStop,
      claude: claudeStop,
      actor_exhausted_retries_cap: exhaustionCapped,
    };
  }
  console.log(
    `STOP-CHECK stop=${stop.stop} gemma[nonImproving=${gemmaStop.consecutiveNonImproving}/${effPatience} budget=${gemmaIterations.length}/${effBudget}] ` +
      `${claudeJudged.judge_track}[nonImproving=${claudeStop.consecutiveNonImproving}/${effPatience} budget=${claudeIterations.length}/${effBudget}] ` +
      `exhaustionStreak=${exhaustionStreak}/${retryCfg.exhaustionCap}`,
  );
  for (const reason of stop.reasons) console.log(`  STOP REASON: ${reason}`);

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
}) {
  const { rubric } = loadRubric();
  const effBudget = budget || rubric.iteration_budget;
  const hardCap = maxIter ? Math.min(maxIter, effBudget) : effBudget;
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
    });
    if (last.stop.stop) break;
  }
  return last;
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
        '[--effort max] [--max-iter N] [--max-actor-retries N] [--cli-bin <path>] [--cli-data-dir <dir>] [--contract open|frozen] [--budget N] [--patience N] [--judge gemma|opus-panel|opus-pairwise] [--judge-samples N]',
    );
    process.exit(2);
  }
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
  })
    .then((last) => {
      console.log('\nLOOP DONE');
      if (last) {
        console.log(`final iter=${last.iterNum} gemma4=${last.gemmaRecord.total_0_100}/100 opus/claude-vision=${last.claudeRecord.total_0_100}/100`);
      }
    })
    .catch((err) => {
      console.error(`LOOP_TERRANSOUL_FAIL ${err.message}`);
      process.exit(1);
    });
}
