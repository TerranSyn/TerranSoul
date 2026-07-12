// PURE calibration math + sidecar schema for the `--judge opus-pairwise` gating
// track of the Boeing 747 primitives vision benchmark (CALIBRATION_SPEC).
//
// WHY A SIDECAR (not rubric.json): the frozen rubric.json is still version 2 and
// carries the gemma track's stamped `rubric_sha256`. The legacy
// calibrate-opus-panel.mjs --write path mutates rubric.json (bumps it to v3),
// which would DRIFT the frozen gemma track's sha. This track therefore keeps ALL
// pairwise calibration in a SEPARATE sidecar (calibration/opus-pairwise.json) so
// rubric.json stays byte-identical. loop-runner reads it via loadPairwiseConfig()
// ONLY on the opus-pairwise path; the frozen loadRubric()/gemma path is untouched.
//
// WHAT THE BAR MEANS: scoring is candidate-vs-a-fixed-reference-BUILD, so parity
// 0.5 (per-view score 5.0) IS "as good as the reference 747 on this view". The
// per-view calibrated bar is 5.0 minus a measured margin. HONEST LABEL: clearing
// the bar == ">= the best build found, photo-anchored; converges to the actor's
// own ceiling, not photo-parity" — NEVER "=~ a real 747" (review fix: reframe the
// headline).
//
// THREE HEALTH-GATE PROBES feed this math (measured live by
// calibrate-opus-pairwise.mjs, NEVER hand-set — never fake a number):
//   - PROBE A (identity/anchor): candidate:=reference => true parity 5.0. The
//     measured P_hat_v exposes residual self/position bias the order-swap did not
//     cancel. anchorCheck ABORTS calibration if any view's residual is too large.
//   - PROBE B (noise band): two independent identity panels => per-view sigma_v
//     and total-level epsilon_total (the SINGLE measured noise number the
//     edit-gate also consumes, so accept/reject and calibration share one source).
//   - PROBE C (discrimination/anti-saturation): candidate:=a known-weaker build =>
//     every view must map clearly BELOW its bar, proving the judge discriminates.
//
// REVIEW FIX #3 (blocking): the certified Probe-A self-bias residual must NEVER
// exceed the per-view bar margin. So the margin is
//   margin_v(parity) = max(base_margin, z*sigma_v/10, |P_hat_v - 5.0|/10)
// (everything in parity-fraction units; per-view SCORE units are /10 of parity),
// and epsilon_anchor is required to sit BELOW the smallest bar margin — otherwise
// calibration ABORTS. That closes the "certified bias leaks into false clears"
// gap the review flagged (the old floor 0.03 was 6-8x smaller than the 0.25
// anchor tolerance).
//
// This whole module is PURE (loadPairwiseConfig is the sole thin I/O helper, with
// an injectable read seam) so every bar/margin/probe rule is directly vitest-
// covered offline — no GPU, no CLI, no network (see lib/pairwise-config.test.mjs).
import { existsSync, readFileSync } from 'node:fs';

/** Sidecar schema version (bump only on an incompatible field change). */
export const PAIRWISE_CONFIG_VERSION = 1;

/** True-parity per-view score: candidate exactly ties the reference build. */
export const PARITY_ANCHOR_SCORE = 5.0;

/**
 * Base per-view bar margin in PARITY-FRACTION units (0..1). 0.03 parity == 0.3
 * SCORE points below the 5.0 parity anchor — a small robustness cushion so a
 * candidate within judge noise of the reference still clears.
 */
export const DEFAULT_BASE_MARGIN = 0.03;

/** z-multiplier on the measured per-view noise sigma when sizing the margin. */
export const DEFAULT_Z = 2;

/** Hard floor on the per-view bar (SCORE units) — the bar never drops below this. */
export const DEFAULT_BAR_FLOOR = 4.5;

/**
 * Default panels-per-view K. Review fix: default K=1 (order-swap only, 18 calls/
 * pass) unless Probe-B noise demands K=2 (36 calls) — cost/latency discipline.
 */
export const DEFAULT_K = 1;

/**
 * Probe-A anchor tolerance (SCORE units). Review fix #3 tightens it to WELL below
 * the smallest bar margin (was 0.25, 6-8x the old floor). A residual above this —
 * or above the view's own bar margin — ABORTS calibration.
 */
export const DEFAULT_EPSILON_ANCHOR = 0.1;

/** Probe-C discrimination drop (SCORE units): a weak build must sit >= this below each bar. */
export const DEFAULT_DISCRIMINATION_DROP = 0.7;

/** Cross-family gemma veto band (SCORE units): see judge-pairwise gemma CONTESTED veto. */
export const DEFAULT_GEMMA_VETO_BAND = 1.0;

/**
 * Noise thresholds (SCORE units) above which Probe-B demands K=2 rather than the
 * default K=1: a per-view sigma or a total-level epsilon this large means one
 * order-swap panel is too noisy to certify on.
 */
export const K2_SIGMA_THRESHOLD = 0.5;
export const K2_EPSILON_TOTAL_THRESHOLD = 2.0;

/** Round to 2 decimals (matches the frozen per-view/median rounding). */
function round2(x) {
  return Math.round(x * 100) / 100;
}

/** Round to 4 decimals (for the finer sigma/epsilon fields). */
function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}

/** Finite-number guard (null/undefined/NaN/Infinity => false). */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Population standard deviation of a numeric array (non-finite values dropped).
 * Population (÷N) not sample (÷N-1) so a 2-panel spread {a,b} yields |a-b|/2 — the
 * intuitive half-spread the calibration uses as its measured noise unit. Empty /
 * single-value input => 0 (no measurable spread).
 */
export function std(values) {
  const nums = (Array.isArray(values) ? values : []).filter(isNum);
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nums.length;
  return Math.sqrt(variance);
}

/** Mean of a numeric array (non-finite values dropped); empty => null. */
export function mean(values) {
  const nums = (Array.isArray(values) ? values : []).filter(isNum);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Derive ONE per-view calibrated bar from the measured Probe-A anchor (`pHat`,
 * SCORE units, ideally 5.0) and Probe-B noise (`sigma`, SCORE units).
 *
 * REVIEW FIX #3: the margin is the MAX of the base cushion, the noise-scaled
 * margin, and the certified self-bias residual — all in PARITY-FRACTION units, so
 * `residualScore/10` and `z*sigma/10` convert SCORE units to parity fraction. By
 * construction the pre-floor bar margin (5.0 - rawBar = 10*marginParity) is >=
 * residualScore, so the certified bias can never exceed the bar margin. The ONLY
 * way that invariant breaks is if the hard floor RAISES the bar and shrinks the
 * effective margin below the residual — flagged `invariantViolated` (an ABORT).
 *
 * @param {Object} p
 * @param {number} p.pHat    measured identity/anchor per-view score (~5.0).
 * @param {number} p.sigma   measured per-view noise std (SCORE units).
 * @param {number} [p.baseMargin] parity-fraction base margin (default 0.03).
 * @param {number} [p.z]           noise multiplier (default 2).
 * @param {number} [p.floor]       hard bar floor, SCORE units (default 4.5).
 * @returns {{bar:number, marginParity:number, marginScore:number,
 *   residualScore:number, floored:boolean, invariantViolated:boolean}}
 */
export function deriveBar({
  pHat,
  sigma,
  baseMargin = DEFAULT_BASE_MARGIN,
  z = DEFAULT_Z,
  floor = DEFAULT_BAR_FLOOR,
}) {
  const residualScore = isNum(pHat) ? Math.abs(pHat - PARITY_ANCHOR_SCORE) : Infinity;
  const s = isNum(sigma) ? Math.max(0, sigma) : 0;
  const marginParity = Math.max(baseMargin, (z * s) / 10, residualScore / 10);
  const rawBar = 10 * (0.5 - marginParity); // SCORE units: 5.0 - 10*marginParity
  const bar = round2(Math.max(floor, rawBar));
  // Effective margin AFTER the floor (SCORE units). If the floor raised the bar,
  // this is smaller than 10*marginParity and may fall below the residual.
  const marginScore = round2(PARITY_ANCHOR_SCORE - bar);
  const floored = bar > round2(rawBar);
  const invariantViolated = !isNum(pHat) || residualScore > marginScore + 1e-9;
  return {
    bar,
    marginParity: round4(marginParity),
    marginScore,
    residualScore: isNum(pHat) ? round4(residualScore) : null,
    floored,
    invariantViolated,
  };
}

/**
 * Per-view mean (P_hat) across the identity panels — one value per view.
 * `panelPerViewScores` is an array of panels, each a length-N per-view score
 * array (e.g. [panelA, panelB]). Returns a length-N array of means (null where a
 * view has no finite score in any panel).
 */
export function perViewMean(panelPerViewScores) {
  return transposeViews(panelPerViewScores).map((col) => mean(col));
}

/**
 * Per-view noise sigma across the identity panels — one std per view (SCORE
 * units). Same input shape as perViewMean.
 */
export function perViewSigma(panelPerViewScores) {
  return transposeViews(panelPerViewScores).map((col) => round4(std(col)));
}

/** Transpose [panel][view] -> [view][panel], padding shorter panels with holes. */
function transposeViews(panelPerViewScores) {
  const panels = Array.isArray(panelPerViewScores) ? panelPerViewScores : [];
  const nViews = panels.reduce((m, p) => Math.max(m, Array.isArray(p) ? p.length : 0), 0);
  const cols = [];
  for (let v = 0; v < nViews; v++) cols.push(panels.map((p) => (Array.isArray(p) ? p[v] : undefined)));
  return cols;
}

/**
 * Total-level noise epsilon = std of the per-panel run totals (SCORE / 0..100
 * units). This is the SINGLE measured noise number the edit-gate's epsilonTotal
 * also consumes, so accept/reject and calibration never disagree about noise.
 */
export function epsilonTotalFromTotals(totals) {
  return round4(std(totals));
}

/**
 * PROBE A predicate. Passes ONLY when every view's certified anchor residual
 * |P_hat_v - 5.0| is within BOTH the anchor tolerance AND that view's own bar
 * margin (review fix #3: the certified bias must never exceed the bar margin).
 * Also reports whether epsilon_anchor sits below the smallest bar margin (the
 * coupling the review demands) — a false there is an ABORT condition.
 *
 * @param {Object} p
 * @param {number[]} p.pHatPerView   measured identity per-view scores.
 * @param {Array<{bar:number, marginScore:number}>} p.barDetails  from deriveBar.
 * @param {number} [p.epsilonAnchor]
 * @returns {{passed:boolean, epsilonAnchor:number, smallestBarMargin:number,
 *   epsilonBelowBars:boolean, perView:Array}}
 */
export function anchorCheck({ pHatPerView, barDetails, epsilonAnchor = DEFAULT_EPSILON_ANCHOR }) {
  const details = Array.isArray(barDetails) ? barDetails : [];
  const smallestBarMargin = details.length
    ? Math.min(...details.map((d) => (isNum(d.marginScore) ? d.marginScore : Infinity)))
    : Infinity;
  const epsilonBelowBars = epsilonAnchor <= smallestBarMargin + 1e-9;
  const perView = (Array.isArray(pHatPerView) ? pHatPerView : []).map((pHat, i) => {
    const residual = isNum(pHat) ? Math.abs(pHat - PARITY_ANCHOR_SCORE) : Infinity;
    const barMargin = details[i] && isNum(details[i].marginScore) ? details[i].marginScore : Infinity;
    const withinEpsilon = residual <= epsilonAnchor + 1e-9;
    const withinMargin = residual <= barMargin + 1e-9;
    return {
      view: i + 1,
      pHat: isNum(pHat) ? round2(pHat) : null,
      residual: isNum(pHat) ? round4(residual) : null,
      withinEpsilon,
      withinMargin,
    };
  });
  const passed =
    perView.length > 0 &&
    epsilonBelowBars &&
    perView.every((v) => v.withinEpsilon && v.withinMargin);
  return {
    passed,
    epsilonAnchor,
    smallestBarMargin: isNum(smallestBarMargin) ? round4(smallestBarMargin) : null,
    epsilonBelowBars,
    perView,
  };
}

/**
 * PROBE C predicate. Passes ONLY when the known-weaker build maps CLEARLY below
 * every view's bar (weak_v <= bar_v - drop), proving the judge discriminates and
 * is not saturated. A weak view scoring null (unjudged) fails the check for that
 * view (a saturated judge that can't score the weak build is not trustworthy).
 *
 * @param {Object} p
 * @param {number[]} p.weakPerView  Probe-C per-view scores (weak candidate).
 * @param {number[]} p.bars         calibrated per-view bars (SCORE units).
 * @param {number} [p.drop]
 * @returns {{passed:boolean, drop:number, perView:Array}}
 */
export function discriminationCheck({ weakPerView, bars, drop = DEFAULT_DISCRIMINATION_DROP }) {
  const weak = Array.isArray(weakPerView) ? weakPerView : [];
  const barArr = Array.isArray(bars) ? bars : [];
  const perView = barArr.map((bar, i) => {
    const w = weak[i];
    const ceiling = isNum(bar) ? bar - drop : null;
    const below = isNum(w) && isNum(ceiling) ? w <= ceiling + 1e-9 : false;
    return {
      view: i + 1,
      weakScore: isNum(w) ? round2(w) : null,
      ceiling: isNum(ceiling) ? round2(ceiling) : null,
      below,
    };
  });
  const passed = perView.length > 0 && perView.every((v) => v.below);
  return { passed, drop, perView };
}

/**
 * Recommend K (panels/view) from the measured Probe-B noise: default K=1 unless
 * any per-view sigma or the total epsilon crosses the K2 thresholds, in which
 * case one order-swap panel is too noisy and K=2 is recommended (review fix on
 * the 36-calls-per-iteration cost/latency concern).
 */
export function recommendK({ perViewSigma: sigmas, epsilonTotal }) {
  const maxSigma = (Array.isArray(sigmas) ? sigmas : []).filter(isNum).reduce((m, s) => Math.max(m, s), 0);
  const noisy = maxSigma > K2_SIGMA_THRESHOLD || (isNum(epsilonTotal) && epsilonTotal > K2_EPSILON_TOTAL_THRESHOLD);
  return noisy ? 2 : 1;
}

/**
 * PURE end-to-end calibration assembly from the three probes' RAW measurements —
 * the testable core the live calibrate-opus-pairwise.mjs feeds after it renders
 * the reference and runs the probes. Derives the bars + margins, runs the Probe-A
 * anchor and Probe-C discrimination predicates, computes the noise epsilons, and
 * returns an ABORT verdict (with reasons) whenever the judge cannot be trusted:
 * anchor residual too large, the certified bias exceeds a bar margin, epsilon_
 * anchor not below the smallest bar margin, or the judge fails to discriminate.
 *
 * @param {Object} p
 * @param {number[][]} p.identityPanels  per-panel per-view identity scores (>=2).
 * @param {number[]}   p.identityTotals  per-panel run totals (>=2).
 * @param {number[]}   p.weakPerView     Probe-C weak-build per-view scores.
 * @param {Object}     [p.options]       baseMargin/z/floor/epsilonAnchor/drop overrides.
 * @returns {Object} { bars, barDetails, pHatPerView, perViewSigma, epsilonTotal,
 *   epsilonView, anchor, discrimination, recommendedK, abort, abortReasons }
 */
export function computeCalibration({ identityPanels, identityTotals, weakPerView, options = {} }) {
  const {
    baseMargin = DEFAULT_BASE_MARGIN,
    z = DEFAULT_Z,
    floor = DEFAULT_BAR_FLOOR,
    epsilonAnchor = DEFAULT_EPSILON_ANCHOR,
    drop = DEFAULT_DISCRIMINATION_DROP,
  } = options;

  const pHatPerView = perViewMean(identityPanels);
  const sigmas = perViewSigma(identityPanels);
  const epsilonTotal = epsilonTotalFromTotals(identityTotals);

  const barDetails = pHatPerView.map((pHat, i) =>
    deriveBar({ pHat, sigma: sigmas[i], baseMargin, z, floor }),
  );
  const bars = barDetails.map((d) => d.bar);

  // epsilon_view (SCORE units) the edit-gate consumes: the measured per-view
  // noise, floored at the base cushion so a deterministic-looking panel does not
  // yield a hyper-sensitive zero-tolerance gate. base_margin is parity fraction,
  // *10 -> SCORE units.
  const maxSigma = sigmas.filter(isNum).reduce((m, s) => Math.max(m, s), 0);
  const epsilonView = round2(Math.max(baseMargin * 10, maxSigma));

  const anchor = anchorCheck({ pHatPerView, barDetails, epsilonAnchor });
  const discrimination = discriminationCheck({ weakPerView, bars, drop });
  const recommendedK = recommendK({ perViewSigma: sigmas, epsilonTotal });

  const abortReasons = [];
  if (!anchor.passed) {
    abortReasons.push(
      'PROBE A (identity/anchor) failed: a view\'s certified self-bias residual exceeds the anchor ' +
        'tolerance or its own bar margin — the order-swap did not cancel residual position/self bias, ' +
        'so no bar can be trusted. Fix the prompt/order logic and recalibrate.',
    );
  }
  if (!anchor.epsilonBelowBars) {
    abortReasons.push(
      `epsilon_anchor (${epsilonAnchor}) is not below the smallest bar margin ` +
        `(${anchor.smallestBarMargin}) — a certified residual could leak into a false clear (review fix #3).`,
    );
  }
  if (barDetails.some((d) => d.invariantViolated)) {
    abortReasons.push(
      'the hard bar floor shrank a view\'s effective margin below its certified anchor residual — ' +
        'the certified bias would exceed the bar margin. Recalibrate (reduce noise / fix the anchor).',
    );
  }
  if (!discrimination.passed) {
    abortReasons.push(
      'PROBE C (discrimination) failed: the known-weaker build did not map clearly below every bar — ' +
        'the judge is saturated / not discriminating, so a passing candidate would be meaningless.',
    );
  }

  return {
    bars,
    barDetails,
    pHatPerView: pHatPerView.map((v) => (isNum(v) ? round2(v) : null)),
    perViewSigma: sigmas,
    epsilonTotal,
    epsilonView,
    anchor,
    discrimination,
    recommendedK,
    abort: abortReasons.length > 0,
    abortReasons,
  };
}

/**
 * Build the committed sidecar object (calibration/opus-pairwise.json) from the
 * pure calibration result plus the live reference-render metadata and the frozen
 * gemma reference scores. Shape is the CALIBRATION_SPEC sidecar contract.
 *
 * @param {Object} p
 * @param {Object} p.calibration        computeCalibration() output.
 * @param {Object} p.referenceMeta      the reference-render meta.json (rig stamp).
 * @param {string} p.refShotsDir        cached reference-shots dir (judge-only).
 * @param {number} p.K                  chosen panels/view for the loop.
 * @param {number[]} p.gemmaReferencePerView  frozen gemma pointwise per-view scores.
 * @param {Object} [p.options]          margin/z/gemmaVetoBand/epsilonAnchor/drop.
 * @param {string} [p.judgeModel]
 * @returns {Object} the sidecar JSON object.
 */
export function buildPairwiseSidecar({
  calibration,
  referenceMeta,
  refShotsDir,
  K,
  gemmaReferencePerView,
  options = {},
  judgeModel = 'claude-opus-4-8',
}) {
  const {
    baseMargin = DEFAULT_BASE_MARGIN,
    z = DEFAULT_Z,
    floor = DEFAULT_BAR_FLOOR,
    epsilonAnchor = DEFAULT_EPSILON_ANCHOR,
    drop = DEFAULT_DISCRIMINATION_DROP,
    gemmaVetoBand = DEFAULT_GEMMA_VETO_BAND,
  } = options;
  const meta = referenceMeta || {};
  return {
    config_version: PAIRWISE_CONFIG_VERSION,
    protocol: meta.protocol || 'boeing747-primitives-vision-bench',
    judge_model: judgeModel,
    created_at: new Date().toISOString(),
    // Reference build + rig stamp (review fix #6: loop-runner refuses to score a
    // candidate whose rig meta differs from this).
    reference_plane: meta.planePath || null,
    reference_plane_sha256: meta.planeSha256 || null,
    ref_shots_dir: refShotsDir || null,
    reference_rig: {
      camera_spec_version: meta.cameraSpecVersion ?? null,
      three_revision: meta.threeRevision ?? null,
      supersample: meta.supersample ?? 1,
    },
    // Panels/view and the margin knobs used.
    K: Number.isInteger(K) && K > 0 ? K : DEFAULT_K,
    base_margin: baseMargin,
    z,
    bar_floor: floor,
    epsilon_anchor: epsilonAnchor,
    discrimination_drop: drop,
    // The calibrated per-view bars the loop-runner sets as claudeStopCfg.viewThreshold.
    view_threshold_calibrated_pairwise: calibration.bars,
    bar_margins_score: calibration.barDetails.map((d) => d.marginScore),
    // Measured noise (edit-gate consumes epsilon_total / epsilon_view).
    per_view_sigma: calibration.perViewSigma,
    epsilon_total: calibration.epsilonTotal,
    epsilon_view: calibration.epsilonView,
    // Cross-family gemma reference scores + veto band.
    gemma_reference_per_view: Array.isArray(gemmaReferencePerView) ? gemmaReferencePerView : null,
    gemma_veto_band: gemmaVetoBand,
    // Standing judge-health probe verdicts.
    anchor_check: {
      passed: calibration.anchor.passed,
      epsilon_anchor: calibration.anchor.epsilonAnchor,
      smallest_bar_margin: calibration.anchor.smallestBarMargin,
      epsilon_below_bars: calibration.anchor.epsilonBelowBars,
      p_hat_per_view: calibration.pHatPerView,
      per_view: calibration.anchor.perView,
    },
    discrimination_check: {
      passed: calibration.discrimination.passed,
      drop: calibration.discrimination.drop,
      per_view: calibration.discrimination.perView,
    },
    // HONEST LABEL (review fix: reframe the headline).
    note:
      'Clearing every per-view bar == ">= the best build found, photo-anchored; converges to the ' +
      "actor's own ceiling, not photo-parity\" — NOT \"indistinguishable from a real 747 photograph\". " +
      'The reference build\'s own residual gap to a real 747 is a disclosed methodological bound. ' +
      'Sidecar keeps rubric.json byte-identical (the frozen gemma primitives record is unaffected).',
  };
}

/** Required sidecar keys — validated on load so a truncated file fails loudly. */
const REQUIRED_SIDECAR_KEYS = Object.freeze([
  'config_version',
  'view_threshold_calibrated_pairwise',
  'K',
  'epsilon_total',
  'epsilon_view',
  'gemma_veto_band',
  'anchor_check',
  'reference_plane_sha256',
  'reference_rig',
]);

/**
 * Validate a parsed sidecar object. Throws a clear error listing every missing /
 * malformed field so a partial calibration write is caught at load time rather
 * than silently mis-gating a run. Returns the object unchanged on success.
 */
export function validatePairwiseSidecar(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error('pairwise sidecar is not an object');
  }
  const problems = [];
  for (const key of REQUIRED_SIDECAR_KEYS) {
    if (!(key in cfg)) problems.push(`missing '${key}'`);
  }
  const bars = cfg.view_threshold_calibrated_pairwise;
  if (!Array.isArray(bars) || bars.length === 0) {
    problems.push('view_threshold_calibrated_pairwise must be a non-empty array');
  } else if (!bars.every((b) => typeof b === 'number' && Number.isFinite(b))) {
    problems.push('view_threshold_calibrated_pairwise must be all finite numbers');
  }
  if (problems.length > 0) {
    throw new Error(`invalid pairwise sidecar: ${problems.join('; ')}`);
  }
  return cfg;
}

/**
 * Load + validate the pairwise sidecar. THIN I/O (the only non-pure fn here) with
 * injectable `readImpl`/`existsImpl` seams so it is unit-testable without a real
 * file. FAIL-LOUD with an actionable message when the sidecar is absent — the
 * opus-pairwise track cannot gate without a calibrated bar (loop-runner surfaces
 * this and refuses to run the pairwise path uncalibrated).
 *
 * @param {string} sidecarPath
 * @param {{readImpl?:Function, existsImpl?:Function}} [seams]
 * @returns {Object} the validated sidecar.
 */
export function loadPairwiseConfig(sidecarPath, seams = {}) {
  const { readImpl = readFileSync, existsImpl = existsSync } = seams;
  const read = readImpl;
  const exists = existsImpl;
  if (!exists(sidecarPath)) {
    throw new Error(
      `pairwise calibration sidecar not found at ${sidecarPath} — run ` +
        '`node benchmark/boeing747/calibrate-opus-pairwise.mjs` to render the reference build and ' +
        'write the calibrated bar before running the --judge opus-pairwise loop.',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(read(sidecarPath, 'utf8'));
  } catch (err) {
    throw new Error(`pairwise sidecar at ${sidecarPath} is not valid JSON: ${err.message}`, { cause: err });
  }
  return validatePairwiseSidecar(parsed);
}
