// ARCHIVE-OF-ELITES parent selection for the best-of-N judge-once actor step
// (BRU-3, folding in BRU-4's deferred half). NOT frozen — part of this fix.
//
// MECHANISM (generic; no domain vocabulary in this module's logic): every
// gate-ACCEPTED candidate is snapshotted into a small capped archive
// ({sha, total, iter, path}). When best-of-N sampling is enabled with
// use_elites, sampling round k>1 may seed its base geometry from a uniformly
// picked elite instead of always the incumbent — restart-from-a-known-good-
// parent diversity, the archive half of quality-diversity search. Round 1
// ALWAYS edits from the incumbent so the default trajectory is preserved.
//
// PURE decision functions (appendElite / pickElite / pickSamplingBase) take
// injectable RNG/fs seams so they are deterministic under vitest; the two I/O
// helpers (loadElites / saveElites) fail open — an archive miss never breaks
// the bench loop.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Default cap on the archive length (highest-total entries are kept). */
export const DEFAULT_ELITES_CAP = 5;

const DEFAULT_FS = { existsSync, mkdirSync, readFileSync, writeFileSync };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Load the elites archive. Fail-open: missing/unreadable/malformed => [].
 * @param {{elitesPath:string, fsImpl?:typeof DEFAULT_FS}} p
 * @returns {Array<{sha:string, total:number, iter?:number, path?:string}>}
 */
export function loadElites({ elitesPath, fsImpl = DEFAULT_FS } = {}) {
  if (!elitesPath) return [];
  try {
    if (!fsImpl.existsSync(elitesPath)) return [];
    const parsed = JSON.parse(fsImpl.readFileSync(elitesPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.sha === 'string' && isNum(e.total)) : [];
  } catch {
    return [];
  }
}

/**
 * Persist the elites archive. Fail-open — a write miss never breaks the loop.
 * @returns {{ok:boolean, error?:string}}
 */
export function saveElites({ elitesPath, elites, fsImpl = DEFAULT_FS } = {}) {
  if (!elitesPath) return { ok: false, error: 'saveElites requires elitesPath' };
  try {
    const dir = path.dirname(elitesPath);
    if (dir && !fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(elitesPath, `${JSON.stringify(Array.isArray(elites) ? elites : [], null, 2)}\n`, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * PURE append-on-accept: add one accepted candidate to the archive, DEDUPED
 * by sha (a re-accept of known geometry updates the existing entry rather
 * than duplicating it), sorted by total DESC (ties: newer iter first), and
 * CAPPED to `cap` entries — the lowest-total overflow is dropped.
 * @param {Object} p
 * @param {Array<Object>} p.elites  current archive (not mutated).
 * @param {{sha:string, total:number, iter?:number, path?:string}} p.entry
 * @param {number} [p.cap]
 * @returns {Array<Object>} the new archive.
 */
export function appendElite({ elites = [], entry, cap = DEFAULT_ELITES_CAP } = {}) {
  const base = (Array.isArray(elites) ? elites : []).filter((e) => e && typeof e.sha === 'string' && isNum(e.total));
  if (!entry || typeof entry.sha !== 'string' || !isNum(entry.total)) return base;
  const capN = Number.isInteger(cap) && cap >= 1 ? cap : DEFAULT_ELITES_CAP;
  const next = base.filter((e) => e.sha !== entry.sha);
  next.push({ ...entry });
  next.sort((a, b) => b.total - a.total || (b.iter ?? 0) - (a.iter ?? 0));
  return next.slice(0, capN);
}

/**
 * PURE uniform elite pick with an injectable RNG (rng() in [0,1)) so tests
 * are deterministic. Empty archive => null.
 * @param {{elites:Array<Object>, rng?:()=>number}} p
 * @returns {Object|null}
 */
export function pickElite({ elites = [], rng = Math.random } = {}) {
  const pool = (Array.isArray(elites) ? elites : []).filter((e) => e && typeof e.sha === 'string');
  if (pool.length === 0) return null;
  const r = rng();
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor((isNum(r) ? r : 0) * pool.length)));
  return pool[idx];
}

/**
 * PURE base-geometry pick for sampling round `round` (1-based):
 *   - round 1 ALWAYS edits from the incumbent (the default trajectory is
 *     preserved — elites only add diversity to the EXTRA rounds);
 *   - round k>1 with use_elites and a non-empty archive edits from a
 *     uniformly picked elite's snapshot, FALLING BACK to the incumbent when
 *     the snapshot file is missing (fail-open, injectable existsFn);
 *   - otherwise the incumbent.
 * @param {Object} p
 * @param {number} p.round             1-based sampling round.
 * @param {string} p.incumbentPath     the current candidate file.
 * @param {Array<Object>} [p.elites]   the archive.
 * @param {boolean} [p.useElites]      the config's use_elites flag.
 * @param {()=>number} [p.rng]         injectable uniform RNG.
 * @param {(p:string)=>boolean} [p.existsFn]  injectable snapshot existence check.
 * @returns {{kind:'incumbent'|'elite', path:string, elite:(Object|null)}}
 */
export function pickSamplingBase({
  round,
  incumbentPath,
  elites = [],
  useElites = false,
  rng = Math.random,
  existsFn = existsSync,
} = {}) {
  const incumbent = { kind: 'incumbent', path: incumbentPath, elite: null };
  if (!useElites || !Number.isInteger(round) || round <= 1) return incumbent;
  const elite = pickElite({ elites, rng });
  if (!elite || typeof elite.path !== 'string' || elite.path === '') return incumbent;
  let ok;
  try {
    ok = Boolean(existsFn(elite.path));
  } catch {
    ok = false;
  }
  return ok ? { kind: 'elite', path: elite.path, elite } : incumbent;
}
