import { describe, expect, it } from 'vitest';
import { evaluateStopConditions } from './stop-conditions.mjs';

const cfg = { viewThreshold: 8, patience: 3, budget: 12 };
const nine = (v) => Array(9).fill(v);

describe('evaluateStopConditions', () => {
  it('does not stop on an improving early run', () => {
    const res = evaluateStopConditions(
      [
        { iter: 1, total: 20, perView: nine(2) },
        { iter: 2, total: 35, perView: nine(3.5) },
      ],
      cfg,
    );
    expect(res.stop).toBe(false);
    expect(res.bestTotal).toBe(35);
    expect(res.remainingBudget).toBe(10);
  });

  it('stops when every view of the latest iteration meets the threshold', () => {
    const res = evaluateStopConditions(
      [{ iter: 1, total: 85, perView: nine(8.5) }],
      cfg,
    );
    expect(res.stop).toBe(true);
    expect(res.reasons.some((r) => r.startsWith('threshold'))).toBe(true);
  });

  it('does not fire threshold when a view is null or below', () => {
    const below = nine(9);
    below[4] = 7.9;
    const withNull = nine(9);
    withNull[0] = null;
    for (const perView of [below, withNull]) {
      const res = evaluateStopConditions([{ iter: 1, total: 88, perView }], cfg);
      expect(res.reasons.some((r) => r.startsWith('threshold'))).toBe(false);
    }
  });

  it('stops after 3 consecutive non-improving iterations', () => {
    const res = evaluateStopConditions(
      [
        { iter: 1, total: 40, perView: nine(4) },
        { iter: 2, total: 38, perView: nine(3.8) },
        { iter: 3, total: 40, perView: nine(4) }, // equal best = non-improving
        { iter: 4, total: 39, perView: nine(3.9) },
      ],
      cfg,
    );
    expect(res.stop).toBe(true);
    expect(res.consecutiveNonImproving).toBe(3);
    expect(res.reasons.some((r) => r.startsWith('stall'))).toBe(true);
    expect(res.bestTotal).toBe(40);
  });

  it('an improvement resets the stall streak', () => {
    const res = evaluateStopConditions(
      [
        { iter: 1, total: 40, perView: nine(4) },
        { iter: 2, total: 38, perView: nine(3.8) },
        { iter: 3, total: 39, perView: nine(3.9) },
        { iter: 4, total: 45, perView: nine(4.5) },
      ],
      cfg,
    );
    expect(res.stop).toBe(false);
    expect(res.consecutiveNonImproving).toBe(0);
    expect(res.bestTotal).toBe(45);
  });

  it('stops at the iteration budget', () => {
    const iters = Array.from({ length: 12 }, (_, i) => ({
      iter: i + 1,
      total: 30 + i, // always improving => no stall/threshold
      perView: nine(3),
    }));
    const res = evaluateStopConditions(iters, cfg);
    expect(res.stop).toBe(true);
    expect(res.reasons).toEqual(['budget: 12/12 iterations used']);
    expect(res.remainingBudget).toBe(0);
  });

  it('handles an empty history', () => {
    const res = evaluateStopConditions([], cfg);
    expect(res.stop).toBe(false);
    expect(res.bestTotal).toBeNull();
    expect(res.remainingBudget).toBe(12);
  });
});
