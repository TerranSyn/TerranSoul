// Tests for the PURE opus-pairwise BEST-OF-N plateau-breaking orchestration wired
// into loop-runner-terransoul.mjs (STEP 2 — LOOP WIRING, gated behind --best-of-n N;
// default 0 = OFF = byte-identical single-edit behavior):
//   - buildBestOfNDiversityInstruction: the GENERIC, AGI-pure "propose a
//     STRUCTURALLY DIFFERENT fix" directive (no seeded coordinates/geometry).
//   - planBestOfNBudget: whether best-of-N fires (worst view sub-bar AND plateaued)
//     and how the N-budget (capped at BEST_OF_N_CAP) is sized per stuck view.
//   - runBestOfNCandidates: fork N fresh copies, actor-edit + judge each, SELECT the
//     worst-view-LCB winner — driven entirely by a MOCKED copy/actor/judge.
//   - decideBestOfNPromotion: promote ONLY under the edit-gate (no total regression)
//     AND the reward-hack guardrail (an independent held-out re-judge tracks it).
//   - runBestOfNActorStep: the full actor step (promote vs keep-best/backtrack),
//     again with every side-effecting seam MOCKED — no rig, no CLI, no GPU, no fs.
//
// COVERAGE MODEL: a MOCKED runActorEdit + judge are just the shaped objects/promises
// the seams return; the real candidate file is only ever written by the injected
// promoteFn, so a non-promotion leaves it untouched (keep-best/backtrack is automatic).
import { describe, expect, it, vi } from 'vitest';
import {
  BEST_OF_N_CAP,
  buildBestOfNDiversityInstruction,
  decideBestOfNPromotion,
  planBestOfNBudget,
  runBestOfNActorStep,
  runBestOfNCandidates,
} from './lib/best-of-n-orchestrate.mjs';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Three per-view {view, score} records. */
const mk = (a, b, c) => [
  { view: 1, score: a },
  { view: 2, score: b },
  { view: 3, score: c },
];

describe('buildBestOfNDiversityInstruction — generic, AGI-pure, structurally-different', () => {
  it('names the feature + candidate index and demands a distinct re-architecture', () => {
    const txt = buildBestOfNDiversityInstruction({
      worstFeatureId: 'nose_taper',
      worstView: 3,
      slotIndex: 1,
      totalSlots: 3,
    });
    expect(txt).toMatch(/candidate 2 of 3/);
    expect(txt).toMatch(/STRUCTURALLY DIFFERENT/);
    expect(txt).toMatch(/RE-ARCHITECTURE/);
    expect(txt).toMatch(/nose_taper/);
    // Diversity across siblings so the set is not near-duplicates.
    expect(txt).toMatch(/sibling/i);
  });

  it('seeds NO coordinates / geometry / answer-derived constants (AGI purity)', () => {
    const txt = buildBestOfNDiversityInstruction({ worstFeatureId: 'x', worstView: 1, slotIndex: 0, totalSlots: 2 });
    // No numeric coordinate triples, no THREE.* class names, no explicit dimensions.
    expect(txt).not.toMatch(/-?\d+\.\d+\s*,\s*-?\d+\.\d+/);
    expect(txt).not.toMatch(/THREE\./);
    expect(txt).toMatch(/Derive every dimension YOURSELF/);
  });

  it('falls back to a view label when no feature id is given', () => {
    expect(buildBestOfNDiversityInstruction({ worstView: 7 })).toMatch(/view 7/);
    expect(buildBestOfNDiversityInstruction({})).toMatch(/plateaued weakest feature/);
  });
});

describe('planBestOfNBudget — #2 trigger + difficulty-aware sizing', () => {
  const history = [mk(8, 8, 4), mk(8, 8, 4)];
  const latest = mk(8, 8, 4);

  it('is OFF (not triggered) when totalN is 0 — documents the byte-identical default', () => {
    const plan = planBestOfNBudget({ perViewHistory: history, bars: 5, latestPerView: latest, totalN: 0 });
    expect(plan.triggered).toBe(false);
    expect(plan.perView).toEqual([]);
  });

  it('fires when the worst view is sub-bar AND has plateaued, routing the budget to it', () => {
    const plan = planBestOfNBudget({ perViewHistory: history, bars: 5, latestPerView: latest, totalN: 3, patience: 2 });
    expect(plan.triggered).toBe(true);
    expect(plan.worstView).toBe(3);
    expect(plan.plateauViews).toEqual([3]);
    expect(plan.perView).toEqual([{ view: 3, n: 3 }]);
  });

  it('does NOT fire when the weakest view is still IMPROVING (no plateau)', () => {
    const improving = [mk(8, 8, 3), mk(8, 8, 4)];
    const plan = planBestOfNBudget({
      perViewHistory: improving,
      bars: 5,
      latestPerView: mk(8, 8, 4),
      totalN: 3,
      patience: 2,
    });
    expect(plan.triggered).toBe(false);
    expect(plan.plateauViews).toEqual([]);
  });

  it('does NOT fire when the plateaued worst view already CLEARS its bar', () => {
    // View 3 is weakest + flat, but 6 >= bar 5 => nothing to break.
    const plan = planBestOfNBudget({
      perViewHistory: [mk(8, 8, 6), mk(8, 8, 6)],
      bars: 5,
      latestPerView: mk(8, 8, 6),
      totalN: 3,
      patience: 2,
    });
    expect(plan.triggered).toBe(false);
  });

  it('clamps the requested N to BEST_OF_N_CAP', () => {
    const plan = planBestOfNBudget({
      perViewHistory: history,
      bars: 5,
      latestPerView: latest,
      totalN: 99,
      patience: 2,
    });
    expect(plan.totalN).toBe(BEST_OF_N_CAP);
    expect(plan.perView.reduce((s, a) => s + a.n, 0)).toBe(BEST_OF_N_CAP);
  });

  it('honors a per-view calibrated bar ARRAY (only the sub-bar plateaued view arms)', () => {
    // Bars array: view 3's bar is 3 => its flat 4 CLEARS it => no trigger.
    const plan = planBestOfNBudget({
      perViewHistory: history,
      bars: [9, 9, 3],
      latestPerView: latest,
      totalN: 2,
      patience: 2,
    });
    expect(plan.triggered).toBe(false);
  });
});

describe('runBestOfNCandidates — #1 fork N copies, select the worst-view-LCB winner', () => {
  const plan = { perView: [{ view: 3, n: 2 }] };
  const bars = 5;

  function seams({ slot0View3 = 4, slot1View3 = 6 } = {}) {
    const copyCalls = [];
    const actorCalls = [];
    const copyCandidate = vi.fn(async (src, dest, slot) => {
      copyCalls.push({ src, dest, slot });
    });
    const tempPathFor = (slot) => `/tmp/bestofn/slot-${slot}/plane.js`;
    const runActorFn = vi.fn(async ({ candidatePath, plateauEscalation, targetView, slot }) => {
      actorCalls.push({ candidatePath, plateauEscalation, targetView, slot });
      return { status: 'edited', changed: true, cost_usd: 0.1, claude_result_text: `edit ${slot}` };
    });
    const renderJudgeFn = vi.fn(async ({ slot }) =>
      slot === 0
        ? { per_view: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: slot0View3 }], total_0_100: 53 }
        : { per_view: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: slot1View3 }], total_0_100: 60 },
    );
    return { copyCalls, actorCalls, copyCandidate, tempPathFor, runActorFn, renderJudgeFn };
  }

  it('picks the candidate whose worst view clears the bar (not the higher-mean one)', async () => {
    const s = seams(); // slot0 view3=4 (sub-bar), slot1 view3=6 (clears)
    const orch = await runBestOfNCandidates({
      plan,
      candidatePath: 'cand.js',
      bars,
      worstFeatureId: 'nose_taper',
      copyCandidate: s.copyCandidate,
      tempPathFor: s.tempPathFor,
      runActorFn: s.runActorFn,
      renderJudgeFn: s.renderJudgeFn,
    });
    expect(orch.winnerIndex).toBe(1);
    expect(orch.winner.slot).toBe(1);
    expect(orch.winner.dest).toBe('/tmp/bestofn/slot-1/plane.js');
    // slot0's worst view failed => worst-view LCB 0; slot1 cleared => > 0.
    expect(orch.selection.ranked.find((r) => r.index === 0).worstViewLCB).toBe(0);
    expect(orch.selection.ranked.find((r) => r.index === 1).worstViewLCB).toBeGreaterThan(0);
  });

  it('forks a FRESH copy per slot and injects a DISTINCT diversity directive', async () => {
    const s = seams();
    await runBestOfNCandidates({
      plan,
      candidatePath: 'cand.js',
      bars,
      worstFeatureId: 'nose_taper',
      copyCandidate: s.copyCandidate,
      tempPathFor: s.tempPathFor,
      runActorFn: s.runActorFn,
      renderJudgeFn: s.renderJudgeFn,
    });
    expect(s.copyCalls.map((c) => c.dest)).toEqual([
      '/tmp/bestofn/slot-0/plane.js',
      '/tmp/bestofn/slot-1/plane.js',
    ]);
    // Each actor edit ran on its OWN copy (never the shared candidate).
    expect(s.actorCalls.map((c) => c.candidatePath)).toEqual([
      '/tmp/bestofn/slot-0/plane.js',
      '/tmp/bestofn/slot-1/plane.js',
    ]);
    // The structurally-different directive is passed through, labeled per candidate.
    expect(s.actorCalls[0].plateauEscalation).toMatch(/candidate 1 of 2/);
    expect(s.actorCalls[1].plateauEscalation).toMatch(/candidate 2 of 2/);
    expect(s.actorCalls[0].plateauEscalation).toMatch(/STRUCTURALLY DIFFERENT/);
  });
});

describe('decideBestOfNPromotion — #1 edit-gate + #8 reward-hack guardrail', () => {
  const selection = { index: 1 };

  it('promotes when there is no total regression AND the held-out tracks the optimised score', () => {
    const d = decideBestOfNPromotion({
      selection,
      winnerJudgedTotal: 60,
      bestTotal: 55,
      winnerWorstViewScore: 6,
      winnerHeldOutScore: 6, // tracks: held-out delta == judged delta from baseline
      baselineWorstViewScore: 4,
    });
    expect(d.promote).toBe(true);
    expect(d.regressed).toBe(false);
    expect(d.diverged).toBe(false);
    expect(near(d.totalDelta, 5)).toBe(true);
  });

  it('BLOCKS a winner that regresses the gating total beyond epsilon (keep best)', () => {
    const d = decideBestOfNPromotion({
      selection,
      winnerJudgedTotal: 60,
      bestTotal: 70,
      epsilonTotal: 2,
      winnerWorstViewScore: 6,
      winnerHeldOutScore: 6,
      baselineWorstViewScore: 4,
    });
    expect(d.promote).toBe(false);
    expect(d.regressed).toBe(true);
    expect(d.reason).toMatch(/regress/i);
  });

  it('a regression WITHIN epsilon is not a regression', () => {
    const d = decideBestOfNPromotion({
      selection,
      winnerJudgedTotal: 60,
      bestTotal: 61,
      epsilonTotal: 2, // 60 >= 61 - 2 => not regressed
      winnerWorstViewScore: 6,
      winnerHeldOutScore: 6,
      baselineWorstViewScore: 4,
    });
    expect(d.regressed).toBe(false);
    expect(d.promote).toBe(true);
  });

  it('BLOCKS on reward-hack divergence: optimised worst-view up but held-out flat', () => {
    const d = decideBestOfNPromotion({
      selection,
      winnerJudgedTotal: 60,
      bestTotal: 55,
      winnerWorstViewScore: 6, // judged improved +2 from baseline
      winnerHeldOutScore: 4, // held-out did NOT move
      baselineWorstViewScore: 4,
      divergenceThreshold: 0,
    });
    expect(d.promote).toBe(false);
    expect(d.diverged).toBe(true);
    expect(d.reason).toMatch(/reward-hack/i);
  });

  it('returns promote:false with no viable candidate (index -1)', () => {
    const d = decideBestOfNPromotion({ selection: { index: -1 }, winnerJudgedTotal: 60, bestTotal: 10 });
    expect(d.promote).toBe(false);
    expect(d.reason).toMatch(/no viable candidate/i);
  });
});

describe('runBestOfNActorStep — full step: promote vs keep-best/backtrack (all seams mocked)', () => {
  const plan = { triggered: true, worstView: 3, plateauViews: [3], perView: [{ view: 3, n: 2 }] };

  function stepSeams({ heldOut = 6 } = {}) {
    const promoteFn = vi.fn(async () => {});
    const copyCandidate = vi.fn(async () => {});
    const runActorFn = vi.fn(async ({ slot }) => ({
      status: 'edited',
      changed: true,
      cost_usd: 0.2,
      claude_result_text: `edit ${slot}`,
      observability: { total_tool_calls: 3 },
    }));
    const renderJudgeFn = vi.fn(async ({ slot }) =>
      slot === 0
        ? { per_view: mk(6, 6, 4), total_0_100: 53, shotsDir: `/shots/${slot}` }
        : { per_view: mk(6, 6, 6), total_0_100: 60, shotsDir: `/shots/${slot}` },
    );
    const heldOutJudgeFn = vi.fn(async () => heldOut);
    return { promoteFn, copyCandidate, runActorFn, renderJudgeFn, heldOutJudgeFn };
  }

  const baseArgs = (s) => ({
    plan,
    candidatePath: 'cand.js',
    bars: 5,
    worstFeatureId: 'nose_taper',
    baselineWorstViewScore: 4,
    copyCandidate: s.copyCandidate,
    tempPathFor: (slot) => `/tmp/slot-${slot}.js`,
    runActorFn: s.runActorFn,
    renderJudgeFn: s.renderJudgeFn,
    heldOutJudgeFn: s.heldOutJudgeFn,
    promoteFn: s.promoteFn,
  });

  it('PROMOTES the winner when the gate + guardrail pass (writes the real candidate)', async () => {
    const s = stepSeams({ heldOut: 6 }); // held-out tracks winner worst-view 6
    const { actorResult, info } = await runBestOfNActorStep({ ...baseArgs(s), bestTotal: 55 });
    expect(info.promoted).toBe(true);
    expect(actorResult.status).toBe('edited');
    expect(actorResult.changed).toBe(true);
    expect(s.promoteFn).toHaveBeenCalledTimes(1);
    expect(s.promoteFn).toHaveBeenCalledWith('/tmp/slot-1.js'); // the winning copy
    expect(info.selection_index).toBe(1);
    expect(actorResult.attempts).toHaveLength(2);
    // Aggregated cost across the two sampled candidate edits.
    expect(near(actorResult.cost_usd, 0.4)).toBe(true);
  });

  it('KEEPS BEST (no promote, candidate untouched) when the winner regresses the total', async () => {
    const s = stepSeams({ heldOut: 6 });
    const { actorResult, info } = await runBestOfNActorStep({ ...baseArgs(s), bestTotal: 90 });
    expect(info.promoted).toBe(false);
    expect(info.regressed).toBe(true);
    expect(actorResult.status).toBe('no_change');
    expect(actorResult.changed).toBe(false);
    expect(s.promoteFn).not.toHaveBeenCalled(); // real candidate file never written => backtrack
  });

  it('REFUSES the winner on reward-hack divergence (held-out did not track)', async () => {
    const s = stepSeams({ heldOut: 4 }); // winner worst-view judged 6 but held-out re-judge 4
    const { actorResult, info } = await runBestOfNActorStep({ ...baseArgs(s), bestTotal: 55 });
    expect(info.promoted).toBe(false);
    expect(info.diverged).toBe(true);
    expect(actorResult.status).toBe('no_change');
    expect(s.promoteFn).not.toHaveBeenCalled();
  });
});
