#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: 300-resume comparison harness (Phase A follow-on,
// 2026-07-03). Builds a deterministic, language-stratified 300-resume sample
// of the million-corpus (guaranteeing a scaled-down gold set per JD), runs
// TerranSoul on it through the longmemeval-ipc shim, and scores any external
// ranking (e.g. an LLM reading all 300 resumes in-context) against the SAME
// sample gold with the SAME metric functions.
//
// LOCAL-ONLY per rules/ci-vs-local-testing.md (spawns the cargo shim).
//
// Subcommands:
//   sample  Build sample-300/{resumes.jsonl,meta.jsonl,sample-gold.json}
//           from an existing corpus dir (default gold rows per JD: 10,
//           seeded shuffle; fillers stratified by manifest langHistogram).
//   run     Ingest the sample into a FRESH store and run the JD queries
//           (default system: rrf). Writes <out-dir>/terransoul-300.json.
//   score   Score an external ranking file {jdId: [resumeId,...]} against
//           sample-gold.json. Writes <out-dir>/<label>-300.json.

import { createReadStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, matchesJd, DEFAULT_SEED } from './jd-corpus.mjs';
import { JD_QUERIES } from './jd-queries.mjs';
import { recallAtK, precisionAtK, ndcgAtK, percentile } from './lib/jd-metrics.mjs';
import { JsonlClient } from './lib/jd-ipc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const DEFAULT_CORPUS_DIR = resolve(DEFAULT_TARGET_DIR, 'jdbench');
const DEFAULT_SAMPLE_DIR = resolve(DEFAULT_CORPUS_DIR, 'sample-300');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results', 'jd-million');
const DEFAULT_SIZE = 300;
const DEFAULT_GOLD_PER_JD = 10;
const QUERY_RUNS = 5;

// ── CLI plumbing (same conventions as jd-million-bench.mjs) ────────────────

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

function numberOption(name, defaultValue) {
  const raw = option(name, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number, got ${raw}`);
  }
  return parsed;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function resumeIndex(id) {
  return Number(id.slice('res-'.length));
}

async function eachJsonlLine(path, fn) {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) fn(JSON.parse(line));
  }
}

/** Seeded Fisher-Yates shuffle (deterministic given seed). */
function seededShuffle(items, seed) {
  const rng = mulberry32(seed >>> 0);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildSampleGold(metas) {
  const gold = {};
  const langOf = {};
  const jds = [];
  for (const meta of metas) langOf[meta.id] = meta.lang;
  for (const jd of JD_QUERIES) {
    const ids = metas.filter(meta => matchesJd(meta, jd)).map(meta => meta.id);
    gold[jd.id] = ids;
    const byLang = {};
    for (const id of ids) byLang[langOf[id]] = (byLang[langOf[id]] ?? 0) + 1;
    jds.push({ id: jd.id, goldSize: ids.length, byLang });
  }
  return { gold, langOf, jds };
}

function metricsForRanking(retrieved, goldSet, langOf, topK) {
  const r10 = recallAtK(retrieved, goldSet, 10);
  const r20 = recallAtK(retrieved, goldSet, 20);
  const hitLangs = {};
  for (const id of retrieved.slice(0, topK)) {
    if (goldSet.has(id)) hitLangs[langOf[id] ?? 'unknown'] = (hitLangs[langOf[id] ?? 'unknown'] ?? 0) + 1;
  }
  return {
    recall_at_10: { capped: r10.capped, raw: r10.raw, hits: r10.hits },
    recall_at_20: { capped: r20.capped, raw: r20.raw, hits: r20.hits },
    precision_at_10: precisionAtK(retrieved, goldSet, 10),
    ndcg_at_10: ndcgAtK(retrieved, goldSet, 10),
    gold_hits_by_lang: hitLangs,
  };
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// ── sample ──────────────────────────────────────────────────────────────────

async function sample() {
  const corpusDir = resolve(REPO_ROOT, option('corpus-dir', DEFAULT_CORPUS_DIR));
  const sampleDir = resolve(REPO_ROOT, option('sample-dir', DEFAULT_SAMPLE_DIR));
  const size = numberOption('size', DEFAULT_SIZE);
  const goldPerJd = numberOption('gold-per-jd', DEFAULT_GOLD_PER_JD);
  const seed = numberOption('seed', DEFAULT_SEED);

  const manifest = JSON.parse(readFileSync(resolve(corpusDir, 'manifest.json'), 'utf8'));
  const fullGold = JSON.parse(readFileSync(resolve(corpusDir, 'gold.json'), 'utf8'));

  // (1) Seeded pick of `goldPerJd` gold rows per JD (dedup across JDs).
  const chosen = new Set();
  JD_QUERIES.forEach((jd, jdIdx) => {
    const ids = [...(fullGold.gold[jd.id] ?? [])].sort((a, b) => resumeIndex(a) - resumeIndex(b));
    const picked = seededShuffle(ids, seed + jdIdx * 1000003).slice(0, goldPerJd);
    for (const id of picked) chosen.add(id);
    console.log(`[jd-sample] ${jd.id}: seeded ${picked.length} of ${ids.length} gold rows into the sample`);
  });

  // (2) Language-stratified fillers to reach `size`, spread across the
  // corpus with a per-language stride over manifest.langHistogram.
  const remaining = size - chosen.size;
  if (remaining < 0) throw new Error(`gold picks (${chosen.size}) already exceed --size ${size}`);
  const langTotals = manifest.langHistogram;
  const corpusTotal = Object.values(langTotals).reduce((a, b) => a + b, 0);
  const langs = Object.keys(langTotals).sort((a, b) => langTotals[b] - langTotals[a]);
  const quotas = {};
  let assigned = 0;
  for (const lang of langs) {
    quotas[lang] = Math.floor((remaining * langTotals[lang]) / corpusTotal);
    assigned += quotas[lang];
  }
  quotas[langs[0]] += remaining - assigned; // rounding drift -> biggest language

  const strides = {};
  for (const lang of langs) {
    strides[lang] = quotas[lang] > 0 ? Math.max(1, Math.floor(langTotals[lang] / quotas[lang])) : Infinity;
  }

  const fillerCounts = {};
  const seenPerLang = {};
  const metasById = new Map();
  await eachJsonlLine(resolve(corpusDir, 'meta.jsonl'), meta => {
    if (chosen.has(meta.id)) {
      metasById.set(meta.id, meta);
      return;
    }
    const lang = meta.lang;
    seenPerLang[lang] = (seenPerLang[lang] ?? 0) + 1;
    if ((fillerCounts[lang] ?? 0) < quotas[lang] && (seenPerLang[lang] - 1) % strides[lang] === 0) {
      fillerCounts[lang] = (fillerCounts[lang] ?? 0) + 1;
      chosen.add(meta.id);
      metasById.set(meta.id, meta);
    }
  });
  console.log(`[jd-sample] sample size ${chosen.size} (gold picks + stratified fillers ${JSON.stringify(fillerCounts)})`);

  // (3) Extract the resume texts in corpus (index) order.
  const orderedIds = [...chosen].sort((a, b) => resumeIndex(a) - resumeIndex(b));
  const textById = new Map();
  await eachJsonlLine(resolve(corpusDir, 'resumes.jsonl'), row => {
    if (chosen.has(row.session_id)) textById.set(row.session_id, row);
  });

  mkdirSync(sampleDir, { recursive: true });
  writeFileSync(
    resolve(sampleDir, 'resumes.jsonl'),
    `${orderedIds.map(id => JSON.stringify(textById.get(id))).join('\n')}\n`,
    'utf8',
  );
  const orderedMetas = orderedIds.map(id => metasById.get(id));
  writeFileSync(
    resolve(sampleDir, 'meta.jsonl'),
    `${orderedMetas.map(meta => JSON.stringify(meta)).join('\n')}\n`,
    'utf8',
  );

  // (4) Recompute gold ON THE SAMPLE (fillers can legitimately satisfy a JD
  // predicate — they count as gold; nothing is hidden from either system).
  const sampleGold = buildSampleGold(orderedMetas);
  writeFileSync(
    resolve(sampleDir, 'sample-gold.json'),
    `${JSON.stringify({ seed, size: chosen.size, gold_per_jd: goldPerJd, ...sampleGold }, null, 2)}\n`,
    'utf8',
  );
  for (const jd of sampleGold.jds) {
    console.log(`[jd-sample] sample gold ${jd.id}: ${jd.goldSize} (${JSON.stringify(jd.byLang)})`);
  }
  console.log(`[jd-sample] wrote ${sampleDir}`);
}

// ── run (TerranSoul on the sample) ──────────────────────────────────────────

async function run() {
  const sampleDir = resolve(REPO_ROOT, option('sample-dir', DEFAULT_SAMPLE_DIR));
  const outDir = resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR));
  const systems = option('systems', 'rrf').split(',').map(s => s.trim()).filter(Boolean);
  const topK = numberOption('top-k', 100);
  // Optional label suffixes the output file (terransoul-<label>-300.json) so
  // config ladder legs (e.g. dense+CJK) never clobber an earlier leg's
  // artifact — equal-or-better updates happen in the scoreboard, not by
  // overwriting measurements.
  const label = option('label', null);

  const goldDoc = JSON.parse(readFileSync(resolve(sampleDir, 'sample-gold.json'), 'utf8'));
  const resumesPath = resolve(sampleDir, 'resumes.jsonl');
  const sampleSize = readFileSync(resumesPath, 'utf8').split('\n').filter(Boolean).length;

  const storeDir = resolve(sampleDir, 'store');
  rmSync(storeDir, { recursive: true, force: true });
  process.env.LONGMEM_DATA_DIR = storeDir;

  const tWall = performance.now();
  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  let report;
  try {
    await client.send({ op: 'reset' });
    const tIngest = performance.now();
    const added = await client.send({
      op: 'add_sessions_jsonl',
      question_id: 'jd-sample-300',
      path: resumesPath,
    });
    const ingestSeconds = (performance.now() - tIngest) / 1000;
    console.log(`[jd-sample] ingested ${added.added} rows in ${ingestSeconds.toFixed(2)}s`);

    const results = [];
    for (const system of systems) {
      for (const jd of JD_QUERIES) {
        const goldSet = new Set(goldDoc.gold[jd.id] ?? []);
        const latencies = [];
        let retrieved = [];
        for (let i = 0; i < QUERY_RUNS; i += 1) {
          const t0 = performance.now();
          const response = await client.send({ op: 'search', query: jd.queryText, mode: system, limit: topK });
          latencies.push(performance.now() - t0);
          retrieved = (response.results ?? []).map(hit => hit.session_id).filter(Boolean);
        }
        const m = metricsForRanking(retrieved, goldSet, goldDoc.langOf, topK);
        results.push({
          system,
          jd_id: jd.id,
          jd_lang: jd.lang,
          gold_size: goldSet.size,
          latency_ms: {
            p50: Number(percentile(latencies, 50).toFixed(2)),
            p95: Number(percentile(latencies, 95).toFixed(2)),
            all: latencies.map(v => Number(v.toFixed(2))),
          },
          ...m,
          retrieved_top_20: retrieved.slice(0, 20),
        });
        console.log(`[jd-sample] ${system} ${jd.id}: R@10=${pct(m.recall_at_10.capped)} R@20=${pct(m.recall_at_20.capped)} `
          + `P@10=${pct(m.precision_at_10)} NDCG@10=${pct(m.ndcg_at_10)} p50=${results.at(-1).latency_ms.p50}ms`);
      }
    }

    // Env stamp (2026-07-02 RRF archaeology guardrail): a metric delta
    // without an env diff is the tell — record every LONGMEM_* variable so
    // lexical-only and dense legs can never be confused.
    const longmemVars = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('LONGMEM_') || key === 'LCM_CONV_AWARE') longmemVars[key] = value;
    }
    report = {
      benchmark: 'MILLION-RESUME-BENCH sample-300 (TerranSoul)',
      generated_at: new Date().toISOString(),
      sample_dir: sampleDir,
      sample_size: sampleSize,
      systems,
      top_k: topK,
      query_runs: QUERY_RUNS,
      env: { longmem_vars: longmemVars, node: process.version, platform: `${process.platform} ${process.arch}` },
      ingest: { rows: added.added, seconds: Number(ingestSeconds.toFixed(3)) },
      wall_seconds_total: Number(((performance.now() - tWall) / 1000).toFixed(3)),
      results,
    };
  } finally {
    await client.close();
  }
  report.wall_seconds_total = Number(((performance.now() - tWall) / 1000).toFixed(3));

  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, label ? `terransoul-${label}-300.json` : 'terransoul-300.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[jd-sample] wrote ${outPath} (wall ${report.wall_seconds_total}s incl. shim spawn + ingest)`);
}

// ── score (external ranking, e.g. an LLM reading the sample in-context) ────

async function score() {
  const sampleDir = resolve(REPO_ROOT, option('sample-dir', DEFAULT_SAMPLE_DIR));
  const outDir = resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR));
  const rankingPath = option('ranking', null);
  const label = option('label', 'external');
  const wallSeconds = Number(option('wall-seconds', '0'));
  const notes = option('notes', '');
  if (!rankingPath) throw new Error('score requires --ranking <file> ({jdId: [resumeId, ...]})');

  const goldDoc = JSON.parse(readFileSync(resolve(sampleDir, 'sample-gold.json'), 'utf8'));
  const ranking = JSON.parse(readFileSync(resolve(REPO_ROOT, rankingPath), 'utf8'));

  const results = [];
  for (const jd of JD_QUERIES) {
    const goldSet = new Set(goldDoc.gold[jd.id] ?? []);
    const retrieved = ranking[jd.id] ?? [];
    const m = metricsForRanking(retrieved, goldSet, goldDoc.langOf, retrieved.length || 20);
    results.push({
      system: label,
      jd_id: jd.id,
      jd_lang: jd.lang,
      gold_size: goldSet.size,
      ranked: retrieved.length,
      ...m,
      retrieved_top_20: retrieved.slice(0, 20),
    });
    console.log(`[jd-sample] ${label} ${jd.id}: R@10=${pct(m.recall_at_10.capped)} R@20=${pct(m.recall_at_20.capped)} `
      + `P@10=${pct(m.precision_at_10)} NDCG@10=${pct(m.ndcg_at_10)}`);
  }

  const report = {
    benchmark: `MILLION-RESUME-BENCH sample-300 (${label})`,
    generated_at: new Date().toISOString(),
    sample_dir: sampleDir,
    label,
    wall_seconds_total: wallSeconds,
    notes,
    results,
  };
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${label}-300.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[jd-sample] wrote ${outPath}`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'sample') return sample();
  if (cmd === 'run') return run();
  if (cmd === 'score') return score();
  console.log('Usage: node benchmark/scripts/jd-sample-bench.mjs <sample|run|score> [options]');
  console.log('  sample  --corpus-dir --sample-dir --size 300 --gold-per-jd 10 --seed');
  console.log('  run     --sample-dir --out-dir --systems rrf --top-k 100 --label <leg>');
  console.log('  score   --sample-dir --out-dir --ranking <file> --label <name> --wall-seconds <n> --notes <text>');
  if (cmd) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[jd-sample] failed: ${err.message}`);
  process.exit(1);
});
