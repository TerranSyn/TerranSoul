// PURE plateau-breaking BEST-OF-N selection primitives for the Boeing 747
// primitives vision benchmark (`--judge opus-pairwise` track). NO I/O, NO GPU,
// NO CLI, NO network — every function is a deterministic transform over plain
// numbers so the whole selection rule is directly vitest-covered offline with a
// MOCKED judge/actor (see lib/best-of-n.test.mjs).
//
// GENERIC ON PURPOSE (rules/bench-agi-purity.md): this file has NO Boeing-747 (or
// any other benchmark) geometry, verb list, coordinate, or answer-derived seed.
// It is a plain search/selection library — a lower-confidence-bound ranker over
// model-proposed candidates, a bandit-style budget allocator, a plateau detector,
// and a reward-hack divergence guard. All domain content (which views, which bars,
// the actual candidate edits) is supplied by the caller; the code here only knows
// per-view scores, gaps, and binomial counts.
//
// WHY THESE PRIMITIVES (July-2026 plateau-breaking findings, all SOURCED):
//
//   #1 BEST-OF-N ON THE WORST VIEW (arXiv:2503.21878 coverage; 2506.19248
//   InferenceTimePessimism; 2604.04648 caution). When a view plateaus, sample a
//   MODEST N of DIVERSE candidate edits targeting it and SELECT by the highest
//   WORST-VIEW lower-confidence-bound (LCB), NOT the best mean. LCB selection is
//   provably NON-DEGRADING (pessimism) and — unlike argmax over a raw judge score —
//   does not chase judge-hacking outliers. We further subtract a CAUTION penalty:
//   a generic out-of-distribution score of each candidate's per-view profile vs the
//   rest of the sampled set (down-weight atypical/outlier candidates). N is kept
//   modest ON PURPOSE — coverage theory says a few diverse samples help; scaling N
//   large turns argmax into an outlier-finder.
//
//   #2 DIFFICULTY-AWARE ALLOCATION (arXiv:2605.29268 MAB compute allocation;
//   2605.26849 UAB confidence-reallocation; 2607.05297 Allocator). Treat each
//   sub-bar view as a bandit ARM and route the N-budget to the LARGEST-GAP /
//   SLOWEST-IMPROVING view(s) — gap-proportional weighting with a slowness discount
//   — instead of spending it uniformly.
//
//   #8 REWARD-HACK GUARDRAIL (arXiv:2606.14629 When Good Verifiers Go Bad;
//   2503.21878). Keep a HELD-OUT confirmation signal the selection NEVER optimises
//   against. If the selected candidate's judged worst-view score improves but the
//   held-out signal does NOT track it (divergence beyond a threshold), that is the
//   signature of judge-hacking: stop scaling N and refuse the candidate.
//
// COVERAGE CAVEAT (2503.21878): best-of-N only helps if the actor can SAMPLE a good
// edit — the diversity/temperature of the proposal step is what makes coverage real.
// This library never fabricates candidates; it only ranks the ones it is handed.

import { certifyIUT, DEFAULT_ALPHA, DEFAULT_P_FLOOR } from './certification-stats.mjs';

/** Finite-number guard (null/undefined/NaN/Infinity => false). */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamp x into [lo, hi]. */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Median of a numeric array (mean of the two central values on even length).
 * Non-finite entries are dropped first. Empty => null.
 * @param {number[]} xs
 * @returns {number|null}
 */
function median(xs) {
  const vals = (Array.isArray(xs) ? xs : []).filter(isNum).slice().sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Reduce ONE candidate's per-view profile to (clearedCounts, n) binomial inputs so
 * the worst-view LCB can be taken with the SAME statistics the certification track
 * uses (certifyIUT / agrestiCoullLCB). Two input forms are accepted per view:
 *
 *   - RICH (K judge panels): `{ clearedCount, samples }` — the count of independent
 *     re-judge draws that cleared the bar out of `samples` draws. Used verbatim so a
 *     view judged with K>1 panels gets a graded, tighter LCB.
 *   - SIMPLE (one judged render): `{ score, inconclusive }` vs the view `bar` — a
 *     single Bernoulli draw: cleared = score >= bar AND not inconclusive, n = 1. An
 *     inconclusive view (pairwise coin-flip) is NEVER a clear (matches the loop's
 *     certifyPairwiseConfirmed rule that a clear on coin-flips is void).
 *
 * @param {Array<Object>} perView   candidate per-view records.
 * @param {number|number[]} bars     per-view calibrated bar(s) (scalar broadcasts).
 * @returns {{clearedCounts:number[], ns:number[]}}
 */
function candidateBinomialInputs(perView, bars) {
  const rows = Array.isArray(perView) ? perView : [];
  const barFor = (i) => (Array.isArray(bars) ? bars[i] : bars);
  const clearedCounts = [];
  const ns = [];
  rows.forEach((v, i) => {
    const rec = v || {};
    if (isNum(rec.clearedCount) && isNum(rec.samples) && rec.samples > 0) {
      const n = Math.floor(rec.samples);
      clearedCounts.push(clamp(Math.round(rec.clearedCount), 0, n));
      ns.push(n);
      return;
    }
    const bar = barFor(i);
    const cleared = isNum(rec.score) && isNum(bar) && rec.score >= bar && rec.inconclusive !== true;
    clearedCounts.push(cleared ? 1 : 0);
    ns.push(1);
  });
  return { clearedCounts, ns };
}

/**
 * Generic OUT-OF-DISTRIBUTION / outlier caution score for EACH candidate's per-view
 * SCORE profile relative to the sampled set. For each view index the median score
 * across all candidates is taken; a candidate's caution is the MEAN ABSOLUTE
 * DEVIATION of its per-view scores from those per-view medians. An atypical
 * candidate (one whose judged profile is an outlier vs its peers — the classic
 * judge-hacking signature) scores high and is down-weighted in the ranking.
 *
 * This is intentionally domain-blind: it compares candidates only to each other, so
 * it introduces NO reference geometry or answer-derived constant.
 *
 * @param {Array<Object>} candidates  each with a `perView:[{score}]`.
 * @returns {number[]} per-candidate mean-abs-deviation-from-median (>=0).
 */
function candidateCautionScores(candidates) {
  const cands = Array.isArray(candidates) ? candidates : [];
  const maxViews = cands.reduce((m, c) => Math.max(m, (c && Array.isArray(c.perView) ? c.perView.length : 0)), 0);
  // Per-view median across candidates.
  const viewMedians = [];
  for (let i = 0; i < maxViews; i++) {
    const col = cands.map((c) => {
      const rec = c && Array.isArray(c.perView) ? c.perView[i] : null;
      return rec && isNum(rec.score) ? rec.score : null;
    });
    viewMedians.push(median(col));
  }
  return cands.map((c) => {
    const rows = c && Array.isArray(c.perView) ? c.perView : [];
    const devs = [];
    rows.forEach((rec, i) => {
      const med = viewMedians[i];
      if (rec && isNum(rec.score) && isNum(med)) devs.push(Math.abs(rec.score - med));
    });
    if (devs.length === 0) return 0;
    return devs.reduce((a, b) => a + b, 0) / devs.length;
  });
}

/**
 * #1 — BEST-OF-N SELECTION. Rank a set of model-proposed candidate edits by the
 * highest WORST-VIEW Agresti-Coull lower confidence bound (via certifyIUT, the SAME
 * IUT worst-view statistic the certification track uses), MINUS a caution penalty =
 * `cautionWeight` * the candidate's OOD/outlier score (candidateCautionScores).
 * Selecting on the worst-view LCB (not the mean) is provably non-degrading
 * (InferenceTimePessimism) and refuses to reward a candidate that wins on average
 * while leaving the plateaued view sub-bar; the caution term further down-weights an
 * atypical judged profile (a judge-hacking guard).
 *
 * Ranking is DETERMINISTIC: descending adjusted score, ties broken by higher
 * worst-view LCB, then lower caution penalty, then lower index.
 *
 * @param {Object} p
 * @param {Array<{perView:Array<{view?:number, score?:number, inconclusive?:boolean,
 *   clearedCount?:number, samples?:number}>}>} p.candidates  sampled candidate edits.
 * @param {number|number[]} p.bars   per-view calibrated bar(s) (scalar broadcasts).
 * @param {number} [p.pFloor]        pass-probability floor (default 0.5).
 * @param {number} [p.alpha]         one-sided level for the LCB (default 0.05).
 * @param {number} [p.cautionWeight] weight on the OOD penalty (default 0 = pure LCB).
 * @returns {{index:number, worstViewLCB:number, cautionPenalty:number,
 *   ranked:Array<{index:number, worstViewLCB:number, worstViewIndex:number|null,
 *   cautionPenalty:number, adjustedScore:number, perViewLCB:number[]}>}}
 *   `index` is -1 when there are no candidates.
 */
export function selectBestCandidate({
  candidates = [],
  bars,
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  cautionWeight = 0,
} = {}) {
  const cands = Array.isArray(candidates) ? candidates : [];
  if (cands.length === 0) {
    return { index: -1, worstViewLCB: 0, cautionPenalty: 0, ranked: [] };
  }
  const cautionScores = candidateCautionScores(cands);
  const w = isNum(cautionWeight) ? Math.max(0, cautionWeight) : 0;

  const ranked = cands.map((cand, index) => {
    const { clearedCounts, ns } = candidateBinomialInputs(cand && cand.perView, bars);
    const iut = certifyIUT({ perViewClearedCounts: clearedCounts, n: ns, pFloor, alpha });
    const worstViewLCB = clearedCounts.length > 0 ? iut.worstViewLCB : 0;
    const cautionPenalty = w * cautionScores[index];
    return {
      index,
      worstViewLCB,
      worstViewIndex: iut.worstViewIndex,
      cautionPenalty,
      adjustedScore: worstViewLCB - cautionPenalty,
      perViewLCB: iut.perViewLCB,
    };
  });

  ranked.sort(
    (a, b) =>
      b.adjustedScore - a.adjustedScore ||
      b.worstViewLCB - a.worstViewLCB ||
      a.cautionPenalty - b.cautionPenalty ||
      a.index - b.index,
  );

  const best = ranked[0];
  return {
    index: best.index,
    worstViewLCB: best.worstViewLCB,
    cautionPenalty: best.cautionPenalty,
    ranked,
  };
}

/**
 * #2 — DIFFICULTY-AWARE BUDGET ALLOCATION. Split a total N-budget across sub-bar
 * views (bandit arms), routing MORE samples to the LARGEST-GAP / SLOWEST-IMPROVING
 * view. Each arm's priority is `max(gap,0) / (max(improveRate,0) + 1)`: the gap
 * dominates while a fast-improving view (large improveRate, already closing on its
 * own) is discounted so the budget concentrates on the stuck views. After honoring
 * `minPerView` (as far as the budget allows, never exceeding an even share), the
 * remainder is distributed proportional to priority with largest-remainder rounding
 * so the allocation sums EXACTLY to totalN. With no gap signal it falls back to a
 * round-robin split.
 *
 * @param {Object} p
 * @param {Array<{view?:number, gap?:number, improveRate?:number}>} p.viewGaps  arms.
 * @param {number} p.totalN        total candidate-edit budget to allocate.
 * @param {number} [p.minPerView]  floor per arm (default 0), capped at the even share.
 * @returns {Array<{view:(number|undefined), n:number}>} per-arm allocation (input order).
 */
export function allocateBudget({ viewGaps = [], totalN, minPerView = 0 } = {}) {
  const arms = Array.isArray(viewGaps) ? viewGaps : [];
  const k = arms.length;
  if (k === 0) return [];
  const N = isNum(totalN) && totalN > 0 ? Math.floor(totalN) : 0;
  const minP = isNum(minPerView) && minPerView > 0 ? Math.floor(minPerView) : 0;

  const priorities = arms.map((a) => {
    const gap = a && isNum(a.gap) ? Math.max(a.gap, 0) : 0;
    const rate = a && isNum(a.improveRate) ? Math.max(a.improveRate, 0) : 0;
    return gap / (rate + 1);
  });

  const alloc = arms.map(() => 0);
  if (N === 0) return arms.map((a, i) => ({ view: a && a.view, n: alloc[i] }));

  // Floor guarantee, never exceeding the even share (so minP can't overflow N).
  const base = Math.min(minP, Math.floor(N / k));
  for (let i = 0; i < k; i++) alloc[i] = base;
  const remaining = N - base * k;

  if (remaining > 0) {
    const totalPri = priorities.reduce((a, b) => a + b, 0);
    if (totalPri <= 0) {
      for (let i = 0; i < remaining; i++) alloc[i % k] += 1;
    } else {
      const ideal = priorities.map((p) => (remaining * p) / totalPri);
      const floors = ideal.map((v) => Math.floor(v));
      for (let i = 0; i < k; i++) alloc[i] += floors[i];
      const leftover = remaining - floors.reduce((a, b) => a + b, 0);
      const order = ideal
        .map((v, i) => ({ i, frac: v - Math.floor(v), pri: priorities[i] }))
        .sort((a, b) => b.frac - a.frac || b.pri - a.pri || a.i - b.i);
      for (let j = 0; j < leftover && j < order.length; j++) alloc[order[j].i] += 1;
    }
  }

  return arms.map((a, i) => ({ view: a && a.view, n: alloc[i] }));
}

/**
 * #2 helper — PLATEAU DETECTION. A view has plateaued when, over the last `patience`
 * genuine iterations, it has been the SAME WEAKEST view (per-iter argmin score) AND
 * has NOT improved (end-of-window score not meaningfully above its start). Only then
 * is spending best-of-N budget on it worthwhile (else normal single-edit progress is
 * still working). Insufficient history => false.
 *
 * @param {Object} p
 * @param {Array<Array<{view:number, score:number}>>} p.perViewHistory  per-iter
 *   arrays of per-view {view, score} records (oldest first).
 * @param {number} p.viewId       the view to test.
 * @param {number} [p.patience]   consecutive iters required (default 2).
 * @returns {boolean}
 */
export function detectPlateau({ perViewHistory = [], viewId, patience = 2 } = {}) {
  const hist = Array.isArray(perViewHistory) ? perViewHistory : [];
  const p = isNum(patience) && patience > 0 ? Math.floor(patience) : 1;
  if (hist.length < p) return false;
  const window = hist.slice(-p);

  const scoreOf = (iter) => {
    const rec = (Array.isArray(iter) ? iter : []).find((r) => r && r.view === viewId);
    return rec && isNum(rec.score) ? rec.score : null;
  };
  const weakestView = (iter) => {
    const arr = (Array.isArray(iter) ? iter : []).filter((r) => r && isNum(r.score));
    if (arr.length === 0) return null;
    let best = arr[0];
    for (const r of arr) if (r.score < best.score) best = r;
    return best.view;
  };

  for (const iter of window) {
    if (weakestView(iter) !== viewId) return false;
  }
  const first = scoreOf(window[0]);
  const last = scoreOf(window[window.length - 1]);
  if (first === null || last === null) return false;
  const improved = last - first > 1e-9;
  return !improved;
}

/**
 * #8 — REWARD-HACK DIVERGENCE GUARD. Compares the change in the JUDGED worst-view
 * score the best-of-N selection optimises against with the change in a HELD-OUT
 * confirmation signal it NEVER optimises against (e.g. the confirmation re-judge, or
 * a reserved view/order). When the judged score IMPROVES but the held-out signal
 * does NOT track it — divergence (judgedDelta - heldOutDelta) beyond `threshold` —
 * that is the judge-hacking signature: the caller should STOP scaling N and refuse
 * the candidate. Any missing/non-finite input => not diverged.
 *
 * @param {Object} p
 * @param {number} p.selectedJudgedScore  selected candidate's judged worst-view score now.
 * @param {number} p.heldOutScore         held-out confirmation signal now.
 * @param {number} p.prevSelectedJudged   previous judged worst-view score.
 * @param {number} p.prevHeldOut          previous held-out signal.
 * @param {number} [p.threshold]          divergence tolerance (default 0).
 * @returns {{diverged:boolean, delta:number, judgedDelta:number, heldOutDelta:number}}
 */
export function rewardHackDivergence({
  selectedJudgedScore,
  heldOutScore,
  prevSelectedJudged,
  prevHeldOut,
  threshold = 0,
} = {}) {
  if (![selectedJudgedScore, heldOutScore, prevSelectedJudged, prevHeldOut].every(isNum)) {
    return { diverged: false, delta: 0, judgedDelta: 0, heldOutDelta: 0 };
  }
  const judgedDelta = selectedJudgedScore - prevSelectedJudged;
  const heldOutDelta = heldOutScore - prevHeldOut;
  const delta = judgedDelta - heldOutDelta;
  const thr = isNum(threshold) ? threshold : 0;
  const diverged = judgedDelta > 1e-9 && delta > thr;
  return { diverged, delta, judgedDelta, heldOutDelta };
}
