#!/usr/bin/env node
/**
 * PARITY-RETRIEVAL-LOOP — corpus ingest for the retrieval-in-the-loop bench.
 *
 * Seeds fixtures/retrieval-corpus.json (facts + distractors) into BOTH systems'
 * OWN stores, so that run-retrieval-bench.mjs can make each system RETRIEVE
 * natively (no handed context) before it generates an answer.
 *
 *   (a) TerranSoul  → an ISOLATED brain (its own MCP data dir + its own port),
 *                     NEVER the real ~5122-memory companion brain on 7421/7423.
 *                     Facts go in via the `brain_ingest_lesson` MCP tool, the
 *                     same JSON-RPC path runners/terransoul.mjs uses.
 *   (b) OpenJarvis  → the REAL `jarvis` CLI's `jarvis memory index <docsDir>`,
 *                     fed a temp dir of `.md` files (one group of facts per file)
 *                     and isolated under an OPENJARVIS_HOME bench dir so it never
 *                     touches the user's real ~/.openjarvis store.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAUNCHING THE ISOLATED TERRANSOUL BRAIN (do this in a SEPARATE terminal first):
 *
 *   PowerShell:
 *     $env:TERRANSOUL_MCP_DATA_DIR = "D:\Git\TerranSoul\benchmark\parity-personal-ai\.brain-isolated"
 *     $env:TERRANSOUL_MCP_PORT     = "7431"
 *     npm run mcp
 *
 *   bash:
 *     TERRANSOUL_MCP_DATA_DIR="$PWD/benchmark/parity-personal-ai/.brain-isolated" \
 *     TERRANSOUL_MCP_PORT=7431 npm run mcp
 *
 *   The backend reads TERRANSOUL_MCP_DATA_DIR (internal module) and keeps
 *   ALL state — SQLite store, embeddings, and the bearer token
 *   (<data_dir>/mcp-token.txt, see ai_integrations/mcp/internal module) — under that dir.
 *   A distinct port (7431, NOT 7421/7423/7422) guarantees we never touch the
 *   real brain. Start it fresh/empty so retrieval only sees this bench corpus.
 *
 *   This script does NOT spawn that server — launching the Rust MCP runtime is a
 *   heavyweight build step and is intentionally left to `npm run mcp`. The script
 *   only talks to it over HTTP once it is healthy.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   node benchmark/parity-personal-ai/ingest-fixtures.mjs [options]
 *
 * Options (same parsing style as run.mjs):
 *   --system=<terransoul|openjarvis|both>   Which store to seed (default: both)
 *   --port=<n>                              Isolated TerranSoul MCP port (default: env TERRANSOUL_MCP_PORT or 7431)
 *   --home=<path>                           Isolated OpenJarvis home (default: env OPENJARVIS_HOME or .openjarvis-isolated/home)
 *   --dry                                   Print what would be ingested, do nothing
 *   --help                                  Show this help
 *
 * Env:
 *   TERRANSOUL_MCP_PORT       Isolated brain port (default 7431).
 *   TERRANSOUL_MCP_DATA_DIR   Isolated brain data dir (informational here; set it
 *                             when you launch `npm run mcp`). Used to locate the
 *                             token file if mcp-data/ does not have one.
 *   OPENJARVIS_BIN            Path to the real `jarvis` binary (default: the
 *                             installed exe under %LOCALAPPDATA%\OpenJarvis).
 *   OPENJARVIS_HOME           Isolated OpenJarvis home dir; jarvis keeps its
 *                             memory.db under <home>/.openjarvis (default
 *                             .openjarvis-isolated/home under this bench dir).
 *
 * NOTE: the `openjarvis_rust` native module must be built before the CLI works
 * (done out-of-band this session; not the harness's job).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE = resolve(__dirname, 'fixtures/retrieval-corpus.json');
const DEFAULT_TS_PORT = Number.parseInt(process.env.TERRANSOUL_MCP_PORT || '7431', 10);

// ── Shared OpenJarvis isolation constants (kept identical in run-retrieval-bench.mjs) ──
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
const INGEST_TIMEOUT = 120_000;

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

/** Filesystem-safe slug of a corpus id (e.g. 'f-01' → 'f-01'). */
function slug(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const HELP = `PARITY-RETRIEVAL-LOOP — corpus ingest

Seeds fixtures/retrieval-corpus.json into an ISOLATED TerranSoul brain and into
OpenJarvis, so each system can later retrieve the facts natively.

  node benchmark/parity-personal-ai/ingest-fixtures.mjs [options]

  --system=<terransoul|openjarvis|both>   Which store to seed (default: both)
  --port=<n>                              Isolated TerranSoul MCP port (default ${DEFAULT_TS_PORT})
  --home=<path>                           Isolated OpenJarvis home (default ${DEFAULT_OJ_HOME})
  --dry                                   Print plan, ingest nothing
  --help                                  Show this help

Before running with --system=terransoul (or both), launch the isolated brain in
another terminal (NEVER reuse the real 7421/7423 brain):

  TERRANSOUL_MCP_DATA_DIR=benchmark/parity-personal-ai/.brain-isolated \\
  TERRANSOUL_MCP_PORT=${DEFAULT_TS_PORT} npm run mcp
`;

function parseArgs() {
  const opts = {
    system: 'both',
    port: DEFAULT_TS_PORT,
    ojHome: DEFAULT_OJ_HOME,
    dry: false,
    help: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--system=')) opts.system = arg.slice(9);
    else if (arg.startsWith('--port=')) opts.port = Number.parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--home=')) opts.ojHome = arg.slice(7);
    else if (arg === '--dry') opts.dry = true;
  }
  return opts;
}

function loadCorpus() {
  const corpus = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  // Facts + distractors are both ingested: the distractors are what make
  // retrieval non-trivial (the system must surface the right needle among them).
  if (!Array.isArray(corpus.facts) || !corpus.facts.length) {
    throw new Error(`retrieval-corpus.json has no facts array`);
  }
  return corpus;
}

// ── TerranSoul (isolated brain) ─────────────────────────────────────────────

/**
 * Read the bearer token for the ISOLATED brain. Prefer the token in the
 * isolated data dir (<TERRANSOUL_MCP_DATA_DIR>/mcp-token.txt); fall back to the
 * repo-default mcp-data locations the other runners use.
 */
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
  const url = `http://127.0.0.1:${port}/health`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error(
      `Isolated TerranSoul brain is not reachable on :${port}. Launch it first:\n` +
      `  TERRANSOUL_MCP_DATA_DIR=benchmark/parity-personal-ai/.brain-isolated ` +
      `TERRANSOUL_MCP_PORT=${port} npm run mcp\n` +
      `(NEVER reuse the real brain on 7421/7423/7422 — that would pollute results.)`,
    );
  }
  if (!res.ok) throw new Error(`Isolated brain on :${port} returned HTTP ${res.status} from /health`);
  if ([7421, 7423, 7422].includes(port)) {
    throw new Error(
      `Refusing to ingest into port ${port}: that is a real TerranSoul brain port. ` +
      `Use an isolated port (e.g. 7431) via --port / TERRANSOUL_MCP_PORT.`,
    );
  }
}

async function callMcpTool(port, token, toolName, args) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(INGEST_TIMEOUT),
  });
  const body = await res.json();
  if (body.error) return { ok: false, error: body.error.message || JSON.stringify(body.error) };
  // brain_ingest_lesson surfaces failures via result.isError (the silent-ingest
  // class of bug — see COMPARISON.md spec 002 T2). Treat that as a hard failure.
  if (body.result?.isError) {
    const txt = body.result?.content?.[0]?.text ?? JSON.stringify(body.result);
    return { ok: false, error: `isError: ${txt}` };
  }
  return { ok: true, content: body.result?.content?.[0]?.text ?? '' };
}

async function ingestTerranSoul(corpus, opts) {
  const items = corpus.facts;
  console.log(`\n▶ TerranSoul (isolated :${opts.port}) — ingesting ${items.length} facts via brain_ingest_lesson`);

  if (opts.dry) {
    for (const f of items) console.log(`   [DRY] ${f.id}: ${f.text.slice(0, 70)}...`);
    return { system: 'terransoul', total: items.length, ok: 0, failed: 0, dry: true };
  }

  await ensureIsolatedBrain(opts.port);
  const token = readToken();
  if (!token) {
    console.log('   ⚠ No bearer token found; the isolated brain may reject writes. ' +
      'Set TERRANSOUL_MCP_DATA_DIR so the token at <dir>/mcp-token.txt is located.');
  }

  let ok = 0;
  let failed = 0;
  for (const f of items) {
    // Tag each memory with its fact id so the bench can detect a retrieval hit
    // (needle_ids ⊂ retrieved). importance is uniform so ranking is earned by
    // semantics, not by a hand-tuned priority — AGI-purity.
    const r = await callMcpTool(opts.port, token, 'brain_ingest_lesson', {
      content: `[${f.id}] ${f.text}`,
      tags: `retrieval-bench,${f.id}`,
      category: 'retrieval-bench-corpus',
      importance: 5,
    });
    if (r.ok) { ok++; }
    else { failed++; console.log(`   ✗ ${f.id}: ${r.error}`); }
  }
  console.log(`   ✓ ingested ${ok}/${items.length} (failed ${failed})`);
  return { system: 'terransoul', total: items.length, ok, failed };
}

// ── OpenJarvis (real `jarvis memory index`, isolated home) ──────────────────

function openjarvisAvailable() {
  return new Promise((resolveP) => {
    execFile(OPENJARVIS_BIN, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => {
      resolveP(!err);
    });
  });
}

/**
 * Group the corpus into `.md` files for `jarvis memory index`.
 *
 * Why group: jarvis's chunker drops any chunk under `min_chunk_size` (50
 * whitespace tokens), so a one-fact-per-file `.md` (~20 tokens) yields "No
 * indexable content found." Packing a few facts per file clears the floor.
 * Each fact stays on its own paragraph (blank-line separated) prefixed with its
 * `[<id>]` tag, and the file is NAMED after its lead fact's id slug so the
 * `[Source: <slug>.md]` marker jarvis echoes in its answer maps back to a needle
 * id. (.txt is NOT indexed by jarvis — only .md/.markdown/.mdx and code/text.)
 */
function groupCorpusToDocs(items, perFile = 3) {
  const files = [];
  for (let i = 0; i < items.length; i += perFile) {
    const group = items.slice(i, i + perFile);
    const lead = group[0];
    const ids = group.map((f) => f.id);
    const body = group.map((f) => `[${f.id}] ${f.text}`).join('\n\n');
    files.push({ name: `${slug(lead.id)}.md`, ids, body: `${body}\n` });
  }
  return files;
}

function jarvisMemoryIndex(benchHome, docsDir) {
  return new Promise((resolveP) => {
    execFile(
      OPENJARVIS_BIN,
      ['memory', 'index', docsDir],
      { timeout: INGEST_TIMEOUT, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: ojEnv(benchHome) },
      (err, stdout, stderr) => {
        const out = `${stdout || ''}\n${stderr || ''}`;
        if (err) { resolveP({ ok: false, error: (err.message || out).toString().slice(-300) }); return; }
        // jarvis prints "No indexable content found." (not an error exit) when
        // every chunk fell under min_chunk_size — treat that as a hard failure.
        if (/No indexable content found/i.test(out)) {
          resolveP({ ok: false, error: 'jarvis indexed 0 chunks (No indexable content found)' });
          return;
        }
        resolveP({ ok: true, out: out.trim() });
      },
    );
  });
}

async function ingestOpenJarvis(corpus, opts) {
  const items = corpus.facts; // facts + distractors (both live in corpus.facts)
  const benchHome = opts.ojHome;
  const docsDir = resolve(dirname(benchHome), 'docs');
  const files = groupCorpusToDocs(items);
  console.log(`\n▶ OpenJarvis — writing ${items.length} facts/distractors into ${files.length} .md files`);
  console.log(`   docs: ${docsDir}`);
  console.log(`   home: ${benchHome}  (isolated; jarvis store → <home>/.openjarvis/memory.db)`);

  if (opts.dry) {
    for (const f of files) console.log(`   [DRY] ${f.name} (${f.ids.join(',')})`);
    console.log(`   [DRY] jarvis memory index "${docsDir}"  (OPENJARVIS_HOME=${benchHome})`);
    return { system: 'openjarvis', total: items.length, ok: 0, failed: 0, dry: true };
  }

  if (!(await openjarvisAvailable())) {
    throw new Error(
      `OpenJarvis CLI '${OPENJARVIS_BIN}' is not runnable. Install OpenJarvis and ` +
      `build the openjarvis_rust native module, or set OPENJARVIS_BIN to the jarvis ` +
      `exe. Refusing to fabricate ingest results.`,
    );
  }

  // Start the isolated store fresh so retrieval only sees this bench corpus.
  rmSync(benchHome, { recursive: true, force: true });
  rmSync(docsDir, { recursive: true, force: true });
  mkdirSync(benchHome, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  for (const f of files) writeFileSync(resolve(docsDir, f.name), f.body, 'utf8');

  const r = await jarvisMemoryIndex(benchHome, docsDir);
  if (!r.ok) {
    console.log(`   ✗ jarvis memory index failed: ${r.error}`);
    return { system: 'openjarvis', total: items.length, ok: 0, failed: items.length };
  }
  console.log(`   ✓ ${r.out.split('\n').filter(Boolean).pop()}`);
  return { system: 'openjarvis', total: items.length, ok: items.length, failed: 0 };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  if (opts.help) { console.log(HELP); return; }

  const corpus = loadCorpus();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  PARITY-RETRIEVAL-LOOP — corpus ingest           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Corpus: ${corpus.facts.length} facts/distractors, ${corpus.questions.length} needle questions`);
  console.log(`  System: ${opts.system}`);
  console.log(`  TS port: ${opts.port}   OJ home: ${opts.ojHome}`);
  console.log(`  Dry:    ${opts.dry}`);

  const want = opts.system === 'both' ? ['terransoul', 'openjarvis'] : [opts.system];
  if (!want.every(s => s === 'terransoul' || s === 'openjarvis')) {
    throw new Error(`--system must be terransoul, openjarvis, or both (got '${opts.system}')`);
  }

  const summary = [];
  if (want.includes('terransoul')) summary.push(await ingestTerranSoul(corpus, opts));
  if (want.includes('openjarvis')) summary.push(await ingestOpenJarvis(corpus, opts));

  console.log('\n════════════════ INGEST SUMMARY ════════════════');
  for (const s of summary) {
    console.log(`  ${s.system.padEnd(12)} ${s.ok}/${s.total} ingested${s.dry ? ' (dry)' : ''}${s.failed ? `  FAILED ${s.failed}` : ''}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
