#!/usr/bin/env node
// BENCH-SCALE-1: quality-at-scale LoCoMo bench.
//
// Loads the LoCoMo adversarial corpus + qrels (the hardest published task),
// augments with cross-task LoCoMo chunks as natural distractors, then
// generates deterministic entity-swap synthetic distractors to reach a
// configurable target corpus size (default 1,000,000), ingests through the
// existing longmemeval-ipc binary with mxbai-embed-large embeddings + HNSW,
// and runs the LCM-8 `rrf_rerank` pipeline against the buried corpus.
//
// Reports R@10 / NDCG@10 / MRR + p50/p95/p99 retrieval latency per task.
//
// Usage:
//   node scripts/locomo-at-scale.mjs run --scale=1000000 --task=adversarial --systems=rrf_rerank --limit=100
//
// Acceptance per rules/milestones.md (BENCH-SCALE-1):
//   R@10 within 10pp of LCM-8 5k baseline (overall 68.3 % -> >= 58 %)
//   p99 retrieval latency <= 200ms

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_DATA_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'locomo-mteb');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'bench-results');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
// BENCH-SCALE-3 (2026-05-15): on-disk MemoryStore root for the IVF-PQ arm.
const DEFAULT_STORE_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'scale-store');
const ALL_TASKS = ['single_hop', 'multi_hop', 'temporal_reasoning', 'open_domain', 'adversarial'];
// BENCH-SCALE-3 (2026-05-15): `ivfpq` is a pure vector-only retrieval path
// (disk-backed IVF-PQ + ADC). Requires `LONGMEM_DATA_DIR` so the store can
// persist the IVF-PQ index files, and a post-ingest `build_ivf_pq` IPC op.
// `--systems=ivfpq` flips both on for the IVF-PQ arm; the `rrf` / `rrf_rerank`
// arms continue to use in-memory HNSW + lexical RRF as before.
const ALL_SYSTEMS = new Set(['rrf', 'rrf_rerank', 'ivfpq']);
const RERANK_SYSTEMS = new Set(['rrf_rerank']);
const IVFPQ_SYSTEMS = new Set(['ivfpq']);
// BENCH-SCALE-2 (2026-05-14): valid `--shard-mode` values. Plumbed into
// the spawned `longmemeval-ipc` process via `LONGMEM_SHARD_MODE` to compare
// router-routed (production default) vs all-shards probe at 1M+ docs.
const ALL_SHARD_MODES = new Set(['routed', 'all']);
const METRIC_KS = [1, 5, 10, 20, 100];
const INGEST_BATCH_SIZE = 500;

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

function listOption(name, fallback) {
  return option(name, fallback.join(','))
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`TerranSoul LoCoMo-at-scale bench (BENCH-SCALE-1)

Usage:
  node scripts/locomo-at-scale.mjs run [options]

Options:
  --task=<name>         Target task (default: adversarial; one of ${ALL_TASKS.join(',')})
  --systems=<csv>       Systems: rrf, rrf_rerank, ivfpq (default: rrf_rerank)
  --scale=<n>           Total corpus size including target + distractors (default: 1000000)
  --limit=<n>           Queries to score; 0 means all (default: 100)
  --top-k=<n>           Retrieval depth requested (default: 100)
  --shard-mode=<m>      Shard policy: routed (production default, coarse router → top-p shards)
                        or all (bypass router, probe every shard — single-index-style baseline
                        for BENCH-SCALE-2). Plumbed via LONGMEM_SHARD_MODE. (default: routed)
  --data-dir=<path>     LoCoMo parquet dir (default: target-copilot-bench/locomo-mteb)
  --out-dir=<path>      Report dir (default: benchmark/results)
  --store-dir=<path>    BENCH-SCALE-3: on-disk MemoryStore root (default:
                        target-copilot-bench/scale-store). Required when --systems includes
                        ivfpq; plumbed via LONGMEM_DATA_DIR. Wiped on every run for determinism.
  --nlist=<n>           BENCH-SCALE-3 IVF-PQ coarse quantizer cells (default: 4096)
  --pq-m=<n>            BENCH-SCALE-3 IVF-PQ subquantizers; must divide embed dim 1024 (default: 128)
  --pq-nbits=<n>        BENCH-SCALE-3 IVF-PQ bits per PQ code (default: 8 → 256 centroids/subspace)
  --nprobe=<n>          BENCH-SCALE-3 IVF-PQ cells probed per query (default: 32; higher = recall, slower)

The harness ingests in batches of ${INGEST_BATCH_SIZE}. mxbai-embed-large is the assumed
embedder (set LONGMEM_EMBED_MODEL=mxbai-embed-large in the environment).
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

// ----- distractor generation ----------------------------------------------

// Stable, fast PRNG (mulberry32) so corpus is deterministic across runs.
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
  // Capture any sequence of capitalized words (proper-noun-ish) and rotate.
  const nameMatches = [...text.matchAll(/\b([A-Z][a-z]{2,})\b/g)].map(m => m[1]);
  const uniqueNames = [...new Set(nameMatches)];
  let result = text;
  for (const original of uniqueNames) {
    const replacement = SWAP_NAMES[Math.floor(rand() * SWAP_NAMES.length)];
    if (replacement !== original) {
      // Replace every occurrence of the exact name, word-bounded.
      result = result.replace(new RegExp(`\\b${original}\\b`, 'g'), replacement);
    }
  }
  // Sprinkle in a swap-place and swap-hobby to push the chunk semantically
  // away from the original (so it survives as a distractor under cosine).
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
  return template.replace('{name}', name).replace('{place}', place).replace('{hobby}', hobby);
}

function buildScaleCorpus({ targetCorpus, otherCorpora, qrels, scale, seed }) {
  const rand = mulberry32(seed);
  // 1) Real target chunks (must be present so qrels can match).
  const corpus = targetCorpus.map(row => ({
    id: row.id,
    text: row.text,
    title: row.title,
    tag: 'gold',
  }));
  const goldIds = new Set(corpus.map(r => r.id));
  // 2) Cross-task LoCoMo prose as natural distractors. Skip ids that collide
  //    with gold (extremely unlikely across tasks but cheap to guard).
  let nextDistractorIdx = 0;
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
  // 3) Entity-swap paraphrases of every gold chunk (forces cosine to discriminate).
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
  // 4) Synthetic Lorem-style template fillers to reach the target scale.
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
  // Verify every qrel target id is present in the final corpus (otherwise
  // recall is structurally capped below 100% and the bench is invalid).
  const presentIds = new Set(corpus.map(r => r.id));
  let missing = 0;
  for (const targets of qrels.values()) {
    for (const id of targets.keys()) {
      if (!presentIds.has(id)) missing++;
    }
  }
  return { corpus, missingQrels: missing };
}

// ----- IPC client (mirrors locomo-mteb.mjs) --------------------------------

class JsonlClient {
  constructor({ embed = true, rerank = false, shardMode = 'routed', storeDir = null } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    const env = {
      ...process.env,
      ...(embed ? { LONGMEM_EMBED: '1' } : {}),
      ...(rerank ? { LONGMEM_RERANK: '1' } : {}),
      // BENCH-SCALE-2 (2026-05-14): plumb the shard-routing policy into
      // the spawned `longmemeval-ipc` process. The bench bin maps this to
      // `MemoryStore::set_shard_mode` via `IndexState::shard_mode_from_env`.
      LONGMEM_SHARD_MODE: shardMode,
      // BENCH-SCALE-3 (2026-05-15): point the spawned IPC at a disk-backed
      // MemoryStore so IVF-PQ has a `data_dir` to persist sidecars/indexes.
      // Without this the store is in-memory and `build_ivf_pq` returns built=0.
      ...(storeDir ? { LONGMEM_DATA_DIR: storeDir } : {}),
    };
    const ipcBin = resolve(
      DEFAULT_TARGET_DIR,
      'debug',
      process.platform === 'win32' ? 'longmemeval-ipc.exe' : 'longmemeval-ipc'
    );
    const spawnCmd = existsSync(ipcBin) ? ipcBin : 'cargo';
    const spawnArgs = existsSync(ipcBin)
      ? []
      : [
          'run',
          '--quiet',
          '--manifest-path',
          resolve(REPO_ROOT, 'src-tauri', 'Cargo.toml'),
          '--features', 'bench-million',
          '--bin', 'longmemeval-ipc',
          '--target-dir', DEFAULT_TARGET_DIR,
        ];

    if (existsSync(ipcBin)) {
      console.log(`[scale] using prebuilt IPC binary: ${ipcBin}`);
    } else {
      console.log('[scale] prebuilt IPC binary not found; falling back to cargo run');
    }

    this.proc = spawn(spawnCmd, spawnArgs, {
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
    const msg = JSON.parse(line);
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

async function ingestBatched(client, corpus) {
  const total = corpus.length;
  const started = performance.now();
  let inserted = 0;
  let embedded = 0;
  for (let off = 0; off < total; off += INGEST_BATCH_SIZE) {
    const slice = corpus.slice(off, off + INGEST_BATCH_SIZE);
    const resp = await client.send({
      op: 'add_sessions',
      question_id: `scale-${off}`,
      sessions: corpusToSessions(slice),
    });
    inserted += resp.inserted ?? slice.length;
    embedded = resp.embedded ?? embedded;
    const done = off + slice.length;
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    if (done === total || (done % 5000 === 0)) {
      console.log(`[scale] ingested ${done}/${total} (embedded total=${embedded}, elapsed=${elapsed}s)`);
    }
  }
  return { inserted, embedded };
}

// ----- metrics (mirror locomo-mteb.mjs) ------------------------------------

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

// ----- run ----------------------------------------------------------------

async function searchQuery(client, system, query, topK, ivfPqOpts = null) {
  const start = performance.now();
  const payload = { op: 'search', query, mode: system, limit: topK };
  // BENCH-SCALE-3 (2026-05-15): the `ivfpq` IPC mode reads `nprobe` from the
  // request payload (defaults to 32 inside the binary when absent).
  if (IVFPQ_SYSTEMS.has(system) && ivfPqOpts && Number.isInteger(ivfPqOpts.nprobe)) {
    payload.nprobe = ivfPqOpts.nprobe;
  }
  const resp = await client.send(payload);
  const lat = performance.now() - start;
  const ids = (resp.results ?? []).map(r => r.session_id).filter(Boolean);
  return { latencyMs: lat, retrievedIds: ids };
}

async function run(opts) {
  const targetDir = opts.dataDir;
  console.log(`[scale] target task: ${opts.task}`);
  console.log(`[scale] scale: ${opts.scale.toLocaleString('en-US')}`);
  console.log(`[scale] systems: ${opts.systems.join(',')}`);
  console.log(`[scale] shard-mode: ${opts.shardMode}`);

  const target = await loadTaskFull(opts.task, targetDir);
  console.log(`[scale] target corpus=${target.corpus.length} queries=${target.queries.length} qrels=${target.qrels.size}`);

  const otherTasks = ALL_TASKS.filter(t => t !== opts.task);
  const otherCorpora = [];
  for (const t of otherTasks) {
    const data = await loadTaskFull(t, targetDir);
    otherCorpora.push(data.corpus);
    console.log(`[scale] natural distractor ${t}: ${data.corpus.length} chunks`);
  }

  const built = buildScaleCorpus({
    targetCorpus: target.corpus,
    otherCorpora,
    qrels: target.qrels,
    scale: opts.scale,
    seed: 0x5ca1e1,
  });
  console.log(`[scale] built corpus=${built.corpus.length} (missing qrels=${built.missingQrels})`);
  if (built.missingQrels > 0) {
    throw new Error(`refusing to run: ${built.missingQrels} qrel target ids missing from corpus`);
  }

  const rerank = opts.systems.some(s => RERANK_SYSTEMS.has(s));
  const wantsIvfPq = opts.systems.some(s => IVFPQ_SYSTEMS.has(s));
  // BENCH-SCALE-3 (2026-05-15): the IVF-PQ arm needs `LONGMEM_DATA_DIR` so the
  // store persists shard sidecars + IVF-PQ index files. Wipe + recreate the
  // store dir on every run so corpus state never leaks between scales/tasks.
  if (wantsIvfPq) {
    if (existsSync(opts.storeDir)) {
      rmSync(opts.storeDir, { recursive: true, force: true });
    }
    mkdirSync(opts.storeDir, { recursive: true });
    console.log(`[scale] IVF-PQ store dir: ${opts.storeDir} (wiped + recreated)`);
  }
  const client = new JsonlClient({
    embed: true,
    rerank,
    shardMode: opts.shardMode,
    storeDir: wantsIvfPq ? opts.storeDir : null,
  });
  let report;
  try {
    await client.send({ op: 'reset' });
    const ingestStart = performance.now();
    const ing = await ingestBatched(client, built.corpus);
    const ingestSecs = (performance.now() - ingestStart) / 1000;
    console.log(`[scale] ingest done: inserted=${ing.inserted} embedded=${ing.embedded} took=${ingestSecs.toFixed(1)}s`);

    // BENCH-SCALE-3 (2026-05-15): build IVF-PQ indexes per populated shard
    // before any `ivfpq` query runs. Uses the IPC `build_ivf_pq` op which
    // calls MemoryStore::build_ivf_pq_indexes_with_params. Defaults are
    // tuned for 1024-dim mxbai-embed-large.
    let ivfPqBuildSecs = 0;
    let ivfPqStats = null;
    if (wantsIvfPq) {
      const buildStart = performance.now();
      ivfPqStats = await client.send({
        op: 'build_ivf_pq',
        nlist: opts.nlist,
        pq_m: opts.pqM,
        pq_nbits: opts.pqNbits,
        threshold: 1,
        max_shards: 0,
      });
      ivfPqBuildSecs = (performance.now() - buildStart) / 1000;
      console.log(`[scale] IVF-PQ built ${ivfPqStats.built ?? 0} shard(s) in ${ivfPqBuildSecs.toFixed(1)}s (nlist=${opts.nlist}, pq_m=${opts.pqM}, pq_nbits=${opts.pqNbits})`);
    }

    const filteredQueries = target.queries.filter(q => target.qrels.has(q.id));
    const limited = opts.limit > 0 ? filteredQueries.slice(0, opts.limit) : filteredQueries;
    console.log(`[scale] running ${limited.length} queries x ${opts.systems.length} systems`);

    const systemReports = [];
    for (const system of opts.systems) {
      const perQuery = [];
      const latencies = [];
      for (let i = 0; i < limited.length; i++) {
        const q = limited[i];
        const qrels = target.qrels.get(q.id);
        const r = await searchQuery(client, system, q.text, opts.topK, { nprobe: opts.nprobe });
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
        if (done % 25 === 0 || done === limited.length) {
          const so = {
            recall_at_10: avg(perQuery.map(p => p.recall_at_10)),
            ndcg_at_10: avg(perQuery.map(p => p.ndcg_at_10)),
            mrr_at_100: avg(perQuery.map(p => p.mrr_at_100)),
          };
          console.log(`[scale] ${system} ${done}/${limited.length}: R@10=${pct(so.recall_at_10)} NDCG@10=${pct(so.ndcg_at_10)} MRR@100=${pct(so.mrr_at_100)} (last lat=${r.latencyMs.toFixed(1)}ms)`);
        }
      }
      systemReports.push({
        system,
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

    report = {
      benchmark: 'TerranSoul LoCoMo-at-scale (BENCH-SCALE-1)',
      generated_at: new Date().toISOString(),
      task: opts.task,
      scale: built.corpus.length,
      systems: opts.systems,
      // BENCH-SCALE-2 (2026-05-14): record the shard-routing policy used
      // for this run so JSON consumers and the markdown report can
      // distinguish router-routed vs all-shards baselines without
      // re-parsing filenames.
      shard_mode: opts.shardMode,
      ingest_seconds: ingestSecs,
      embedded_total: ing.embedded,
      // BENCH-SCALE-3 (2026-05-15): record IVF-PQ build cost + params so
      // downstream readers can attribute the wall-clock overhead correctly.
      ivf_pq_build_seconds: ivfPqBuildSecs,
      ivf_pq_params: wantsIvfPq
        ? { nlist: opts.nlist, pq_m: opts.pqM, pq_nbits: opts.pqNbits, nprobe: opts.nprobe }
        : null,
      ivf_pq_build_stats: ivfPqStats,
      systems_results: systemReports,
    };
  } finally {
    await client.close();
  }

  mkdirSync(opts.outDir, { recursive: true });
  // BENCH-SCALE-2 (2026-05-14): include shard-mode in the filename so a
  // back-to-back router-routed vs all-shards comparison run does not
  // overwrite the earlier report (SCALE-1b hit this overwrite footgun).
  // BENCH-SCALE-3 (2026-05-15): also include a systems suffix when ivfpq
  // is in the mix, so HNSW (`rrf`) and IVF-PQ runs never overwrite.
  const systemsTag = opts.systems.some(s => IVFPQ_SYSTEMS.has(s))
    ? `_${opts.systems.join('-')}`
    : '';
  const tag = `scale_${built.corpus.length}_${opts.task}_${opts.limit || 'all'}q_${opts.shardMode}${systemsTag}`;
  const jsonPath = resolve(opts.outDir, `locomo_${tag}.json`);
  const mdPath = resolve(opts.outDir, `locomo_${tag}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, markdownReport(report), 'utf8');
  console.log(`[scale] wrote ${jsonPath}`);
  console.log(`[scale] wrote ${mdPath}`);
}

function markdownReport(report) {
  const L = [];
  L.push('# TerranSoul LoCoMo-at-Scale Report (BENCH-SCALE-1)');
  L.push('');
  L.push(`Date: ${report.generated_at}`);
  L.push(`Task: ${report.task}`);
  L.push(`Scale: ${report.scale.toLocaleString('en-US')} chunks`);
  L.push(`Systems: ${report.systems.join(', ')}`);
  L.push(`Shard mode: ${report.shard_mode ?? 'routed'}`);
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
  L.push('- Loads MTEB LoCoMo `<task>-corpus`, `<task>-queries`, `<task>-qrels` parquet files from the cached download.');
  L.push('- Augments with cross-task LoCoMo prose as natural distractors, then deterministic entity-swap paraphrases of gold chunks, then synthetic template prose to reach `--scale`.');
  L.push('- Ingests in batches of ' + INGEST_BATCH_SIZE + ' through `longmemeval-ipc` with `LONGMEM_EMBED=1` (mxbai-embed-large via Ollama, HNSW ANN).');
  L.push('- Runs each `--systems` mode against the buried corpus, records per-query latency.');
  L.push('- Acceptance (BENCH-SCALE-1): R@10 within 10pp of LCM-8 5k baseline AND p99 <= 200ms.');
  return `${L.join('\n')}\n`;
}

async function main() {
  const cmd = command();
  if (cmd === 'help' || cmd === '--help') { printHelp(); return; }
  if (cmd !== 'run') { console.error(`unknown command ${cmd}`); printHelp(); process.exit(1); }
  const task = option('task', 'adversarial');
  if (!ALL_TASKS.includes(task)) throw new Error(`unknown task ${task}`);
  const systems = listOption('systems', ['rrf_rerank']);
  for (const s of systems) {
    if (!ALL_SYSTEMS.has(s)) throw new Error(`unknown system ${s}; use rrf, rrf_rerank, or ivfpq`);
  }
  const shardMode = option('shard-mode', 'routed').toLowerCase();
  if (!ALL_SHARD_MODES.has(shardMode)) {
    throw new Error(`unknown --shard-mode '${shardMode}'; use routed or all`);
  }
  const opts = {
    task,
    systems,
    shardMode,
    scale: numberOption('scale', 1_000_000),
    limit: numberOption('limit', 100),
    topK: numberOption('top-k', 100),
    dataDir: option('data-dir', DEFAULT_DATA_DIR),
    outDir: option('out-dir', DEFAULT_OUT_DIR),
    storeDir: option('store-dir', DEFAULT_STORE_DIR),
    nlist: numberOption('nlist', 4096),
    pqM: numberOption('pq-m', 128),
    pqNbits: numberOption('pq-nbits', 8),
    nprobe: numberOption('nprobe', 32),
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
  await run(opts);
}

main().catch(err => {
  console.error('[scale] FATAL:', err.stack || err.message);
  process.exit(1);
});
