// Tests for the PURE opus-pairwise gating-decision helpers wired into
// loop-runner-terransoul.mjs (STEP 3 — LOOP WIRING):
//   - certifyPairwiseStop: the "100%" definition (every view clears its
//     calibrated bar with NO inconclusive/coin-flip view and NO PERSISTENTLY
//     gemma-CONTESTED view) plus the per-view soft-flag / streak bookkeeping.
//   - computePairwiseStop: folds the FROZEN evaluateStopConditions verdict with
//     the certification so a threshold "all bars met" only STOPS when certified,
//     while stall/budget always stop.
//
// These are the pure parts of the pairwise-mode gating decision. The live judge/
// actor/brain wiring around them stays mocked/optional (no network, no GPU) —
// this suite pins the certification semantics that decide meaningfulness.
import { describe, expect, it } from 'vitest';
import {
  CONTESTED_PERSIST_THRESHOLD,
  certifyPairwiseConfirmed,
  certifyPairwiseStop,
  computePairwiseStop,
} from './loop-runner-terransoul.mjs';

/** Nine per-view objects at a uniform score, none inconclusive. */
function ninePerView(score, { inconclusiveViews = [] } = {}) {
  return Array.from({ length: 9 }, (_, i) => ({
    view: i + 1,
    key: `view-${i + 1}`,
    score,
    inconclusive: inconclusiveViews.includes(i + 1),
  }));
}

const BARS = Array(9).fill(4.7);

describe('certifyPairwiseStop — "100%" definition', () => {
  it('certifies when every view clears its bar, none inconclusive, none contested', () => {
    const c = certifyPairwiseStop({ perView: ninePerView(5.0), bars: BARS });
    expect(c.certified).toBe(true);
    expect(c.allCleared).toBe(true);
    expect(c.clearedViews).toBe(9);
    expect(c.inconclusiveViews).toEqual([]);
    expect(c.contestedViews).toEqual([]);
  });

  it('does NOT certify when a single view sits below its bar', () => {
    const perView = ninePerView(5.0);
    perView[3].score = 4.5; // view 4 below the 4.7 bar
    const c = certifyPairwiseStop({ perView, bars: BARS });
    expect(c.allCleared).toBe(false);
    expect(c.certified).toBe(false);
    expect(c.clearedViews).toBe(8);
  });

  it('does NOT certify when a view is inconclusive (coin-flip) even though it scores above the bar', () => {
    // REVIEW FIX #1: a view whose decided_fraction < 0.5 (inconclusive) can score
    // high on the few decided panels, but a clear on coin-flips is void.
    const c = certifyPairwiseStop({ perView: ninePerView(5.2, { inconclusiveViews: [6] }), bars: BARS });
    expect(c.allCleared).toBe(true); // every score >= bar
    expect(c.inconclusiveViews).toEqual([6]);
    expect(c.certified).toBe(false); // but not certifiable
  });

  it('treats a null score as inconclusive AND uncleared', () => {
    const perView = ninePerView(5.0);
    perView[0].score = null;
    const c = certifyPairwiseStop({ perView, bars: BARS });
    expect(c.allCleared).toBe(false);
    expect(c.inconclusiveViews).toContain(1);
    expect(c.certified).toBe(false);
  });

  it('broadcasts a scalar bar across all views', () => {
    const c = certifyPairwiseStop({ perView: ninePerView(4.8), bars: 4.7 });
    expect(c.certified).toBe(true);
    const below = certifyPairwiseStop({ perView: ninePerView(4.6), bars: 4.7 });
    expect(below.allCleared).toBe(false);
  });

  it('is not certified on an empty per-view set', () => {
    const c = certifyPairwiseStop({ perView: [], bars: BARS });
    expect(c.allCleared).toBe(false);
    expect(c.certified).toBe(false);
    expect(c.totalViews).toBe(0);
  });
});

describe('certifyPairwiseStop — gemma cross-family CONTESTED veto (persistence-gated)', () => {
  const gemmaRef = Array(9).fill(6.0);
  // view 3 candidate gemma score collapses well below the reference band.
  const gemmaCandContested = Array(9).fill(6.0);
  gemmaCandContested[2] = 4.0; // 4.0 < 6.0 - 1.0 => contested-now on view 3

  it('a SINGLE-iteration contested view is only a SOFT-FLAG, never blocks certification', () => {
    const c = certifyPairwiseStop({
      perView: ninePerView(5.0),
      bars: BARS,
      gemmaCandidatePerView: gemmaCandContested,
      gemmaReferencePerView: gemmaRef,
      gemmaVetoBand: 1.0,
      priorContestedStreaks: Array(9).fill(0),
    });
    expect(c.softFlaggedViews).toEqual([3]);
    expect(c.contestedViews).toEqual([]); // not yet persisted
    expect(c.contestedStreaks[2]).toBe(1);
    expect(c.certified).toBe(true); // soft-flag alone does not block
  });

  it('a contested view that PERSISTS to the threshold blocks certification', () => {
    const prior = Array(9).fill(0);
    prior[2] = CONTESTED_PERSIST_THRESHOLD - 1; // one shy of the threshold
    const c = certifyPairwiseStop({
      perView: ninePerView(5.0),
      bars: BARS,
      gemmaCandidatePerView: gemmaCandContested,
      gemmaReferencePerView: gemmaRef,
      gemmaVetoBand: 1.0,
      priorContestedStreaks: prior,
    });
    expect(c.contestedStreaks[2]).toBe(CONTESTED_PERSIST_THRESHOLD);
    expect(c.contestedViews).toEqual([3]);
    expect(c.certified).toBe(false);
  });

  it('resets the contested streak when the gemma downside disappears this iteration', () => {
    const prior = Array(9).fill(0);
    prior[2] = 5; // was contested for a while
    const c = certifyPairwiseStop({
      perView: ninePerView(5.0),
      bars: BARS,
      gemmaCandidatePerView: gemmaRef, // candidate == reference now: no downside
      gemmaReferencePerView: gemmaRef,
      gemmaVetoBand: 1.0,
      priorContestedStreaks: prior,
    });
    expect(c.contestedStreaks[2]).toBe(0);
    expect(c.contestedViews).toEqual([]);
    expect(c.certified).toBe(true);
  });

  it('fails open (no veto) when a gemma score is missing/non-finite', () => {
    const missing = Array(9).fill(6.0);
    missing[2] = null;
    const c = certifyPairwiseStop({
      perView: ninePerView(5.0),
      bars: BARS,
      gemmaCandidatePerView: missing,
      gemmaReferencePerView: gemmaRef,
      gemmaVetoBand: 1.0,
      priorContestedStreaks: Array(9).fill(9),
    });
    expect(c.contestedStreaks[2]).toBe(0);
    expect(c.certified).toBe(true);
  });

  it('does not contest a view that is NOT cleared (veto is only meaningful on a cleared view)', () => {
    const perView = ninePerView(5.0);
    perView[2].score = 4.0; // view 3 below bar (uncleared)
    const c = certifyPairwiseStop({
      perView,
      bars: BARS,
      gemmaCandidatePerView: gemmaCandContested,
      gemmaReferencePerView: gemmaRef,
      gemmaVetoBand: 1.0,
      priorContestedStreaks: Array(9).fill(5),
    });
    expect(c.flags[2].contestedNow).toBe(false);
    expect(c.contestedStreaks[2]).toBe(0);
    expect(c.allCleared).toBe(false);
  });
});

describe('computePairwiseStop — certification-gated threshold', () => {
  const certified = { certified: true, allCleared: true, inconclusiveViews: [], contestedViews: [] };
  const notCertified = { certified: false, allCleared: true, inconclusiveViews: [6], contestedViews: [] };

  it('keeps a threshold stop when certification passed', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= their per-view calibrated bars [..] on iteration 5'] },
      certify: certified,
    });
    expect(out.stop).toBe(true);
    expect(out.certified).toBe(true);
    expect(out.reasons[0]).toMatch(/^threshold:/);
  });

  it('DOWNGRADES a threshold stop to a "not certified" note (does not stop) when certification failed', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= their per-view calibrated bars [..] on iteration 5'] },
      certify: notCertified,
    });
    expect(out.stop).toBe(false);
    expect(out.certified).toBe(false);
    expect(out.reasons[0]).toContain('NOT certified');
    expect(out.reasons[0]).toContain('inconclusive views [6]');
  });

  it('reports contested-view blockers in the downgrade note', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 7'] },
      certify: { certified: false, allCleared: true, inconclusiveViews: [], contestedViews: [3, 8] },
    });
    expect(out.stop).toBe(false);
    expect(out.reasons[0]).toContain('gemma-contested views [3, 8]');
  });

  it('always stops on a stall reason regardless of certification', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['stall: 3 consecutive iterations without improving best total (42.1)'] },
      certify: notCertified,
    });
    expect(out.stop).toBe(true);
    expect(out.reasons[0]).toMatch(/^stall:/);
  });

  it('always stops on a budget reason regardless of certification', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['budget: 12/12 iterations used'] },
      certify: notCertified,
    });
    expect(out.stop).toBe(true);
    expect(out.reasons[0]).toMatch(/^budget:/);
  });

  it('stops on stall+budget while still downgrading an uncertified threshold in the same batch', () => {
    const out = computePairwiseStop({
      claudeStop: {
        reasons: [
          'threshold: all 9 views >= bars on iteration 12',
          'budget: 12/12 iterations used',
        ],
      },
      certify: notCertified,
    });
    expect(out.stop).toBe(true); // budget still stops
    expect(out.reasons[0]).toContain('NOT certified');
    expect(out.reasons[1]).toMatch(/^budget:/);
  });

  it('does not stop when there are no reasons at all', () => {
    const out = computePairwiseStop({ claudeStop: { reasons: [] }, certify: certified });
    expect(out.stop).toBe(false);
    expect(out.reasons).toEqual([]);
  });
});

// --- STEP 2: CONFIRMATION RE-JUDGE + LCB CERTIFICATION ---------------------
// certifyPairwiseConfirmed pools per-view cleared-counts across (1 + k_confirm)
// INDEPENDENT pairwise passes and certifies on the worst view's Agresti-Coull
// LCB (R1 IUT), escalating straddling views to the e-process (R2), reporting on
// the LCB never the peak (R3), with a paired-test resolution + flip-rate noise
// budget (R7). PURE — the k confirmation passes are mocked as arrays of per-view
// scores; NO live judge/GPU/network.

/** Build one pairwise pass: 9 per-view score objects at a uniform score. */
function pass(score, { inconclusiveViews = [] } = {}) {
  return Array.from({ length: 9 }, (_, i) => ({
    view: i + 1,
    key: `view-${i + 1}`,
    score,
    inconclusive: inconclusiveViews.includes(i + 1),
  }));
}

/** N identical unanimous passes at `score`. */
function passes(nPasses, score, opts) {
  return Array.from({ length: nPasses }, () => pass(score, opts));
}

describe('certifyPairwiseConfirmed — pooled worst-view LCB certification (R1/R2/R3/R7)', () => {
  it('certifies when enough unanimous passes push the worst-view AC-LCB above the floor', () => {
    // 6 unanimous clears => AC-LCB(6,6) ~= 0.64 >= 0.5 for every view (IUT).
    const c = certifyPairwiseConfirmed({ passes: passes(6, 5.0), bars: BARS });
    expect(c.certified).toBe(true);
    expect(c.passesUsed).toBe(6);
    expect(c.worstViewLCB).toBeGreaterThanOrEqual(0.5);
    expect(c.inconclusiveViews).toEqual([]);
    expect(c.blockingViews).toEqual([]);
    expect(c.resolution.resolvable).toBe(true);
    expect(c.resolution.n).toBe(6);
    expect(Number.isFinite(c.resolution.mde)).toBe(true);
  });

  it('does NOT certify at the default k_confirm=2 (n=3) even on a unanimous sweep — underpowered => inconclusive', () => {
    // R3 deflation: AC-LCB(3,3) ~= 0.47 < 0.5 and the e-process cannot reach
    // 1/alpha on 3 draws, so every view straddles and is marked inconclusive.
    const c = certifyPairwiseConfirmed({ passes: passes(3, 5.0), bars: BARS });
    expect(c.certified).toBe(false);
    expect(c.passesUsed).toBe(3);
    expect(c.inconclusiveViews).toHaveLength(9);
    expect(c.escalatedViews).toEqual([]);
    expect(c.blockingViews).toHaveLength(9);
    expect(c.perView.every((v) => v.straddles)).toBe(true);
  });

  it('a view that clears on only some passes lowers its count and blocks certification', () => {
    // view 4 clears 4/6 (below bar on 2 passes) — its LCB stays under the floor.
    const list = passes(6, 5.0).map((p, k) => {
      if (k >= 4) p[3].score = 4.0; // 2 of 6 below the 4.7 bar for view 4
      return p;
    });
    const c = certifyPairwiseConfirmed({ passes: list, bars: BARS });
    expect(c.clearedCounts[3]).toBe(4);
    expect(c.certified).toBe(false);
    expect(c.blockingViews).toContain(4);
  });

  it('a null / inconclusive per-pass score never counts as a clear', () => {
    const list = passes(6, 5.0);
    list[0][2].score = null; // view 3 unscored on pass 1
    list[1][2].inconclusive = true; // view 3 coin-flip on pass 2
    const c = certifyPairwiseConfirmed({ passes: list, bars: BARS });
    expect(c.clearedCounts[2]).toBe(4); // 4 of 6 passes cleared view 3
  });

  it('a persistently gemma-CONTESTED view blocks even when it clears every pass', () => {
    const c = certifyPairwiseConfirmed({ passes: passes(6, 5.0), bars: BARS, contestedViews: [3] });
    expect(c.certified).toBe(false);
    expect(c.contestedViews).toEqual([3]);
    expect(c.blockingViews).toContain(3);
    expect(c.perView[2].cleared).toBe(false);
    // the other eight views still certify by LCB.
    expect(c.perView.filter((v) => v.cleared)).toHaveLength(8);
  });

  it('broadcasts a scalar bar across all views', () => {
    const c = certifyPairwiseConfirmed({ passes: passes(6, 4.8), bars: 4.7 });
    expect(c.certified).toBe(true);
    const below = certifyPairwiseConfirmed({ passes: passes(6, 4.6), bars: 4.7 });
    expect(below.certified).toBe(false);
    expect(below.blockingViews).toHaveLength(9);
  });

  it('is not certified on an empty confirmation set', () => {
    const c = certifyPairwiseConfirmed({ passes: [], bars: BARS });
    expect(c.certified).toBe(false);
    expect(c.passesUsed).toBe(0);
    expect(c.totalViews).toBe(0);
  });

  it('attaches an R7 resolution + flip-rate noise budget record', () => {
    const c = certifyPairwiseConfirmed({ passes: passes(6, 5.0), bars: BARS });
    expect(c.resolution).toMatchObject({ alpha: 0.05, power: 0.8, n: 6 });
    expect(typeof c.resolution.flipRate).toBe('number');
    expect(typeof c.resolution.worstViewMargin).toBe('number');
    // a supplied flip rate overrides the empirical estimate.
    const withFlip = certifyPairwiseConfirmed({ passes: passes(6, 5.0), bars: BARS, flipRate: 0.2 });
    expect(withFlip.resolution.flipRate).toBe(0.2);
    expect(withFlip.resolution.mde).toBeGreaterThan(0);
  });
});

describe('computePairwiseStop — CONFIRMATION-gated threshold (R2/R3)', () => {
  const singlePassCertified = { certified: true, allCleared: true, inconclusiveViews: [], contestedViews: [] };

  function confirmedVerdict(over = {}) {
    return {
      certified: false,
      worstViewLCB: 0.64,
      passesUsed: 6,
      inconclusiveViews: [],
      contestedViews: [],
      blockingViews: [],
      resolution: { alpha: 0.05, power: 0.8, n: 6, flipRate: 0.1, mde: 0.05, worstViewMargin: 0.5, resolvable: true },
      ...over,
    };
  }

  it('banks a threshold stop when the CONFIRMATION set certified', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 8'] },
      certify: singlePassCertified,
      confirmed: confirmedVerdict({ certified: true }),
    });
    expect(out.stop).toBe(true);
    expect(out.certified).toBe(true);
    expect(out.reasons[0]).toContain('CONFIRMED');
    expect(out.reasons[0]).toContain('resolution');
  });

  it('downgrades to "NOT confirmed (continuing)" when the confirmation failed (inconclusive views)', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 8'] },
      certify: singlePassCertified,
      confirmed: confirmedVerdict({ certified: false, inconclusiveViews: [3, 7], blockingViews: [3, 7] }),
    });
    expect(out.stop).toBe(false);
    expect(out.certified).toBe(false);
    expect(out.reasons[0]).toContain('NOT confirmed');
    expect(out.reasons[0]).toContain('inconclusive after e-process [3, 7]');
  });

  it('reports below-LCB-floor unresolved views (distinct from inconclusive/contested)', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 8'] },
      certify: singlePassCertified,
      confirmed: confirmedVerdict({ certified: false, blockingViews: [4, 5] }),
    });
    expect(out.stop).toBe(false);
    expect(out.reasons[0]).toContain('views below the LCB floor [4, 5]');
  });

  it('reports a resolution-limited block when the worst-view margin is below the MDE', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 8'] },
      certify: singlePassCertified,
      confirmed: confirmedVerdict({
        certified: false,
        blockingViews: [],
        resolution: { alpha: 0.05, power: 0.8, n: 3, flipRate: 0.4, mde: 0.71, worstViewMargin: 0.17, resolvable: false },
      }),
    });
    expect(out.stop).toBe(false);
    expect(out.reasons[0]).toContain('below resolution 0.710');
  });

  it('the confirmation verdict OVERRIDES a passing single-pass certify', () => {
    const out = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 8'] },
      certify: singlePassCertified, // single pass said certified...
      confirmed: confirmedVerdict({ certified: false, inconclusiveViews: [1] }), // ...confirmation says no
    });
    expect(out.stop).toBe(false);
    expect(out.certified).toBe(false);
  });

  it('still stops on budget while downgrading an unconfirmed threshold in the same batch', () => {
    const out = computePairwiseStop({
      claudeStop: {
        reasons: ['threshold: all 9 views >= bars on iteration 12', 'budget: 12/12 iterations used'],
      },
      certify: singlePassCertified,
      confirmed: confirmedVerdict({ certified: false, inconclusiveViews: [2] }),
    });
    expect(out.stop).toBe(true); // budget still stops
    expect(out.reasons[0]).toContain('NOT confirmed');
    expect(out.reasons[1]).toMatch(/^budget:/);
  });

  it('is byte-identical to the legacy single-pass gate when no confirmed verdict is supplied', () => {
    const withoutConfirmed = computePairwiseStop({
      claudeStop: { reasons: ['threshold: all 9 views >= bars on iteration 5'] },
      certify: singlePassCertified,
    });
    expect(withoutConfirmed.stop).toBe(true);
    expect(withoutConfirmed.certified).toBe(true);
    expect(withoutConfirmed.reasons[0]).toMatch(/^threshold:/);
  });
});
