// FROZEN scoring math for the Boeing 747 primitives vision benchmark.
// Pure functions only — covered by vitest (scoring.test.mjs).
//
// Null semantics (frozen): a criterion the judge cannot assess from a given
// camera angle is `null`. Nulls are EXCLUDED (weights renormalized), never
// treated as zero — a dead/unsure judge must not destroy the signal
// (DEAD-JUDGE-1 / BRAIN-SEARCH-1 lessons).

/** Median of a numeric array (mean of the two middles for even length). */
export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median across judge seeds for one criterion. Input may contain nulls
 * (judge said "not assessable") — they are dropped. All-null => null.
 */
export function seedMedian(values) {
  const nums = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return median(nums);
}

/** Clamp a parsed judge score into the frozen 0..10 range; non-numbers => null. */
export function normalizeScore(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, n));
}

/**
 * Weighted mean over { value, weight } entries, skipping null values and
 * renormalizing the remaining weights. Returns null when nothing is scoreable.
 */
export function weightedMean(entries) {
  let num = 0;
  let den = 0;
  for (const { value, weight } of entries) {
    if (value === null || value === undefined) continue;
    num += value * weight;
    den += weight;
  }
  return den > 0 ? num / den : null;
}

/**
 * Per-view score: weighted mean of per-criterion medians (0..10 scale).
 * `criteriaMedians` maps criterion id -> median (number|null);
 * `criteria` is the frozen rubric array [{ id, weight }, ...].
 */
export function viewScore(criteriaMedians, criteria) {
  return weightedMean(
    criteria.map((c) => ({ value: criteriaMedians[c.id] ?? null, weight: c.weight })),
  );
}

/**
 * TOTAL: mean of the (non-null) per-view scores, scaled from /10 to /100.
 * Returns { total, scoredViews, missingViews }.
 */
export function totalScore(viewScores) {
  const scored = viewScores.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const missing = viewScores.length - scored.length;
  if (scored.length === 0) return { total: null, scoredViews: 0, missingViews: missing };
  const mean = scored.reduce((a, b) => a + b, 0) / scored.length;
  return {
    total: Math.round(mean * 10 * 100) / 100,
    scoredViews: scored.length,
    missingViews: missing,
  };
}

/**
 * Deterministic weakest-feature selection for the critic: for each criterion,
 * average its per-view medians (nulls skipped); the criterion with the lowest
 * average is the weakest. Ties break toward the earlier rubric entry.
 * Returns { id, mean, perCriterion } or null when nothing is scoreable.
 */
export function weakestCriterion(perViewCriteriaMedians, criteria) {
  const perCriterion = {};
  let weakest = null;
  for (const c of criteria) {
    const vals = perViewCriteriaMedians
      .map((m) => (m ? m[c.id] : null))
      .filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (vals.length === 0) {
      perCriterion[c.id] = null;
      continue;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    perCriterion[c.id] = Math.round(mean * 100) / 100;
    if (weakest === null || mean < weakest.mean) weakest = { id: c.id, mean };
  }
  if (!weakest) return null;
  return { id: weakest.id, mean: Math.round(weakest.mean * 100) / 100, perCriterion };
}
