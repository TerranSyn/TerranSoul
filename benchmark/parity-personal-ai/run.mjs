#!/usr/bin/env node
/**
 * Parity Personal-AI Benchmark — Orchestrator
 *
 * Runs all 7 task archetypes through TerranSoul MCP, optionally scores
 * them with an LLM-judge via Ollama, and writes results to
 * benchmark/results/parity_personal_ai.{json,md}
 *
 * Usage:
 *   node benchmark/parity-personal-ai/run.mjs [--task=<name>] [--no-judge] [--dry] [--judge-model=<model>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFixture, warmup } from './runners/terransoul.mjs';
import { judgeResponse, checkOllama } from './judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const RESULTS_DIR = resolve(__dirname, '../../benchmark/results');

const ALL_ARCHETYPES = [
  'daily-digest', 'deep-research', 'code-assistant',
  'scheduled-monitor', 'chat-simple', 'voice-companion', 'vrm-overlay',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { task: null, noJudge: false, dry: false, judgeModel: null };
  for (const arg of args) {
    if (arg.startsWith('--task=')) opts.task = arg.slice(7);
    else if (arg === '--no-judge') opts.noJudge = true;
    else if (arg === '--dry') opts.dry = true;
    else if (arg.startsWith('--judge-model=')) opts.judgeModel = arg.slice(14);
  }
  return opts;
}

function loadFixture(archetype) {
  const fp = resolve(FIXTURES_DIR, `${archetype}.json`);
  return JSON.parse(readFileSync(fp, 'utf8'));
}

function formatDuration(seconds) {
  return seconds < 1 ? `${(seconds * 1000).toFixed(0)}ms` : `${seconds.toFixed(2)}s`;
}

async function main() {
  const opts = parseArgs();
  const archetypes = opts.task ? [opts.task] : ALL_ARCHETYPES;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  TerranSoul Parity Personal-AI Benchmark        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Tasks: ${archetypes.join(', ')}`);
  console.log(`  Judge: ${opts.noJudge ? 'disabled' : (opts.judgeModel || 'gemma3:4b')}`);
  console.log(`  Dry:   ${opts.dry}`);
  console.log('');

  if (opts.dry) {
    for (const arch of archetypes) {
      const fixture = loadFixture(arch);
      console.log(`[DRY] ${arch}: ${fixture.prompts.length} prompts`);
      for (const p of fixture.prompts) {
        console.log(`       - ${p.id}: "${p.input.slice(0, 60)}..."`);
      }
    }
    return;
  }

  // Check Ollama for judge
  let judgeAvailable = false;
  if (!opts.noJudge) {
    judgeAvailable = await checkOllama();
    if (!judgeAvailable) {
      console.log('⚠ Ollama not reachable — skipping judge scoring (latency-only mode)');
    }
  }

  const allResults = [];
  const summary = {};

  // Warmup: pre-heat embedding model before timed runs
  console.log('⏳ Warming up MCP (loading embedding model)...');
  try {
    await warmup();
    console.log('✓ Warmup complete\n');
  } catch (err) {
    console.log(`⚠ Warmup failed: ${err.message} — proceeding anyway\n`);
  }

  for (const arch of archetypes) {
    const fixture = loadFixture(arch);
    console.log(`\n▶ Running: ${arch} (${fixture.prompts.length} prompts)`);

    let archResults;
    try {
      archResults = await runFixture(resolve(FIXTURES_DIR, `${arch}.json`));
    } catch (err) {
      console.log(`  ✗ MCP error: ${err.message}`);
      summary[arch] = { avgLatency: -1, avgScore: -1, success: 0, total: fixture.prompts.length };
      continue;
    }

    // Judge each result
    const scored = [];
    for (let i = 0; i < archResults.length; i++) {
      const r = archResults[i];
      let score = -1;
      let reason = 'judge disabled';

      if (judgeAvailable && !opts.noJudge && r.success) {
        const prompt = fixture.prompts[i];
        const judgeResult = await judgeResponse({
          prompt: prompt.input,
          response: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          rubric: fixture.scoring_rubric,
          model: opts.judgeModel,
        });
        score = judgeResult.score;
        reason = judgeResult.reason;
      }

      scored.push({ ...r, score, reason });
      const statusIcon = r.success ? '✓' : '✗';
      const scoreStr = score >= 0 ? `score=${score}` : 'no-score';
      console.log(`  ${statusIcon} ${r.id}: ${formatDuration(r.latency)} | ${scoreStr}`);
    }

    const successes = scored.filter(s => s.success);
    const avgLatency = successes.length > 0
      ? successes.reduce((a, b) => a + b.latency, 0) / successes.length
      : -1;
    const validScores = scored.filter(s => s.score >= 0);
    const avgScore = validScores.length > 0
      ? validScores.reduce((a, b) => a + b.score, 0) / validScores.length
      : -1;

    summary[arch] = {
      avgLatency: Math.round(avgLatency * 1000) / 1000,
      avgScore: Math.round(avgScore * 10) / 10,
      success: successes.length,
      total: scored.length,
    };

    allResults.push(...scored.map(s => ({ archetype: arch, ...s })));
  }

  // Write results
  mkdirSync(RESULTS_DIR, { recursive: true });

  const jsonPath = resolve(RESULTS_DIR, 'parity_personal_ai.json');
  writeFileSync(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), summary, results: allResults }, null, 2));

  // Write Markdown summary
  const mdLines = [
    '# Parity Personal-AI Benchmark Results',
    '',
    `> Run: ${new Date().toISOString()}`,
    `> Judge: ${opts.noJudge ? 'disabled' : (opts.judgeModel || 'gemma3:1b')}`,
    '',
    '| Archetype | Latency (avg) | Quality (0–10) | Success |',
    '|---|---|---|---|',
  ];

  for (const arch of archetypes) {
    const s = summary[arch];
    if (!s) continue;
    const lat = s.avgLatency >= 0 ? formatDuration(s.avgLatency) : 'N/A';
    const qual = s.avgScore >= 0 ? s.avgScore.toFixed(1) : 'N/A';
    mdLines.push(`| ${arch} | ${lat} | ${qual} | ${s.success}/${s.total} |`);
  }

  // Overall
  const allValid = Object.values(summary).filter(s => s.avgLatency >= 0);
  if (allValid.length > 0) {
    const overallLat = allValid.reduce((a, b) => a + b.avgLatency, 0) / allValid.length;
    const scoredSummaries = Object.values(summary).filter(s => s.avgScore >= 0);
    const overallScore = scoredSummaries.length > 0
      ? scoredSummaries.reduce((a, b) => a + b.avgScore, 0) / scoredSummaries.length
      : -1;
    mdLines.push(`| **OVERALL** | **${formatDuration(overallLat)}** | **${overallScore >= 0 ? overallScore.toFixed(1) : 'N/A'}** | **${allValid.reduce((a, b) => a + b.success, 0)}/${allValid.reduce((a, b) => a + b.total, 0)}** |`);
  }

  mdLines.push('');
  const mdPath = resolve(RESULTS_DIR, 'parity_personal_ai.md');
  writeFileSync(mdPath, mdLines.join('\n'));

  console.log('\n════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('════════════════════════════════════════════════════');
  for (const arch of archetypes) {
    const s = summary[arch];
    if (!s) continue;
    const lat = s.avgLatency >= 0 ? formatDuration(s.avgLatency) : 'ERR';
    const qual = s.avgScore >= 0 ? `${s.avgScore.toFixed(1)}/10` : 'no-judge';
    console.log(`  ${arch.padEnd(20)} ${lat.padEnd(10)} ${qual.padEnd(10)} ${s.success}/${s.total}`);
  }
  console.log(`\n  Results: ${jsonPath}`);
  console.log(`  Report:  ${mdPath}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
