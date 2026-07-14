import { describe, expect, it } from 'vitest';
import { DATA_URI_MAX_PAYLOAD_BYTES, validatePlaneSource } from './contract-open.mjs';

// A candidate that exercises the OPEN medium: a hand-built BufferGeometry
// (banned on the frozen track) plus a computed CanvasTexture — both allowed.
const OPEN_VALID = `
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex }));
  group.add(mesh);
  return group;
}
`;

describe('contract-open validatePlaneSource', () => {
  it('accepts a computed BufferGeometry + computed DataTexture candidate', () => {
    const res = validatePlaneSource(OPEN_VALID);
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('still accepts the frozen-track primitives + freeform Shape/Extrude/Lathe', () => {
    const src = `
export function buildPlane(THREE) {
  const g = new THREE.Group();
  const mats = new THREE.MeshStandardMaterial({ color: 0x888888 });
  for (const geo of [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.CylinderGeometry(1, 1, 2, 16),
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 1)], 12),
    new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0,0), new THREE.Vector2(1,0), new THREE.Vector2(0,1)]), { depth: 0.1, bevelEnabled: false }),
    new THREE.BufferGeometry(),
  ]) g.add(new THREE.Mesh(geo, mats));
  return g;
}
`;
    const res = validatePlaneSource(src);
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('rejects empty source', () => {
    expect(validatePlaneSource('').ok).toBe(false);
    expect(validatePlaneSource(undefined).ok).toBe(false);
  });

  it('requires the buildPlane export', () => {
    const res = validatePlaneSource('function buildPlane(THREE) { return null; }');
    expect(res.ok).toBe(false);
    expect(res.violations.join(' ')).toContain('buildPlane');
  });

  it('still rejects loaders, network, DOM, and dynamic code (closed world preserved)', () => {
    const bad = [
      'const l = new THREE.GLTFLoader();',
      'const t = new THREE.TextureLoader();',
      'fetch("x")',
      'new XMLHttpRequest()',
      'new WebSocket("x")',
      'new EventSource("x")',
      'const u = "https://example.com/model.gltf";',
      'const w = "wss://example.com/live";',
      'navigator.userAgent',
      'document.createElement("canvas")',
      'window.top',
      'globalThis.foo',
      'localStorage.getItem("x")',
      'eval("1")',
      'new Function("return 1")',
      'import("x")',
      'import * as fs from "node:fs";',
      'require("fs")',
      'new Worker("x")',
      'process.env.HOME',
    ];
    for (const line of bad) {
      const res = validatePlaneSource(`${OPEN_VALID}\n// extra\n${line}\n`);
      expect(res.ok, `should reject: ${line}`).toBe(false);
    }
  });

  it('does not false-positive on ordinary English prose that happens to contain a forbidden word (comments, no member access)', () => {
    // Mirrors the identical fix + regression test in the frozen lib/
    // contract.mjs — the same bare-word patterns are duplicated here.
    const benign = [
      '// add a window frame for depth',
      '// document the door mechanism here',
      '// this process adds more detail to the nacelle',
    ];
    for (const comment of benign) {
      const res = validatePlaneSource(`${OPEN_VALID}\n${comment}\n`);
      expect(res.ok, `should accept: ${comment}`).toBe(true);
    }
  });

  it('allows a small computed data: URI (payload <= 1024 bytes)', () => {
    const payload = 'A'.repeat(200);
    const src = `${OPEN_VALID}\nconst small = "data:image/png;base64,${payload}";\n`;
    const res = validatePlaneSource(src);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  // Anti-smuggling boundary: "exceeds 1024" is strict — 1023/1024 pass, 1025
  // fails. The payload is the bytes after the comma (here N single-byte 'A's).
  describe('data: URI anti-smuggling boundary (1023 / 1024 / 1025 bytes)', () => {
    const uriWithPayloadBytes = (n) => `${OPEN_VALID}\nconst e = "data:image/png;base64,${'A'.repeat(n)}";\n`;

    it('accepts a payload of 1023 bytes', () => {
      const res = validatePlaneSource(uriWithPayloadBytes(1023));
      expect(res.ok).toBe(true);
      expect(res.violations).toEqual([]);
    });

    it('accepts a payload of exactly 1024 bytes (the boundary passes)', () => {
      expect(DATA_URI_MAX_PAYLOAD_BYTES).toBe(1024);
      const res = validatePlaneSource(uriWithPayloadBytes(1024));
      expect(res.ok).toBe(true);
      expect(res.violations).toEqual([]);
    });

    it('rejects a payload of 1025 bytes (one byte over the boundary)', () => {
      const res = validatePlaneSource(uriWithPayloadBytes(1025));
      expect(res.ok).toBe(false);
      expect(res.violations.join(' ')).toContain('1025 bytes > 1024');
      expect(res.violations.join(' ')).toContain('computed, not embedded');
    });
  });
});
