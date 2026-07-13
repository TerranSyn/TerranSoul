import { describe, expect, it } from 'vitest';
import {
  allocateBudget,
  detectPlateau,
  rewardHackDivergence,
  selectBestCandidate,
} from './best-of-n.mjs';
import { agrestiCoullLCB } from './certification-stats.mjs';

// Every rule below is PURE — plain numbers in, no rig, no CLI, no filesystem, no
// GPU, no network. A MOCKED judge/actor is just the shaped objects we hand in.

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('selectBestCandidate — #1 worst-view LCB, not the mean', () => {
  const bars = [5, 5, 5];

  it('picks the candidate with the best WORST-view LCB even when another has a higher mean', () => {
    const candidates = [
      // A: high mean (7.33) but view-3 is sub-bar => worst-view LCB collapses.
      { perView: [{ view: 1, score: 9 }, { view: 2, score: 9 }, { view: 3, score: 4 }] },
      // B: lower mean (6.0) but ALL views clear the bar => strong worst-view LCB.
      { perView: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: 6 }] },
    ];
    const res = selectBestCandidate({ candidates, bars });
    expect(res.index).toBe(1);
    // B's worst view cleared (1/1) => AC-LCB(1,1); A's worst view failed => 0.
    expect(near(res.worstViewLCB, agrestiCoullLCB(1, 1, 0.05))).toBe(true);
    expect(res.ranked[res.ranked.length - 1].index).toBe(0);
    expect(res.ranked[res.ranked.length - 1].worstViewLCB).toBe(0);
  });

  it('uses RICH clearedCount/samples for a graded, tighter worst-view LCB', () => {
    const candidates = [
      // A worst view: 4/5 cleared. B worst view: 5/5 cleared (higher LCB) but a
      // lower mean elsewhere. Selection must follow the worst-view LCB, not mean.
      {
        perView: [
          { view: 1, clearedCount: 5, samples: 5 },
          { view: 2, clearedCount: 5, samples: 5 },
          { view: 3, clearedCount: 4, samples: 5 },
        ],
      },
      {
        perView: [
          { view: 1, clearedCount: 5, samples: 5 },
          { view: 2, clearedCount: 5, samples: 5 },
          { view: 3, clearedCount: 5, samples: 5 },
        ],
      },
    ];
    const res = selectBestCandidate({ candidates, bars });
    expect(res.index).toBe(1);
    expect(near(res.worstViewLCB, agrestiCoullLCB(5, 5, 0.05))).toBe(true);
    expect(res.ranked[0].worstViewLCB).toBeGreaterThan(res.ranked[1].worstViewLCB);
  });

  it('treats an inconclusive (pairwise coin-flip) view as NOT cleared', () => {
    const candidates = [
      { perView: [{ view: 1, score: 9 }, { view: 2, score: 9, inconclusive: true }] },
      { perView: [{ view: 1, score: 6 }, { view: 2, score: 6 }] },
    ];
    const res = selectBestCandidate({ candidates, bars: 5 });
    // Candidate 0's view-2 is inconclusive => worst-view LCB 0; candidate 1 clears both.
    expect(res.index).toBe(1);
    expect(res.ranked.find((r) => r.index === 0).worstViewLCB).toBe(0);
  });

  it('returns an empty selection for no candidates', () => {
    const res = selectBestCandidate({ candidates: [], bars: 5 });
    expect(res.index).toBe(-1);
    expect(res.ranked).toEqual([]);
  });
});

describe('selectBestCandidate — caution down-weights an OOD outlier', () => {
  const bars = [5, 5, 5];
  // Three candidates that ALL clear every bar => identical worst-view LCB, so the
  // caution penalty is the only tiebreaker. Two are typical; one is an outlier whose
  // per-view profile deviates far from the per-view median.
  const candidates = [
    { perView: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: 6 }] },
    { perView: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: 6 }] },
    { perView: [{ view: 1, score: 10 }, { view: 2, score: 9 }, { view: 3, score: 10 }] },
  ];

  it('with cautionWeight=0 the outlier is NOT penalised (pure LCB, index tiebreak)', () => {
    const res = selectBestCandidate({ candidates, bars, cautionWeight: 0 });
    expect(res.cautionPenalty).toBe(0);
    // All equal worst-view LCB and zero caution => deterministic lowest index wins.
    expect(res.index).toBe(0);
  });

  it('with cautionWeight>0 the outlier candidate is ranked LAST', () => {
    const res = selectBestCandidate({ candidates, bars, cautionWeight: 1 });
    // Outlier (index 2) has the largest mean-abs-deviation from the per-view median.
    const outlier = res.ranked.find((r) => r.index === 2);
    expect(outlier.cautionPenalty).toBeGreaterThan(0);
    expect(res.ranked[res.ranked.length - 1].index).toBe(2);
    // A non-outlier is selected, and its worst-view LCB is unchanged by caution.
    expect(res.index).not.toBe(2);
  });

  it('caution can flip the pick when two candidates have equal worst-view LCB', () => {
    // Both clear all bars (equal LCB); candidate 1 is the outlier vs the set.
    const two = [
      { perView: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: 6 }] },
      { perView: [{ view: 1, score: 10 }, { view: 2, score: 6 }, { view: 3, score: 6 }] },
      { perView: [{ view: 1, score: 6 }, { view: 2, score: 6 }, { view: 3, score: 6 }] },
    ];
    const res = selectBestCandidate({ candidates: two, bars, cautionWeight: 1 });
    expect(res.index).not.toBe(1);
    expect(res.ranked.find((r) => r.index === 1).cautionPenalty).toBeGreaterThan(0);
  });
});

describe('allocateBudget — #2 favors the largest gap / slowest view', () => {
  it('routes most of the budget to the largest-gap arm', () => {
    const viewGaps = [
      { view: 1, gap: 5, improveRate: 0 },
      { view: 2, gap: 1, improveRate: 0 },
      { view: 3, gap: 1, improveRate: 0 },
    ];
    const alloc = allocateBudget({ viewGaps, totalN: 6, minPerView: 1 });
    const total = alloc.reduce((a, b) => a + b.n, 0);
    expect(total).toBe(6);
    const byView = Object.fromEntries(alloc.map((a) => [a.view, a.n]));
    expect(byView[1]).toBeGreaterThan(byView[2]);
    expect(byView[1]).toBeGreaterThan(byView[3]);
    // minPerView honored.
    expect(byView[2]).toBeGreaterThanOrEqual(1);
    expect(byView[3]).toBeGreaterThanOrEqual(1);
  });

  it('discounts a FAST-improving view in favor of an equal-gap slow one', () => {
    const viewGaps = [
      { view: 1, gap: 4, improveRate: 3 }, // closing on its own
      { view: 2, gap: 4, improveRate: 0 }, // stuck
    ];
    const alloc = allocateBudget({ viewGaps, totalN: 8, minPerView: 0 });
    const byView = Object.fromEntries(alloc.map((a) => [a.view, a.n]));
    expect(byView[2]).toBeGreaterThan(byView[1]);
    expect(byView[1] + byView[2]).toBe(8);
  });

  it('falls back to a round-robin split when there is no gap signal', () => {
    const viewGaps = [{ view: 1, gap: 0 }, { view: 2, gap: 0 }, { view: 3, gap: 0 }];
    const alloc = allocateBudget({ viewGaps, totalN: 3, minPerView: 0 });
    expect(alloc.map((a) => a.n)).toEqual([1, 1, 1]);
  });

  it('never exceeds the budget when minPerView is larger than the even share', () => {
    const viewGaps = [{ view: 1, gap: 3 }, { view: 2, gap: 1 }];
    const alloc = allocateBudget({ viewGaps, totalN: 2, minPerView: 5 });
    expect(alloc.reduce((a, b) => a + b.n, 0)).toBe(2);
  });

  it('returns zero allocation for a zero/absent budget, and [] for no arms', () => {
    const alloc = allocateBudget({ viewGaps: [{ view: 1, gap: 5 }], totalN: 0 });
    expect(alloc).toEqual([{ view: 1, n: 0 }]);
    expect(allocateBudget({ viewGaps: [], totalN: 5 })).toEqual([]);
  });
});

describe('detectPlateau — same weakest + non-improving over patience', () => {
  const mk = (s1, s2, s3) => [{ view: 1, score: s1 }, { view: 2, score: s2 }, { view: 3, score: s3 }];

  it('flags a view that stays the weakest and flat for >= patience iters', () => {
    const history = [mk(8, 8, 4), mk(8, 8, 4), mk(8, 8, 4)];
    expect(detectPlateau({ perViewHistory: history, viewId: 3, patience: 3 })).toBe(true);
  });

  it('does NOT flag a weakest view that is still improving', () => {
    const history = [mk(8, 8, 3), mk(8, 8, 4), mk(8, 8, 5)];
    expect(detectPlateau({ perViewHistory: history, viewId: 3, patience: 3 })).toBe(false);
  });

  it('does NOT flag when the view was not the weakest throughout the window', () => {
    const history = [mk(4, 8, 8), mk(8, 8, 4), mk(8, 8, 4)];
    expect(detectPlateau({ perViewHistory: history, viewId: 3, patience: 3 })).toBe(false);
  });

  it('returns false when history is shorter than patience', () => {
    const history = [mk(8, 8, 4), mk(8, 8, 4)];
    expect(detectPlateau({ perViewHistory: history, viewId: 3, patience: 3 })).toBe(false);
  });

  it('uses only the last `patience` iters (an earlier improvement does not save it)', () => {
    const history = [mk(8, 8, 1), mk(8, 8, 4), mk(8, 8, 4)];
    expect(detectPlateau({ perViewHistory: history, viewId: 3, patience: 2 })).toBe(true);
  });
});

describe('rewardHackDivergence — #8 judged up but held-out flat', () => {
  it('flags divergence when judged improves and held-out does not track', () => {
    const r = rewardHackDivergence({
      selectedJudgedScore: 8,
      heldOutScore: 5,
      prevSelectedJudged: 6,
      prevHeldOut: 5,
      threshold: 1,
    });
    expect(r.diverged).toBe(true);
    expect(near(r.judgedDelta, 2)).toBe(true);
    expect(near(r.heldOutDelta, 0)).toBe(true);
    expect(near(r.delta, 2)).toBe(true);
  });

  it('does NOT flag when the held-out signal tracks the judged improvement', () => {
    const r = rewardHackDivergence({
      selectedJudgedScore: 8,
      heldOutScore: 7.8,
      prevSelectedJudged: 6,
      prevHeldOut: 5.9,
      threshold: 1,
    });
    expect(r.diverged).toBe(false);
  });

  it('does NOT flag when the judged score did not improve', () => {
    const r = rewardHackDivergence({
      selectedJudgedScore: 5,
      heldOutScore: 9,
      prevSelectedJudged: 6,
      prevHeldOut: 5,
      threshold: 0,
    });
    expect(r.diverged).toBe(false);
  });

  it('is inert (not diverged) on any missing/non-finite input', () => {
    const r = rewardHackDivergence({ selectedJudgedScore: 8, prevSelectedJudged: 6 });
    expect(r).toEqual({ diverged: false, delta: 0, judgedDelta: 0, heldOutDelta: 0 });
  });
});
