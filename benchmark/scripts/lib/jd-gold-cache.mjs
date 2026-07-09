// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: gold.json cache-staleness check.
//
// A cached gold.json is only reusable if it was computed for the EXACT same
// set of JD ids as the current JD_QUERIES list. Without this check, adding,
// removing, or renaming a JD (e.g. a new typo-probe fixture) silently reuses
// a stale gold set that has no entry for the new id -- downstream scoring
// then reads gold_size=0 for it and reports a false NDCG@10=0% that looks
// like a retrieval failure but is actually a cache-staleness bug (found
// 2026-07-09 while validating TYPESENSE-ADAPT-6's typo tier: retrieval had
// actually worked -- the new JD's top-1 hit matched an existing JD's top-1 --
// but gold_size was silently 0).

/**
 * @param {{ jds?: Array<{ id: string }> } | null | undefined} parsedGold
 * @param {Array<{ id: string }>} currentQueries
 * @returns {boolean} true iff `parsedGold.jds` contains exactly the ids in `currentQueries` (any order)
 */
export function goldMatchesQueries(parsedGold, currentQueries) {
  if (!parsedGold || !Array.isArray(parsedGold.jds)) return false;
  const cachedIds = new Set(parsedGold.jds.map(jd => jd.id));
  return currentQueries.every(jd => cachedIds.has(jd.id)) && cachedIds.size === currentQueries.length;
}
