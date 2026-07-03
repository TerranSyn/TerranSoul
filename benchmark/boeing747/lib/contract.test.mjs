import { describe, expect, it } from 'vitest';
import { validatePlaneSource } from './contract.mjs';

const VALID = `
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 10, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  fuselage.rotation.z = -Math.PI / 2;
  group.add(fuselage);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.2, 12),
    new THREE.MeshStandardMaterial({ color: 0xcccccc }),
  );
  group.add(wing);
  return group;
}
`;

describe('validatePlaneSource', () => {
  it('accepts a valid primitives-only module', () => {
    const res = validatePlaneSource(VALID);
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

  it('rejects non-primitive geometries', () => {
    for (const geom of ['PlaneGeometry', 'TorusKnotGeometry', 'BufferGeometry']) {
      const res = validatePlaneSource(VALID.replace('BoxGeometry(2, 0.2, 12', `${geom}(2, 0.2, 12`));
      expect(res.ok).toBe(false);
      expect(res.violations.join(' ')).toContain(geom);
    }
  });

  it('rejects loaders, network, DOM, and dynamic code', () => {
    const bad = [
      'const l = new THREE.GLTFLoader();',
      'fetch("x")',
      'const u = "https://example.com/model.gltf";',
      'document.createElement("canvas")',
      'window.top',
      'eval("1")',
      'new Function("return 1")',
      'import("x")',
      'import * as fs from "node:fs";',
      'require("fs")',
      'new Worker("x")',
      'process.env.HOME',
    ];
    for (const line of bad) {
      const res = validatePlaneSource(`${VALID}\n// extra\n${line}\n`);
      expect(res.ok, `should reject: ${line}`).toBe(false);
    }
  });

  it('accepts all eight allowed primitive geometries', () => {
    const src = `
export function buildPlane(THREE) {
  const g = new THREE.Group();
  const mats = new THREE.MeshStandardMaterial({ color: 0x888888 });
  for (const geo of [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.CylinderGeometry(1, 1, 2, 16),
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.ConeGeometry(1, 2, 16),
    new THREE.TorusGeometry(1, 0.2, 8, 24),
    new THREE.CapsuleGeometry(0.5, 1, 4, 8),
    new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 1)], 12),
    new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0,0), new THREE.Vector2(1,0), new THREE.Vector2(0,1)]), { depth: 0.1, bevelEnabled: false }),
  ]) g.add(new THREE.Mesh(geo, mats));
  return g;
}
`;
    const res = validatePlaneSource(src);
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
