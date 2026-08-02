// BENCH-OPS-1(a): regression test for the bench-guard preflight wiring in
// longmemeval-s.mjs's `run` command. A prior pass on this exact chunk
// defined `runPreflight()` but never actually CALLED it — the function
// existed, compiled clean, and did nothing; only manually running the CLI
// end-to-end caught it. This spawns the real script as a subprocess (no
// mocking the wiring away) so a future regression fails here instead of
// silently shipping again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = resolve(REPO_ROOT, 'benchmark', 'scripts', 'longmemeval-s.mjs');
const MISSING_DATASET = 'nonexistent-dataset-for-preflight-test.json';

function run(args) {
  return spawnSync(process.execPath, [HARNESS, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('run --skip-preflight bypasses bench-guard entirely', () => {
  const r = run(['run', '--skip-preflight', '--no-download', `--dataset=${MISSING_DATASET}`, '--limit=1']);
  assert.match(r.stdout + r.stderr, /--skip-preflight: bypassing bench-guard preflight/);
  assert.doesNotMatch(r.stdout + r.stderr, /\[bench-guard\]/);
  // The dataset-missing error must still fire — skipping preflight does not
  // skip the rest of the command.
  assert.match(r.stdout + r.stderr, /missing dataset/);
});

test('run (no flag) actually invokes bench-guard preflight — the exact wiring gap this test exists to catch', () => {
  const r = run(['run', '--no-download', `--dataset=${MISSING_DATASET}`, '--limit=1']);
  assert.match(r.stdout + r.stderr, /running bench-guard preflight/);
  // Real evidence the guard script itself ran, not just this harness's own
  // announcement of intent to run it.
  assert.match(r.stdout + r.stderr, /\[bench-guard\]/);
});

test('--help never triggers the preflight (it only gates `run`)', () => {
  // Deliberately NOT exercising the real `sample` command here: unlike
  // `run`, it feeds the sample fixture through the SAME full ranking engine
  // (real IPC backend / `cargo run`), which is exactly the expensive,
  // build-dependent path this whole area exists to gate — not a cheap
  // no-op worth spending on a negative assertion. `--help` returns before
  // any command dispatch at all, which is enough to prove the preflight
  // call site is scoped to `cmd === 'run'` and not hit unconditionally.
  const r = run(['--help']);
  assert.doesNotMatch(r.stdout + r.stderr, /running bench-guard preflight/);
});
