// opus-pairwise EDIT-GATE state IO + the ungated-iteration resolution rule,
// extracted VERBATIM from loop-runner-terransoul.mjs (max-lines refactor,
// 2026-07-18). resolveUngatedGateState is re-exported by the runner so
// loop-runner-record.test.mjs's import against './loop-runner-terransoul.mjs'
// is unchanged. Only the module-local imports and `export` keywords were
// added by the move — no logic changed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _isNum } from './pairwise-certify.mjs';
import { SCORING_VERSION } from './scoring.mjs';

/**
 * Load the opus-pairwise EDIT-GATE state (the total/per-view of the geometry
 * snapshotted in best-plane.js, the gemma total at that best, and the gemma-
 * downside / gemma-contested persistence streaks). PAIRWISE-ONLY. Fails open to
 * null on any missing file / parse error — a state miss simply re-establishes
 * the baseline from the current geometry.
 */
export function loadGateState(claudeDir) {
  const p = path.join(claudeDir, 'gate-state.json');
  try {
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * snapshotBest fails open and returns { ok:false, error } rather than throwing, so the
 * bench loop cannot die on a copy error. Both call sites used to DISCARD that result,
 * which made a failed snapshot indistinguishable from a successful one — and a silent
 * miss leaves best-plane.js holding geometry that was never rendered or judged, which
 * is precisely the state the corrupted run was found in (its best-plane.js sha matched
 * none of the 55 recorded shots across every track). Fail open, but say so.
 */
export function reportSnapshot(result, iterNum) {
  if (result && result.ok === false) {
    console.log(`  WARNING: best-plane snapshot FAILED at iter ${iterNum}: ${result.error} — the backtrack anchor is now stale`);
  }
  return result;
}

/**
 * What to do with gate-state when this iteration CANNOT be gated.
 *
 * `canGate` is false whenever the previous iteration produced no genuine actor attempt:
 * the actor exhausted its retries, the run was resumed so the iterations are not
 * contiguous, or an actor record is missing. None of those says anything about whether
 * the CURRENT geometry is good.
 *
 * The bug this replaces: the branch re-baselined unconditionally, overwriting best_total
 * with the current iteration's score and taking a fresh snapshot, with no comparison
 * against the best it already held. On run bjke07o2u, iter-9's actor exhausted its
 * retries, so iter-10 took this branch and a 56.49 replaced a 59.39 best. gate-state is
 * the acceptance baseline, the backtrack target and the best-of-N promotion floor, so a
 * downward leak lowers the bar for every subsequent iteration and un-protects the
 * per-view bars already cleared.
 *
 * Baseline only when there is genuinely no best to protect; otherwise HOLD.
 * @returns {{action:'baseline'|'hold', state:object}}
 */
export function resolveUngatedGateState({ gateState, gateTotal, gatePerView, gemmaTotal, contestedStreaks, iterNum }) {
  const haveBest = Boolean(gateState) && _isNum(gateState.best_total);
  if (!haveBest) {
    return {
      action: 'baseline',
      state: {
        best_total: gateTotal,
        best_per_view: gatePerView,
        best_gemma_total: gemmaTotal,
        gemma_downside_streak: 0,
        contested_streaks: contestedStreaks,
        best_iter: iterNum,
      },
    };
  }
  // hold every best_* field; only the streaks are iteration-local bookkeeping
  return { action: 'hold', state: { ...gateState, contested_streaks: contestedStreaks } };
}

/** Persist the edit-gate state (fail-open — a write miss never breaks the loop).
 * Every save stamps the CURRENT scoring_version so assertGateStateEra can
 * refuse a cross-era resume (adversarial-review fix 2026-07-16). */
export function saveGateState(claudeDir, state) {
  try {
    writeFileSync(
      path.join(claudeDir, 'gate-state.json'),
      `${JSON.stringify({ ...state, scoring_version: SCORING_VERSION }, null, 2)}\n`,
    );
  } catch {
    // fail-open: a state-write miss must not break the bench loop.
  }
}
