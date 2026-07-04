#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// JD-DEMO-COMPARISON — Claude Sonnet 5 in-context ceiling harness.
//
// Question: what is the MAXIMUM number of résumés Claude Sonnet 5
// (`claude-sonnet-5`, 1,000,000-token context) can do the JD-matching task on
// — its real in-context ceiling, measured honestly?
//
// For a given N it takes the FIRST N deterministic résumés (seed = jd-corpus
// DEFAULT_SEED), sends their TEXT + one JD's queryText to Sonnet 5, asks for
// the ranked top matching candidate IDs, and scores NDCG@10 / recall against
// the gold set (computed AFTER the call — never shown to the model).
//
// Two ceilings are reported:
//   * CONTEXT ceiling — the largest N whose prompt still fits the 1M window
//     (the model doesn't refuse / truncate / auto-compact).
//   * ACCURACY ceiling — the largest N where NDCG@10 stays ~1.0 (needle in a
//     growing haystack).
// The reportable "max résumés Sonnet 5 can JD" = the largest N meeting BOTH.
//
// Transport: the `claude` CLI on the user's Pro/Max subscription (no API key):
//   claude --model claude-sonnet-5 --output-format json --tools "" -p  (prompt on stdin)
// `--tools ""` disables every built-in tool so the model must reason over the
// résumé text IN CONTEXT (no grep/script shortcut). The JSON envelope's
// `usage` gives the exact prompt-token count (real tokenizer) for the ceiling.
//
// FAIRNESS: the model sees only résumé text (labelled with its id) + the JD
// queryText. Gold / meta / matchesJd are NEVER in the prompt.
//
// Usage:
//   node jd-sonnet-ceiling.mjs --n 3000 [--jd jd-en-backend] [--dry-run]
//   node jd-sonnet-ceiling.mjs --n 6000 --out ../results/jd-million/claude-sonnet5-ceiling.json
//
// One N per invocation (cost control); results upsert into the --out file.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildResume, matchesJd, DEFAULT_SEED } from './jd-corpus.mjs';
import { JD_QUERIES } from './jd-queries.mjs';
import { recallAtK, precisionAtK, ndcgAtK } from './lib/jd-metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = 'claude-sonnet-5';
const CONTEXT_WINDOW = 1_000_000; // claude-sonnet-5 (confirmed via CLI modelUsage)

function opt(name, def) {
  const eq = process.argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return def;
}
const hasFlag = name => process.argv.includes(`--${name}`);

const N = Number(opt('n', '300'));
const jdId = opt('jd', 'jd-en-backend');
const seed = Number(opt('seed', String(DEFAULT_SEED)));
const outPath = resolve(HERE, opt('out', '../results/jd-million/claude-sonnet5-ceiling.json'));
const dryRun = hasFlag('dry-run');

const jd = JD_QUERIES.find(q => q.id === jdId);
if (!jd) throw new Error(`unknown jd: ${jdId}`);

// --- build the first-N corpus slice + gold (gold used only for scoring) -----
const candidates = []; // { id, text }
const goldIds = [];
const goldByLang = {};
for (let i = 0; i < N; i += 1) {
  const { meta, session } = buildResume(i, seed);
  candidates.push({ id: session.session_id, text: session.text });
  if (matchesJd(meta, jd)) {
    goldIds.push(meta.id);
    goldByLang[meta.lang] = (goldByLang[meta.lang] ?? 0) + 1;
  }
}
const goldSet = new Set(goldIds);

// --- build the prompt (text + id labels + JD queryText only) ----------------
const header =
  'You are a technical recruiter ranking candidate résumés against one job description.\n'
  + `Below are ${N} candidate résumés, each preceded by its ID on its own line in the form [res-<n>].\n`
  + 'After the résumés comes the JOB DESCRIPTION.\n\n'
  + 'Task: identify the candidates whose résumé best matches the job description, and rank them.\n'
  + 'Output RULES (obey exactly):\n'
  + '  - Output ONLY a JSON array of up to 10 candidate IDs, ranked best match first.\n'
  + '  - Use the exact IDs shown (e.g. "res-1234"). No prose, no explanation, no markdown fences.\n'
  + '  - If fewer than 10 candidates truly match, return only the ones that match.\n'
  + '  Example of a valid answer: ["res-12","res-345","res-6789"]\n';

const body = candidates.map(c => `[${c.id}]\n${c.text}`).join('\n\n');
const prompt =
  `${header}\n===== CANDIDATE RÉSUMÉS (${N}) =====\n\n${body}\n\n`
  + `===== JOB DESCRIPTION =====\n${jd.queryText}\n\n`
  + 'Return the JSON array of the top matching candidate IDs now:';

const promptChars = prompt.length;
const estTokens = Math.round(promptChars / 3.1); // sonnet-5 tokenizer ~30% denser than chars/4

console.error(`[jd-sonnet-ceiling] N=${N} jd=${jdId} seed=${seed}`);
console.error(`  candidates=${candidates.length} gold=${goldSet.size} goldByLang=${JSON.stringify(goldByLang)}`);
console.error(`  prompt chars=${promptChars} est_tokens≈${estTokens} (chars/3.1)`);

if (dryRun) {
  console.error('  [dry-run] not calling the model.');
  process.exit(0);
}

// --- call Sonnet 5 via the claude CLI (prompt on stdin) ---------------------
const t0 = Date.now();
const proc = spawnSync('claude', ['--model', MODEL, '--output-format', 'json', '--tools', '', '-p'], {
  input: prompt,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  windowsHide: true,
});
const wallSeconds = (Date.now() - t0) / 1000;

let fit = true;
let refusalOrError = null;
let resultText = '';
let usage = null;
let cliModel = null;

if (proc.error) {
  fit = false;
  refusalOrError = `spawn error: ${proc.error.message}`;
} else if (proc.status !== 0) {
  fit = false;
  refusalOrError = `exit ${proc.status}: ${(proc.stderr || '').slice(0, 500)}`;
} else {
  try {
    const env = JSON.parse(proc.stdout);
    if (env.is_error) {
      fit = false;
      refusalOrError = `is_error: ${env.result || env.subtype || 'unknown'}`;
    }
    resultText = env.result || '';
    usage = env.usage || null;
    cliModel = env.modelUsage ? Object.keys(env.modelUsage).find(m => m.includes('sonnet')) : null;
    // A "prompt too long" / auto-compaction is a context-ceiling signal.
    const low = `${resultText} ${proc.stderr || ''}`.toLowerCase();
    if (low.includes('prompt is too long') || low.includes('context low') || low.includes('compact')) {
      fit = false;
      refusalOrError = refusalOrError || 'context-limit signal in output';
    }
  } catch (e) {
    fit = false;
    refusalOrError = `parse error: ${e.message}; head=${(proc.stdout || '').slice(0, 300)}`;
  }
}

// --- exact prompt-token count from usage (real tokenizer) -------------------
let promptTokens = null;
if (usage) {
  promptTokens = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}

// --- extract ranked IDs -----------------------------------------------------
function extractRankedIds(text) {
  // Prefer a JSON array of res-ids.
  const m = text.match(/\[[\s\S]*?\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        const ids = arr.map(String).filter(s => /^res-\d+$/.test(s));
        if (ids.length) return dedupe(ids);
      }
    } catch { /* fall through */ }
  }
  // Fallback: every res-<n> token in order.
  const found = text.match(/res-\d+/g) || [];
  return dedupe(found);
}
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
  return out;
}

const ranked = extractRankedIds(resultText);
const inRange = ranked.filter(id => {
  const n = Number(id.slice(4));
  return Number.isInteger(n) && n >= 0 && n < N;
});
const outOfRange = ranked.length - inRange.length;

// --- score (only meaningful when gold is non-empty) -------------------------
const ndcg10 = ndcgAtK(ranked, goldSet, 10);
const rec10 = recallAtK(ranked, goldSet, 10);
const rec20 = recallAtK(ranked, goldSet, 20);
const prec10 = precisionAtK(ranked, goldSet, 10);

const rec = {
  N,
  jd_id: jdId,
  jd_lang: jd.lang,
  seed,
  gold_size: goldSet.size,
  gold_by_lang: goldByLang,
  fit,
  refusal_or_error: refusalOrError,
  prompt_chars: promptChars,
  prompt_tokens: promptTokens,          // exact, from CLI usage
  prompt_tokens_estimate: estTokens,    // chars/3.1 fallback
  context_window: CONTEXT_WINDOW,
  context_used_frac: promptTokens ? +(promptTokens / CONTEXT_WINDOW).toFixed(4) : null,
  cli_model: cliModel,
  returned_ids: ranked.length,
  out_of_range_ids: outOfRange,
  ndcg_at_10: ndcgAtK(ranked, goldSet, 10),
  recall_at_10: rec10,
  recall_at_20: rec20,
  precision_at_10: prec10,
  latency_seconds: +wallSeconds.toFixed(1),
  ranked_top: ranked.slice(0, 20),
  measured_at: new Date().toISOString(),
};

console.error(`  -> fit=${fit} promptTokens=${promptTokens} ndcg@10=${ndcg10.toFixed(3)} `
  + `recall@10=${rec10.hits}/${Math.min(10, goldSet.size)} returned=${ranked.length} `
  + `outOfRange=${outOfRange} wall=${wallSeconds.toFixed(1)}s`);
if (refusalOrError) console.error(`  refusal_or_error: ${refusalOrError}`);

// --- upsert into the results file -------------------------------------------
mkdirSync(dirname(outPath), { recursive: true });
let doc;
if (existsSync(outPath)) {
  doc = JSON.parse(readFileSync(outPath, 'utf8'));
} else {
  doc = {
    benchmark: 'JD-DEMO-COMPARISON — Claude Sonnet 5 in-context ceiling',
    model: MODEL,
    method: 'cli',
    transport: `claude --model ${MODEL} --output-format json --tools "" -p (prompt on stdin; user Pro/Max subscription, no API key)`,
    tools_disabled: true,
    context_window: CONTEXT_WINDOW,
    seed,
    jd_id: jdId,
    gold_predicate: 'area==jd.area AND >=2 requiredSkills present AND years>=minYears (matchesJd; computed after the call, never in the prompt)',
    corpus_note: 'FIRST-N deterministic résumés (buildResume(i, seed)); first-N gold density for jd-en-backend is sparse (0@300, 0@1000, 1@3000, 6@6000, 13@10000).',
    per_n: [],
    context_ceiling: null,
    accuracy_ceiling: null,
    max_resumes: null,
  };
}
doc.per_n = (doc.per_n || []).filter(e => e.N !== N);
doc.per_n.push(rec);
doc.per_n.sort((a, b) => a.N - b.N);

// Derive ceilings from what we've measured so far.
const fits = doc.per_n.filter(e => e.fit);
const perfect = doc.per_n.filter(e => e.fit && e.gold_size > 0 && e.ndcg_at_10 === 1);
doc.context_ceiling = fits.length ? Math.max(...fits.map(e => e.N)) : null;
doc.accuracy_ceiling = perfect.length ? Math.max(...perfect.map(e => e.N)) : null;
doc.max_resumes = (doc.context_ceiling != null && doc.accuracy_ceiling != null)
  ? Math.min(doc.context_ceiling, doc.accuracy_ceiling)
  : (doc.context_ceiling ?? null);
doc.updated_at = new Date().toISOString();

writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.error(`  wrote ${outPath}  (context_ceiling=${doc.context_ceiling} accuracy_ceiling=${doc.accuracy_ceiling} max=${doc.max_resumes})`);
