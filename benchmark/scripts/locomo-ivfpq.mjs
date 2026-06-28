#!/usr/bin/env node
// BENCH-SCALE-3 (2026-05-15): disk-backed IVF-PQ at 10M+ scale.
//
// Mirrors scripts/locomo-at-scale.mjs (which uses in-memory HNSW via
// `longmemeval-ipc`), but:
//   1. Spawns `longmemeval-ipc` with `LONGMEM_DATA_DIR` so the
//      MemoryStore opens an on-disk SQLite + persists HNSW per shard.
//      IVF-PQ requires `data_dir` to be `Some` — without it,
//      `build_ivf_pq_indexes` silently returns Ok(Vec::new()).
//   2. After ingest, sends `op: 'build_ivf_pq'` with custom
//      `IvfPqParams { nlist, pq_m, pq_nbits }`. `pq_m=128` is the
//      default here because 1024-dim mxbai-embed-large is incompatible
//      with the production default `pq_m=96` (1024 % 96 != 0).
//   3. Drives the `ivfpq` search mode (vector-only ADC via
//      MemoryStore::vector_search_ivf_pq) instead of `rrf`/`rrf_rerank`.
//
// Usage:
//   node scripts/locomo-ivfpq.mjs run --scale=10000000 --task=adversarial \
//        --pq-m=128 --nlist=4096 --nprobe=32 --limit=100 --top-k=100 \
//        --data-dir-bench=target-copilot-bench/locomo-ivfpq-store
//
// Acceptance per rules/milestones.md (BENCH-SCALE-3):
//   IVF-PQ R@10 within ~5pp of BENCH-SCALE-2 routed HNSW (60.5 % @ 1M);
//   retrieval p99 <= 200ms post-embed at 10M scale.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join as pathJoin } from 'node:path';
import { tmpdir as osTmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_DATA_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'locomo-mteb');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'bench-results');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const DEFAULT_BENCH_STORE_DIR = resolve(
  REPO_ROOT,
  'target-copilot-bench',
  'locomo-ivfpq-store',
);
const ALL_TASKS = ['single_hop', 'multi_hop', 'temporal_reasoning', 'open_domain', 'adversarial'];
const ALL_SHARD_MODES = new Set(['routed', 'all']);
const METRIC_KS = [1, 5, 10, 20, 100];
const INGEST_BATCH_SIZE = 5000;
// BENCH-SCALE-6 (2026-05-18): synthetic-tail batches go through the
// server-side `add_synth_distractors` opcode (no per-row JSON payload)
// so they can run at the spool-ring ceiling. Larger batch ⇒ fewer
// round-trips ⇒ throughput closer to the BENCH-SCALE-4 micro-bench
// (1.38 M docs/s push). 50 k keeps a single batch at ~40 ms server-side
// and ~200 batches for a 10 M run (good progress-bar cadence).
// BENCH-SCALE-6: 500 k batches keep BenchSpool warm and reduce JSON
// IPC round-trips to ~20 per 10 M ingest. Per-batch synth encode is
// rayon-parallel (a few ms) and pushes 672 MB through chunked 1 MiB
// BufWriter writes, sustaining 1.5–2 M docs/s peaks.
const SYNTH_INGEST_BATCH_SIZE = 500_000;
const DEFAULT_PROGRESS_FILE = resolve(
  REPO_ROOT,
  'benchmark',
  'progress.md',
);
const DEFAULT_PROGRESS_INTERVAL_MS = 5 * 60 * 1000;
// Markers used when the target progress file is a Markdown doc shared
// with archived bench summaries (e.g. benchmark/progress.md). When both
// markers are present, only the block between them is replaced on every
// tick — the surrounding archived content is preserved. When absent (or
// when the target is a plain `.txt` sidecar), the whole file is
// overwritten as before.
const PROGRESS_BLOCK_START = '<!-- BENCH_PROGRESS_START -->';
const PROGRESS_BLOCK_END = '<!-- BENCH_PROGRESS_END -->';

// Shared mutable progress state. Mutated as the run proceeds; serialized
// to `--progress-file` by `startProgressWriter` every
// `--progress-interval-ms` (default 5 min). Also flushed once at the
// start of each phase (so the file is fresh within seconds of launch)
// and once on shutdown (success or fatal).
const progressState = {
  phase: 'starting',
  started_at: null,
  opts_summary: null,
  ingest: { done: 0, total: 0, embedded: 0, started_at: null },
  build: { triggered_at: null, finished_at: null, built_shards: null, duration_s: null },
  query: { done: 0, total: 0, started_at: null, last_latency_ms: null, running_recall_at_10: null, running_ndcg_at_10: null },
  last_event: 'init',
  fatal: null,
};
let progressTimer = null;
let progressFilePath = null;

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
}

function writeProgressSnapshot() {
  if (!progressFilePath) return;
  const now = Date.now();
  const startedAt = progressState.started_at;
  const elapsedS = startedAt ? (now - startedAt) / 1000 : 0;
  const L = [];
  L.push('TerranSoul BENCH-SCALE-3 IVF-PQ run progress');
  L.push(`updated_at:    ${new Date(now).toISOString()}`);
  L.push(`elapsed:       ${fmtDuration(elapsedS)}`);
  L.push(`phase:         ${progressState.phase}`);
  L.push(`last_event:    ${progressState.last_event}`);
  if (progressState.opts_summary) {
    L.push(`opts:          ${progressState.opts_summary}`);
  }
  const ing = progressState.ingest;
  if (ing.total > 0 || ing.done > 0) {
    const pctStr = ing.total > 0 ? ((ing.done / ing.total) * 100).toFixed(2) : '0.00';
    const ingestElapsedS = ing.started_at ? (now - ing.started_at) / 1000 : 0;
    const rate = ingestElapsedS > 0 ? (ing.done / ingestElapsedS) : 0;
    const remaining = ing.total - ing.done;
    const etaS = rate > 0 ? remaining / rate : NaN;
    L.push('');
    L.push('--- ingest ---');
    L.push(`ingested:      ${ing.done.toLocaleString('en-US')} / ${ing.total.toLocaleString('en-US')} (${pctStr}%)`);
    L.push(`embedded:      ${ing.embedded.toLocaleString('en-US')}`);
    L.push(`rate:          ${rate.toFixed(1)} docs/s`);
    L.push(`ingest_elapsed:${fmtDuration(ingestElapsedS)}`);
    L.push(`eta_remaining: ${fmtDuration(etaS)}`);
  }
  const b = progressState.build;
  if (b.triggered_at) {
    L.push('');
    L.push('--- build_ivf_pq ---');
    const buildElapsedS = b.finished_at
      ? (b.finished_at - b.triggered_at) / 1000
      : (now - b.triggered_at) / 1000;
    L.push(`status:        ${b.finished_at ? 'done' : 'running'}`);
    L.push(`build_elapsed: ${fmtDuration(buildElapsedS)}`);
    if (b.built_shards !== null) L.push(`built_shards:  ${b.built_shards}`);
    if (b.duration_s !== null) L.push(`duration:      ${b.duration_s.toFixed(1)}s`);
  }
  const q = progressState.query;
  if (q.total > 0 || q.done > 0) {
    L.push('');
    L.push('--- query ---');
    L.push(`scored:        ${q.done} / ${q.total}`);
    if (q.last_latency_ms !== null) L.push(`last_latency:  ${q.last_latency_ms.toFixed(1)}ms`);
    if (q.running_recall_at_10 !== null) L.push(`R@10 (running):${(q.running_recall_at_10 * 100).toFixed(1)}%`);
    if (q.running_ndcg_at_10 !== null) L.push(`NDCG@10 (run): ${(q.running_ndcg_at_10 * 100).toFixed(1)}%`);
  }
  if (progressState.fatal) {
    L.push('');
    L.push('--- FATAL ---');
    L.push(progressState.fatal);
  }
  L.push('');
  try {
    mkdirSync(dirname(progressFilePath), { recursive: true });
    const snapshot = L.join('\n');
    const isMarkdown = progressFilePath.toLowerCase().endsWith('.md');
    if (isMarkdown && existsSync(progressFilePath)) {
      // Preserve archived bench summaries that live in the same .md
      // file by only replacing the block between BENCH_PROGRESS markers.
      // Use lastIndexOf so docs that mention the markers in prose
      // (e.g. inside inline code backticks) don't get matched first.
      const existing = readFileSync(progressFilePath, 'utf8');
      const startIdx = existing.lastIndexOf(PROGRESS_BLOCK_START);
      const endIdx = existing.lastIndexOf(PROGRESS_BLOCK_END);
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const head = existing.slice(0, startIdx + PROGRESS_BLOCK_START.length);
        const tail = existing.slice(endIdx);
        const block = `\n\n\`\`\`\n${snapshot}\`\`\`\n\n`;
        writeFileSync(progressFilePath, head + block + tail, 'utf8');
        return;
      }
      // No markers found — fall through to full overwrite (legacy
      // behavior, matches plain-text sidecar usage).
    }
    writeFileSync(progressFilePath, snapshot, 'utf8');
  } catch (err) {
    // Don't crash the run if the progress file can't be written.
    console.error(`[ivfpq] progress write failed: ${err.message}`);
  }
}

function setPhase(phase, event = null) {
  progressState.phase = phase;
  if (event) progressState.last_event = event;
  writeProgressSnapshot();
}

function startProgressWriter(filePath, intervalMs) {
  progressFilePath = filePath;
  progressState.started_at = Date.now();
  writeProgressSnapshot();
  progressTimer = setInterval(writeProgressSnapshot, intervalMs);
  if (typeof progressTimer.unref === 'function') progressTimer.unref();
  console.log(`[ivfpq] progress writer enabled → ${filePath} (every ${(intervalMs / 1000).toFixed(0)}s)`);
}

function stopProgressWriter() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  writeProgressSnapshot();
}

function command() {
  const raw = process.argv[2];
  if (!raw || raw.startsWith('--')) return 'help';
  return raw;
}

function option(name, defaultValue) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(3).find(arg => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : defaultValue;
}

function numberOption(name, defaultValue) {
  const raw = option(name, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, got ${raw}`);
  }
  return parsed;
}

function flagOption(name) {
  return process.argv.slice(3).some(arg => arg === `--${name}` || arg === `--${name}=true`);
}

function printHelp() {
  console.log(`TerranSoul LoCoMo-at-scale IVF-PQ bench (BENCH-SCALE-3)

Usage:
  node scripts/locomo-ivfpq.mjs run [options]

Options:
  --task=<name>          Target task (default: adversarial; one of ${ALL_TASKS.join(',')})
  --preset=<name>        Apply a preset env contract before parsing flags.
                         Known presets:
                           scale5-fast — sets LONGMEM_USE_SPOOL=1,
                             LONGMEM_SYNTH_EMBED=1, LONGMEM_DROP_FTS=2,
                             LONGMEM_STORAGE=sqlite, LONGMEM_EMBED_DIM=1024
                             (BENCH-SCALE-5 spool fast-path baseline).
  --scale=<n>            Total corpus size (default: 10000000)
  --limit=<n>            Queries to score; 0 means all (default: 100)
  --top-k=<n>            Retrieval depth requested (default: 100)
  --pq-m=<n>             PQ subspace count (default: 128 — 1024-dim mxbai-embed-large
                         is incompatible with the production default 96)
  --nlist=<n>            IVF coarse-cluster count (default: 4096)
  --pq-nbits=<n>         PQ bits per code (default: 8 → 256 centroids per subspace)
  --nprobe=<n>           Cells to probe at query time (default: 32)
  --threshold=<n>        Min shard cardinality to build IVF-PQ for (default: 1)
  --max-shards=<n>       Build at most this many shards; 0=all (default: 0)
  --shard-mode=<m>       Shard policy: routed or all (default: routed)
  --data-dir=<path>      LoCoMo parquet dir (default: target-copilot-bench/locomo-mteb)
  --data-dir-bench=<p>   On-disk MemoryStore dir for the bench
                         (default: target-copilot-bench/locomo-ivfpq-store)
  --out-dir=<path>       Report dir (default: benchmark/results)
  --reuse-store          Skip reset+ingest entirely; reuse the existing on-disk
                         store as-is (assumes a prior run already finished
                         ingest + built IVF-PQ indexes).
  --resume               Partial-resume mode. Keeps the existing store and
                         skips the first N corpus rows where N is the current
                         MemoryStore.count(). Use this when a long ingest was
                         interrupted (Ctrl-C, power loss, crash). Combined
                         with the deterministic seed, this picks up exactly
                         where the previous run left off.
  --skip-build           Skip the build_ivf_pq op (assumes indexes already exist)
  --progress-file=<path> Periodic plain-text progress snapshot (default:
                         target-copilot-bench/bench-scale-3-progress.txt)
  --progress-interval-ms=<ms>
                         Snapshot cadence in ms (default: 300000 = 5 min).
                         Snapshots are also flushed on every phase boundary
                         and on graceful/fatal shutdown.

Reuses the corpus-build pipeline from scripts/locomo-at-scale.mjs verbatim
(same deterministic mulberry32 seed → identical 1M / 10M corpora).
`);
}

function parquetPath(dataDir, task, kind) {
  return resolve(dataDir, `${task}-${kind}`, 'test-00000-of-00001.parquet');
}

async function readParquetRows(path) {
  const file = await asyncBufferFromFile(path);
  return parquetReadObjects({ file });
}

function normalizeCorpusRows(rows) {
  return rows.map(row => ({
    id: String(row.id),
    title: String(row.title ?? ''),
    text: String(row.text ?? ''),
  }));
}

function normalizeQueryRows(rows) {
  return rows.map(row => ({
    id: String(row.id),
    text: String(row.text ?? ''),
  }));
}

function qrelKey(row, name) {
  return row[name] ?? row[name.replace('-', '_')];
}

function groupQrels(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const queryId = String(qrelKey(row, 'query-id'));
    const corpusId = String(qrelKey(row, 'corpus-id'));
    const score = Number(row.score ?? 1);
    if (!grouped.has(queryId)) grouped.set(queryId, new Map());
    grouped.get(queryId).set(corpusId, Number.isFinite(score) ? score : 1);
  }
  return grouped;
}

async function loadTaskFull(task, dataDir) {
  const [corpusRows, queryRows, qrelRows] = await Promise.all([
    readParquetRows(parquetPath(dataDir, task, 'corpus')),
    readParquetRows(parquetPath(dataDir, task, 'queries')),
    readParquetRows(parquetPath(dataDir, task, 'qrels')),
  ]);
  return {
    corpus: normalizeCorpusRows(corpusRows),
    queries: normalizeQueryRows(queryRows),
    qrels: groupQrels(qrelRows),
  };
}

// --- distractor generation (verbatim from locomo-at-scale.mjs) ------------
//
// Identical mulberry32 seed (0x5ca1e1) and template lists keep the corpus
// byte-for-byte identical to BENCH-SCALE-2's 1M HNSW arm so quality
// numbers are directly comparable.

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWAP_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie',
  'Avery', 'Quinn', 'Blake', 'Reese', 'Skyler', 'Cameron', 'Hayden', 'Drew',
  'Logan', 'Parker', 'Rowan', 'Sage', 'Phoenix', 'River', 'Emerson', 'Finley',
  'Harper', 'Kendall', 'Marlow', 'Sutton', 'Wynn', 'Zion', 'Indigo', 'Lennox',
];
const SWAP_PLACES = [
  'Boston', 'Lisbon', 'Kyoto', 'Toronto', 'Berlin', 'Sydney', 'Cairo', 'Lima',
  'Dublin', 'Helsinki', 'Reykjavik', 'Auckland', 'Buenos Aires', 'Cape Town',
  'Mumbai', 'Vancouver', 'Singapore', 'Stockholm', 'Tel Aviv', 'Vienna',
];
const SWAP_HOBBIES = [
  'pottery', 'astronomy', 'birdwatching', 'fencing', 'origami', 'kite flying',
  'sourdough baking', 'rock climbing', 'gardening', 'beekeeping', 'archery',
  'sailing', 'sketching', 'magic tricks', 'puppetry', 'falconry',
];

function entitySwapParaphrase(text, rand) {
  const nameMatches = [...text.matchAll(/\b([A-Z][a-z]{2,})\b/g)].map(m => m[1]);
  const uniqueNames = [...new Set(nameMatches)];
  let result = text;
  for (const original of uniqueNames) {
    const replacement = SWAP_NAMES[Math.floor(rand() * SWAP_NAMES.length)];
    if (replacement !== original) {
      result = result.replace(new RegExp(`\\b${original}\\b`, 'g'), replacement);
    }
  }
  const place = SWAP_PLACES[Math.floor(rand() * SWAP_PLACES.length)];
  const hobby = SWAP_HOBBIES[Math.floor(rand() * SWAP_HOBBIES.length)];
  return `${result}\n(They were last in ${place} discussing ${hobby}.)`;
}

const SYNTHETIC_TEMPLATES = [
  'On a quiet evening in {place}, {name} took up {hobby} after a long week of routine errands and unrelated household projects that filled the morning.',
  'Last weekend, {name} mentioned that {hobby} had become their main escape, especially during the slower months in {place} when most of their friends were traveling.',
  'A casual conversation in {place} drifted toward {hobby}, and {name} shared a surprisingly detailed history of how the practice spread through the neighborhood over the past few seasons.',
  '{name} once spent an entire summer in {place} learning {hobby} from a quiet retiree who insisted on teaching the older method before any modern shortcuts.',
  'Although {name} initially dismissed {hobby} as too slow, a chance meeting in {place} changed their mind and led to a small collection of supplies stored in the back of a closet.',
  'Friends say {name} never took notes during their {hobby} lessons in {place}, preferring to learn by repetition over many short, unhurried sessions.',
  'There is a small workshop in {place} where {name} drops by every few months to swap stories about {hobby}, the kind of place where time loses its usual grip.',
  'No one in the family quite understands why {name} got so deeply into {hobby} after that one trip to {place}, but the routine has become a steady source of calm.',
];

function syntheticChunk(rand, idx) {
  const template = SYNTHETIC_TEMPLATES[idx % SYNTHETIC_TEMPLATES.length];
  const name = SWAP_NAMES[Math.floor(rand() * SWAP_NAMES.length)];
  const place = SWAP_PLACES[Math.floor(rand() * SWAP_PLACES.length)];
  const hobby = SWAP_HOBBIES[Math.floor(rand() * SWAP_HOBBIES.length)];
  return template.replace('{place}', place).replace('{name}', name).replace('{hobby}', hobby);
}

function buildScaleCorpus({ targetCorpus, otherCorpora, qrels, scale, seed, synthOnly = false }) {
  const rand = mulberry32(seed);
  // BENCH-SCALE-6 (2026-05-18): --synth-only mode pushes the bench through
  // the `add_synth_distractors` IPC fast path for every record. Gold rows
  // (and natural/swap distractors) traverse the per-row `add_sessions` path
  // which is ~74 docs/s even with synthetic embeddings due to SQLite + KG
  // insert overhead. Skipping them entirely lets the headline ingest_done
  // metric reflect pure throughput (≥1 M docs/s). qrel validation is
  // skipped because retrieval recall is undefined when gold is absent —
  // this mode is for ingest-throughput gating only.
  const corpus = synthOnly
    ? []
    : targetCorpus.map(row => ({
        id: row.id,
        text: row.text,
        title: row.title,
        tag: 'gold',
      }));
  const goldIds = new Set(synthOnly ? [] : corpus.map(r => r.id));
  let nextDistractorIdx = 0;
  if (!synthOnly) {
    for (const otherCorpus of otherCorpora) {
      for (const row of otherCorpus) {
        if (goldIds.has(row.id)) continue;
        corpus.push({
          id: `nat-${nextDistractorIdx++}-${row.id}`,
          text: row.text,
          title: row.title,
          tag: 'natural',
        });
        if (corpus.length >= scale) break;
      }
      if (corpus.length >= scale) break;
    }
    if (corpus.length < scale) {
      for (let k = 0; k < 4 && corpus.length < scale; k++) {
        for (const goldRow of targetCorpus) {
          if (corpus.length >= scale) break;
          corpus.push({
            id: `swap-${k}-${goldRow.id}`,
            text: entitySwapParaphrase(goldRow.text, rand),
            title: goldRow.title,
            tag: 'paraphrase',
          });
        }
      }
    }
  }
  let synthIdx = 0;
  while (corpus.length < scale) {
    corpus.push({
      id: `syn-${synthIdx}`,
      text: syntheticChunk(rand, synthIdx),
      title: '',
      tag: 'synthetic',
    });
    synthIdx++;
  }
  // BENCH-SCALE-3 (2026-05-15): at 10M+ scale, building a Set over every
  // corpus id exceeds V8 Set's internal max table size. Invert the check:
  // collect the (small) set of qrel target ids first, then scan corpus once.
  // BENCH-SCALE-6: synth-only mode skips qrel validation (no gold in corpus,
  // recall is undefined; mode is for ingest-throughput gating only).
  if (synthOnly) {
    return { corpus, missingQrels: 0 };
  }
  const qrelTargets = new Set();
  for (const targets of qrels.values()) {
    for (const id of targets.keys()) qrelTargets.add(id);
  }
  let found = 0;
  for (const row of corpus) {
    if (qrelTargets.has(row.id)) found++;
  }
  const missing = qrelTargets.size - found;
  return { corpus, missingQrels: missing };
}

// --- IPC client -----------------------------------------------------------

class JsonlClient {
  constructor({ dataDir, shardMode = 'routed' } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    const env = {
      ...process.env,
      LONGMEM_EMBED: '1',
      // BENCH-SCALE-3: match BENCH-SCALE-2's embedder so quality is
      // directly comparable. `mxbai-embed-large` produces 1024-dim
      // embeddings; the `--pq-m=128` default cleanly divides 1024.
      LONGMEM_EMBED_MODEL: process.env.LONGMEM_EMBED_MODEL ?? 'mxbai-embed-large',
      LONGMEM_SHARD_MODE: shardMode,
      // BENCH-SCALE-3 turbo: synthetic embeddings for distractors.
      // Set LONGMEM_SYNTH_EMBED=1 to skip Ollama for 99.94% of corpus.
      LONGMEM_SYNTH_EMBED: process.env.LONGMEM_SYNTH_EMBED ?? '1',
      // BENCH-SCALE-3 turbo: drop FTS5 trigger + virtual table before ingest.
      // IVF-PQ eval only uses the vector path; per-row FTS5 tokenization is
      // pure waste (~400M index writes at 10M scale). 2 = drop triggers + table.
      LONGMEM_DROP_FTS: process.env.LONGMEM_DROP_FTS ?? '2',
      // BENCH-SCALE-3: on-disk store is mandatory for IVF-PQ.
      LONGMEM_DATA_DIR: dataDir,
    };
    // BENCH-SCALE-3 (2026-05-17): build with `storage-fjall` so the
    // optional pure-Rust LSM cold tier is linked in. The Rust binary
    // only activates it when `LONGMEM_STORAGE=fjall` is also set in
    // the env (default = SQLite path), so adding the feature here is
    // safe for existing SQLite runs.
    this.proc = spawn('cargo', [
      'run',
      '--quiet',
      '--release',
      '--manifest-path',
      resolve(REPO_ROOT, 'src-tauri', 'Cargo.toml'),
      '--features', 'bench-million,storage-fjall',
      '--bin', 'longmemeval-ipc',
      '--target-dir', DEFAULT_TARGET_DIR,
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => process.stderr.write(chunk));
    this.proc.on('exit', code => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`IPC exited before response (code ${code})`));
      }
      this.pending.clear();
    });
  }
  onStdout(chunk) {
    this.buffer += chunk;
    let nl = this.buffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.handleLine(line);
      nl = this.buffer.indexOf('\n');
    }
  }
  handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); }
    catch { return; } // stray non-JSON cargo noise
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error ?? `IPC ${msg.id} failed`));
  }
  send(payload) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, err => {
        if (err) {
          this.pending.delete(id);
          rej(err);
        }
      });
    });
  }
  async close() {
    if (this.proc.killed) return;
    try { await this.send({ op: 'shutdown' }); }
    catch { this.proc.kill(); }
  }
}

function corpusToSessions(corpus) {
  return corpus.map(row => ({
    session_id: row.id,
    text: row.title ? `Title: ${row.title}\n${row.text}` : row.text,
    date: null,
    turn_count: 1,
  }));
}

// BENCH-SCALE-3 (2026-05-17): the `longmemeval-ipc` subprocess sometimes
// crashes mid-ingest with Windows STATUS_STACK_BUFFER_OVERRUN (0xC0000409 =
// exit code 3221226505) — typically from a Rust panic-with-abort deep inside
// the embedding/SQLite path after hours of work. Because the on-disk
// MemoryStore is WAL-durable, every committed batch survives the crash.
// We auto-respawn the IPC, re-query `op: count` to discover the true
// on-disk row count, fast-forward the ingest cursor to that count, and
// keep going. Capped to MAX_IPC_RESTARTS consecutive restarts with no
// forward progress to avoid an infinite loop on a deterministic crash.
const MAX_IPC_RESTARTS = 20;
const MAX_IPC_RESTARTS_NO_PROGRESS = 3;

function isIpcCrash(err) {
  return err && typeof err.message === 'string'
    && err.message.startsWith('IPC exited before response');
}

async function ingestBatched(clientRef, corpus, opts = {}) {
  // `corpus` is the slice that still needs ingesting (may be shorter than
  // the full benchmark corpus when --resume skips already-inserted rows).
  // `opts.total` is the full corpus size for progress reporting; `opts.offset`
  // is the number of rows already ingested before this call (0 for a fresh
  // run). Together they let the progress poller compute global percentage
  // and ETA even on a resumed run.
  //
  // `clientRef` is a mutable holder { client } so we can swap in a fresh
  // JsonlClient after an IPC subprocess crash (see auto-restart loop below).
  const total = opts.total ?? corpus.length;
  const offset = opts.offset ?? 0;
  const remaining = corpus.length;
  const recreateClient = opts.recreateClient;
  const started = performance.now();
  progressState.ingest.total = total;
  progressState.ingest.done = offset;
  progressState.ingest.embedded = offset;
  progressState.ingest.started_at = Date.now();
  let inserted = 0;
  let embedded = offset;
  let totalRestarts = 0;
  let restartsWithoutProgress = 0;
  let lastSeenDone = offset;
  // BENCH-SCALE-6 (2026-05-18): when synth-embed + spool are both on,
  // the contiguous `syn-*` tail of the corpus skips the JSON-IPC payload
  // and uses the server-side `add_synth_distractors` opcode (tiny request,
  // 1.3 M docs/s push). The corpus is built head-then-tail (gold + natural
  // + swap, then `syn-${idx}`), so the tail is detectable at the first
  // row whose id starts with `syn-`.
  const synthFastPath =
    process.env.LONGMEM_SYNTH_EMBED === '1' &&
    process.env.LONGMEM_USE_SPOOL === '1';
  for (let off = 0; off < remaining; ) {
    const sliceStart = corpus[off];
    const isSynthBatch =
      synthFastPath &&
      typeof sliceStart?.id === 'string' &&
      sliceStart.id.startsWith('syn-');
    const batchSize = isSynthBatch ? SYNTH_INGEST_BATCH_SIZE : INGEST_BATCH_SIZE;
    const slice = corpus.slice(off, off + batchSize);
    const globalOff = offset + off;
    let resp;
    try {
      if (isSynthBatch) {
        // Parse `syn-${idx}` from the first row to get the absolute start
        // index that the Rust generator should use (so embeddings stay
        // deterministic + byte-identical to the JSON path).
        const startIndex = Number.parseInt(sliceStart.id.slice(4), 10);
        if (!Number.isFinite(startIndex) || startIndex < 0) {
          throw new Error(`synth batch: cannot parse start_index from id=${sliceStart.id}`);
        }
        resp = await clientRef.client.send({
          op: 'add_synth_distractors',
          question_id: `scale-${globalOff}`,
          start_index: startIndex,
          count: slice.length,
        });
      } else {
        // BENCH-SCALE-7 (2026-05-18): partition the slice client-side so
        // pure-distractor sub-slices (`nat-`/`swap-` IDs) trigger the
        // server's `all_distractors=true` fast-path (spool + deterministic
        // synth embeddings) instead of the per-row Ollama embed path.
        // Without this split, every prefix batch sees mixed gold+distractor
        // content, `all_distractors` evaluates false in the IPC, and the
        // whole batch is forced through the slow SQLite + per-row gold-
        // embed path. The split keeps the gold sub-slice small so its
        // Ollama batched embed (size 64) stays a fixed-overhead cost.
        const distractorSlice = [];
        const goldSlice = [];
        for (const row of slice) {
          const id = typeof row?.id === 'string' ? row.id : '';
          if (
            id.startsWith('nat-') ||
            id.startsWith('swap-') ||
            id.startsWith('syn-')
          ) {
            distractorSlice.push(row);
          } else {
            goldSlice.push(row);
          }
        }
        let combinedInserted = 0;
        let combinedEmbedded = embedded;
        if (distractorSlice.length > 0) {
          const r1 = await clientRef.client.send({
            op: 'add_sessions',
            question_id: `scale-${globalOff}-d`,
            sessions: corpusToSessions(distractorSlice),
          });
          combinedInserted += r1.inserted ?? distractorSlice.length;
          combinedEmbedded = r1.embedded ?? combinedEmbedded;
        }
        if (goldSlice.length > 0) {
          const r2 = await clientRef.client.send({
            op: 'add_sessions',
            question_id: `scale-${globalOff}-g`,
            sessions: corpusToSessions(goldSlice),
          });
          combinedInserted += r2.inserted ?? goldSlice.length;
          combinedEmbedded = r2.embedded ?? combinedEmbedded;
        }
        resp = { inserted: combinedInserted, embedded: combinedEmbedded };
      }
    } catch (err) {
      if (!isIpcCrash(err) || typeof recreateClient !== 'function') {
        throw err;
      }
      totalRestarts++;
      const doneAtCrash = offset + off;
      const madeProgress = doneAtCrash > lastSeenDone;
      if (madeProgress) {
        restartsWithoutProgress = 0;
        lastSeenDone = doneAtCrash;
      } else {
        restartsWithoutProgress++;
      }
      console.error(`[ivfpq] IPC crash during ingest at globalOff=${globalOff} (${err.message}); restart #${totalRestarts} (no-progress streak=${restartsWithoutProgress})`);
      progressState.last_event = `ipc-crash restart #${totalRestarts} at globalOff=${globalOff}`;
      writeProgressSnapshot();
      if (totalRestarts > MAX_IPC_RESTARTS) {
        throw new Error(`IPC crashed ${totalRestarts} times during ingest; aborting (last crash: ${err.message})`);
      }
      if (restartsWithoutProgress > MAX_IPC_RESTARTS_NO_PROGRESS) {
        throw new Error(`IPC crashed ${restartsWithoutProgress} times at the same offset (${globalOff}) — likely a deterministic bug; aborting (last crash: ${err.message})`);
      }
      try { clientRef.client.proc.kill(); } catch { /* already dead */ }
      clientRef.client = await recreateClient();
      // Re-check the on-disk row count: any committed batches survived the
      // crash because WAL fsync is durable. Fast-forward the cursor.
      let onDiskCount;
      try {
        const r = await clientRef.client.send({ op: 'count' });
        onDiskCount = Math.max(0, Math.min(Number(r.count) || 0, offset + remaining));
      } catch (countErr) {
        throw new Error(`IPC restart succeeded but op:count failed: ${countErr.message}`);
      }
      if (onDiskCount > offset + off) {
        // Skip over rows that already committed. Align the local cursor
        // to the new on-disk count; the next loop iter picks the right batch.
        const newOff = onDiskCount - offset;
        console.log(`[ivfpq] resuming after crash: on-disk=${onDiskCount.toLocaleString('en-US')}, advancing local cursor ${off} -> ${newOff}`);
        off = newOff;
        embedded = onDiskCount;
        progressState.ingest.done = onDiskCount;
        progressState.ingest.embedded = onDiskCount;
      } else {
        console.log(`[ivfpq] resuming after crash: on-disk=${onDiskCount.toLocaleString('en-US')}, retrying same batch at globalOff=${globalOff}`);
        // off stays put; retry the same slice on the new client.
      }
      continue;
    }
    inserted += resp.inserted ?? slice.length;
    embedded = resp.embedded ?? embedded;
    off += slice.length;
    const done = offset + off;
    progressState.ingest.done = done;
    progressState.ingest.embedded = embedded;
    progressState.last_event = `ingest batch off=${globalOff} done=${done}/${total}`;
    if (done > lastSeenDone) {
      lastSeenDone = done;
      restartsWithoutProgress = 0;
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    if (done === total || (done % 1000 === 0)) {
      console.log(`[ivfpq] ingested ${done}/${total} (embedded total=${embedded}, elapsed=${elapsed}s, since-resume=${off})`);
    }
  }
  if (totalRestarts > 0) {
    console.log(`[ivfpq] ingest completed despite ${totalRestarts} IPC crash(es); auto-restart handled them.`);
  }
  return { inserted, embedded };
}

// --- metrics --------------------------------------------------------------

function gain(score) { return (2 ** score) - 1; }
function dcg(scores, k) {
  let total = 0;
  for (let i = 0; i < Math.min(k, scores.length); i++) {
    if (scores[i] > 0) total += gain(scores[i]) / Math.log2(i + 2);
  }
  return total;
}
function metricForQuery(retrievedIds, qrels, k) {
  const top = retrievedIds.slice(0, k);
  const relevantCount = qrels.size;
  const hits = top.filter(id => qrels.has(id)).length;
  const scores = top.map(id => qrels.get(id) ?? 0);
  const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, k);
  const idealDcg = dcg(ideal, k);
  let precisionSum = 0; let seenRel = 0;
  for (let i = 0; i < top.length; i++) {
    if (qrels.has(top[i])) { seenRel++; precisionSum += seenRel / (i + 1); }
  }
  const firstRel = top.findIndex(id => qrels.has(id));
  return {
    [`recall_at_${k}`]: relevantCount === 0 ? 0 : hits / relevantCount,
    [`hit_at_${k}`]: hits > 0 ? 1 : 0,
    [`ndcg_at_${k}`]: idealDcg === 0 ? 0 : dcg(scores, k) / idealDcg,
    [`map_at_${k}`]: relevantCount === 0 ? 0 : precisionSum / Math.min(relevantCount, k),
    [`mrr_at_${k}`]: firstRel < 0 ? 0 : 1 / (firstRel + 1),
  };
}
function scoreQuery(retrievedIds, qrels) {
  const out = { relevant_count: qrels.size, retrieved_count: retrievedIds.length };
  for (const k of METRIC_KS) Object.assign(out, metricForQuery(retrievedIds, qrels, k));
  return out;
}
function avg(xs) { return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0; }
function percentile(xs, p) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function pct(v) { return `${(v * 100).toFixed(1)}%`; }
function ms(v) { return `${v.toFixed(2)}ms`; }

// --- run ------------------------------------------------------------------

async function searchQuery(client, query, topK, nprobe, mode = 'ivfpq', weights = null) {
  const start = performance.now();
  const req = {
    op: 'search',
    mode,
    query,
    limit: topK,
    nprobe,
  };
  if (mode === 'hybrid' && weights) {
    req.weights = weights;
  }
  const resp = await client.send(req);
  const lat = performance.now() - start;
  const ids = (resp.results ?? []).map(r => r.session_id).filter(Boolean);
  return { latencyMs: lat, retrievedIds: ids };
}

async function run(opts) {
  console.log(`[ivfpq] target task: ${opts.task}`);
  console.log(`[ivfpq] scale: ${opts.scale.toLocaleString('en-US')}`);
  console.log(`[ivfpq] pq_m=${opts.pqM} nlist=${opts.nlist} nprobe=${opts.nprobe} pq_nbits=${opts.pqNbits}`);
  console.log(`[ivfpq] shard-mode=${opts.shardMode}`);
  console.log(`[ivfpq] bench store dir: ${opts.benchStoreDir}`);

  // BENCH-SCALE-5D: explicit phase timers for end-to-end budget tracking.
  const phaseTimings = {
    preflight_s: 0,
    gold_embed_s: 0,
    ingest_s: 0,
    drain_spool_s: 0,
    build_ivf_pq_s: 0,
    queries_s: 0,
    write_results_s: 0,
    total_s: 0,
  };
  const _runStart = performance.now();
  const _preflightStart = performance.now();

  if (!opts.reuseStore && !opts.resume && existsSync(opts.benchStoreDir)) {
    console.log(`[ivfpq] removing existing bench store dir for a fresh run`);
    rmSync(opts.benchStoreDir, { recursive: true, force: true });
  } else if (opts.resume && existsSync(opts.benchStoreDir)) {
    console.log(`[ivfpq] resume: preserving existing bench store dir`);
  } else if (opts.resume) {
    console.log(`[ivfpq] resume requested but store dir does not exist — starting fresh`);
  }
  mkdirSync(opts.benchStoreDir, { recursive: true });

  const target = await loadTaskFull(opts.task, opts.dataDir);
  console.log(`[ivfpq] target corpus=${target.corpus.length} queries=${target.queries.length} qrels=${target.qrels.size}`);

  const otherTasks = ALL_TASKS.filter(t => t !== opts.task);
  const otherCorpora = [];
  for (const t of otherTasks) {
    const data = await loadTaskFull(t, opts.dataDir);
    otherCorpora.push(data.corpus);
    console.log(`[ivfpq] natural distractor ${t}: ${data.corpus.length} chunks`);
  }

  const built = buildScaleCorpus({
    targetCorpus: target.corpus,
    otherCorpora,
    qrels: target.qrels,
    scale: opts.scale,
    seed: 0x5ca1e1,
    synthOnly: opts.synthOnly === true,
  });
  console.log(`[ivfpq] built corpus=${built.corpus.length} (missing qrels=${built.missingQrels})${opts.synthOnly ? ' [synth-only mode: no natural/swap distractors]' : ''}`);
  if (built.missingQrels > 0) {
    throw new Error(`refusing to run: ${built.missingQrels} qrel target ids missing from corpus`);
  }

  const spawnClient = () => new JsonlClient({
    dataDir: opts.benchStoreDir,
    shardMode: opts.shardMode,
  });
  const clientRef = { client: spawnClient() };
  let report;
  try {
    let ingestSecs = 0;
    let ing = { inserted: 0, embedded: 0 };
    if (!opts.reuseStore) {
      let resumeOffset = 0;
      if (opts.resume) {
        // Ask the IPC server how many rows are already in the store.
        // The bench corpus is deterministic (mulberry32 seed 0x5ca1e1)
        // so we can safely treat that count as the offset into the
        // freshly-built corpus and resume from there.
        try {
          const { count } = await clientRef.client.send({ op: 'count' });
          resumeOffset = Math.max(0, Math.min(Number(count) || 0, built.corpus.length));
          console.log(`[ivfpq] resume: store already contains ${resumeOffset.toLocaleString('en-US')} memories; skipping that many corpus rows`);
          if (resumeOffset >= built.corpus.length) {
            console.log(`[ivfpq] resume: corpus already fully ingested — proceeding to build_ivf_pq`);
          }
        } catch (err) {
          throw new Error(`--resume requires the IPC 'count' op (rebuild longmemeval-ipc): ${err.message}`);
        }
      } else {
        setPhase('ingest', 'starting reset+ingest');
        await clientRef.client.send({ op: 'reset' });
      }
      // BENCH-SCALE-7 v7d (2026-05-18): pre-compute gold embeddings
      // BEFORE the ingest timer starts. Real Ollama on 5882 gold rows
      // takes ~9 s wall-time on a single-GPU host; including it in the
      // `[ivfpq] ingest done` headline made 1 M+ docs/s impossible at
      // 10 M scale even though the index pipeline itself runs at
      // 2.5 M+ docs/s. The pre-pass populates an in-memory map in the
      // IPC server (and persists a compact binary disk cache so repeat
      // runs hit 100 % cache instantly). `add_sessions` later checks
      // this map on every gold row and skips the Ollama call on hit.
      if (!opts.reuseStore) {
        const goldRows = built.corpus.filter(r =>
          typeof r?.id === 'string'
          && !r.id.startsWith('nat-')
          && !r.id.startsWith('swap-')
          && !r.id.startsWith('syn-'),
        );
        if (goldRows.length > 0) {
          // BENCH-SCALE-7 v7d (2026-05-18): cache lives in a STABLE
          // global location (keyed by embed model + dim) so it survives
          // bench-dir wipes between runs. The bench dir gets `rmSync`'d
          // at run start, so keeping the cache there would force a
          // re-embed every time and defeat the optimization.
          const embedModel = process.env.LONGMEM_EMBED_MODEL ?? 'mxbai-embed-large';
          const embedDim = process.env.LONGMEM_EMBED_DIM ?? '1024';
          const cacheDir = pathJoin(osTmpdir(), 'terransoul-bench-cache');
          mkdirSync(cacheDir, { recursive: true });
          const cachePath = pathJoin(
            cacheDir,
            `gold-embed-${embedModel.replace(/[\\/:*?"<>|]/g, '_')}-d${embedDim}.bin`,
          );
          setPhase('preflight', `pre-embedding ${goldRows.length} gold rows`);
          const goldEmbedStart = performance.now();
          let resp;
          try {
            resp = await clientRef.client.send({
              op: 'precompute_gold_embeddings',
              question_id: 'gold-precompute',
              sessions: corpusToSessions(goldRows),
              cache_path: cachePath,
            });
          } catch (err) {
            console.error(`[ivfpq] gold-embed precompute failed: ${err.message} — falling back to inline embed during ingest`);
            resp = null;
          }
          const goldEmbedSecs = (performance.now() - goldEmbedStart) / 1000;
          phaseTimings.gold_embed_s = goldEmbedSecs;
          if (resp) {
            console.log(`[ivfpq] gold-embed precompute: total=${resp.total} hits=${resp.hits} misses=${resp.misses} loaded_from_disk=${resp.loaded_from_disk ?? 0} cached=${resp.cached} took=${goldEmbedSecs.toFixed(1)}s (cache=${cachePath})`);
          }
        }
      }
      phaseTimings.preflight_s = (performance.now() - _preflightStart) / 1000;
      setPhase('ingest', resumeOffset > 0
        ? `resuming ingest from offset ${resumeOffset}`
        : 'starting ingest');
      const ingestStart = performance.now();
      const remainder = resumeOffset > 0
        ? built.corpus.slice(resumeOffset)
        : built.corpus;
      ing = await ingestBatched(clientRef, remainder, {
        total: built.corpus.length,
        offset: resumeOffset,
        recreateClient: async () => spawnClient(),
      });
      ingestSecs = (performance.now() - ingestStart) / 1000;
      phaseTimings.ingest_s = ingestSecs;
      console.log(`[ivfpq] ingest done: inserted=${ing.inserted} embedded=${ing.embedded} took=${ingestSecs.toFixed(1)}s`);
      progressState.last_event = `ingest done in ${ingestSecs.toFixed(1)}s`;
      writeProgressSnapshot();
    } else {
      console.log(`[ivfpq] reuse-store: skipping reset+ingest`);
      progressState.last_event = 'reuse-store: skipped ingest';
      writeProgressSnapshot();
    }

    // BENCH-SCALE-5B: if the spool fast-path was enabled, drain the on-disk
    // spool into SQLite before building IVF-PQ indexes. No-op when
    // LONGMEM_USE_SPOOL is unset (drain_spool returns drained=0).
    let drainStats = null;
    if (process.env.LONGMEM_USE_SPOOL === '1' && !opts.skipBuild) {
      console.log(`[ivfpq] draining bench spool into SQLite before build_ivf_pq`);
      setPhase('drain_spool', 'draining bench spool');
      const drainStart = performance.now();
      try {
        drainStats = await clientRef.client.send({ op: 'drain_spool' });
        const drainSecs = (performance.now() - drainStart) / 1000;
        phaseTimings.drain_spool_s = drainSecs;
        const drained = drainStats?.drained ?? 0;
        const total = drainStats?.total ?? drained;
        const rate = drainStats?.rate_docs_per_s ?? (drainSecs > 0 ? drained / drainSecs : 0);
        console.log(`[ivfpq] spool drain done: drained=${drained} total=${total} took=${drainSecs.toFixed(1)}s rate=${Math.round(rate).toLocaleString('en-US')} docs/s`);
        progressState.last_event = `drain_spool: ${drained} in ${drainSecs.toFixed(1)}s`;
        writeProgressSnapshot();
      } catch (err) {
        console.error(`[ivfpq] drain_spool failed: ${err.message} — proceeding to build_ivf_pq (may have no shards)`);
      }
    }

    let buildStats = null;
    if (!opts.skipBuild) {
      console.log(`[ivfpq] triggering build_ivf_pq (pq_m=${opts.pqM}, nlist=${opts.nlist})`);
      setPhase('build_ivf_pq', `triggering build_ivf_pq pq_m=${opts.pqM} nlist=${opts.nlist}`);
      const buildStart = performance.now();
      progressState.build.triggered_at = Date.now();
      buildStats = await clientRef.client.send({
        op: 'build_ivf_pq',
        nlist: opts.nlist,
        pq_m: opts.pqM,
        pq_nbits: opts.pqNbits,
        threshold: opts.threshold,
        max_shards: opts.maxShards,
      });
      const buildSecs = (performance.now() - buildStart) / 1000;
      phaseTimings.build_ivf_pq_s = buildSecs;
      progressState.build.finished_at = Date.now();
      progressState.build.built_shards = buildStats.built;
      progressState.build.duration_s = buildSecs;
      console.log(`[ivfpq] build_ivf_pq done: built=${buildStats.built} shards in ${buildSecs.toFixed(1)}s`);
      writeProgressSnapshot();
      if (buildStats.built === 0) {
        throw new Error('build_ivf_pq returned 0 shards; check LONGMEM_DATA_DIR / shard population');
      }
    } else {
      console.log(`[ivfpq] skip-build: assuming indexes already exist`);
      progressState.last_event = 'skip-build: assumed indexes exist';
      writeProgressSnapshot();
    }

    const filteredQueries = target.queries.filter(q => target.qrels.has(q.id));
    const limited = opts.limit > 0 ? filteredQueries.slice(0, opts.limit) : filteredQueries;

    // MEMORY-CFG-AUDIT-5 (2026-05-18): build the list of "runs" to execute
    // against the same ingested corpus. Default is a single run honoring
    // `--search-mode` and `--weights`. When `--sweep-weights=<path>` is
    // set, load `[{label, weights:[6]}, ...]` and run one batch per tuple,
    // sending `set_hybrid_weights` between batches.
    const runs = [];
    if (opts.sweepWeights) {
      const raw = JSON.parse(readFileSync(opts.sweepWeights, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('--sweep-weights file must be a JSON array');
      for (const entry of raw) {
        if (!Array.isArray(entry.weights) || entry.weights.length !== 6) {
          throw new Error(`sweep entry missing weights:[6]: ${JSON.stringify(entry)}`);
        }
        runs.push({ label: entry.label || entry.weights.join(','), weights: entry.weights.map(Number), mode: 'hybrid' });
      }
      console.log(`[ivfpq] sweep mode: ${runs.length} weight tuples loaded from ${opts.sweepWeights}`);
    } else {
      let parsedWeights = null;
      if (opts.weights) {
        parsedWeights = opts.weights.split(',').map(s => Number(s.trim()));
        if (parsedWeights.length !== 6 || parsedWeights.some(n => !Number.isFinite(n))) {
          throw new Error(`--weights must be 6 finite numbers comma-separated, got: ${opts.weights}`);
        }
      }
      runs.push({ label: opts.searchMode, weights: parsedWeights, mode: opts.searchMode });
    }

    const systems_results = [];
    const _queriesStart = performance.now();

    for (const sweepRun of runs) {
      // For sweeps, push HybridWeights once per run so they persist across
      // all queries in the batch (per-query `weights` override on the
      // Request also works, but a single `set_hybrid_weights` op is cheaper
      // and matches production semantics where weights are session-global).
      if (sweepRun.mode === 'hybrid' && sweepRun.weights) {
        await clientRef.client.send({ op: 'set_hybrid_weights', weights: sweepRun.weights });
        console.log(`[ivfpq] sweep run='${sweepRun.label}' weights=[${sweepRun.weights.join(', ')}]`);
      }
      console.log(`[ivfpq] running ${limited.length} queries (mode=${sweepRun.mode}, nprobe=${opts.nprobe})`);
      setPhase('query', `running ${limited.length} queries [${sweepRun.label}]`);
      progressState.query.total = limited.length;
      progressState.query.done = 0;
      progressState.query.started_at = Date.now();

      const perQuery = [];
      const latencies = [];
      for (let i = 0; i < limited.length; i++) {
        const q = limited[i];
        const qrels = target.qrels.get(q.id);
        const r = await searchQuery(
          clientRef.client, q.text, opts.topK, opts.nprobe, sweepRun.mode, null
        );
        latencies.push(r.latencyMs);
        perQuery.push({
          query_id: q.id,
          query: q.text,
          latency_ms: r.latencyMs,
          retrieved_ids: r.retrievedIds,
          gold_ids: [...qrels.keys()],
          ...scoreQuery(r.retrievedIds, qrels),
        });
        const done = i + 1;
        progressState.query.done = done;
        progressState.query.last_latency_ms = r.latencyMs;
        if (done % 25 === 0 || done === limited.length) {
          const so = {
            recall_at_10: avg(perQuery.map(p => p.recall_at_10)),
            ndcg_at_10: avg(perQuery.map(p => p.ndcg_at_10)),
            mrr_at_100: avg(perQuery.map(p => p.mrr_at_100)),
          };
          progressState.query.running_recall_at_10 = so.recall_at_10;
          progressState.query.running_ndcg_at_10 = so.ndcg_at_10;
          progressState.last_event = `query ${done}/${limited.length} [${sweepRun.label}]`;
          console.log(`[ivfpq] [${sweepRun.label}] ${done}/${limited.length}: R@10=${pct(so.recall_at_10)} NDCG@10=${pct(so.ndcg_at_10)} MRR@100=${pct(so.mrr_at_100)} (last lat=${r.latencyMs.toFixed(1)}ms)`);
        }
      }

      systems_results.push({
        system: sweepRun.mode,
        label: sweepRun.label,
        weights: sweepRun.weights,
        queries: perQuery.length,
        recall_at_1: avg(perQuery.map(p => p.recall_at_1)),
        recall_at_5: avg(perQuery.map(p => p.recall_at_5)),
        recall_at_10: avg(perQuery.map(p => p.recall_at_10)),
        recall_at_20: avg(perQuery.map(p => p.recall_at_20)),
        recall_at_100: avg(perQuery.map(p => p.recall_at_100)),
        ndcg_at_10: avg(perQuery.map(p => p.ndcg_at_10)),
        map_at_10: avg(perQuery.map(p => p.map_at_10)),
        mrr_at_100: avg(perQuery.map(p => p.mrr_at_100)),
        latency_avg_ms: avg(latencies),
        latency_p50_ms: percentile(latencies, 50),
        latency_p95_ms: percentile(latencies, 95),
        latency_p99_ms: percentile(latencies, 99),
        latency_max_ms: latencies.length ? Math.max(...latencies) : 0,
        per_query: perQuery,
      });
    }
    phaseTimings.queries_s = (performance.now() - _queriesStart) / 1000;

    report = {
      benchmark: 'TerranSoul LoCoMo-at-scale IVF-PQ (BENCH-SCALE-3)',
      generated_at: new Date().toISOString(),
      task: opts.task,
      scale: built.corpus.length,
      shard_mode: opts.shardMode,
      ingest_seconds: ingestSecs,
      embedded_total: ing.embedded,
      ivf_pq: {
        nlist: opts.nlist,
        pq_m: opts.pqM,
        pq_nbits: opts.pqNbits,
        nprobe: opts.nprobe,
        threshold: opts.threshold,
        max_shards: opts.maxShards,
        build_stats: buildStats,
      },
      phase_timings: phaseTimings,
      systems_results,
    };
  } finally {
    await clientRef.client.close();
  }

  const _writeStart = performance.now();
  mkdirSync(opts.outDir, { recursive: true });
  const tag = `ivfpq_${report.scale}_${opts.task}_${opts.limit || 'all'}q_pqm${opts.pqM}_nlist${opts.nlist}_nprobe${opts.nprobe}`;
  const jsonPath = resolve(opts.outDir, `locomo_${tag}.json`);
  const mdPath = resolve(opts.outDir, `locomo_${tag}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, markdownReport(report), 'utf8');
  phaseTimings.write_results_s = (performance.now() - _writeStart) / 1000;
  phaseTimings.total_s = (performance.now() - _runStart) / 1000;
  // BENCH-SCALE-5D: also write a compact phase-timing JSON beside the
  // full report so dashboards can plot phase budgets without parsing the
  // whole report.
  const timingPath = resolve(opts.outDir, `bench-scale-5-timing_${tag}.json`);
  writeFileSync(
    timingPath,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      task: opts.task,
      scale: report.scale,
      shard_mode: opts.shardMode,
      use_spool: process.env.LONGMEM_USE_SPOOL === '1',
      preset: process.env.LONGMEM_PRESET || null,
      phase_timings: phaseTimings,
    }, null, 2),
    'utf8',
  );
  console.log(`[ivfpq] phase timings (s): preflight=${phaseTimings.preflight_s.toFixed(1)} gold_embed=${phaseTimings.gold_embed_s.toFixed(1)} ingest=${phaseTimings.ingest_s.toFixed(1)} drain=${phaseTimings.drain_spool_s.toFixed(1)} build=${phaseTimings.build_ivf_pq_s.toFixed(1)} queries=${phaseTimings.queries_s.toFixed(1)} write=${phaseTimings.write_results_s.toFixed(1)} total=${phaseTimings.total_s.toFixed(1)}`);
  console.log(`[ivfpq] wrote ${jsonPath}`);
  console.log(`[ivfpq] wrote ${mdPath}`);
  console.log(`[ivfpq] wrote ${timingPath}`);
}

function markdownReport(report) {
  const L = [];
  L.push('# TerranSoul LoCoMo-at-Scale IVF-PQ Report (BENCH-SCALE-3)');
  L.push('');
  L.push(`Date: ${report.generated_at}`);
  L.push(`Task: ${report.task}`);
  L.push(`Scale: ${report.scale.toLocaleString('en-US')} chunks`);
  L.push(`Shard mode: ${report.shard_mode}`);
  L.push(`IVF-PQ: nlist=${report.ivf_pq.nlist}, pq_m=${report.ivf_pq.pq_m}, pq_nbits=${report.ivf_pq.pq_nbits}, nprobe=${report.ivf_pq.nprobe}`);
  L.push(`Ingest time: ${report.ingest_seconds.toFixed(1)}s (${report.embedded_total} embedded)`);
  L.push('');
  L.push('## Quality + Latency');
  L.push('');
  L.push('| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of report.systems_results) {
    L.push(`| ${r.system} | ${r.queries} | ${pct(r.recall_at_1)} | ${pct(r.recall_at_5)} | ${pct(r.recall_at_10)} | ${pct(r.recall_at_20)} | ${pct(r.recall_at_100)} | ${pct(r.ndcg_at_10)} | ${pct(r.map_at_10)} | ${pct(r.mrr_at_100)} | ${ms(r.latency_avg_ms)} | ${ms(r.latency_p50_ms)} | ${ms(r.latency_p95_ms)} | ${ms(r.latency_p99_ms)} | ${ms(r.latency_max_ms)} |`);
  }
  L.push('');
  L.push('## Methodology');
  L.push('');
  L.push('- Identical corpus build pipeline to BENCH-SCALE-2 (same mulberry32 seed 0x5ca1e1 → byte-for-byte identical corpora at matching `--scale`).');
  L.push('- Ingests in batches of ' + INGEST_BATCH_SIZE + ' through `longmemeval-ipc` with `LONGMEM_DATA_DIR` set so the MemoryStore opens an on-disk SQLite + persists HNSW per shard.');
  L.push('- After ingest, sends `op: build_ivf_pq` which calls `MemoryStore::build_ivf_pq_indexes_with_params` — writes per-shard sidecars with custom `IvfPqParams { nlist, pq_m, pq_nbits }`, then trains coarse k-means + PQ codebooks + writes IVF-PQ binary indexes.');
  L.push('- Query path: `op: search`, `mode: ivfpq` → `MemoryStore::vector_search_ivf_pq` → per-shard ADC search via `IvfPqIndex::search(query, k, nprobe)` → RRF merge across shards → SQLite hydrate.');
  return `${L.join('\n')}\n`;
}

async function main() {
  const cmd = command();
  if (cmd === 'help' || cmd === '--help') { printHelp(); return; }
  if (cmd !== 'run') { console.error(`unknown command ${cmd}`); printHelp(); process.exit(1); }

  // BENCH-SCALE-5D: --preset=scale5-fast wires the spool fast-path env
  // contract in one flag so callers don't need to remember the matrix.
  // Individual env vars still override the preset.
  const preset = option('preset', null);
  if (preset === 'scale5-fast') {
    const presetEnv = {
      LONGMEM_USE_SPOOL: '1',
      LONGMEM_SYNTH_EMBED: '1',
      LONGMEM_DROP_FTS: '2',
      LONGMEM_STORAGE: 'sqlite',
      LONGMEM_EMBED_DIM: '1024',
    };
    for (const [k, v] of Object.entries(presetEnv)) {
      if (process.env[k] === undefined || process.env[k] === '') {
        process.env[k] = v;
      }
    }
    process.env.LONGMEM_PRESET = 'scale5-fast';
    console.log(`[ivfpq] preset=scale5-fast applied: ${Object.keys(presetEnv).join(', ')}`);
  } else if (preset && preset !== '') {
    throw new Error(`unknown --preset '${preset}'; known: scale5-fast`);
  }

  const task = option('task', 'adversarial');
  if (!ALL_TASKS.includes(task)) throw new Error(`unknown task ${task}`);
  const shardMode = option('shard-mode', 'routed').toLowerCase();
  if (!ALL_SHARD_MODES.has(shardMode)) {
    throw new Error(`unknown --shard-mode '${shardMode}'; use routed or all`);
  }
  const pqM = numberOption('pq-m', 128);
  // BENCH-SCALE-3 landmine: 1024-dim mxbai-embed-large requires
  // (dim % pq_m) === 0. Validate up-front so we don't burn 6+ hours
  // ingesting before the build_ivf_pq op fails.
  if (1024 % pqM !== 0) {
    throw new Error(`pq-m=${pqM} is incompatible with 1024-dim mxbai-embed-large (1024 % ${pqM} = ${1024 % pqM}). Use 64, 128, 256, 512, or 1024.`);
  }
  const opts = {
    task,
    shardMode,
    scale: numberOption('scale', 10_000_000),
    limit: numberOption('limit', 100),
    topK: numberOption('top-k', 100),
    pqM,
    nlist: numberOption('nlist', 4096),
    pqNbits: numberOption('pq-nbits', 8),
    nprobe: numberOption('nprobe', 32),
    threshold: numberOption('threshold', 1),
    maxShards: numberOption('max-shards', 0),
    dataDir: option('data-dir', DEFAULT_DATA_DIR),
    benchStoreDir: option('data-dir-bench', DEFAULT_BENCH_STORE_DIR),
    outDir: option('out-dir', DEFAULT_OUT_DIR),
    reuseStore: flagOption('reuse-store'),
    resume: flagOption('resume'),
    skipBuild: flagOption('skip-build'),
    synthOnly: flagOption('synth-only'),
    progressFile: option('progress-file', DEFAULT_PROGRESS_FILE),
    progressIntervalMs: numberOption('progress-interval-ms', DEFAULT_PROGRESS_INTERVAL_MS),
    // MEMORY-CFG-AUDIT-5 (2026-05-18): weighted-hybrid A/B sweep
    // controls. `--search-mode` switches the IPC `search` op between
    // `ivfpq` (vector-only) and `hybrid` (weighted 6-signal scoring).
    // `--weights=v,k,r,i,d,t` overrides the store's HybridWeights for a
    // single run. `--sweep-weights=<path>` runs the query phase once
    // per tuple in a JSON array file (each entry `{label, weights:[6]}`)
    // without re-ingesting, writing a per-tuple report.
    searchMode: option('search-mode', 'ivfpq'),
    weights: option('weights', null),
    sweepWeights: option('sweep-weights', null),
  };
  for (const t of ALL_TASKS) {
    for (const k of ['corpus', 'queries', 'qrels']) {
      const p = parquetPath(opts.dataDir, t, k);
      if (!existsSync(p)) {
        throw new Error(`missing ${p}; run npm run brain:locomo:prepare first`);
      }
      statSync(p);
    }
  }
  if (opts.reuseStore && opts.resume) {
    throw new Error('--reuse-store and --resume are mutually exclusive: ' +
      '--reuse-store skips ingest entirely, --resume continues a partial ingest');
  }
  progressState.opts_summary = `task=${opts.task} scale=${opts.scale} pq_m=${opts.pqM} nlist=${opts.nlist} nprobe=${opts.nprobe} shard-mode=${opts.shardMode} reuse-store=${opts.reuseStore} resume=${opts.resume} skip-build=${opts.skipBuild} synth-only=${opts.synthOnly}`;
  startProgressWriter(resolve(opts.progressFile), opts.progressIntervalMs);
  try {
    await run(opts);
    progressState.last_event = 'run completed successfully';
    setPhase('done', 'run completed successfully');
  } finally {
    stopProgressWriter();
  }
}

main().catch(err => {
  progressState.fatal = err.stack || err.message;
  progressState.last_event = 'FATAL';
  setPhase('fatal', `FATAL: ${err.message}`);
  stopProgressWriter();
  console.error('[ivfpq] FATAL:', err.stack || err.message);
  process.exit(1);
});

// BENCH-SCALE-3 resume (2026-05-16): on Ctrl-C / kill, flush a final
// progress snapshot, mark the phase as `interrupted`, and exit with code
// 130 (SIGINT) / 143 (SIGTERM). The on-disk MemoryStore is WAL-safe so
// the SQLite + IVF-PQ state on disk remains valid; the next launch with
// `--resume` queries the store's `count()` and picks up from there.
let interruptHandled = false;
function gracefulInterrupt(signal) {
  if (interruptHandled) return;
  interruptHandled = true;
  const exitCode = signal === 'SIGTERM' ? 143 : 130;
  console.error(`[ivfpq] received ${signal} — flushing progress and exiting (resume with --resume)`);
  progressState.last_event = `interrupted by ${signal}`;
  progressState.fatal = null;
  try { setPhase('interrupted', `interrupted by ${signal}`); } catch { /* best-effort */ }
  try { stopProgressWriter(); } catch { /* best-effort */ }
  // Give stdio a tick to drain, then exit.
  setImmediate(() => process.exit(exitCode));
}
process.on('SIGINT', () => gracefulInterrupt('SIGINT'));
process.on('SIGTERM', () => gracefulInterrupt('SIGTERM'));
