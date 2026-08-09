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
// Resume support (an internal work item): `--resume` asks the shim for its
// `count`, keeps the on-disk store, and slices the deterministic corpus
// at that offset — row N is a pure function of (seed, N), so skipping
// the first `count` rows reproduces exactly the missing tail.

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCorpus, writeGold, DEFAULT_SEED } from './jd-corpus.mjs';
import { JD_QUERIES } from './jd-queries.mjs';
import { recallAtK, precisionAtK, ndcgAtK, percentile } from './lib/jd-metrics.mjs';
import { goldMatchesQueries } from './lib/jd-gold-cache.mjs';
import { JsonlClient } from './lib/jd-ipc.mjs';
import { warmupThenMeasure } from './lib/jd-warmup.mjs';
import { chooseDrive } from '../../scripts/build/pick-build-cache-root.mjs';
import { runBenchPreflight } from './lib/bench-preflight.mjs';

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

// --real-pdf (2026-07-29): ingest the ALREADY-BUILT 1,000-file real
// selectable-text PDF corpus through the production `terransoul --ingest`
// CLI path (real DocParser text-layer extraction, not the JSONL shim) —
// see rules/completion-log.md for the internal module/internal module fixes this depends
// on (bulk-ingest LLM suppression, embed-drain-loop). Schema compatibility
// between `terransoul-console`'s `TERRANSOUL_HEADLESS_DATA_DIR` and this
// script's `LONGMEM_DATA_DIR` (same MemoryStore, different env var names for
// "here is the data dir") was verified 2026-07-29 via jd-search-probe.mjs
// against a real `--ingest`-populated store.
const REAL_PDF_CORPUS_DIR = process.env.JD_REAL_PDF_CORPUS || 'D:/TerranSoul/jd-1000-text';
const REAL_PDF_CORPUS_SIZE = 1000; // the corpus on disk today — see JD_REAL_PDF_CORPUS to point elsewhere
const TERRANSOUL_CONSOLE_EXE = resolve(REPO_ROOT, 'the application repository', 'target', 'debug', 'terransoul-console.exe');
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
                         phase — affects the \`hybrid\` system (MEMORY-CFG-an internal work item)
  --real-pdf             Ingest the real ${REAL_PDF_CORPUS_SIZE}-file selectable-text PDF corpus
                         (${REAL_PDF_CORPUS_DIR}) through the production
                         \`terransoul --ingest\` CLI (real DocParser text-layer
                         extraction) instead of the JSONL shim. Requires
                         --count ${REAL_PDF_CORPUS_SIZE} and no --resume.

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

/**
 * --real-pdf ingest path: shell out to the PLAIN, DEFAULT `terransoul
 * --ingest` CLI — the exact same command the desktop app's drag-and-drop
 * and a normal CLI user run, no demo-only flags. Real DocParser text-layer
 * extraction, against the on-disk real PDF corpus, pointed at the SAME
 * store directory the query stages read via `LONGMEM_DATA_DIR`. Unlike
 * `ingest()` this is not resumable/sliceable — it ingests the whole corpus
 * folder in one CLI invocation — so callers must only reach this path when
 * `count === REAL_PDF_CORPUS_SIZE` and `!resume` (validated by the caller).
 * Returns the same shape as `ingest()` so `run()`'s report-building code
 * does not need to know which path ran.
 *
 * Deliberately NOT passing `--no-embed`: the demo must measure what a real
 * user actually gets, and speed is the production ingest path's own job to
 * get right (see internal module's batched-embed fix), not something a caller
 * opts into per invocation.
 */
async function ingestRealPdf({ storeDir }) {
  if (!existsSync(TERRANSOUL_CONSOLE_EXE)) {
    throw new Error(
      `--real-pdf needs ${TERRANSOUL_CONSOLE_EXE}, which does not exist. Build it first: ` +
        'cd the application repository && cargo build --bin terransoul-console',
    );
  }
  if (!existsSync(REAL_PDF_CORPUS_DIR)) {
    throw new Error(`--real-pdf needs the corpus at ${REAL_PDF_CORPUS_DIR}, which does not exist.`);
  }
  console.log(`[jd-bench] --real-pdf: ingesting ${REAL_PDF_CORPUS_DIR} via plain terransoul --ingest (same path Desktop/CLI use, no custom params)`);
  const t0 = performance.now();
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(TERRANSOUL_CONSOLE_EXE, ['--ingest', REAL_PDF_CORPUS_DIR], {
      env: { ...process.env, TERRANSOUL_HEADLESS_DATA_DIR: storeDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; process.stdout.write(`[terransoul-ingest] ${d}`); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(`[terransoul-ingest] ${d}`); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`terransoul --ingest exited ${code}\n${stderr.slice(-2000)}`));
        return;
      }
      resolvePromise(stdout + stderr);
    });
  });
  const elapsedSeconds = (performance.now() - t0) / 1000;

  // Parse "ingested: <path> (N/M files, P chunks persisted, S skipped)".
  const match = output.match(/ingested:.*\((\d+)\/(\d+) files, (\d+) chunks persisted, (\d+) skipped\)/);
  if (!match) {
    throw new Error(`--real-pdf: could not parse terransoul --ingest's success line from its output:\n${output.slice(-2000)}`);
  }
  const [, filesQueued, fileCount, chunksPersisted] = match.map(Number);
  console.log(`[jd-bench] --real-pdf ingested ${filesQueued}/${fileCount} files, ${chunksPersisted} chunks, ${elapsedSeconds.toFixed(1)}s`);

  return {
    rows: chunksPersisted,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    rowsPerSecond: elapsedSeconds > 0 ? Math.round(chunksPersisted / elapsedSeconds) : 0,
    checkpoints: [],
    path: 'terransoul --ingest (real PDF, DocParser text-layer, default path)',
  };
}

// ---------------------------------------------------------------------------
// Queries + metrics
// ---------------------------------------------------------------------------

/**
 * TYPESENSE-ADAPT-6-CACHE-SCALE-GAP-1 (2026-07-11): read the shim's
 * process-wide metrics snapshot (`op: metrics_snapshot`), notably
 * `typo_dict_cache` (hits / miss-cause split / rebuild+expansion timers),
 * so per-phase counter deltas prove or refute the cache mechanism at
 * scale. Returns null on an older shim without the op — never fails the
 * bench over observability.
 */
async function fetchMetricsSnapshot(client) {
  try {
    return await client.send({ op: 'metrics_snapshot' });
  } catch (err) {
    if (/unsupported op/i.test(err.message)) return null;
    throw err;
  }
}

function typoCacheLine(snap) {
  const c = snap?.typo_dict_cache;
  if (!c) return 'typo_dict_cache: (unavailable)';
  const rate = c.hit_rate == null ? 'n/a' : `${(c.hit_rate * 100).toFixed(1)}%`;
  return `typo_dict_cache: hits=${c.hits} miss_cold=${c.misses_cold} `
    + `miss_mut=${c.misses_mutations_changed} miss_dv=${c.misses_data_version_changed} `
    + `hit_rate=${rate} rebuilds=${c.rebuild.count} (p50=${c.rebuild.p50_ms}ms) `
    + `expansions=${c.expansion.count} (p50=${c.expansion.p50_ms}ms)`;
}

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

      // TYPESENSE-ADAPT-6-CACHE-SCALE-GAP-1: snapshot the typo-dictionary
      // cache counters after this query's cold+warm block so the report
      // carries the between-phase counter evidence (cumulative process-wide
      // values; diff consecutive rows for per-query deltas).
      const metricsSnap = await fetchMetricsSnapshot(client);

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
        // Cumulative process-wide typo-dictionary cache counters as of the
        // end of this query block (null on shims without metrics_snapshot).
        typo_dict_cache: metricsSnap?.typo_dict_cache ?? null,
      });
      const r = results[results.length - 1];
      console.log(`[jd-bench] ${system} ${jd.id}: R@10=${pct(r.recall_at_10.capped)} `
        + `R@100=${pct(r.recall_at_100.capped)} P@10=${pct(r.precision_at_10)} `
        + `NDCG@10=${pct(r.ndcg_at_10)} p50=${r.latency_ms.p50}ms p95=${r.latency_ms.p95}ms `
        + `cold=${r.latency_ms.cold_ms}ms`);
      console.log(`[jd-bench] ${system} ${jd.id}: ${typoCacheLine(metricsSnap)}`);
    }
  }
  return results;
}

/**
 * --real-pdf query path: the SAME `terransoul --ask` command Desktop chat
 * and the default CLI use — no custom IPC-shim `op: 'search'`/`op: 'rrf'`
 * calls, matching JD-CLI-3's own mandate ("no custom JS parsing, no direct
 * retrieval calls"). One call per JD, `--mode max --json`, since Max is what
 * this demo asks for; unlike `runQueries()`'s 5-repeat p50/p95 methodology
 * (built for the 1M-scale accuracy benchmark), a single call per JD matches
 * what the live demo actually measures — Max's own latency is already the
 * interesting number, not statistical noise around it.
 *
 * `--ask --json` returns `context_memory_ids` (memory row ids), not résumé
 * ids — real ingest via `--ingest` has no `session_id`-tracking the way the
 * JSONL-shim ingest path does. Recovers résumé identity from each memory's
 * own `source_url` column (`.../resume-0000502.pdf` -> `res-502`), which
 * `DocParser`-backed ingest always sets — reading the store directly rather
 * than adding a new IPC op for something already on disk.
 */
async function runQueriesViaAsk({ storeDir, gold }) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(resolve(storeDir, 'memory.db'), { readonly: true, fileMustExist: true });
  const idToResume = new Map();
  for (const row of db.prepare(
    "SELECT id, source_url FROM memories WHERE source_url LIKE '%resume-%.pdf%'",
  ).all()) {
    const match = row.source_url.match(/resume-0*(\d+)\.pdf/);
    if (match) idToResume.set(row.id, `res-${Number(match[1])}`);
  }
  db.close();
  console.log(`[jd-bench] --real-pdf: resolved ${idToResume.size} memory ids -> resume ids from source_url`);

  const results = [];
  for (const jd of JD_QUERIES) {
    const goldIds = new Set(gold.gold[jd.id] ?? []);
    const t0 = performance.now();
    const output = await new Promise((resolvePromise, reject) => {
      const child = spawn(TERRANSOUL_CONSOLE_EXE, ['--ask', jd.queryText, '--mode', 'max', '--json'], {
        env: { ...process.env, TERRANSOUL_HEADLESS_DATA_DIR: storeDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('error', reject);
      child.on('close', code => (code === 0 ? resolvePromise(stdout) : reject(
        new Error(`terransoul --ask exited ${code}\n${stderr.slice(-2000)}`),
      )));
    });
    const latencyMs = performance.now() - t0;
    const parsed = JSON.parse(output.trim().split('\n').pop()); // last line — stderr turn-trace can precede it
    const retrieved = (parsed.context_memory_ids ?? [])
      .map(id => idToResume.get(id))
      .filter(Boolean);

    const r10 = recallAtK(retrieved, goldIds, 10);
    results.push({
      system: 'max-ask',
      jd_id: jd.id,
      jd_lang: jd.lang,
      jd_title: jd.title,
      gold_size: goldIds.size,
      runs: 1,
      latency_ms: { p50: Number(latencyMs.toFixed(2)), p95: Number(latencyMs.toFixed(2)), all: [Number(latencyMs.toFixed(2))], cold_ms: Number(latencyMs.toFixed(2)) },
      recall_at_10: { capped: r10.capped, raw: r10.raw, hits: r10.hits },
      precision_at_10: precisionAtK(retrieved, goldIds, 10),
      ndcg_at_10: ndcgAtK(retrieved, goldIds, 10),
      retrieved_top_20: retrieved.slice(0, 20),
      answer: parsed.content,
      typo_dict_cache: null,
    });
    const r = results[results.length - 1];
    console.log(`[jd-bench] --real-pdf max-ask ${jd.id}: R@10=${pct(r.recall_at_10.capped)} `
      + `P@10=${pct(r.precision_at_10)} NDCG@10=${pct(r.ndcg_at_10)} latency=${latencyMs.toFixed(0)}ms`);
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
  const anyTypoCounters = report.metrics?.after_ingest?.typo_dict_cache
    || report.results.some(r => r.typo_dict_cache);
  if (anyTypoCounters) {
    w('## Typo-dictionary cache counters (TYPESENSE-ADAPT-6-CACHE-SCALE-GAP-1)');
    w('');
    w('Cumulative process-wide values snapshotted after each query block');
    w('(diff consecutive rows for per-query deltas). `after ingest` is the');
    w('pre-query baseline.');
    w('');
    w('| Phase | Hits | Miss cold | Miss mutations | Miss data_version | Hit rate | Rebuilds (p50 ms) | Expansions (p50 ms) |');
    w('|---|---:|---:|---:|---:|---:|---:|---:|');
    const typoRow = (label, c) => {
      if (!c) return `| ${label} | — | — | — | — | — | — | — |`;
      const rate = c.hit_rate == null ? 'n/a' : pct(c.hit_rate);
      return `| ${label} | ${c.hits} | ${c.misses_cold} | ${c.misses_mutations_changed} `
        + `| ${c.misses_data_version_changed} | ${rate} `
        + `| ${c.rebuild.count} (${c.rebuild.p50_ms ?? '—'}) `
        + `| ${c.expansion.count} (${c.expansion.p50_ms ?? '—'}) |`;
    };
    w(typoRow('after ingest', report.metrics?.after_ingest?.typo_dict_cache));
    for (const row of report.results) {
      w(typoRow(`${row.system} ${row.jd_id}`, row.typo_dict_cache));
    }
    w('');
  }
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
  w('  store\'s `count` (an internal work item resume pattern).');
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
  const { count, seed, corpusDir, outDir, systems, topK, resume, hybridWeights, realPdf } = options;
  if (realPdf && (count !== REAL_PDF_CORPUS_SIZE || resume)) {
    throw new Error(
      `--real-pdf only supports --count ${REAL_PDF_CORPUS_SIZE} without --resume today ` +
        `(the on-disk corpus at ${REAL_PDF_CORPUS_DIR} has exactly ${REAL_PDF_CORPUS_SIZE} files, ` +
        'and the CLI --ingest path is not sliceable/resumable the way the JSONL shim is). ' +
        'Drop --real-pdf to use the JSONL-shim path at any count, or set JD_REAL_PDF_CORPUS to a ' +
        'differently-sized corpus and adjust --count to match.',
    );
  }
  await prepare({ count, seed, corpusDir });
  const resumesPath = resolve(corpusDir, 'resumes.jsonl');
  const gold = JSON.parse(readFileSync(resolve(corpusDir, 'gold.json'), 'utf8'));

  // The shim persists rows when LONGMEM_DATA_DIR points at an on-disk
  // store; its `reset` op reopens the SAME directory, so a clean run must
  // delete the store dir BEFORE spawning cargo. `--resume` keeps it
  // (an internal work item: corpus row N is deterministic, so the tail can be
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

  // --real-pdf: ingest BEFORE the shim ever opens the store, via a
  // completely separate process (`terransoul --ingest`) — not through the
  // JsonlClient/longmemeval-ipc `add_sessions*` ops at all. The shim's own
  // `reset` op below then just (re)opens the directory this already
  // populated, exactly as it does for a normal `--resume` run picking up
  // rows a previous process wrote.
  const realPdfIngestStats = realPdf ? await ingestRealPdf({ storeDir }) : null;

  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  process.on('SIGINT', () => {
    console.error('[jd-bench] SIGINT — shutting down IPC');
    client.close().finally(() => process.exit(130));
  });

  let report;
  try {
    let startIndex = 0;
    if (resume) {
      // an internal work item resume pattern: the shim's `count` op returns the
      // number of rows already in the `memories` table; because corpus
      // row N is deterministic, that count IS the offset into the corpus.
      const data = await client.send({ op: 'count' });
      startIndex = Math.min(Number(data.count) || 0, count);
      console.log(`[jd-bench] resume: store already holds ${startIndex.toLocaleString('en-US')} rows`);
    } else {
      // `reset` just (re)opens LONGMEM_DATA_DIR — for --real-pdf that
      // directory already holds the rows `ingestRealPdf` just wrote, so
      // this makes the shim recognize them rather than wiping them.
      await client.send({ op: 'reset' });
    }

    const ingestStats = realPdfIngestStats ?? (startIndex >= count
      ? { rows: 0, elapsedSeconds: 0, rowsPerSecond: 0, checkpoints: [], path: 'skipped (resume complete)' }
      : await ingest(client, { resumesPath, startIndex, count, questionId: 'jd-million' }));

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

    // MEMORY-CFG-an internal work item mechanism: persist HybridWeights on the store's
    // Cell before the query phase. Order: vector, keyword, recency,
    // importance, decay, tier_priority. Affects the `hybrid` system only
    // (rrf's fusion is rank-based and does not read HybridWeights).
    if (hybridWeights) {
      await client.send({ op: 'set_hybrid_weights', weights: hybridWeights });
      console.log(`[jd-bench] set_hybrid_weights ${JSON.stringify(hybridWeights)}`);
    }

    // TYPESENSE-ADAPT-6-CACHE-SCALE-GAP-1: baseline counter snapshot after
    // ingest / before the query phase, so the first query row's delta is
    // attributable to queries alone (ingest can bump mutation counters).
    const metricsAfterIngest = await fetchMetricsSnapshot(client);
    if (metricsAfterIngest) {
      console.log(`[jd-bench] after-ingest ${typoCacheLine(metricsAfterIngest)}`);
    }

    const results = realPdf
      ? await runQueriesViaAsk({ storeDir, gold })
      : await runQueries(client, { systems, topK, gold });

    const metricsFinal = await fetchMetricsSnapshot(client);

    report = {
      benchmark: 'MILLION-RESUME-BENCH',
      generated_at: new Date().toISOString(),
      config: {
        count,
        seed,
        systems,
        top_k: topK,
        resume,
        real_pdf: realPdf,
        query_runs: QUERY_RUNS,
        corpus_dir: realPdf ? REAL_PDF_CORPUS_DIR : corpusDir,
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
      // Full MetricsSnapshot at the phase boundaries (null on shims without
      // the metrics_snapshot op). Per-query cumulative typo_dict_cache
      // values live on each results[] row.
      metrics: {
        after_ingest: metricsAfterIngest,
        final: metricsFinal,
      },
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
  // BENCH-GUARD-SWEEP-1: this harness gates its dense channel on
  // LONGMEM_EMBED, so a CPU-pinned embedder silently costs it hours.
  // The guard is shared, not copied -- see lib/bench-preflight.mjs.
  runBenchPreflight({
    repoRoot: REPO_ROOT,
    outDir: process.cwd(),
    label: 'jd-million',
    skip: process.argv.includes('--skip-preflight'),
    allowCpuEmbedder: process.argv.includes('--allow-cpu-embedder'),
  });
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
    realPdf: hasFlag('real-pdf'),
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
  console.log(`[jd-bench] run count=${count.toLocaleString('en-US')} systems=${systems.join(',')} top_k=${options.topK} resume=${options.resume} real_pdf=${options.realPdf}`);
  await run(options);
}

main().catch(err => {
  console.error(`[jd-bench] failed: ${err.message}`);
  process.exit(1);
});
