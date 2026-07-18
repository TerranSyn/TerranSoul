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
 * VIEW-VISIBILITY MASK (measurement-correctness fix, rubric v2).
 *
 * Force a criterion to `null` on views where the feature is STRUCTURALLY
 * invisible (the fuselage side is edge-on, the feature is occluded, or a
 * vertical feature is seen from directly above), so the aggregate reflects the
 * geometry rather than an impossible ask. This is the deterministic enforcement
 * of the rubric's own "use null if a criterion genuinely cannot be assessed from
 * this angle" instruction — vision judges (both gemma4 and Opus) frequently
 * return a low integer instead of null there (e.g. window_door_lines=2 on the
 * head-on rear view, with the judge's own note "no windows visible from this
 * angle"), which silently penalises a feature that no geometry could show.
 *
 * `viewVisibility` maps criterion id -> array of view ids on which it IS
 * assessable. A criterion absent from the map is assessable on ALL views.
 * When `viewVisibility` is falsy (rubric v1 / unmasked callers) the medians are
 * returned unchanged — backward compatible.
 */
export function maskViewMedians(criteriaMedians, viewId, viewVisibility) {
  if (!viewVisibility || !criteriaMedians) return criteriaMedians;
  const out = {};
  for (const id of Object.keys(criteriaMedians)) {
    const allowed = viewVisibility[id];
    out[id] = Array.isArray(allowed) && !allowed.includes(viewId) ? null : criteriaMedians[id];
  }
  return out;
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

// ---------------------------------------------------------------------------
// JUDGE PANEL v4 helpers (2026-07-16) — self-consistency K-panel aggregation.
// Wang et al. 2203.11171 (self-consistency); LLM-judge single-draw scoring is
// high-variance (2305.17926), so rubric v4 replaces the 3-fixed-seed temp-0
// MEDIAN with a K-draw fixed-seed temp>0 panel aggregated by MEAN, and the
// panel's own spread becomes the LIVE-MEASURED gate epsilon (replacing the
// uncalibrated total_noise_epsilon=0 that made the gate reject inside noise).
// PURE — the judge passes data in; nothing here calls a model.
// ---------------------------------------------------------------------------

/** Mean of the non-null draws (null = judge abstained on that draw); null when
 * every draw abstained. Counterpart of seedMedian for the v4 panel. */
export function panelMean(values) {
  const xs = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation of the non-null draws (0 when < 2 draws). */
export function panelStd(values) {
  const xs = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) * (v - m), 0) / (xs.length - 1));
}

/**
 * Standard error of the /100 TOTAL implied by per-view panel spreads: the
 * total is mean(view scores) x 10 over `viewCount` views, each view's panel
 * mean carrying SE = std_v / sqrt(n_v). Views without a finite std/n
 * contribute 0 (a fully-abstained or single-draw view adds no measured
 * variance — never inflates epsilon; fail-open toward the strict gate).
 * @param {Array<{score_std?:number|null, draws?:number|null}>} perViewPanel
 * @param {number} viewCount  denominator of the total's mean (9 for this bench)
 */
export function panelSeTotal(perViewPanel, viewCount) {
  const n = Number.isFinite(viewCount) && viewCount > 0 ? viewCount : (perViewPanel || []).length;
  if (!n) return 0;
  let sumVar = 0;
  for (const p of perViewPanel || []) {
    const std = p && Number.isFinite(p.score_std) ? p.score_std : 0;
    const k = p && Number.isFinite(p.draws) && p.draws > 0 ? p.draws : 1;
    sumVar += (std * std) / k;
  }
  return Math.round(((10 / n) * Math.sqrt(sumVar)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// SCORING v3 — measurement-fidelity aggregation correction (2026-07-16).
//
// v2 dropped EVERY null view from both the numerator AND the denominator of the
// /100 total, on the fail-open premise "a dead judge must not destroy the
// signal". That premise conflates two very different nulls:
//   (a) a FAILED judge call (all seeds errored / parse-failed) — genuinely no
//       signal, so drop it and renormalize (correct, kept);
//   (b) a SUCCESSFUL judge call that returned all-null because the geometry is
//       unassessable from that angle — e.g. the head-on rear view (view 4) of a
//       degenerate/exploded plane that shows nothing recognizable (all 3 seeds
//       ok:true, done_reason:stop, judge_errors:0, every criterion null). The
//       rubric's own 0 anchors say "absent/unassessable = 0", so dropping it
//       REWARDS hiding a view: the degenerate 8-view incumbent scored 55.64
//       while its true 9-view score is ~49.5.
//
// v3 fixes ONLY the (b) case: a view whose judge call SUCCEEDED but produced no
// assessable criterion scores 0 (counted in the mean), while a FAILED view keeps
// the v2 null-drop + weight renormalization. Same geometry, cameras, judge,
// rubric mask — this is purely an aggregation fix, applied identically to every
// track, and (like v2) NOT numerically comparable to v2 (see README v3 note).
// scoring.mjs stays PURE: the success signal is read off whatever the judge
// artifact already carries (its `seeds[].ok`, else `judge_errors`), never a live
// call.

export const SCORING_VERSION = 3;

/**
 * Did a view's judge pass SUCCEED (at least one run returned a parsed reply),
 * as opposed to an infra/parse FAILURE where every run errored? A successful
 * pass that nonetheless yields an all-null view means "unassessable from this
 * angle" (rubric 0 anchor = absent), NOT a dead judge. Reads the artifact's own
 * per-run ok-array — `seeds[].ok` (judge.mjs) or `samples[].ok`
 * (judge-claude.mjs; adversarial-review fix 2026-07-16: the claude judge names
 * its run array `samples`, and without this branch v3 was a silent no-op on
 * the whole claude-vision track) — else falls back to `judge_errors === 0`;
 * when no signal exists it returns false (treat as a failure → v2 null-drop,
 * never worse than v2).
 */
export function viewJudgeSucceeded(view) {
  if (!view || typeof view !== 'object') return false;
  const runs =
    Array.isArray(view.seeds) && view.seeds.length > 0
      ? view.seeds
      : Array.isArray(view.samples) && view.samples.length > 0
        ? view.samples
        : null;
  if (runs) return runs.some((s) => s && s.ok === true);
  return Number.isFinite(view.judge_errors) ? view.judge_errors === 0 : false;
}

/**
 * TOTAL v3: a view whose judge call SUCCEEDED but scored null (unassessable
 * geometry = absent) contributes 0 to the mean; a view whose judge call FAILED
 * keeps the fail-open null-drop. `perView` is the array of judge view objects
 * (each carrying `score` plus the success signal `seeds`/`judge_errors`).
 * Returns totalScore's shape plus `scoring_version` and the per-view scores that
 * were actually aggregated (successful-empty views surfaced as 0), so downstream
 * records/gates see the SAME numbers the total was built from.
 */
export function totalScoreV3(perView) {
  const views = Array.isArray(perView) ? perView : [];
  const perViewScores = views.map((v) => {
    const score = v && Number.isFinite(v.score) ? v.score : null;
    if (score !== null) return score; // a scored view is unchanged
    return viewJudgeSucceeded(v) ? 0 : null; // successful-empty -> 0, failed -> drop
  });
  const agg = totalScore(perViewScores);
  return { ...agg, scoring_version: SCORING_VERSION, perViewScores };
}

/**
 * Apply the v3 aggregation to a whole judge result (judge.mjs / judge-claude.mjs
 * shape: `{ total_0_100, per_view:[{score, seeds, judge_errors, ...}], ... }`).
 * Returns a NEW result object with the v3 total, the per-view `score`s rewritten
 * so a successful-empty view reads 0 (the gate + bookkeeping then see the honest
 * 9-view basis), the refreshed scored/missing counts, and `scoring_version: 3`.
 * PURE — never mutates its input. A result with a non-totalScore aggregation
 * (e.g. the pairwise parity total) must NOT be passed here; only judges whose
 * total is `mean(view scores) x 10` (gemma, claude-vision) are v3-aggregatable.
 */
export function applyScoringV3(judged) {
  if (!judged || !Array.isArray(judged.per_view)) return judged;
  const v3 = totalScoreV3(judged.per_view);
  return {
    ...judged,
    per_view: judged.per_view.map((v, i) => ({ ...v, score: v3.perViewScores[i] })),
    total_0_100: v3.total,
    scored_views: v3.scoredViews,
    missing_views: v3.missingViews,
    scoring_version: SCORING_VERSION,
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
