// Depth-capped REBUILD BURSTS for the frozen-gemma edit gate
// (lib/gemma-gate-wiring.mjs). NOT frozen — this file is part of this fix.
//
// WHY this exists (BOEING-747-REBUILD-BURST-1, live-measured 2026-07-17):
// the frozen-track plateau escalation directs the actor to RECOMPOSE the
// weakest component from primitives — a multi-edit job whose first edit
// almost always dips the total before the recomposition can recover — while
// the single-iteration gate rejects any dip and restores the incumbent.
// Measured: 7 consecutive escalation-directed edits (iters 71-77 of the
// terransoul-gemma-taught-v4 campaign) each regressed 3-7 points, were
// rejected, and were reverted, so the recomposition could never get past
// its own first step. The published literature agrees refinement returns
// need 2-3 sequential edits from a parent before being judged (depth-capped
// bursts; last-iterate selection underperforms best-iterate).
//
// MECHANISM (generic; no domain vocabulary in this module's logic):
// - When a REJECT lands while plateau escalation is armed, the gate DEFERS
//   the restore and lets the working candidate keep evolving for up to
//   `max_depth` consecutive gated genuine iterations (a "burst").
// - Any burst iteration that beats best + epsilon banks through the normal
//   ACCEPT path — the banked best/floor advances ONLY on accept, exactly as
//   before, so never-regress bookkeeping is untouched.
// - A burst that ends without banking restores the incumbent, and every
//   reject inside a burst is still recorded in the rejected-edits ledger.
//
// This module is PURE (decideBurstAction has no I/O). The one I/O function,
// loadRebuildBurstConfig(), reads the documented policy value out of
// mcp-data/shared/seed-lessons.sql — the same mechanism actor-retry.mjs's
// loadActorRetryConfig() uses (rubric.json is FROZEN and may not gain new
// keys). Fail-open to the DEFAULT_* constants below; never throws.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(LIB_DIR, '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

/** Default location of the brain-seed file this config is read from. */
export const SEED_PATH = path.join(REPO_ROOT, 'mcp-data', 'shared', 'seed-lessons.sql');

// Anchor text + JSON marker uniquely identifying the seeded config row.
export const CONFIG_ANCHOR = 'CONFIG (BOEING-747-REBUILD-BURST-1 config)';
export const CONFIG_JSON_MARKER = 'REBUILD_BURST_CONFIG_JSON:';

// Fail-open fallback — used ONLY when the seed row is absent/unparsable.
// Equal to the values the seed row documents, so a fresh checkout behaves
// identically before and after the first reseed.
export const DEFAULT_ENABLED = true;
export const DEFAULT_MAX_DEPTH = 3;

/**
 * Parse the REBUILD_BURST_CONFIG_JSON payload out of a seed-lessons.sql
 * source string. Pure — takes file content as a string, never touches disk.
 * @param {string} seedSource
 * @returns {{enabled:boolean, maxDepth:number, source:'seed'}|null}
 */
export function parseRebuildBurstConfig(seedSource) {
  if (typeof seedSource !== 'string') return null;
  const anchorIdx = seedSource.indexOf(CONFIG_ANCHOR);
  if (anchorIdx < 0) return null;
  const markerIdx = seedSource.indexOf(CONFIG_JSON_MARKER, anchorIdx);
  if (markerIdx < 0) return null;
  const tail = seedSource.slice(markerIdx + CONFIG_JSON_MARKER.length);
  const match = tail.match(/\{[^{}]*\}/);
  if (!match) return null;
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const { enabled, max_depth: maxDepth } = obj;
  if (typeof enabled !== 'boolean' || !Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10) {
    return null;
  }
  return { enabled, maxDepth, source: 'seed' };
}

/**
 * Load the burst policy from the seed file, failing open to the defaults.
 * @param {{seedPath?: string, readFileSyncFn?: typeof readFileSync}} [opts]
 * @returns {{enabled:boolean, maxDepth:number, source:'seed'|'default'}}
 */
export function loadRebuildBurstConfig({ seedPath = SEED_PATH, readFileSyncFn = readFileSync } = {}) {
  try {
    const parsed = parseRebuildBurstConfig(readFileSyncFn(seedPath, 'utf8'));
    if (parsed) return parsed;
  } catch {
    // fall through to defaults
  }
  return { enabled: DEFAULT_ENABLED, maxDepth: DEFAULT_MAX_DEPTH, source: 'default' };
}

/**
 * Format the actor-prompt BURST STATUS section — the feedback half of the
 * mechanism (live-observed gap: the first burst cycle hovered ~2 points
 * below the incumbent for all 3 deferred attempts because the actor had no
 * idea it was inside a bounded recomposition window, what the incumbent
 * scored, or that recovery-over-detail was the priority). Returns null when
 * no burst is active — callers pass the result as an additive prompt
 * section, so the prompt stays byte-identical outside bursts. GENERIC: no
 * domain vocabulary; totals are caller-supplied numbers.
 * @param {{burst:object|null, maxDepth:number, bestTotal:number, currentTotal:number}} p
 * @returns {string|null}
 */
export function formatBurstStatusSection({ burst, maxDepth, bestTotal, currentTotal }) {
  if (!burst || !burst.active) return null;
  const used = burst.depth_used ?? 1;
  const remaining = Math.max(0, maxDepth - used);
  return [
    'REBUILD BURST STATUS (multi-edit recomposition window):',
    `- You are ${used} deferred attempt(s) into a bounded recomposition window of ${maxDepth}; ` +
      `${remaining} attempt(s) remain before the candidate is RESTORED to the incumbent and this recomposition is lost.`,
    `- The incumbent to beat scores ${bestTotal}/100 overall; the current working candidate scores ${currentTotal}/100.`,
    '- Priority NOW: recover overall coherence above the incumbent rather than adding further detail — ' +
      'verify every part is still attached and the whole reads as one connected object from every view, ' +
      'then make the single change most likely to lift the overall result.',
  ].join('\n');
}

/**
 * The burst state machine — pure, one call per gated genuine iteration.
 *
 * @param {object} p
 * @param {'accept'|'reject'|'within_noise'} p.decision  the edit-gate decision
 * @param {boolean} p.escalationArmed  was plateau escalation armed for the gated edit
 * @param {{active:boolean, started_iter:number, depth_used:number}|null} p.burst  persisted burst state
 * @param {boolean} p.enabled
 * @param {number} p.maxDepth
 * @param {number} p.iterNum  the CURRENT iteration number (for started_iter bookkeeping)
 * @returns {{action:'bank'|'keep'|'defer-restore'|'end-burst-restore'|'restore', burst:object|null, note:string|null}}
 */
export function decideBurstAction({ decision, escalationArmed, burst, enabled, maxDepth, iterNum }) {
  const active = Boolean(burst && burst.active);
  if (decision === 'accept') {
    // The normal accept path banks; a live burst ends in success.
    return { action: 'bank', burst: null, note: active ? 'rebuild burst BANKED a new best' : null };
  }
  if (decision === 'within_noise') {
    // within_noise keeps the working file with or without a burst (existing
    // exploration semantics) — an active burst rides along unchanged.
    return { action: 'keep', burst: burst ?? null, note: null };
  }
  // decision === 'reject'
  if (active) {
    const nextDepth = (burst.depth_used ?? 1) + 1;
    if (nextDepth > maxDepth) {
      return {
        action: 'end-burst-restore',
        burst: null,
        note: `rebuild burst exhausted (depth ${maxDepth}) without banking — restoring best`,
      };
    }
    return {
      action: 'defer-restore',
      burst: { ...burst, depth_used: nextDepth },
      note: `rebuild burst ${nextDepth}/${maxDepth} — reject deferred, candidate kept for continued recomposition`,
    };
  }
  if (enabled && escalationArmed && maxDepth > 1) {
    return {
      action: 'defer-restore',
      burst: { active: true, started_iter: iterNum, depth_used: 1 },
      note: `rebuild burst 1/${maxDepth} ENTERED (plateau escalation armed) — reject deferred, candidate kept`,
    };
  }
  return { action: 'restore', burst: null, note: null };
}
