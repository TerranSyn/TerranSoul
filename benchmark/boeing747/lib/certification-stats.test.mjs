import { describe, expect, it } from 'vitest';
import {
  agrestiCoullInterval,
  agrestiCoullLCB,
  certifyIUT,
  DEFAULT_ALPHA,
  DEFAULT_P_FLOOR,
  eProcess,
  expectedMaxStdNormal,
  flipRateBudget,
  normInv,
  pairedResolution,
  selectionPremiumCharge,
  shrinkToMean,
  wilsonLCB,
  zOneSided,
  zTwoSided,
} from './certification-stats.mjs';

// Every rule below is PURE — plain numbers in, no rig, no CLI, no filesystem, no
// GPU. Mirrors the transport-free discipline of lib/pairwise-config.test.mjs.

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

describe('normInv / z-multipliers', () => {
  it('recovers textbook normal quantiles', () => {
    expect(near(normInv(0.5), 0, 1e-9)).toBe(true);
    expect(near(normInv(0.975), 1.959963985, 1e-6)).toBe(true);
    expect(near(normInv(0.95), 1.644853627, 1e-6)).toBe(true);
    expect(near(normInv(0.8), 0.841621234, 1e-6)).toBe(true);
    // Symmetric tails.
    expect(near(normInv(0.025), -1.959963985, 1e-6)).toBe(true);
  });

  it('handles the closed endpoints without throwing', () => {
    expect(normInv(0)).toBe(-Infinity);
    expect(normInv(1)).toBe(Infinity);
    expect(Number.isNaN(normInv(-0.1))).toBe(true);
  });

  it('maps alpha=0.05 to the right one/two-sided z', () => {
    expect(near(zOneSided(0.05), 1.644853627, 1e-6)).toBe(true);
    expect(near(zTwoSided(0.05), 1.959963985, 1e-6)).toBe(true);
  });
});

describe('agrestiCoullInterval', () => {
  it('matches the known 0/10 two-sided 95% interval (~0..0.32)', () => {
    const ci = agrestiCoullInterval(0, 10, 0.05);
    expect(ci.lower).toBe(0);
    expect(near(ci.upper, 0.3209, 1e-3)).toBe(true);
  });

  it('is symmetric for 5/10 and centered near 0.5', () => {
    const ci = agrestiCoullInterval(5, 10, 0.05);
    expect(near(ci.center, 0.5, 1e-9)).toBe(true);
    expect(near(ci.lower + ci.upper, 1, 1e-9)).toBe(true);
  });

  it('returns the vacuous [0,1] when n<=0', () => {
    const ci = agrestiCoullInterval(0, 0, 0.05);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(1);
  });

  it('clamps successes into [0,n]', () => {
    expect(agrestiCoullInterval(99, 10, 0.05).upper).toBeLessThanOrEqual(1);
    expect(agrestiCoullInterval(-5, 10, 0.05).lower).toBeGreaterThanOrEqual(0);
  });
});

describe('agrestiCoullLCB', () => {
  it('clears p_floor=0.5 at 8/10 but not 7/10 (one-sided alpha=0.05)', () => {
    const lcb8 = agrestiCoullLCB(8, 10, 0.05);
    const lcb7 = agrestiCoullLCB(7, 10, 0.05);
    expect(near(lcb8, 0.5327, 1e-3)).toBe(true);
    expect(near(lcb7, 0.4384, 1e-3)).toBe(true);
    expect(lcb8).toBeGreaterThanOrEqual(0.5);
    expect(lcb7).toBeLessThan(0.5);
  });

  it('is monotone increasing in successes and returns 0 for n<=0', () => {
    expect(agrestiCoullLCB(9, 10)).toBeGreaterThan(agrestiCoullLCB(8, 10));
    expect(agrestiCoullLCB(3, 0)).toBe(0);
  });

  it('a unanimous large sample pushes the LCB well above the floor', () => {
    expect(agrestiCoullLCB(30, 30, 0.05)).toBeGreaterThan(0.85);
  });
});

describe('wilsonLCB', () => {
  it('matches the known 8/10 one-sided Wilson lower bound (~0.54)', () => {
    const lcb = wilsonLCB(8, 10, 0.05);
    expect(near(lcb, 0.5408, 2e-3)).toBe(true);
    expect(lcb).toBeGreaterThan(0.5);
  });

  it('small-sample unanimity: 3/3 barely clears 0.5, 1/3 sits far below', () => {
    // Wilson LCB for 3/3 at alpha=0.05 ~ 0.526 (just above the floor).
    expect(near(wilsonLCB(3, 3, 0.05), 0.5258, 2e-3)).toBe(true);
    expect(wilsonLCB(3, 3, 0.05)).toBeGreaterThan(0.5);
    // A non-unanimous small sample fails the floor.
    expect(wilsonLCB(1, 3, 0.05)).toBeLessThan(0.5);
    // 5/5 clears comfortably.
    expect(wilsonLCB(5, 5, 0.05)).toBeGreaterThan(0.6);
  });

  it('returns 0 for n<=0', () => {
    expect(wilsonLCB(2, 0)).toBe(0);
  });
});

describe('certifyIUT (intersection-union test, no cross-view Bonferroni)', () => {
  const nineCounts = (val) => Array.from({ length: 9 }, () => val);

  it('certifies iff EVERY view LCB >= p_floor (all views 8/10)', () => {
    const res = certifyIUT({ perViewClearedCounts: nineCounts(8), n: 10, pFloor: 0.5 });
    expect(res.certified).toBe(true);
    expect(res.blockingViews).toEqual([]);
    expect(res.worstViewLCB).toBeGreaterThanOrEqual(0.5);
    expect(res.perViewCertified.every((c) => c === true)).toBe(true);
  });

  it('one flaky view (7/10) blocks certification even when the other 8 pass', () => {
    const counts = nineCounts(8);
    counts[4] = 7; // one view drops below the floor
    const res = certifyIUT({ perViewClearedCounts: counts, n: 10, pFloor: 0.5 });
    expect(res.certified).toBe(false);
    expect(res.blockingViews).toEqual([4]);
    expect(res.worstViewIndex).toBe(4);
    expect(res.worstViewLCB).toBeLessThan(0.5);
  });

  it('does NOT apply Bonferroni: all 9 at the marginal 8/10 still certify', () => {
    // If a Bonferroni split (alpha/9) were applied, 8/10 per view would FAIL.
    const bonferroni = certifyIUT({
      perViewClearedCounts: nineCounts(8),
      n: 10,
      pFloor: 0.5,
      alpha: 0.05 / 9,
    });
    const iut = certifyIUT({ perViewClearedCounts: nineCounts(8), n: 10, pFloor: 0.5, alpha: 0.05 });
    expect(iut.certified).toBe(true);
    // The over-conservative Bonferroni alpha would reject the genuine all-pass.
    expect(bonferroni.certified).toBe(false);
  });

  it('an inconclusive-flagged view blocks regardless of its LCB', () => {
    const res = certifyIUT({
      perViewClearedCounts: nineCounts(10),
      n: 10,
      pFloor: 0.5,
      inconclusiveViews: [2],
    });
    expect(res.certified).toBe(false);
    expect(res.blockingViews).toEqual([2]);
    expect(res.perViewCertified[2]).toBe(false);
  });

  it('a contested-flagged view blocks regardless of its LCB', () => {
    const res = certifyIUT({
      perViewClearedCounts: nineCounts(10),
      n: 10,
      pFloor: 0.5,
      contestedViews: [7],
    });
    expect(res.certified).toBe(false);
    expect(res.blockingViews).toEqual([7]);
  });

  it('empty input never certifies', () => {
    expect(certifyIUT({ perViewClearedCounts: [], n: 10 }).certified).toBe(false);
  });

  it('accepts a per-view n array', () => {
    const res = certifyIUT({
      perViewClearedCounts: [8, 30],
      n: [10, 30],
      pFloor: 0.5,
    });
    expect(res.perViewLCB.length).toBe(2);
    expect(res.certified).toBe(true);
  });
});

describe('eProcess (sequential betting, R2)', () => {
  it('with fixed lambda=1 and all-clears at p_floor=0.5 decides at step 8', () => {
    // wealth *= (1 + 1*(1-0.5)) = 1.5 each step; 1.5^t >= 20 first at t=8.
    const obs = Array.from({ length: 20 }, () => 1);
    const res = eProcess({ observations: obs, pFloor: 0.5, alpha: 0.05, lambda: 1 });
    expect(res.decided).toBe(true);
    expect(res.aboveBar).toBe(true);
    expect(res.inconclusive).toBe(false);
    expect(res.steps).toBe(8);
    expect(res.eValue).toBeGreaterThanOrEqual(res.threshold);
    expect(res.threshold).toBe(20);
  });

  it('a coin-flip sequence never reaches the e-value threshold -> inconclusive', () => {
    const obs = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const res = eProcess({ observations: obs, pFloor: 0.5, alpha: 0.05, lambda: 1 });
    expect(res.decided).toBe(false);
    expect(res.inconclusive).toBe(true);
    expect(res.aboveBar).toBe(false);
    expect(res.eValue).toBeLessThan(20);
  });

  it('adaptive (plug-in) betting still certifies a clearly-above-bar view', () => {
    const obs = Array.from({ length: 40 }, () => 1);
    const res = eProcess({ observations: obs, pFloor: 0.5, alpha: 0.05 });
    expect(res.decided).toBe(true);
    expect(res.aboveBar).toBe(true);
  });

  it('never lets wealth go negative (fixed lambda over-cap is clamped)', () => {
    const obs = [0, 0, 0, 0];
    const res = eProcess({ observations: obs, pFloor: 0.5, alpha: 0.05, lambda: 1e9 });
    expect(res.eValue).toBeGreaterThanOrEqual(0);
    expect(res.trace.every((w) => w >= 0)).toBe(true);
  });

  it('accepts boolean observations', () => {
    const obs = [true, true, true, true, true, true, true, true, true, true];
    const res = eProcess({ observations: obs, pFloor: 0.5, alpha: 0.05, lambda: 1 });
    expect(res.decided).toBe(true);
  });
});

describe('selectionPremiumCharge / expectedMaxStdNormal (R3)', () => {
  it('expected-max of a single normal is 0 (no selection premium)', () => {
    expect(expectedMaxStdNormal(1)).toBe(0);
    expect(expectedMaxStdNormal(0)).toBe(0);
  });

  it('expected-max grows with the number of candidates', () => {
    const e2 = expectedMaxStdNormal(2);
    const e10 = expectedMaxStdNormal(10);
    const e100 = expectedMaxStdNormal(100);
    expect(e2).toBeGreaterThan(0);
    expect(e10).toBeGreaterThan(e2);
    expect(e100).toBeGreaterThan(e10);
    // Blom's order-statistic approximation for E[max of 2 N(0,1)] ~ 0.589
    // (a slight, safe over-estimate of the exact 1/sqrt(pi) = 0.5642).
    expect(near(e2, 0.5895, 5e-3)).toBe(true);
  });

  it('charge = sigma * expected-max, zero when sigma<=0 or candidates<=1', () => {
    expect(selectionPremiumCharge({ sigma: 0.3, numCandidates: 1 })).toBe(0);
    expect(selectionPremiumCharge({ sigma: 0, numCandidates: 50 })).toBe(0);
    const c = selectionPremiumCharge({ sigma: 0.3, numCandidates: 10 });
    expect(near(c, 0.3 * expectedMaxStdNormal(10), 1e-12)).toBe(true);
    expect(c).toBeGreaterThan(0);
  });
});

describe('shrinkToMean (R3)', () => {
  it('shrinkage=0 keeps the observed value; =1 collapses to the mean', () => {
    expect(shrinkToMean({ observed: 9, mean: 5, shrinkage: 0 })).toBe(9);
    expect(shrinkToMean({ observed: 9, mean: 5, shrinkage: 1 })).toBe(5);
    expect(shrinkToMean({ observed: 9, mean: 5, shrinkage: 0.5 })).toBe(7);
  });

  it('a noisier signal (reliability route) shrinks harder', () => {
    const lowNoise = shrinkToMean({ observed: 9, mean: 5, sigma: 0.2, spread: 2 });
    const highNoise = shrinkToMean({ observed: 9, mean: 5, sigma: 3, spread: 0.5 });
    // High noise -> closer to the mean (5); low noise -> closer to observed (9).
    expect(highNoise).toBeLessThan(lowNoise);
    expect(lowNoise).toBeGreaterThan(8.5);
    expect(highNoise).toBeLessThan(6);
  });

  it('clamps the shrinkage factor to [0,1]', () => {
    expect(shrinkToMean({ observed: 10, mean: 0, shrinkage: 5 })).toBe(0);
    expect(shrinkToMean({ observed: 10, mean: 0, shrinkage: -5 })).toBe(10);
  });
});

describe('flipRateBudget / pairedResolution (R7)', () => {
  it('flip-rate budget is the Bernoulli SE and shrinks with n', () => {
    expect(near(flipRateBudget({ flipRate: 0.5, n: 25 }), 0.1, 1e-9)).toBe(true);
    expect(flipRateBudget({ flipRate: 0.5, n: 100 })).toBeLessThan(flipRateBudget({ flipRate: 0.5, n: 25 }));
    expect(flipRateBudget({ flipRate: 0.3, n: 0 })).toBe(Infinity);
  });

  it('paired resolution shrinks with more re-judge draws', () => {
    const r4 = pairedResolution({ n: 4, sigma: 1, alpha: 0.05, power: 0.8 });
    const r16 = pairedResolution({ n: 16, sigma: 1, alpha: 0.05, power: 0.8 });
    // Halving the SE (4x n) halves the MDE.
    expect(near(r16, r4 / 2, 1e-9)).toBe(true);
    // (z_0.95 + z_0.8) = 1.6449 + 0.8416 = 2.4865; sigma/sqrt(4)=0.5.
    expect(near(r4, 2.4865 * 0.5, 2e-3)).toBe(true);
  });

  it('falls back to the flip-rate budget as the noise unit when no sigma given', () => {
    const budget = flipRateBudget({ flipRate: 0.2, n: 16 });
    const res = pairedResolution({ n: 16, flipRate: 0.2, alpha: 0.05, power: 0.8 });
    expect(near(res, (zOneSided(0.05) + normInv(0.8)) * budget, 1e-9)).toBe(true);
  });

  it('returns Infinity for n<=0 (nothing resolvable)', () => {
    expect(pairedResolution({ n: 0, sigma: 1 })).toBe(Infinity);
  });
});

describe('exported defaults', () => {
  it('sane statistical defaults', () => {
    expect(DEFAULT_ALPHA).toBe(0.05);
    expect(DEFAULT_P_FLOOR).toBe(0.5);
  });
});
