// PURE statistical-rigor primitives for the `--judge opus-pairwise` certification
// track of the Boeing 747 primitives vision benchmark. NO I/O, NO GPU, NO CLI,
// NO network — every function is a deterministic math transform so the whole
// certification rule is directly vitest-covered offline (see
// lib/certification-stats.test.mjs).
//
// GENERIC ON PURPOSE (rules/bench-agi-purity.md): this file has NO Boeing-747 (or
// any other benchmark) geometry, verb list, or answer-derived seed. It is a plain
// statistics library — confidence bounds, an intersection-union test, a sequential
// betting e-process, a selection-premium/shrinkage charge, and a paired-test
// resolution budget. All domain content (which views, which bars) is supplied by
// the caller; the code here only knows binomial counts and noise numbers.
//
// WHY THESE PRIMITIVES (July-2026 statistical-rigor findings, all SOURCED):
//
//   THE KEY THEORY — "100% == all 9 views clear their bar" is an INTERSECTION-
//   UNION TEST (a logical AND of 9 one-sided claims). Within ONE certification
//   event the 9 views need NO Bonferroni/FDR across views: you certify on the
//   WORST view's level-alpha lower bound (the max-p / IUT rule). Bonferroni across
//   the 9 would OVER-reject real successes. (arXiv:2605.05873 IUT; Agresti-Coull
//   2511.21140.) The real multiplicity leaks are across ITERATIONS (optional
//   stopping / winner's curse) and across STRATEGIES — handled by the shrinkage
//   charge (R3) and the strategy Wilson floor (R5), NOT by penalising the 9 views.
//
//   R1 (worst-view LCB): per view take n independent re-judge draws, count how many
//   clear the bar, and take a one-sided AGRESTI-COULL lower confidence bound
//   (alpha=0.05) on that view's pass-probability. A view is CERTIFIED-cleared iff
//   its AC-LCB >= a probability floor p_floor (default 0.5). "100%" iff ALL views
//   are certified-cleared (IUT; NO cross-view Bonferroni) AND none inconclusive/
//   contested.
//
//   R2 (confirmation e-process): for a view whose AC interval STRADDLES p_floor,
//   escalate to a sequential betting E-PROCESS — keep drawing until the e-value
//   E_t >= 1/alpha (=20 at alpha=0.05) that the view is above bar, else mark it
//   INCONCLUSIVE (never pass on a coin-flip). (SPRT 2605.19193; generator<->judge
//   independence 2407.04549.)
//
//   R3 (deflate the peak): the loop's optional-stopping at the best-looking
//   iteration is the real leak. Certify on the LCB, and charge the raw peak a
//   SELECTION PREMIUM (expected max of the per-iteration noise across the number of
//   candidates tried) + shrink toward the mean (regression-to-the-mean). (selection
//   premium arXiv:2607.07699; shrinkage 2603.12867.)
//
//   R7 (resolution report): with every "100%", the worst-view margin above bar must
//   exceed the paired-test RESOLUTION at (alpha=0.05, power=0.8) given n re-judges
//   and the judge flip-rate noise budget — so we report "100% at resolution X",
//   never a bare "100%". (2605.30315; 2606.13685.)

/** Default one-sided significance level for every confidence bound / e-process. */
export const DEFAULT_ALPHA = 0.05;

/**
 * Default pass-probability floor a view's lower bound must clear to be
 * CERTIFIED-cleared. 0.5 == "more likely than not above bar" — the parity anchor
 * expressed as a probability (a view that clears its score bar on a bare majority
 * of independent re-judges).
 */
export const DEFAULT_P_FLOOR = 0.5;

/**
 * Default confirmation re-judge passes (R2): after a single all-cleared pass, run
 * this many ADDITIONAL independent passes and certify on the pooled counts.
 */
export const DEFAULT_K_CONFIRM = 2;

/** Default minimum independent held-out episodes before a strategy is promoted (R5). */
export const DEFAULT_STRATEGY_MIN_EPISODES = 3;

/** Default win-rate-vs-baseline lower-bound floor a strategy must clear to promote (R5). */
export const DEFAULT_STRATEGY_WINRATE_FLOOR = 0.5;

/** Finite-number guard (null/undefined/NaN/Infinity => false). */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamp x into [lo, hi]. */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Inverse standard-normal CDF (probit / quantile). Peter Acklam's rational
 * approximation, |relative error| < 1.15e-9 over the open interval (0,1). Used to
 * turn a significance level alpha into the z-multiplier for the confidence bounds.
 * @param {number} p  probability in (0,1).
 * @returns {number}  z such that Phi(z) = p (±Infinity at the closed endpoints).
 */
export function normInv(p) {
  if (!isNum(p) || p <= 0) return p === 0 ? -Infinity : NaN;
  if (p >= 1) return p === 1 ? Infinity : NaN;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

/** One-sided z-multiplier for a lower/upper bound at level alpha: z_{1-alpha}. */
export function zOneSided(alpha = DEFAULT_ALPHA) {
  return normInv(1 - clamp(alpha, 1e-12, 0.5));
}

/** Two-sided z-multiplier for a (1-alpha) interval: z_{1-alpha/2}. */
export function zTwoSided(alpha = DEFAULT_ALPHA) {
  return normInv(1 - clamp(alpha, 1e-12, 1 - 1e-12) / 2);
}

/**
 * Two-sided Agresti-Coull confidence interval for a binomial proportion at
 * confidence (1-alpha). The "add z^2 successes-and-failures" adjustment: n~ =
 * n + z^2, p~ = (X + z^2/2)/n~, half-width = z*sqrt(p~(1-p~)/n~). Endpoints are
 * clamped to [0,1]. n<=0 => the vacuous [0,1] (no evidence).
 * @param {number} successes  X, count clearing the bar (0..n).
 * @param {number} n          independent draws.
 * @param {number} [alpha]    two-sided significance (default 0.05 => 95%).
 * @returns {{lower:number, upper:number, center:number, halfWidth:number,
 *   pTilde:number, nTilde:number, z:number}}
 */
export function agrestiCoullInterval(successes, n, alpha = DEFAULT_ALPHA) {
  const z = zTwoSided(alpha);
  if (!isNum(n) || n <= 0) {
    return { lower: 0, upper: 1, center: 0.5, halfWidth: 0.5, pTilde: 0.5, nTilde: 0, z };
  }
  const x = clamp(isNum(successes) ? successes : 0, 0, n);
  const nTilde = n + z * z;
  const pTilde = (x + (z * z) / 2) / nTilde;
  const halfWidth = z * Math.sqrt((pTilde * (1 - pTilde)) / nTilde);
  return {
    lower: clamp(pTilde - halfWidth, 0, 1),
    upper: clamp(pTilde + halfWidth, 0, 1),
    center: pTilde,
    halfWidth,
    pTilde,
    nTilde,
    z,
  };
}

/**
 * One-sided Agresti-Coull LOWER confidence bound on a binomial pass-probability at
 * level alpha (uses z_{1-alpha}, NOT z_{1-alpha/2}). This is the per-view certify
 * statistic (R1). n<=0 => 0 (no evidence certifies nothing).
 * @param {number} successes
 * @param {number} n
 * @param {number} [alpha]  one-sided (default 0.05).
 * @returns {number} lower bound in [0,1].
 */
export function agrestiCoullLCB(successes, n, alpha = DEFAULT_ALPHA) {
  if (!isNum(n) || n <= 0) return 0;
  const z = zOneSided(alpha);
  const x = clamp(isNum(successes) ? successes : 0, 0, n);
  const nTilde = n + z * z;
  const pTilde = (x + (z * z) / 2) / nTilde;
  const halfWidth = z * Math.sqrt((pTilde * (1 - pTilde)) / nTilde);
  return clamp(pTilde - halfWidth, 0, 1);
}

/**
 * One-sided WILSON (score) LOWER confidence bound on a binomial proportion at
 * level alpha. Used for the strategy win-rate-vs-baseline floor (R5); Wilson is the
 * tighter classic small-sample score interval. n<=0 => 0.
 * @param {number} successes
 * @param {number} n
 * @param {number} [alpha]  one-sided (default 0.05).
 * @returns {number} lower bound in [0,1].
 */
export function wilsonLCB(successes, n, alpha = DEFAULT_ALPHA) {
  if (!isNum(n) || n <= 0) return 0;
  const z = zOneSided(alpha);
  const x = clamp(isNum(successes) ? successes : 0, 0, n);
  const pHat = x / n;
  const denom = 1 + (z * z) / n;
  const center = (pHat + (z * z) / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((pHat * (1 - pHat)) / n + (z * z) / (4 * n * n));
  return clamp(center - half, 0, 1);
}

/**
 * INTERSECTION-UNION TEST certification (R1). Given per-view cleared counts over n
 * independent re-judge draws, certify iff EVERY view's one-sided Agresti-Coull LCB
 * >= p_floor AND no view is flagged inconclusive or contested. There is NO
 * cross-view Bonferroni: an IUT certifies on the WORST view's level-alpha bound
 * (max-p rule), because a Bonferroni split across the 9 would over-reject genuine
 * all-pass events.
 *
 * `inconclusiveViews` / `contestedViews` are arrays of 0-based indices into
 * `perViewClearedCounts` (the caller maps view numbers to indices). A view listed
 * in either — regardless of its LCB — is BLOCKING and cannot certify.
 *
 * @param {Object} p
 * @param {number[]} p.perViewClearedCounts  per view: draws that cleared the bar.
 * @param {number|number[]} p.n              draws per view (scalar broadcasts).
 * @param {number} [p.pFloor]                pass-probability floor (default 0.5).
 * @param {number} [p.alpha]                 one-sided level (default 0.05).
 * @param {number[]} [p.inconclusiveViews]   0-based indices flagged inconclusive.
 * @param {number[]} [p.contestedViews]      0-based indices flagged contested.
 * @returns {{certified:boolean, worstViewLCB:number, worstViewIndex:number|null,
 *   perViewLCB:number[], perViewCertified:boolean[], blockingViews:number[]}}
 */
export function certifyIUT({
  perViewClearedCounts = [],
  n,
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  inconclusiveViews = [],
  contestedViews = [],
} = {}) {
  const counts = Array.isArray(perViewClearedCounts) ? perViewClearedCounts : [];
  const nFor = (i) => (Array.isArray(n) ? n[i] : n);
  const flagged = new Set(
    [...(Array.isArray(inconclusiveViews) ? inconclusiveViews : []),
      ...(Array.isArray(contestedViews) ? contestedViews : [])].filter((i) => Number.isInteger(i)),
  );
  const perViewLCB = counts.map((c, i) => agrestiCoullLCB(c, nFor(i), alpha));
  const perViewCertified = perViewLCB.map((lcb, i) => lcb + 1e-9 >= pFloor && !flagged.has(i));
  const blockingViews = [];
  for (let i = 0; i < counts.length; i++) {
    if (!perViewCertified[i]) blockingViews.push(i);
  }
  // Worst view = the smallest LCB (the IUT max-p statistic). Reported for the
  // resolution/report layer even when a flag (not the LCB) is the blocker.
  let worstViewLCB = Infinity;
  let worstViewIndex = null;
  perViewLCB.forEach((lcb, i) => {
    if (lcb < worstViewLCB) {
      worstViewLCB = lcb;
      worstViewIndex = i;
    }
  });
  if (worstViewIndex === null) worstViewLCB = 0;
  const certified = counts.length > 0 && blockingViews.length === 0;
  return { certified, worstViewLCB, worstViewIndex, perViewLCB, perViewCertified, blockingViews };
}

/**
 * Sequential betting E-PROCESS for the R2 contested-view escalation. Tests the
 * one-sided null H0: p <= p_floor (the view is NOT above bar) by accumulating a
 * non-negative test-martingale wealth E_t = prod_i (1 + lambda_i (X_i - p_floor)),
 * where X_i in {0,1} is "cleared the bar on draw i". Under H0, E[X_i - p_floor] <= 0
 * so {E_t} is a supermartingale and Ville's inequality makes "reject when E_t >=
 * 1/alpha" a valid anytime test. If the e-value never reaches 1/alpha within the
 * supplied draws the view is INCONCLUSIVE (it NEVER passes on a coin-flip).
 *
 * Betting fraction: a FIXED `lambda` (finite number) is used verbatim (clamped to
 * keep wealth non-negative); otherwise a predictable plug-in aGRAPA-style bet is
 * derived from the running estimate — only betting (lambda>0) once the evidence
 * points above p_floor. Wealth non-negativity requires lambda in [0, 1/p_floor);
 * the fraction is capped at (1-1e-6)/p_floor.
 *
 * @param {Object} p
 * @param {Array<number|boolean>} p.observations  sequential 0/1 (or boolean) draws.
 * @param {number} [p.pFloor]     null boundary (default 0.5).
 * @param {number} [p.alpha]      significance => threshold 1/alpha (default 0.05 => 20).
 * @param {number} [p.lambda]     fixed betting fraction; omit for adaptive.
 * @param {number} [p.priorA]     Beta prior successes for the plug-in (default 0.5).
 * @param {number} [p.priorB]     Beta prior failures for the plug-in (default 0.5).
 * @returns {{decided:boolean, aboveBar:boolean, inconclusive:boolean, eValue:number,
 *   threshold:number, steps:number, trace:number[]}}
 */
export function eProcess({
  observations = [],
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  lambda,
  priorA = 0.5,
  priorB = 0.5,
} = {}) {
  const threshold = 1 / clamp(alpha, 1e-12, 0.5);
  const lambdaCap = (1 - 1e-6) / Math.max(pFloor, 1e-9);
  const fixed = isNum(lambda);
  const obs = Array.isArray(observations) ? observations : [];
  let wealth = 1;
  let seenSuccess = 0;
  let seenCount = 0;
  let decided = false;
  let aboveBar = false;
  let steps = 0;
  const trace = [];
  for (const raw of obs) {
    const x = raw === true ? 1 : raw === false ? 0 : isNum(raw) ? clamp(raw, 0, 1) : 0;
    // Predictable bet: computed from draws seen BEFORE this one (no peeking).
    let lam;
    if (fixed) {
      lam = clamp(lambda, 0, lambdaCap);
    } else {
      const pHat = (seenSuccess + priorA) / (seenCount + priorA + priorB);
      const edge = pHat - pFloor;
      const variance = Math.max(pFloor * (1 - pFloor), 1e-9);
      lam = clamp(edge / variance, 0, lambdaCap);
    }
    wealth *= 1 + lam * (x - pFloor);
    if (wealth < 0) wealth = 0; // numerical floor; the cap keeps this from firing.
    trace.push(wealth);
    steps += 1;
    seenCount += 1;
    seenSuccess += x;
    if (wealth >= threshold) {
      decided = true;
      aboveBar = true;
      break;
    }
  }
  return {
    decided,
    aboveBar,
    inconclusive: !decided,
    eValue: wealth,
    threshold,
    steps,
    trace,
  };
}

/**
 * Expected value of the maximum of `m` i.i.d. standard normals (Blom's order-
 * statistic approximation, E[max] ~ Phi^{-1}((m - 3/8)/(m + 1/4))). m<=1 => 0 (a
 * single draw has no selection premium). This is the winner's-curse premium, in
 * standard-deviation units, that an optimal-over-m selection inflates the peak by.
 * @param {number} m  number of candidates selected over.
 * @returns {number} expected max in sigma units (>=0).
 */
export function expectedMaxStdNormal(m) {
  if (!isNum(m) || m <= 1) return 0;
  return normInv((m - 0.375) / (m + 0.25));
}

/**
 * R3 SELECTION-PREMIUM charge: the amount (in SCORE units) to deduct from a peak
 * that was chosen as the best of `numCandidates` noisy iterations. It is the
 * expected maximum of `numCandidates` draws of the per-iteration noise `sigma`
 * (optional-stopping / winner's-curse deflation). numCandidates<=1 or sigma<=0 =>
 * 0 (no selection, no charge).
 * @param {Object} p
 * @param {number} p.sigma          per-iteration noise std (SCORE units).
 * @param {number} p.numCandidates  iterations the peak was selected over.
 * @returns {number} non-negative charge in SCORE units.
 */
export function selectionPremiumCharge({ sigma, numCandidates }) {
  if (!isNum(sigma) || sigma <= 0) return 0;
  return sigma * expectedMaxStdNormal(numCandidates);
}

/**
 * R3 regression-to-the-mean shrinkage: pull an observed value toward a reference
 * mean by a shrinkage factor in [0,1] (0 = keep observed, 1 = collapse to mean).
 * When `sigma` (noise) and `spread` (between-candidate signal std) are supplied,
 * a James-Stein-style reliability factor sigma^2/(sigma^2 + spread^2) is used
 * instead of the explicit `shrinkage` (a noisier signal shrinks harder).
 * @param {Object} p
 * @param {number} p.observed       the raw (peak) value.
 * @param {number} p.mean           the reference mean to shrink toward.
 * @param {number} [p.shrinkage]    explicit factor in [0,1] (default 0).
 * @param {number} [p.sigma]        noise std (optional reliability route).
 * @param {number} [p.spread]       between-candidate signal std (optional).
 * @returns {number} the shrunk value.
 */
export function shrinkToMean({ observed, mean, shrinkage = 0, sigma, spread }) {
  if (!isNum(observed)) return NaN;
  const m = isNum(mean) ? mean : observed;
  let s = clamp(isNum(shrinkage) ? shrinkage : 0, 0, 1);
  if (isNum(sigma) && isNum(spread)) {
    const noiseVar = sigma * sigma;
    const signalVar = spread * spread;
    s = clamp(noiseVar / (noiseVar + signalVar || 1), 0, 1);
  }
  return observed - s * (observed - m);
}

/**
 * R7 judge FLIP-RATE noise budget: the standard error of a view's pass-rate
 * estimate given a per-draw verdict flip rate `flipRate` (the probability the
 * order-swapped judge disagrees with itself) over `n` re-judge draws. sqrt(f(1-f)/n)
 * — the Bernoulli SE of the flip process. Feeds the paired-test resolution as the
 * per-pair noise unit. n<=0 => Infinity (no draws, no resolvable signal).
 * @param {Object} p
 * @param {number} p.flipRate  measured judge flip rate in [0,1].
 * @param {number} p.n         re-judge draws per view.
 * @returns {number} SE (a standard deviation on the pass-rate).
 */
export function flipRateBudget({ flipRate, n }) {
  if (!isNum(n) || n <= 0) return Infinity;
  const f = clamp(isNum(flipRate) ? flipRate : 0, 0, 1);
  return Math.sqrt((f * (1 - f)) / n);
}

/**
 * R7 paired-test RESOLUTION (minimum detectable effect): the smallest margin above
 * bar a paired test can resolve at one-sided significance `alpha` and `power`,
 * given per-pair noise `sigma` over `n` re-judge draws. MDE = (z_{1-alpha} +
 * z_{power}) * sigma / sqrt(n). If `flipRate` is given (and no explicit sigma), the
 * flip-rate budget is used as the per-pair noise. A "100%" is only reportable when
 * the worst-view margin above bar EXCEEDS this resolution.
 * @param {Object} p
 * @param {number} p.n           re-judge draws per view.
 * @param {number} [p.alpha]     one-sided significance (default 0.05).
 * @param {number} [p.power]     target power (default 0.8).
 * @param {number} [p.sigma]     per-pair noise std (SCORE or probability units).
 * @param {number} [p.flipRate]  fallback noise source via flipRateBudget.
 * @returns {number} the minimum detectable effect (same units as sigma).
 */
export function pairedResolution({ n, alpha = DEFAULT_ALPHA, power = 0.8, sigma, flipRate }) {
  if (!isNum(n) || n <= 0) return Infinity;
  const s = isNum(sigma) ? Math.max(0, sigma) : flipRateBudget({ flipRate, n });
  if (!isNum(s)) return Infinity;
  const zAlpha = zOneSided(alpha);
  const zPower = normInv(clamp(power, 1e-6, 1 - 1e-6));
  // sigma is already the SE over n draws when it comes from flipRateBudget; an
  // explicit per-pair sigma is divided by sqrt(n) to become the SE of the mean.
  const se = isNum(sigma) ? s / Math.sqrt(n) : s;
  return (zAlpha + zPower) * se;
}
