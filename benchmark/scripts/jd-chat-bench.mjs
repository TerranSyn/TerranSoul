#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME JD-DEMO — CHAT + THINK levels launcher (2026-07-05).
//
// The two fast "thinking levels" both come from ONE single-retrieval pass
// (benchmark/scripts/jd-chat-pipeline.mjs), scored two ways:
//   CHAT  ("no thinking")   = the raw retrieval top-k order (its `retrieval`
//                             metrics block). Fastest, lowest accuracy.
//   THINK ("with thinking") = retrieval + the reader tournament re-ranks the
//                             retrieved pool by fit, WITHOUT agentic wide
//                             retrieval and WITHOUT the verify stage (its
//                             `chat_pipeline` block, extract-sort OFF). Medium
//                             latency/accuracy — bounded by single-retrieval
//                             recall. (MAX is the separate jd-max-bench.mjs.)
//
// This launcher pins the PREBUILT shim binary (never `cargo run`, so it can't
// collide with a concurrent the application repository build), sets the store/env, self-guards
// to a clean SKIP when the store dir or Ollama is absent, then runs the
// pipeline in million (query-only) mode. LOCAL-ONLY per
// rules/ci-vs-local-testing.md.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchPreflight } from './lib/bench-preflight.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
// JD bench store + gold prefer C:\TerranSoul (a fast SSD) for the FTS5 random-I/O-bound
// ingest/query; the build-artifact shim stays under TARGET_DIR. Portable — falls back to
// the repo dir on CI / machines without C:\TerranSoul.
const JDBENCH_DIR = existsSync('C:/TerranSoul/jdbench') ? 'C:/TerranSoul/jdbench' : resolve(TARGET_DIR, 'jdbench');
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

async function ollamaUp() {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function main() {
  // BENCH-GUARD-SWEEP-1: this harness gates its dense channel on
  // LONGMEM_EMBED, so a CPU-pinned embedder silently costs it hours.
  // The guard is shared, not copied -- see lib/bench-preflight.mjs.
  runBenchPreflight({
    repoRoot: REPO_ROOT,
    outDir: process.cwd(),
    label: 'jd-chat',
    skip: process.argv.includes('--skip-preflight'),
    allowCpuEmbedder: process.argv.includes('--allow-cpu-embedder'),
  });
  const passthrough = process.argv.slice(2).filter(a => a !== 'run');

  // Default store + prebuilt shim (avoid cargo build contention).
  if (!process.env.LONGMEM_DATA_DIR) {
    process.env.LONGMEM_DATA_DIR = resolve(JDBENCH_DIR, 'store');
  }
  const storeDir = process.env.LONGMEM_DATA_DIR;
  const prebuilt = resolve(TARGET_DIR, 'debug', 'longmemeval-ipc.exe');
  if (!process.env.LONGMEM_SHIM_EXE && existsSync(prebuilt)) {
    process.env.LONGMEM_SHIM_EXE = prebuilt;
  }

  // ── Self-guard: SKIP cleanly if prerequisites are absent ─────────────────
  if (!existsSync(resolve(storeDir, 'memory.db'))) {
    console.log(`[jd-chat] SKIP: memory.db not found under ${storeDir}. Local-only bench (run bench:jd:million ingest first).`);
    return;
  }
  if (!existsSync(resolve(JDBENCH_DIR, 'gold.json'))) {
    console.log('[jd-chat] SKIP: gold.json not found. Local-only bench.');
    return;
  }
  if (!(await ollamaUp())) {
    console.log('[jd-chat] SKIP: Ollama not reachable (THINK reader needs it). Local-only bench.');
    return;
  }

  // Defaults: single-retrieval rrf (lexical+dense if LONGMEM_EMBED=1), million
  // query-only mode. Caller can override any of these via passthrough args.
  const defaults = new Map([
    ['--mode', 'million'],
    ['--system', 'rrf'],
    ['--label', 'levels'],
  ]);
  const args = ['run'];
  for (const [flag, val] of defaults) {
    if (!passthrough.includes(flag) && !passthrough.some(a => a.startsWith(`${flag}=`))) {
      args.push(flag, val);
    }
  }
  args.push(...passthrough);

  const pipeline = resolve(__dirname, 'jd-chat-pipeline.mjs');
  console.log(`[jd-chat] launching CHAT+THINK: node jd-chat-pipeline.mjs ${args.join(' ')}`);
  console.log(`[jd-chat] store=${storeDir} shim=${process.env.LONGMEM_SHIM_EXE ?? 'cargo run'}`);
  const child = spawn(process.execPath, [pipeline, ...args], { stdio: 'inherit', env: process.env });
  child.on('exit', code => process.exit(code ?? 0));
}

main().catch(err => {
  console.error(`[jd-chat] failed: ${err.message}`);
  process.exit(1);
});
