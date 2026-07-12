import { describe, expect, it } from 'vitest';
import {
  anchorCheck,
  buildPairwiseSidecar,
  computeCalibration,
  DEFAULT_BAR_FLOOR,
  deriveBar,
  discriminationCheck,
  epsilonTotalFromTotals,
  loadPairwiseConfig,
  mean,
  PAIRWISE_CONFIG_VERSION,
  perViewMean,
  perViewSigma,
  recommendK,
  std,
  validatePairwiseSidecar,
} from './pairwise-config.mjs';

// Every rule below is PURE — plain numbers in, no rig, no CLI, no filesystem
// (loadPairwiseConfig is exercised only through injected read/exists seams).
// Mirrors the transport-free discipline of lib/pairwise-parse.test.mjs.

/** Build a length-9 per-view score array with one constant value (or overrides). */
function nine(value, overrides = {}) {
  const arr = Array.from({ length: 9 }, () => value);
  for (const [i, v] of Object.entries(overrides)) arr[Number(i)] = v;
  return arr;
}

describe('std / mean', () => {
  it('population std of a 2-sample spread is half the gap', () => {
    expect(std([70, 72])).toBe(1); // |70-72|/2
    expect(std([5, 5])).toBe(0);
  });
  it('drops non-finite and returns 0 for <2 usable values', () => {
    expect(std([5, null, undefined, NaN])).toBe(0);
    expect(std([])).toBe(0);
  });
  it('mean drops non-finite; empty => null', () => {
    expect(mean([5, 5.2, null])).toBeCloseTo(5.1, 6);
    expect(mean([])).toBeNull();
  });
});

describe('deriveBar — parity anchor, margin, and the review-fix-#3 invariant', () => {
  it('a perfect identity (pHat=5, no noise) yields the base-margin bar 4.7', () => {
    const d = deriveBar({ pHat: 5.0, sigma: 0 });
    expect(d.bar).toBe(4.7); // 10*(0.5 - 0.03)
    expect(d.marginScore).toBe(0.3);
    expect(d.residualScore).toBe(0);
    expect(d.floored).toBe(false);
    expect(d.invariantViolated).toBe(false);
  });

  it('absorbs a small residual inside the base margin (no invariant violation)', () => {
    const d = deriveBar({ pHat: 5.2, sigma: 0 }); // residual 0.2 -> parity 0.02 < 0.03
    expect(d.bar).toBe(4.7);
    expect(d.marginScore).toBe(0.3);
    expect(d.invariantViolated).toBe(false);
  });

  it('grows the margin to cover a residual bigger than the base margin', () => {
    const d = deriveBar({ pHat: 5.4, sigma: 0 }); // residual 0.4 -> parity 0.04
    expect(d.bar).toBe(4.6); // 10*(0.5 - 0.04)
    expect(d.marginScore).toBe(0.4);
    expect(d.residualScore).toBe(0.4);
    expect(d.invariantViolated).toBe(false); // residual 0.4 == margin 0.4
  });

  it('FLAGS the invariant when the hard floor shrinks the margin below the residual', () => {
    const d = deriveBar({ pHat: 5.6, sigma: 0 }); // residual 0.6 -> raw bar 4.4 -> floored 4.5
    expect(d.bar).toBe(DEFAULT_BAR_FLOOR);
    expect(d.floored).toBe(true);
    expect(d.marginScore).toBe(0.5); // 5.0 - 4.5
    expect(d.residualScore).toBe(0.6);
    expect(d.invariantViolated).toBe(true); // certified bias 0.6 > bar margin 0.5
  });

  it('a NOISY-but-unbiased view floors the bar WITHOUT violating the invariant', () => {
    const d = deriveBar({ pHat: 5.0, sigma: 1.0 }); // z*sigma/10 = 0.2 -> raw bar 3.0 -> floored 4.5
    expect(d.bar).toBe(DEFAULT_BAR_FLOOR);
    expect(d.floored).toBe(true);
    expect(d.residualScore).toBe(0);
    expect(d.invariantViolated).toBe(false); // no bias, just noise
  });

  it('a missing pHat is treated as an invariant violation (cannot certify)', () => {
    const d = deriveBar({ pHat: null, sigma: 0 });
    expect(d.residualScore).toBeNull();
    expect(d.invariantViolated).toBe(true);
  });
});

describe('perViewMean / perViewSigma / epsilonTotalFromTotals', () => {
  it('computes per-view mean and sigma across identity panels', () => {
    const panels = [
      [5, 5, 5],
      [5.2, 4.8, 5],
    ];
    expect(perViewMean(panels)).toEqual([5.1, 4.9, 5]);
    expect(perViewSigma(panels)).toEqual([0.1, 0.1, 0]);
  });
  it('epsilon_total is the std of the run totals', () => {
    expect(epsilonTotalFromTotals([70, 72])).toBe(1);
  });
});

describe('anchorCheck (PROBE A) — residual within BOTH epsilon and the bar margin', () => {
  const barDetails = nine(0).map(() => ({ bar: 4.7, marginScore: 0.3 }));
  it('passes when every residual is within epsilon and margin, and epsilon < smallest bar margin', () => {
    const a = anchorCheck({ pHatPerView: nine(5.0), barDetails, epsilonAnchor: 0.1 });
    expect(a.passed).toBe(true);
    expect(a.epsilonBelowBars).toBe(true);
    expect(a.smallestBarMargin).toBe(0.3);
  });
  it('fails when epsilon_anchor is not below the smallest bar margin', () => {
    const a = anchorCheck({ pHatPerView: nine(5.0), barDetails, epsilonAnchor: 0.5 });
    expect(a.epsilonBelowBars).toBe(false);
    expect(a.passed).toBe(false);
  });
  it('fails when a certified residual exceeds its bar margin', () => {
    // view 3 residual 0.6 > its bar margin 0.3.
    const a = anchorCheck({ pHatPerView: nine(5.0, { 2: 5.6 }), barDetails, epsilonAnchor: 0.1 });
    expect(a.passed).toBe(false);
    expect(a.perView[2].withinMargin).toBe(false);
  });
});

describe('discriminationCheck (PROBE C) — the weak build must sit clearly below the bar', () => {
  it('passes when every weak view is <= bar - drop', () => {
    const c = discriminationCheck({ weakPerView: nine(3.0), bars: nine(4.7), drop: 0.7 });
    expect(c.passed).toBe(true);
    expect(c.perView[0].ceiling).toBe(4.0);
  });
  it('fails (saturated judge) when a weak view is not below the bar', () => {
    const c = discriminationCheck({ weakPerView: nine(3.0, { 0: 4.5 }), bars: nine(4.7), drop: 0.7 });
    expect(c.passed).toBe(false);
  });
  it('fails a view whose weak score is null (judge could not score the weak build)', () => {
    const c = discriminationCheck({ weakPerView: nine(3.0, { 1: null }), bars: nine(4.7) });
    expect(c.passed).toBe(false);
    expect(c.perView[1].below).toBe(false);
  });
});

describe('recommendK — default 1, escalates to 2 only when Probe-B noise is high', () => {
  it('K=1 for low noise', () => {
    expect(recommendK({ perViewSigma: nine(0.1), epsilonTotal: 1.0 })).toBe(1);
  });
  it('K=2 when a per-view sigma is high', () => {
    expect(recommendK({ perViewSigma: nine(0.1, { 4: 0.6 }), epsilonTotal: 1.0 })).toBe(2);
  });
  it('K=2 when the total epsilon is high', () => {
    expect(recommendK({ perViewSigma: nine(0.1), epsilonTotal: 2.5 })).toBe(2);
  });
});

describe('computeCalibration — end-to-end pure assembly + abort predicates', () => {
  it('a clean reference (parity 5.0, weak build well below) does NOT abort', () => {
    const cal = computeCalibration({
      identityPanels: [nine(5.0), nine(5.0)],
      identityTotals: [50, 50],
      weakPerView: nine(3.0),
    });
    expect(cal.abort).toBe(false);
    expect(cal.abortReasons).toEqual([]);
    expect(cal.bars).toEqual(nine(4.7));
    expect(cal.anchor.passed).toBe(true);
    expect(cal.discrimination.passed).toBe(true);
    expect(cal.recommendedK).toBe(1);
  });

  it('ABORTS when a view carries a certified self-bias the floor cannot cover', () => {
    const cal = computeCalibration({
      identityPanels: [nine(5.0, { 3: 5.6 }), nine(5.0, { 3: 5.6 })],
      identityTotals: [50.5, 50.5],
      weakPerView: nine(3.0),
    });
    expect(cal.abort).toBe(true);
    expect(cal.barDetails[3].invariantViolated).toBe(true);
    expect(cal.anchor.passed).toBe(false);
    expect(cal.abortReasons.join(' ')).toMatch(/PROBE A|certified bias/);
  });

  it('ABORTS when the judge fails to discriminate (weak build not below the bar)', () => {
    const cal = computeCalibration({
      identityPanels: [nine(5.0), nine(5.0)],
      identityTotals: [50, 50],
      weakPerView: nine(4.6), // above bar 4.7 - 0.7 = 4.0
    });
    expect(cal.abort).toBe(true);
    expect(cal.discrimination.passed).toBe(false);
    expect(cal.abortReasons.join(' ')).toMatch(/PROBE C/);
  });
});

describe('buildPairwiseSidecar / validate / load', () => {
  const cal = computeCalibration({
    identityPanels: [nine(5.0), nine(5.0)],
    identityTotals: [50, 50],
    weakPerView: nine(3.0),
  });
  const referenceMeta = {
    planePath: 'benchmark/boeing747/candidates/terransoul-opus48/plane.js',
    planeSha256: 'abc123',
    cameraSpecVersion: 2,
    threeRevision: '160',
    supersample: 3,
  };
  const sidecar = buildPairwiseSidecar({
    calibration: cal,
    referenceMeta,
    refShotsDir: 'benchmark/boeing747/calibration/ref-shots',
    K: cal.recommendedK,
    gemmaReferencePerView: nine(6.0),
  });

  it('produces the CALIBRATION_SPEC sidecar shape with the rig stamp (review fix #6)', () => {
    expect(sidecar.config_version).toBe(PAIRWISE_CONFIG_VERSION);
    expect(sidecar.view_threshold_calibrated_pairwise).toEqual(nine(4.7));
    expect(sidecar.reference_plane_sha256).toBe('abc123');
    expect(sidecar.reference_rig).toEqual({ camera_spec_version: 2, three_revision: '160', supersample: 3 });
    expect(sidecar.gemma_reference_per_view).toEqual(nine(6.0));
    expect(sidecar.anchor_check.passed).toBe(true);
    expect(sidecar.discrimination_check.passed).toBe(true);
    expect(sidecar.note).toMatch(/NOT "indistinguishable from a real 747/);
  });

  it('validatePairwiseSidecar accepts the built sidecar and rejects a truncated one', () => {
    expect(() => validatePairwiseSidecar(sidecar)).not.toThrow();
    const broken = { ...sidecar };
    delete broken.view_threshold_calibrated_pairwise;
    expect(() => validatePairwiseSidecar(broken)).toThrow(/view_threshold_calibrated_pairwise/);
    expect(() => validatePairwiseSidecar(null)).toThrow(/not an object/);
  });

  it('loadPairwiseConfig round-trips through injected read/exists seams', () => {
    const cfg = loadPairwiseConfig('any/path.json', {
      existsImpl: () => true,
      readImpl: () => JSON.stringify(sidecar),
    });
    expect(cfg.view_threshold_calibrated_pairwise).toEqual(nine(4.7));
  });

  it('loadPairwiseConfig fails LOUD when the sidecar is absent', () => {
    expect(() => loadPairwiseConfig('missing.json', { existsImpl: () => false })).toThrow(
      /calibrate-opus-pairwise/,
    );
  });

  it('loadPairwiseConfig fails on malformed JSON', () => {
    expect(() =>
      loadPairwiseConfig('bad.json', { existsImpl: () => true, readImpl: () => 'not json{' }),
    ).toThrow(/not valid JSON/);
  });
});
