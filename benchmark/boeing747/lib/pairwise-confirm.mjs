// PURE R2/R3/R7 CONFIRMATION-SET certifier for the opus-pairwise track, extracted
// verbatim from loop-runner-terransoul.mjs (behavior-identical relocation; the loop
// re-exports it so its test import path is unchanged). Kept in lib/ so the loop file
// stays under its size budget and this certification rule is directly vitest-covered
// offline (loop-runner-pairwise.test.mjs) without a live judge.
//
// All the statistics live in lib/certification-stats.mjs (citations in that header):
// the worst-view Agresti-Coull LCB / IUT (R1), the sequential betting e-process for
// straddling views (R2), and the paired-test resolution + judge flip-rate noise
// budget (R7).

import {
  DEFAULT_ALPHA,
  DEFAULT_P_FLOOR,
  agrestiCoullInterval,
  agrestiCoullLCB,
  certifyIUT,
  eProcess,
  pairedResolution,
} from './certification-stats.mjs';

const _isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * PURE + exported: the R2/R3/R7 CONFIRMATION-SET certifier. A single all-cleared
 * pass is a candidate-100% EVENT, not a certified 100% — the loop re-judges the
 * SAME rendered candidate with (1 + k_confirm) INDEPENDENT pairwise passes (fresh
 * Opus order-swaps/seeds) and hands the pooled per-view results here.
 *
 * The rule (all math in lib/certification-stats.mjs; citations in that header):
 *   - Per view, count how many of the n passes CLEARED the calibrated bar (a
 *     null/inconclusive score never counts — a coin-flip clear is void).
 *   - R1 IUT: certify a view on its one-sided AGRESTI-COULL lower bound — no
 *     cross-view Bonferroni; the worst view's LCB is the max-p statistic. A view
 *     whose AC-LCB >= p_floor is certified outright.
 *   - R2: a view whose AC-LCB is below the floor but whose two-sided interval
 *     STILL reaches above it STRADDLES — escalate to the sequential betting
 *     e-process. If E_t reaches 1/alpha it is certified (escalated); otherwise it
 *     is INCONCLUSIVE (never passes on an underpowered coin-flip). A view whose
 *     whole interval sits below the floor is a plain uncleared fail.
 *   - Persistently gemma-CONTESTED views (from the single-pass certify) BLOCK.
 *   - R3: certification is on the LCB, never the raw peak — the loop reports THIS
 *     fresh confirmation verdict, not the triggering peak score.
 *   - R7: attach the paired-test resolution (alpha, power) over the judge flip-
 *     rate noise budget; the worst-view margin above the floor must exceed it, so
 *     a "100%" is reported at a stated resolution rather than bare.
 *
 * NOTE (honest, by design): at the default k_confirm=2 (n=3 total passes) even a
 * unanimous 3/3 sweep sits below the AC-LCB floor (0.47 < 0.5) and the e-process
 * cannot reach 1/alpha, so it reports INCONCLUSIVE and the loop CONTINUES — LCB
 * certification needs roughly five unanimous passes. That underpowered-at-n=3
 * behavior is the intended R3 deflation, not a bug.
 *
 * @param {Object} p
 * @param {Array<Array<{view?:number, score:number|null, inconclusive?:boolean}>>} p.passes
 *   (1 + k_confirm) independent pairwise passes, each a per-view score array.
 * @param {number|number[]} p.bars   per-view calibrated bar(s) (a scalar broadcasts).
 * @param {number[]} [p.contestedViews]  1-based view numbers persistently gemma-contested.
 * @param {number} [p.pFloor]  pass-probability floor (default 0.5).
 * @param {number} [p.alpha]   one-sided level (default 0.05).
 * @param {number} [p.power]   R7 target power (default 0.8).
 * @param {number} [p.flipRate]  measured judge flip rate; omit to estimate from the passes.
 * @returns {{certified:boolean, worstViewLCB:number, worstViewIndex:number|null,
 *   passesUsed:number, totalViews:number, clearedCounts:number[], perView:Array<Object>,
 *   inconclusiveViews:number[], contestedViews:number[], escalatedViews:number[],
 *   blockingViews:number[], resolution:Object}}
 */
export function certifyPairwiseConfirmed({
  passes = [],
  bars,
  contestedViews = [],
  pFloor = DEFAULT_P_FLOOR,
  alpha = DEFAULT_ALPHA,
  power = 0.8,
  flipRate,
} = {}) {
  const passList = (Array.isArray(passes) ? passes : []).filter((p) => Array.isArray(p));
  const n = passList.length;
  const nViews = passList.reduce((m, p) => Math.max(m, p.length), 0);
  const barFor = (i) => (Array.isArray(bars) ? bars[i] : bars);
  const contestedSet = new Set(
    (Array.isArray(contestedViews) ? contestedViews : [])
      .map((v) => v - 1)
      .filter((i) => Number.isInteger(i) && i >= 0),
  );

  // Per-view 0/1 "cleared the bar this pass" observations. A null or inconclusive
  // (decided_fraction < 0.5) score is NOT a clear — a clear on coin-flips is void.
  const perViewObs = [];
  for (let i = 0; i < nViews; i++) {
    perViewObs.push(
      passList.map((pass) => {
        const v = pass[i];
        const score = v && _isNum(v.score) ? v.score : null;
        const bar = barFor(i);
        const inconclusive = Boolean(v && v.inconclusive) || !_isNum(score);
        return !inconclusive && _isNum(bar) && score >= bar ? 1 : 0;
      }),
    );
  }
  const clearedCounts = perViewObs.map((obs) => obs.reduce((a, b) => a + b, 0));

  const perView = perViewObs.map((obs, i) => {
    const clearedCount = clearedCounts[i];
    const passRate = n > 0 ? clearedCount / n : 0;
    const lcb = agrestiCoullLCB(clearedCount, n, alpha);
    const interval = agrestiCoullInterval(clearedCount, n, alpha);
    const certifiedByLCB = n > 0 && lcb + 1e-9 >= pFloor;
    let straddles = false;
    let escalated = false;
    let eValue = null;
    let inconclusive = false;
    let cleared = certifiedByLCB;
    if (!certifiedByLCB && n > 0) {
      // AC-LCB below the floor, but the two-sided interval still reaches above it
      // => AMBIGUOUS. Escalate to the e-process instead of rejecting on a small-n
      // bound. If the whole interval sits below the floor it is a plain fail.
      straddles = interval.upper + 1e-9 >= pFloor;
      if (straddles) {
        const ep = eProcess({ observations: obs, pFloor, alpha });
        eValue = ep.eValue;
        if (ep.aboveBar) {
          cleared = true;
          escalated = true;
        } else {
          inconclusive = true;
        }
      }
    }
    const contested = contestedSet.has(i);
    return {
      view: i + 1,
      clearedCount,
      n,
      passRate,
      lcb,
      intervalLower: interval.lower,
      intervalUpper: interval.upper,
      certifiedByLCB,
      straddles,
      escalated,
      eValue,
      inconclusive,
      contested,
      cleared: cleared && !contested,
    };
  });

  // R1 IUT worst-view (max-p) statistic — reused for the reported worst-view LCB /
  // index (contested views flagged so the report matches the block decision).
  const iut = certifyIUT({
    perViewClearedCounts: clearedCounts,
    n,
    pFloor,
    alpha,
    contestedViews: [...contestedSet],
  });

  const inconclusiveViews = perView.filter((v) => v.inconclusive).map((v) => v.view);
  const escalatedViews = perView.filter((v) => v.escalated).map((v) => v.view);
  const contestedOut = perView.filter((v) => v.contested).map((v) => v.view);
  const blockingViews = perView.filter((v) => !v.cleared).map((v) => v.view);

  // R7 resolution + judge flip-rate noise budget. With no supplied flip rate,
  // estimate it EMPIRICALLY from these very draws — the probability two
  // independent Bernoulli(passRate) draws disagree is 2p(1-p), averaged over views
  // (no hardcoded noise number; AGI-pure). The worst view (smallest LCB) sets the
  // margin above the floor a "100%" must resolve.
  const empiricalFlip =
    perView.length > 0
      ? perView.reduce((s, v) => s + 2 * v.passRate * (1 - v.passRate), 0) / perView.length
      : 0;
  const usedFlip = _isNum(flipRate) ? flipRate : empiricalFlip;
  const mde = pairedResolution({ n, alpha, power, flipRate: usedFlip });
  const worstView = iut.worstViewIndex !== null ? perView[iut.worstViewIndex] : null;
  const worstViewPassRate = worstView ? worstView.passRate : 0;
  const worstViewMargin = worstViewPassRate - pFloor;
  const resolvable = Number.isFinite(mde) && worstViewMargin + 1e-9 >= mde;

  const certified = perView.length > 0 && n > 0 && perView.every((v) => v.cleared) && resolvable;

  return {
    certified,
    worstViewLCB: iut.worstViewLCB,
    worstViewIndex: iut.worstViewIndex,
    passesUsed: n,
    totalViews: nViews,
    clearedCounts,
    perView,
    inconclusiveViews,
    contestedViews: contestedOut,
    escalatedViews,
    blockingViews,
    resolution: {
      alpha,
      power,
      n,
      flipRate: usedFlip,
      mde,
      worstViewPassRate,
      worstViewMargin,
      resolvable,
    },
  };
}
