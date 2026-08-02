// BRU-3 BEST-OF-N JUDGE-ONCE — pure primitives. NOT frozen; part of this fix.
//
// WHY (2026-07-17 replay-teach evidence, milestones BOEING-REPLAY-UPGRADES):
// ~88% of weak-actor rounds historically produced ZERO code change from
// edit-apply friction, and a rejected edit burns a whole iteration of the
// expensive K-panel judge. Instead of one actor edit per iteration going
// straight to the panel, sample N candidate edits on throwaway copies, pass
// each through the FREE filters that already exist — the frozen contract
// validator (lib/contract.mjs, called, never modified), the runtime
// smoke-check (lib/candidate-smoke.mjs, the exact helper actor-claude.mjs
// runs), and NOVELTY (sha differs from the incumbent and from recently
// rejected shas in the rejected-edits ledger) — then promote ONLY the single
// best survivor onto the real candidate. The panel still judges EXACTLY ONCE
// per iteration (the promoted survivor, at the next iteration's judge step):
// gate-reject thrash converts into ~30s of extra sampling, never into extra
// judge calls.
//
// DEFAULT DISABLED: with no config set, loadBestOfNJudgeOnceConfig() returns
// enabled:false and the loop-runner's single-edit path runs byte-identically.
//
// GENERIC ON PURPOSE (rules/bench-agi-purity.md): no benchmark geometry,
// vocabulary, or answer-derived constant — a plain sample/filter/select
// library; all domain content lives in the caller's arguments.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(LIB_DIR, '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

/** Default location of the brain-seed file this config is read from. */
export const SEED_PATH = path.join(REPO_ROOT, 'mcp-data', 'shared', 'seed-lessons.sql');

// Anchor text + JSON marker uniquely identifying the seeded config row.
export const CONFIG_ANCHOR = 'CONFIG (BOEING-747-BEST-OF-N-JUDGE-ONCE-1 config)';
export const CONFIG_JSON_MARKER = 'BEST_OF_N_CONFIG_JSON:';
/** Env var that overrides the seed row (same JSON payload shape). */
export const ENV_VAR = 'BEST_OF_N_CONFIG_JSON';

// Fail-open fallback — DISABLED by default so a bare run is byte-identical.
export const DEFAULT_ENABLED = false;
export const DEFAULT_N = 3;
export const DEFAULT_USE_ELITES = false;
export const DEFAULT_ELITES_CAP = 5;
/** Hard cap on N (sampling is actor-call-expensive even though judging is not). */
export const MAX_N = 6;
/** How many trailing rejected-ledger shas count as "recently rejected". */
export const DEFAULT_RECENT_REJECTED = 20;

/**
 * Validate one parsed config payload. Pure. Missing keys inherit defaults;
 * malformed/out-of-range payloads => null (fail-open at the caller).
 * @param {unknown} obj
 * @returns {{enabled:boolean, n:number, useElites:boolean, elitesCap:number}|null}
 */
export function normalizeBestOfNJudgeOnceConfig(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const enabled = obj.enabled === undefined ? DEFAULT_ENABLED : obj.enabled;
  const n = obj.n === undefined ? DEFAULT_N : obj.n;
  const useElites = obj.use_elites === undefined ? DEFAULT_USE_ELITES : obj.use_elites;
  const elitesCap = obj.elites_cap === undefined ? DEFAULT_ELITES_CAP : obj.elites_cap;
  if (
    typeof enabled !== 'boolean' ||
    typeof useElites !== 'boolean' ||
    !Number.isInteger(n) ||
    n < 1 ||
    n > MAX_N ||
    !Number.isInteger(elitesCap) ||
    elitesCap < 1 ||
    elitesCap > 50
  ) {
    return null;
  }
  return { enabled, n, useElites, elitesCap };
}

/**
 * Parse the BEST_OF_N_CONFIG_JSON payload out of a seed-lessons.sql source
 * string. Pure — takes file content as a string, never touches disk.
 * @param {string} seedSource
 */
export function parseBestOfNJudgeOnceConfig(seedSource) {
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
  const normalized = normalizeBestOfNJudgeOnceConfig(obj);
  return normalized ? { ...normalized, source: 'seed' } : null;
}

/**
 * Load the judge-once policy: env var wins over the seed row, which wins over
 * the DISABLED defaults. Fail-open on ANY failure — never throws.
 * @param {{seedPath?:string, readFileSyncFn?:typeof readFileSync, env?:Record<string,string|undefined>}} [opts]
 * @returns {{enabled:boolean, n:number, useElites:boolean, elitesCap:number, source:'env'|'seed'|'default'}}
 */
export function loadBestOfNJudgeOnceConfig({
  seedPath = SEED_PATH,
  readFileSyncFn = readFileSync,
  env = process.env,
} = {}) {
  const raw = env ? env[ENV_VAR] : undefined;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const normalized = normalizeBestOfNJudgeOnceConfig(JSON.parse(raw));
      if (normalized) return { ...normalized, source: 'env' };
    } catch {
      // malformed env payload — fall through to seed/defaults
    }
  }
  try {
    const parsed = parseBestOfNJudgeOnceConfig(readFileSyncFn(seedPath, 'utf8'));
    if (parsed) return parsed;
  } catch {
    // fall through to defaults
  }
  return {
    enabled: DEFAULT_ENABLED,
    n: DEFAULT_N,
    useElites: DEFAULT_USE_ELITES,
    elitesCap: DEFAULT_ELITES_CAP,
    source: 'default',
  };
}

/**
 * The last `limit` DISTINCT rejected shas from a rejected-edits ledger
 * (lib/edit-gate.mjs's loadRejectedEdits shape — entries carry
 * `rejected_sha256`). Pure.
 * @param {Array<{rejected_sha256?:string|null}>} ledger
 * @param {number} [limit]
 * @returns {string[]}
 */
export function recentRejectedShas(ledger, limit = DEFAULT_RECENT_REJECTED) {
  const rows = Array.isArray(ledger) ? ledger : [];
  const lim = Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_RECENT_REJECTED;
  const shas = rows.map((r) => r && r.rejected_sha256).filter((s) => typeof s === 'string' && s !== '');
  return [...new Set(shas)].slice(-lim);
}

/**
 * FREE FILTER CASCADE for ONE sampled candidate edit. Pure given the injected
 * validator/smoke seams (production wiring injects the FROZEN
 * lib/contract.mjs validatePlaneSource — called, never modified — and
 * lib/candidate-smoke.mjs's smokeCheckPlaneSource). Order matters and is
 * cheapest-first; every stage is milliseconds, no GPU/CLI/network:
 *
 *   1. STATUS  — only a genuine 'edited' outcome carries an effective edit
 *                (no_change/contract_failed/runtime_failed/exhausted are
 *                filtered with the status as the reason; the actor's own
 *                internal gates already restored those copies).
 *   2. CONTRACT — validateFn(source).ok (defense-in-depth re-check of the
 *                same frozen gate the actor step already applied).
 *   3. RUNTIME — smokeFn(source).ok (same 'use strict' new Function
 *                execution the actor step already ran).
 *   4. NOVELTY — a SOFT signal, not a hard filter: novel means the sha
 *                differs from the incumbent AND from every recently rejected
 *                sha. Survivor selection prefers novel > first — a non-novel
 *                survivor is still a survivor (resubmitting a known sha is
 *                wasteful, not invalid).
 *
 * @param {Object} p
 * @param {string|null} p.source        the candidate copy's post-edit source.
 * @param {string|null} p.sha           its sha256.
 * @param {string} p.status             the actor result status for this round.
 * @param {string|null} p.incumbentSha  the real candidate's sha at sampling start.
 * @param {string[]} [p.rejectedShas]   recently rejected shas (recentRejectedShas).
 * @param {(source:string)=>{ok:boolean, violations?:string[]}} p.validateFn
 * @param {(source:string)=>{ok:boolean, error?:string}} p.smokeFn
 * @returns {{pass:boolean, novel:boolean, reasons:string[]}}
 */
export function evaluateCandidateEdit({
  source,
  sha,
  status,
  incumbentSha,
  rejectedShas = [],
  validateFn,
  smokeFn,
} = {}) {
  const reasons = [];
  if (status !== 'edited') {
    return { pass: false, novel: false, reasons: [`status: ${status || 'unknown'} (no effective edit)`] };
  }
  if (typeof source !== 'string' || source === '') {
    return { pass: false, novel: false, reasons: ['source: missing/unreadable candidate copy'] };
  }
  if (typeof validateFn === 'function') {
    let contract;
    try {
      contract = validateFn(source);
    } catch (e) {
      contract = { ok: false, violations: [String(e?.message || e)] };
    }
    if (!contract || contract.ok !== true) {
      const detail = contract && Array.isArray(contract.violations) ? contract.violations.join('; ') : 'validator failed';
      return { pass: false, novel: false, reasons: [`contract: ${detail}`] };
    }
  }
  if (typeof smokeFn === 'function') {
    let smoke;
    try {
      smoke = smokeFn(source);
    } catch (e) {
      smoke = { ok: false, error: String(e?.message || e) };
    }
    if (!smoke || smoke.ok !== true) {
      return { pass: false, novel: false, reasons: [`runtime: ${(smoke && smoke.error) || 'smoke check failed'}`] };
    }
  }
  const rejected = Array.isArray(rejectedShas) ? rejectedShas : [];
  const hasSha = typeof sha === 'string' && sha !== '';
  const novel = hasSha && sha !== incumbentSha && !rejected.includes(sha);
  if (!novel) {
    reasons.push(
      hasSha && sha === incumbentSha
        ? 'novelty: sha identical to the incumbent'
        : hasSha
          ? 'novelty: sha matches a recently rejected edit'
          : 'novelty: no sha available',
    );
  }
  return { pass: true, novel, reasons };
}

/**
 * SURVIVOR SELECTION: prefer the FIRST NOVEL survivor; else the FIRST
 * survivor; else none. Deterministic (input order = sampling order). Pure.
 * @param {Array<{pass:boolean, novel:boolean}>} evaluations  per-round cascade results.
 * @returns {{index:number, novel:boolean}}  index -1 when no survivor.
 */
export function selectSurvivor(evaluations) {
  const rows = Array.isArray(evaluations) ? evaluations : [];
  const novelIdx = rows.findIndex((e) => e && e.pass === true && e.novel === true);
  if (novelIdx >= 0) return { index: novelIdx, novel: true };
  const firstIdx = rows.findIndex((e) => e && e.pass === true);
  return firstIdx >= 0 ? { index: firstIdx, novel: false } : { index: -1, novel: false };
}
