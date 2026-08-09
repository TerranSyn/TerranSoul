// Shared bench preflight — ONE guard for every retrieval bench harness.
//
// ## Why this file exists
//
// `scripts/bench-guard.mjs --preflight` was written (an internal work item(a)) after a bad
// embedder placement burned 32 minutes of a run before anyone thought to check
// `/api/ps`. It was then wired into exactly ONE harness — `longmemeval-s.mjs`.
//
// A 2026-08-02 sweep found **1 of 14** harnesses guarded. Everything else —
// `locomo-mteb.mjs`, `locomo-at-scale.mjs`, the whole `jd-*` family,
// `bench-chat-latency.mjs` — could start a multi-hour run against a CPU-pinned
// embedder and never say so. That is not hypothetical: on 2026-08-02 a LoCoMo
// QA run sat 74 minutes at the first task's ingest and produced no artifact,
// with `/api/ps` showing no resident `embeddinggemma`.
//
// ## The trap being guarded
//
// `embed_num_gpu()` (`internal module`) returns **0** when
// `OLLAMA_EMBED_NUM_GPU` is unset, and `/api/embed` honours 0 verbatim — a
// CPU-pinned embedder. **That default is correct for the product**: it keeps the
// whole 12 GB card free for the 12B chat model, which alone takes ~7.6 GB. It is
// wrong for a bench, where it is a ~135x latency difference. Since the default is
// right for shipping and wrong for benching, the harness — not the library — is
// where this has to be caught.
//
// Note the two accepted values are NOT interchangeable in the Rust:
//   * a NON-NEGATIVE count is sent verbatim (`99` = force all layers to GPU);
//   * a NEGATIVE count causes the key to be OMITTED, triggering Ollama's own
//     auto-fit — because Ollama DISCARDS a negative `num_gpu`, so sending `-1`
//     looked like requesting full-GPU while changing nothing.
// Both end with the embedder on the GPU; they get there differently.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Pure: what is wrong with this environment, if anything.
 *
 * Separated from the spawn so it is unit-testable without a daemon or a repo.
 * Returns an array of human-readable problems; empty means nothing to say.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function embedPlacementProblems(env) {
  const problems = [];
  // Only meaningful when the dense channel is actually on: with `LONGMEM_EMBED`
  // unset there is no embedding work to misplace.
  if (env.LONGMEM_EMBED !== '1') return problems;

  const raw = env.OLLAMA_EMBED_NUM_GPU;
  if (raw === undefined || raw.trim() === '') {
    problems.push(
      'OLLAMA_EMBED_NUM_GPU is UNSET while LONGMEM_EMBED=1. The library default is 0, ' +
        'which pins the embedder to CPU (~135x slower) — correct for the shipped app, ' +
        'wrong for a bench. Set OLLAMA_EMBED_NUM_GPU=99 (force all layers to GPU) or -1 ' +
        "(omit the key and let Ollama auto-fit). Omitting it is silent, which is why this " +
        'is a hard failure rather than a warning.',
    );
    return problems;
  }

  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) {
    problems.push(`OLLAMA_EMBED_NUM_GPU="${raw}" is not an integer; the library will ignore it and fall back to 0 (CPU-pinned).`);
  } else if (n === 0) {
    problems.push(
      'OLLAMA_EMBED_NUM_GPU=0 explicitly pins the embedder to CPU. That is a valid ' +
        'production setting but makes a bench run ~135x slower on the embed path. ' +
        'Pass --allow-cpu-embedder if this is deliberate.',
    );
  }
  return problems;
}

/**
 * Run the shared bench-guard preflight for a harness.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.outDir
 * @param {string} [opts.chatModel]
 * @param {string} opts.label            harness name, for log prefixes
 * @param {boolean} [opts.skip]          honour the harness's --skip-preflight
 * @param {boolean} [opts.allowCpuEmbedder]
 * @param {Record<string, string|undefined>} [opts.env]
 */
export function runBenchPreflight(opts) {
  const {
    repoRoot,
    outDir,
    chatModel,
    label,
    skip = false,
    allowCpuEmbedder = false,
    env = process.env,
  } = opts;

  // ⚠️ DELIBERATELY NO CENTRAL `--help` BYPASS.
  //
  // I added one (so `--help` would not require a valid bench env) and it opened
  // a hole in under a minute: `jd-chat-bench.mjs` has NO help handling, so
  // `--help` fell straight through to launching a real bench — with the guard
  // skipped. A bypass keyed on a flag the harness may not implement is a bypass
  // for the run itself.
  //
  // Correct placement is the harness's job: call this AFTER your own help
  // handling (longmemeval-s.mjs and locomo-mteb.mjs both do), or first thing in
  // main() if you have none.

  if (skip) {
    console.error(`[${label}] --skip-preflight: bypassing bench-guard preflight.`);
    return;
  }

  const problems = embedPlacementProblems(env);
  const blocking = allowCpuEmbedder
    ? problems.filter(p => !p.includes('explicitly pins the embedder to CPU'))
    : problems;
  if (blocking.length > 0) {
    for (const p of blocking) console.error(`[${label}] PREFLIGHT: ${p}`);
    console.error(`[${label}] PREFLIGHT FAILED — not running. Pass --skip-preflight to bypass.`);
    process.exit(1);
  }

  const args = [resolve(repoRoot, 'scripts', 'bench-guard.mjs'), '--preflight', '--out-dir', outDir];
  if (chatModel) args.push('--chat-model', chatModel);
  console.error(`[${label}] running bench-guard preflight (pass --skip-preflight to bypass)…`);
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[${label}] PREFLIGHT FAILED (exit ${result.status}) — not running. Pass --skip-preflight to bypass.`);
    process.exit(result.status ?? 1);
  }
}
