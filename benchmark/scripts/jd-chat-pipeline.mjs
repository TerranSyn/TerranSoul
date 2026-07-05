#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-2 chat-pipeline bench (2026-07-04, user directive: "use the
// real TerranSoul chat" measurement instead of raw-retrieval-only NDCG).
//
// Mirrors the production chat flow end-to-end on the REAL store path:
//   JD query -> hybrid retrieval narrows the store to top-K (shim `search`
//   op, include_content) -> the local reader model (gemma4:12b-it-qat, the
//   production brain model) READS the retrieved resumes with a generic
//   ranked-shortlist prompt (lib/jd-reader.mjs; no gold leakage, no
//   JD-specific logic) -> ranked candidate IDs out -> scored with the SAME
//   metric functions as every other leg.
//
// Reports BOTH modes per JD: retrieval-only (the raw top-K order) and
// chat-pipeline (the reader's ranking), with honest latency for each stage.
//
// LOCAL-ONLY per rules/ci-vs-local-testing.md (cargo shim + local Ollama).
//
// Usage:
//   node benchmark/scripts/jd-chat-pipeline.mjs run
//     --mode sample|million     sample: fresh-ingest sample-300 into its store
//                               million: query-only against LONGMEM_DATA_DIR
//                               (never resets/ingests; asserts store count)
//     --sample-dir <dir>        (sample mode) default target-copilot-bench/jdbench/sample-300
//     --corpus-dir <dir>        (million mode) corpus with gold.json (default jdbench)
//     --expected-count <n>      (million mode) store row assertion (default 1000000)
//     --k 50                    retrieval depth fed to the reader
//     --system rrf              retrieval mode
//     --reader-model gemma4:12b-it-qat
//     --batch-chars 8000        map-phase char budget per reader call
//     --num-ctx 16384           reader num_ctx (gemma stall lesson: too small
//                               => done_reason=length after 1 token)
//     --out-dir <dir>           default benchmark/results/jd-million
//     --label chat              output file suffix

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JD_QUERIES } from './jd-queries.mjs';
import { recallAtK, precisionAtK, ndcgAtK } from './lib/jd-metrics.mjs';
import { JsonlClient } from './lib/jd-ipc.mjs';
import {
  buildExtractPrompt,
  buildRankPrompt,
  chunkByTokenBudget,
  mergeRanked,
  parseExtraction,
  parseRankedIds,
  rrfFuseRankings,
  sortByExtraction,
} from './lib/jd-reader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
// Prefer C:\TerranSoul (SSD) for the JD corpus/store when present; fall back to the repo dir.
const DEFAULT_CORPUS_DIR = existsSync('C:/TerranSoul/jdbench') ? 'C:/TerranSoul/jdbench' : resolve(DEFAULT_TARGET_DIR, 'jdbench');
const DEFAULT_SAMPLE_DIR = resolve(DEFAULT_CORPUS_DIR, 'sample-300');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results', 'jd-million');
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

function option(name, defaultValue) {
  const argv = process.argv.slice(3);
  const eq = argv.find(arg => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return defaultValue;
}

function numberOption(name, defaultValue) {
  const parsed = Number(option(name, String(defaultValue)));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be positive`);
  return parsed;
}

/**
 * One non-streaming reader call. `num_predict` caps a rambling reply; a
 * `done_reason=length` cut is SOFT (the robust ID parser extracts the
 * ranking prefix and the merge guarantees no recall loss) — logged and
 * counted, never fatal.
 */
async function readerCall(model, prompt, numCtx, numPredict, debugLog) {
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      // gemma4 under current Ollama is a THINKING model: without this flag
      // the whole num_predict budget can be consumed by message.thinking
      // and message.content stays empty (first live run: 600/600 tokens of
      // thought, zero output). The ranked-shortlist task needs the answer,
      // not the deliberation.
      think: false,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0, num_ctx: numCtx, num_predict: numPredict },
      keep_alive: '2h',
    }),
  });
  if (!res.ok) throw new Error(`reader /api/chat -> ${res.status}`);
  const body = await res.json();
  const doneReason = body.done_reason ?? 'stop';
  // Defensive: if a runner ignores think:false and content is empty, the
  // ranking often appears inside the thinking text — parse that instead.
  const text = body.message?.content || body.message?.thinking || '';
  if (debugLog) {
    debugLog.push({
      done_reason: doneReason,
      prompt_tokens: body.prompt_eval_count ?? 0,
      eval_tokens: body.eval_count ?? 0,
      reply: text,
    });
  }
  if (doneReason !== 'stop') {
    console.warn(`[jd-chat] WARN reader reply cut (done_reason=${doneReason}, eval=${body.eval_count}) — parsing the prefix`);
  }
  return {
    text,
    truncated: doneReason !== 'stop',
    ms: performance.now() - t0,
    promptTokens: body.prompt_eval_count ?? 0,
    evalTokens: body.eval_count ?? 0,
  };
}

/**
 * The reader stage: a STREAMING TOP-N TOURNAMENT. Rank the first batch,
 * keep the top `workingSize` as incumbents, then merge each following
 * batch against the incumbents and re-rank. Every candidate is directly
 * compared against the current champions (no hard qualification step —
 * a first design qualified on "ALL requirements" and honestly rejected
 * valid strong-overlap candidates; ranking-by-fit is what an in-context
 * reader does). Generic product logic; no JD/corpus specifics.
 * Returns { ranked, calls, readerMs, tokens, truncations }.
 */
async function readerRank({ jdText, candidates, model, batchTokens, workingSize, numCtx, numPredict, extractStage, debugLog }) {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const retrievalOrder = candidates.map(c => c.id);
  const batches = chunkByTokenBudget(candidates, batchTokens);
  let calls = 0;
  let readerMs = 0;
  let truncations = 0;
  const tokens = { prompt: 0, eval: 0 };
  const track = r => {
    calls += 1;
    readerMs += r.ms;
    tokens.prompt += r.promptTokens;
    tokens.eval += r.evalTokens;
    if (r.truncated) truncations += 1;
    return r;
  };

  let working = []; // ranked incumbent ids (<= workingSize)
  for (const batch of batches) {
    const seen = new Set(working);
    const pool = [
      ...working.map(id => byId.get(id)),
      ...batch.filter(c => !seen.has(c.id)),
    ];
    const poolIds = pool.map(c => c.id);
    const r = track(await readerCall(model, buildRankPrompt(jdText, pool), numCtx, numPredict, debugLog));
    const ranked = parseRankedIds(r.text, new Set(poolIds));
    // Unparsed pool members keep their pool order behind the parsed ones
    // (reader can demote but never lose candidates it was shown).
    working = mergeRanked({ reduceRanked: ranked, retrievalOrder: poolIds }).slice(0, workingSize);
  }

  // Optional final stage (--extract-stage): extract-then-sort verification
  // over the champions — per-candidate structured facts + a deterministic
  // sort. MEASURED on gemma4:12b (300-shared, 2026-07-04): the 12B's
  // per-resume named-skill counts are noisy and the deterministic sort
  // AMPLIFIES single-field errors (en NDCG@10 86.1 -> 78.0), so it is OFF
  // by default; kept as a lever for stronger reader models.
  if (extractStage && working.length > 0) {
    const champions = working.map(id => byId.get(id));
    const r = track(await readerCall(model, buildExtractPrompt(jdText, champions), numCtx, numPredict, debugLog));
    const extraction = parseExtraction(r.text, new Set(working));
    working = sortByExtraction(working, extraction, working);
  }

  return {
    ranked: mergeRanked({ reduceRanked: working, retrievalOrder }),
    calls,
    readerMs,
    tokens,
    truncations,
  };
}

/**
 * Multi-pass ensemble around the tournament: pass 2 feeds the candidates
 * in REVERSED retrieval order (different batch compositions => different
 * pairwise comparisons), and the per-pass rankings are RRF-fused. A pure
 * variance reducer for small readers — no new signal, no new logic.
 */
async function readerRankEnsemble(opts) {
  const passes = opts.ensemble ?? 1;
  const first = await readerRank(opts);
  if (passes < 2) return first;

  const reversed = await readerRank({ ...opts, candidates: [...opts.candidates].reverse() });
  const retrievalOrder = opts.candidates.map(c => c.id);
  const fused = rrfFuseRankings([first.ranked, reversed.ranked], retrievalOrder);
  return {
    ranked: mergeRanked({ reduceRanked: fused, retrievalOrder }),
    calls: first.calls + reversed.calls,
    readerMs: first.readerMs + reversed.readerMs,
    tokens: {
      prompt: first.tokens.prompt + reversed.tokens.prompt,
      eval: first.tokens.eval + reversed.tokens.eval,
    },
    truncations: first.truncations + reversed.truncations,
  };
}

function metricsFor(retrieved, goldSet, langOf, topK) {
  const r10 = recallAtK(retrieved, goldSet, 10);
  const hitLangs = {};
  for (const id of retrieved.slice(0, topK)) {
    if (goldSet.has(id)) hitLangs[langOf[id] ?? 'unknown'] = (hitLangs[langOf[id] ?? 'unknown'] ?? 0) + 1;
  }
  return {
    recall_at_10: { capped: r10.capped, raw: r10.raw, hits: r10.hits },
    precision_at_10: precisionAtK(retrieved, goldSet, 10),
    ndcg_at_10: ndcgAtK(retrieved, goldSet, 10),
    gold_hits_by_lang: hitLangs,
  };
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

async function run() {
  const mode = option('mode', 'sample');
  const k = numberOption('k', 50);
  const system = option('system', 'rrf');
  const readerModel = option('reader-model', 'gemma4:12b-it-qat');
  // Defaults sized for a 12GB card holding BOTH the reader (KV grows with
  // num_ctx — 16K KV evicted the embed model on first live run) and the
  // embed model: incumbents (~workingSize resumes) + a ~1300-token batch
  // per tournament round stays well inside a 6K ctx.
  const batchTokens = numberOption('batch-tokens', 1300);
  const workingSize = numberOption('working-size', 12);
  const numCtx = numberOption('num-ctx', 6144);
  const numPredict = numberOption('num-predict', 600);
  const jdFilter = option('jd', null); // e.g. --jd jd-en-backend (iteration aid)
  const debug = process.argv.includes('--debug');
  const extractStage = process.argv.includes('--extract-stage');
  const ensemble = numberOption('ensemble', 1);
  const outDir = resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR));
  const label = option('label', 'chat');

  // Gold + (for sample mode) the ingest source.
  let goldDoc;
  let ingestPlan = null;
  if (mode === 'sample') {
    const sampleDir = resolve(REPO_ROOT, option('sample-dir', DEFAULT_SAMPLE_DIR));
    goldDoc = JSON.parse(readFileSync(resolve(sampleDir, 'sample-gold.json'), 'utf8'));
    const storeDir = resolve(sampleDir, 'store');
    ingestPlan = { resumesPath: resolve(sampleDir, 'resumes.jsonl'), storeDir };
    rmSync(storeDir, { recursive: true, force: true });
    process.env.LONGMEM_DATA_DIR = storeDir;
  } else if (mode === 'million') {
    const corpusDir = resolve(REPO_ROOT, option('corpus-dir', DEFAULT_CORPUS_DIR));
    goldDoc = JSON.parse(readFileSync(resolve(corpusDir, 'gold.json'), 'utf8'));
    if (!process.env.LONGMEM_DATA_DIR) {
      throw new Error('million mode requires LONGMEM_DATA_DIR pointing at the existing store');
    }
  } else {
    throw new Error(`unknown --mode ${mode}`);
  }

  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  process.on('SIGINT', () => {
    client.close().finally(() => process.exit(130));
  });

  let report;
  const debugLog = debug ? [] : null;
  const tWall = performance.now();
  try {
    if (ingestPlan) {
      await client.send({ op: 'reset' });
      const t0 = performance.now();
      const added = await client.send({
        op: 'add_sessions_jsonl',
        question_id: 'jd-chat-sample',
        path: ingestPlan.resumesPath,
      });
      console.log(`[jd-chat] ingested ${added.added} rows in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
    } else {
      const expected = numberOption('expected-count', 1000000);
      const data = await client.send({ op: 'count' });
      if (Number(data.count) !== expected) {
        throw new Error(`store holds ${data.count} rows, expected ${expected} — wrong LONGMEM_DATA_DIR?`);
      }
      console.log(`[jd-chat] million mode: store verified at ${data.count} rows (query-only)`);
    }

    const results = [];
    for (const jd of JD_QUERIES) {
      if (jdFilter && jd.id !== jdFilter) continue;
      const goldSet = new Set(goldDoc.gold[jd.id] ?? []);

      // ── Stage 1: retrieval (the production narrow step) ──────────────
      const retrievalLat = [];
      let hits = [];
      for (let i = 0; i < 2; i += 1) { // run twice: cold then warm/cached
        const t0 = performance.now();
        const response = await client.send({
          op: 'search', query: jd.queryText, mode: system, limit: k, include_content: true,
        });
        retrievalLat.push(performance.now() - t0);
        hits = response.results ?? [];
      }
      const candidates = hits
        .filter(h => h.session_id && typeof h.content === 'string')
        .map(h => ({ id: h.session_id, text: h.content }));
      const retrievalOrder = candidates.map(c => c.id);

      // ── Stage 2: the reader (production brain model reads top-K) ─────
      if (debugLog) debugLog.push({ marker: `=== ${jd.id} ===` });
      const reader = await readerRankEnsemble({
        jdText: jd.queryText, candidates, model: readerModel, batchTokens, workingSize, numCtx, numPredict, extractStage, ensemble, debugLog,
      });

      const retrievalMetrics = metricsFor(retrievalOrder, goldSet, goldDoc.langOf, k);
      const chatMetrics = metricsFor(reader.ranked, goldSet, goldDoc.langOf, k);
      results.push({
        jd_id: jd.id,
        jd_lang: jd.lang,
        gold_size: goldSet.size,
        k,
        retrieval: {
          system,
          latency_ms: { cold: Number(retrievalLat[0].toFixed(2)), warm: Number(retrievalLat.at(-1).toFixed(2)) },
          gold_in_pool: retrievalOrder.filter(id => goldSet.has(id)).length,
          ...retrievalMetrics,
          top_20: retrievalOrder.slice(0, 20),
        },
        chat_pipeline: {
          reader_model: readerModel,
          reader_calls: reader.calls,
          reader_ms: Number(reader.readerMs.toFixed(0)),
          reader_tokens: reader.tokens,
          reader_truncations: reader.truncations,
          total_ms: Number((retrievalLat.at(-1) + reader.readerMs).toFixed(0)),
          ...chatMetrics,
          top_20: reader.ranked.slice(0, 20),
        },
      });
      const r = results.at(-1);
      console.log(`[jd-chat] ${jd.id}: retrieval NDCG@10=${pct(r.retrieval.ndcg_at_10)} `
        + `(gold_in_pool=${r.retrieval.gold_in_pool}/${Math.min(goldSet.size, k)}) -> `
        + `chat NDCG@10=${pct(r.chat_pipeline.ndcg_at_10)} P@10=${pct(r.chat_pipeline.precision_at_10)} `
        + `(${r.chat_pipeline.reader_calls} reader calls, ${(r.chat_pipeline.reader_ms / 1000).toFixed(1)}s)`);
    }

    const longmemVars = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('LONGMEM_') || key === 'LCM_CONV_AWARE') longmemVars[key] = value;
    }
    report = {
      benchmark: `MILLION-RESUME-2 chat-pipeline (${mode})`,
      generated_at: new Date().toISOString(),
      mode,
      config: {
        k, system, reader_model: readerModel, batch_tokens: batchTokens,
        working_size: workingSize, num_ctx: numCtx, num_predict: numPredict, ensemble,
        strategy: extractStage ? 'streaming-top-n-tournament+extract-sort' : 'streaming-top-n-tournament',
      },
      env: { longmem_vars: longmemVars, ollama_host: OLLAMA_HOST, node: process.version, platform: `${process.platform} ${process.arch}` },
      wall_seconds_total: Number(((performance.now() - tWall) / 1000).toFixed(3)),
      results,
    };
  } finally {
    await client.close();
  }
  report.wall_seconds_total = Number(((performance.now() - tWall) / 1000).toFixed(3));

  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `chat-pipeline-${label}-${mode}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[jd-chat] wrote ${outPath} (wall ${report.wall_seconds_total}s)`);
  if (debugLog) {
    const debugPath = resolve(outDir, `chat-pipeline-${label}-${mode}.debug.json`);
    writeFileSync(debugPath, `${JSON.stringify(debugLog, null, 2)}\n`, 'utf8');
    console.log(`[jd-chat] wrote ${debugPath} (${debugLog.length} reader events)`);
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'run') return run();
  console.log('Usage: node benchmark/scripts/jd-chat-pipeline.mjs run [--mode sample|million] [--k 50] [--system rrf]');
  console.log('  [--reader-model gemma4:12b-it-qat] [--batch-tokens 1500] [--num-ctx 6144] [--num-predict 600]');
  console.log('  [--jd <jd-id>] [--debug] [--label chat] [--sample-dir|--corpus-dir|--expected-count|--out-dir]');
  if (cmd) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[jd-chat] failed: ${err.message}`);
  process.exit(1);
});
