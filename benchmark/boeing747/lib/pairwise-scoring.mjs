// PURE per-view numeric scoring for the `--judge opus-pairwise` gating track.
// Turns the reconciled per-criterion parity (from lib/pairwise-parse.mjs) into
// `criteria_medians`, then runs the FROZEN lib/scoring.mjs pipeline VERBATIM
// (seedMedian -> maskViewMedians -> viewScore -> totalScore -> weakestCriterion)
// so the emitted per-view { view, key, score, ... } object is byte-shape-
// identical to judge/judge-claude.mjs's — bookkeepTrack,
// filterGenuineIterationsForStopConditions and evaluateStopConditions consume
// it with ZERO shape changes.
//
// PARITY-RATIO SEMANTICS: each criterion's per-view median is 10*graded-parity
// against a FIXED reference build, so 5.0 == "as good as the reference 747 on
// this view". combined magnitude m ∈ [-2,+2] -> credit = clamp(0.5 + m/4, 0, 1):
//   +2 -> 1.00 (candidate clearly better)   -1 -> 0.25
//   +1 -> 0.75                               -2 -> 0.00 (candidate clearly worse)
//    0 -> 0.50 (parity)
// The 0.5-at-parity anchoring is why a genuine CONSISTENT tie legitimately reads
// as 5.0 — but ONLY consistent panels are ever fed here. Order-inconsistent
// (flipped) and NA panels are UNDECIDED upstream (decided=false): they never
// produce a credit, so they can never manufacture a hollow 5.0 clear (REVIEW
// FIX #1). They only lower `decided_fraction`; a view whose mean decided
// fraction < 0.5 is flagged `inconclusive` and the stop condition treats it as
// NOT-cleared (never certify on coin-flips).
import {
  maskViewMedians,
  seedMedian,
  totalScore,
  viewScore,
  weakestCriterion,
} from './scoring.mjs';

/** Default decided-fraction floor below which a view is `inconclusive`. */
export const DEFAULT_INCONCLUSIVE_THRESHOLD = 0.5;

/** Round to 2 decimals (matches the frozen per-view/median rounding). */
function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Map a reconciled combined magnitude (m ∈ [-2,+2]) to a 0..1 parity credit:
 * clamp(0.5 + m/4, 0, 1). Graded, not binary — preserves gradient resolution.
 */
export function combinedToCredit(combined) {
  return Math.min(1, Math.max(0, 0.5 + combined / 4));
}

/**
 * True when a criterion is STRUCTURALLY assessable on a view per the frozen
 * view-visibility mask (a criterion absent from the map is assessable on all
 * views). Used to exclude masked criteria from the decided-fraction denominator
 * — they are never asked, so they cannot count as (un)decided.
 */
export function isVisibleCriterion(criterionId, viewId, viewVisibility) {
  const allowed = viewVisibility && viewVisibility[criterionId];
  return !Array.isArray(allowed) || allowed.includes(viewId);
}

/**
 * Parity median for ONE criterion from its per-panel reconciliations. Only
 * CONSISTENT (decided, finite `combined`) panels contribute a credit; the
 * parity is seedMedian(credits) (mirrors the frozen median-of-samples), so an
 * inconsistent/undecided-only criterion yields `median: null`.
 * @param {Array<{combined:number|null, decided:boolean}>} panels
 * @returns {{median:number|null, decidedCount:number, totalCount:number}}
 *   `median` is the 0..1 parity (NOT yet scaled to 0..10).
 */
export function criterionParityMedian(panels) {
  const list = Array.isArray(panels) ? panels : [];
  const decided = list.filter(
    (p) => p && p.decided && p.combined !== null && Number.isFinite(p.combined),
  );
  const credits = decided.map((p) => combinedToCredit(p.combined));
  return { median: seedMedian(credits), decidedCount: decided.length, totalCount: list.length };
}

/**
 * Score ONE view from its reconciled per-criterion panels. Produces the
 * per-view object in the exact frozen shape plus the pairwise-only
 * `decided_fraction` / `inconclusive` fields.
 *
 * @param {Object}   params
 * @param {{id:number, key:string}} params.view       the camera view.
 * @param {Object}   params.criteriaPanels  criterionId -> panel reconciliations
 *   ({combined, decided}[]); only VISIBLE criteria should appear (the judge
 *   omits masked criteria from the ask).
 * @param {Array<{id:string, weight:number}>} params.criteria  frozen rubric criteria.
 * @param {Object}   [params.viewVisibility] frozen per-criterion view mask.
 * @param {number}   [params.inconclusiveThreshold]
 * @returns {{view:number, key:string, score:number|null, score_unmasked:number|null,
 *   masked_out:string[], criteria_medians:Object, decided_fraction:number, inconclusive:boolean}}
 */
export function scoreView({
  view,
  criteriaPanels,
  criteria,
  viewVisibility,
  inconclusiveThreshold = DEFAULT_INCONCLUSIVE_THRESHOLD,
}) {
  const panels = criteriaPanels || {};
  const criteriaMedians = {};
  let decidedPairs = 0;
  let totalPairs = 0;
  for (const c of criteria) {
    const { median, decidedCount, totalCount } = criterionParityMedian(panels[c.id]);
    criteriaMedians[c.id] = median === null ? null : round2(median * 10);
    // Only VISIBLE criteria count toward decided_fraction (masked ones are
    // never asked). An inconsistent/undecided panel is in totalCount but not
    // decidedCount, so it correctly drags the fraction down (REVIEW FIX #1).
    if (isVisibleCriterion(c.id, view.id, viewVisibility)) {
      decidedPairs += decidedCount;
      totalPairs += totalCount;
    }
  }
  const masked = maskViewMedians(criteriaMedians, view.id, viewVisibility);
  const rawScore = viewScore(masked, criteria);
  const rawUnmasked = viewScore(criteriaMedians, criteria);
  const maskedOut = criteria
    .map((c) => c.id)
    .filter((id) => masked[id] === null && criteriaMedians[id] !== null);
  const decidedFraction = totalPairs > 0 ? Math.round((decidedPairs / totalPairs) * 1e4) / 1e4 : 0;
  return {
    view: view.id,
    key: view.key,
    score: rawScore === null ? null : round2(rawScore),
    score_unmasked: rawUnmasked === null ? null : round2(rawUnmasked),
    masked_out: maskedOut,
    criteria_medians: criteriaMedians,
    decided_fraction: decidedFraction,
    inconclusive: decidedFraction < inconclusiveThreshold,
  };
}

/**
 * Aggregate the per-view objects into the run-level totals via the FROZEN
 * totalScore + weakestCriterion (weakest_feature steers the actor toward the
 * criterion it most trails the reference on). Byte-shape-identical to the
 * judge-claude aggregation.
 * @returns {{total_0_100:number|null, total_0_100_unmasked:number|null,
 *   scored_views:number, missing_views:number,
 *   weakest_feature:{id:string, mean:number, perCriterion:Object}|null}}
 */
export function aggregateViews(perViewObjects, criteria, viewVisibility) {
  const views = Array.isArray(perViewObjects) ? perViewObjects : [];
  const { total, scoredViews, missingViews } = totalScore(views.map((v) => v.score));
  const { total: totalUnmasked } = totalScore(views.map((v) => v.score_unmasked ?? v.score));
  const weakest = weakestCriterion(
    views.map((v) => maskViewMedians(v.criteria_medians, v.view, viewVisibility)),
    criteria,
  );
  return {
    total_0_100: total,
    total_0_100_unmasked: totalUnmasked,
    scored_views: scoredViews,
    missing_views: missingViews,
    weakest_feature: weakest,
  };
}
