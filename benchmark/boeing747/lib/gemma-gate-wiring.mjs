// Frozen-gemma-track accept/reject-against-best gate — the I/O orchestration
// half of the fix for a live-measured wander: a run peaked at 50.86/100
// (iter 26) then drifted for 20 more iterations without ever re-finding or
// beating that peak, ending at 40.99 (see rules/completion-log.md's
// BOEING-GEMMA-CLIMB-2026-07-14 entry). bookkeepTrack already stamped
// `regressed`/`best_total_after` on every iteration, but nothing read that
// back into what the loop did next — this closes that gap using the SAME
// mechanism (lib/edit-gate.mjs's decideEditAcceptance/snapshotBest/
// restoreBest/appendRejectedEdit) the opus-pairwise track already had,
// gated on gemma's own total since this track has no second judge to
// cross-check against.
//
// Extracted out of loop-runner-terransoul.mjs (which still holds the
// structurally-identical inline opus-pairwise gate) purely to keep that file
// under the repo's max-lines lint cap. `loadGateState`/`saveGateState`/
// `reportSnapshot`/`resolveUngatedGateState` are INJECTED, not imported —
// they are defined in loop-runner-terransoul.mjs, and importing them here
// while it imports this module's export would be a circular import.
//
// AGI-purity: GENERIC mechanism only, same as edit-gate.mjs. Every value is a
// caller-supplied argument; no Boeing-747 vocabulary in this file's own logic.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../rig/render-rig.mjs';
import { appendRejectedEdit, comparablePerViewDelta, decideEditAcceptance, restoreBest, snapshotBest } from './edit-gate.mjs';

/**
 * Look up the previous iteration's recorded actor attempt (one record
 * regardless of track — iter-N-actor.json always lives under gemmaDir).
 * Shared by both the opus-pairwise gate and the frozen-gemma gate below.
 * @returns {{prevGemma: object|undefined, hasPriorIter: boolean, prevActor: object|null}}
 */
export function resolvePrevActorAttempt({ gemmaDir, gemmaHistory, iterNum }) {
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
  return { prevGemma, hasPriorIter, prevActor };
}

/**
 * Run the gate for ONE iteration and persist the result. Side-effecting
 * (writes gate-state.json / best-plane.js / rejected-edits.json under
 * gemmaDir, logs via console.log) — mirrors the inline opus-pairwise branch.
 *
 * @param {object} p
 * @param {string} p.gemmaDir
 * @param {object} p.gemmaJudged  this iteration's fresh judge result (judge.mjs)
 * @param {object} p.rubric        loaded rubric.json (view_threshold, total_noise_epsilon)
 * @param {object} p.prevGemma     the previous iteration's recorded gemma record
 * @param {object|null} p.prevActor  the previous iteration's recorded actor result
 * @param {boolean} p.hasPriorIter
 * @param {string} p.planePath
 * @param {number} p.iterNum
 * @param {Set<string>} p.genuineActorStatuses
 * @param {(dir:string)=>object|null} p.loadGateState
 * @param {(dir:string, state:object)=>void} p.saveGateState
 * @param {(result:{ok:boolean,error?:string}, iterNum:number)=>object} p.reportSnapshot
 * @param {Function} p.resolveUngatedGateState
 * @returns {{gateState: object}}
 */
export function runFrozenGemmaGate({
  gemmaDir,
  gemmaJudged,
  rubric,
  prevGemma,
  prevActor,
  hasPriorIter,
  planePath,
  iterNum,
  genuineActorStatuses,
  loadGateState,
  saveGateState,
  reportSnapshot,
  resolveUngatedGateState,
}) {
  const bestPlanePath = path.join(gemmaDir, 'best-plane.js');
  const rejectedLedgerPath = path.join(gemmaDir, 'rejected-edits.json');
  let gateState = loadGateState(gemmaDir);
  const gatePerView = gemmaJudged.per_view.map((v) => v.score);
  const gateTotal = gemmaJudged.total_0_100;
  const uniformBar = Array(gatePerView.length).fill(rubric.view_threshold);

  const canGate = Boolean(gateState) && hasPriorIter && prevActor && genuineActorStatuses.has(prevActor.status);

  if (!canGate) {
    const resolved = resolveUngatedGateState({
      gateState,
      gateTotal,
      gatePerView,
      gemmaTotal: undefined,
      contestedStreaks: [],
      iterNum,
    });
    gateState = resolved.state;
    if (resolved.action === 'baseline') {
      reportSnapshot(snapshotBest({ candidatePath: planePath, bestPlanePath }), iterNum);
      console.log(`  EDIT-GATE (gemma): baseline established (best=${gateTotal}/100 from iter ${iterNum})`);
    } else {
      console.log(
        `  EDIT-GATE (gemma): cannot gate this iter (no genuine prior actor) — HOLDING best=${gateState.best_total}/100 ` +
          `from iter ${gateState.best_iter} (this iter scored ${gateTotal}/100)`,
      );
    }
    saveGateState(gemmaDir, gateState);
    return { gateState };
  }

  // Captured BEFORE any mutation below — a like-for-like comparison against
  // the incumbent's own per-view scores, pairing only indices where BOTH
  // sides are scored (a view going null is not evidence of regression; see
  // comparablePerViewDelta's doc comment).
  const cmp = comparablePerViewDelta(gatePerView, gateState.best_per_view);
  const decision = decideEditAcceptance({
    gateTotal,
    gatePerView,
    bestTotal: gateState.best_total,
    bestPerView: gateState.best_per_view,
    clearedViewsBar: uniformBar,
    epsilonTotal: rubric.total_noise_epsilon ?? 0,
    escalationArmed: Boolean(prevActor.escalation_armed),
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

  if (decision.decision === 'accept') {
    reportSnapshot(snapshotBest({ candidatePath: planePath, bestPlanePath }), iterNum);
    gateState.best_total = gateTotal;
    gateState.best_per_view = gatePerView;
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
        reason: decision.reason,
        created_at: new Date().toISOString(),
      },
    });
    // Backtrack: restore the candidate to the best geometry so iteration N's
    // actor edits from best, not from the regression.
    restoreBest({ bestPlanePath, candidatePath: planePath });
  }
  // within_noise: keep the working file (exploration), do NOT advance best.

  saveGateState(gemmaDir, gateState);
  console.log(
    `  EDIT-GATE (gemma) iter ${prevGemma.iter}: ${decision.decision} — ${decision.reason}` +
      (cmp.comparableViews > 0
        ? ` [like-for-like over ${cmp.comparableViews} comparable views vs incumbent: delta=${cmp.delta}${cmp.insufficient ? ', insufficient-views' : ''}]`
        : ''),
  );

  return { gateState };
}
