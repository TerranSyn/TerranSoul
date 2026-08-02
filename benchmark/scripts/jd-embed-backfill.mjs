#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-2 (2026-07-03): resumable dense-channel backfill driver.
//
// Loops the `embed_backfill` IPC op against an EXISTING store (pointed at by
// LONGMEM_DATA_DIR) until every `memories.embedding IS NULL` row is embedded.
// Each op call embeds up to --max-rows rows (durable per 256-row batch), so
// killing this script at any point loses nothing — rerun and it resumes.
//
// Requires LONGMEM_EMBED=1 (+ LONGMEM_EMBED_MODEL) in the environment: the
// shim builds its OllamaEmbedder from env, applying the production
// asymmetric document prefixes (EmbedKind::Document).
//
// EMBED RUN PREFLIGHT guardrail (2026-07-02 archaeology): Ollama silently
// places an embed model CPU-side when VRAM is occupied at load — identical
// vectors, ~40x slower, sticky until stop+reload. This driver verifies
// /api/ps shows size_vram == size for the embed model BEFORE starting and
// every --vram-check-every op calls (default ≈ every few minutes), and
// aborts with exit 3 when the model is evicted so the operator can
// `docker restart ollama`, re-warm, and rerun (the loop resumes).
//
// CI POLICY (rules/ci-vs-local-testing.md): LOCAL-ONLY, never in workflows.
//
// Usage:
//   LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma \
//   LONGMEM_DATA_DIR=<store dir> \
//   node benchmark/scripts/jd-embed-backfill.mjs [--max-rows 2048] \
//        [--batch 256] [--vram-check-every 20] [--max-seconds 0]

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonlClient } from './lib/jd-ipc.mjs';
import { runBenchPreflight } from './lib/bench-preflight.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');

function option(name, defaultValue) {
  const argv = process.argv.slice(2);
  const eq = argv.find(arg => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return defaultValue;
}

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const EMBED_MODEL = process.env.LONGMEM_EMBED_MODEL || 'embeddinggemma';

/** Verify the embed model sits fully in VRAM (size_vram === size). */
async function vramPlacementOk() {
  const res = await fetch(`${OLLAMA_HOST}/api/ps`);
  if (!res.ok) throw new Error(`/api/ps -> ${res.status}`);
  const body = await res.json();
  const model = (body.models ?? []).find(m => m.name?.startsWith(EMBED_MODEL));
  if (!model) return { ok: false, reason: `model ${EMBED_MODEL} not loaded` };
  if (model.size_vram !== model.size) {
    return { ok: false, reason: `size_vram ${model.size_vram} != size ${model.size} (CPU-side placement)` };
  }
  return { ok: true, reason: `size_vram == size (${model.size_vram})` };
}

/** Warm the embed model with a long keep_alive so it survives the run. */
async function warmEmbedModel() {
  const res = await fetch(`${OLLAMA_HOST}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: ['warmup'], keep_alive: '2h' }),
  });
  if (!res.ok) throw new Error(`warm embed -> ${res.status}`);
}

async function main() {
  // BENCH-GUARD-SWEEP-1: shared embedder preflight (lib/bench-preflight.mjs).
  runBenchPreflight({
    repoRoot: REPO_ROOT,
    outDir: process.cwd(),
    label: 'jd-backfill',
    skip: process.argv.includes('--skip-preflight'),
    allowCpuEmbedder: process.argv.includes('--allow-cpu-embedder'),
  });
  if (process.env.LONGMEM_EMBED !== '1') {
    console.error('[jd-backfill] LONGMEM_EMBED=1 is required (the shim builds its embedder from env)');
    process.exit(2);
  }
  if (!process.env.LONGMEM_DATA_DIR) {
    console.error('[jd-backfill] LONGMEM_DATA_DIR must point at the existing store');
    process.exit(2);
  }
  const maxRows = Number(option('max-rows', '2048'));
  const batch = Number(option('batch', '256'));
  const vramCheckEvery = Number(option('vram-check-every', '20'));
  const maxSeconds = Number(option('max-seconds', '0')); // 0 = until done

  console.log(`[jd-backfill] store=${process.env.LONGMEM_DATA_DIR}`);
  console.log(`[jd-backfill] model=${EMBED_MODEL} host=${OLLAMA_HOST} max_rows/call=${maxRows} batch=${batch}`);

  await warmEmbedModel();
  const pre = await vramPlacementOk();
  if (!pre.ok) {
    console.error(`[jd-backfill] VRAM preflight FAILED: ${pre.reason} — docker restart ollama, re-warm, rerun`);
    process.exit(3);
  }
  console.log(`[jd-backfill] VRAM preflight ok: ${pre.reason}`);

  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  process.on('SIGINT', () => {
    console.error('[jd-backfill] SIGINT — shutting down IPC (progress is durable)');
    client.close().finally(() => process.exit(130));
  });

  const t0 = performance.now();
  let total = 0;
  let calls = 0;
  try {
    for (;;) {
      const data = await client.send({ op: 'embed_backfill', batch, max_rows: maxRows });
      total += data.embedded;
      calls += 1;
      const elapsed = (performance.now() - t0) / 1000;
      const rate = elapsed > 0 ? total / elapsed : 0;
      const etaS = rate > 0 ? data.remaining / rate : Infinity;
      console.log(`[jd-backfill] +${data.embedded} rows (${data.rate_rows_per_s.toFixed(1)}/s call) `
        + `total=${total.toLocaleString('en-US')} remaining=${data.remaining.toLocaleString('en-US')} `
        + `overall=${rate.toFixed(1)}/s eta=${Number.isFinite(etaS) ? (etaS / 60).toFixed(1) : '?'}min`);
      if (data.remaining === 0) {
        console.log(`[jd-backfill] DONE: ${total.toLocaleString('en-US')} rows in ${(elapsed / 60).toFixed(1)} min (${rate.toFixed(1)} rows/s)`);
        break;
      }
      if (data.embedded === 0) {
        throw new Error('no progress in a full op call while rows remain');
      }
      if (maxSeconds > 0 && elapsed >= maxSeconds) {
        console.log(`[jd-backfill] --max-seconds ${maxSeconds} reached with ${data.remaining} remaining; rerun to resume`);
        break;
      }
      if (calls % vramCheckEvery === 0) {
        const check = await vramPlacementOk();
        if (!check.ok) {
          console.error(`[jd-backfill] VRAM check FAILED mid-run: ${check.reason} — stopping (progress durable). Restart ollama, re-warm, rerun.`);
          process.exitCode = 3;
          break;
        }
        console.log(`[jd-backfill] VRAM re-check ok (${calls} calls)`);
      }
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(`[jd-backfill] failed: ${err.message}`);
  process.exit(1);
});
