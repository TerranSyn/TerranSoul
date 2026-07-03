#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: single-query `search`-mode probe (2026-07-03).
//
// `MemoryStore::search` (shim mode `search`) is the app's unbounded
// keyword API: FTS5 OR-match over every query token with NO LIMIT, full
// row materialization, lexical+graph rerank of the whole match set, then
// one autocommit UPDATE (last_accessed/access_count) per matched row. At
// 5K rows a JD query already takes 8-18s; at 1M the match set is ~the
// whole corpus, so the full 5-runs x 3-JDs protocol is not tractable.
// This probe measures ONE bounded query against an EXISTING store so the
// scaling behaviour can be reported factually instead of extrapolated.
//
// NOTE: run this AFTER all rrf/hybrid measurements on the same store —
// the per-row UPDATE storm mutates access_count/last_accessed at scale.
//
// Usage:
//   LONGMEM_DATA_DIR=<store> node benchmark/scripts/jd-search-probe.mjs \
//     [--jd jd-en-backend] [--mode search] [--top-k 100] [--timeout-s 600]
//
// LOCAL-ONLY per rules/ci-vs-local-testing.md.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JD_QUERIES } from './jd-queries.mjs';
import { JsonlClient } from './lib/jd-ipc.mjs';

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

async function main() {
  if (!process.env.LONGMEM_DATA_DIR) {
    throw new Error('set LONGMEM_DATA_DIR to the existing bench store before probing');
  }
  const jdId = option('jd', 'jd-en-backend');
  const mode = option('mode', 'search');
  const topK = Number(option('top-k', '100'));
  const timeoutS = Number(option('timeout-s', '600'));
  const jd = JD_QUERIES.find(q => q.id === jdId);
  if (!jd) throw new Error(`unknown --jd ${jdId}`);

  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  try {
    const { count } = await client.send({ op: 'count' });
    console.log(`[jd-probe] store rows: ${Number(count).toLocaleString('en-US')}`);
    console.log(`[jd-probe] mode=${mode} jd=${jdId} top_k=${topK} timeout=${timeoutS}s — sending ONE query`);
    const t0 = performance.now();
    const timer = setTimeout(() => {
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[jd-probe] TIMEOUT: no response after ${secs}s — killing shim (result: did not complete)`);
      client.proc.kill();
      process.exitCode = 2;
    }, timeoutS * 1000);
    try {
      const response = await client.send({ op: 'search', query: jd.queryText, mode, limit: topK });
      clearTimeout(timer);
      const secs = (performance.now() - t0) / 1000;
      const ids = (response.results ?? []).map(hit => hit.session_id).filter(Boolean);
      console.log(`[jd-probe] completed in ${secs.toFixed(1)}s, ${ids.length} hits, top-10: ${ids.slice(0, 10).join(', ')}`);
    } catch (err) {
      clearTimeout(timer);
      if (process.exitCode !== 2) throw err;
    }
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch(err => {
  console.error(`[jd-probe] failed: ${err.message}`);
  process.exit(1);
});
