import { describe, expect, it } from 'vitest';
import {
  maskViewMedians,
  median,
  normalizeScore,
  seedMedian,
  totalScore,
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
