// opus-pairwise CERTIFICATION primitives, extracted VERBATIM from
// loop-runner-terransoul.mjs (max-lines refactor, 2026-07-18). The runner
// imports these and re-exports the test-pinned names, so
// loop-runner-pairwise.test.mjs's imports against './loop-runner-terransoul.mjs'
// are unchanged. PURE: no imports, no I/O — exactly the code that moved
// (`_isNum` and `formatResolution` gained `export` so the runner and
// lib/gate-state.mjs can keep calling them; nothing else changed).

// A gemma cross-family CONTESTED flag on an Opus-cleared view must PERSIST across
// this many consecutive iterations before it can BLOCK threshold certification
// (adversarial-review fixes #4/#5: a single-iteration gemma dip is noise relative
// to gemma's own band — it is only a logged soft-flag, never a hard reject).
export const CONTESTED_PERSIST_THRESHOLD = 2;

// --- opus-pairwise CERTIFICATION ("100%" definition) -----------------------
// PURE + exported so the certification rule is directly vitest-covered without a
// live judge. A candidate is "100%" ONLY when every one of the 9 views clears
// its per-view CALIBRATED bar (parity >= Bar_v) with NO inconclusive view (a
// coin-flip: pairwise decided_fraction < 0.5) and NO persistently gemma-CONTESTED
// view — NOT total_0_100 == 100. This is stricter than the frozen
// evaluateStopConditions threshold (which only checks score >= bar); the extra
// inconclusive/contested gates close the hollow-100% path (adversarial-review
// fix #1) and add the cross-family veto (fix #4/#5) WITHOUT letting a single
// noisy gemma dip block a clear (it must persist >= contestedPersistThreshold).

export const _isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Compute the per-view cleared / inconclusive / gemma-contested flags and the
 * overall certification verdict from ONE iteration's Opus-pairwise per-view
 * scores, the calibrated bars, and the reported gemma cross-family scores.
 *
 * @param {Object} p
 * @param {Array<{view?:number, score:number|null, inconclusive?:boolean}>} p.perView
 *   the Opus-pairwise per-view objects (from judgeShotsPairwise).
 * @param {number|number[]} p.bars   per-view calibrated bar(s) (a scalar broadcasts).
 * @param {Array<number|null>} [p.gemmaCandidatePerView]  reported gemma per-view scores (candidate).
 * @param {Array<number|null>} [p.gemmaReferencePerView]  gemma per-view scores at the reference build (sidecar).
 * @param {number} [p.gemmaVetoBand]  a cleared view is CONTESTED-now when gemmaCand < gemmaRef - band.
 * @param {Array<number>} [p.priorContestedStreaks]  each view's contested streak from the previous iteration.
 * @param {number} [p.contestedPersistThreshold]  streak length a contested flag must reach to BLOCK.
 * @returns {{certified:boolean, allCleared:boolean, clearedViews:number, totalViews:number,
 *   inconclusiveViews:number[], contestedViews:number[], softFlaggedViews:number[],
 *   contestedStreaks:number[], flags:Array<Object>}}
 */
export function certifyPairwiseStop({
  perView = [],
  bars,
  gemmaCandidatePerView = [],
  gemmaReferencePerView = [],
  gemmaVetoBand = 1.0,
  priorContestedStreaks = [],
  contestedPersistThreshold = CONTESTED_PERSIST_THRESHOLD,
} = {}) {
  const views = Array.isArray(perView) ? perView : [];
  const barFor = (i) => (Array.isArray(bars) ? bars[i] : bars);
  const flags = views.map((v, i) => {
    const score = v && _isNum(v.score) ? v.score : null;
    const bar = barFor(i);
    const cleared = _isNum(score) && _isNum(bar) && score >= bar;
    // A view with no finite score, or explicitly flagged inconclusive (pairwise
    // decided_fraction < 0.5), is NOT certifiable — a clear on coin-flips is void.
    const inconclusive = Boolean(v && v.inconclusive) || !_isNum(score);
    const gc = gemmaCandidatePerView[i];
    const gr = gemmaReferencePerView[i];
    // Cross-family CONTESTED (fix #4/#5): only meaningful on an Opus-cleared view,
    // only when BOTH gemma numbers are confidently parsed (fail-open otherwise),
    // and only a downside beyond the veto band counts. It is a SOFT flag that must
    // PERSIST before it blocks — a single-iteration gemma dip never vetoes.
    const contestedNow = cleared && _isNum(gc) && _isNum(gr) && gc < gr - gemmaVetoBand;
    const priorStreak = _isNum(priorContestedStreaks[i]) ? Math.max(0, priorContestedStreaks[i]) : 0;
    const contestedStreak = contestedNow ? priorStreak + 1 : 0;
    const contestedBlocking = contestedStreak >= Math.max(1, contestedPersistThreshold);
    return {
      view: v && _isNum(v.view) ? v.view : i + 1,
      score,
      bar: _isNum(bar) ? bar : null,
      cleared,
      inconclusive,
      contestedNow,
      contestedStreak,
      contestedBlocking,
    };
  });
  const clearedViews = flags.filter((f) => f.cleared).length;
  const inconclusiveViews = flags.filter((f) => f.inconclusive).map((f) => f.view);
  const contestedViews = flags.filter((f) => f.contestedBlocking).map((f) => f.view);
  const softFlaggedViews = flags.filter((f) => f.contestedNow && !f.contestedBlocking).map((f) => f.view);
  const allCleared = flags.length > 0 && flags.every((f) => f.cleared);
  const certified = allCleared && inconclusiveViews.length === 0 && contestedViews.length === 0;
  return {
    certified,
    allCleared,
    clearedViews,
    totalViews: flags.length,
    inconclusiveViews,
    contestedViews,
    softFlaggedViews,
    contestedStreaks: flags.map((f) => f.contestedStreak),
    flags,
  };
}

/**
 * PURE + exported: fold the FROZEN evaluateStopConditions verdict together with
 * the pairwise certification into the loop's actual stop decision. stall/budget
 * reasons stop the loop unchanged; a THRESHOLD reason only stops (and is kept)
 * when the certification passed — otherwise it is DOWNGRADED to a "not certified
 * (continuing)" note naming the blocking views, so a hollow / gemma-contested /
 * coin-flip "all bars met" can never bank a false 100%.
 *
 * When a `confirmed` verdict (certifyPairwiseConfirmed) is supplied — the loop
 * computes it ONLY after a single all-cleared pass, the candidate-100% event — the
 * threshold banks a stop iff the pooled (1 + k_confirm) LCB CONFIRMATION passes
 * (R2/R3): we report the FRESH confirmation verdict at its stated resolution, never
 * the triggering peak. Absent `confirmed`, the legacy single-pass certify gate is
 * used unchanged (byte-identical for every non-confirmed caller/test).
 *
 * @param {{reasons:string[]}} p.claudeStop  the evaluateStopConditions result (calibrated bar).
 * @param {{certified:boolean, allCleared:boolean, inconclusiveViews:number[], contestedViews:number[]}} p.certify
 * @param {Object} [p.confirmed]  certifyPairwiseConfirmed() output (R2/R3/R7); optional.
 * @returns {{stop:boolean, reasons:string[], certified:boolean}}
 */
export function computePairwiseStop({ claudeStop, certify, confirmed }) {
  const reasons = [];
  let stop = false;
  const cert = certify || { certified: false, allCleared: false, inconclusiveViews: [], contestedViews: [] };
  for (const r of (claudeStop && Array.isArray(claudeStop.reasons) ? claudeStop.reasons : [])) {
    if (String(r).startsWith('threshold:')) {
      if (confirmed) {
        // R2/R3: gate the threshold on the CONFIRMATION-set certification (LCB over
        // 1+k_confirm independent passes), never the single-pass peak.
        if (confirmed.certified) {
          reasons.push(
            `${r} — CONFIRMED (worst-view AC LCB ${confirmed.worstViewLCB.toFixed(3)} over ` +
              `${confirmed.passesUsed} independent passes; 100% at resolution ${formatResolution(confirmed.resolution)})`,
          );
          stop = true;
        } else {
          const inc = new Set(confirmed.inconclusiveViews);
          const con = new Set(confirmed.contestedViews);
          const unresolved = confirmed.blockingViews.filter((v) => !inc.has(v) && !con.has(v));
          const blockers = [];
          if (unresolved.length > 0) blockers.push(`views below the LCB floor [${unresolved.join(', ')}]`);
          if (confirmed.inconclusiveViews.length > 0) {
            blockers.push(`inconclusive after e-process [${confirmed.inconclusiveViews.join(', ')}]`);
          }
          if (confirmed.contestedViews.length > 0) {
            blockers.push(`gemma-contested views [${confirmed.contestedViews.join(', ')}]`);
          }
          if (!confirmed.resolution.resolvable) {
            const mde = Number.isFinite(confirmed.resolution.mde) ? confirmed.resolution.mde.toFixed(3) : 'inf';
            blockers.push(`worst-view margin ${confirmed.resolution.worstViewMargin.toFixed(3)} below resolution ${mde}`);
          }
          reasons.push(
            `threshold NOT confirmed over ${confirmed.passesUsed} passes ` +
              `(${blockers.join('; ') || 'confirmation failed'}) — continuing`,
          );
        }
      } else if (cert.certified) {
        reasons.push(r);
        stop = true;
      } else {
        const blockers = [];
        if (!cert.allCleared) blockers.push('not every view cleared its bar');
        if (cert.inconclusiveViews.length > 0) blockers.push(`inconclusive views [${cert.inconclusiveViews.join(', ')}]`);
        if (cert.contestedViews.length > 0) blockers.push(`gemma-contested views [${cert.contestedViews.join(', ')}]`);
        reasons.push(`threshold NOT certified (${blockers.join('; ') || 'certification failed'}) — continuing`);
      }
    } else {
      // stall / budget: a legitimate loop stop regardless of certification.
      reasons.push(r);
      stop = true;
    }
  }
  return { stop, reasons, certified: confirmed ? confirmed.certified : cert.certified };
}

/** Human-readable one-liner for an R7 resolution record (log/report only). */
export function formatResolution(res) {
  if (!res) return 'n/a';
  const mde = Number.isFinite(res.mde) ? res.mde.toFixed(3) : 'inf';
  const flip = _isNum(res.flipRate) ? res.flipRate.toFixed(3) : '?';
  return `MDE ${mde} (n=${res.n}, flip~=${flip}, power=${res.power})`;
}
