// Tests for the WIRE-CLI-PARITY-GAP-3 rewire: actor-claude.mjs now spawns
// `terransoul-cli --agent-task` instead of the bare `claude` binary. Every
// test here mocks the subprocess boundary via `execImpl` (mirrors
// lib/self-learning.mjs's injectable `callTool` pattern) AND the
// reference-photo boundary via `copyReferenceImagesFn` (the real
// `copyReferenceImages` reads a local-only, gitignored, fetched-not-
// committed `references/prepared/meta.json` — mocking only `execImpl` and
// leaving this one real was a CI-vs-local gap that shipped once already:
// every test passed locally, where that file happened to already exist
// from prior manual bench setup, then failed on a clean CI checkout that
// never ran `fetch-references.mjs`) — no real subprocess is spawned and no
// real filesystem reference lookup happens, so this suite is deterministic
// and CI-safe (the real terransoul-cli binary + live `claude` calls +
// prepared reference photos stay local-only).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWS } from '../lib/cameras.mjs';
import { resolveTerranSoulCliBinary, runActorEdit as runActorEditReal } from './actor-claude.mjs';

/** No prepared reference photos in CI — every test gets an empty ref set. */
const fakeCopyReferenceImagesFn = () => ({});

function runActorEdit(opts) {
  return runActorEditReal({ copyReferenceImagesFn: fakeCopyReferenceImagesFn, ...opts });
}

const VALID_PLANE_SOURCE = `export function buildPlane(THREE) {
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10));
  group.add(fuselage);
  return group;
}
`;

const EDITED_VALID_PLANE_SOURCE = `export function buildPlane(THREE) {
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10));
  group.add(fuselage);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 2));
  group.add(wing);
  return group;
}
`;

const CONTRACT_VIOLATING_SOURCE = `export function buildPlane(THREE) {
  fetch('https://example.com/geometry.json');
  const group = new THREE.Group();
  return group;
}
`;

// Contract-CLEAN (no forbidden token, no non-primitive geometry — passes
// validatePlaneSource cleanly) but throws at runtime: door is referenced but
// never declared. This is the exact bug class that reached disk once and
// crashed a live 30-iteration run at the next iteration's rig render
// (ReferenceError: door is not defined) — static contract validation can't
// see it because it never executes the module.
const RUNTIME_BROKEN_SOURCE = `export function buildPlane(THREE) {
  const group = new THREE.Group();
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10));
  group.add(fuselage);
  group.add(door);
  return group;
}
`;

// A SECOND, distinct runtime-broken class: assigning to an undeclared
// identifier (missing const/let) is legal in SLOPPY mode (creates an
// implicit global) but throws in STRICT mode -- and a real ES module (what
// the rig actually loads the candidate as) is always strict. A live run's
// smoke check passed exactly this edit (missing `new Function`'s own
// strict-mode directive) and it crashed the rig one iteration later with
// `ReferenceError: fusage_rotation is not defined`.
const IMPLICIT_GLOBAL_SOURCE = `export function buildPlane(THREE) {
  const group = new THREE.Group();
  fusage_rotation = -1;
  group.rotation.z = fusage_rotation;
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
  plane_sha256: 'irrelevant-for-actor-fixture',
  total_0_100: 68,
};

const claudeResult = {
  judge_model: 'claude-fable-5-vision',
  per_view: ninePerView((id) => (id === 5 ? 4 : 7)),
  weakest_feature: { id: 'empennage', mean: 4 },
  plane_sha256: 'irrelevant-for-actor-fixture',
  total_0_100: 60,
};

const okOutcome = (overrides = {}) =>
  JSON.stringify({
    result_text: 'noop',
    cost_usd: 0,
    duration_ms: 1,
    tool_calls: [],
    ...overrides,
  });

describe('runActorEdit (terransoul-cli --agent-task wiring)', () => {
  let candidateDir;
  let shotsDir;
  let candidatePath;

  beforeEach(() => {
    candidateDir = mkdtempSync(path.join(tmpdir(), 'boeing747-actor-candidate-'));
    shotsDir = mkdtempSync(path.join(tmpdir(), 'boeing747-actor-shots-'));
    candidatePath = path.join(candidateDir, 'plane.js');
    writeFileSync(candidatePath, VALID_PLANE_SOURCE);
  });

  afterEach(() => {
    rmSync(candidateDir, { recursive: true, force: true });
    rmSync(shotsDir, { recursive: true, force: true });
  });

  it('spawns terransoul-cli with the documented --agent-task/--grant-dir/--model/--effort argv shape', async () => {
    const execImpl = vi.fn(async () => ({ stdout: okOutcome(), stderr: '' }));
    await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake-terransoul-cli', execImpl });

    expect(execImpl).toHaveBeenCalledTimes(1);
    const [binary, args, opts] = execImpl.mock.calls[0];
    expect(binary).toBe('fake-terransoul-cli');
    expect(args[0]).toBe('--agent-task');
    expect(typeof args[1]).toBe('string');
    expect(args.slice(2)).toEqual([
      '--grant-dir',
      candidateDir,
      '--grant-dir',
      path.resolve(shotsDir),
      '--model',
      'claude-fable-5',
      '--effort',
      'max',
    ]);
    expect(opts.cwd).toBeTruthy();
    expect(opts.windowsHide).toBe(true);
  });

  it('forwards explicit model/effort overrides in place of the documented defaults', async () => {
    const execImpl = vi.fn(async () => ({ stdout: okOutcome(), stderr: '' }));
    await runActorEdit({
      candidatePath,
      shotsDir,
      gemmaResult,
      claudeResult,
      cliBinary: 'fake-terransoul-cli',
      model: 'claude-opus-4-8',
      effort: 'high',
      execImpl,
    });
    const [, args] = execImpl.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['--model', 'claude-opus-4-8', '--effort', 'high']));
  });

  it('omits the Claude judge section from the prompt and does not crash when claudeResult is absent (--secondary-judge none / gemma-only run)', async () => {
    const execImpl = vi.fn(async () => ({ stdout: okOutcome(), stderr: '' }));
    await runActorEdit({ candidatePath, shotsDir, gemmaResult, cliBinary: 'fake-terransoul-cli', execImpl });

    expect(execImpl).toHaveBeenCalledTimes(1);
    const [, args] = execImpl.mock.calls[0];
    const prompt = args[1];
    expect(prompt).toContain('gemma4:12b judge');
    expect(prompt).not.toMatch(/Claude .* vision judge/);
  });

  it('accepts a valid edit: re-reads plane.js from disk, records edited + cost/duration, and tallies reported tool calls', async () => {
    const execImpl = vi.fn(async () => {
      // Simulates the real terransoul-cli process's side effect: its Edit
      // tool wrote the new source to disk before the process exited.
      writeFileSync(candidatePath, EDITED_VALID_PLANE_SOURCE);
      return {
        stdout: okOutcome({
          result_text: 'Added a wing box to widen the silhouette.',
          cost_usd: 0.021,
          duration_ms: 4200,
          tool_calls: [
            { name: 'Read', count: 3 },
            { name: 'Edit', count: 1 },
          ],
        }),
        stderr: '[tool] Read {"file_path":"a"}\n[tool-result] Read ok\n[tool] Edit {"file_path":"b"}\n[tool-result] Edit ok\n',
      };
    });

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('edited');
    expect(result.changed).toBe(true);
    expect(result.cost_usd).toBeCloseTo(0.021);
    expect(result.ms).toBe(4200);
    expect(result.denied).toBe(false);
    expect(result.timed_out).toBe(false);
    expect(result.claude_result_text).toContain('wing box');
    expect(result.observability.tool_calls_reported).toEqual([
      { name: 'Read', count: 3 },
      { name: 'Edit', count: 1 },
    ]);
    expect(result.observability.total_tool_calls).toBe(2); // classified from stderr
    expect(readFileSync(candidatePath, 'utf8')).toBe(EDITED_VALID_PLANE_SOURCE);
  });

  it('rejects a contract-violating edit and restores the previous candidate verbatim (harness-side gate, unchanged by the rewire)', async () => {
    const execImpl = vi.fn(async () => {
      writeFileSync(candidatePath, CONTRACT_VIOLATING_SOURCE);
      return { stdout: okOutcome({ result_text: 'Added a network fetch for live geometry.' }), stderr: '' };
    });

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('contract_failed');
    expect(result.contract_violations.length).toBeGreaterThan(0);
    expect(result.changed).toBe(false);
    expect(readFileSync(candidatePath, 'utf8')).toBe(VALID_PLANE_SOURCE);
  });

  it('rejects a contract-clean edit that throws at runtime and restores the previous candidate verbatim', async () => {
    const execImpl = vi.fn(async () => {
      writeFileSync(candidatePath, RUNTIME_BROKEN_SOURCE);
      return { stdout: okOutcome({ result_text: 'Added door geometry.' }), stderr: '' };
    });

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('runtime_failed');
    expect(result.runtime_error).toContain('door is not defined');
    expect(result.changed).toBe(false);
    expect(readFileSync(candidatePath, 'utf8')).toBe(VALID_PLANE_SOURCE);
  });

  it('rejects an edit that assigns to an undeclared identifier (sloppy-mode-only, strict-mode-illegal) instead of silently accepting it', async () => {
    const execImpl = vi.fn(async () => {
      writeFileSync(candidatePath, IMPLICIT_GLOBAL_SOURCE);
      return { stdout: okOutcome({ result_text: 'Rotated the fuselage.' }), stderr: '' };
    });

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('runtime_failed');
    expect(result.runtime_error).toContain('fusage_rotation is not defined');
    expect(result.changed).toBe(false);
    expect(readFileSync(candidatePath, 'utf8')).toBe(VALID_PLANE_SOURCE);
  });

  it('reports no_change when terransoul-cli exits cleanly without touching the candidate', async () => {
    const execImpl = vi.fn(async () => ({
      stdout: okOutcome({ result_text: 'Current geometry already matches the target; no edit made.' }),
      stderr: '[tool] Read {}\n[tool-result] Read ok\n',
    }));

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('no_change');
    expect(result.changed).toBe(false);
    expect(readFileSync(candidatePath, 'utf8')).toBe(VALID_PLANE_SOURCE);
  });

  it('classifies an action_trust ledger DENIAL as actor_failed with denied:true, timed_out:false, and leaves the candidate untouched', async () => {
    const execImpl = vi.fn(async () => {
      const err = new Error('Command failed with exit code 1');
      err.stdout = '';
      err.stderr = 'agent-task denied: earned autonomy required for agentic_cli_edit (trust 0.10 < 0.60)\n';
      err.code = 1;
      throw err;
    });

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('actor_failed');
    expect(result.denied).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(result.actor_error).toContain('denied');
    expect(result.actor_error).toContain('trust 0.10 < 0.60');
    expect(readFileSync(candidatePath, 'utf8')).toBe(VALID_PLANE_SOURCE);
  });

  it('classifies a killed/timed-out call as actor_failed with timed_out:true, denied:false, preserving stderr tool-call evidence', async () => {
    const execImpl = vi.fn(async () => {
      const err = new Error('command timed out');
      err.stdout = '';
      err.stderr = '[tool] Read {}\n[tool-result] Read ok\n[tool] Edit {}\n'; // killed mid-edit — no terminal result
      err.killed = true;
      err.signal = 'SIGTERM';
      throw err;
    });

    const result = await runActorEdit({
      candidatePath,
      shotsDir,
      gemmaResult,
      claudeResult,
      cliBinary: 'fake',
      timeoutMs: 5000,
      execImpl,
    });

    expect(result.status).toBe('actor_failed');
    expect(result.timed_out).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.actor_error).toContain('timed out after 5000ms');
    expect(result.observability.total_tool_calls).toBe(2);
    expect(readFileSync(candidatePath, 'utf8')).toBe(VALID_PLANE_SOURCE);
  });

  it('classifies a generic non-zero exit (not a denial, not a timeout) as actor_failed with both flags false', async () => {
    const execImpl = vi.fn(async () => {
      const err = new Error('Command failed with exit code 1');
      err.stdout = '';
      err.stderr = 'agent-task failed: claude CLI exited unsuccessfully\n';
      err.code = 1;
      throw err;
    });

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('actor_failed');
    expect(result.denied).toBe(false);
    expect(result.timed_out).toBe(false);
    expect(result.actor_error).toContain('exit 1');
  });

  it('classifies a clean exit with non-JSON stdout as actor_failed rather than silently accepting it', async () => {
    const execImpl = vi.fn(async () => ({ stdout: 'not json at all', stderr: '' }));

    const result = await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(result.status).toBe('actor_failed');
    expect(result.actor_error).toContain('not the expected JSON outcome');
  });

  it('injects a supplied priorAttemptsSection into the prompt sent to terransoul-cli', async () => {
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
      priorAttemptsSection: 'PRIOR ATTEMPTS ON THIS BENCHMARK (from brain memory):\n- tried widening the tail, no improvement',
    });

    expect(capturedPrompt).toContain('PRIOR ATTEMPTS ON THIS BENCHMARK');
    expect(capturedPrompt).toContain('tried widening the tail, no improvement');
  });

  it('omits any prior-attempts section from the prompt when none is supplied', async () => {
    let capturedPrompt;
    const execImpl = vi.fn(async (binary, args) => {
      capturedPrompt = args[1];
      return { stdout: okOutcome(), stderr: '' };
    });

    await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(capturedPrompt).not.toContain('PRIOR ATTEMPTS ON THIS BENCHMARK');
  });

  it('forwards cliDataDir to the spawned process as TERRANSOUL_HEADLESS_DATA_DIR', async () => {
    let capturedOpts;
    const execImpl = vi.fn(async (binary, args, opts) => {
      capturedOpts = opts;
      return { stdout: okOutcome(), stderr: '' };
    });

    await runActorEdit({
      candidatePath,
      shotsDir,
      gemmaResult,
      claudeResult,
      cliBinary: 'fake',
      cliDataDir: path.join(tmpdir(), 'isolated-terransoul-data'),
      execImpl,
    });

    expect(capturedOpts.env.TERRANSOUL_HEADLESS_DATA_DIR).toBe(path.join(tmpdir(), 'isolated-terransoul-data'));
  });

  it('inherits process.env unchanged (the real production ledger/config) when cliDataDir is omitted', async () => {
    let capturedOpts;
    const execImpl = vi.fn(async (binary, args, opts) => {
      capturedOpts = opts;
      return { stdout: okOutcome(), stderr: '' };
    });

    await runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, cliBinary: 'fake', execImpl });

    expect(capturedOpts.env).toBe(process.env);
  });
});

describe('resolveTerranSoulCliBinary', () => {
  it('returns an explicit TERRANSOUL_CLI_BIN override verbatim, without touching the filesystem', () => {
    const existsSyncFn = vi.fn();
    const bin = resolveTerranSoulCliBinary({
      env: { TERRANSOUL_CLI_BIN: '/custom/path/to/terransoul-cli' },
      existsSyncFn,
    });
    expect(bin).toBe('/custom/path/to/terransoul-cli');
    expect(existsSyncFn).not.toHaveBeenCalled();
  });

  it('resolves the release-profile binary when it exists', () => {
    const targetDir = path.join(tmpdir(), 'fake-cargo-target');
    const binName = process.platform === 'win32' ? 'terransoul-cli.exe' : 'terransoul-cli';
    const releasePath = path.join(targetDir, 'release', binName);
    const existsSyncFn = vi.fn((p) => p === releasePath);

    const bin = resolveTerranSoulCliBinary({ env: { CARGO_TARGET_DIR: targetDir }, existsSyncFn });

    expect(bin).toBe(releasePath);
  });

  it('falls back to the debug-profile binary when release is missing', () => {
    const targetDir = path.join(tmpdir(), 'fake-cargo-target');
    const binName = process.platform === 'win32' ? 'terransoul-cli.exe' : 'terransoul-cli';
    const debugPath = path.join(targetDir, 'debug', binName);
    const existsSyncFn = vi.fn((p) => p === debugPath);

    const bin = resolveTerranSoulCliBinary({ env: { CARGO_TARGET_DIR: targetDir }, existsSyncFn });

    expect(bin).toBe(debugPath);
  });

  it('throws a clear, actionable error naming the exact build command when neither profile has been built', () => {
    const existsSyncFn = vi.fn(() => false);
    expect(() =>
      resolveTerranSoulCliBinary({ env: { CARGO_TARGET_DIR: path.join(tmpdir(), 'nowhere') }, existsSyncFn }),
    ).toThrow(/cargo build --release --bin terransoul-cli/);
  });
});
