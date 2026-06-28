// Per-query retrieval metrics for locomo-ivfpq.mjs.
//
// Extracted verbatim from locomo-ivfpq.mjs (no behavior change) to keep that
// driver under the ESLint `max-lines` budget. `scoreQuery` stays in the
// driver because it iterates the driver-level METRIC_KS constant; it calls
// `metricForQuery` from here.

function gain(score) { return (2 ** score) - 1; }

function dcg(scores, k) {
  let total = 0;
  for (let i = 0; i < Math.min(k, scores.length); i++) {
    if (scores[i] > 0) total += gain(scores[i]) / Math.log2(i + 2);
  }
  return total;
}

export function metricForQuery(retrievedIds, qrels, k) {
  const top = retrievedIds.slice(0, k);
  const relevantCount = qrels.size;
  const hits = top.filter(id => qrels.has(id)).length;
  const scores = top.map(id => qrels.get(id) ?? 0);
  const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, k);
  const idealDcg = dcg(ideal, k);
  let precisionSum = 0; let seenRel = 0;
  for (let i = 0; i < top.length; i++) {
    if (qrels.has(top[i])) { seenRel++; precisionSum += seenRel / (i + 1); }
  }
  const firstRel = top.findIndex(id => qrels.has(id));
  return {
    [`recall_at_${k}`]: relevantCount === 0 ? 0 : hits / relevantCount,
    [`hit_at_${k}`]: hits > 0 ? 1 : 0,
    [`ndcg_at_${k}`]: idealDcg === 0 ? 0 : dcg(scores, k) / idealDcg,
    [`map_at_${k}`]: relevantCount === 0 ? 0 : precisionSum / Math.min(relevantCount, k),
    [`mrr_at_${k}`]: firstRel < 0 ? 0 : 1 / (firstRel + 1),
  };
}
