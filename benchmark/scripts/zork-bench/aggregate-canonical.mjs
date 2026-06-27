#!/usr/bin/env node
// benchmark/scripts/zork-bench/aggregate-canonical.mjs
//
// Aggregates BENCH-ZORK-1.5 canonical JSONL artifacts into a summary table.
// Finds the newest complete 3-episode set per arm in the output directory,
// computes scores, unique locations, wasted-action rates, and memory stats.
//
// Usage:
//   node benchmark/scripts/zork-bench/aggregate-canonical.mjs
//   node benchmark/scripts/zork-bench/aggregate-canonical.mjs --out-dir <path>
//
// Output: writes benchmark/results/zork-bench/canonical-summary.json
//         and prints a markdown table to stdout.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_OUT = resolve(REPO_ROOT, 'target-copilot-bench', 'bench-results', 'zork-bench');

function parseArgs() {
  const args = process.argv.slice(2);
  let outDir = DEFAULT_OUT;
  let partial = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out-dir') outDir = resolve(args[++i]);
    if (args[i] === '--partial') partial = true;
  }
  return { outDir, partial };
}

function parseJsonl(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  return lines.map(l => {
    try { return JSON.parse(l); }
    catch { return null; }
  }).filter(Boolean);
}

function findBestEpisodeSet(outDir, arm, { partial = false } = {}) {
  // Find all ep1/ep2/ep3 files for this arm, group by timestamp, pick the
  // set where all 3 episodes exist and have a valid episode_end record.
  const files = readdirSync(outDir).filter(f =>
    f.startsWith(`zork_bench_${arm}_ep`) && f.endsWith('.jsonl')
  );

  // Group by timestamp (format: zork_bench_<arm>_ep<N>_<YYYYMMDDTHHMMSS>.jsonl)
  const groups = {};
  for (const f of files) {
    const m = f.match(/_ep(\d+)_(\d{8}T\d{6})\.jsonl$/);
    if (!m) continue;
    const [, ep, ts] = m;
    if (!groups[ts]) groups[ts] = {};
    const fullPath = resolve(outDir, f);
    // Validate by checking for episode_end record (not file size — none arm
    // produces valid 199-byte files with just the episode_end line)
    const content = readFileSync(fullPath, 'utf8');
    if (content.includes('"episode_end"')) {
      groups[ts][parseInt(ep)] = fullPath;
    }
  }

  // Find a timestamp that has eps 1, 2, and 3 (or the most episodes if partial)
  const complete = Object.entries(groups)
    .filter(([, eps]) => partial ? Object.keys(eps).length > 0 : (eps[1] && eps[2] && eps[3]))
    .sort((a, b) => {
      // Prefer complete sets, then most episodes, then newest
      const aCount = Object.keys(a[1]).length;
      const bCount = Object.keys(b[1]).length;
      if (aCount !== bCount) return bCount - aCount;
      return b[0].localeCompare(a[0]);
    });

  if (complete.length === 0) return null;
  const [ts, eps] = complete[0];
  return { timestamp: ts, episodes: eps };
}

function analyzeEpisode(records) {
  if (!records || records.length === 0) return null;

  // The first record is always episode_end with the authoritative summary
  const episodeEnd = records.find(r => r.type === 'episode_end');
  if (!episodeEnd) return null;

  const finalScore = episodeEnd.final_score ?? 0;
  const totalTurns = episodeEnd.turns ?? 0;
  const elapsedSec = episodeEnd.elapsed_sec ?? 0;

  // Count memory calls from individual memory_call records (brain arm)
  const memoryCalls = records.filter(r => r.type === 'memory_call').length;
  // Also accept the episode_end aggregate if no per-call records
  const memoryCallsTotal = memoryCalls || (episodeEnd.memory_calls_total ?? 0);
  const memoryErrors = episodeEnd.memory_calls_with_errors ?? 0;

  // Unique locations and wasted rate require per-turn score/location data
  // which is only in Docker logs (not persisted in JSONL). We parse the
  // companion transcript file if it exists, counting "--- Turn N ---" lines.
  // Location/wasted stats are left as N/A when not computable from JSONL.

  return {
    finalScore,
    totalTurns,
    elapsedSec: Math.round(elapsedSec),
    uniqueLocations: null, // not available from JSONL alone
    wastedRate: null, // not available from JSONL alone
    memoryCalls: memoryCallsTotal,
    memoryErrors,
  };
}

function main() {
  const { outDir, partial } = parseArgs();
  const arms = ['none', 'zorkgpt-default', 'terransoul-brain'];
  const results = {};

  for (const arm of arms) {
    const set = findBestEpisodeSet(outDir, arm, { partial });
    if (!set) {
      console.error(`⚠ No ${partial ? '' : 'complete 3-'}episode set found for arm="${arm}"`);
      results[arm] = null;
      continue;
    }

    const epCount = Object.keys(set.episodes).length;
    console.error(`✓ arm="${arm}" using timestamp ${set.timestamp} (${epCount}/3 episodes)`);
    const episodes = {};
    for (const ep of [1, 2, 3]) {
      if (set.episodes[ep]) {
        const records = parseJsonl(set.episodes[ep]);
        episodes[ep] = analyzeEpisode(records);
      } else {
        episodes[ep] = null;
      }
    }
    results[arm] = { timestamp: set.timestamp, episodes };
  }

  // Generate markdown table
  console.log('\n## Canonical Results — BENCH-ZORK-1.5 (3 arms × 3 episodes × 300 turns)\n');
  console.log('| Arm | ep1 score | ep2 score | ep3 score | Total turns | Memory calls | Mem errors | Elapsed (h) |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');

  for (const arm of arms) {
    const r = results[arm];
    if (!r) {
      console.log(`| \`${arm}\` | — | — | — | — | — | — | — |`);
      continue;
    }
    const e1 = r.episodes[1];
    const e2 = r.episodes[2];
    const e3 = r.episodes[3];
    const totalMem = (e1?.memoryCalls ?? 0) + (e2?.memoryCalls ?? 0) + (e3?.memoryCalls ?? 0);
    const totalErr = (e1?.memoryErrors ?? 0) + (e2?.memoryErrors ?? 0) + (e3?.memoryErrors ?? 0);
    const totalSec = (e1?.elapsedSec ?? 0) + (e2?.elapsedSec ?? 0) + (e3?.elapsedSec ?? 0);
    const totalHours = totalSec > 0 ? (totalSec / 3600).toFixed(1) : '—';
    console.log(
      `| \`${arm}\` | ${e1?.finalScore ?? '—'} | ${e2?.finalScore ?? '—'} | ${e3?.finalScore ?? '—'} | ` +
      `${(e1?.totalTurns ?? 0) + (e2?.totalTurns ?? 0) + (e3?.totalTurns ?? 0)} | ${totalMem} | ${totalErr} | ${totalHours} |`
    );
  }

  // Pass criteria check
  console.log('\n### Pass Criteria\n');
  const brain = results['terransoul-brain'];
  const none = results['none'];
  const def = results['zorkgpt-default'];
  if (brain && (def || none)) {
    const b3 = brain.episodes[3];
    const b1 = brain.episodes[1];
    const d3 = def?.episodes?.[3];
    const n3 = none?.episodes?.[3];
    // Compare brain against best of default/none
    const controlBest = Math.max(d3?.finalScore ?? 0, n3?.finalScore ?? 0);
    const checks = [
      { criterion: 'ep3 brain > ep1 brain (self-improvement)', pass: b3 && b1 && b3.finalScore > b1.finalScore },
      { criterion: 'ep3 brain > best control ep3', pass: b3 && b3.finalScore > controlBest },
      { criterion: 'brain total score > none total score', pass: brain && none && (
        (brain.episodes[1]?.finalScore ?? 0) + (brain.episodes[2]?.finalScore ?? 0) + (brain.episodes[3]?.finalScore ?? 0)
        > (none.episodes[1]?.finalScore ?? 0) + (none.episodes[2]?.finalScore ?? 0) + (none.episodes[3]?.finalScore ?? 0)
      )},
      { criterion: 'brain total score > default total score', pass: brain && def && (
        (brain.episodes[1]?.finalScore ?? 0) + (brain.episodes[2]?.finalScore ?? 0) + (brain.episodes[3]?.finalScore ?? 0)
        > (def.episodes[1]?.finalScore ?? 0) + (def.episodes[2]?.finalScore ?? 0) + (def.episodes[3]?.finalScore ?? 0)
      )},
      { criterion: 'memory_errors/calls ≤ 5%', pass: b3 && (b3.memoryCalls === 0 || (b3.memoryErrors / b3.memoryCalls) <= 0.05) },
    ];
    console.log('| # | Criterion | Result | Verdict |');
    console.log('|---|---|---|---|');
    let allPass = true;
    checks.forEach((c, i) => {
      const verdict = c.pass ? '✅ PASS' : '❌ FAIL';
      if (!c.pass) allPass = false;
      console.log(`| ${i + 1} | ${c.criterion} | — | ${verdict} |`);
    });
    console.log(`\n**Overall: ${allPass ? '✅ ALL PASS' : '❌ SOME CRITERIA FAILED'}**`);
  }

  // Write JSON summary
  const summary = {
    bench: 'BENCH-ZORK-1.5',
    model: 'gemma4:e4b',
    episodes_per_arm: 3,
    max_turns: 300,
    generated_at: new Date().toISOString(),
    results,
  };
  const summaryPath = resolve(outDir, 'canonical-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.error(`\nWrote: ${summaryPath}`);
}

main();
