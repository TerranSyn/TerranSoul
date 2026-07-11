// Wiring proof for the OPEN-contract track (OPEN-VARIANT-DESIGN.md §6 item 3):
// runActorEdit, given `contractModulePath` pointing at lib/contract-open.mjs,
// must (a) build the actor prompt from the OPEN contract text (computed
// meshes/textures allowed + the anti-smuggling ban verbatim), and (b) gate the
// edited source through the OPEN validator, not the frozen one. Every
// subprocess + reference-photo boundary is mocked (mirrors
// actor-claude.test.mjs) — no real spawn, no GPU, deterministic and CI-safe.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWS } from '../lib/cameras.mjs';
import { runActorEdit as runActorEditReal } from './actor-claude.mjs';

// vitest runs from the repo root; resolve the open contract to an absolute
// path (runActorEdit dynamic-imports it via pathToFileURL, so it must be
// absolute and real).
const OPEN_CONTRACT_PATH = path.resolve('benchmark/boeing747/lib/contract-open.mjs');
const fakeCopyReferenceImagesFn = () => ({});

function runActorEdit(opts) {
  return runActorEditReal({ copyReferenceImagesFn: fakeCopyReferenceImagesFn, ...opts });
}

// A frozen-track primitives candidate to start from.
const FROZEN_SEED_SOURCE = `export function buildPlane(THREE) {
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10));
  group.add(fuselage);
  return group;
}
`;

// An edit that is VALID under the open contract but INVALID under the frozen
// one: raw BufferGeometry (a non-primitive geometry the frozen whitelist
// rejects) plus a computed DataTexture. This is the discriminator that proves
// which validator runActorEdit used.
const OPEN_ONLY_EDIT_SOURCE = `export function buildPlane(THREE) {
  const group = new THREE.Group();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const data = new Uint8Array(16);
  const tex = new THREE.DataTexture(data, 2, 2);
  group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex })));
  return group;
}
`;

function ninePerView(scoreFn) {
  return VIEWS.map((v) => ({
    view: v.id,
    key: v.key,
    score: scoreFn(v.id),
    seeds: [{ ok: true, notes: `gemma note ${v.id}` }],
    notes: `claude note ${v.id}`,
  }));
}

const gemmaResult = {
  per_view: ninePerView((id) => (id === 5 ? 3 : 8)),
  weakest_feature: { id: 'empennage', mean: 3 },
  plane_sha256: 'irrelevant',
  total_0_100: 68,
};
const claudeResult = {
  judge_model: 'claude-opus-4-8-vision',
  per_view: ninePerView((id) => (id === 5 ? 4 : 7)),
  weakest_feature: { id: 'empennage', mean: 4 },
  plane_sha256: 'irrelevant',
  total_0_100: 60,
};

const okOutcome = (overrides = {}) =>
  JSON.stringify({ result_text: 'noop', cost_usd: 0, duration_ms: 1, tool_calls: [], ...overrides });

describe('runActorEdit --contract open wiring (fake execImpl, no spawn)', () => {
  let candidateDir;
  let shotsDir;
  let candidatePath;

  beforeEach(() => {
    candidateDir = mkdtempSync(path.join(tmpdir(), 'boeing747-open-candidate-'));
    shotsDir = mkdtempSync(path.join(tmpdir(), 'boeing747-open-shots-'));
    candidatePath = path.join(candidateDir, 'plane.js');
    writeFileSync(candidatePath, FROZEN_SEED_SOURCE);
  });

  afterEach(() => {
    rmSync(candidateDir, { recursive: true, force: true });
    rmSync(shotsDir, { recursive: true, force: true });
  });

  it('builds the OPEN contract prompt text (computed medium + anti-smuggling ban verbatim)', async () => {
    let capturedPrompt;
    const execImpl = vi.fn(async (binary, args) => {
      capturedPrompt = args[1];
      return { stdout: okOutcome(), stderr: '' };
    });

    await runActorEdit({
      candidatePath,
      shotsDir,
      gemmaResult,
      claudeResult,
      cliBinary: 'fake',
      execImpl,
      contractModulePath: OPEN_CONTRACT_PATH,
      contractLabel: 'lib/contract-open.mjs',
    });

    expect(capturedPrompt).toContain('Geometry/material medium is OPEN');
    expect(capturedPrompt).toContain('BufferGeometry');
    expect(capturedPrompt).toContain('ANTI-SMUGGLING');
    expect(capturedPrompt).toContain('data: URI whose payload exceeds 1024 bytes');
    expect(capturedPrompt).toContain('computed, not embedded');
    // The frozen-only phrasing must NOT appear on the open track.
    expect(capturedPrompt).not.toContain('Allowed geometries ONLY');
    expect(capturedPrompt).not.toContain('primitives-only contract above');
  });

  it('gates the edit through the OPEN validator: a BufferGeometry+DataTexture edit is ACCEPTED', async () => {
    const execImpl = vi.fn(async () => {
      writeFileSync(candidatePath, OPEN_ONLY_EDIT_SOURCE);
      return { stdout: okOutcome({ result_text: 'Re-meshed the tail as a computed BufferGeometry.' }), stderr: '' };
    });

    const result = await runActorEdit({
      candidatePath,
      shotsDir,
      gemmaResult,
      claudeResult,
      cliBinary: 'fake',
      execImpl,
      contractModulePath: OPEN_CONTRACT_PATH,
    });

    expect(result.status).toBe('edited');
    expect(result.changed).toBe(true);
    expect(readFileSync(candidatePath, 'utf8')).toBe(OPEN_ONLY_EDIT_SOURCE);
  });

  it('CONTRAST: the SAME BufferGeometry edit is REJECTED on the default frozen contract (proves the delta)', async () => {
    const execImpl = vi.fn(async () => {
      writeFileSync(candidatePath, OPEN_ONLY_EDIT_SOURCE);
      return { stdout: okOutcome({ result_text: 'Re-meshed the tail as a computed BufferGeometry.' }), stderr: '' };
    });

    // No contractModulePath => frozen default path.
    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('contract_failed');
    expect(result.contract_violations.join(' ')).toContain('BufferGeometry');
    // Frozen path restores the seed verbatim.
    expect(readFileSync(candidatePath, 'utf8')).toBe(FROZEN_SEED_SOURCE);
  });
});
