// OPEN candidate contract check for the Boeing 747 vision benchmark's
// relaxed-medium track (a SEPARATE benchmark from the frozen primitives-only
// track — see benchmark/boeing747/OPEN-VARIANT-DESIGN.md). Same export
// interface as the frozen lib/contract.mjs (ALLOWED_GEOMETRIES,
// MAX_SOURCE_BYTES, validatePlaneSource) so the harness can swap validators
// with a single --contract flag. Pure functions only — covered by vitest
// (contract-open.test.mjs).
//
// Candidate contract (open medium, closed world):
//   - a single ES module exporting `export function buildPlane(THREE)` that
//     returns a THREE.Group (same export signature as the frozen track);
//   - GEOMETRY/MATERIAL MEDIUM OPEN: arbitrary COMPUTED geometry (hand-built
//     BufferGeometry, THREE.Shape/ExtrudeGeometry freeform, LatheGeometry
//     with arbitrary profiles, groups/instancing) and COMPUTED textures
//     (DataTexture/CanvasTexture, vertex colors, in-code normal/bump maps)
//     are all allowed — the modeling medium is unconstrained;
//   - CLOSED WORLD PRESERVED: no imports, no network, no DOM, no dynamic
//     code, no asset loaders — the module executes inside the rig page (same
//     class of source gating as the repo's execute_code checks);
//   - ANTI-SMUGGLING: textures must be COMPUTED, not embedded — a data: URI
//     whose payload exceeds DATA_URI_MAX_PAYLOAD_BYTES (1 KB) is banned so a
//     candidate cannot smuggle a pre-baked binary asset in as a string
//     literal (the "computed, not embedded" line);
//   - orientation: nose along +X, up +Y (see cameras.mjs).
//
// The essence: open the geometry/material medium, keep the closed-world
// determinism. Asset FILES and the loaders that read them stay banned (the
// agent must BUILD, not download).

// A documented SUPERSET of the frozen track's primitive whitelist: the frozen
// eight PLUS BufferGeometry (the escape hatch for arbitrary computed meshes).
// Unlike the frozen contract, the open validator does NOT reject unlisted
// *Geometry identifiers — arbitrary computed geometry is allowed — so this
// list is informational (surfaced to the actor prompt), not an enforced gate.
export const ALLOWED_GEOMETRIES = [
  'BoxGeometry',
  'CylinderGeometry',
  'SphereGeometry',
  'ConeGeometry',
  'TorusGeometry',
  'CapsuleGeometry',
  'LatheGeometry',
  'ExtrudeGeometry',
  'BufferGeometry',
];

export const MAX_SOURCE_BYTES = 512 * 1024;

// Anti-smuggling boundary: a data: URI whose payload (the bytes AFTER the
// comma) exceeds this many bytes is a contract violation. Computed textures
// stay allowed; embedded pre-baked binary assets are banned. "Exceeds" is
// strict — a payload of exactly this many bytes passes, one byte more fails.
export const DATA_URI_MAX_PAYLOAD_BYTES = 1024;

// The anti-smuggling rule stated for the actor prompt VERBATIM (the open
// track's actor-prompt contract text reads this so it can never drift from
// the actual gate). Defined OUTSIDE the FORBIDDEN_PATTERNS block below so
// actor-claude.mjs's extractForbiddenReasons() (which parses only that block)
// never mistakes it for a forbidden-pattern reason.
export const ANTI_SMUGGLING_RULE =
  'A data: URI whose payload exceeds 1024 bytes is forbidden: computed textures (DataTexture/CanvasTexture, vertex colors, in-code normal/bump maps) are allowed, but embedded pre-baked binary assets are banned (the "computed, not embedded" line).';

/**
 * [regex, human-readable reason] — any match is a contract violation. Same
 * shape and textual conventions as the frozen contract's FORBIDDEN_PATTERNS
 * (each regex literal contains no quote characters, so every single-quoted
 * string here is exactly one reason, in order — actor-claude.mjs's
 * extractForbiddenReasons() relies on that). RELAXED vs the frozen block: the
 * blanket `data:` URI ban is removed and replaced by the payload-size check
 * in validatePlaneSource (computed textures are allowed; only oversized
 * embedded assets are banned). Everything else — imports, network, DOM,
 * storage, dynamic code, workers, process, asset loaders, http(s)/ws URLs —
 * stays FORBIDDEN, unchanged from the frozen contract.
 */
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
  // in a comment (e.g. "// add a window frame" for the aircraft feature).
  // Mirrors the identical fix in the frozen lib/contract.mjs.
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
];

/**
 * Scan the source for data: URIs and flag any whose payload exceeds
 * DATA_URI_MAX_PAYLOAD_BYTES. A data URI is matched from `data:` up to the
 * first quote/backtick/whitespace (data URIs live inside string literals);
 * the payload is everything after the first comma (`data:<mime>[;base64],
 * <payload>`), or, for the degenerate `data:<payload>` form with no comma,
 * everything after the `data:` prefix. Payload length is measured in UTF-8
 * bytes.
 * @returns {string[]} one violation string per oversized data: URI
 */
function dataUriViolations(source) {
  const violations = [];
  for (const m of source.matchAll(/data:[^\s"'`]*/gi)) {
    const uri = m[0];
    const commaIdx = uri.indexOf(',');
    const payload = commaIdx >= 0 ? uri.slice(commaIdx + 1) : uri.slice('data:'.length);
    const payloadBytes = new TextEncoder().encode(payload).length;
    if (payloadBytes > DATA_URI_MAX_PAYLOAD_BYTES) {
      violations.push(
        `data: URI payload too large: ${payloadBytes} bytes > ${DATA_URI_MAX_PAYLOAD_BYTES} (textures must be computed, not embedded)`,
      );
    }
  }
  return violations;
}

/**
 * Validate a candidate plane.js source string against the OPEN contract.
 * Same return shape as the frozen contract's validatePlaneSource.
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

  // Anti-smuggling: computed textures OK, oversized embedded data: URIs banned.
  // NOTE: no geometry whitelist here — arbitrary COMPUTED geometry (including
  // raw BufferGeometry) is the whole point of the open medium; the loader ban
  // above is what keeps the world closed.
  for (const v of dataUriViolations(source)) violations.push(v);

  return { ok: violations.length === 0, violations };
}
