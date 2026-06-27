#!/usr/bin/env node
/**
 * Parity Personal-AI Benchmark — TerranSoul vs OpenJarvis head-to-head.
 *
 * Both local personal-AI stacks answer the SAME 22 prompts (7 archetypes)
 * with the SAME model (gemma4:12b-it-qat) on the SAME hardware, each given the
 * fixture's ground-truth context_seed. Each answer is scored 0–10 by an
 * LLM judge (gemma4:12b-it-qat, think:false). This isolates the assistant
 * pipeline + generation quality at equal context — not the model.
 *
 *  - TerranSoul: brain_search (live hybrid-RAG) + Ollama generation.
 *  - OpenJarvis: `jarvis ask` direct-to-engine, single generation pass.
 *
 * Metrics (honest, measurable on this machine):
 *  - Latency p50 (s): each system's INFERENCE latency (excludes the uv
 *    subprocess cold-start for OpenJarvis — an artifact of CLI invocation).
 *  - Quality (LLM-judge 0–10).
 *  - USD cost: $0 — both run fully locally, no API calls.
 *  - Energy (Wh): n/a — this GPU (RTX 3080 Ti) does not expose power.draw
 *    via NVML/nvidia-smi, so neither OpenJarvis' telemetry nor a direct probe
 *    can measure it. Reported as n/a rather than fabricated.
 *
 * Usage: node benchmark/parity-personal-ai/run-headtohead.mjs [--judge-model=gemma4:12b-it-qat] [--no-judge] [--system=terransoul|openjarvis]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeResponse, checkOllama } from './judge.mjs';
import * as terransoul from './runners/terransoul-gen.mjs';
import * as openjarvis from './runners/openjarvis.mjs';
import * as openclaw from './runners/openclaw.mjs';
import * as hermes from './runners/hermes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const RESULTS_DIR = resolve(__dirname, '../../target-copilot-bench/bench-results');

const ARCHETYPES = [
  'daily-digest', 'deep-research', 'code-assistant',
  'scheduled-monitor', 'chat-simple', 'voice-companion', 'vrm-overlay',
];

const SYSTEMS = { terransoul, openjarvis, openclaw, hermes };

function parseArgs() {
  const o = { judgeModel: 'gemma4:12b-it-qat', noJudge: false, only: null };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--judge-model=')) o.judgeModel = a.slice(14);
    else if (a === '--no-judge') o.noJudge = true;
    else if (a.startsWith('--system=')) o.only = a.slice(9);
  }
  return o;
}

function median(nums) {
  const v = nums.filter(n => typeof n === 'number' && n >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const mean = (nums) => {
  const v = nums.filter(n => typeof n === 'number' && n >= 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round = (n, d = 3) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

async function runSystem(name, judgeModel, judgeOn) {
  const runner = SYSTEMS[name];
  console.log(`\n╔═ ${name} ═══════════════════════════════════════`);
  console.log('  warmup (load model)...');
  try { await runner.warmup(); console.log('  ✓ warm'); } catch (e) { console.log(`  ⚠ warmup: ${e.message}`); }

  const perPrompt = [];
  for (const arch of ARCHETYPES) {
    const fp = resolve(FIXTURES_DIR, `${arch}.json`);
    const fixture = JSON.parse(readFileSync(fp, 'utf8'));
    console.log(`  ▶ ${arch} (${fixture.prompts.length})`);
    let rows;
    try { rows = await runner.runFixture(fp); }
    catch (e) { console.log(`    ✗ runner error: ${e.message}`); continue; }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let score = -1, reason = 'judge off';
      if (judgeOn && r.success) {
        const jr = await judgeResponse({
          prompt: fixture.prompts[i].input,
          response: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          rubric: fixture.scoring_rubric,
          model: judgeModel,
          context: fixture.prompts[i].context_seed,
        });
        score = jr.score; reason = jr.reason;
      }
      perPrompt.push({ ...r, score, reason });
      console.log(`    ${r.success ? '✓' : '✗'} ${r.id}: ${r.latency != null ? r.latency.toFixed(2) + 's' : 'n/a'}  ${score >= 0 ? 'q=' + score : '—'}`);
    }
  }

  const ok = perPrompt.filter(p => p.success);
  const metrics = {
    system: name,
    model: process.env.PARITY_MODEL || 'gemma4:12b-it-qat',
    prompts: perPrompt.length,
    success: ok.length,
    latency_p50_s: round(median(ok.map(p => p.latency))),
    latency_mean_s: round(mean(ok.map(p => p.latency))),
    quality_mean: round(mean(perPrompt.map(p => p.score)), 2),
    throughput_tok_s: round(mean(perPrompt.map(p => p.throughput).filter(x => x != null)), 1),
    retrieval_p50_s: round(median(perPrompt.map(p => p.retrieval_latency).filter(x => x != null))),
    energy_wh: null,            // unmeasurable on this GPU (no power.draw)
    usd_cost: 0,                // fully local
  };
  return { metrics, perPrompt };
}

async function main() {
  const opts = parseArgs();
  const judgeOn = !opts.noJudge && (await checkOllama());
  if (!opts.noJudge && !judgeOn) console.log('⚠ Ollama unreachable — running latency-only (no judge).');

  const names = opts.only ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : ['terransoul', 'openjarvis'];
  const systems = [];
  const allPrompts = [];
  for (const n of names) {
    const { metrics, perPrompt } = await runSystem(n, opts.judgeModel, judgeOn);
    systems.push(metrics);
    allPrompts.push(...perPrompt.map(p => ({ ...p, content: String(p.content).slice(0, 600) })));
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const out = {
    generated_at: new Date().toISOString(),
    bench: 'parity-personal-ai-headtohead',
    model: process.env.PARITY_MODEL || 'gemma4:12b-it-qat',
    judge_model: judgeOn ? opts.judgeModel : null,
    notes: {
      protocol: 'Both stacks answer the same 22 prompts (7 archetypes) with the same model + same injected context_seed; single generation pass; judged 0–10 by gemma4:12b-it-qat.',
      latency: 'Inference latency (excludes uv subprocess cold-start for OpenJarvis CLI invocation).',
      energy: 'n/a — RTX 3080 Ti does not expose power.draw via NVML/nvidia-smi; not fabricated.',
      usd: '$0 — both fully local.',
    },
    systems,
    prompts: allPrompts,
  };
  const jsonPath = resolve(RESULTS_DIR, 'parity_headtohead.json');
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  console.log('\n════════════════ HEAD-TO-HEAD ════════════════');
  for (const s of systems) {
    console.log(`  ${s.system.padEnd(12)} q=${s.quality_mean ?? '—'}/10  p50=${s.latency_p50_s ?? '—'}s  ok=${s.success}/${s.prompts}`);
  }
  console.log(`\n  Results: ${jsonPath}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
