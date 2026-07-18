// BRU-6 FLATLINE HEALTH-CHECK for the autonomous bench loop
// (loop-runner-terransoul.mjs). NOT frozen — this file is part of this fix.
//
// WHY this exists (2026-07-17 campaign, brain lesson 25201): a run burned 20
// straight iterations (~30% of budget) logging a byte-identical within-noise
// judge delta while ZERO edits were landing — the candidate sha never changed
// — and that flat stretch read exactly like plateau/patience evidence. It was
// not: process restarts reliably re-activated the actor (3x observed live;
// records followed each restart). A run of consecutive iterations where the
// judge delta stayed within the noise epsilon AND the candidate sha never
// changed is an ACTOR-HEALTH failure signature (a wedged transport/process),
// not a demonstrated capability ceiling.
//
// This module is PURE (detectFlatline / flatlineItersFromRecords have no
// I/O). The one I/O function, loadFlatlineHealthConfig(), reads the
// documented policy out of the FLATLINE_HEALTH_CONFIG_JSON env var or the
// mcp-data/shared/memory-seed.sql config row — the same mechanism
// lib/rebuild-burst.mjs's loadRebuildBurstConfig() uses (rubric.json is
// FROZEN and may not gain new keys). Fail-open to the DEFAULT_* constants
// below; never throws.
//
// DETECTION-ONLY BY DESIGN: the caller logs a loud reclassification line;
// stop/gate decisions are NEVER altered by this signal (stop semantics may
// not change silently — rules/bench-never-regress.md).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(LIB_DIR, '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

/** Default location of the brain-seed file this config is read from. */
export const SEED_PATH = path.join(REPO_ROOT, 'mcp-data', 'shared', 'memory-seed.sql');

// Anchor text + JSON marker uniquely identifying the seeded config row.
export const CONFIG_ANCHOR = 'CONFIG (BOEING-747-FLATLINE-HEALTH-1 config)';
export const CONFIG_JSON_MARKER = 'FLATLINE_HEALTH_CONFIG_JSON:';
/** Env var that overrides the seed row (same JSON payload shape). */
export const ENV_VAR = 'FLATLINE_HEALTH_CONFIG_JSON';

// Fail-open fallback — used ONLY when both the env var and the seed row are
// absent/unparsable. Detection is log-only, so enabled-by-default is
// behavior-preserving for every decision the loop makes.
export const DEFAULT_ENABLED = true;
export const DEFAULT_THRESHOLD = 6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate one parsed config payload. Pure. Returns the normalized config or
 * null when the payload is malformed/out-of-range (fail-open at the caller).
 * @param {unknown} obj
 * @returns {{enabled:boolean, threshold:number}|null}
 */
export function normalizeFlatlineHealthConfig(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const enabled = obj.enabled === undefined ? DEFAULT_ENABLED : obj.enabled;
  const threshold = obj.threshold === undefined ? DEFAULT_THRESHOLD : obj.threshold;
  if (typeof enabled !== 'boolean' || !Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    return null;
  }
  return { enabled, threshold };
}

/**
 * Parse the FLATLINE_HEALTH_CONFIG_JSON payload out of a memory-seed.sql
 * source string. Pure — takes file content as a string, never touches disk.
 * @param {string} seedSource
 * @returns {{enabled:boolean, threshold:number, source:'seed'}|null}
 */
export function parseFlatlineHealthConfig(seedSource) {
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
  const normalized = normalizeFlatlineHealthConfig(obj);
  return normalized ? { ...normalized, source: 'seed' } : null;
}

/**
 * Load the flatline policy: env var wins over the seed row, which wins over
 * the defaults. Fail-open on ANY failure — never throws.
 * @param {{seedPath?:string, readFileSyncFn?:typeof readFileSync, env?:Record<string,string|undefined>}} [opts]
 * @returns {{enabled:boolean, threshold:number, source:'env'|'seed'|'default'}}
 */
export function loadFlatlineHealthConfig({
  seedPath = SEED_PATH,
  readFileSyncFn = readFileSync,
  env = process.env,
} = {}) {
  const raw = env ? env[ENV_VAR] : undefined;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const normalized = normalizeFlatlineHealthConfig(JSON.parse(raw));
      if (normalized) return { ...normalized, source: 'env' };
    } catch {
      // malformed env payload — fall through to seed/defaults
    }
  }
  try {
    const parsed = parseFlatlineHealthConfig(readFileSyncFn(seedPath, 'utf8'));
    if (parsed) return parsed;
  } catch {
    // fall through to defaults
  }
  return { enabled: DEFAULT_ENABLED, threshold: DEFAULT_THRESHOLD, source: 'default' };
}

/**
 * Map chronological iteration records (loadHistory shape: `total_0_100`,
 * `plane_sha256`, `actor_status`) to the `{delta, sha, status}` rows
 * detectFlatline consumes. `delta` is this record's judged total minus the
 * PREVIOUS record's (null for the first record, or when either total is not
 * finite). Pure.
 * @param {Array<{total_0_100?:number, plane_sha256?:string, actor_status?:string}>} records
 * @returns {Array<{delta:number|null, sha:string|null, status:string|null}>}
 */
export function flatlineItersFromRecords(records) {
  const rows = Array.isArray(records) ? records : [];
  return rows.map((r, i) => {
    const total = r && isNum(r.total_0_100) ? r.total_0_100 : null;
    const prevTotal = i > 0 && rows[i - 1] && isNum(rows[i - 1].total_0_100) ? rows[i - 1].total_0_100 : null;
    return {
      delta: total !== null && prevTotal !== null ? Math.round((total - prevTotal) * 100) / 100 : null,
      sha: r && typeof r.plane_sha256 === 'string' ? r.plane_sha256 : null,
      status: r && typeof r.actor_status === 'string' ? r.actor_status : null,
    };
  });
}

/**
 * Detect an actor-health FLATLINE: a trailing run of consecutive iterations
 * where the judge delta stayed within the noise epsilon AND the candidate sha
 * never changed (each iteration's sha equals the previous iteration's — the
 * actor kept producing no effective edit). An iteration EXTENDS the streak
 * iff BOTH hold; a delta beyond epsilon, a missing delta, or a sha change
 * (or missing sha) RESETS it. The first row can never qualify (no previous
 * row to compare against).
 *
 * Pure and deterministic — directly vitest-covered offline.
 *
 * @param {Object} p
 * @param {Array<{delta:number|null, sha:string|null, status:string|null}>} p.recentIters
 *   chronological rows (oldest first) — see flatlineItersFromRecords.
 * @param {number} p.epsilon    noise band; |delta| <= epsilon is "within noise"
 *   (non-finite/negative treated as 0).
 * @param {number} [p.threshold] streak length that fires the flatline
 *   (default DEFAULT_THRESHOLD; clamped to >= 1).
 * @returns {{flatline:boolean, streak:number, reason:string|null}}
 */
export function detectFlatline({ recentIters = [], epsilon, threshold = DEFAULT_THRESHOLD } = {}) {
  const rows = Array.isArray(recentIters) ? recentIters : [];
  const eps = isNum(epsilon) && epsilon >= 0 ? epsilon : 0;
  const thr = Number.isInteger(threshold) && threshold >= 1 ? threshold : DEFAULT_THRESHOLD;

  let streak = 0;
  const statuses = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i] || {};
    const prev = rows[i - 1] || {};
    const withinNoise = isNum(row.delta) && Math.abs(row.delta) <= eps;
    const shaUnchanged = typeof row.sha === 'string' && row.sha !== '' && row.sha === prev.sha;
    if (!withinNoise || !shaUnchanged) break;
    streak += 1;
    statuses.unshift(row.status || 'unknown');
  }

  const flatline = streak >= thr;
  if (!flatline) return { flatline: false, streak, reason: null };

  const counts = statuses.reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(counts)
    .map(([s, n]) => `${s} x${n}`)
    .join(', ');
  return {
    flatline: true,
    streak,
    reason:
      `${streak} consecutive iteration(s) with |judge delta| <= ${eps} AND an unchanged candidate sha ` +
      `(threshold ${thr}; statuses: ${statusSummary}) — the actor kept producing no effective edit`,
  };
}
