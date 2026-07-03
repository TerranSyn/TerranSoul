import { describe, expect, it } from 'vitest';
import {
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
