import { describe, expect, it } from 'vitest';
import {
  SCORING_VERSION,
  applyScoringV3,
  maskViewMedians,
  median,
  normalizeScore,
  panelMean,
  panelSeTotal,
  panelStd,
  seedMedian,
  totalScore,
  totalScoreV3,
  viewJudgeSucceeded,
  viewScore,
  weakestCriterion,
  weightedMean,
} from './scoring.mjs';

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
  it('returns null for empty input', () => {
    expect(median([])).toBeNull();
    expect(median(undefined)).toBeNull();
  });
});

describe('seedMedian', () => {
  it('takes the median of three seeds', () => {
    expect(seedMedian([4, 6, 5])).toBe(5);
  });
  it('drops nulls (judge could not assess) instead of zeroing', () => {
    expect(seedMedian([null, 6, 8])).toBe(7);
    expect(seedMedian([null, null, 9])).toBe(9);
  });
  it('is null when every seed abstained', () => {
    expect(seedMedian([null, null, null])).toBeNull();
  });
});

describe('normalizeScore', () => {
  it('clamps to 0..10 and nulls non-numbers', () => {
    expect(normalizeScore(12)).toBe(10);
    expect(normalizeScore(-3)).toBe(0);
    expect(normalizeScore('7')).toBe(7);
    expect(normalizeScore('n/a')).toBeNull();
    expect(normalizeScore(null)).toBeNull();
  });
});

describe('weightedMean / viewScore', () => {
  const criteria = [
    { id: 'a', weight: 2 },
    { id: 'b', weight: 1 },
    { id: 'c', weight: 1 },
  ];
  it('computes the weighted mean', () => {
    expect(viewScore({ a: 10, b: 4, c: 6 }, criteria)).toBe((20 + 4 + 6) / 4);
  });
  it('renormalizes weights over non-null criteria', () => {
    expect(viewScore({ a: 8, b: null, c: null }, criteria)).toBe(8);
    expect(viewScore({ a: 8, c: 4 }, criteria)).toBe((16 + 4) / 3);
  });
  it('returns null when nothing is scoreable', () => {
    expect(viewScore({}, criteria)).toBeNull();
    expect(weightedMean([])).toBeNull();
  });
});

describe('totalScore', () => {
  it('scales the mean of 9 views to /100', () => {
    const { total, scoredViews, missingViews } = totalScore([
      5, 5, 5, 5, 5, 5, 5, 5, 5,
    ]);
    expect(total).toBe(50);
    expect(scoredViews).toBe(9);
    expect(missingViews).toBe(0);
  });
  it('excludes null views but reports them', () => {
    const { total, scoredViews, missingViews } = totalScore([8, null, 6]);
    expect(total).toBe(70);
    expect(scoredViews).toBe(2);
    expect(missingViews).toBe(1);
  });
  it('is null with zero scored views', () => {
    expect(totalScore([null, null]).total).toBeNull();
  });
});

describe('maskViewMedians (view-visibility mask, rubric v2)', () => {
  const viewVisibility = {
    window_door_lines: [1, 2, 5, 6, 7, 8, 9],
    upper_deck_hump: [1, 2, 3, 6, 7, 8, 9],
    landing_gear: [1, 2, 3, 4, 6, 7, 8, 9],
  };
  it('forces a criterion to null on a view where it is not assessable', () => {
    // view 4 (rear head-on): windows AND hump are both masked out.
    const m = { window_door_lines: 2, upper_deck_hump: 5, engines_four_underwing: 8 };
    const out = maskViewMedians(m, 4, viewVisibility);
    expect(out.window_door_lines).toBeNull();
    expect(out.upper_deck_hump).toBeNull();
    expect(out.engines_four_underwing).toBe(8); // unmasked criteria pass through
  });
  it('keeps a criterion on the views where it IS assessable', () => {
    const m = { window_door_lines: 7, upper_deck_hump: 8 };
    const out = maskViewMedians(m, 1, viewVisibility); // left profile: both visible
    expect(out.window_door_lines).toBe(7);
    expect(out.upper_deck_hump).toBe(8);
  });
  it('masks landing_gear only on the top-down view (5)', () => {
    expect(maskViewMedians({ landing_gear: 6 }, 5, viewVisibility).landing_gear).toBeNull();
    expect(maskViewMedians({ landing_gear: 6 }, 8, viewVisibility).landing_gear).toBe(6);
  });
  it('is a passthrough when no viewVisibility is supplied (rubric v1 / unmasked)', () => {
    const m = { window_door_lines: 2, upper_deck_hump: 5 };
    expect(maskViewMedians(m, 4, undefined)).toBe(m);
    expect(maskViewMedians(m, 4, null)).toBe(m);
  });
  it('raises the view score by dropping an unfair invisible-view penalty', () => {
    const criteria = [
      { id: 'window_door_lines', weight: 0.7 },
      { id: 'engines_four_underwing', weight: 1.5 },
    ];
    // head-on rear: judge (wrongly) scored windows 2 where they cannot be seen.
    const raw = { window_door_lines: 2, engines_four_underwing: 8 };
    const unmasked = viewScore(raw, criteria);
    const masked = viewScore(maskViewMedians(raw, 4, viewVisibility), criteria);
    expect(masked).toBeGreaterThan(unmasked);
    expect(masked).toBe(8); // only engines remain
  });
});

describe('weakestCriterion', () => {
  const criteria = [
    { id: 'engines', weight: 1.5 },
    { id: 'hump', weight: 1.5 },
    { id: 'wings', weight: 1.3 },
  ];
  it('picks the lowest per-view-average criterion', () => {
    const perView = [
      { engines: 2, hump: 8, wings: 6 },
      { engines: 4, hump: 7, wings: null },
    ];
    const weakest = weakestCriterion(perView, criteria);
    expect(weakest.id).toBe('engines');
    expect(weakest.mean).toBe(3);
    expect(weakest.perCriterion.wings).toBe(6);
  });
  it('ties break toward the earlier rubric entry', () => {
    const perView = [{ engines: 5, hump: 5, wings: 9 }];
    expect(weakestCriterion(perView, criteria).id).toBe('engines');
  });
  it('returns null when nothing is scoreable', () => {
    expect(weakestCriterion([{}], criteria)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SCORING v3 — successful-empty views count 0; failed views keep the v2 drop.
// The vectors below are the taught track's REAL recorded incumbent (gate-state
// best_per_view at 55.64/100): 8 scored views + view 4 all-null. Under v2 that
// null was dropped (mean over 8 = 55.64); when the null came from a SUCCESSFUL
// judge pass ("unassessable from this angle" = the rubric's own 0 anchor) the
// honest 9-view total is 49.46 — v2 rewarded hiding a view by ~6 points.
// ---------------------------------------------------------------------------

const INCUMBENT_8_VIEW = [4.02, 8.69, 3.42, null, 3.26, 8.69, 3.43, 8.69, 4.31];

/** A judge.mjs-shaped per-view object. */
function mkView(score, { ok = true, seeds, judgeErrors } = {}) {
  const v = { view: 1, key: 'test-view', score };
  if (seeds !== undefined) v.seeds = seeds;
  else v.seeds = [{ seed: 7, ok }, { seed: 8, ok }, { seed: 9, ok }];
  if (judgeErrors !== undefined) v.judge_errors = judgeErrors;
  return v;
}

describe('viewJudgeSucceeded (scoring v3 success signal)', () => {
  it('true when at least one seed returned ok', () => {
    expect(viewJudgeSucceeded(mkView(null, { seeds: [{ ok: false }, { ok: true }, { ok: false }] }))).toBe(true);
  });
  it('false when every seed errored (infra failure, not unassessable geometry)', () => {
    expect(viewJudgeSucceeded(mkView(null, { seeds: [{ ok: false }, { ok: false }, { ok: false }] }))).toBe(false);
  });
  it('falls back to judge_errors === 0 when there is no seeds array', () => {
    expect(viewJudgeSucceeded({ score: null, judge_errors: 0 })).toBe(true);
    expect(viewJudgeSucceeded({ score: null, judge_errors: 3 })).toBe(false);
  });
  it('treats a missing signal as FAILURE (never worse than v2 null-drop)', () => {
    expect(viewJudgeSucceeded({ score: null })).toBe(false);
    expect(viewJudgeSucceeded(null)).toBe(false);
  });
});

describe('totalScoreV3', () => {
  it('counts a SUCCESSFUL-but-all-null view as 0 in the mean (the real 55.64 incumbent reads 49.46 over its honest 9-view basis)', () => {
    const perView = INCUMBENT_8_VIEW.map((s) => mkView(s));
    const v2 = totalScore(INCUMBENT_8_VIEW);
    expect(v2.total).toBe(55.64); // v2 baseline: null dropped, mean over 8
    const v3 = totalScoreV3(perView);
    expect(v3.total).toBe(49.46); // v3: successful-empty view scores 0, mean over 9
    expect(v3.scoredViews).toBe(9);
    expect(v3.missingViews).toBe(0);
    expect(v3.scoring_version).toBe(SCORING_VERSION);
    expect(v3.perViewScores[3]).toBe(0);
  });

  it('keeps the v2 null-drop for a FAILED judge call (fail-open unchanged)', () => {
    const perView = INCUMBENT_8_VIEW.map((s, i) =>
      i === 3 ? mkView(s, { seeds: [{ ok: false }, { ok: false }, { ok: false }] }) : mkView(s),
    );
    const v3 = totalScoreV3(perView);
    expect(v3.total).toBe(55.64); // failed view dropped exactly as v2 did
    expect(v3.scoredViews).toBe(8);
    expect(v3.missingViews).toBe(1);
    expect(v3.perViewScores[3]).toBeNull();
  });

  it('leaves scored views untouched (only nulls are reinterpreted)', () => {
    const perView = [mkView(7), mkView(5)];
    const v3 = totalScoreV3(perView);
    expect(v3.total).toBe(60);
    expect(v3.perViewScores).toEqual([7, 5]);
  });
});

describe('applyScoringV3', () => {
  const judged = {
    total_0_100: 55.64,
    scored_views: 8,
    missing_views: 1,
    per_view: INCUMBENT_8_VIEW.map((s) => mkView(s)),
    weakest_feature: { id: 'x' },
  };

  it('rewrites total, per-view scores, and counts on the honest 9-view basis, stamping scoring_version', () => {
    const out = applyScoringV3(judged);
    expect(out.total_0_100).toBe(49.46);
    expect(out.scored_views).toBe(9);
    expect(out.missing_views).toBe(0);
    expect(out.scoring_version).toBe(3);
    expect(out.per_view[3].score).toBe(0);
    expect(out.per_view[1].score).toBe(8.69);
    expect(out.weakest_feature).toEqual({ id: 'x' }); // untouched passthrough
  });

  it('is PURE — never mutates its input', () => {
    const before = JSON.parse(JSON.stringify(judged));
    applyScoringV3(judged);
    expect(judged).toEqual(before);
  });

  it('passes through null/shapeless input unchanged (a dead judge stays a dead judge)', () => {
    expect(applyScoringV3(null)).toBeNull();
    expect(applyScoringV3({ total_0_100: 10 })).toEqual({ total_0_100: 10 });
  });
});

describe('scoring v3 on the claude-vision per-view shape (adversarial-review fix 2026-07-16)', () => {
  // judge-claude.mjs names its per-run array `samples` (not `seeds`) and its
  // results.json projection used to strip BOTH samples and judge_errors —
  // which made viewJudgeSucceeded() false for every claude view and v3 a
  // silent no-op on the whole claude-vision track (confirmed by 3 independent
  // review lenses + runtime repro). These tests pin the fixed behavior against
  // the REAL post-fix claude per_view shape.
  function mkClaudeView(score, { oks = [true], judgeErrors } = {}) {
    return {
      view: 1,
      key: 'test-view',
      score,
      score_unmasked: score,
      masked_out: [],
      criteria_medians: {},
      notes: '',
      judge_errors: judgeErrors ?? oks.filter((o) => !o).length,
      samples: oks.map((ok) => ({ ok })),
    };
  }

  it('viewJudgeSucceeded reads the claude `samples` ok-array', () => {
    expect(viewJudgeSucceeded(mkClaudeView(null, { oks: [false, true] }))).toBe(true);
    expect(viewJudgeSucceeded(mkClaudeView(null, { oks: [false, false] }))).toBe(false);
  });

  it('applyScoringV3 closes the hide-a-view exploit on the claude shape (the real incumbent reads 49.46, not 55.64)', () => {
    const judged = {
      total_0_100: 55.64,
      scored_views: 8,
      missing_views: 1,
      per_view: INCUMBENT_8_VIEW.map((s) => mkClaudeView(s)),
    };
    const out = applyScoringV3(judged);
    expect(out.total_0_100).toBe(49.46);
    expect(out.scored_views).toBe(9);
    expect(out.per_view[3].score).toBe(0);
    expect(out.scoring_version).toBe(3);
  });

  it('a claude view whose every sample errored keeps the v2 null-drop (fail-open unchanged)', () => {
    const judged = {
      total_0_100: 55.64,
      per_view: INCUMBENT_8_VIEW.map((s, i) => (i === 3 ? mkClaudeView(s, { oks: [false, false] }) : mkClaudeView(s))),
    };
    const out = applyScoringV3(judged);
    expect(out.total_0_100).toBe(55.64);
    expect(out.per_view[3].score).toBeNull();
  });
});

describe('judge panel v4 helpers (self-consistency K-panel)', () => {
  it('panelMean averages non-null draws and abstains only when every draw abstained', () => {
    expect(panelMean([6, 7, null, 8])).toBe(7);
    expect(panelMean([null, null])).toBeNull();
    expect(panelMean([])).toBeNull();
  });

  it('panelStd is the sample std of non-null draws, 0 below 2 draws', () => {
    expect(panelStd([4, 6])).toBeCloseTo(Math.SQRT2, 10);
    expect(panelStd([5, 5, 5])).toBe(0);
    expect(panelStd([7])).toBe(0);
    expect(panelStd([null, 7])).toBe(0);
  });

  it('panelSeTotal propagates per-view spread into the /100 total SE', () => {
    const nineViews = Array.from({ length: 9 }, () => ({ score_std: 0.9, draws: 5 }));
    // (10/9) * sqrt(9 * 0.81/5) = 1.342
    expect(panelSeTotal(nineViews, 9)).toBeCloseTo(1.342, 3);
  });

  it('a spreadless or single-draw view adds no variance (never inflates epsilon)', () => {
    const views = [
      { score_std: 1.2, draws: 4 },
      { score_std: 0, draws: 5 },
      {},
      { score_std: 2.0, draws: 1 },
    ];
    // (10/4) * sqrt(1.44/4 + 0 + 0 + 4.0/1) = 2.5 * sqrt(4.36)
    expect(panelSeTotal(views, 4)).toBeCloseTo(2.5 * Math.sqrt(4.36), 2);
    expect(panelSeTotal([], 9)).toBe(0);
    expect(panelSeTotal([{ score_std: 0, draws: 5 }], 9)).toBe(0);
  });
});
