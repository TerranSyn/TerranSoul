// Tests for the shared bench preflight.
//
// ⚠️ VITEST, not `node:test`. `benchmark/scripts/lib/*.test.mjs` is in
// vitest.config.ts's `include` list, so a `node:test` file placed here is
// collected by vitest, contributes 0 tests, and FAILS the suite — which is
// exactly what the first version of this file did. The `node --test`
// convention applies to `scripts/bench/**`, not here.
//
// These target `embedPlacementProblems`, the PURE half — no daemon, no repo, no
// spawn. The impure half (`runBenchPreflight`) calls `process.exit`, which is
// not usefully testable in-process; the pure predicate is where the decision
// actually lives, which is why it was split out.

import { expect, test } from 'vitest';

import { embedPlacementProblems } from './bench-preflight.mjs';

test('unset OLLAMA_EMBED_NUM_GPU with the dense channel ON is a problem', () => {
  const problems = embedPlacementProblems({ LONGMEM_EMBED: '1' });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/UNSET/);
  // The message must name BOTH accepted values, because they are not
  // interchangeable in the Rust and the docs disagreed about which to use.
  expect(problems[0]).toMatch(/99/);
  expect(problems[0]).toMatch(/-1/);
});

test('the guard is silent when the dense channel is OFF', () => {
  // With LONGMEM_EMBED unset there is no embedding work to misplace, so
  // failing the run would be a false positive that trains people to use
  // --skip-preflight.
  expect(embedPlacementProblems({})).toEqual([]);
  expect(embedPlacementProblems({ OLLAMA_EMBED_NUM_GPU: '0' })).toEqual([]);
});

test('an explicit GPU placement passes', () => {
  expect(embedPlacementProblems({ LONGMEM_EMBED: '1', OLLAMA_EMBED_NUM_GPU: '99' })).toEqual([]);
  expect(embedPlacementProblems({ LONGMEM_EMBED: '1', OLLAMA_EMBED_NUM_GPU: '-1' })).toEqual([]);
});

test('an explicit 0 is flagged but distinguishable from unset', () => {
  const explicit = embedPlacementProblems({ LONGMEM_EMBED: '1', OLLAMA_EMBED_NUM_GPU: '0' });
  expect(explicit).toHaveLength(1);
  expect(explicit[0]).toMatch(/explicitly pins the embedder to CPU/);
  // `runBenchPreflight` filters on exactly this substring for
  // --allow-cpu-embedder, so an unset var can never be waved through by that
  // flag. This assertion is what keeps the two messages distinct.
  const unset = embedPlacementProblems({ LONGMEM_EMBED: '1' });
  expect(unset[0]).not.toContain('explicitly pins the embedder to CPU');
});

test('a non-integer value is caught rather than silently falling back to CPU', () => {
  const problems = embedPlacementProblems({ LONGMEM_EMBED: '1', OLLAMA_EMBED_NUM_GPU: 'yes' });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/not an integer/);
});

test('whitespace-only is treated as unset, not as an integer', () => {
  const problems = embedPlacementProblems({ LONGMEM_EMBED: '1', OLLAMA_EMBED_NUM_GPU: '   ' });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/UNSET/);
});
