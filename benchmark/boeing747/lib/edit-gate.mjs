// SkillOpt EDIT-GATE for the Boeing 747 primitives vision benchmark loop.
// Wired into loop-runner-terransoul.mjs ONLY under `if (pairwiseMode)` — the
// frozen `gemma` default and existing `opus-panel` paths never import this
// module, so the 73.68 gemma record and its geometry stay byte-identical
// (EDIT_GATE_SPEC).
//
// PROBLEM this closes: today the actor edits candidates/<actor>/plane.js in
// place and bookkeepTrack only records best.json — a REGRESSING edit STAYS and
// the next actor edits on top of the regression, so the accepted trajectory
// can wander downhill. FIX (SkillOpt accept-gate + backtrack-to-best +
// rejected-edit ledger): keep a `best-plane.js` snapshot; at the top of
// iteration N (once the fresh pairwise total for N-1's geometry is known)
// accept/reject N-1's edit and restore-if-rejected BEFORE iteration N runs.
// On the accepted trajectory `best` becomes monotone-non-decreasing, so
// stop-conditions' `stall` honestly means "the actor cannot find an ACCEPTED
// improvement". The reverted FILE never touches recorded totals — iter-N.json
// still records the TRUE measured regressed number.
//
// The DECISION function `decideEditAcceptance` is PURE (no I/O) so the whole
// accept/reject/backtrack/escalation/gemma-persistence policy is directly
// vitest-covered without a filesystem or a live judge. The thin I/O helpers
// (snapshotBest/restoreBest/appendRejectedEdit/loadRejectedEdits) take an
// injectable `fsImpl` seam so their round-trip is covered on a tmp dir with
// the real node:fs, and they FAIL OPEN (never throw into the bench loop).
//
// AGI-purity (rules/bench-agi-purity.md): GENERIC mechanism only. Every
// domain-specific value (view bars, deltas, edit summaries, criterion ids)
// flows through as a CALLER-SUPPLIED argument. There is no Boeing-747 (or any
// benchmark) word in this file's own logic.
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** Default filesystem seam — swapped for a fake object in unit tests. */
const DEFAULT_FS = { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync };

/**
 * How many CONSECUTIVE iterations a cross-family (gemma) DOWNSIDE signal must
 * persist before it is allowed to influence the gate at all. Review fixes #4
 * and #5: a single-iteration gemma dip is pure noise relative to gemma's own
 * band, so it is downgraded to a LOGGED SOFT-FLAG and can NEVER drive a
 * backtrack. Only a downside that repeats across >= this many iterations is
 * trusted enough to BLOCK banking an otherwise-accepted edit — and even then
 * gemma is never a hard REJECT key (no restore/thrash), it only downgrades an
 * ACCEPT to WITHIN_NOISE.
 */
export const DEFAULT_GEMMA_PERSIST_THRESHOLD = 2;

/** Finite-number guard used throughout (null/undefined/NaN/Infinity => false). */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * PURE edit-gate decision. Given the fresh GATING (Opus-pairwise) total for the
 * edit under evaluation, the running best, the per-view calibrated bars, and
 * the (soft, persistence-tracked) cross-family gemma signal, decide whether to
 * ACCEPT the edit (advance best), keep it as WITHIN_NOISE exploration (best
 * unchanged), or REJECT it (caller restores best-plane.js so the next actor
 * edits from the BEST geometry).
 *
 * REJECT (regression) iff EITHER:
 *   - total regression: gateTotal < bestTotal - epsilonTotal (enforced ALWAYS,
 *     including under escalation — the aggregate is the escalation contract), OR
 *   - cleared-view collapse: some view that was previously CLEARED
 *     (bestPerView[i] >= bar[i]) drops below bar[i] by more than epsilonView —
 *     UNLESS `escalationArmed` (the mesh-escalation prompt explicitly lets the
 *     actor accept a small transient dip in one already-good view to
 *     re-architect a feature, so a bold rebuild is gated on AGGREGATE ONLY and
 *     never rejected for a 1-view transient).
 * The cross-family gemma DOWNSIDE is deliberately NOT a reject key (review
 * fixes #4/#5) — see DEFAULT_GEMMA_PERSIST_THRESHOLD.
 *
 * ACCEPT iff gateTotal > bestTotal + epsilonTotal AND no cleared-view collapse
 * AND no PERSISTED gemma downside ⇒ caller advances best (copy plane.js ->
 * best-plane.js, write best.json, strategy helpful++).
 *
 * WITHIN_NOISE otherwise (|delta| <= epsilonTotal, or a would-be ACCEPT blocked
 * by a persisted gemma downside): keep the working file (allow exploration) but
 * do NOT advance best (never lock in a lucky-high).
 *
 * @param {object} p
 * @param {number|null} p.gateTotal      fresh gating (Opus-pairwise) total_0_100 for the edit under test
 * @param {Array<number|null>} [p.gatePerView]   its per-view scores
 * @param {number|null} p.bestTotal      running best total (null on the very first gate ⇒ baseline ACCEPT)
 * @param {Array<number|null>} [p.bestPerView]   best's per-view scores
 * @param {Array<number|null>} [p.clearedViewsBar]  per-view calibrated bars Bar_v (from calibration Probe B)
 * @param {number|null} [p.gemmaTotal]      cross-family gemma total_0_100 for this edit
 * @param {number|null} [p.prevGemmaBest]   gemma total at the current best (baseline for the downside)
 * @param {number} p.epsilonTotal    measured total-level noise (calibration Probe B)
 * @param {number} [p.epsilonView]   measured per-view noise
 * @param {number} [p.epsilonGemma]  measured gemma-level noise
 * @param {boolean} [p.escalationArmed]  the escalation prompt was armed this iteration (aggregate-only gate)
 * @param {number} [p.priorGemmaDownsideStreak]  consecutive prior iterations already showing a gemma downside
 * @param {number} [p.gemmaPersistThreshold]     iterations a gemma downside must persist to influence (default 2)
 * @returns {{
 *   decision:'accept'|'within_noise'|'reject', reason:string,
 *   totalDelta:number|null, perViewDelta:Array<number|null>, collapsedViews:number[],
 *   gemmaDownside:boolean, gemmaDownsideStreak:number, gemmaSoftFlag:boolean,
 *   gemmaPersistedDownside:boolean }}
 */
export function decideEditAcceptance({
  gateTotal,
  gatePerView = [],
  bestTotal,
  bestPerView = [],
  clearedViewsBar = [],
  gemmaTotal,
  prevGemmaBest,
  epsilonTotal = 0,
  epsilonView = 0,
  epsilonGemma = 0,
  escalationArmed = false,
  priorGemmaDownsideStreak = 0,
  gemmaPersistThreshold = DEFAULT_GEMMA_PERSIST_THRESHOLD,
} = {}) {
  // ---- cross-family (gemma) DOWNSIDE: soft-flag, persistence-tracked, NEVER a
  // hard reject key. Computed first so it is reported on every branch. ----
  const gemmaDownside =
    isNum(gemmaTotal) && isNum(prevGemmaBest) && gemmaTotal < prevGemmaBest - epsilonGemma;
  const priorStreak = Number.isFinite(priorGemmaDownsideStreak) ? Math.max(0, priorGemmaDownsideStreak) : 0;
  const gemmaDownsideStreak = gemmaDownside ? priorStreak + 1 : 0;
  const gemmaSoftFlag = gemmaDownsideStreak >= 1;
  const threshold = Number.isFinite(gemmaPersistThreshold) ? Math.max(1, gemmaPersistThreshold) : DEFAULT_GEMMA_PERSIST_THRESHOLD;
  const gemmaPersistedDownside = gemmaDownsideStreak >= threshold;

  // per-view delta (candidate - best), null where either side is unscored.
  const perViewDelta = (gatePerView || []).map((v, i) =>
    isNum(v) && isNum(bestPerView[i]) ? Math.round((v - bestPerView[i]) * 100) / 100 : null,
  );

  const base = {
    totalDelta: null,
    perViewDelta,
    collapsedViews: [],
    gemmaDownside,
    gemmaDownsideStreak,
    gemmaSoftFlag,
    gemmaPersistedDownside,
  };

  // ---- fail-open: no fresh gating number ⇒ cannot evaluate; keep the working
  // file, do NOT advance best, do NOT backtrack (a judge miss must not thrash). ----
  if (!isNum(gateTotal)) {
    return { ...base, decision: 'within_noise', reason: 'gate total unavailable (fail-open; best unchanged)' };
  }

  // ---- baseline: nothing to regress against yet ⇒ establish best. ----
  if (!isNum(bestTotal)) {
    return { ...base, decision: 'accept', reason: 'baseline established (no prior best)', totalDelta: null };
  }

  const totalDelta = Math.round((gateTotal - bestTotal) * 100) / 100;
  const totalRegression = gateTotal < bestTotal - epsilonTotal;
  const totalImprovement = gateTotal > bestTotal + epsilonTotal;

  // cleared-view collapse: a view previously at/above its bar that now drops
  // below the bar by more than the per-view noise. Exempt under escalation.
  const collapsedViews = [];
  if (!escalationArmed) {
    for (let i = 0; i < (gatePerView || []).length; i++) {
      const bar = clearedViewsBar[i];
      if (!isNum(bar)) continue;
      const wasCleared = isNum(bestPerView[i]) && bestPerView[i] >= bar;
      const nowScored = isNum(gatePerView[i]);
      // Only a SCORED drop counts as a collapse — an unscored/failed view is a
      // judge miss, not evidence of geometric regression (fail-open, no thrash).
      if (wasCleared && nowScored && gatePerView[i] < bar - epsilonView) {
        collapsedViews.push(i);
      }
    }
  }

  const result = { ...base, totalDelta, collapsedViews };

  // ---- REJECT (regression) — total is enforced even under escalation. ----
  if (totalRegression) {
    return {
      ...result,
      decision: 'reject',
      reason: `total regression: ${gateTotal} < best ${bestTotal} - epsilonTotal ${epsilonTotal} (delta ${totalDelta})`,
    };
  }
  if (collapsedViews.length > 0) {
    return {
      ...result,
      decision: 'reject',
      reason: `cleared-view collapse: view(s) [${collapsedViews.join(', ')}] dropped below their bar by > epsilonView ${epsilonView}`,
    };
  }

  // ---- ACCEPT (genuine improvement, no cleared-view collapse). A PERSISTED
  // gemma downside downgrades it to WITHIN_NOISE (block banking a gemma-
  // contested gain) but NEVER rejects/backtracks — no thrash. ----
  if (totalImprovement) {
    if (gemmaPersistedDownside) {
      return {
        ...result,
        decision: 'within_noise',
        reason: `improved on Opus (delta ${totalDelta}) but a PERSISTED gemma downside (streak ${gemmaDownsideStreak} >= ${threshold}) blocks banking; kept for exploration, best unchanged`,
      };
    }
    return { ...result, decision: 'accept', reason: `accepted improvement (delta ${totalDelta} > epsilonTotal ${epsilonTotal})` };
  }

  // ---- WITHIN_NOISE: |delta| <= epsilonTotal. Keep working file, best unchanged. ----
  const flag = gemmaSoftFlag
    ? ` (gemma soft-flag: downside streak ${gemmaDownsideStreak}${gemmaPersistedDownside ? ', PERSISTED' : ', not yet persisted'})`
    : '';
  return { ...result, decision: 'within_noise', reason: `within noise (|delta ${totalDelta}| <= epsilonTotal ${epsilonTotal})${flag}` };
}

// ---------------------------------------------------------------------------
// Thin, injectable I/O helpers. All FAIL OPEN — a snapshot/restore/ledger miss
// logs and returns { ok:false } rather than throwing into the bench loop
// (EDIT_GATE_SPEC: "All snapshot/ledger writes fail-open and are pairwise-only").
// ---------------------------------------------------------------------------

/**
 * Copy candidate plane.js -> best-plane.js (advance the backtrack anchor).
 * @returns {{ok:boolean, error?:string}}
 */
export function snapshotBest({ candidatePath, bestPlanePath, fsImpl = DEFAULT_FS } = {}) {
  if (!candidatePath || !bestPlanePath) return { ok: false, error: 'snapshotBest requires candidatePath + bestPlanePath' };
  try {
    const dir = path.dirname(bestPlanePath);
    if (dir && !fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.copyFileSync(candidatePath, bestPlanePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Restore candidate plane.js from best-plane.js verbatim (backtrack-to-best on
 * a REJECT) so iteration N's actor edits from the BEST geometry. Same restore
 * mechanism actor-claude already uses on a contract violation, just to best
 * rather than to previous.
 * @returns {{ok:boolean, error?:string}}
 */
export function restoreBest({ bestPlanePath, candidatePath, fsImpl = DEFAULT_FS } = {}) {
  if (!bestPlanePath || !candidatePath) return { ok: false, error: 'restoreBest requires bestPlanePath + candidatePath' };
  try {
    if (!fsImpl.existsSync(bestPlanePath)) return { ok: false, error: `best snapshot missing: ${bestPlanePath}` };
    const dir = path.dirname(candidatePath);
    if (dir && !fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.copyFileSync(bestPlanePath, candidatePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Normalized-text fingerprint of an edit for DEDUP: lowercase -> strip
 * punctuation to spaces -> collapse whitespace -> first ~12 significant tokens,
 * joined with the targeted criterion. Two edits with the same fingerprint are
 * treated as the same dead-end (EDIT_GATE_SPEC dedup guard). PURE.
 */
export function editFingerprint(summary, criterion) {
  const norm = String(summary || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');
  return `${String(criterion || 'global')}::${norm}`;
}

/**
 * True when `ledger` already contains an entry matching this edit — by
 * rejected_sha256 when present, else by the summary+criterion fingerprint.
 * PURE.
 */
export function isDuplicateRejectedEdit(ledger, { summary, criterion, sha256 } = {}) {
  if (!Array.isArray(ledger) || ledger.length === 0) return false;
  const fp = editFingerprint(summary, criterion);
  return ledger.some((e) => {
    if (sha256 && e && e.rejected_sha256 && e.rejected_sha256 === sha256) return true;
    return editFingerprint(e?.edit_summary, e?.weakest_feature_targeted) === fp;
  });
}

/**
 * Read the rejected-edit ledger (JSON array). Fails open to [] on any missing
 * file / read error / parse error — mirrors fetchPriorAttempts' fail-open.
 * @returns {Array<object>}
 */
export function loadRejectedEdits({ ledgerPath, fsImpl = DEFAULT_FS } = {}) {
  if (!ledgerPath) return [];
  try {
    if (!fsImpl.existsSync(ledgerPath)) return [];
    const parsed = JSON.parse(fsImpl.readFileSync(ledgerPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append one rejected-edit record to the ledger, DEDUPED (a fingerprint- or
 * sha-matching entry already present is not re-appended, so a thrashing actor
 * does not bloat the ledger). Fails open — a write error returns { ok:false }
 * with the in-memory ledger rather than throwing.
 * @returns {{ok:boolean, appended:boolean, ledger:Array<object>, error?:string}}
 */
export function appendRejectedEdit({ ledgerPath, entry, fsImpl = DEFAULT_FS } = {}) {
  if (!ledgerPath || !entry) return { ok: false, appended: false, ledger: [], error: 'appendRejectedEdit requires ledgerPath + entry' };
  const ledger = loadRejectedEdits({ ledgerPath, fsImpl });
  if (
    isDuplicateRejectedEdit(ledger, {
      summary: entry.edit_summary,
      criterion: entry.weakest_feature_targeted,
      sha256: entry.rejected_sha256,
    })
  ) {
    return { ok: true, appended: false, ledger };
  }
  const next = [...ledger, entry];
  try {
    const dir = path.dirname(ledgerPath);
    if (dir && !fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(ledgerPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { ok: true, appended: true, ledger: next };
  } catch (e) {
    return { ok: false, appended: false, ledger, error: String(e?.message || e) };
  }
}

/**
 * Render an ANTI-EXAMPLE prompt block from the rejected-edit ledger for the
 * NEXT actor prompt ("REJECTED EDITS — do not repeat: iter N tried '<summary>'
 * on <feature>; it regressed <view> by <delta>; take a different approach").
 * Returns null when the ledger is empty (never injects an empty section).
 * `maxItems`/`maxCharsPerItem` bound prompt bloat near the 600s timeout — the
 * MOST RECENT rejects are kept.
 */
export function formatRejectedEditsSection(ledger, { header, maxItems = 5, maxCharsPerItem = 240 } = {}) {
  if (!Array.isArray(ledger) || ledger.length === 0) return null;
  const lines = [
    header ||
      'REJECTED EDITS ON THIS BENCHMARK (your own — they regressed the score and were backed out; do NOT repeat them, take a different approach):',
  ];
  const recent = ledger.slice(-maxItems).reverse();
  for (const e of recent) {
    const feature = e?.weakest_feature_targeted || 'global';
    let summary = String(e?.edit_summary || '(no summary)');
    if (summary.length > maxCharsPerItem) summary = `${summary.slice(0, maxCharsPerItem)}...`;
    const delta = isNum(e?.gating_delta) ? ` (regressed total by ${e.gating_delta})` : '';
    const iter = e?.iter !== undefined ? `iter ${e.iter} ` : '';
    lines.push(`- ${iter}on ${feature}: "${summary}"${delta}`);
  }
  return lines.join('\n');
}
