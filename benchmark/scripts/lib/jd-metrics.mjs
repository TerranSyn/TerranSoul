// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: pure retrieval-metric functions (no I/O).
// Used by benchmark/scripts/jd-million-bench.mjs; unit-tested with
// hand-computed fixtures in jd-metrics.test.mjs.

/** Count how many of the first k retrieved ids are in the gold set. */
export function hitsAtK(retrieved, goldSet, k) {
  let hits = 0;
  const n = Math.min(k, retrieved.length);
  for (let i = 0; i < n; i += 1) {
    if (goldSet.has(retrieved[i])) hits += 1;
  }
  return hits;
}

/**
 * Recall@K in two labelled forms:
 *  - capped: |gold ∩ top-K| / min(K, |gold|) — how full the top-K is of
 *    gold, given that at most K could ever fit (1.0 is achievable even
 *    when |gold| > K).
 *  - raw:    |gold ∩ top-K| / |gold| — classic recall (bounded by
 *    K/|gold| when the gold set is larger than K).
 */
export function recallAtK(retrieved, goldSet, k) {
  const hits = hitsAtK(retrieved, goldSet, k);
  const goldSize = goldSet.size;
  return {
    hits,
    capped: goldSize === 0 ? 0 : hits / Math.min(k, goldSize),
    raw: goldSize === 0 ? 0 : hits / goldSize,
  };
}

/** Precision@K = |gold ∩ top-K| / K (denominator is K even when fewer than K were retrieved). */
export function precisionAtK(retrieved, goldSet, k) {
  if (k <= 0) return 0;
  return hitsAtK(retrieved, goldSet, k) / k;
}

/**
 * NDCG@K with binary relevance (rel=1 iff the id is in gold).
 * DCG  = Σ_{i<K, retrieved[i] ∈ gold} 1 / log2(i + 2)
 * IDCG = Σ_{i<min(K,|gold|)}          1 / log2(i + 2)
 */
export function ndcgAtK(retrieved, goldSet, k) {
  let dcg = 0;
  const n = Math.min(k, retrieved.length);
  for (let i = 0; i < n; i += 1) {
    if (goldSet.has(retrieved[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const ideal = Math.min(k, goldSet.size);
  for (let i = 0; i < ideal; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Percentile with linear interpolation between closest ranks
 * (numpy's default "linear" method). p is in [0, 100].
 */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}
