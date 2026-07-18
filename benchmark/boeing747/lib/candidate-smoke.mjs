// Runtime SMOKE-CHECK for candidate modules — extracted VERBATIM from
// actor/actor-claude.mjs (BRU-3) so the best-of-N judge-once filter cascade
// can reuse the exact same check without duplicating it. Semantics unchanged:
// actor-claude.mjs now imports smokeCheckPlane from here.
//
// WHY the check exists (original actor-claude.mjs history): static contract
// validation is text-only (forbidden tokens + geometry whitelist) — it cannot
// see a runtime bug like an undefined variable reference, which only throws
// when buildPlane() actually executes. That gap let a broken edit reach disk
// once (`group.add(door)`, `door` never declared): the edit was accepted as
// 'edited', and the NEXT iteration's rig render crashed the whole loop
// process with an uncaught ReferenceError.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

/**
 * Strip the `export` keyword the contract requires so the source can run as
 * a plain script body (via `new Function`) instead of an ES module — avoids
 * a dynamic-import round trip through Node's module cache (the candidate file
 * gets overwritten every iteration in the same long-lived loop-runner
 * process) and any bundler/loader that intercepts `import()` in a test
 * environment. Mirrors validatePlaneSource's own 3 accepted export forms
 * exactly.
 */
export function stripExportForEval(source) {
  return source
    .replace(/^(\s*)export\s+(?=(async\s+)?function\s+buildPlane\b)/m, '$1')
    .replace(/^(\s*)export\s+(?=const\s+buildPlane\s*=)/m, '$1')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

/**
 * Actually execute a candidate SOURCE STRING's buildPlane(THREE) to catch
 * runtime errors (undefined variables, wrong constructor arity, etc.) static
 * contract validation can't see. The contract already forbids DOM/window/
 * network/imports, so the module is a plain synchronous function of THREE —
 * evaluating it harness-side is equivalent to the browser-side rig call for
 * anything the contract allows. `new Function` here evaluates source that
 * JUST passed contract validation (which itself forbids `new Function`/`eval`
 * — that ban is on what the CANDIDATE may contain, a different trust
 * boundary than the harness evaluating already-validated text).
 *
 * MUST run in strict mode: `new Function` defaults to SLOPPY mode, which
 * silently allows an assignment to an undeclared identifier (creates an
 * implicit global instead of throwing) — a real ES module (what the rig
 * actually loads the candidate as) is always strict and throws a
 * ReferenceError for that exact code. A live run's smoke check passed an
 * edit containing an assignment with a missing `const`/`let` for exactly
 * this reason, and it crashed the rig one iteration later.
 * @param {string} source
 * @returns {{ok:boolean, error?:string}}
 */
export function smokeCheckPlaneSource(source) {
  try {
    const script = stripExportForEval(source);
    const buildPlane = new Function('THREE', `'use strict';\n${script}\nreturn buildPlane;`)(THREE);
    if (typeof buildPlane !== 'function') {
      return { ok: false, error: 'module does not export buildPlane(THREE)' };
    }
    const result = buildPlane(THREE);
    if (!result || result.isObject3D !== true) {
      return { ok: false, error: 'buildPlane(THREE) did not return a THREE.Object3D' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.stack) || err) };
  }
}

/**
 * File-path convenience wrapper — the exact shape actor-claude.mjs's local
 * helper had (async, reads the candidate from disk, returns {ok, error?}).
 * @param {string} candidateAbs
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function smokeCheckPlane(candidateAbs) {
  try {
    return smokeCheckPlaneSource(readFileSync(candidateAbs, 'utf8'));
  } catch (err) {
    return { ok: false, error: String((err && err.stack) || err) };
  }
}
