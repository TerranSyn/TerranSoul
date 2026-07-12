import { describe, expect, it } from 'vitest';
import { calibrateFromProbes, perViewScores } from './calibrate-opus-pairwise.mjs';

// The probe->sidecar ASSEMBLY is pure — it consumes canned judge-result objects
// (the exact shape judgeShotsPairwise / judgeShots emit) with NO rig, CLI or GPU.
// Importing this module for these helpers must NOT load Playwright or the judges
// (the live deps are dynamically imported only inside runCalibration).

/** A canned judge result: per_view[1..9] each with `score`, plus a run total. */
function cannedResult(scorePerView, total) {
  return {
    per_view: Array.from({ length: 9 }, (_, i) => ({ view: i + 1, key: `v${i + 1}`, score: scorePerView })),
    total_0_100: total,
  };
}

const referenceMeta = {
  planePath: 'benchmark/boeing747/candidates/terransoul-opus48/plane.js',
  planeSha256: 'deadbeef',
  cameraSpecVersion: 2,
  threeRevision: '160',
  supersample: 3,
};

describe('perViewScores', () => {
  it('extracts scores ordered by the frozen VIEWS 1..9', () => {
    const res = {
      per_view: [
        { view: 2, score: 6 },
        { view: 1, score: 5 },
      ],
    };
    const scores = perViewScores(res);
    expect(scores[0]).toBe(5); // view 1
    expect(scores[1]).toBe(6); // view 2
    expect(scores[2]).toBeNull(); // view 3 missing -> null (never 0)
  });

  it('maps a non-numeric score to null', () => {
    const res = { per_view: [{ view: 1, score: null }] };
    expect(perViewScores(res)[0]).toBeNull();
  });
});

describe('calibrateFromProbes — pure assembly of the sidecar', () => {
  it('assembles a clean, non-aborting sidecar from identity/weak/gemma results', () => {
    const { calibration, sidecar } = calibrateFromProbes({
      identityResults: [cannedResult(5.0, 50), cannedResult(5.0, 50)],
      weakResult: cannedResult(3.0, 30),
      gemmaResult: cannedResult(6.0, 60),
      referenceMeta,
      refShotsDir: 'benchmark/boeing747/calibration/ref-shots',
    });
    expect(calibration.abort).toBe(false);
    expect(sidecar.view_threshold_calibrated_pairwise).toEqual(Array.from({ length: 9 }, () => 4.7));
    expect(sidecar.gemma_reference_per_view).toEqual(Array.from({ length: 9 }, () => 6.0));
    expect(sidecar.reference_rig.supersample).toBe(3);
    expect(sidecar.K).toBe(1);
    expect(sidecar.anchor_check.passed).toBe(true);
    expect(sidecar.discrimination_check.passed).toBe(true);
  });

  it('surfaces an ABORT when the identity probe shows a certified self-bias', () => {
    const biased = cannedResult(5.0, 50);
    biased.per_view[3].score = 5.6; // one view biased above true parity
    const { calibration } = calibrateFromProbes({
      identityResults: [biased, { ...biased }],
      weakResult: cannedResult(3.0, 30),
      gemmaResult: cannedResult(6.0, 60),
      referenceMeta,
      refShotsDir: 'x',
    });
    expect(calibration.abort).toBe(true);
    expect(calibration.abortReasons.length).toBeGreaterThan(0);
  });

  it('surfaces an ABORT when the judge cannot discriminate the weak build', () => {
    const { calibration } = calibrateFromProbes({
      identityResults: [cannedResult(5.0, 50), cannedResult(5.0, 50)],
      weakResult: cannedResult(4.6, 46), // above bar 4.7 - 0.7
      gemmaResult: cannedResult(6.0, 60),
      referenceMeta,
      refShotsDir: 'x',
    });
    expect(calibration.abort).toBe(true);
    expect(calibration.discrimination.passed).toBe(false);
  });
});
