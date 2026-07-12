// FROZEN stop conditions for the Boeing 747 primitives vision benchmark loop.
// Pure functions only — covered by vitest (stop-conditions.test.mjs).
//
// Protocol (printed by loop-runner, never silently enforced):
//   1. threshold — the LATEST iteration has all 9 views scored (no nulls)
//      and every view >= viewThreshold (rubric.json: 8.0/10).
//   2. stall — `patience` (3) consecutive iterations without improving the
//      running best total.
//   3. budget — iteration count reached the budget (12).

/**
 * @param {Array<{iter:number, total:number|null, perView:Array<number|null>}>} iterations
 *   Chronologically ordered iteration records.
 * @param {{viewThreshold:number, patience:number, budget:number, viewCount?:number}} cfg
 * @returns {{stop:boolean, reasons:string[], bestTotal:number|null,
 *            consecutiveNonImproving:number, remainingBudget:number}}
 */
export function evaluateStopConditions(iterations, cfg) {
  const viewCount = cfg.viewCount ?? 9;
  const reasons = [];

  // Running best + trailing non-improving streak.
  let bestTotal = null;
  let streak = 0;
  for (const it of iterations) {
    const improved =
      typeof it.total === 'number' && (bestTotal === null || it.total > bestTotal);
    if (improved) {
      bestTotal = it.total;
      streak = 0;
    } else {
      streak += 1;
    }
  }

  // viewThreshold may be a single NUMBER (uniform bar — the frozen gemma/Fable
  // tracks, byte-identical to before) OR a per-view ARRAY [t_1..t_viewCount]
  // (the Opus-4.8-panel CALIBRATED bar): each view i must clear its own
  // calibrated threshold t_i. This is how "100% = as good as a real-747
  // reference on every view" is expressed without an arbitrary uniform 8.0.
  const thresholdFor = (i) =>
    Array.isArray(cfg.viewThreshold) ? cfg.viewThreshold[i] : cfg.viewThreshold;
  const latest = iterations.length > 0 ? iterations[iterations.length - 1] : null;
  if (latest && Array.isArray(latest.perView) && latest.perView.length === viewCount) {
    const allScored = latest.perView.every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    );
    if (allScored && latest.perView.every((v, i) => v >= thresholdFor(i))) {
      const barDesc = Array.isArray(cfg.viewThreshold)
        ? `their per-view calibrated bars [${cfg.viewThreshold.join(', ')}]`
        : `${cfg.viewThreshold}/10`;
      reasons.push(
        `threshold: all ${viewCount} views >= ${barDesc} on iteration ${latest.iter}`,
      );
    }
  }

  if (iterations.length > 0 && streak >= cfg.patience) {
    reasons.push(
      `stall: ${streak} consecutive iterations without improving best total (${bestTotal})`,
    );
  }

  if (iterations.length >= cfg.budget) {
    reasons.push(`budget: ${iterations.length}/${cfg.budget} iterations used`);
  }

  return {
    stop: reasons.length > 0,
    reasons,
    bestTotal,
    consecutiveNonImproving: streak,
    remainingBudget: Math.max(0, cfg.budget - iterations.length),
  };
}
