// Tests for lib/candidate-smoke.mjs — the runtime smoke-check extracted
// VERBATIM from actor/actor-claude.mjs (BRU-3). Behavior must match the
// original helper exactly: strict-mode execution, THREE.Object3D return
// check, and a source-shape guard proving actor-claude.mjs now consumes the
// shared module instead of a private copy (semantics-preserving extraction).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { smokeCheckPlaneSource, stripExportForEval } from './candidate-smoke.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('stripExportForEval', () => {
  it('strips the three accepted export forms', () => {
    expect(stripExportForEval('export function buildPlane(THREE) {}')).toBe('function buildPlane(THREE) {}');
    expect(stripExportForEval('export const buildPlane = (THREE) => {}')).toBe('const buildPlane = (THREE) => {}');
    expect(stripExportForEval('function buildPlane() {}\nexport { buildPlane };\n')).toBe('function buildPlane() {}\n');
  });
});

describe('smokeCheckPlaneSource', () => {
  it('passes a valid buildPlane returning an Object3D', () => {
    const src = 'export function buildPlane(THREE) { const g = new THREE.Group(); return g; }';
    expect(smokeCheckPlaneSource(src)).toEqual({ ok: true });
  });

  it('fails a runtime ReferenceError (undefined variable)', () => {
    const src = 'export function buildPlane(THREE) { const g = new THREE.Group(); g.add(door); return g; }';
    const r = smokeCheckPlaneSource(src);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('door');
  });

  it('STRICT MODE: an assignment to an undeclared identifier fails (the live-caught sloppy-mode gap)', () => {
    const src = 'export function buildPlane(THREE) { rotation_value = 1; return new THREE.Group(); }';
    const r = smokeCheckPlaneSource(src);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('rotation_value');
  });

  it('fails when buildPlane is missing or returns a non-Object3D', () => {
    expect(smokeCheckPlaneSource('export const notPlane = 1;').ok).toBe(false);
    expect(smokeCheckPlaneSource('export function buildPlane(THREE) { return 42; }').ok).toBe(false);
  });
});

describe('source shape: actor-claude.mjs consumes the extracted module', () => {
  const actorSource = readFileSync(path.join(HERE, '..', 'actor', 'actor-claude.mjs'), 'utf8');

  it('imports smokeCheckPlane from lib/candidate-smoke.mjs', () => {
    expect(actorSource).toContain("from '../lib/candidate-smoke.mjs'");
  });

  it('no longer keeps a private smoke-check copy', () => {
    expect(actorSource).not.toContain('function smokeCheckPlane(');
    expect(actorSource).not.toContain('stripExportForEval(');
  });
});
