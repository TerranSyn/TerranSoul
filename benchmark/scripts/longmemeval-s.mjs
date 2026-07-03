#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// LongMemEval-S adapter for TerranSoul's MemoryStore. This runner downloads
// the cleaned LongMemEval-S dataset, streams each question's session haystack
// into a small Rust JSONL IPC shim, and writes retrieval-only benchmark reports
// that match agentmemory's LongMemEval-S methodology.

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

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
const DEFAULT_SYSTEMS = ['search', 'rrf'];

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

function chunkSessionToText(turns) {
  return turns.map(turn => `${turn.role}: ${turn.content}`).join('\n');
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
  const actual = retrievedSessionIds.slice(0, k).map(id => gold.has(id));
  const ideal = Array.from({ length: Math.min(k, gold.size) }, () => true);
  const idealDcg = dcg(ideal, k);
  return idealDcg === 0 ? 0 : dcg(actual, k) / idealDcg;
}

function mrr(retrievedSessionIds, goldSessionIds) {
  const gold = new Set(goldSessionIds);
  const index = retrievedSessionIds.findIndex(id => gold.has(id));
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

class JsonlClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.proc = spawn('cargo', [
      'run',
      '--quiet',
      '--manifest-path',
      resolve(REPO_ROOT, 'src-tauri', 'Cargo.toml'),
      '--bin',
      'longmemeval-ipc',
      '--target-dir',
      DEFAULT_TARGET_DIR,
    ], {
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

function retrievedContexts(entry, sessionIds, topK, maxChars) {
  const byId = new Map(entry.haystack_session_ids.map((id, index) => [id, entry.haystack_sessions[index]]));
  return sessionIds.slice(0, topK).map((sessionId, index) => {
    const text = chunkSessionToText(byId.get(sessionId) ?? []);
    const capped = Array.from(text).slice(0, maxChars).join('');
    return `#${index + 1} session ${sessionId}\n${capped}`;
  }).join('\n\n');
}

async function judgeEvidence(entry, retrievedSessionIds, options) {
  const context = retrievedContexts(
    entry,
    retrievedSessionIds,
    options.judgeTopK,
    options.judgeMaxSessionChars,
  );
  const prompt = `You are judging retrieval evidence for LongMemEval-S.\n\nQuestion:\n${entry.question}\n\nReference answer:\n${entry.answer}\n\nRetrieved sessions:\n${context}\n\nReturn JSON only with keys supported (boolean) and reason (short string). supported=true means the retrieved sessions contain enough evidence to answer the question consistently with the reference answer.`;
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

function aggregateSystem(system, perQuestion) {
  return {
    system,
    questions: perQuestion.length,
    recall_any_at_5: avg(perQuestion.map(result => result.recall_any_at_5)),
    recall_any_at_10: avg(perQuestion.map(result => result.recall_any_at_10)),
    recall_any_at_20: avg(perQuestion.map(result => result.recall_any_at_20)),
    ndcg_at_10: avg(perQuestion.map(result => result.ndcg_at_10)),
    mrr: avg(perQuestion.map(result => result.mrr)),
    avg_latency_ms: avg(perQuestion.map(result => result.latency_ms)),
    avg_retrieved_tokens: avg(perQuestion.map(result => result.retrieved_tokens)),
    judge_support_rate: perQuestion.some(result => result.judge_supported !== null)
      ? avg(perQuestion.filter(result => result.judge_supported !== null).map(result => result.judge_supported ? 1 : 0))
      : null,
    per_question: perQuestion,
  };
}

function perType(systemResult) {
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
    mrr: avg(results.map(result => result.mrr)),
  }]));
}

// Env stamp (2026-07-03 RRF-archaeology guardrail): the entire "rrf
// regression" episode came from unrecorded embedder configuration
// differences between runs — every report must carry the exact LONGMEM_*
// env so a future metric delta can never be misattributed to code again.
function longmemEnvStamp() {
  const keys = Object.keys(process.env)
    .filter(k => k.startsWith('LONGMEM_'))
    .sort();
  const pairs = keys.map(k => `${k}=${process.env[k]}`);
  const embedModel = process.env.LONGMEM_EMBED === '1'
    ? (process.env.LONGMEM_EMBED_MODEL ?? 'mxbai-embed-large (harness default)')
    : 'none (LONGMEM_EMBED unset — dense channel OFF)';
  return `${pairs.length ? pairs.join(' ') : '(no LONGMEM_* vars set)'} | effective embed model: ${embedModel}`;
}

function markdownReport(report) {
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
  w('| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |');
  w('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const system of report.systems) {
    w(`| ${system.system} | ${pct(system.recall_any_at_5)} | ${pct(system.recall_any_at_10)} | ${pct(system.recall_any_at_20)} | ${pct(system.ndcg_at_10)} | ${pct(system.mrr)} | ${formatMs(system.avg_latency_ms)} | ${Math.round(system.avg_retrieved_tokens).toLocaleString('en-US')} |`);
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
    w('| Type | Count | R@5 | R@10 | NDCG@10 | MRR |');
    w('|---|---:|---:|---:|---:|---:|');
    for (const [type, stats] of Object.entries(system.per_type)) {
      w(`| ${type} | ${stats.count} | ${pct(stats.recall_any_at_5)} | ${pct(stats.recall_any_at_10)} | ${pct(stats.ndcg_at_10)} | ${pct(stats.mrr)} |`);
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

async function run(rawEntries, options) {
  const entries = filteredEntries(rawEntries, options.limit);
  const systems = options.systems;
  const perSystem = new Map(systems.map(system => [system, []]));
  const client = new JsonlClient();

  try {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const sessions = sessionPayloads(entry);

      await client.send({ op: 'reset' });
      await client.send({
        op: 'add_sessions',
        question_id: entry.question_id,
        sessions,
      });

      for (const system of systems) {
        const start = performance.now();
        const response = await client.send({
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
        perSystem.get(system).push({
          question_id: entry.question_id,
          question_type: entry.question_type,
          question: entry.question,
          recall_any_at_5: recallAny(retrievedSessionIds, entry.answer_session_ids, 5),
          recall_any_at_10: recallAny(retrievedSessionIds, entry.answer_session_ids, 10),
          recall_any_at_20: recallAny(retrievedSessionIds, entry.answer_session_ids, 20),
          ndcg_at_10: ndcg(retrievedSessionIds, entry.answer_session_ids, 10),
          mrr: mrr(retrievedSessionIds, entry.answer_session_ids),
          latency_ms: latencyMs,
          retrieved_tokens: results.reduce((sum, result) => sum + (result.token_count ?? 0), 0),
          retrieved_session_ids: retrievedSessionIds.slice(0, 20),
          gold_session_ids: entry.answer_session_ids,
          judge_supported: judge ? judge.supported : null,
          judge_reason: judge ? judge.reason : null,
        });
      }

      const processed = index + 1;
      if (processed % 50 === 0 || processed === entries.length) {
        const rows = systems.map(system => {
          const soFar = aggregateSystem(system, perSystem.get(system));
          return [system, pct(soFar.recall_any_at_5), pct(soFar.recall_any_at_10), processed];
        });
        console.log(`[longmem] processed ${processed}/${entries.length}`);
        printTable(['System', 'R@5', 'R@10', 'Questions'], rows);
      }
    }
  } finally {
    await client.close();
  }

  const systemResults = systems.map(system => {
    const aggregated = aggregateSystem(system, perSystem.get(system));
    return { ...aggregated, per_type: perType(aggregated) };
  });

  return {
    benchmark: 'LongMemEval-S retrieval-only',
    generated_at: new Date().toISOString(),
    env: longmemEnvStamp(),
    dataset_source: options.datasetSource,
    dataset_url: DATASET_URL,
    methodology_source: 'https://github.com/rohitg00/agentmemory/blob/main/benchmark/longmemeval-bench.ts',
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
    if (!['search', 'rrf', 'emb', 'rrf_emb'].includes(system)) {
      throw new Error(`unsupported system ${system}; use search, rrf, emb, or rrf_emb`);
    }
  }

  const options = {
    datasetSource: cmd === 'sample' ? 'built-in sample' : datasetPath,
    limit: cmd === 'sample' ? 0 : numberOption('limit', 0),
    systems,
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

main().catch(err => {
  console.error(`[longmem] failed: ${err.message}`);
  process.exit(1);
});
