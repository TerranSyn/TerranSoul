#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// JD-DEMO scaled runner (2026-07-06). The single entry point behind
// `/demo jd [1-3] [count]`: run the JD demo/bench at an ARBITRARY résumé
// count and a chosen thinking level, on the REAL production store path.
//
// It threads the `count` through the SAME deterministic corpus + gold + shim
// ingest + three-level query stages the 1,000,000-résumé bench uses — just
// with fewer rows (résumé N is a pure function of (seed, N), so a 40,000-row
// run is the first 40,000 rows of the exact same corpus). No new retrieval
// logic, no gold shown to the system, single-source-of-truth CRUD through the
// longmemeval-ipc shim → production MemoryStore.
//
// It is a THIN SEQUENCER over the existing, tested stage scripts (each stays
// the single source of truth for its stage):
//   Stage A (ingest + Chat) : jd-million-bench.mjs run --count N --systems rrf
//                             → count-scoped store ingest (time + rows/s) and
//                               the raw-retrieval (Chat) NDCG@10 per JD.
//   Stage B (Chat + Think)  : jd-chat-pipeline.mjs run --mode million
//                             → retrieval block (Chat) + reader-tournament
//                               rerank (Think).
//   Stage C (Max)           : jd-max-bench.mjs run --mode million
//                             → agentic wide-retrieve + verify-from-text (Max).
// Then consolidates the per-level per-language NDCG@10, response times and the
// one-time ingest cost into jd-demo-<count>.json.
//
// Coexistence: pins the PREBUILT shim (LONGMEM_SHIM_EXE) so it never runs
// `cargo` (no build contention with a concurrent Boeing bench); Think/Max use
// the local gemma4 GPU model. Uses a COUNT-SCOPED store/corpus dir
// (C:/TerranSoul/jd-<count>/) so it never touches the 1,000,000-row store.
//
// LOCAL-ONLY per rules/ci-vs-local-testing.md (cargo shim + local Ollama).
//
// Usage:
//   node benchmark/scripts/jd-demo-run.mjs --count 40000 --level 3
//   node benchmark/scripts/jd-demo-run.mjs --count 40000 --level all
//   node benchmark/scripts/jd-demo-run.mjs --count 40000 --level all --reuse-store
//
//   --count N       résumé count to generate + ingest (required)
//   --level 1|2|3|all   1=Chat, 2=Think, 3=Max, all=all three (default all)
//   --seed S        corpus seed (default DEFAULT_SEED, = the 1M corpus seed)
//   --corpus-dir D  corpus+store dir (default C:/TerranSoul/jd-<count> or repo fallback)
//   --out-dir D     result dir (default benchmark/results/jd-<count>)
//   --reuse-store   keep an existing count-scoped store (ingest only the tail)
//   --label L       output label suffix (default demo-<count>)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED } from './jd-corpus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const PREBUILT_SHIM = resolve(TARGET_DIR, 'debug', 'longmemeval-ipc.exe');

// ── CLI plumbing (`--name value` and `--name=value`) ───────────────────────
function option(name, def) {
  const argv = process.argv.slice(2);
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return def;
}
function hasFlag(name) { return process.argv.slice(2).includes(`--${name}`); }
function intOption(name, def) {
  const raw = option(name, String(def));
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got ${raw}`);
  return n;
}

// ── Level parsing (mirrors run-demo.mjs / the /demo skill) ──────────────────
// 1 = Chat (no thinking), 2 = Think (rerank), 3 = Max (agentic verify), all = all three.
function parseLevel() {
  const raw = String(option('level', 'all')).toLowerCase();
  if (raw === 'all') return { chat: true, think: true, max: true, tag: 'all' };
  if (raw === '1') return { chat: true, think: false, max: false, tag: '1' };
  if (raw === '2') return { chat: true, think: true, max: false, tag: '2' };
  if (raw === '3') return { chat: true, think: false, max: true, tag: '3' };
  throw new Error(`--level must be 1 (Chat), 2 (Think), 3 (Max), or all — got "${raw}"`);
}

function spawnStage(label, script, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`\n[jd-demo] ── ${label}: node ${script} ${args.join(' ')}`);
    const child = spawn(process.execPath, [resolve(__dirname, script), ...args], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env,
    });
    child.on('exit', code => (code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${label} exited with code ${code}`))));
    child.on('error', rejectPromise);
  });
}

const readJson = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const r1 = v => (v == null ? null : Number((v * 100).toFixed(1)));
const LANG_OF_JD = { 'jd-en-backend': 'en', 'jd-vi-data-engineering': 'vi', 'jd-ja-mobile': 'ja' };

async function main() {
  const count = intOption('count', 0); // 0 → throws (must be provided)
  const level = parseLevel();
  const seed = intOption('seed', DEFAULT_SEED);
  const reuseStore = hasFlag('reuse-store');
  const label = option('label', `demo-${count}`);

  // Count-scoped dirs — NEVER the 1M jdbench store. Prefer the C:\ SSD.
  const defaultCorpus = existsSync('C:/TerranSoul')
    ? `C:/TerranSoul/jd-${count}`
    : resolve(TARGET_DIR, `jd-${count}`);
  const corpusDir = resolve(REPO_ROOT, option('corpus-dir', defaultCorpus));
  const storeDir = resolve(corpusDir, 'store');
  const outDir = resolve(REPO_ROOT, option('out-dir', resolve(REPO_ROOT, 'benchmark', 'results', `jd-${count}`)));

  if (!existsSync(PREBUILT_SHIM)) {
    throw new Error(`prebuilt shim missing: ${PREBUILT_SHIM}\n`
      + 'Build it first (verify rustc/cargo idle, then -j 1):\n'
      + '  cd src-tauri && cargo build --bin longmemeval-ipc --target-dir ../target-copilot-bench');
  }

  // Env shared by every stage: pin the store + the prebuilt shim (no cargo).
  const env = { ...process.env, LONGMEM_DATA_DIR: storeDir, LONGMEM_SHIM_EXE: PREBUILT_SHIM };

  mkdirSync(outDir, { recursive: true });
  console.log(`[jd-demo] count=${count.toLocaleString('en-US')} level=${level.tag} seed=${seed}`);
  console.log(`[jd-demo] corpus=${corpusDir}`);
  console.log(`[jd-demo] store =${storeDir}`);
  console.log(`[jd-demo] out   =${outDir}`);
  console.log(`[jd-demo] shim  =${PREBUILT_SHIM} (no cargo)`);

  // ── Stage A — ingest (+ raw-retrieval Chat). Always runs: it is the only
  //    stage that WRITES the store; B/C are query-only million-mode readers.
  const millionArgs = [
    'run', '--count', String(count), '--seed', String(seed),
    '--systems', 'rrf', '--corpus-dir', corpusDir, '--out-dir', outDir,
  ];
  if (reuseStore) millionArgs.push('--resume');
  await spawnStage('Stage A ingest+Chat (jd-million-bench)', 'jd-million-bench.mjs', millionArgs, env);
  const ingestReport = readJson(resolve(outDir, 'report.json'));

  // ── Stage B — Chat + Think (reader tournament). Only when a thinking level
  //    is requested (level 2 or all).
  let chatPipeline = null;
  if (level.think) {
    await spawnStage('Stage B Chat+Think (jd-chat-pipeline)', 'jd-chat-pipeline.mjs', [
      'run', '--mode', 'million', '--corpus-dir', corpusDir,
      '--expected-count', String(count), '--out-dir', outDir, '--label', label,
    ], env);
    chatPipeline = readJson(resolve(outDir, `chat-pipeline-${label}-million.json`));
  }

  // ── Stage C — Max (agentic wide-retrieve + verify). Only for level 3 or all.
  let maxReport = null;
  if (level.max) {
    await spawnStage('Stage C Max (jd-max-bench)', 'jd-max-bench.mjs', [
      'run', '--mode', 'million', '--corpus-dir', corpusDir,
      '--expected-count', String(count), '--out-dir', outDir, '--label', label,
    ], env);
    maxReport = readJson(resolve(outDir, `jd-max-${label}.json`));
  }

  // ── Consolidate ────────────────────────────────────────────────────────
  // Chat = chat-pipeline retrieval block (matches the §1 doc definition) when
  // Stage B ran; otherwise the Stage-A rrf query (identical top-10 order).
  const chatById = new Map((chatPipeline?.results ?? []).map(r => [r.jd_id, r]));
  const rrfById = new Map((ingestReport?.results ?? [])
    .filter(r => r.system === 'rrf').map(r => [r.jd_id, r]));
  const maxById = new Map((maxReport?.results ?? []).map(r => [r.jd_id, r]));

  const levels = ['jd-en-backend', 'jd-vi-data-engineering', 'jd-ja-mobile'].map(jdId => {
    const lang = LANG_OF_JD[jdId];
    const cp = chatById.get(jdId);
    const rrf = rrfById.get(jdId);
    const mx = maxById.get(jdId);
    return {
      jd_id: jdId,
      lang,
      gold_size: cp?.gold_size ?? mx?.gold_size ?? rrf?.gold_size ?? null,
      chat: level.chat
        ? {
          ndcg_at_10: cp ? r1(cp.retrieval.ndcg_at_10) : (rrf ? r1(rrf.ndcg_at_10) : null),
          latency_ms: cp ? cp.retrieval.latency_ms : (rrf ? rrf.latency_ms : null),
        }
        : null,
      think: level.think && cp
        ? {
          ndcg_at_10: r1(cp.chat_pipeline.ndcg_at_10),
          retrieval_ms: cp.retrieval.latency_ms.cold,
          reader_ms: cp.chat_pipeline.reader_ms,
          total_ms: cp.chat_pipeline.total_ms,
          reader_calls: cp.chat_pipeline.reader_calls,
        }
        : null,
      max: level.max && mx
        ? {
          ndcg_at_10: r1(mx.accuracy.ndcg_at_10),
          retrieval_ms: mx.retrieval.latency_ms,
          verify_ms: mx.verify.verify_ms,
          judge_ms: mx.verify.judge_ms,
          total_ms: mx.total_ms,
          gold_in_pool: mx.retrieval.gold_in_pool,
        }
        : null,
    };
  });

  const ingest = ingestReport?.ingest ?? null;
  const report = {
    benchmark: `JD-DEMO — scaled run (${count.toLocaleString('en-US')} résumés)`,
    generated_at: new Date().toISOString(),
    scale: { resumes: count, jds: 3, langs_in_corpus: 7, seed },
    level: level.tag,
    learn: ingest
      ? {
        rows: ingest.rows,
        seconds: ingest.elapsedSeconds,
        rows_per_sec: ingest.rowsPerSecond,
        path: ingest.path,
        start_index: ingest.start_index ?? 0,
      }
      : null,
    retrieval_substrate: {
      system: 'rrf (FTS5 lexical + freshness fusion)',
      dense_channel: env.LONGMEM_EMBED === '1',
      note: 'Purely lexical retrieval (no embeddings, no KG edges) — same substrate as the 1M run. '
        + 'Cross-lingual recall comes from the universal Latin skills line every résumé carries.',
    },
    env: {
      data_dir: storeDir,
      shim: PREBUILT_SHIM,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
    },
    levels_meaning: {
      chat: 'no thinking — raw single-query rrf top-k order',
      think: 'with thinking — reader tournament reranks the single-retrieval pool',
      max: 'highest thinking — agentic wide retrieve + verify-from-text',
    },
    levels,
  };

  const outPath = resolve(outDir, `jd-demo-${count}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  // ── Console summary ──────────────────────────────────────────────────────
  const p = n => (n == null ? '   -  ' : `${n.toFixed(1)}%`.padStart(6));
  console.log(`\nJD-DEMO NDCG@10 — ${count.toLocaleString('en-US')} résumés (lexical FTS5, dense/KG OFF)\n`);
  console.log('JD                          lang   CHAT    THINK    MAX');
  for (const l of levels) {
    console.log(`${l.jd_id.padEnd(27)} ${l.lang.padEnd(4)} ${p(l.chat?.ndcg_at_10)} ${p(l.think?.ndcg_at_10)} ${p(l.max?.ndcg_at_10)}`);
  }
  if (report.learn) {
    console.log(`\nLearn: ${report.learn.rows.toLocaleString('en-US')} rows in `
      + `${report.learn.seconds.toFixed(1)}s (${report.learn.rows_per_sec.toLocaleString('en-US')} rows/s)`);
  }
  console.log(`\n[jd-demo] wrote ${outPath}`);
}

main().catch(err => {
  console.error(`[jd-demo] failed: ${err.message}`);
  process.exit(1);
});
