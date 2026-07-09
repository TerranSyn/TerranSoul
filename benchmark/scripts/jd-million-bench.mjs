#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH driver (Phase A, 2026-07-03).
//
// Ingests the deterministic multilingual resume corpus (jd-corpus.mjs) into
// TerranSoul's MemoryStore through the longmemeval-ipc JSONL shim, runs the
// three fixed job-description queries (jd-queries.mjs — en/vi/ja, one
// position each), and reports ingest throughput, query latency (p50/p95 of
// 5 runs) and accuracy (Recall@10/50/100 capped+raw, Precision@10, NDCG@10)
// against exact gold labels.
//
// Modeled on benchmark/scripts/longmemeval-s.mjs (JsonlClient shape reused).
//
// SMOKE SCALE: `node benchmark/scripts/jd-million-bench.mjs run --count 5000`
// (npm run bench:jd:smoke) must work end-to-end on a dev machine — that is
// the CI-adjacent local smoke. The million run is `npm run bench:jd:million`.
//
// CI POLICY (rules/ci-vs-local-testing.md): this bench is LOCAL-ONLY. It
// spawns a full cargo build + multi-minute ingest, which GitHub-hosted
// runners cannot absorb. Do NOT wire it into .github/workflows — the
// deterministic gate only runs the pure vitest units in
// benchmark/scripts/lib/*.test.mjs.
//
// Ingest fast path: the `add_sessions_jsonl` IPC op streams the corpus
// file Rust-side (no ~1 GB of JSON over the stdio pipe at 1M rows).
// When the op is missing (older shim), the driver falls back to piped
// `add_sessions` batches of 2000.
//
// Resume support (BENCH-SCALE-3): `--resume` asks the shim for its
// `count`, keeps the on-disk store, and slices the deterministic corpus
// at that offset — row N is a pure function of (seed, N), so skipping
// the first `count` rows reproduces exactly the missing tail.

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCorpus, writeGold, DEFAULT_SEED } from './jd-corpus.mjs';
import { JD_QUERIES } from './jd-queries.mjs';
import { recallAtK, precisionAtK, ndcgAtK, percentile } from './lib/jd-metrics.mjs';
import { goldMatchesQueries } from './lib/jd-gold-cache.mjs';
import { JsonlClient } from './lib/jd-ipc.mjs';
import { warmupThenMeasure } from './lib/jd-warmup.mjs';
import { chooseDrive } from '../../scripts/build/pick-build-cache-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const DEFAULT_CORPUS_DIR = resolve(DEFAULT_TARGET_DIR, 'jdbench');
// Historical fallback: same drive as the git checkout. JD-MILLION-HDD-ROOTCAUSE-1
// (2026-07-08) found the checkout's drive on this dev box (D:) is a spinning
// Seagate ST2000DX002 HDD (8.8 MB/s fsync'd-write probe) vs the Samsung 980
// PRO SSD on C: (242.4 MB/s, 27x) — SQLite's random-write-heavy ingest is
// disk-latency-bound, so a store dir that silently lands on the HDD produces
// a low ingest-rate reading indistinguishable from a real regression (this is
// exactly what happened across JD-MILLION-REBENCH-2026-07-07). See
// `resolveDefaultStoreDir` below for the SSD-preferring default that replaces
// this as the actual default; kept as the last-resort fallback when drive
// detection is inconclusive.
const DEFAULT_STORE_DIR = resolve(DEFAULT_CORPUS_DIR, 'store');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results', 'jd-million');
const DEFAULT_SYSTEMS = ['search', 'rrf'];
const DEFAULT_TOP_K = 100;
const DEFAULT_COUNT = 1000000;
const QUERY_RUNS = 5;
const FALLBACK_BATCH = 2000; // piped add_sessions batch when the jsonl op is missing
const JSONL_SLICE = 100000; // per-call slice for add_sessions_jsonl -> per-100K checkpoints
const BENCH_CACHE_ROOT_NAME = 'ts-bench-cache'; // sibling of ts-build-cache, own namespace on the chosen drive

// ---------------------------------------------------------------------------
// Store-dir placement (JD-MILLION-HDD-ROOTCAUSE-1, 2026-07-08)
// ---------------------------------------------------------------------------
//
// Reuses pick-build-cache-root.mjs's `Get-PhysicalDisk` drive probe, but with
// the OPPOSITE preference from that tool's own default: a build cache wants
// the roomiest drive (byte-for-byte builds don't care about seek latency);
// SQLite ingest is random-write-heavy and DOES care, so this passes
// `prefer: 'ssd'`. If detection finds no SSD (or the scan fails for any
// reason — no admin rights, non-Windows, WMI unavailable), it falls back to
// the historical `target-copilot-bench/jdbench/store` location so the bench
// never breaks over a placement heuristic; `LONGMEM_DATA_DIR` always wins
// over both.
function resolveDefaultStoreDir() {
  try {
    const { chosen } = chooseDrive({ rootName: BENCH_CACHE_ROOT_NAME, prefer: 'ssd', floor: 20 });
    if (chosen.media === 'SSD' && Number.isFinite(chosen.freeGB)) {
      const dir = resolve(chosen.root, 'jdbench', 'store');
      console.log(`[jd-bench] fast-drive probe picked ${chosen.label} (SSD, ${Math.round(chosen.freeGB)} GB free) -> ${dir}`);
      return dir;
    }
    console.log('[jd-bench] fast-drive probe found no eligible SSD; using the default store dir');
  } catch (err) {
    console.warn(`[jd-bench] fast-drive probe failed (${err.message}); using the default store dir`);
  }
  return DEFAULT_STORE_DIR;
}

/**
 * Loud one-time warning when the effective store dir (default OR an explicit
 * `LONGMEM_DATA_DIR` override) resolves onto a spinning disk. This is a
 * safety net on top of `resolveDefaultStoreDir` above — it fires even when
 * the caller overrides the default, so a future manual override can't
 * silently reproduce the same multi-day investigation.
 */
function warnIfSpinningDisk(storeDir) {
  const driveLetter = /^([A-Za-z]):[\\/]/.exec(resolve(storeDir));
  if (!driveLetter) return; // non-Windows or unrecognized path shape — best-effort only
  const label = `${driveLetter[1].toUpperCase()}:`;
  try {
    const { drives } = chooseDrive({ rootName: BENCH_CACHE_ROOT_NAME, floor: 0 });
    const match = drives.find(d => d.label === label);
    if (match && match.media === 'HDD') {
      console.warn('');
      console.warn('!'.repeat(78));
      console.warn(`[jd-bench] WARNING: store dir resolves onto ${label} — a spinning HDD, not`);
      console.warn('an SSD. SQLite ingest throughput is disk-latency-bound (measured 27x');
      console.warn('slower on HDD vs SSD on comparable hardware, JD-MILLION-HDD-ROOTCAUSE-1) —');
      console.warn('a low ingest-rate reading from here can look like a code regression when');
      console.warn('it is actually disk placement. Set LONGMEM_DATA_DIR to an SSD-backed path');
      console.warn('to get a representative number.');
      console.warn('!'.repeat(78));
      console.warn('');
    }
  } catch {
    // Best-effort — never fail the bench over a warning.
  }
}

// ---------------------------------------------------------------------------
// CLI plumbing (longmemeval-s.mjs conventions + `--name value` form)
// ---------------------------------------------------------------------------

function argvTail() {
  return process.argv.slice(3);
}

function option(name, defaultValue) {
  const argv = argvTail();
  const eq = argv.find(arg => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return defaultValue;
}

function hasFlag(name) {
  return argvTail().includes(`--${name}`);
}

function positiveNumberOption(name, defaultValue) {
  const raw = option(name, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

function command() {
  const raw = process.argv[2];
  if (!raw || raw.startsWith('--')) return 'help';
  return raw;
}

function printHelp() {
  console.log(`MILLION-RESUME-BENCH driver

Usage:
  npm run bench:jd:prepare
  npm run bench:jd:smoke        # run --count 5000 --systems search,rrf
  npm run bench:jd:million      # run --count 1000000 --systems search,rrf

Commands:
  prepare   Generate the corpus + gold labels if missing
  run       Ingest + query + report
  help      Print this help

Options for run:
  --count=<n>            Corpus size (default: ${DEFAULT_COUNT}); --limit is an alias
  --systems=search,rrf   Search modes to evaluate (default: search,rrf)
  --top-k=<n>            Retrieval depth (default: ${DEFAULT_TOP_K})
  --seed=<n>             Corpus seed (default: ${DEFAULT_SEED})
  --corpus-dir=<path>    Corpus dir (default: target-copilot-bench/jdbench)
  --out-dir=<path>       Report dir (default: benchmark/results/jd-million)
  --resume               Keep the on-disk store, query its count, ingest only the tail
  --hybrid-weights=v,k,r,i,d,t
                         Send set_hybrid_weights (vector, keyword, recency,
                         importance, decay, tier_priority) before the query
                         phase — affects the \`hybrid\` system (MEMORY-CFG-AUDIT-5)

Store dir (LONGMEM_DATA_DIR):
  Unset -> probes fixed drives for the fastest one with an SSD (JD-MILLION-
  HDD-ROOTCAUSE-1, 2026-07-08 — SQLite ingest is disk-latency-bound; a
  spinning-HDD-backed store measured 27x slower than SSD on this class of
  hardware) and uses \`<ssd-drive>/${BENCH_CACHE_ROOT_NAME}/jdbench/store\`; falls
  back to \`target-copilot-bench/jdbench/store\` if no SSD is detected. Set
  LONGMEM_DATA_DIR explicitly to override either way; a loud warning prints
  if the effective store dir (default or override) resolves onto an HDD.
`);
}

// ---------------------------------------------------------------------------
// Prepare: corpus + gold
// ---------------------------------------------------------------------------

function loadManifest(corpusDir) {
  const manifestPath = resolve(corpusDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

async function prepare({ count, seed, corpusDir }) {
  const manifest = loadManifest(corpusDir);
  const goldPath = resolve(corpusDir, 'gold.json');
  const fresh = manifest && manifest.count === count && manifest.seed === seed
    && existsSync(resolve(corpusDir, 'resumes.jsonl'))
    && existsSync(resolve(corpusDir, 'meta.jsonl'));
  let cachedGold = null;
  if (existsSync(goldPath)) {
    try {
      cachedGold = JSON.parse(readFileSync(goldPath, 'utf8'));
    } catch {
      cachedGold = null;
    }
  }
  if (fresh && goldMatchesQueries(cachedGold, JD_QUERIES)) {
    console.log(`[jd-bench] reusing corpus at ${corpusDir} (count=${count}, seed=${seed})`);
    return;
  }
  if (fresh && cachedGold) {
    console.log('[jd-bench] cached gold.json does not cover the current JD_QUERIES ids -- recomputing gold labels (corpus itself is reused)');
  }
  if (!fresh) {
    console.log(`[jd-bench] generating corpus count=${count} seed=${seed} -> ${corpusDir}`);
    await generateCorpus({
      count,
      outDir: corpusDir,
      seed,
      onProgress: (done, total) => console.log(`[jd-bench] generated ${done.toLocaleString('en-US')}/${total.toLocaleString('en-US')}`),
    });
  }
  console.log('[jd-bench] computing gold labels');
  const result = await writeGold(JD_QUERIES, corpusDir, {
    onProgress: n => console.log(`[jd-bench] gold scan ${n.toLocaleString('en-US')}`),
  });
  for (const [jdId, n] of Object.entries(result.counts)) {
    console.log(`[jd-bench] gold ${jdId}: ${n}`);
  }
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Ingest resumes [startIndex, count) into the shim.
 * Fast path: `add_sessions_jsonl` in ${JSONL_SLICE}-row slices (per-100K
 * checkpoints). Fallback: piped `add_sessions` batches of ${FALLBACK_BATCH}
 * when the op is missing on an older shim.
 * Returns { rows, elapsedSeconds, rowsPerSecond, checkpoints, path }.
 */
async function ingest(client, { resumesPath, startIndex, count, questionId }) {
  const total = count - startIndex;
  const checkpoints = [];
  const t0 = performance.now();
  let ingested = 0;
  let path = 'add_sessions_jsonl';

  const checkpoint = (rows, sliceSeconds) => {
    ingested += rows;
    const overallSeconds = (performance.now() - t0) / 1000;
    checkpoints.push({
      rows: ingested,
      sliceRows: rows,
      sliceSeconds: Number(sliceSeconds.toFixed(3)),
      sliceRowsPerSecond: sliceSeconds > 0 ? Math.round(rows / sliceSeconds) : 0,
      overallSeconds: Number(overallSeconds.toFixed(3)),
      overallRowsPerSecond: overallSeconds > 0 ? Math.round(ingested / overallSeconds) : 0,
    });
    const last = checkpoints[checkpoints.length - 1];
    console.log(`[jd-bench] ingest ${ingested.toLocaleString('en-US')}/${total.toLocaleString('en-US')} `
      + `slice=${last.sliceRowsPerSecond.toLocaleString('en-US')} rows/s `
      + `overall=${last.overallRowsPerSecond.toLocaleString('en-US')} rows/s`);
  };

  let jsonlSupported = true;
  for (let offset = startIndex; offset < count; offset += JSONL_SLICE) {
    const sliceLen = Math.min(JSONL_SLICE, count - offset);
    const tSlice = performance.now();
    try {
      const data = await client.send({
        op: 'add_sessions_jsonl',
        question_id: questionId,
        path: resumesPath,
        start_index: offset,
        count: sliceLen,
      });
      checkpoint(data.added ?? sliceLen, (performance.now() - tSlice) / 1000);
    } catch (err) {
      if (offset === startIndex && /unsupported op/i.test(err.message)) {
        jsonlSupported = false;
        break;
      }
      throw err;
    }
  }

  if (!jsonlSupported) {
    // Older shim without the op: stream the corpus file in Node and pipe
    // add_sessions batches over stdio. Slower (JSON over the pipe) but
    // keeps the driver usable everywhere.
    path = 'add_sessions (piped fallback)';
    console.log('[jd-bench] add_sessions_jsonl unsupported by shim; falling back to piped add_sessions batches');
    const rl = createInterface({ input: createReadStream(resumesPath, 'utf8'), crlfDelay: Infinity });
    let batch = [];
    let lineIndex = 0;
    let sliceRows = 0;
    let tSlice = performance.now();
    const flush = async () => {
      if (!batch.length) return;
      const sessions = batch;
      batch = [];
      await client.send({ op: 'add_sessions', question_id: questionId, sessions });
      sliceRows += sessions.length;
      if (sliceRows >= JSONL_SLICE) {
        checkpoint(sliceRows, (performance.now() - tSlice) / 1000);
        sliceRows = 0;
        tSlice = performance.now();
      }
    };
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (lineIndex >= count) break;
      if (lineIndex >= startIndex) {
        batch.push(JSON.parse(line));
        if (batch.length >= FALLBACK_BATCH) await flush();
      }
      lineIndex += 1;
    }
    await flush();
    if (sliceRows > 0) checkpoint(sliceRows, (performance.now() - tSlice) / 1000);
  }

  const elapsedSeconds = (performance.now() - t0) / 1000;
  return {
    rows: ingested,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    rowsPerSecond: elapsedSeconds > 0 ? Math.round(ingested / elapsedSeconds) : 0,
    checkpoints,
    path,
  };
}

// ---------------------------------------------------------------------------
// Queries + metrics
// ---------------------------------------------------------------------------

async function runQueries(client, { systems, topK, gold }) {
  const results = [];
  for (const system of systems) {
    for (const jd of JD_QUERIES) {
      const goldIds = new Set(gold.gold[jd.id] ?? []);

      // JD-MILLION-WARMP50-1: one untimed warm-up request primes caches/plans
      // before the timed runs so latency_ms.p50/p95 are genuinely warm (see
      // benchmark/scripts/lib/jd-warmup.mjs for why the first-of-N sample was
      // a methodology mismatch). The warm-up's own latency is preserved as
      // latency_ms.cold_ms for auditability, not silently dropped.
      const sendOnce = async () => {
        const response = await client.send({
          op: 'search',
          query: jd.queryText,
          mode: system,
          limit: topK,
        });
        return (response.results ?? []).map(hit => hit.session_id).filter(Boolean);
      };
      const { coldMs, latencies, lastResult: lastRetrieved } = await warmupThenMeasure(sendOnce, QUERY_RUNS);

      // Accuracy from the LAST timed run (warm store, stable caches).
      const r10 = recallAtK(lastRetrieved, goldIds, 10);
      const r50 = recallAtK(lastRetrieved, goldIds, 50);
      const r100 = recallAtK(lastRetrieved, goldIds, 100);
      const hitLangs = {};
      for (const id of lastRetrieved.slice(0, topK)) {
        if (goldIds.has(id)) {
          const lang = gold.langOf[id] ?? 'unknown';
          hitLangs[lang] = (hitLangs[lang] ?? 0) + 1;
        }
      }
      results.push({
        system,
        jd_id: jd.id,
        jd_lang: jd.lang,
        jd_title: jd.title,
        gold_size: goldIds.size,
        runs: QUERY_RUNS,
        latency_ms: {
          p50: Number(percentile(latencies, 50).toFixed(2)),
          p95: Number(percentile(latencies, 95).toFixed(2)),
          all: latencies.map(v => Number(v.toFixed(2))),
          cold_ms: Number(coldMs.toFixed(2)),
        },
        recall_at_10: { capped: r10.capped, raw: r10.raw, hits: r10.hits },
        recall_at_50: { capped: r50.capped, raw: r50.raw, hits: r50.hits },
        recall_at_100: { capped: r100.capped, raw: r100.raw, hits: r100.hits },
        precision_at_10: precisionAtK(lastRetrieved, goldIds, 10),
        ndcg_at_10: ndcgAtK(lastRetrieved, goldIds, 10),
        gold_hits_by_lang: hitLangs,
        retrieved_top_20: lastRetrieved.slice(0, 20),
      });
      const r = results[results.length - 1];
      console.log(`[jd-bench] ${system} ${jd.id}: R@10=${pct(r.recall_at_10.capped)} `
        + `R@100=${pct(r.recall_at_100.capped)} P@10=${pct(r.precision_at_10)} `
        + `NDCG@10=${pct(r.ndcg_at_10)} p50=${r.latency_ms.p50}ms p95=${r.latency_ms.p95}ms `
        + `cold=${r.latency_ms.cold_ms}ms`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function collectLongmemEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('LONGMEM_') || key === 'LCM_CONV_AWARE') env[key] = value;
  }
  return env;
}

function markdownReport(report) {
  const lines = [];
  const w = line => lines.push(line);
  w('# MILLION-RESUME-BENCH Report');
  w('');
  w(`Date: ${report.generated_at}`);
  w(`Corpus: ${report.config.count.toLocaleString('en-US')} synthetic resumes, seed ${report.config.seed}`);
  w(`Systems: ${report.config.systems.join(', ')} | top-k: ${report.config.top_k}`);
  w('');
  w('## Methodology');
  w('');
  w('- Deterministic multilingual synthetic resumes (en 40%, vi/ja 15%, ko/zh 8%, es/fr 7%),');
  w('  10 job areas, canonical skill IDs with Latin-script tech tokens in every language.');
  w('- Gold predicate per JD: `area equal AND >= 2 requiredSkills present AND years >= minYears`.');
  w('- Ingest through the `longmemeval-ipc` JSONL shim (same MemoryStore code path production uses).');
  w('- Each JD query issues one untimed warm-up request (discarded, primes caches/plans) then');
  w('  5 timed runs per system; latency_ms.p50/p95 are computed over ONLY those 5 warm timed runs');
  w('  (JD-MILLION-WARMP50-1); the warm-up\'s own latency is preserved separately as');
  w('  `latency_ms.cold_ms` so the cold-start cost stays visible/auditable. Accuracy is from the');
  w('  LAST timed run.');
  w('- Recall@K is reported in two labelled forms: **capped** = hits / min(K, |gold|)');
  w('  (1.0 achievable when |gold| > K) and **raw** = hits / |gold| (classic recall,');
  w('  bounded by K/|gold| at this gold density). NDCG@10 uses binary relevance.');
  w('- NOTE: with `LONGMEM_EMBED` unset the dense channel is OFF and `rrf` degenerates to');
  w('  lexical-only fusion (see the env table below before comparing systems).');
  w('');
  w('## Environment');
  w('');
  w('| Variable | Value |');
  w('|---|---|');
  const envEntries = Object.entries(report.env.longmem_vars);
  if (envEntries.length === 0) {
    w('| (no LONGMEM_* variables set) | — |');
  } else {
    for (const [key, value] of envEntries) w(`| ${key} | ${value} |`);
  }
  w(`| LONGMEM_DATA_DIR (effective) | ${report.env.effective_data_dir} |`);
  w(`| node | ${report.env.node} |`);
  w(`| platform | ${report.env.platform} |`);
  w('');
  w('## Ingest');
  w('');
  w(`Path: ${report.ingest.path}`);
  w(`Rows: ${report.ingest.rows.toLocaleString('en-US')} in ${report.ingest.elapsedSeconds.toFixed(1)}s `
    + `(**${report.ingest.rowsPerSecond.toLocaleString('en-US')} rows/s** overall)`);
  w('');
  w('| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |');
  w('|---:|---:|---:|---:|');
  for (const cp of report.ingest.checkpoints) {
    w(`| ${cp.rows.toLocaleString('en-US')} | ${cp.sliceRowsPerSecond.toLocaleString('en-US')} | ${cp.overallRowsPerSecond.toLocaleString('en-US')} | ${cp.overallSeconds.toFixed(1)} |`);
  }
  w('');
  w('## Results');
  for (const system of report.config.systems) {
    w('');
    w(`### system: ${system}`);
    w('');
    w('| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 (warm) | p95 (warm) | cold (warm-up) |');
    w('|---|---|---:|---|---|---|---:|---:|---:|---:|---:|');
    for (const row of report.results.filter(r => r.system === system)) {
      w(`| ${row.jd_id} | ${row.jd_lang} | ${row.gold_size} `
        + `| ${pct(row.recall_at_10.capped)} / ${pct(row.recall_at_10.raw)} `
        + `| ${pct(row.recall_at_50.capped)} / ${pct(row.recall_at_50.raw)} `
        + `| ${pct(row.recall_at_100.capped)} / ${pct(row.recall_at_100.raw)} `
        + `| ${pct(row.precision_at_10)} | ${pct(row.ndcg_at_10)} `
        + `| ${row.latency_ms.p50}ms | ${row.latency_ms.p95}ms | ${row.latency_ms.cold_ms}ms |`);
    }
  }
  w('');
  w('## Per-language gold composition and hits');
  w('');
  w('Gold composition = where the gold resumes live per language (corpus fact).');
  w(`Hits = languages of gold resumes found in the top-${report.config.top_k} (last run).`);
  w('');
  for (const jd of report.gold_summary) {
    w(`### ${jd.id} (gold=${jd.goldSize})`);
    w('');
    w('| Lang | Gold | ' + report.config.systems.map(s => `${s} hits`).join(' | ') + ' |');
    w('|---|---:|' + report.config.systems.map(() => '---:').join('|') + '|');
    const langs = Object.keys(jd.byLang).sort((a, b) => jd.byLang[b] - jd.byLang[a]);
    for (const lang of langs) {
      const hitCells = report.config.systems.map(system => {
        const row = report.results.find(r => r.system === system && r.jd_id === jd.id);
        return String(row?.gold_hits_by_lang?.[lang] ?? 0);
      });
      w(`| ${lang} | ${jd.byLang[lang]} | ${hitCells.join(' | ')} |`);
    }
    w('');
  }
  w('## Notes');
  w('');
  w('- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.');
  w('- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the');
  w('  store\'s `count` (BENCH-SCALE-3 resume pattern).');
  return `${lines.join('\n')}\n`;
}

function writeReports(report, outDir) {
  mkdirSync(outDir, { recursive: true });
  const mdPath = resolve(outDir, 'report.md');
  const jsonPath = resolve(outDir, 'report.json');
  writeFileSync(mdPath, markdownReport(report), 'utf8');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[jd-bench] wrote ${mdPath}`);
  console.log(`[jd-bench] wrote ${jsonPath}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run(options) {
  const { count, seed, corpusDir, outDir, systems, topK, resume, hybridWeights } = options;
  await prepare({ count, seed, corpusDir });
  const resumesPath = resolve(corpusDir, 'resumes.jsonl');
  const gold = JSON.parse(readFileSync(resolve(corpusDir, 'gold.json'), 'utf8'));

  // The shim persists rows when LONGMEM_DATA_DIR points at an on-disk
  // store; its `reset` op reopens the SAME directory, so a clean run must
  // delete the store dir BEFORE spawning cargo. `--resume` keeps it
  // (BENCH-SCALE-3: corpus row N is deterministic, so the tail can be
  // re-derived from the shim's `count`).
  const storeDir = process.env.LONGMEM_DATA_DIR || resolveDefaultStoreDir();
  if (!resume) {
    rmSync(storeDir, { recursive: true, force: true });
  }
  if (!process.env.LONGMEM_DATA_DIR) {
    process.env.LONGMEM_DATA_DIR = storeDir;
    console.log(`[jd-bench] LONGMEM_DATA_DIR not set; defaulting to ${storeDir}`);
  }
  warnIfSpinningDisk(storeDir);

  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  process.on('SIGINT', () => {
    console.error('[jd-bench] SIGINT — shutting down IPC');
    client.close().finally(() => process.exit(130));
  });

  let report;
  try {
    let startIndex = 0;
    if (resume) {
      // BENCH-SCALE-3 resume pattern: the shim's `count` op returns the
      // number of rows already in the `memories` table; because corpus
      // row N is deterministic, that count IS the offset into the corpus.
      const data = await client.send({ op: 'count' });
      startIndex = Math.min(Number(data.count) || 0, count);
      console.log(`[jd-bench] resume: store already holds ${startIndex.toLocaleString('en-US')} rows`);
    } else {
      await client.send({ op: 'reset' });
    }

    const ingestStats = startIndex >= count
      ? { rows: 0, elapsedSeconds: 0, rowsPerSecond: 0, checkpoints: [], path: 'skipped (resume complete)' }
      : await ingest(client, { resumesPath, startIndex, count, questionId: 'jd-million' });

    // INGEST-1M-PER-SEC (2026-07-09): when LONGMEM_WRITE_ENGINE=1 routed
    // ingest through the sharded write engine, rows are durable-but-not-yet-
    // query-visible until `write_engine_finalize` runs (flush -> reconcile ->
    // materialize into self.conn, the ONLY table the unmodified query path
    // below reads). A no-op (reports `enabled: false`) when the engine
    // wasn't active, so this is safe to send unconditionally.
    const writeEngineFinalize = await client.send({ op: 'write_engine_finalize' });
    if (writeEngineFinalize?.enabled !== false) {
      console.log(`[jd-bench] write_engine_finalize ${JSON.stringify(writeEngineFinalize)}`);
    }

    // MEMORY-CFG-AUDIT-5 mechanism: persist HybridWeights on the store's
    // Cell before the query phase. Order: vector, keyword, recency,
    // importance, decay, tier_priority. Affects the `hybrid` system only
    // (rrf's fusion is rank-based and does not read HybridWeights).
    if (hybridWeights) {
      await client.send({ op: 'set_hybrid_weights', weights: hybridWeights });
      console.log(`[jd-bench] set_hybrid_weights ${JSON.stringify(hybridWeights)}`);
    }

    const results = await runQueries(client, { systems, topK, gold });

    report = {
      benchmark: 'MILLION-RESUME-BENCH',
      generated_at: new Date().toISOString(),
      config: {
        count,
        seed,
        systems,
        top_k: topK,
        resume,
        query_runs: QUERY_RUNS,
        corpus_dir: corpusDir,
        hybrid_weights: hybridWeights,
      },
      env: {
        longmem_vars: collectLongmemEnv(),
        effective_data_dir: storeDir,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
      },
      ingest: { ...ingestStats, start_index: startIndex, write_engine_finalize: writeEngineFinalize },
      gold_summary: gold.jds,
      results,
    };
  } finally {
    await client.close();
  }

  writeReports(report, outDir);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cmd = command();
  if (cmd === 'help' || hasFlag('help')) {
    printHelp();
    return;
  }

  const corpusDir = resolve(REPO_ROOT, option('corpus-dir', DEFAULT_CORPUS_DIR));
  const seed = positiveNumberOption('seed', DEFAULT_SEED);
  // --limit is an alias for --count (longmemeval-s.mjs convention).
  const count = positiveNumberOption('count', positiveNumberOption('limit', DEFAULT_COUNT));

  if (cmd === 'prepare') {
    await prepare({ count, seed, corpusDir });
    return;
  }
  if (cmd !== 'run') {
    throw new Error(`unknown command: ${cmd}`);
  }

  const systems = option('systems', DEFAULT_SYSTEMS.join(','))
    .split(',')
    .map(system => system.trim())
    .filter(Boolean);

  const options = {
    count,
    seed,
    corpusDir,
    outDir: resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR)),
    systems,
    topK: positiveNumberOption('top-k', DEFAULT_TOP_K),
    resume: hasFlag('resume'),
    hybridWeights: (() => {
      const raw = option('hybrid-weights', null);
      if (!raw) return null;
      const weights = raw.split(',').map(Number);
      if (weights.length !== 6 || weights.some(w => !Number.isFinite(w) || w < 0)) {
        throw new Error(`--hybrid-weights must be six non-negative numbers, got ${raw}`);
      }
      return weights;
    })(),
  };
  console.log(`[jd-bench] run count=${count.toLocaleString('en-US')} systems=${systems.join(',')} top_k=${options.topK} resume=${options.resume}`);
  await run(options);
}

main().catch(err => {
  console.error(`[jd-bench] failed: ${err.message}`);
  process.exit(1);
});
