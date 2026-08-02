#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// LongMemEval-S adapter for TerranSoul's MemoryStore. This runner downloads
// the cleaned LongMemEval-S dataset, streams each question's session haystack
// into a small Rust JSONL IPC shim, and writes retrieval-only benchmark reports
// that match agentmemory's LongMemEval-S methodology.

import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import { buildJudgePrompt, chunkSessionToText } from './lib/longmem-judge-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_DATA_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'longmemeval');
const DEFAULT_DATASET_PATH = resolve(DEFAULT_DATA_DIR, 'longmemeval_s_cleaned.json');
// Committed reports live under benchmark/results/ (matches --help and the
// rest of the benchmark layout). Build cache + datasets stay in the
// gitignored target-copilot-bench/.
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const DATASET_URL = 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json';
const ABSTENTION_TYPES = new Set([
  'single-session-user_abs',
  'multi-session_abs',
  'knowledge-update_abs',
  'temporal-reasoning_abs',
]);
// Published bench surface = the four real thinking modes (rules/bench-thinking-modes.md);
// each routes through the production pipeline in longmemeval_ipc::thinking_mode_search.
const DEFAULT_SYSTEMS = ['chat', 'think', 'research', 'max'];

function option(name, defaultValue) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(3).find(arg => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : defaultValue;
}

function hasFlag(name) {
  return process.argv.slice(3).includes(`--${name}`);
}

function numberOption(name, defaultValue) {
  const raw = option(name, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, got ${raw}`);
  }
  return parsed;
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

/**
 * BENCH-OPS-1(a), 2026-07-30: `npm run brain:longmem:run` never called
 * `bench-guard.mjs --preflight`, so a 4-arm run once spent 32 minutes at
 * 17.9s/embed round-trip (against 0.13s GPU-resident, 135x) before anyone
 * thought to check `/api/ps` — the guard existed and would have caught it
 * instantly, it just was not wired into this entrypoint (only the separate
 * `max100-full500.mjs` launcher called it). Runs the SAME base preflight
 * `npm run bench:preflight` does (disk/out-dir/GPU/model-installed/embedder-
 * GPU-placement) before any dataset download or arm starts. Deliberately
 * does NOT pass `--require-ipc-binary`/`--require-cargo-quiet` here: this
 * entrypoint supports both `cargo run` (builds on demand) and a prebuilt
 * `LONGMEM_IPC_CMD` binary, so a stale-binary/cargo-quiet gate belongs to a
 * launcher that knows which mode it's using (as `max100-full500.mjs`
 * already does), not to this base check. `--skip-preflight` opts out
 * entirely, for a quick local iteration where the extra ~20-30s round-trip
 * isn't worth it.
 */
function runPreflight(outDir) {
  if (hasFlag('skip-preflight')) {
    console.error('[longmem] --skip-preflight: bypassing bench-guard preflight.');
    return;
  }
  const args = [resolve(REPO_ROOT, 'scripts', 'bench-guard.mjs'), '--preflight', '--out-dir', outDir];
  const chatModel = option('chat-model', process.env.LONGMEM_CHAT_MODEL);
  if (chatModel) args.push('--chat-model', chatModel);
  console.error('[longmem] running bench-guard preflight (pass --skip-preflight to bypass)…');
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[longmem] PREFLIGHT FAILED (exit ${result.status}) — not running. Pass --skip-preflight to bypass.`);
    process.exit(result.status ?? 1);
  }
}

function printHelp() {
  console.log(`TerranSoul LongMemEval-S adapter

Usage:
  npm run brain:longmem:prepare
  npm run brain:longmem:run -- --systems=search,rrf --limit=0
  npm run brain:longmem:sample

Commands:
  prepare   Download longmemeval_s_cleaned.json into target-copilot-bench/longmemeval
  run       Run retrieval-only LongMemEval-S through the MemoryStore IPC shim
  sample    Run a tiny built-in smoke dataset through the same IPC path
  help      Print this help

Options for run:
  --dataset=<path>                 Dataset path (default: target-copilot-bench/longmemeval/longmemeval_s_cleaned.json)
  --out-dir=<path>                 Report directory (default: benchmark/results)
  --limit=<n>                      First n non-abstention questions; 0 means all (default: 0)
  --resume                         Continue an interrupted run from <out-dir>/checkpoint.jsonl.
                                   Refuses if the env/flags differ from the checkpointed run.
  --report-only                    Rebuild reports from the checkpoint without running anything
                                   (refuses to write if the checkpoint is incomplete)
  --systems=search,rrf             Systems to evaluate (default: search,rrf)
  --top-k=<n>                      Retrieval depth sent to MemoryStore (default: 20)
  --no-download                    Fail if dataset is missing instead of downloading
  --with-judge                     Add optional Ollama evidence-support diagnostics
  --judge-model=<name>             Ollama model for diagnostics (default: qwen2.5:14b)
  --ollama-url=<url>               Ollama base URL (default: http://127.0.0.1:11434)
  --judge-top-k=<n>                Retrieved sessions shown to judge (default: 5)
  --judge-max-session-chars=<n>    Per-session context cap for judge (default: 1800)
`);
}

async function downloadDataset(datasetPath = DEFAULT_DATASET_PATH) {
  mkdirSync(dirname(datasetPath), { recursive: true });
  console.log(`[longmem] downloading ${DATASET_URL}`);
  console.log(`[longmem] target ${datasetPath}`);
  const response = await fetch(DATASET_URL);
  if (!response.ok || !response.body) {
    throw new Error(`failed to download dataset (HTTP ${response.status}) from ${DATASET_URL}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(datasetPath));
  const stats = JSON.parse(readFileSync(datasetPath, 'utf8'));
  if (!Array.isArray(stats)) {
    throw new Error(`downloaded dataset is not a JSON array: ${datasetPath}`);
  }
  console.log(`[longmem] downloaded ${stats.length.toLocaleString('en-US')} rows`);
}

function sampleDataset() {
  return [
    {
      question_id: 'sample-1',
      question_type: 'single-session-user',
      question: 'Which drink does Alex prefer while coding?',
      question_date: '2026-01-02',
      answer: 'Alex prefers green tea while coding.',
      answer_session_ids: ['sample-s2'],
      haystack_dates: ['2026-01-01', '2026-01-02'],
      haystack_session_ids: ['sample-s1', 'sample-s2'],
      haystack_sessions: [
        [
          { role: 'user', content: 'I debugged the sync issue after lunch.' },
          { role: 'assistant', content: 'We found the problem in the queue retry path.' },
        ],
        [
          { role: 'user', content: 'Please remember that I prefer green tea while coding.' },
          { role: 'assistant', content: 'Noted: green tea is your coding drink.' },
        ],
      ],
    },
    {
      question_id: 'sample-2',
      question_type: 'multi-session',
      question: 'Where was the retry bug fixed?',
      question_date: '2026-01-03',
      answer: 'The retry bug was fixed in the queue worker.',
      answer_session_ids: ['sample-s3'],
      haystack_dates: ['2026-01-02', '2026-01-03'],
      haystack_session_ids: ['sample-s2', 'sample-s3'],
      haystack_sessions: [
        [
          { role: 'user', content: 'Green tea is still the coding drink.' },
          { role: 'assistant', content: 'Got it.' },
        ],
        [
          { role: 'user', content: 'The retry bug was fixed in the queue worker today.' },
          { role: 'assistant', content: 'I will connect future retry questions to the queue worker fix.' },
        ],
      ],
    },
  ];
}

function loadDataset(datasetPath) {
  if (!existsSync(datasetPath)) {
    throw new Error(`missing dataset: ${datasetPath}`);
  }
  const raw = JSON.parse(readFileSync(datasetPath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`dataset must be a JSON array: ${datasetPath}`);
  }
  return raw;
}

function validateEntry(entry) {
  const required = [
    'question_id',
    'question_type',
    'question',
    'answer_session_ids',
    'haystack_session_ids',
    'haystack_sessions',
  ];
  for (const key of required) {
    if (!(key in entry)) throw new Error(`dataset entry missing ${key}`);
  }
  if (!Array.isArray(entry.answer_session_ids)) throw new Error(`answer_session_ids must be an array for ${entry.question_id}`);
  if (!Array.isArray(entry.haystack_session_ids)) throw new Error(`haystack_session_ids must be an array for ${entry.question_id}`);
  if (!Array.isArray(entry.haystack_sessions)) throw new Error(`haystack_sessions must be an array for ${entry.question_id}`);
  if (entry.haystack_session_ids.length !== entry.haystack_sessions.length) {
    throw new Error(`haystack id/session length mismatch for ${entry.question_id}`);
  }
}

function filteredEntries(raw, limit) {
  const entries = raw.filter(entry => !ABSTENTION_TYPES.has(entry.question_type));
  entries.forEach(validateEntry);
  return limit > 0 ? entries.slice(0, limit) : entries;
}

function sessionPayloads(entry) {
  return entry.haystack_session_ids.map((sessionId, index) => {
    const turns = entry.haystack_sessions[index];
    return {
      session_id: sessionId,
      text: chunkSessionToText(turns),
      date: entry.haystack_dates?.[index] ?? null,
      turn_count: turns.length,
    };
  });
}

function recallAny(retrievedSessionIds, goldSessionIds, k) {
  const top = new Set(retrievedSessionIds.slice(0, k));
  return goldSessionIds.some(id => top.has(id)) ? 1.0 : 0.0;
}

function dcg(relevances, k) {
  let sum = 0;
  for (let index = 0; index < Math.min(k, relevances.length); index += 1) {
    if (relevances[index]) sum += 1 / Math.log2(index + 2);
  }
  return sum;
}

function ndcg(retrievedSessionIds, goldSessionIds, k) {
  const gold = new Set(goldSessionIds);
  const seen = new Set();
  const deduped = retrievedSessionIds.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
  const actual = deduped.slice(0, k).map(id => gold.has(id));
  const ideal = Array.from({ length: Math.min(k, gold.size) }, () => true);
  const idealDcg = dcg(ideal, k);
  return idealDcg === 0 ? 0 : dcg(actual, k) / idealDcg;
}

// MAX-100-17: `mrr` scans the WHOLE retrieved array, so it is really
// MRR@top_k — comparing it across two arms with different `--top-k` values
// changes the metric's own definition, not just the retrieval quality it is
// meant to measure (a gold sitting at rank 21-50 only counts once top_k
// reaches 50, with zero actual retrieval improvement). `mrr(list, gold, k)`
// takes an explicit k so callers can report a FIXED-k MRR (comparable across
// any top_k) alongside the natural MRR@top_k (labelled with the real k used).
export function mrr(retrievedSessionIds, goldSessionIds, k = retrievedSessionIds.length) {
  const gold = new Set(goldSessionIds);
  const index = retrievedSessionIds.slice(0, k).findIndex(id => gold.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`;
}

function printTable(headers, rows) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map(row => String(row[index]).length),
  ));
  const printRow = row => console.log(row.map((cell, index) => String(cell).padEnd(widths[index])).join('  '));
  printRow(headers);
  printRow(widths.map(width => '-'.repeat(width)));
  rows.forEach(printRow);
}

/**
 * How to start the Rust IPC child.
 *
 * DEFAULT (unchanged): `cargo run`, which builds if needed. That is convenient
 * interactively and a hazard for a long unattended arm — if any other cargo
 * holds the shared target-dir lock, `cargo run` BLOCKS with no output
 * ("Blocking waiting for file lock on build directory"), so a launch that
 * appears to be running is really waiting, indistinguishable from a slow first
 * question. It also means the run compiles whatever is on disk at launch
 * instead of a binary someone verified.
 *
 * `LONGMEM_IPC_CMD` (JSON array, e.g. `["D:/…/longmemeval-ipc.exe"]`) spawns a
 * PREBUILT binary directly: no build step, no lock to wait on, and the exact
 * artifact the preflight checked. This is what the full-500 launcher uses.
 */
function ipcCommand() {
  const raw = process.env.LONGMEM_IPC_CMD;
  if (raw && raw.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`LONGMEM_IPC_CMD must be a JSON array of [command, ...args]: ${err.message}`, { cause: err });
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some(part => typeof part !== 'string')) {
      throw new Error(`LONGMEM_IPC_CMD must be a non-empty JSON array of strings, got: ${raw}`);
    }
    return { command: parsed[0], args: parsed.slice(1) };
  }
  return {
    command: 'cargo',
    args: [
      'run',
      '--quiet',
      '--manifest-path',
      resolve(REPO_ROOT, 'src-tauri', 'Cargo.toml'),
      '--bin',
      'longmemeval-ipc',
      '--target-dir',
      DEFAULT_TARGET_DIR,
    ],
  };
}

class JsonlClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    const { command, args } = ipcCommand();
    this.proc = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => process.stderr.write(chunk));
    this.proc.on('exit', code => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`IPC process exited before response (code ${code})`));
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      throw new Error(`invalid IPC JSON: ${line}\n${err.message}`, { cause: err });
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error ?? `IPC request ${message.id} failed`));
  }

  send(payload) {
    const id = this.nextId;
    this.nextId += 1;
    const line = JSON.stringify({ id, ...payload });
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.proc.stdin.write(`${line}\n`, err => {
        if (err) {
          this.pending.delete(id);
          rejectPromise(err);
        }
      });
    });
  }

  async close() {
    if (!this.proc.killed) {
      try {
        await this.send({ op: 'shutdown' });
      } catch {
        this.proc.kill();
      }
    }
  }
}

async function judgeEvidence(entry, retrievedSessionIds, options) {
  const prompt = buildJudgePrompt(entry, retrievedSessionIds, options);
  const response = await fetch(`${options.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.judgeModel,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: 'Return compact valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama judge failed (HTTP ${response.status})`);
  }
  const body = await response.json();
  const raw = body.message?.content ?? body.response ?? '{}';
  try {
    const parsed = JSON.parse(raw);
    return {
      supported: parsed.supported === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return { supported: false, reason: raw.slice(0, 200) };
  }
}

export function aggregateSystem(system, perQuestion) {
  return {
    system,
    questions: perQuestion.length,
    recall_any_at_5: avg(perQuestion.map(result => result.recall_any_at_5)),
    recall_any_at_10: avg(perQuestion.map(result => result.recall_any_at_10)),
    recall_any_at_20: avg(perQuestion.map(result => result.recall_any_at_20)),
    ndcg_at_10: avg(perQuestion.map(result => result.ndcg_at_10)),
    mrr_at_20: avg(perQuestion.map(result => result.mrr_at_20)),
    mrr: avg(perQuestion.map(result => result.mrr)),
    avg_latency_ms: avg(perQuestion.map(result => result.latency_ms)),
    avg_retrieved_tokens: avg(perQuestion.map(result => result.retrieved_tokens)),
    judge_support_rate: perQuestion.some(result => result.judge_supported !== null)
      ? avg(perQuestion.filter(result => result.judge_supported !== null).map(result => result.judge_supported ? 1 : 0))
      : null,
    per_question: perQuestion,
  };
}

export function perType(systemResult) {
  const groups = new Map();
  for (const result of systemResult.per_question) {
    if (!groups.has(result.question_type)) groups.set(result.question_type, []);
    groups.get(result.question_type).push(result);
  }
  return Object.fromEntries([...groups].map(([type, results]) => [type, {
    count: results.length,
    recall_any_at_5: avg(results.map(result => result.recall_any_at_5)),
    recall_any_at_10: avg(results.map(result => result.recall_any_at_10)),
    ndcg_at_10: avg(results.map(result => result.ndcg_at_10)),
    mrr_at_20: avg(results.map(result => result.mrr_at_20)),
    mrr: avg(results.map(result => result.mrr)),
  }]));
}

// Env stamp (2026-07-03 RRF-archaeology guardrail): the entire "rrf
// regression" episode came from unrecorded embedder configuration
// differences between runs — every report must carry the exact LONGMEM_*
// env so a future metric delta can never be misattributed to code again.
//
// `OLLAMA_*` is stamped too (added 2026-07-27): `OLLAMA_EMBED_NUM_GPU` decides
// whether the embedder runs on GPU or CPU, which is a 135x latency difference
// and the single most damaging variable to leave unrecorded — yet it does not
// start with `LONGMEM_`, so the guardrail above was blind to exactly the knob
// most likely to be forgotten.
function longmemEnvStamp() {
  const keys = Object.keys(process.env)
    .filter(k => k.startsWith('LONGMEM_') || k.startsWith('OLLAMA_'))
    .sort();
  const pairs = keys.map(k => `${k}=${process.env[k]}`);
  const embedModel = process.env.LONGMEM_EMBED === '1'
    ? (process.env.LONGMEM_EMBED_MODEL ?? 'mxbai-embed-large (harness default)')
    : 'none (LONGMEM_EMBED unset — dense channel OFF)';
  return `${pairs.length ? pairs.join(' ') : '(no LONGMEM_* vars set)'} | effective embed model: ${embedModel}`;
}

export function markdownReport(report) {
  const lines = [];
  const w = line => lines.push(line);
  w('# TerranSoul LongMemEval-S Retrieval Report');
  w('');
  w(`Date: ${report.generated_at}`);
  w(`Dataset: ${report.dataset_source}`);
  w(`Questions: ${report.questions} (${report.excluded_abstention} abstention rows excluded)`);
  w(`Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts`);
  w(`Env: ${longmemEnvStamp()}`);
  w('');
  // MAX-100-17: MRR@20 is a FIXED window, comparable to any other arm's
  // MRR@20 regardless of --top-k; the MRR column is the NATURAL MRR@top_k
  // (labelled with the real k used, since it is only comparable to another
  // arm run at that same --top-k — see the mrr() doc comment above).
  w(`| System | R@5 | R@10 | R@20 | NDCG@10 | MRR@20 | MRR@${report.top_k} | Avg latency | Avg retrieved tokens |`);
  w('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const system of report.systems) {
    w(`| ${system.system} | ${pct(system.recall_any_at_5)} | ${pct(system.recall_any_at_10)} | ${pct(system.recall_any_at_20)} | ${pct(system.ndcg_at_10)} | ${pct(system.mrr_at_20)} | ${pct(system.mrr)} | ${formatMs(system.avg_latency_ms)} | ${Math.round(system.avg_retrieved_tokens).toLocaleString('en-US')} |`);
  }
  w('');
  if (report.judge) {
    w('## Optional Ollama Evidence Judge');
    w('');
    w(`Model: ${report.judge.model}`);
    w('');
    w('| System | Support rate |');
    w('|---|---:|');
    for (const system of report.systems) {
      const value = system.judge_support_rate === null ? 'not run' : pct(system.judge_support_rate);
      w(`| ${system.system} | ${value} |`);
    }
    w('');
  }
  w('## By Question Type');
  for (const system of report.systems) {
    w('');
    w(`### ${system.system}`);
    w('');
    w(`| Type | Count | R@5 | R@10 | NDCG@10 | MRR@20 | MRR@${report.top_k} |`);
    w('|---|---:|---:|---:|---:|---:|---:|');
    for (const [type, stats] of Object.entries(system.per_type)) {
      w(`| ${type} | ${stats.count} | ${pct(stats.recall_any_at_5)} | ${pct(stats.recall_any_at_10)} | ${pct(stats.ndcg_at_10)} | ${pct(stats.mrr_at_20)} | ${pct(stats.mrr)} |`);
    }
  }
  w('');
  w('## Methodology Notes');
  w('');
  w('- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.');
  w('- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question\'s haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.');
  w('- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory\'s published retrieval-only number.');
  return `${lines.join('\n')}\n`;
}

// ─── Crash-resume checkpoint ───────────────────────────────────────────────
//
// WHY (2026-07-27). A full-500 `max` arm is a ~12h unattended run, and until
// now EVERY per-question result lived only in the in-process `perSystem` map:
// `writeReports` ran once, after the last question. A crash, an OOM, a wedged
// Ollama, or a power cut at question 480 destroyed all 480 results and the
// arm restarted from zero. That is not an acceptable failure mode for an
// overnight window — and it already happened once (the 11h arm lost to a dead
// backend, commit a69f82d9).
//
// Each (system, question) result is appended to `checkpoint.jsonl` the instant
// it is produced, so the worst a crash can cost is the question in flight.
//
// RESUMING A DIFFERENT CONFIGURATION IS THE REAL HAZARD, not the crash. Two
// halves of one report silently measured under different flags/env is exactly
// the defect class this campaign exists to remove (the 95.1-vs-95.0 "floor"
// that turned out to be two different experiments). So the checkpoint carries
// a fingerprint of everything that can move a number, and a resume whose
// fingerprint differs REFUSES to run rather than splicing.
function checkpointPaths(outDir) {
  return {
    jsonl: resolve(outDir, 'checkpoint.jsonl'),
    meta: resolve(outDir, 'checkpoint.meta.json'),
  };
}

/** Everything that can move a metric. Any difference blocks a resume. */
function runFingerprint(options, questionCount) {
  return {
    systems: [...options.systems].sort(),
    top_k: options.topK,
    limit: options.limit,
    questions: questionCount,
    dataset_source: options.datasetSource,
    with_judge: options.withJudge,
    judge_model: options.withJudge ? options.judgeModel : null,
    judge_top_k: options.withJudge ? options.judgeTopK : null,
    env: longmemEnvStamp(),
  };
}

// Params are named for their ROLE, not `expected`/`actual`: the call site
// passes (this run, checkpoint) and the previous labels were inverted, so a
// mismatch reported the checkpoint's value as "this run" and vice versa —
// sending anyone debugging a fingerprint mismatch to fix the wrong side.
function fingerprintDiff(thisRun, checkpoint) {
  const diffs = [];
  for (const key of Object.keys(thisRun)) {
    const mine = JSON.stringify(thisRun[key]);
    const theirs = JSON.stringify(checkpoint?.[key]);
    if (mine !== theirs) {
      diffs.push(`  ${key}:\n    checkpoint: ${theirs}\n    this run:   ${mine}`);
    }
  }
  return diffs;
}

/**
 * Read a checkpoint into `system -> Map(question_id -> record)`.
 *
 * A crash can tear the FINAL line mid-write, so an unparseable last line is
 * dropped (that question simply gets redone). An unparseable line anywhere
 * earlier means the file is corrupt, which is reported rather than guessed at.
 */
function loadCheckpoint(jsonlPath) {
  const done = new Map();
  if (!existsSync(jsonlPath)) return { done, records: 0, torn: false };
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(line => line.trim());
  let records = 0;
  let torn = false;
  for (let i = 0; i < lines.length; i += 1) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (err) {
      if (i === lines.length - 1) {
        torn = true;
        break;
      }
      throw new Error(
        `corrupt checkpoint at ${jsonlPath} line ${i + 1}: ${err.message}. ` +
          'Delete the file to restart this arm from zero, or use a fresh --out-dir.',
        { cause: err },
      );
    }
    const { system, ...record } = parsed;
    if (!system || !record.question_id) {
      throw new Error(`checkpoint line ${i + 1} is missing system/question_id: ${jsonlPath}`);
    }
    if (!done.has(system)) done.set(system, new Map());
    // First writer wins: a duplicate can only come from a torn+retried write,
    // and the earlier record is the one already counted in any prior report.
    if (!done.get(system).has(record.question_id)) {
      done.get(system).set(record.question_id, record);
      records += 1;
    }
  }
  return { done, records, torn };
}

/**
 * Prepare the checkpoint for this run and return the already-completed work.
 *
 * Without `--resume`, a pre-existing non-empty checkpoint is a BLOCKER: silently
 * appending to it would interleave two runs in one file.
 */
function openCheckpoint(outDir, options, questionCount) {
  const { jsonl, meta } = checkpointPaths(outDir);
  mkdirSync(outDir, { recursive: true });
  const fingerprint = runFingerprint(options, questionCount);
  const existing = existsSync(jsonl) && readFileSync(jsonl, 'utf8').trim().length > 0;

  if (existing && !options.resume) {
    throw new Error(
      `checkpoint already exists at ${jsonl}. Pass --resume to continue that run, ` +
        'or point --out-dir at a fresh directory to start over. Refusing to append ' +
        'to another run\'s checkpoint.',
    );
  }

  if (existing && options.resume) {
    if (!existsSync(meta)) {
      throw new Error(`checkpoint ${jsonl} has no ${meta}; cannot verify it matches this run.`);
    }
    const previous = JSON.parse(readFileSync(meta, 'utf8'));
    const diffs = fingerprintDiff(fingerprint, previous.fingerprint);
    if (diffs.length) {
      throw new Error(
        'REFUSING TO RESUME: this run is not the same experiment as the checkpoint.\n' +
          `${diffs.join('\n')}\n` +
          'Splicing two configurations into one report is a measurement error. ' +
          'Fix the env/flags to match, or use a fresh --out-dir.',
      );
    }
    const loaded = loadCheckpoint(jsonl);
    if (loaded.torn) {
      console.log('[longmem] checkpoint had a torn final line (crash mid-write); that question will be redone.');
    }
    console.log(`[longmem] resuming from ${jsonl}: ${loaded.records} completed (system, question) pair(s)`);
    return { path: jsonl, done: loaded.done };
  }

  writeFileSync(meta, JSON.stringify({ started_at: new Date().toISOString(), fingerprint }, null, 2), 'utf8');
  if (!existsSync(jsonl)) writeFileSync(jsonl, '', 'utf8');
  return { path: jsonl, done: new Map() };
}

function appendCheckpoint(path, system, record) {
  appendFileSync(path, `${JSON.stringify({ system, ...record })}\n`, 'utf8');
}

async function run(rawEntries, options) {
  const entries = filteredEntries(rawEntries, options.limit);
  const systems = options.systems;
  const checkpoint = openCheckpoint(options.outDir, options, entries.length);

  // Results are collected keyed by question_id so a resumed run can merge
  // checkpointed records with fresh ones and still emit `per_question` in
  // dataset order — order does not move an average, but a report whose rows
  // jump around when it is resumed is needlessly hard to diff.
  const perSystem = new Map(systems.map(system => [system, new Map()]));
  for (const system of systems) {
    for (const [questionId, record] of checkpoint.done.get(system) ?? []) {
      perSystem.get(system).set(questionId, record);
    }
  }

  // Spawn the Rust IPC child LAZILY: a checkpoint that already covers every
  // (system, question) pair can regenerate its reports with no backend at all,
  // which is also what makes resume testable without running a bench.
  let client = null;
  const ipc = () => (client ??= new JsonlClient());

  // Rate baseline for the ETA: questions already in the checkpoint cost this
  // process nothing, so counting them would report a wildly optimistic pace on
  // a resumed run.
  const runStart = performance.now();
  const startedComplete = entries.filter(
    entry => systems.every(system => perSystem.get(system).has(entry.question_id)),
  ).length;

  try {
    for (let index = 0; index < entries.length; index += 1) {
      // `--report-only` regenerates the reports from the checkpoint and does no
      // work at all. Useful when a finished run died in `writeReports`, and the
      // only way to ask "how far did it actually get?" without a backend — the
      // completeness assertion below still applies, so it can answer that
      // question without ever publishing a partial number.
      if (options.reportOnly) break;
      const entry = entries[index];
      const pending = systems.filter(system => !perSystem.get(system).has(entry.question_id));
      if (pending.length === 0) continue;
      const sessions = sessionPayloads(entry);

      // MEASUREMENT BUG, fixed 2026-07-27 (forensics on the 95.1 floor).
      //
      // This used to `reset` + `add_sessions` ONCE and then loop the systems
      // over that SHARED store, so every system after the first ran against a
      // store the earlier ones had already touched. That is not a fair
      // comparison — it is a sequence.
      //
      // MEASURED CONSEQUENCE: the two runs that produced the published 95.1
      // floor used `systems=search,rrf,rrf_emb`, so `search` ran first and
      // heated `access_count`, which feeds the activation multiplier and moved
      // `rrf`'s post-fusion score. `rrf` and `rrf_emb` flipped in LOCKSTEP on
      // the affected query while the sparse `search` row stayed byte-identical
      // — a perturbed shared input, not a fusion change. HEAD, run as `rrf`
      // ALONE, reads 95.0402; the multi-system runs read 95.1108 / 95.1296.
      // The "floor" and the current value were never the same experiment.
      //
      // `3803f33c` epoch-pinned activation counts so identical queries are
      // order-idempotent, which removes the known instance. This removes the
      // CLASS: each system now gets a cold store, so no system can observe
      // another's side effects through any shared state, present or future.
      //
      // Cost is one extra reset+ingest per system per question — real, but a
      // benchmark that silently compares a sequence is worth nothing.
      for (const system of pending) {
        await ipc().send({ op: 'reset' });
        await ipc().send({
          op: 'add_sessions',
          question_id: entry.question_id,
          sessions,
        });

        const start = performance.now();
        const response = await ipc().send({
          op: 'search',
          query: entry.question,
          mode: system,
          limit: options.topK,
        });
        const latencyMs = performance.now() - start;
        const results = response.results ?? [];
        const retrievedSessionIds = results.map(result => result.session_id).filter(Boolean);
        let judge = null;
        if (options.withJudge) {
          judge = await judgeEvidence(entry, retrievedSessionIds, options);
        }
        const record = {
          question_id: entry.question_id,
          question_type: entry.question_type,
          question: entry.question,
          recall_any_at_5: recallAny(retrievedSessionIds, entry.answer_session_ids, 5),
          recall_any_at_10: recallAny(retrievedSessionIds, entry.answer_session_ids, 10),
          recall_any_at_20: recallAny(retrievedSessionIds, entry.answer_session_ids, 20),
          ndcg_at_10: ndcg(retrievedSessionIds, entry.answer_session_ids, 10),
          // mrr_at_20: FIXED window, comparable across arms regardless of
          // --top-k. mrr: natural MRR@top_k (see the mrr() doc comment) —
          // only comparable to another arm run at the SAME --top-k.
          mrr_at_20: mrr(retrievedSessionIds, entry.answer_session_ids, 20),
          mrr: mrr(retrievedSessionIds, entry.answer_session_ids),
          latency_ms: latencyMs,
          retrieved_tokens: results.reduce((sum, result) => sum + (result.token_count ?? 0), 0),
          retrieved_session_ids: retrievedSessionIds.slice(0, 20),
          gold_session_ids: entry.answer_session_ids,
          judge_supported: judge ? judge.supported : null,
          judge_reason: judge ? judge.reason : null,
        };
        perSystem.get(system).set(entry.question_id, record);
        // Durable BEFORE the next question starts: the crash we are guarding
        // against takes the whole process with it, so anything still only in
        // RAM is lost.
        appendCheckpoint(checkpoint.path, system, record);
      }

      // HEARTBEAT, one line per question (2026-07-27). The 50-question progress
      // table below is ~75 minutes apart on a `max` arm, so a stall watchdog
      // keyed on log mtime could not tell "working" from "wedged" without
      // false-firing constantly. A per-question line makes liveness observable
      // and gives an honest ETA for an unattended overnight run.
      const doneCount = index + 1;
      const remaining = entries.length - doneCount;
      const elapsedMs = performance.now() - runStart;
      const perQuestionMs = elapsedMs / Math.max(1, doneCount - startedComplete);
      const etaMin = (perQuestionMs * remaining) / 60000;
      console.log(
        `[longmem] q ${doneCount}/${entries.length} ${entry.question_id} ` +
          `(${(perQuestionMs / 1000).toFixed(1)}s/q, eta ${etaMin.toFixed(0)}m)`,
      );

      const processed = index + 1;
      if (processed % 50 === 0 || processed === entries.length) {
        const rows = systems.map(system => {
          const soFar = aggregateSystem(system, [...perSystem.get(system).values()]);
          return [system, pct(soFar.recall_any_at_5), pct(soFar.recall_any_at_10), soFar.questions];
        });
        console.log(`[longmem] processed ${processed}/${entries.length}`);
        printTable(['System', 'R@5', 'R@10', 'Questions'], rows);
      }
    }
  } finally {
    if (client) await client.close();
  }

  // Emit per_question in dataset order regardless of how the run was split
  // across resumes.
  const order = new Map(entries.map((entry, index) => [entry.question_id, index]));
  const systemResults = systems.map(system => {
    const ordered = [...perSystem.get(system).values()].sort(
      (a, b) => (order.get(a.question_id) ?? 0) - (order.get(b.question_id) ?? 0),
    );
    const aggregated = aggregateSystem(system, ordered);
    return { ...aggregated, per_type: perType(aggregated) };
  });

  return {
    benchmark: 'LongMemEval-S retrieval-only',
    generated_at: new Date().toISOString(),
    env: longmemEnvStamp(),
    dataset_source: options.datasetSource,
    dataset_url: DATASET_URL,
    methodology_source: 'https://github.com/rohitg00/agentmemory/blob/main/benchmark/longmemeval-bench.ts',
    // The retrieval depth this arm ran at. Required by the markdown renderer,
    // which labels the natural-MRR column `MRR@${report.top_k}` — without it
    // every published report carried a literal `MRR@undefined` header (and
    // the JSON omitted the field entirely, so downstream consumers could not
    // tell what depth a result was measured at). MAX-100-17 added the column
    // and its label but not the field that names it.
    top_k: options.topK,
    questions: entries.length,
    excluded_abstention: rawEntries.length - rawEntries.filter(entry => !ABSTENTION_TYPES.has(entry.question_type)).length,
    systems: systemResults,
    judge: options.withJudge ? {
      model: options.judgeModel,
      ollama_url: options.ollamaUrl,
      top_k: options.judgeTopK,
      max_session_chars: options.judgeMaxSessionChars,
    } : null,
  };
}

function writeReports(report, outDir) {
  mkdirSync(outDir, { recursive: true });
  // A report is named by `report.questions`, and at >=500 it drops the `_Nq`
  // suffix and takes the canonical filename. So a partially-populated system
  // must never reach this function: it would publish an N-question average
  // under a 500-question name. Cheap to assert, impossible to spot later.
  for (const system of report.systems) {
    if (system.questions !== report.questions) {
      throw new Error(
        `refusing to write an incomplete report: system '${system.system}' has ` +
          `${system.questions} of ${report.questions} questions. The run did not finish; ` +
          're-run with --resume to complete it.',
      );
    }
  }
  const suffix = report.questions < 500 ? `_${report.questions}q` : '';
  const jsonPath = resolve(outDir, `longmemeval_s_terransoul${suffix}.json`);
  const mdPath = resolve(outDir, `longmemeval_s_terransoul${suffix}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, markdownReport(report), 'utf8');
  console.log(`[longmem] wrote ${jsonPath}`);
  console.log(`[longmem] wrote ${mdPath}`);
}

async function main() {
  const cmd = command();
  if (cmd === 'help' || hasFlag('help')) {
    printHelp();
    return;
  }

  const datasetPath = resolve(REPO_ROOT, option('dataset', DEFAULT_DATASET_PATH));
  if (cmd === 'prepare') {
    await downloadDataset(datasetPath);
    return;
  }

  const outDir = resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR));
  const systems = option('systems', DEFAULT_SYSTEMS.join(','))
    .split(',')
    .map(system => system.trim())
    .filter(Boolean);
  for (const system of systems) {
    // Thinking modes are the published surface; legacy rrf_*/search/emb are kept
    // during the transition for A/B and removed once the thinking-mode floors lock.
    const published = ['chat', 'think', 'research', 'max', 'search', 'rrf', 'emb', 'rrf_emb'];
    // A/B arms: every one of these is implemented in `longmemeval_ipc.rs`'s mode
    // dispatch but was unreachable behind this allow-list, so no bench could ever
    // measure the SOTA-adopt features (MMR, HippoRAG PPR, reason-rerank, HyDE…).
    // A feature that cannot be benched cannot clear the never-regress floor, and
    // therefore can never leave "built & available" for "benched, on" — this gate
    // was the structural reason the ● column never emptied.
    const abArms = [
      'rrf_mmr',
      'rrf_mmr_rerank',
      'rrf_multihop',
      'rrf_rerank',
      'rrf_kg',
      'rrf_temporal',
      'rrf_hyde',
      'rrf_hyde_rerank',
      'rrf_iterative',
      'rrf_ctx',
      'ivfpq',
    ];
    const allowed = [...published, ...abArms];
    if (!allowed.includes(system)) {
      throw new Error(
        `unsupported system ${system}; published surface = chat, think, research, max ` +
          `(rules/bench-thinking-modes.md); A/B arms = ${abArms.join(', ')}`,
      );
    }
  }

  const options = {
    datasetSource: cmd === 'sample' ? 'built-in sample' : datasetPath,
    limit: cmd === 'sample' ? 0 : numberOption('limit', 0),
    systems,
    outDir,
    resume: hasFlag('resume') || hasFlag('report-only'),
    reportOnly: hasFlag('report-only'),
    topK: positiveNumberOption('top-k', 20),
    withJudge: hasFlag('with-judge'),
    judgeModel: option('judge-model', 'qwen2.5:14b'),
    ollamaUrl: option('ollama-url', 'http://127.0.0.1:11434'),
    judgeTopK: positiveNumberOption('judge-top-k', 5),
    judgeMaxSessionChars: positiveNumberOption('judge-max-session-chars', 1800),
  };

  let rawEntries;
  if (cmd === 'sample') {
    rawEntries = sampleDataset();
  } else if (cmd === 'run') {
    // BENCH-OPS-1(a): a bad embedder placement or missing chat model has
    // burned 32 minutes of a run before anyone thought to check /api/ps —
    // gate BEFORE the (possibly slow, disk-consuming) dataset download too.
    runPreflight(outDir);
    if (!existsSync(datasetPath)) {
      if (hasFlag('no-download')) {
        throw new Error(`missing dataset: ${datasetPath}`);
      }
      await downloadDataset(datasetPath);
    }
    rawEntries = loadDataset(datasetPath);
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }

  console.log(`[longmem] systems=${options.systems.join(',')} top_k=${options.topK} judge=${options.withJudge ? options.judgeModel : 'off'}`);
  const report = await run(rawEntries, options);
  writeReports(report, outDir);
}

// MAX-100-17: guarded so importing this file's pure functions for a unit
// test (mrr/aggregateSystem/perType) does not ALSO run the CLI as a side
// effect — same pattern already used by sibling bench scripts (see
// scripts/bench/compare-arms.mjs, scripts/bench/replay-verdicts.mjs).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(err => {
    console.error(`[longmem] failed: ${err.message}`);
    process.exit(1);
  });
}
