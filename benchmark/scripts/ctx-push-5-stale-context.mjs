#!/usr/bin/env node
// CTX-PUSH-5 — does OUR OWN CLI fall for a stale fact, the way the
// meetless.ai stale-context field benchmark shows external coding agents
// do? LongMemEval structurally cannot measure this (it supplies the query
// alongside a fixed haystack); this plants a fact, then a superseding
// correction, as two separate real `--ask` turns (chat turns are
// auto-remembered — the real production ingest path, not a synthetic
// seed), then asks a question whose correct answer needs the CURRENT fact
// at each of the four thinking rungs, and reports per-rung whether the
// answer used the current fact, the stale one, or neither.
//
// Usage:
//   node benchmark/scripts/ctx-push-5-stale-context.mjs [--modes=chat,think,research,max] [--cli-bin=<path>]

import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function option(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

const CLI_BIN = option(
  'cli-bin',
  process.env.TERRANSOUL_CLI_BIN ||
    resolve(REPO_ROOT, 'src-tauri', 'target', 'release', 'cli', 'terransoul.exe'),
);
if (!existsSync(CLI_BIN)) {
  console.error(`[ctx-push-5] CLI binary not found at ${CLI_BIN}. Build it: npm run build:cli`);
  process.exit(1);
}

const MODES = option('modes', 'chat,think,research,max').split(',').map((s) => s.trim()).filter(Boolean);

// Each scenario: an initial (stale) fact, a later correction that
// SUPERSEDES it (real chat turns, not a synthetic haystack row), a
// question whose correct answer needs the CURRENT value, and regexes to
// classify which value (if any) the reply actually used.
const SCENARIOS = [
  {
    name: 'project-deadline',
    stale: 'The Q3 project deadline is March 1st.',
    current: 'Correction — the Q3 project deadline has been moved. It is now April 15th, not March 1st.',
    question: 'What is the current Q3 project deadline?',
    // `\b` alone breaks on an ordinal suffix ("1st"/"15th" have no word
    // boundary between the digit and the letter) — a real bug this harness's
    // first run actually hit, misclassifying a correct "April 15th" reply as
    // "neither". Allow the ordinal suffix explicitly, still `\b`-terminated
    // so "1" cannot falsely match as a prefix of "15".
    staleMarker: /march\s*1(?:st)?\b/i,
    currentMarker: /april\s*15(?:th)?\b/i,
  },
  {
    name: 'oncall-contact',
    stale: 'The current on-call engineer for the payments service is Priya.',
    current: "Update — the on-call rotation changed. Priya is off rotation now; Marcus is the current on-call engineer for the payments service.",
    question: 'Who is the current on-call engineer for the payments service?',
    staleMarker: /priya/i,
    currentMarker: /marcus/i,
  },
];

function ask(dataDir, question, mode) {
  const r = spawnSync(
    CLI_BIN,
    ['--ask', question, '--mode', mode, '--json'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, TERRANSOUL_HEADLESS_DATA_DIR: dataDir },
      encoding: 'utf8',
      timeout: 180000,
    },
  );
  if (r.status !== 0) {
    return { ok: false, error: `exit ${r.status}: ${r.stderr || r.stdout}` };
  }
  try {
    // --ask --json prints exactly one JSON object as its final stdout line.
    const lines = r.stdout.trim().split('\n');
    const parsed = JSON.parse(lines[lines.length - 1]);
    return { ok: true, ...parsed };
  } catch (e) {
    return { ok: false, error: `unparseable --json output: ${e.message}\nstdout: ${r.stdout}` };
  }
}

function classify(reply, scenario) {
  const usesStale = scenario.staleMarker.test(reply);
  const usesCurrent = scenario.currentMarker.test(reply);
  if (usesCurrent && !usesStale) return 'current';
  if (usesStale && !usesCurrent) return 'stale';
  if (usesCurrent && usesStale) return 'both';
  return 'neither';
}

async function main() {
  console.log(`[ctx-push-5] CLI: ${CLI_BIN}`);
  console.log(`[ctx-push-5] modes: ${MODES.join(', ')}`);
  const results = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n[ctx-push-5] scenario: ${scenario.name}`);
    const dataDir = mktempDataDir(scenario.name);

    // Plant the stale fact, then the superseding correction — two separate
    // real turns, exactly the "confident summary already in context" shape
    // the field benchmark's failure mode is about, except here it is our
    // OWN memory doing the summarizing across turns, not a static file.
    const plant1 = ask(dataDir, scenario.stale, 'chat');
    if (!plant1.ok) { console.error(`  [plant stale] FAILED: ${plant1.error}`); continue; }
    const plant2 = ask(dataDir, scenario.current, 'chat');
    if (!plant2.ok) { console.error(`  [plant current] FAILED: ${plant2.error}`); continue; }

    for (const mode of MODES) {
      const r = ask(dataDir, scenario.question, mode);
      if (!r.ok) {
        console.error(`  [${mode}] FAILED: ${r.error}`);
        results.push({ scenario: scenario.name, mode, verdict: 'error', error: r.error });
        continue;
      }
      const verdict = classify(r.content ?? '', scenario);
      console.log(`  [${mode}] verdict=${verdict} context_memory_ids=${JSON.stringify(r.context_memory_ids ?? [])}`);
      console.log(`  [${mode}] reply: ${(r.content ?? '').slice(0, 200)}`);
      results.push({
        scenario: scenario.name,
        mode,
        verdict,
        reply: r.content,
        context_memory_ids: r.context_memory_ids ?? null,
      });
    }
  }

  const outDir = resolve(REPO_ROOT, 'benchmark', 'results', 'ctx-push-5');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'ctx-push-5-stale-context.json');
  writeFileSync(outPath, JSON.stringify({ cliBin: CLI_BIN, modes: MODES, results }, null, 2));

  console.log('\n[ctx-push-5] per-rung summary:');
  for (const mode of MODES) {
    const rows = results.filter((r) => r.mode === mode);
    const current = rows.filter((r) => r.verdict === 'current').length;
    const stale = rows.filter((r) => r.verdict === 'stale').length;
    const other = rows.length - current - stale;
    console.log(`  ${mode}: ${current}/${rows.length} used the CURRENT fact, ${stale}/${rows.length} used the STALE fact, ${other}/${rows.length} other`);
  }
  console.log(`\n[ctx-push-5] full results: ${outPath}`);
}

function mktempDataDir(label) {
  return mkdtempSync(resolve(tmpdir(), `ctx-push-5-${label}-`));
}

await main();
