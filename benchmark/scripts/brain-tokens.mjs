#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Token-efficiency calculator for the memory-quality benchmark report.
// It compares retrieved-memory context tokens against full-context paste and
// the upstream-style 200-line MEMORY.md baseline.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_REPORT = resolve(
  REPO_ROOT,
  'target-copilot-bench',
  'bench-results',
  'memory_quality.json',
);
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  'src-tauri',
  'benches',
  'memory_quality_fixture.json',
);
const MEMORY_200_LINE_LIMIT = 200;

function option(name, defaultValue) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : defaultValue;
}

function numberOption(name, defaultValue) {
  const raw = option(name, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number, got ${raw}`);
  }
  return parsed;
}

function estimateTokens(text) {
  return Math.ceil(Array.from(text).length / 4);
}

function obsContent(obs) {
  const parts = [obs.title];
  if (obs.subtitle) parts.push(obs.subtitle);
  parts.push(obs.narrative);
  if (obs.facts?.length) parts.push(`Facts: ${obs.facts.join('; ')}`);
  if (obs.concepts?.length) parts.push(`Concepts: ${obs.concepts.join(', ')}`);
  if (obs.files?.length) parts.push(`Files: ${obs.files.join(', ')}`);
  parts.push(`Type: ${obs.type}`);
  return parts.join('\n');
}

function memoryLine(obs) {
  const narrativePrefix = Array.from(obs.narrative).slice(0, 80).join('');
  return `- ${obs.title}: ${narrativePrefix}... [${obs.concepts.slice(0, 3).join(', ')}]`;
}

function formatInt(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCompactTokens(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatInt(value);
}

function printTable(headers, rows) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map(row => String(row[index]).length),
  ));
  const printRow = row => console.log(
    row.map((cell, index) => String(cell).padEnd(widths[index])).join('  '),
  );
  printRow(headers);
  printRow(widths.map(width => '-'.repeat(width)));
  rows.forEach(printRow);
}

function main() {
  const reportPath = resolve(REPO_ROOT, option('report', DEFAULT_REPORT));
  const queriesPerDay = numberOption('queries-per-day', 50);
  const days = numberOption('days', 365);
  const annualQueries = queriesPerDay * days;

  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`Missing fixture: ${FIXTURE_PATH}`);
  }
  if (!existsSync(reportPath)) {
    throw new Error(
      `Missing benchmark report: ${reportPath}\nRun: cd src-tauri && cargo bench --bench memory_quality --target-dir ../target-copilot-bench`,
    );
  }

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const fullContextTokens = fixture.observations
    .map(obs => estimateTokens(obsContent(obs)))
    .reduce((sum, tokens) => sum + tokens, 0);
  const memory200Tokens = fixture.observations
    .slice(0, MEMORY_200_LINE_LIMIT)
    .map(obs => estimateTokens(memoryLine(obs)))
    .reduce((sum, tokens) => sum + tokens, 0);

  const rows = report.systems.map(system => {
    const avgRetrieved = system.avg_retrieved_context_tokens;
    if (!Number.isFinite(avgRetrieved)) {
      throw new Error(
        `Report ${reportPath} does not include BENCH-AM-4 token metrics; rerun the benchmark.`,
      );
    }
    const retrievedYear = avgRetrieved * annualQueries;
    const fullYear = fullContextTokens * annualQueries;
    const memory200Year = memory200Tokens * annualQueries;
    return [
      system.system,
      formatInt(avgRetrieved),
      formatCompactTokens(retrievedYear),
      formatPct(1 - avgRetrieved / fullContextTokens),
      formatCompactTokens(fullYear - retrievedYear),
      formatPct(1 - avgRetrieved / memory200Tokens),
      formatCompactTokens(memory200Year - retrievedYear),
    ];
  });

  console.log('TerranSoul brain token-efficiency calculator');
  console.log(`Report: ${reportPath}`);
  console.log(`Token estimator: ${report.token_estimator ?? 'chars.div_ceil(4)'}`);
  console.log(
    `Fixture: ${fixture.observations.length} observations, ${fixture.queries.length} queries`,
  );
  console.log(
    `Workload: ${formatInt(queriesPerDay)} queries/day * ${formatInt(days)} days = ${formatInt(annualQueries)} queries`,
  );
  console.log(`Full-context paste/query: ${formatInt(fullContextTokens)} tokens`);
  console.log(`200-line MEMORY.md/query: ${formatInt(memory200Tokens)} tokens`);
  console.log('');
  printTable(
    [
      'System',
      'Avg retrieved/query',
      'Retrieved/year',
      'Saved vs full',
      'Full saved/year',
      'Saved vs 200-line',
      '200-line saved/year',
    ],
    rows,
  );
}

try {
  main();
} catch (err) {
  console.error(`[brain:tokens] ${err.message}`);
  process.exit(1);
}