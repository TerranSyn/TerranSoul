// BRU-5: numeric credit-assignment feedback for the actor prompt.
// NOT frozen — loop plumbing, same discipline as rebuild-burst.mjs.
//
// WHY (replay evidence, 2026-07-17): the actor is steered by the critic's
// TEXT and the reject ledger's prose, but never sees WHICH VIEWS its own
// last edit moved and by how much — so it repeatedly re-tries edit families
// whose per-view signature was measurably harmful, and never learns that a
// "profile-view fix" cratered the orthogonal views. Step-indexed numeric
// feedback beats aggregate-only text in the Reflexion-successor literature,
// and the mined ledger shows one view (data-derived, not hardcoded) detects
// breakage earliest — the "sentinel". Both are surfaced here as PURE
// formatters; the runner injects them as additive prompt sections.
//
// GENERIC: view ids/keys and all numbers are caller-supplied; nothing in
// this module names a domain, a criterion, or a coordinate.

/**
 * Format the previous gated edit's measured effect as a compact prompt
 * section. Returns null when there is nothing to report (no prior gated
 * edit, or no per-view data).
 * @param {object} p
 * @param {{decision:string, totalDelta:number|null, perViewDelta:Array<number|null>|null}|null} p.lastEditEffect
 * @param {Array<{view:number, key:string}>} p.views  view id/key labels, gate order
 * @returns {string|null}
 */
export function formatLastEditEffectSection({ lastEditEffect, views = [] }) {
  if (!lastEditEffect || !Array.isArray(lastEditEffect.perViewDelta)) return null;
  const moved = lastEditEffect.perViewDelta
    .map((d, i) => ({ d, label: views[i] ? `view ${views[i].view} (${views[i].key})` : `view ${i + 1}` }))
    .filter((x) => typeof x.d === 'number' && Number.isFinite(x.d) && Math.abs(x.d) >= 0.05);
  const improved = moved.filter((x) => x.d > 0).map((x) => `${x.label} ${x.d > 0 ? '+' : ''}${x.d.toFixed(2)}`);
  const regressed = moved.filter((x) => x.d < 0).map((x) => `${x.label} ${x.d.toFixed(2)}`);
  const verdict =
    lastEditEffect.decision === 'accept'
      ? 'ACCEPTED and banked'
      : lastEditEffect.decision === 'reject'
        ? 'REJECTED and rolled back'
        : 'kept as within-noise exploration';
  const total = Number.isFinite(lastEditEffect.totalDelta) ? ` Net overall delta: ${lastEditEffect.totalDelta > 0 ? '+' : ''}${lastEditEffect.totalDelta.toFixed(2)}.` : '';
  return [
    'YOUR PREVIOUS EDIT — MEASURED EFFECT (numeric, per view; use this, not your own impression):',
    `- Verdict: ${verdict}.${total}`,
    `- Views improved: ${improved.length ? improved.join('; ') : 'none'}`,
    `- Views regressed: ${regressed.length ? regressed.join('; ') : 'none'}`,
    '- If a view regressed, your next edit must not repeat that change-shape; if views improved and the edit was still rejected, the improvement was outweighed — shrink the change, keep the direction.',
  ].join('\n');
}

/**
 * Pick the sentinel view — the one that historically drops hardest when an
 * edit is rejected — from the rejected-edits ledger's per_view_delta arrays.
 * Data-derived, never hardcoded. Returns null with fewer than `minSamples`
 * usable entries.
 * @param {Array<{per_view_delta?:Array<number|null>}>} rejectedEdits
 * @param {number} [minSamples]
 * @returns {{index:number, meanDrop:number, samples:number}|null}
 */
export function computeSentinelView(rejectedEdits, minSamples = 3) {
  const sums = new Map();
  let samples = 0;
  for (const e of rejectedEdits || []) {
    if (!Array.isArray(e.per_view_delta)) continue;
    samples += 1;
    e.per_view_delta.forEach((d, i) => {
      if (typeof d === 'number' && Number.isFinite(d) && d < 0) {
        const cur = sums.get(i) || { total: 0, n: 0 };
        cur.total += d;
        cur.n += 1;
        sums.set(i, cur);
      }
    });
  }
  if (samples < minSamples || sums.size === 0) return null;
  let best = null;
  for (const [index, { total, n }] of sums) {
    const meanDrop = total / n;
    if (!best || meanDrop < best.meanDrop) best = { index, meanDrop, samples: n };
  }
  return best;
}

/**
 * Format the sentinel pre-commit line for the actor prompt. Null when no
 * sentinel is derivable yet.
 * @param {{sentinel:{index:number, meanDrop:number}|null, views:Array<{view:number, key:string}>}} p
 * @returns {string|null}
 */
export function formatSentinelLine({ sentinel, views = [] }) {
  if (!sentinel) return null;
  const v = views[sentinel.index];
  const label = v ? `view ${v.view} (${v.key})` : `view ${sentinel.index + 1}`;
  return (
    `SENTINEL CHECK: on this candidate's own history, ${label} detects breakage earliest ` +
    `(mean drop ${sentinel.meanDrop.toFixed(2)} across rejected edits). Before finishing, open that render and state ` +
    'in one sentence what your edit changes in it — if you expect it to get worse, make the edit smaller instead.'
  );
}
