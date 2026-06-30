#!/usr/bin/env node
// Retrieval + optional end-to-end QA adapter for the MTEB LoCoMo text-retrieval dataset.

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DATASET_REPO = 'mteb/LoCoMo';
const DATASET_REV = '02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac';
const DEFAULT_DATA_DIR = resolve(REPO_ROOT, 'target-copilot-bench', 'locomo-mteb');
// Committed reports live under benchmark/results/ (matches --help and the
// rest of the benchmark layout). Build cache + datasets stay in the
// gitignored target-copilot-bench/.
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const DEFAULT_TASKS = [
  'single_hop',
  'multi_hop',
  'temporal_reasoning',
  'open_domain',
  'adversarial',
];
const DEFAULT_SYSTEMS = ['search', 'rrf'];
const ALL_SYSTEMS = new Set(['search', 'rrf', 'emb', 'rrf_emb', 'search_emb', 'best', 'rrf_rerank', 'rrf_hyde', 'rrf_hyde_rerank', 'rrf_ctx', 'rrf_ctx_rerank', 'rrf_kg', 'rrf_kg_rerank', 'rrf_temporal', 'rrf_temporal_rerank', 'rrf_iterative', 'rrf_multihop']);
const EMB_SYSTEMS = new Set(['emb', 'rrf_emb', 'search_emb', 'best', 'rrf_rerank', 'rrf_hyde', 'rrf_hyde_rerank', 'rrf_ctx', 'rrf_ctx_rerank', 'rrf_kg', 'rrf_kg_rerank', 'rrf_temporal', 'rrf_temporal_rerank', 'rrf_iterative', 'rrf_multihop']);
const RERANK_SYSTEMS = new Set(['rrf_rerank', 'rrf_hyde_rerank', 'rrf_ctx_rerank', 'rrf_kg_rerank', 'rrf_temporal_rerank']);
const HYDE_SYSTEMS = new Set(['rrf_hyde', 'rrf_hyde_rerank']);
const CTX_SYSTEMS = new Set(['rrf_ctx', 'rrf_ctx_rerank']);
// `rrf_multihop` follows `memory_edges`, so it needs the KG built at ingest
// (LONGMEM_KG_EDGES=1). It does NOT take the `wants_kg` cascade-expand path in
// the IPC binary (that stays scoped to rrf_kg / rrf_kg_rerank) — membership
// here only gates edge construction.
const KG_SYSTEMS = new Set(['rrf_kg', 'rrf_kg_rerank', 'rrf_multihop']);
const DATA_KINDS = ['corpus', 'queries', 'qrels'];
const METRIC_KS = [1, 5, 10, 20, 100];

// ── QA Eval (TOP1-2) ──────────────────────────────────────────────────────

const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_QA_MODEL = 'gemma3:4b';
const QA_EVAL_MODES = new Set(['mem0-paper']);

function qaEvalOption() {
  return option('qa-eval', '');
}

function generatorModel() {
  return option('generator', DEFAULT_QA_MODEL);
}

function judgeModel() {
  return option('judge', '');
}

function openaiKey() {
  return option('openai-key', process.env.OPENAI_API_KEY || '');
}

function anthropicKey() {
  return option('anthropic-key', process.env.ANTHROPIC_API_KEY || '');
}

function isOpenAiModel(model) {
  return model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-');
}

function isAnthropicModel(model) {
  return model.startsWith('claude-');
}

function isClaudeCodeModel(model) {
  // claude-code (uses CLI default) or claude-code:<model-id>
  return model === 'claude-code' || model.startsWith('claude-code:');
}

function claudeCodeBinary() {
  return option('claude-code-bin', process.env.CLAUDE_CODE_BIN || 'claude');
}

async function claudeCodeChat(model, prompt) {
  // model is either "claude-code" (CLI default) or "claude-code:<id>"
  const subModel = model.startsWith('claude-code:') ? model.slice('claude-code:'.length) : '';
  const bin = claudeCodeBinary();
  const args = ['-p', '--output-format', 'text'];
  if (subModel) args.push('--model', subModel);

  // Windows: claude is distributed as claude.exe (PATH lookup works without
  // a shell). Avoid shell:true so we don't trip the DEP0190 deprecation warning
  // and so prompts on stdin aren't reinterpreted by cmd.exe.
  const spawnBin = process.platform === 'win32' && !bin.toLowerCase().endsWith('.exe') && !bin.toLowerCase().endsWith('.cmd') && !bin.includes('\\') && !bin.includes('/')
    ? `${bin}.exe`
    : bin;

  return await new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(spawnBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      rejectPromise(new Error(`Failed to launch Claude Code CLI ('${spawnBin}'): ${err.message}. Install from https://docs.anthropic.com/en/docs/claude-code or set --claude-code-bin / CLAUDE_CODE_BIN.`));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      rejectPromise(new Error(`Claude Code CLI failed to start: ${err.message}. Is 'claude' on PATH? Run 'claude login' first.`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`Claude Code CLI exited with code ${code}: ${stderr.trim() || stdout.trim() || '<no output>'}`));
        return;
      }
      resolvePromise(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function ollamaChat(model, prompt, host = DEFAULT_OLLAMA_HOST) {
  const response = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `think: false` disables hidden reasoning on thinking models (e.g.
    // gemma4:12b-it-qat); without it they emit reasoning tokens and return an
    // EMPTY `response`, which would silently produce garbage QA-eval scores.
    // Ollama ignores the flag for non-thinking models, so it is always safe.
    body: JSON.stringify({ model, prompt, stream: false, think: false, options: { temperature: 0 } }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama generate failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  return data.response ?? '';
}

async function openaiChat(model, prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 512,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI chat failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function anthropicChat(model, prompt, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic chat failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  // Anthropic returns content as array of blocks; concatenate text blocks.
  if (Array.isArray(data.content)) {
    return data.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

async function llmCall(model, prompt, apiKey) {
  if (isClaudeCodeModel(model)) {
    // Claude Code CLI handles auth via `claude login`; no API key needed.
    return claudeCodeChat(model, prompt);
  }
  if (isAnthropicModel(model)) {
    const key = apiKey?.anthropic ?? anthropicKey();
    if (!key) throw new Error(`Anthropic API key required for model ${model}; set --anthropic-key or ANTHROPIC_API_KEY (or use --judge=claude-code to route through the Claude Code CLI instead)`);
    return anthropicChat(model, prompt, key);
  }
  if (isOpenAiModel(model)) {
    const key = apiKey?.openai ?? (typeof apiKey === 'string' ? apiKey : openaiKey());
    if (!key) throw new Error(`OpenAI API key required for model ${model}; set --openai-key or OPENAI_API_KEY`);
    return openaiChat(model, prompt, key);
  }
  return ollamaChat(model, prompt);
}

function buildGeneratorPrompt(question, contextTexts) {
  const context = contextTexts.map((doc, i) => `[${i + 1}] ${doc}`).join('\n\n');
  return `You are a helpful assistant. Answer the question using ONLY the provided context from past conversations. Be concise and factual. If the context doesn't contain enough information to answer, say "I cannot determine the answer from the available context."

Context:
${context}

Question: ${question}

Answer:`;
}

function buildJudgePrompt(question, referenceContext, generatedAnswer) {
  return `You are an impartial judge evaluating the quality of an AI assistant's answer about past conversations.

Question: ${question}

Reference context (ground truth passages that contain the correct answer):
${referenceContext}

Generated answer:
${generatedAnswer}

Rate the generated answer on a scale of 0 to 10:
- 10: Perfectly correct and complete, captures all key information
- 7-9: Mostly correct, minor omissions or imprecisions
- 4-6: Partially correct, captures some key information but misses important details
- 1-3: Mostly incorrect or irrelevant
- 0: Completely wrong or refuses to answer when the information is clearly available

Respond with ONLY a single integer from 0 to 10.`;
}

function parseJudgeScore(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2})\b/);
  if (!match) return null;
  const score = parseInt(match[1], 10);
  return score >= 0 && score <= 10 ? score : null;
}

function buildCorpusIndex(corpus) {
  const index = new Map();
  for (const row of corpus) {
    index.set(row.id, sessionText(row));
  }
  return index;
}

function lookupRetrievedTexts(retrievedIds, corpusIndex, maxDocs = 10) {
  const texts = [];
  for (const id of retrievedIds.slice(0, maxDocs)) {
    const text = corpusIndex.get(id);
    if (text) texts.push(text);
  }
  return texts;
}

function lookupReferenceContext(qrels, corpusIndex) {
  const texts = [];
  for (const [corpusId] of qrels) {
    const text = corpusIndex.get(corpusId);
    if (text) texts.push(text);
  }
  return texts.join('\n---\n');
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

function listOption(name, fallback) {
  return option(name, fallback.join(','))
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`TerranSoul MTEB LoCoMo retrieval + QA adapter

Usage:
  npm run brain:locomo:prepare
  npm run brain:locomo:sample
  npm run brain:locomo:run -- --tasks=single_hop,multi_hop --systems=search,rrf
  npm run brain:locomo:run -- --qa-eval=mem0-paper --systems=rrf_rerank --judge=gpt-4o-mini

Commands:
  prepare   Download pinned MTEB LoCoMo parquet files into target-copilot-bench/locomo-mteb
  sample    Run a small single_hop smoke pass (default: 10 queries)
  run       Run retrieval scoring (and optionally QA eval) through TerranSoul MemoryStore
  help      Print this help

Options:
  --tasks=<csv>       Tasks to run: ${DEFAULT_TASKS.join(',')} (default: all; sample defaults to single_hop)
  --systems=<csv>     Systems: search,rrf,emb,rrf_emb (default: search,rrf)
  --limit=<n>         Queries per task; 0 means all (default: sample=10, run=0)
  --top-k=<n>         Retrieval depth requested from MemoryStore (default: 100)
  --data-dir=<path>   Download/cache directory (default: target-copilot-bench/locomo-mteb)
  --out-dir=<path>    Report directory (default: benchmark/results)
  --no-download       Fail if a parquet file is missing instead of downloading it
  --force-download    Re-download parquet files even if they already exist

QA Eval Options (TOP1-2):
  --qa-eval=mem0-paper  Enable end-to-end QA evaluation with LLM-as-Judge
  --generator=<model>   Generator model (default: gemma3:4b; local Ollama, OpenAI gpt-*, Anthropic claude-*, or claude-code)
  --judge=<model>       Judge model (default: same as generator; e.g. gpt-4o-mini, claude-sonnet-4-6, or claude-code)
  --openai-key=<key>    OpenAI API key (or set OPENAI_API_KEY env var)
  --anthropic-key=<key> Anthropic API key (or set ANTHROPIC_API_KEY env var)
  --claude-code-bin=<p> Path to Claude Code CLI binary (default: 'claude' on PATH; or set CLAUDE_CODE_BIN). Use --judge=claude-code or claude-code:<model-id> to route through the CLI — no API key required, auth via 'claude login'.

Without --qa-eval, this is a retrieval benchmark over MTEB qrels.
With --qa-eval=mem0-paper, it adds LLM-as-Judge QA scoring (J-score) per the Mem0 paper methodology.
`);
}

function assertKnownTasks(tasks) {
  const allowed = new Set(DEFAULT_TASKS);
  for (const task of tasks) {
    if (!allowed.has(task)) {
      throw new Error(`unknown task ${task}; use one of ${DEFAULT_TASKS.join(', ')}`);
    }
  }
}

function assertKnownSystems(systems) {
  for (const system of systems) {
    if (!ALL_SYSTEMS.has(system)) {
      throw new Error(`unknown system ${system}; use search, rrf, emb, rrf_emb, search_emb, best, rrf_rerank, rrf_hyde, rrf_hyde_rerank, rrf_ctx, or rrf_ctx_rerank`);
    }
  }
}

function needsEmbedding(systems) {
  return systems.some(s => EMB_SYSTEMS.has(s)) || hasFlag('embed');
}

function needsRerank(systems) {
  return systems.some(s => RERANK_SYSTEMS.has(s));
}

function needsHyde(systems) {
  return systems.some(s => HYDE_SYSTEMS.has(s));
}

function needsContextualize(systems) {
  return systems.some(s => CTX_SYSTEMS.has(s));
}

function needsKg(systems) {
  return systems.some(s => KG_SYSTEMS.has(s));
}

function parquetUrl(task, kind) {
  const config = `${task}-${kind}`;
  return `https://huggingface.co/datasets/${DATASET_REPO}/resolve/${DATASET_REV}/${config}/test-00000-of-00001.parquet`;
}

function parquetPath(dataDir, task, kind) {
  return resolve(dataDir, `${task}-${kind}`, 'test-00000-of-00001.parquet');
}

async function downloadFile(url, path, force) {
  if (existsSync(path) && !force) {
    return { path, downloaded: false, bytes: statSync(path).size };
  }

  mkdirSync(dirname(path), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url} (HTTP ${response.status})`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, data);
  renameSync(tempPath, path);
  return { path, downloaded: true, bytes: data.byteLength };
}

async function ensureParquetFiles(tasks, options) {
  const manifest = [];
  for (const task of tasks) {
    for (const kind of DATA_KINDS) {
      const path = parquetPath(options.dataDir, task, kind);
      if (!existsSync(path) && options.noDownload) {
        throw new Error(`missing ${path}; run npm run brain:locomo:prepare`);
      }
      const result = await downloadFile(parquetUrl(task, kind), path, options.forceDownload);
      manifest.push({ task, kind, ...result });
      const verb = result.downloaded ? 'downloaded' : 'cached';
      console.log(`[locomo] ${verb} ${task}-${kind} (${result.bytes.toLocaleString('en-US')} bytes)`);
    }
  }
  mkdirSync(options.dataDir, { recursive: true });
  writeFileSync(
    resolve(options.dataDir, 'manifest.json'),
    JSON.stringify({ dataset: DATASET_REPO, revision: DATASET_REV, files: manifest }, null, 2),
    'utf8',
  );
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

async function loadTaskData(task, options) {
  const [corpusRows, queryRows, qrelRows] = await Promise.all([
    readParquetRows(parquetPath(options.dataDir, task, 'corpus')),
    readParquetRows(parquetPath(options.dataDir, task, 'queries')),
    readParquetRows(parquetPath(options.dataDir, task, 'qrels')),
  ]);
  const corpus = normalizeCorpusRows(corpusRows);
  const queries = normalizeQueryRows(queryRows);
  const qrels = groupQrels(qrelRows);
  const filteredQueries = queries.filter(query => qrels.has(query.id));
  const limitedQueries = options.limit > 0 ? filteredQueries.slice(0, options.limit) : filteredQueries;
  return { corpus, queries: limitedQueries, allQueryCount: filteredQueries.length, qrels };
}

function sessionText(row) {
  return [row.title ? `Title: ${row.title}` : '', row.text].filter(Boolean).join('\n');
}

function sessionPayloads(corpus) {
  return corpus.map(row => ({
    session_id: row.id,
    text: sessionText(row),
    date: null,
    turn_count: 1,
  }));
}

function gain(score) {
  return (2 ** score) - 1;
}

function dcg(scores, k) {
  let total = 0;
  for (let index = 0; index < Math.min(k, scores.length); index += 1) {
    const score = scores[index];
    if (score > 0) total += gain(score) / Math.log2(index + 2);
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
  let precisionSum = 0;
  let seenRelevant = 0;
  for (let index = 0; index < top.length; index += 1) {
    if (qrels.has(top[index])) {
      seenRelevant += 1;
      precisionSum += seenRelevant / (index + 1);
    }
  }
  const firstRelevantIndex = top.findIndex(id => qrels.has(id));
  return {
    [`recall_at_${k}`]: relevantCount === 0 ? 0 : hits / relevantCount,
    [`hit_at_${k}`]: hits > 0 ? 1 : 0,
    [`ndcg_at_${k}`]: idealDcg === 0 ? 0 : dcg(scores, k) / idealDcg,
    [`map_at_${k}`]: relevantCount === 0 ? 0 : precisionSum / Math.min(relevantCount, k),
    [`mrr_at_${k}`]: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
  };
}

function scoreQuery(retrievedIds, qrels) {
  const metrics = {
    relevant_count: qrels.size,
    retrieved_count: retrievedIds.length,
  };
  for (const k of METRIC_KS) {
    Object.assign(metrics, metricForQuery(retrievedIds, qrels, k));
  }
  return metrics;
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function aggregate(system, task, rows) {
  const metricNames = [
    ...METRIC_KS.flatMap(k => [`recall_at_${k}`, `hit_at_${k}`]),
    'ndcg_at_10',
    'map_at_10',
    'mrr_at_100',
    'latency_ms',
    'retrieved_tokens',
  ];
  const aggregateRow = { system, task, queries: rows.length, per_query: rows };
  for (const metric of metricNames) {
    aggregateRow[metric] = avg(rows.map(row => Number(row[metric] ?? 0)));
  }
  return aggregateRow;
}

function aggregateOverall(system, taskRows) {
  const perQuery = taskRows.flatMap(row => row.per_query);
  return aggregate(system, 'overall', perQuery);
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value) {
  return `${value.toFixed(2)}ms`;
}

function markdownTable(rows) {
  const lines = [
    '| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.task} | ${row.system} | ${row.queries} | ${pct(row.recall_at_1)} | ${pct(row.recall_at_5)} | ${pct(row.recall_at_10)} | ${pct(row.recall_at_20)} | ${pct(row.recall_at_100)} | ${pct(row.ndcg_at_10)} | ${pct(row.map_at_10)} | ${pct(row.mrr_at_100)} | ${ms(row.latency_ms)} | ${Math.round(row.retrieved_tokens).toLocaleString('en-US')} |`,
    );
  }
  return lines.join('\n');
}

function markdownReport(report) {
  const lines = [];
  lines.push('# TerranSoul MTEB LoCoMo Retrieval Report');
  lines.push('');
  lines.push(`Date: ${report.generated_at}`);
  lines.push(`Dataset: ${report.dataset} @ ${report.revision}`);
  lines.push(`Systems: ${report.systems.join(', ')}`);
  lines.push(`Tasks: ${report.tasks.join(', ')}`);
  lines.push(`Top K requested: ${report.top_k}`);
  lines.push('');
  lines.push('This is retrieval-only MTEB qrel scoring over the LoCoMo-derived text-retrieval task. It is not end-to-end LoCoMo QA accuracy.');
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(markdownTable(report.overall));
  lines.push('');
  lines.push('## By Task');
  lines.push('');
  lines.push(markdownTable(report.by_task));
  lines.push('');
  lines.push('## Methodology Notes');
  lines.push('');
  lines.push('- Each task loads the pinned MTEB `*-corpus`, `*-queries`, and `*-qrels` parquet files.');
  lines.push('- Corpus rows are inserted into a fresh in-memory TerranSoul `MemoryStore` through the existing Rust JSONL IPC shim.');
  lines.push('- `search` uses TerranSoul FTS5 lexical ranking and gated graph boost paths. `rrf` uses `hybrid_search_rrf(query, None, top_k)`.');
  lines.push('- Metrics are computed from qrels: recall@K is relevant-doc coverage, hit@K is any-relevant-hit, NDCG@10 uses qrel scores, MAP@10 is truncated average precision, and MRR@100 is first relevant rank.');
  return `${lines.join('\n')}\n`;
}

function writeReports(report, options) {
  mkdirSync(options.outDir, { recursive: true });
  const suffix = report.limit > 0 ? `_${report.total_queries}q` : '';
  const jsonPath = resolve(options.outDir, `locomo_mteb_terransoul${suffix}.json`);
  const mdPath = resolve(options.outDir, `locomo_mteb_terransoul${suffix}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, markdownReport(report), 'utf8');
  console.log(`[locomo] wrote ${jsonPath}`);
  console.log(`[locomo] wrote ${mdPath}`);
}

class JsonlClient {
  constructor({ embed = false, rerank = false, hyde = false, contextualize = false, kg = false, convAware = false } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.embedEnv = {
      ...(embed ? { LONGMEM_EMBED: '1' } : {}),
      ...(rerank ? { LONGMEM_RERANK: '1' } : {}),
      ...(hyde ? { LONGMEM_HYDE: '1' } : {}),
      ...(contextualize ? { LONGMEM_CONTEXTUALIZE: '1' } : {}),
      ...(kg ? { LONGMEM_KG_EDGES: '1' } : {}),
      ...(convAware ? { LCM_CONV_AWARE: '1' } : {}),
    };
    this.proc = spawn('cargo', [
      'run',
      '--quiet',
      '--manifest-path',
      resolve(REPO_ROOT, 'src-tauri', 'Cargo.toml'),
      '--features', 'bench-million', '--bin',
      'longmemeval-ipc',
      '--target-dir',
      DEFAULT_TARGET_DIR,
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.embedEnv || {}) },
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
    if (this.proc.killed) return;
    try {
      await this.send({ op: 'shutdown' });
    } catch {
      this.proc.kill();
    }
  }
}

async function searchQuery(client, system, query, topK) {
  const start = performance.now();
  const response = await client.send({
    op: 'search',
    query,
    mode: system,
    limit: topK,
  });
  const latencyMs = performance.now() - start;
  const results = response.results ?? [];
  return {
    latencyMs,
    retrievedIds: results.map(result => result.session_id).filter(Boolean),
    retrievedTokens: results.reduce((sum, result) => sum + (result.token_count ?? 0), 0),
  };
}

async function runTask(client, task, options) {
  const data = await loadTaskData(task, options);
  console.log(
    `[locomo] ${task}: corpus=${data.corpus.length.toLocaleString('en-US')} queries=${data.queries.length}/${data.allQueryCount} qrels=${data.qrels.size}`,
  );

  await client.send({ op: 'reset' });
  await client.send({
    op: 'add_sessions',
    question_id: `locomo-${task}`,
    sessions: sessionPayloads(data.corpus),
  });

  const taskSystemRows = [];
  for (const system of options.systems) {
    const perQuery = [];
    for (let index = 0; index < data.queries.length; index += 1) {
      const query = data.queries[index];
      const qrels = data.qrels.get(query.id);
      const result = await searchQuery(client, system, query.text, options.topK);
      perQuery.push({
        task,
        system,
        query_id: query.id,
        query: query.text,
        latency_ms: result.latencyMs,
        retrieved_tokens: result.retrievedTokens,
        retrieved_ids: result.retrievedIds,
        gold_ids: [...qrels.keys()],
        ...scoreQuery(result.retrievedIds, qrels),
      });
      const processed = index + 1;
      if (processed % 50 === 0 || processed === data.queries.length) {
        const soFar = aggregate(system, task, perQuery);
        console.log(
          `[locomo] ${task}/${system} ${processed}/${data.queries.length}: R@10=${pct(soFar.recall_at_10)} NDCG@10=${pct(soFar.ndcg_at_10)} MRR@100=${pct(soFar.mrr_at_100)}`,
        );
      }
    }
    taskSystemRows.push(aggregate(system, task, perQuery));
  }
  return taskSystemRows;
}

async function run(options) {
  await ensureParquetFiles(options.tasks, options);
  const embed = needsEmbedding(options.systems);
  const rerank = needsRerank(options.systems);
  const hyde = needsHyde(options.systems);
  const contextualize = needsContextualize(options.systems);
  const kg = needsKg(options.systems);
  const convAware = process.env.LCM_CONV_AWARE === '1';
  const client = new JsonlClient({ embed, rerank, hyde, contextualize, kg, convAware });
  try {
    const byTask = [];
    for (const task of options.tasks) {
      byTask.push(...await runTask(client, task, options));
    }
    const overall = options.systems.map(system => aggregateOverall(
      system,
      byTask.filter(row => row.system === system),
    ));
    return {
      benchmark: 'MTEB LoCoMo retrieval-only',
      generated_at: new Date().toISOString(),
      dataset: DATASET_REPO,
      revision: DATASET_REV,
      tasks: options.tasks,
      systems: options.systems,
      top_k: options.topK,
      limit: options.limit,
      total_queries: overall.reduce((sum, row) => Math.max(sum, row.queries), 0),
      overall,
      by_task: byTask,
    };
  } finally {
    await client.close();
  }
}

// ── QA Eval Runner (TOP1-2) ────────────────────────────────────────────────

async function runQaTask(client, task, options) {
  const data = await loadTaskData(task, options);
  const corpusIndex = buildCorpusIndex(data.corpus);
  const gen = options.qaGenerator;
  const judge = options.qaJudge;
  const key = options.qaApiKey;

  console.log(
    `[locomo-qa] ${task}: corpus=${data.corpus.length.toLocaleString('en-US')} queries=${data.queries.length}/${data.allQueryCount} generator=${gen} judge=${judge}`,
  );

  await client.send({ op: 'reset' });
  await client.send({
    op: 'add_sessions',
    question_id: `locomo-${task}`,
    sessions: sessionPayloads(data.corpus),
  });

  const system = options.systems[0]; // QA eval uses the first (best) retrieval system
  const perQuery = [];
  let scoreSum = 0;
  let judgeFailures = 0;

  for (let index = 0; index < data.queries.length; index += 1) {
    const query = data.queries[index];
    const qrels = data.qrels.get(query.id);

    // 1. Retrieve
    const result = await searchQuery(client, system, query.text, options.topK);
    const retrievalMetrics = scoreQuery(result.retrievedIds, qrels);

    // 2. Generate answer from retrieved context
    const retrievedTexts = lookupRetrievedTexts(result.retrievedIds, corpusIndex, 10);
    let generatedAnswer;
    const genStart = performance.now();
    try {
      const genPrompt = buildGeneratorPrompt(query.text, retrievedTexts);
      generatedAnswer = await llmCall(gen, genPrompt, key);
    } catch (err) {
      console.error(`[locomo-qa] generator error for query ${query.id}: ${err.message}`);
      generatedAnswer = 'ERROR: generation failed';
    }
    const genLatencyMs = performance.now() - genStart;

    // 3. Judge: compare generated answer against reference context
    const referenceContext = lookupReferenceContext(qrels, corpusIndex);
    let jScore = 0;
    const judgeStart = performance.now();
    try {
      const judgePrompt = buildJudgePrompt(query.text, referenceContext, generatedAnswer);
      const judgeRaw = await llmCall(judge, judgePrompt, key);
      const parsed = parseJudgeScore(judgeRaw);
      if (parsed !== null) {
        jScore = parsed;
      } else {
        console.warn(`[locomo-qa] judge returned unparseable score for query ${query.id}: "${judgeRaw.slice(0, 100)}"`);
        judgeFailures += 1;
      }
    } catch (err) {
      console.error(`[locomo-qa] judge error for query ${query.id}: ${err.message}`);
      judgeFailures += 1;
    }
    const judgeLatencyMs = performance.now() - judgeStart;

    scoreSum += jScore;
    perQuery.push({
      task,
      system,
      query_id: query.id,
      query: query.text,
      generated_answer: generatedAnswer.slice(0, 500),
      j_score: jScore,
      gen_latency_ms: genLatencyMs,
      judge_latency_ms: judgeLatencyMs,
      latency_ms: result.latencyMs,
      retrieved_tokens: result.retrievedTokens,
      retrieved_ids: result.retrievedIds,
      gold_ids: [...qrels.keys()],
      ...retrievalMetrics,
    });

    const processed = index + 1;
    if (processed % 25 === 0 || processed === data.queries.length) {
      const avgJ = scoreSum / processed;
      const avgR10 = avg(perQuery.map(r => r.recall_at_10));
      console.log(
        `[locomo-qa] ${task}/${system} ${processed}/${data.queries.length}: J=${(avgJ * 10).toFixed(1)} R@10=${pct(avgR10)} (${judgeFailures} judge failures)`,
      );
    }
  }

  const avgJScore = perQuery.length > 0 ? avg(perQuery.map(r => r.j_score)) * 10 : 0;
  return {
    system,
    task,
    queries: perQuery.length,
    avg_j_score: avgJScore,
    judge_failures: judgeFailures,
    recall_at_10: avg(perQuery.map(r => r.recall_at_10)),
    ndcg_at_10: avg(perQuery.map(r => r.ndcg_at_10)),
    per_query: perQuery,
  };
}

function qaMarkdownReport(report) {
  const lines = [];
  lines.push('# TerranSoul LoCoMo End-to-End QA Report (TOP1-2)');
  lines.push('');
  lines.push(`Date: ${report.generated_at}`);
  lines.push(`Dataset: ${report.dataset} @ ${report.revision}`);
  lines.push(`Retrieval system: ${report.retrieval_system}`);
  lines.push(`Generator: ${report.generator}`);
  lines.push(`Judge: ${report.judge}`);
  lines.push(`QA eval mode: ${report.qa_eval}`);
  lines.push(`Top K: ${report.top_k}`);
  lines.push('');
  lines.push('## J-Score Results (0-100 scale)');
  lines.push('');
  lines.push('| Task | Queries | J-score | R@10 | NDCG@10 | Judge failures |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const row of report.by_task) {
    lines.push(
      `| ${row.task} | ${row.queries} | ${row.avg_j_score.toFixed(1)} | ${pct(row.recall_at_10)} | ${pct(row.ndcg_at_10)} | ${row.judge_failures} |`,
    );
  }
  if (report.overall) {
    lines.push(
      `| **overall** | ${report.overall.queries} | **${report.overall.avg_j_score.toFixed(1)}** | ${pct(report.overall.recall_at_10)} | ${pct(report.overall.ndcg_at_10)} | ${report.overall.judge_failures} |`,
    );
  }
  lines.push('');
  lines.push('## Mem0-paper baselines (gpt-4o-mini judge, Chhikara et al. 2025)');
  lines.push('');
  lines.push('| System | single_hop | multi_hop | open_domain | temporal |');
  lines.push('|---|---:|---:|---:|---:|');
  lines.push('| Mem0 | 67.13 | 51.15 | 72.93 | 55.51 |');
  lines.push('| Mem0_g | 65.71 | 47.19 | 75.71 | 58.13 |');
  lines.push('| Zep | 61.70 | 41.35 | 76.60 | 49.31 |');
  lines.push('| LangMem | 62.23 | 47.92 | 71.12 | 23.43 |');
  lines.push('| OpenAI memory | 63.79 | 42.92 | 62.29 | 21.71 |');
  lines.push('| full-context | ~72.90 | — | — | — |');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('Per query: (1) retrieve top-K from TerranSoul MemoryStore, (2) prompt the generator');
  lines.push('for a concise answer using retrieved context, (3) prompt the judge to rate the');
  lines.push('generated answer 0-10 against the qrel-mapped reference context, (4) J-score =');
  lines.push('mean(judge_scores) × 10 → 0-100 scale.');
  lines.push('');
  lines.push('This mirrors the Mem0 paper\'s LLM-as-Judge methodology (Chhikara et al. 2025,');
  lines.push('arXiv:2504.19413, Appendix A). When judge=gpt-4o-mini, scores are directly');
  lines.push('comparable to the Mem0-paper baselines. Local-judge scores (e.g. gemma3:4b) are');
  lines.push('directionally comparable but not strictly equivalent.');
  return `${lines.join('\n')}\n`;
}

function writeQaReports(report, options) {
  mkdirSync(options.outDir, { recursive: true });
  const suffix = report.limit > 0 ? `_${report.total_queries}q` : '';
  const judge = report.judge.replace(/[/:]/g, '-');
  const jsonPath = resolve(options.outDir, `locomo_qa_${judge}${suffix}.json`);
  const mdPath = resolve(options.outDir, `locomo_qa_${judge}${suffix}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, qaMarkdownReport(report), 'utf8');
  console.log(`[locomo-qa] wrote ${jsonPath}`);
  console.log(`[locomo-qa] wrote ${mdPath}`);
}

async function runQaEval(options) {
  await ensureParquetFiles(options.tasks, options);
  const embed = needsEmbedding(options.systems);
  const rerank = needsRerank(options.systems);
  const hyde = needsHyde(options.systems);
  const contextualize = needsContextualize(options.systems);
  const kg = needsKg(options.systems);
  const convAware = process.env.LCM_CONV_AWARE === '1';
  const client = new JsonlClient({ embed, rerank, hyde, contextualize, kg, convAware });
  try {
    const byTask = [];
    for (const task of options.tasks) {
      const taskResult = await runQaTask(client, task, options);
      byTask.push(taskResult);
    }

    const allPerQuery = byTask.flatMap(t => t.per_query);
    const overall = {
      system: byTask[0]?.system ?? options.systems[0],
      task: 'overall',
      queries: allPerQuery.length,
      avg_j_score: allPerQuery.length > 0 ? avg(allPerQuery.map(r => r.j_score)) * 10 : 0,
      judge_failures: byTask.reduce((sum, t) => sum + t.judge_failures, 0),
      recall_at_10: avg(allPerQuery.map(r => r.recall_at_10)),
      ndcg_at_10: avg(allPerQuery.map(r => r.ndcg_at_10)),
    };

    return {
      benchmark: 'LoCoMo end-to-end QA (LLM-as-Judge)',
      generated_at: new Date().toISOString(),
      dataset: DATASET_REPO,
      revision: DATASET_REV,
      qa_eval: options.qaEval,
      generator: options.qaGenerator,
      judge: options.qaJudge,
      retrieval_system: options.systems[0],
      tasks: options.tasks,
      top_k: options.topK,
      limit: options.limit,
      total_queries: allPerQuery.length,
      overall,
      by_task: byTask,
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const cmd = command();
  if (cmd === 'help' || hasFlag('help')) {
    printHelp();
    return;
  }

  const sampleMode = cmd === 'sample';
  const tasks = sampleMode
    ? listOption('tasks', ['single_hop'])
    : listOption('tasks', DEFAULT_TASKS);
  const systems = listOption('systems', DEFAULT_SYSTEMS);
  assertKnownTasks(tasks);
  assertKnownSystems(systems);

  const options = {
    tasks,
    systems,
    limit: numberOption('limit', sampleMode ? 10 : 0),
    topK: positiveNumberOption('top-k', 100),
    dataDir: resolve(REPO_ROOT, option('data-dir', DEFAULT_DATA_DIR)),
    outDir: resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR)),
    noDownload: hasFlag('no-download'),
    forceDownload: hasFlag('force-download'),
    qaEval: qaEvalOption(),
    qaGenerator: generatorModel(),
    qaJudge: judgeModel() || generatorModel(),
    qaApiKey: { openai: openaiKey(), anthropic: anthropicKey() },
  };

  if (options.qaEval && !QA_EVAL_MODES.has(options.qaEval)) {
    throw new Error(`unknown --qa-eval mode: ${options.qaEval}; use one of: ${[...QA_EVAL_MODES].join(', ')}`);
  }

  if (cmd === 'prepare') {
    await ensureParquetFiles(options.tasks, options);
    return;
  }
  if (cmd !== 'run' && cmd !== 'sample') {
    throw new Error(`unknown command: ${cmd}`);
  }

  console.log(
    `[locomo] tasks=${options.tasks.join(',')} systems=${options.systems.join(',')} limit=${options.limit || 'all'} top_k=${options.topK}${options.qaEval ? ` qa-eval=${options.qaEval} generator=${options.qaGenerator} judge=${options.qaJudge}` : ''}`,
  );

  if (options.qaEval) {
    const qaReport = await runQaEval(options);
    writeQaReports(qaReport, options);
  } else {
    const report = await run(options);
    writeReports(report, options);
  }
}

main().catch(err => {
  console.error(`[locomo] failed: ${err.message}`);
  process.exit(1);
});
