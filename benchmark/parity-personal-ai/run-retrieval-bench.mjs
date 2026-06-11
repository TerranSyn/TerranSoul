#!/usr/bin/env node
/**
 * PARITY-RETRIEVAL-LOOP — retrieval-in-the-loop head-to-head.
 *
 * The other parity benches HAND each system the fixture's ground-truth
 * context_seed, so they measure generation quality at equal context. This
 * bench instead measures the FULL retrieve→generate loop with NO handed
 * context: the corpus (fixtures/retrieval-corpus.json) is pre-ingested into
 * each system's OWN store by ingest-fixtures.mjs, and for each needle question
 * each system must:
 *
 *   1. RETRIEVE natively (no context handed in):
 *        • TerranSoul → brain_search over the ISOLATED brain (port 7431),
 *          NOT the real 7421/7423 companion brain.
 *        • OpenJarvis → `jarvis ask --json`'s DEFAULT memory-context injection
 *          (retrieve→generate in one call) over its isolated home store.
 *   2. GENERATE an answer from ONLY what it retrieved.
 *   3. be scored 0–10 by the LLM judge (judge.mjs), which is given the needle
 *      gold_answer as the reference so correct recall is not penalised.
 *
 * Per system we record:
 *   • latency (retrieve + generate, seconds)
 *   • quality (LLM-judge 0–10)
 *   • retrieval hit-rate (did a needle fact appear in what the system retrieved)
 *
 * Results are written to results/ in the same shape the head-to-head runner
 * uses (generated_at + systems[] + per-question rows).
 *
 * This runner is GPU-bound (generation + OpenJarvis) and is NOT meant to run
 * in CI — `node --check` validates it; the actual run happens on a GPU box with
 * OpenJarvis installed.
 *
 * Usage:
 *   node benchmark/parity-personal-ai/run-retrieval-bench.mjs [options]
 *
 * Options (same style as run.mjs):
 *   --system=<terransoul|openjarvis|both>   Which system(s) to run (default: both)
 *   --port=<n>                              Isolated TerranSoul MCP port (default: env TERRANSOUL_MCP_PORT or 7431)
 *   --home=<path>                           Isolated OpenJarvis home (default: env OPENJARVIS_HOME or .openjarvis-isolated/home)
 *   --judge-model=<model>                   Judge model (default: gemma4:12b-it-qat)
 *   --no-judge                              Skip LLM-judge scoring (latency + hit-rate only)
 *   --top-k=<n>                             Retrieval depth per query (default: 5)
 *   --dry                                   Print the question plan, run nothing
 *   --help                                  Show this help
 *
 * Env:
 *   TERRANSOUL_MCP_PORT       Isolated brain port (default 7431).
 *   TERRANSOUL_MCP_DATA_DIR   Isolated brain data dir (used to locate the token).
 *   OLLAMA_URL                Ollama base (default http://127.0.0.1:11434).
 *   PARITY_MODEL              Generation model (default gemma4:12b-it-qat).
 *   OPENJARVIS_BIN            Path to the real `jarvis` binary (default: the
 *                             installed exe under %LOCALAPPDATA%\OpenJarvis).
 *   OPENJARVIS_HOME           Isolated OpenJarvis home (default .openjarvis-isolated/home).
 *
 * NOTE: the `openjarvis_rust` native module must be built before the CLI works
 * (done out-of-band this session; not the harness's job).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { judgeResponse, checkOllama } from './judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE = resolve(__dirname, 'fixtures/retrieval-corpus.json');
const RESULTS_DIR = resolve(__dirname, 'results');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.PARITY_MODEL || 'gemma4:12b-it-qat';
const DEFAULT_TS_PORT = Number.parseInt(process.env.TERRANSOUL_MCP_PORT || '7431', 10);

// ── Shared OpenJarvis isolation constants (kept identical in ingest-fixtures.mjs) ──
// jarvis (v0.1.1) resolves its store from Path.home()/.openjarvis/memory.db and does
// NOT read OPENJARVIS_HOME for the store path, so we ALSO repoint HOME/USERPROFILE at
// the bench home to truly isolate it from the user's real ~/.openjarvis. We still set
// OPENJARVIS_HOME (as documented) so a future build that honours it stays isolated too.
const DEFAULT_OJ_HOME = process.env.OPENJARVIS_HOME
  || resolve(__dirname, '.openjarvis-isolated/home');
// The real installed `jarvis` exe (call it DIRECTLY via execFile — no `uv run`).
// NOTE: the `openjarvis_rust` native module must be built before the CLI works
// (done out-of-band this session; not the harness's job).
const OPENJARVIS_BIN = resolveOpenjarvisBin();
const GEN_TIMEOUT = 240_000;
const RETRIEVE_TIMEOUT = 60_000;

function resolveOpenjarvisBin() {
  if (process.env.OPENJARVIS_BIN) return process.env.OPENJARVIS_BIN;
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(local, 'OpenJarvis', '.venv', 'Scripts', 'jarvis.exe');
}

/** Env that isolates the OpenJarvis store under <benchHome>/.openjarvis. */
function ojEnv(benchHome) {
  return {
    ...process.env,
    OPENJARVIS_HOME: benchHome,
    HOME: benchHome,
    USERPROFILE: benchHome,
  };
}

const SYSTEM_PROMPT =
  'You are a question-answering assistant. Answer the user question using ONLY ' +
  'the retrieved context provided. If the context does not contain the answer, ' +
  'say you do not know. Be concise and include every specific detail the ' +
  'question asks for. Do not invent facts that are not in the context.';

const HELP = `PARITY-RETRIEVAL-LOOP — retrieval-in-the-loop head-to-head

Each system retrieves natively (no handed context) over its OWN pre-ingested
store, then generates an answer from only what it retrieved. Scored on latency,
LLM-judge quality (0–10), and retrieval hit-rate.

  node benchmark/parity-personal-ai/run-retrieval-bench.mjs [options]

  --system=<terransoul|openjarvis|both>   Which system(s) (default: both)
  --port=<n>                              Isolated TerranSoul MCP port (default ${DEFAULT_TS_PORT})
  --home=<path>                           Isolated OpenJarvis home (default ${DEFAULT_OJ_HOME})
  --judge-model=<model>                   Judge model (default gemma4:12b-it-qat)
  --no-judge                              Latency + hit-rate only
  --top-k=<n>                             Retrieval depth (default 5)
  --dry                                   Print plan, run nothing
  --help                                  Show this help

Prereqs: run ingest-fixtures.mjs first, and (for the TerranSoul side) launch the
isolated brain — NEVER the real 7421/7423 one:
  TERRANSOUL_MCP_DATA_DIR=benchmark/parity-personal-ai/.brain-isolated \\
  TERRANSOUL_MCP_PORT=${DEFAULT_TS_PORT} npm run mcp
`;

function parseArgs() {
  const o = {
    system: 'both',
    port: DEFAULT_TS_PORT,
    ojHome: DEFAULT_OJ_HOME,
    judgeModel: 'gemma4:12b-it-qat',
    noJudge: false,
    topK: 5,
    dry: false,
    help: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--system=')) o.system = a.slice(9);
    else if (a.startsWith('--port=')) o.port = Number.parseInt(a.slice(7), 10);
    else if (a.startsWith('--home=')) o.ojHome = a.slice(7);
    else if (a.startsWith('--judge-model=')) o.judgeModel = a.slice(14);
    else if (a === '--no-judge') o.noJudge = true;
    else if (a.startsWith('--top-k=')) o.topK = Number.parseInt(a.slice(8), 10);
    else if (a === '--dry') o.dry = true;
  }
  return o;
}

function loadCorpus() {
  const corpus = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  if (!Array.isArray(corpus.questions) || !corpus.questions.length) {
    throw new Error('retrieval-corpus.json has no questions');
  }
  return corpus;
}

function round(n, d = 3) { return n == null ? null : Math.round(n * 10 ** d) / 10 ** d; }
function mean(nums) {
  const v = nums.filter(n => typeof n === 'number' && n >= 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function median(nums) {
  const v = nums.filter(n => typeof n === 'number' && n >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * A retrieval "hit" = at least one of the question's needle facts appears in the
 * retrieved set. The corpus tags each ingested memory with `[<fact-id>]`, so we
 * detect a hit by fact-id substring AND by a text-overlap fallback (for systems
 * that strip the tag), so neither system is unfairly credited or denied.
 */
function isHit(retrievedTexts, needleIds, corpus) {
  const blob = retrievedTexts.join('\n').toLowerCase();
  for (const id of needleIds) {
    if (blob.includes(`[${id}]`) || blob.includes(id.toLowerCase())) return true;
    const fact = corpus.facts.find(f => f.id === id);
    if (fact) {
      // text-overlap fallback: a distinctive 6+ word shingle from the needle.
      const norm = fact.text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
      for (let i = 0; i + 6 <= norm.length; i += 3) {
        const shingle = norm.slice(i, i + 6).join(' ');
        if (blob.includes(shingle)) return true;
      }
    }
  }
  return false;
}

// ── TerranSoul side (isolated brain) ────────────────────────────────────────

function readToken() {
  const candidates = [];
  const isolated = process.env.TERRANSOUL_MCP_DATA_DIR;
  if (isolated && isolated.trim()) {
    candidates.push(resolve(REPO_ROOT, isolated.trim(), 'mcp-token.txt'));
    candidates.push(resolve(isolated.trim(), 'mcp-token.txt'));
  }
  candidates.push(
    resolve(REPO_ROOT, 'benchmark/parity-personal-ai/.brain-isolated/mcp-token.txt'),
    resolve(REPO_ROOT, 'mcp-data/mcp-token.txt'),
    resolve(REPO_ROOT, '.vscode/.mcp-token'),
  );
  for (const tp of candidates) {
    try { return readFileSync(tp, 'utf8').trim(); } catch { /* next */ }
  }
  return null;
}

async function ensureIsolatedBrain(port) {
  if ([7421, 7423, 7422].includes(port)) {
    throw new Error(`Refusing to query port ${port}: that is a real brain port. Use an isolated port (e.g. 7431).`);
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error(
      `Isolated TerranSoul brain not reachable on :${port}. Launch it first:\n` +
      `  TERRANSOUL_MCP_DATA_DIR=benchmark/parity-personal-ai/.brain-isolated ` +
      `TERRANSOUL_MCP_PORT=${port} npm run mcp`,
    );
  }
  if (!res.ok) throw new Error(`Isolated brain on :${port} returned HTTP ${res.status}`);
}

function extractRetrieved(text, topK) {
  // brain_search returns JSON or newline text; pull the retrieved memory bodies.
  try {
    const j = JSON.parse(text);
    const arr = j.results || j.memories || j.entries || (Array.isArray(j) ? j : []);
    return arr.slice(0, topK)
      .map(r => (r.content || r.text || r.summary || '').toString())
      .filter(Boolean);
  } catch {
    return text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, topK);
  }
}

async function tsRetrieve(port, token, query, topK) {
  const start = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: { name: 'brain_search', arguments: { query, top_k: topK } },
    }),
    signal: AbortSignal.timeout(RETRIEVE_TIMEOUT),
  });
  const elapsed = (performance.now() - start) / 1000;
  const body = await res.json();
  if (body.error) return { elapsed, retrieved: [], error: body.error.message || JSON.stringify(body.error) };
  const text = body.result?.content?.[0]?.text ?? '';
  return { elapsed, retrieved: extractRetrieved(text, topK) };
}

async function ollamaGenerate(retrieved, question) {
  const start = performance.now();
  const ctx = retrieved.length
    ? `RETRIEVED CONTEXT:\n- ${retrieved.join('\n- ')}`
    : 'RETRIEVED CONTEXT:\n(nothing retrieved)';
  const userMsg = `${ctx}\n\nQUESTION: ${question}\n\nAnswer using only the retrieved context.`;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        stream: false,
        think: false,
        options: { temperature: 0.0, num_predict: 256 },
      }),
      signal: AbortSignal.timeout(GEN_TIMEOUT),
    });
    const elapsed = (performance.now() - start) / 1000;
    if (!res.ok) return { elapsed, content: `Ollama HTTP ${res.status}`, ok: false };
    const body = await res.json();
    const content = body.message?.content ?? '';
    return { elapsed, content, ok: content.trim().length > 0 };
  } catch (err) {
    return { elapsed: (performance.now() - start) / 1000, content: `error: ${err.message}`, ok: false };
  }
}

async function runTerranSoul(corpus, opts, judgeOn) {
  console.log(`\n╔═ terransoul (isolated :${opts.port}) ════════════════════`);
  await ensureIsolatedBrain(opts.port);
  const token = readToken();
  const rows = [];
  for (const q of corpus.questions) {
    const r = await tsRetrieve(opts.port, token, q.question, opts.topK);
    const hit = isHit(r.retrieved, q.needle_ids, corpus);
    const gen = await ollamaGenerate(r.retrieved, q.question);
    const row = {
      id: q.id,
      system: 'terransoul',
      question: q.question,
      needle_ids: q.needle_ids,
      retrieval_latency: round(r.elapsed),
      generate_latency: round(gen.elapsed),
      latency: round(r.elapsed + gen.elapsed),
      retrieval_hit: hit,
      retrieved_count: r.retrieved.length,
      content: gen.content,
      success: gen.ok,
      score: -1,
      reason: 'judge off',
    };
    if (judgeOn && gen.ok) {
      const jr = await judgeResponse({
        prompt: q.question,
        response: gen.content,
        rubric: corpus.scoring_rubric,
        model: opts.judgeModel,
        context: `GOLD ANSWER (reference): ${q.gold_answer}`,
      });
      row.score = jr.score; row.reason = jr.reason;
    }
    rows.push(row);
    console.log(`   ${row.success ? '✓' : '✗'} ${q.id}: ${row.latency}s  hit=${hit ? 'Y' : 'N'}  ${row.score >= 0 ? 'q=' + row.score : '—'}`);
  }
  return rows;
}

// ── OpenJarvis side (isolated knowledge DB) ─────────────────────────────────

function openjarvisAvailable() {
  return new Promise((resolveP) => {
    execFile(OPENJARVIS_BIN, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => resolveP(!err));
  });
}

function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/**
 * `jarvis ask "<q>" -m <model> --json` — DEFAULT memory-context injection
 * retrieves from the isolated home store and generates in one call (we do NOT
 * pass --no-context, and NOT --research: --research reads a separate connector
 * store, the default path reads the indexed memory store). The store is isolated
 * via ojEnv(benchHome). jarvis prints a non-JSON "new version available" notice
 * before the JSON, so we slice the JSON object out of stdout; the answer is in
 * `.content` (NOT `.answer`). jarvis embeds `[Source: <file>]` / `[<fact-id>]`
 * markers in `.content`, which is how we detect the needle.
 */
function ojAsk(opts, question) {
  const args = ['ask', question, '-m', MODEL, '--json', '--no-stream', '--max-tokens', '256'];
  return new Promise((resolveP) => {
    const t0 = performance.now();
    execFile(OPENJARVIS_BIN, args,
      { timeout: GEN_TIMEOUT, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: ojEnv(opts.ojHome) },
      (err, stdout, stderr) => {
        const wall = (performance.now() - t0) / 1000;
        const out = `${stdout || ''}\n${stderr || ''}`;
        const j = extractJson(out);
        if (!j || typeof j.content !== 'string') {
          resolveP({ ok: false, content: (err ? `exec error: ${err.message}; ` : '') + out.slice(-300), latency: wall });
          return;
        }
        resolveP({ ok: j.content.trim().length > 0, content: j.content, latency: wall });
      });
  });
}

/**
 * OJ retrieval-hit signal (`ask --json` exposes no retrieved docs — tool_results
 * is []). `jarvis memory search "<q>"` returns a table whose rows carry the
 * stored fact text + source filename; we strip ANSI + table borders, collapse
 * the wrapped cell text into one blob, and reuse isHit() (fact-id tag OR
 * text-shingle overlap) — the same hit definition the TerranSoul side uses, so
 * both are comparable. Mirrors the memory reference: prefer the most robust
 * available signal (memory search rows; fall back to the ask answer text).
 */
function ojMemorySearch(opts, question) {
  const args = ['memory', 'search', question, '-k', String(opts.topK)];
  return new Promise((resolveP) => {
    execFile(OPENJARVIS_BIN, args,
      { timeout: RETRIEVE_TIMEOUT, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: ojEnv(opts.ojHome) },
      (err, stdout, stderr) => {
        const out = `${stdout || ''}\n${stderr || ''}`;
        const blob = out
          .replace(/\x1b\[[0-9;]*m/g, '')         // strip ANSI colours
          .replace(/[│┌┐└┘├┤┬┴┼─]/g, ' ')          // strip Rich box-drawing borders
          .replace(/\s+/g, ' ')                    // collapse wrapped-cell whitespace
          .trim();
        // The corpus rows are what we ingested; if search found nothing we get
        // "No results found." → empty retrieval.
        if (!blob || /No results found/i.test(blob)) { resolveP([]); return; }
        resolveP([blob]);
      });
  });
}

async function runOpenJarvis(corpus, opts, judgeOn) {
  console.log(`\n╔═ openjarvis (home ${opts.ojHome}) ══════════`);
  if (!(await openjarvisAvailable())) {
    throw new Error(
      `OpenJarvis CLI '${OPENJARVIS_BIN}' is not runnable. Install OpenJarvis and ` +
      `build the openjarvis_rust native module, or set OPENJARVIS_BIN to the jarvis ` +
      `exe. Refusing to fabricate results.`,
    );
  }
  const rows = [];
  for (const q of corpus.questions) {
    const retrieved = await ojMemorySearch(opts, q.question);
    const r = await ojAsk(opts, q.question);
    // Hit = needle visible in what OJ retrieved (memory search rows) OR echoed
    // in the generated answer (its [Source: <file>] / [<fact-id>] markers + text).
    const hit = isHit(retrieved.length ? retrieved : [r.content], q.needle_ids, corpus)
      || isHit([r.content], q.needle_ids, corpus);
    const row = {
      id: q.id,
      system: 'openjarvis',
      question: q.question,
      needle_ids: q.needle_ids,
      retrieval_latency: null,        // OJ retrieve+generate is one ask CLI call
      generate_latency: round(r.latency),
      latency: round(r.latency),
      retrieval_hit: hit,
      retrieved_count: retrieved.length,
      content: r.content,
      success: r.ok,
      score: -1,
      reason: 'judge off',
    };
    if (judgeOn && r.ok) {
      const jr = await judgeResponse({
        prompt: q.question,
        response: r.content,
        rubric: corpus.scoring_rubric,
        model: opts.judgeModel,
        context: `GOLD ANSWER (reference): ${q.gold_answer}`,
      });
      row.score = jr.score; row.reason = jr.reason;
    }
    rows.push(row);
    console.log(`   ${row.success ? '✓' : '✗'} ${q.id}: ${row.latency}s  hit=${hit ? 'Y' : 'N'}  ${row.score >= 0 ? 'q=' + row.score : '—'}`);
  }
  return rows;
}

// ── metrics + main ──────────────────────────────────────────────────────────

function metricsFor(name, rows) {
  const ok = rows.filter(r => r.success);
  const hits = rows.filter(r => r.retrieval_hit).length;
  return {
    system: name,
    model: MODEL,
    questions: rows.length,
    success: ok.length,
    latency_p50_s: round(median(ok.map(r => r.latency))),
    latency_mean_s: round(mean(ok.map(r => r.latency))),
    quality_mean: round(mean(rows.map(r => r.score)), 2),
    retrieval_hit_rate: rows.length ? round(hits / rows.length) : null,
    retrieval_hits: hits,
  };
}

async function main() {
  const opts = parseArgs();
  if (opts.help) { console.log(HELP); return; }

  const corpus = loadCorpus();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  PARITY-RETRIEVAL-LOOP — retrieval-in-the-loop   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Questions: ${corpus.questions.length}`);
  console.log(`  System:    ${opts.system}`);
  console.log(`  Judge:     ${opts.noJudge ? 'disabled' : opts.judgeModel}`);
  console.log(`  top_k:     ${opts.topK}`);
  console.log(`  Dry:       ${opts.dry}`);

  if (opts.dry) {
    for (const q of corpus.questions) {
      console.log(`  [DRY] ${q.id} (needle ${q.needle_ids.join(',')}): ${q.question}`);
    }
    return;
  }

  const want = opts.system === 'both' ? ['terransoul', 'openjarvis'] : [opts.system];
  if (!want.every(s => s === 'terransoul' || s === 'openjarvis')) {
    throw new Error(`--system must be terransoul, openjarvis, or both (got '${opts.system}')`);
  }

  const judgeOn = !opts.noJudge && (await checkOllama());
  if (!opts.noJudge && !judgeOn) console.log('⚠ Ollama unreachable — running latency + hit-rate only (no judge).');

  const systems = [];
  const allRows = [];
  for (const name of want) {
    const rows = name === 'terransoul'
      ? await runTerranSoul(corpus, opts, judgeOn)
      : await runOpenJarvis(corpus, opts, judgeOn);
    systems.push(metricsFor(name, rows));
    allRows.push(...rows.map(r => ({ ...r, content: String(r.content).slice(0, 600) })));
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const out = {
    generated_at: new Date().toISOString(),
    bench: 'parity-retrieval-loop',
    model: MODEL,
    judge_model: judgeOn ? opts.judgeModel : null,
    notes: {
      protocol: 'Retrieval-in-the-loop: each system retrieves natively over its OWN pre-ingested store (no handed context), then generates from only what it retrieved. Scored on latency, LLM-judge quality vs the needle gold_answer, and retrieval hit-rate.',
      terransoul: `brain_search over the ISOLATED brain (port ${opts.port}), never the real 7421/7423 companion brain.`,
      openjarvis: `jarvis ask --json default memory-context injection over the isolated home ${opts.ojHome} (store under <home>/.openjarvis); hit signal from jarvis memory search rows + the answer's [Source]/[fact-id] markers.`,
      hit_rate: 'A hit = at least one needle fact appears in the retrieved set (fact-id tag or text-shingle overlap).',
      energy: 'n/a — RTX 3080 Ti does not expose power.draw via NVML/nvidia-smi; not fabricated.',
      usd: '$0 — both fully local.',
    },
    systems,
    questions: allRows,
  };
  const jsonPath = resolve(RESULTS_DIR, 'parity_retrieval_loop.json');
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  console.log('\n════════════ RETRIEVAL-LOOP ════════════');
  for (const s of systems) {
    console.log(`  ${s.system.padEnd(12)} q=${s.quality_mean ?? '—'}/10  p50=${s.latency_p50_s ?? '—'}s  hit=${s.retrieval_hit_rate != null ? (s.retrieval_hit_rate * 100).toFixed(0) + '%' : '—'}  ok=${s.success}/${s.questions}`);
  }
  console.log(`\n  Results: ${jsonPath}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
