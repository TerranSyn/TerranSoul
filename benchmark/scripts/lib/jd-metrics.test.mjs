// SPDX-License-Identifier: MIT
// MILLION-RESUME-BENCH: hand-computed fixtures for the pure metric fns.

import { describe, expect, it } from 'vitest';
import { hitsAtK, recallAtK, precisionAtK, ndcgAtK, percentile } from './jd-metrics.mjs';

const gold = new Set(['b', 'd', 'x']);

describe('hitsAtK', () => {
  it('counts gold hits in the top-k prefix only', () => {
    expect(hitsAtK(['a', 'b', 'c', 'd'], gold, 2)).toBe(1); // only b
    expect(hitsAtK(['a', 'b', 'c', 'd'], gold, 4)).toBe(2); // b + d
    expect(hitsAtK(['a', 'b'], gold, 10)).toBe(1); // shorter list than k
    expect(hitsAtK([], gold, 10)).toBe(0);
  });
});

describe('recallAtK (capped + raw)', () => {
  it('caps the denominator at min(k, |gold|)', () => {
    // retrieved [a,b,c,d], gold {b,d,x}: at k=2 hits=1
    const r2 = recallAtK(['a', 'b', 'c', 'd'], gold, 2);
    expect(r2.hits).toBe(1);
    expect(r2.capped).toBeCloseTo(1 / 2, 12); // min(2, 3) = 2
    expect(r2.raw).toBeCloseTo(1 / 3, 12);
  });

  it('uses |gold| when k exceeds it', () => {
    const r4 = recallAtK(['a', 'b', 'c', 'd'], gold, 4);
    expect(r4.hits).toBe(2);
    expect(r4.capped).toBeCloseTo(2 / 3, 12); // min(4, 3) = 3
    expect(r4.raw).toBeCloseTo(2 / 3, 12); // identical when k >= |gold|
  });

  it('returns 0 for an empty gold set', () => {
    const r = recallAtK(['a'], new Set(), 10);
    expect(r.capped).toBe(0);
    expect(r.raw).toBe(0);
  });
});

describe('precisionAtK', () => {
  it('divides by k even when fewer than k were retrieved', () => {
    expect(precisionAtK(['a', 'b', 'c', 'd'], gold, 2)).toBeCloseTo(1 / 2, 12);
    expect(precisionAtK(['a', 'b', 'c', 'd'], gold, 10)).toBeCloseTo(2 / 10, 12);
  });

  it('is 0 for k <= 0', () => {
    expect(precisionAtK(['a'], gold, 0)).toBe(0);
  });
});

describe('ndcgAtK (binary relevance)', () => {
  it('matches a hand-computed 3-item example', () => {
    // retrieved [g1, n, g2], gold {g1, g2, g3}, k=10
    // DCG  = 1/log2(2) + 1/log2(4)            = 1 + 0.5      = 1.5
    // IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4) = 1 + 0.63093 + 0.5 = 2.13093
    const g = new Set(['g1', 'g2', 'g3']);
    const value = ndcgAtK(['g1', 'n', 'g2'], g, 10);
    expect(value).toBeCloseTo(1.5 / (1 + 1 / Math.log2(3) + 0.5), 10);
    expect(value).toBeCloseTo(0.70391, 4);
  });

  it('is 1.0 for a perfect prefix ranking', () => {
    const g = new Set(['a', 'b']);
    expect(ndcgAtK(['a', 'b', 'z'], g, 10)).toBeCloseTo(1.0, 12);
  });

  it('is 0 when nothing relevant is retrieved or gold is empty', () => {
    expect(ndcgAtK(['n1', 'n2'], new Set(['a']), 10)).toBe(0);
    expect(ndcgAtK(['n1'], new Set(), 10)).toBe(0);
  });

  it('IDCG uses min(k, |gold|) positions', () => {
    // gold has 5 items but k=2: ideal = 1 + 1/log2(3)
    const g = new Set(['a', 'b', 'c', 'd', 'e']);
    const value = ndcgAtK(['a', 'z'], g, 2);
    expect(value).toBeCloseTo(1 / (1 + 1 / Math.log2(3)), 10);
  });
});

describe('percentile (linear interpolation)', () => {
  it('matches hand-computed p50/p95 on [10..50]', () => {
    const values = [50, 10, 40, 20, 30]; // unsorted on purpose
    expect(percentile(values, 50)).toBe(30);
    // rank = 0.95 * 4 = 3.8 -> 40 + 0.8 * (50 - 40) = 48
    expect(percentile(values, 95)).toBeCloseTo(48, 12);
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 100)).toBe(50);
  });

  it('handles singleton and empty inputs', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });
});
