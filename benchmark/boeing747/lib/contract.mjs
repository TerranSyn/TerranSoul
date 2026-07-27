// FROZEN candidate contract check for the Boeing 747 primitives vision
// benchmark. Pure functions only — covered by vitest (contract.test.mjs).
//
// Candidate contract:
//   - a single ES module exporting `export function buildPlane(THREE)` that
//     returns a THREE.Group;
//   - PRIMITIVES ONLY: Box/Cylinder/Sphere/Cone/Torus/Capsule/Lathe/Extrude
//     geometries (no loaders, no hand-rolled BufferGeometry);
//   - self-contained: no imports, no network, no DOM, no dynamic code —
//     the module executes inside the rig page (same class of source gating
//     as the repo's execute_code checks).
//   - orientation: nose along +X, up +Y (see cameras.mjs).

export const ALLOWED_GEOMETRIES = [
  'BoxGeometry',
  'CylinderGeometry',
  'SphereGeometry',
  'ConeGeometry',
  'TorusGeometry',
  'CapsuleGeometry',
  'LatheGeometry',
  'ExtrudeGeometry',
];

export const MAX_SOURCE_BYTES = 512 * 1024;

/** [regex, human-readable reason] — any match is a contract violation. */
const FORBIDDEN_PATTERNS = [
  [/^\s*import\b/m, 'static import (candidate must be self-contained)'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\bfetch\s*\(/, 'fetch() network call'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest network call'],
  [/\bWebSocket\b/, 'WebSocket network call'],
  [/\bEventSource\b/, 'EventSource network call'],
  // window/document/process/etc. require actual member/bracket access
  // (`.`/`[`) — a bare word match false-positives on ordinary English prose
  // in a comment (e.g. "// add a window frame" for the aircraft feature),
  // which once discarded an otherwise-valid edit and stalled a live run.
  // `window`/`document` etc. are also common enough as identifiers/locals
  // that a bare-word ban serves no real security purpose a `.`/`[` gate
  // doesn't already cover.
  [/\bnavigator\s*[.[]/, 'navigator access'],
  [/\bdocument\s*[.[]/, 'DOM access (document)'],
  [/\bwindow\s*[.[]/, 'DOM access (window)'],
  [/\bglobalThis\s*[.[]/, 'globalThis access'],
  [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, 'storage access'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b|\bFunction\s*\(/, 'Function constructor'],
  [/\bWorker\b/, 'Worker'],
  [/\bprocess\s*[.[]/, 'process access'],
  [/\w*Loader\b/, 'asset loader (GLTF/OBJ/texture/file loaders are banned)'],
  [/\bhttps?:\/\//, 'http(s) URL'],
  [/\bwss?:\/\//, 'websocket URL'],
  [/\bdata:\s*[a-z]+\//i, 'data: URI payload'],
];

/**
 * Validate a candidate plane.js source string against the frozen contract.
 * @returns {{ok: boolean, violations: string[]}}
 */
export function validatePlaneSource(source) {
  const violations = [];
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, violations: ['empty source'] };
  }
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_SOURCE_BYTES) {
    violations.push(`source too large: ${bytes} bytes > ${MAX_SOURCE_BYTES}`);
  }

  const exportsBuildPlane =
    /export\s+(?:async\s+)?function\s+buildPlane\s*\(/.test(source) ||
    /export\s*\{[^}]*\bbuildPlane\b[^}]*\}/.test(source) ||
    /export\s+const\s+buildPlane\s*=/.test(source);
  if (!exportsBuildPlane) {
    violations.push('missing `export function buildPlane(THREE)`');
  }

  for (const [pattern, reason] of FORBIDDEN_PATTERNS) {
    const match = source.match(pattern);
    if (match) violations.push(`forbidden token \`${match[0].trim()}\`: ${reason}`);
  }

  // Geometry whitelist: every geometry CLASS CONSTRUCTED must be a primitive.
  // Match `new <X>Geometry(` (optionally `new THREE.<X>Geometry(`), NOT a bare
  // `<X>Geometry` identifier — the bare match false-positived on ordinary
  // variable names like `humpGeometry`/`wingGeometry` (a naming style, not a
  // forbidden class), unfairly failing valid planes. This still bans
  // `new PlaneGeometry(`, `new BufferGeometry(`, `new TorusKnotGeometry(`, etc.
  // (fairness bug fix 2026-07-23, owner-authorized — aligns the check to its
  // stated intent; gemma results unaffected, they never constructed a non-primitive.)
  const geometryIds = new Set();
  for (const m of source.matchAll(/\bnew\s+(?:THREE\.)?(\w+Geometry)\s*\(/g)) geometryIds.add(m[1]);
  for (const id of geometryIds) {
    if (!ALLOWED_GEOMETRIES.includes(id)) {
      violations.push(
        `non-primitive geometry \`${id}\` (allowed: ${ALLOWED_GEOMETRIES.join(', ')})`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
