// Retry/backoff policy for the Boeing 747 autonomous actor-edit step
// (benchmark/boeing747/actor/actor-claude.mjs, driven by
// loop-runner-terransoul.mjs). NOT frozen — this file is part of THIS fix.
//
// WHY this exists (LESSON BOEING-747-ACTOR-RETRY-1, mcp-data/shared/memory-
// seed.sql): the actor's execFile subprocess call to the `claude` CLI can
// hit its own 600000ms timeout on a genuinely slow-but-still-converging
// attempt — measured on the committed terransoul-fable5 run: iterations
// 7-10 ALL hit the flat timeout with NO edit ever applied (plane.js sha256
// unchanged), a pure infra artifact, not evidence the actor ran out of
// ideas. Before this fix, ONE timeout ended the outer iteration and was fed
// straight into evaluateStopConditions (lib/stop-conditions.mjs, FROZEN) as
// an ordinary non-improving score, corrupting the stall/threshold/budget
// counters with data that was never a genuine attempt.
//
// This module is PURE (no I/O in the decision functions) so it is fully
// vitest-covered without spawning the real `claude` CLI. The one I/O
// function, loadActorRetryConfig(), reads the documented policy value out of
// mcp-data/shared/memory-seed.sql — the durable brain-seed file — mirroring
// the mechanism judge.mjs's loadRubric() already uses for rubric.json (a
// small documented config artifact loaded via readFileSync), just sourced
// from the seed file instead since rubric.json itself is FROZEN and may not
// gain new keys. It falls back to the DEFAULT_* constants below (a single
// documented named fallback, not a bare literal scattered at call sites) if
// the seed row is missing, unparsable, or out of range — fail-open, never
// throws, never blocks the bench loop on a stale/edited seed file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(LIB_DIR, '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

/** Default location of the brain-seed file this config is read from. */
export const SEED_PATH = path.join(REPO_ROOT, 'mcp-data', 'shared', 'memory-seed.sql');

// Anchor text + JSON marker uniquely identifying the seeded config row (see
// LESSON BOEING-747-ACTOR-RETRY-1's own content for the human-readable
// version of this same config).
export const CONFIG_ANCHOR = 'CONFIG (BOEING-747-ACTOR-RETRY-1 config)';
export const CONFIG_JSON_MARKER = 'ACTOR_RETRY_CONFIG_JSON:';

// Fail-open fallback — used ONLY when the seed row is absent/unparsable.
// Intentionally equal to the values the seed row itself documents, so a
// fresh checkout behaves identically before and after the first reseed.
export const DEFAULT_MAX_RETRIES = 2; // total attempts = DEFAULT_MAX_RETRIES + 1
export const DEFAULT_BASE_TIMEOUT_MS = 600000; // unchanged first-attempt budget (prior ACTOR_TIMEOUT_MS default)
export const DEFAULT_TIMEOUT_CAP_MS = 2400000; // 40 min ceiling
export const DEFAULT_EXHAUSTION_CAP = 3; // consecutive fully-exhausted iterations before the loop truly gives up

/**
 * Parse the ACTOR_RETRY_CONFIG_JSON payload out of a memory-seed.sql source
 * string. Pure — takes the file content as a string and never touches disk
 * itself, so it is directly vitest-covered with fixture strings.
 * @param {string} seedSource
 * @returns {{maxRetries:number, baseTimeoutMs:number, timeoutCapMs:number, exhaustionCap:number, source:'seed'}|null}
 */
export function parseActorRetryConfig(seedSource) {
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
  const { max_retries, base_timeout_ms, timeout_cap_ms, exhaustion_cap } = obj;
  const exhaustionCap = exhaustion_cap === undefined ? DEFAULT_EXHAUSTION_CAP : exhaustion_cap;
  if (
    !Number.isInteger(max_retries) ||
    max_retries < 0 ||
    max_retries > 10 ||
    !Number.isFinite(base_timeout_ms) ||
    base_timeout_ms < 1000 ||
    !Number.isFinite(timeout_cap_ms) ||
    timeout_cap_ms < base_timeout_ms ||
    !Number.isInteger(exhaustionCap) ||
    exhaustionCap < 1 ||
    exhaustionCap > 50
  ) {
    return null;
  }
  return {
    maxRetries: max_retries,
    baseTimeoutMs: base_timeout_ms,
    timeoutCapMs: timeout_cap_ms,
    exhaustionCap,
    source: 'seed',
  };
}

/**
 * I/O wrapper: read the seed file and parse it, falling back to the
 * DEFAULT_* constants on ANY failure (missing file, unreadable, unparsable,
 * out of range) — never throws. `overrideMaxRetries` lets a caller (the
 * `--max-actor-retries` CLI flag) win over both the seed and the fallback,
 * matching the task's "CLI flag with a documented default" allowance.
 */
export function loadActorRetryConfig({ seedPath = SEED_PATH, overrideMaxRetries } = {}) {
  let parsed;
  try {
    parsed = parseActorRetryConfig(readFileSync(seedPath, 'utf8'));
  } catch {
    parsed = null;
  }
  const base = parsed || {
    maxRetries: DEFAULT_MAX_RETRIES,
    baseTimeoutMs: DEFAULT_BASE_TIMEOUT_MS,
    timeoutCapMs: DEFAULT_TIMEOUT_CAP_MS,
    exhaustionCap: DEFAULT_EXHAUSTION_CAP,
    source: 'fallback',
  };
  if (Number.isInteger(overrideMaxRetries) && overrideMaxRetries >= 0) {
    return { ...base, maxRetries: overrideMaxRetries, source: `${base.source}+cli-override` };
  }
  return base;
}

/**
 * Attempt N's timeout = base * (N+1), capped. `attemptIndex` is 0-based (the
 * first call is attempt 0, unchanged budget; each retry gets more room for a
 * genuinely-converging-but-slow call rather than silently 10x-ing the very
 * first attempt's budget).
 */
export function computeAttemptTimeoutMs(
  attemptIndex,
  baseTimeoutMs = DEFAULT_BASE_TIMEOUT_MS,
  timeoutCapMs = DEFAULT_TIMEOUT_CAP_MS,
) {
  const n = Math.max(0, Math.trunc(Number(attemptIndex) || 0));
  return Math.min(baseTimeoutMs * (n + 1), timeoutCapMs);
}

/**
 * Whether the retry loop should attempt again after `attemptIndex` (0-based)
 * has failed. `denied` (WIRE-CLI-PARITY-GAP-3 rewire: the actor now spawns
 * `terransoul --agent-task`, which gates every call through the
 * `action_trust` earned-autonomy ledger before ever spawning `claude`) is a
 * hard short-circuit: a longer per-attempt timeout can never change a trust
 * decision, so retrying a denied call is guaranteed-futile work that only
 * delays reaching the honest `actor_exhausted_retries` terminal status —
 * unlike a genuine timeout, which a longer budget might legitimately fix.
 */
export function shouldRetryActor(attemptIndex, maxRetries, { denied = false } = {}) {
  if (denied) return false;
  return Number(attemptIndex) < Number(maxRetries);
}

/**
 * Filter a chronological list of iteration records (as loadHistory in
 * loop-runner-terransoul.mjs returns — each carrying `iter`, `total_0_100`,
 * `per_view`, and an `actor_status` field once patched) down to GENUINE
 * attempts only, in the exact `{iter, total, perView}` shape
 * lib/stop-conditions.mjs::evaluateStopConditions (FROZEN) expects.
 *
 * This is fix 2's actual mechanism: an iteration whose `actor_status` is the
 * new terminal `actor_exhausted_retries` (every retry in fix 1 failed) is a
 * pure infra artifact — LESSON BOEING-747-ACTOR-RETRY-1 — and must never
 * reach the stall/threshold/budget counters as if it were a genuine
 * non-improving attempt. A record with no `actor_status` at all (legacy
 * pre-fix history, or a track's very first bookkeeping write before the
 * actor outcome is known yet) is treated as genuine — this filter only ever
 * EXCLUDES the one specific status, it never requires the field's presence.
 */
export function filterGenuineIterationsForStopConditions(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((h) => h?.actor_status !== 'actor_exhausted_retries')
    .map((h) => ({ iter: h.iter, total: h.total_0_100, perView: (h.per_view || []).map((v) => v.score) }));
}

/**
 * How many CONSECUTIVE trailing records (most-recent-first) carry
 * `actor_status === 'actor_exhausted_retries'`. Used to fire a SEPARATE,
 * explicit exhaustion cap — distinct from a single exhausted iteration,
 * which by itself must not stop the loop (a transient infra hiccup should
 * get another conceptual round, per LESSON BOEING-747-ACTOR-RETRY-1) — so a
 * genuinely broken/unreachable `claude` CLI cannot spin the loop forever.
 * @param {Array<{actor_status?: string}>} records chronologically ordered
 */
export function computeTrailingExhaustionStreak(records) {
  let streak = 0;
  if (!Array.isArray(records)) return streak;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.actor_status === 'actor_exhausted_retries') streak += 1;
    else break;
  }
  return streak;
}
