import { describe, expect, it } from 'vitest';
import {
  aggregateViews,
  combinedToCredit,
  criterionParityMedian,
  isVisibleCriterion,
  scoreView,
} from './pairwise-scoring.mjs';

/** Shorthand for a decided (consistent) panel with the given combined magnitude. */
const consistent = (combined) => ({ combined, status: 'consistent', decided: true });
/** An order-flip panel (routed to undecided upstream): no credit, but counts as a pair. */
const inconsistent = () => ({ combined: null, status: 'inconsistent', decided: false });
/** An NA/undecided panel. */
const undecided = () => ({ combined: null, status: 'undecided', decided: false });

describe('combinedToCredit', () => {
  it('maps the graded scale symmetrically around parity', () => {
    expect(combinedToCredit(0)).toBe(0.5);
    expect(combinedToCredit(2)).toBe(1);
    expect(combinedToCredit(-2)).toBe(0);
    expect(combinedToCredit(1)).toBe(0.75);
    expect(combinedToCredit(-1)).toBe(0.25);
    expect(combinedToCredit(1.5)).toBe(0.875);
  });
  it('clamps out-of-range magnitudes into 0..1', () => {
    expect(combinedToCredit(4)).toBe(1);
    expect(combinedToCredit(-4)).toBe(0);
  });
});

describe('isVisibleCriterion', () => {
  const vv = { window_door_lines: [1, 2, 5, 6, 7, 8, 9] };
  it('is false only on a masked view', () => {
    expect(isVisibleCriterion('window_door_lines', 3, vv)).toBe(false);
    expect(isVisibleCriterion('window_door_lines', 1, vv)).toBe(true);
  });
  it('is true for a criterion absent from the map (assessable everywhere)', () => {
    expect(isVisibleCriterion('engines', 4, vv)).toBe(true);
    expect(isVisibleCriterion('engines', 4, undefined)).toBe(true);
  });
});

describe('criterionParityMedian', () => {
  it('medians the credits of the DECIDED panels only', () => {
    // credits: +2 -> 1.0, 0 -> 0.5, +2 -> 1.0  => median 1.0
    const r = criterionParityMedian([consistent(2), consistent(0), consistent(2)]);
    expect(r.median).toBe(1);
    expect(r.decidedCount).toBe(3);
    expect(r.totalCount).toBe(3);
  });
  it('ignores inconsistent/undecided panels for the median but counts them as pairs', () => {
    const r = criterionParityMedian([consistent(1), inconsistent(), undecided()]);
    expect(r.median).toBe(0.75); // only the +1 consistent panel credits
    expect(r.decidedCount).toBe(1);
    expect(r.totalCount).toBe(3);
  });
  it('is null when no panel is decided', () => {
    const r = criterionParityMedian([inconsistent(), undecided()]);
    expect(r.median).toBeNull();
    expect(r.decidedCount).toBe(0);
    expect(r.totalCount).toBe(2);
  });
  it('is null/empty for missing input', () => {
    expect(criterionParityMedian(undefined)).toEqual({ median: null, decidedCount: 0, totalCount: 0 });
  });
});

describe('scoreView -> frozen pipeline', () => {
  const criteria = [
    { id: 'a', weight: 2 },
    { id: 'b', weight: 1 },
  ];
  const view = { id: 1, key: 'left-profile' };

  it('all-consistent-ties => every criterion 5.0 => view score 5.0 (parity = reference)', () => {
    const out = scoreView({
      view,
      criteriaPanels: { a: [consistent(0), consistent(0)], b: [consistent(0), consistent(0)] },
      criteria,
    });
    expect(out.criteria_medians).toEqual({ a: 5, b: 5 });
    expect(out.score).toBe(5);
    expect(out.decided_fraction).toBe(1);
    expect(out.inconclusive).toBe(false);
    expect(out.view).toBe(1);
    expect(out.key).toBe('left-profile');
  });

  it('all candidate-much-better => every criterion 10.0 => view score 10.0', () => {
    const out = scoreView({
      view,
      criteriaPanels: { a: [consistent(2)], b: [consistent(2)] },
      criteria,
    });
    expect(out.criteria_medians).toEqual({ a: 10, b: 10 });
    expect(out.score).toBe(10);
  });

  it('a known parity map flows through the FROZEN weighted mean exactly', () => {
    // a: combined +2 -> credit 1.0 -> median 10.0 ; b: combined 0 -> 5.0
    // viewScore = (10*2 + 5*1) / 3 = 25/3 = 8.3333 -> round2 8.33
    const out = scoreView({
      view,
      criteriaPanels: { a: [consistent(2)], b: [consistent(0)] },
      criteria,
    });
    expect(out.criteria_medians).toEqual({ a: 10, b: 5 });
    expect(out.score).toBe(8.33);
    expect(out.score_unmasked).toBe(8.33);
  });

  it('an inconsistent (flipped) criterion is NULL, never a hollow 5.0 clear (REVIEW FIX #1)', () => {
    // 'a' flips on both its panels -> median null -> excluded, NOT credited 0.5.
    const out = scoreView({
      view,
      criteriaPanels: { a: [inconsistent(), inconsistent()], b: [consistent(2)] },
      criteria,
    });
    expect(out.criteria_medians.a).toBeNull();
    expect(out.criteria_medians.b).toBe(10);
    // Only 'b' remains scoreable => view score is b alone (10), NOT dragged to
    // ~6.67 that a bogus a=5.0 credit would have produced.
    expect(out.score).toBe(10);
    // Decided fraction: 1 decided pair (b) of 3 total (a x2 + b x1) = 0.3333.
    expect(out.decided_fraction).toBe(0.3333);
    expect(out.inconclusive).toBe(true);
  });

  it('flags a view inconclusive when < half the panels are decided', () => {
    const out = scoreView({
      view,
      criteriaPanels: { a: [consistent(1), inconsistent()], b: [undecided(), inconsistent()] },
      criteria,
    });
    // decided: 1 (a) of 4 total = 0.25 < 0.5.
    expect(out.decided_fraction).toBe(0.25);
    expect(out.inconclusive).toBe(true);
  });

  it('masks a structurally-invisible criterion and excludes it from decided_fraction', () => {
    const maskedCriteria = [
      { id: 'window_door_lines', weight: 0.7 },
      { id: 'engines', weight: 1.5 },
    ];
    const viewVisibility = { window_door_lines: [1, 2, 5, 6, 7, 8, 9] };
    // view 3 masks windows. Even though a (bogus) windows panel is present, it
    // must be masked out of the score AND excluded from the fraction denominator.
    const out = scoreView({
      view: { id: 3, key: 'front' },
      criteriaPanels: { window_door_lines: [consistent(0)], engines: [consistent(2), consistent(2)] },
      criteria: maskedCriteria,
      viewVisibility,
    });
    expect(out.criteria_medians.window_door_lines).toBe(5); // raw median still computed
    expect(out.masked_out).toContain('window_door_lines');
    expect(out.score).toBe(10); // only engines survive the mask
    // denominator excludes the masked windows panel: 2 engine pairs, both decided.
    expect(out.decided_fraction).toBe(1);
  });

  it('is byte-shape-identical to the frozen per-view object keys', () => {
    const out = scoreView({ view, criteriaPanels: { a: [consistent(0)], b: [consistent(0)] }, criteria });
    expect(Object.keys(out).sort()).toEqual(
      [
        'view',
        'key',
        'score',
        'score_unmasked',
        'masked_out',
        'criteria_medians',
        'decided_fraction',
        'inconclusive',
      ].sort(),
    );
  });
});

describe('aggregateViews -> frozen totalScore + weakestCriterion', () => {
  const criteria = [
    { id: 'a', weight: 2 },
    { id: 'b', weight: 1 },
  ];
  const viewVisibility = {};

  it('scales the mean of per-view scores to /100 and picks the lowest-parity criterion', () => {
    const v1 = scoreView({
      view: { id: 1, key: 'left-profile' },
      criteriaPanels: { a: [consistent(2)], b: [consistent(-2)] },
      criteria,
    });
    const v2 = scoreView({
      view: { id: 2, key: 'right-profile' },
      criteriaPanels: { a: [consistent(2)], b: [consistent(-2)] },
      criteria,
    });
    // Each view: a=10, b=0 => viewScore = (20+0)/3 = 6.6667 -> 6.67.
    expect(v1.score).toBe(6.67);
    const agg = aggregateViews([v1, v2], criteria, viewVisibility);
    // total = mean(6.67, 6.67)*10 = 66.7.
    expect(agg.total_0_100).toBe(66.7);
    expect(agg.scored_views).toBe(2);
    expect(agg.missing_views).toBe(0);
    // b (parity 0 across both views) is the weakest.
    expect(agg.weakest_feature.id).toBe('b');
    expect(agg.weakest_feature.mean).toBe(0);
  });

  it('excludes null-score views from the total but reports them missing', () => {
    const good = scoreView({
      view: { id: 1, key: 'left-profile' },
      criteriaPanels: { a: [consistent(0)], b: [consistent(0)] },
      criteria,
    });
    const empty = scoreView({
      view: { id: 2, key: 'right-profile' },
      criteriaPanels: { a: [inconsistent()], b: [undecided()] },
      criteria,
    });
    expect(empty.score).toBeNull();
    const agg = aggregateViews([good, empty], criteria, viewVisibility);
    expect(agg.total_0_100).toBe(50); // only the parity view counts
    expect(agg.scored_views).toBe(1);
    expect(agg.missing_views).toBe(1);
  });
});
