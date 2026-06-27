#!/usr/bin/env node
/**
 * docs/leaderboard/build.mjs
 *
 * Reads bench-results JSON files from benchmark/results/
 * and produces docs/leaderboard/data.json for the static leaderboard page.
 *
 * Usage: node docs/leaderboard/build.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const RESULTS_DIR = resolve(ROOT, 'benchmark/results');

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Genericize internal code identifiers so the public leaderboard shows
// human-readable approach names, not raw struct/method symbols.
function cleanLabel(s) {
  if (!s) return s;
  return s.replace(/AppStateGateway::search/g, 'gateway search');
}

function buildLeaderboard() {
  const rows = [];

  // 1. agentmemory-quality (memory_quality.json)
  const mq = readJson(resolve(RESULTS_DIR, 'memory_quality.json'));
  if (mq) {
    // Find the best system (highest R@10)
    const systems = mq.systems || [];
    for (const sys of systems) {
      rows.push({
        bench: 'agentmemory-quality',
        system: cleanLabel(sys.system),
        metrics: {
          'R@5': fmt(sys.avg_recall_at_5),
          'R@10': fmt(sys.avg_recall_at_10),
          'R@20': fmt(sys.avg_recall_at_20),
          'NDCG@10': fmt(sys.avg_ndcg_at_10),
          'MRR': fmt(sys.avg_mrr),
          'Latency p50 (ms)': sys.avg_latency_ms?.toFixed(2) ?? '-',
        },
        observations: mq.observations,
        queries: mq.queries,
        date: mq.generated_at || null,
      });
    }
  }

  // 2. LongMemEval-S (longmemeval_s_terransoul.json)
  const lme = readJson(resolve(RESULTS_DIR, 'longmemeval_s_terransoul.json'));
  if (lme) {
    const systems = lme.systems || [];
    for (const sys of systems) {
      rows.push({
        bench: 'LongMemEval-S',
        system: cleanLabel(sys.system),
        metrics: {
          'R@5': fmt(sys.recall_any_at_5),
          'R@10': fmt(sys.recall_any_at_10),
          'R@20': fmt(sys.recall_any_at_20),
          'NDCG@10': fmt(sys.ndcg_at_10),
          'MRR': fmt(sys.mrr),
          'Latency p50 (ms)': sys.avg_latency_ms?.toFixed(1) ?? '-',
        },
        observations: lme.questions,
        queries: lme.questions,
        date: lme.generated_at || null,
      });
    }
  }

  // 3. LoCoMo MTEB — look for locomo_mteb_terransoul*.json. The current adapter
  //    writes per-system aggregates under `overall` (array); older runs used
  //    `systems_results`. Accept either so the real recall is surfaced.
  const locomoMtebFiles = [
    'locomo_mteb_terransoul.json',
    'locomo_mteb_terransoul_1976q.json',
    'locomo_mteb_terransoul_489q.json',
  ];
  for (const fname of locomoMtebFiles) {
    const lcm = readJson(resolve(RESULTS_DIR, fname));
    const systems = lcm && (lcm.systems_results || lcm.overall);
    if (lcm && Array.isArray(systems) && systems.length) {
      for (const sys of systems) {
        rows.push({
          bench: 'LoCoMo-MTEB',
          system: cleanLabel(sys.system),
          metrics: {
            'R@5': fmt(sys.recall_at_5),
            'R@10': fmt(sys.recall_at_10),
            'NDCG@10': fmt(sys.ndcg_at_10),
            'MRR': sys.mrr_at_100 != null ? fmt(sys.mrr_at_100) : fmt(sys.mrr),
            'Latency (ms)': (sys.latency_ms ?? sys.p50_latency_ms)?.toFixed(1) ?? '-',
          },
          observations: lcm.total_queries || lcm.scale || lcm.corpus_size || null,
          queries: sys.queries || lcm.total_queries || lcm.queries || null,
          date: lcm.generated_at || null,
        });
      }
      break; // use first found
    }
  }

  // 4. LoCoMo-at-scale — surface the working routed RRF runs (the production
  //    retrieval path). The experimental IVF-PQ compression arm is skipped while
  //    its index build is under repair: it currently retrieves nothing, and an
  //    all-zero recall row is not a measurement — publishing it misrepresented
  //    retrieval quality on the public leaderboard (the 0.0% bug).
  const scaleFiles = [
    'locomo_scale_100000_adversarial_100q_routed_directstore.json',
    // IVF-PQ at 100k — recall restored 2026-06-07 after the shard-probe fix
    // (was 0.0% because the router routed queries off the index-bearing shard).
    'locomo_scale_100000_adversarial_100q_routed_ivfpq.json',
    'locomo_ivfpq_10000000_adversarial_100q_pqm128_nlist4096_nprobe32.json',
  ];
  const seenScale = new Set();
  for (const fname of scaleFiles) {
    const scale = readJson(resolve(RESULTS_DIR, fname));
    if (!scale || !scale.systems_results) continue;
    for (const sys of scale.systems_results) {
      // Drop arms that returned no results at all (index build broken / under
      // repair). An all-zero row is not a measurement.
      const retrievedSomething = (sys.per_query || []).some(p => (p.retrieved_count ?? 0) > 0);
      if (!retrievedSomething) continue;
      const key = `${sys.system}@${scale.scale}`;
      if (seenScale.has(key)) continue;
      seenScale.add(key);
      rows.push({
        bench: 'LoCoMo-at-scale',
        system: `${sys.system} (${fmtScale(scale.scale)})`,
        metrics: {
          'R@5': fmt(sys.recall_at_5),
          'R@10': fmt(sys.recall_at_10),
          'R@20': fmt(sys.recall_at_20),
          'NDCG@10': fmt(sys.ndcg_at_10),
          'MRR': sys.mrr_at_100 != null ? fmt(sys.mrr_at_100) : fmt(sys.mrr),
          'Latency p50 (ms)': (sys.latency_p50_ms ?? sys.p50_latency_ms)?.toFixed(1) ?? '-',
          'Latency p95 (ms)': (sys.latency_p95_ms ?? sys.p95_latency_ms)?.toFixed(1) ?? '-',
        },
        observations: scale.scale,
        queries: sys.queries || scale.query_count || null,
        date: scale.generated_at || null,
      });
    }
  }

  // 5. Zork bench — intentionally NOT a leaderboard table row. The ZorkGPT
  //    bench is recorded in its own dedicated Pages hub (`docs/zorkgpt/`, linked
  //    from this page's footer) with the full per-agent scoreboard (Opus 4.8
  //    350/50, TerranSoul brain e4b 10–20 + 12B, ZorkGPT ep120 115, baselines 0)
  //    and per-turn detail pages. A table row here would duplicate that record,
  //    so the leaderboard links to the hub instead of re-listing the scores.

  // 6. OpenJarvis-Parity — real head-to-head (parity_headtohead.json).
  //    Both local stacks answer the same 22 prompts with the same model
  //    (gemma4:12b-it-qat) + same injected context_seed, judged 0–10 by the
  //    same model. Energy is n/a: this GPU (RTX 3080 Ti) does not expose
  //    power.draw via NVML/nvidia-smi, so it is NOT fabricated. USD is $0
  //    (both fully local). Until the bench has run, fall back to placeholders.
  const parity = readJson(resolve(RESULTS_DIR, 'parity_headtohead.json'));
  const PARITY_LABELS = {
    terransoul: 'TerranSoul (brain → gemma4:12b-it-qat)',
    openjarvis: 'OpenJarvis (gemma4:12b-it-qat)',
  };
  if (parity && Array.isArray(parity.systems) && parity.systems.length) {
    for (const sys of parity.systems) {
      rows.push({
        bench: 'OpenJarvis-Parity',
        system: PARITY_LABELS[sys.system] || sys.system,
        metrics: {
          'Energy (Wh)': 'n/a*',
          'Latency p50 (s)': sys.latency_p50_s != null ? sys.latency_p50_s.toFixed(2) : '-',
          'Quality (LLM-judge 0-10)': sys.quality_mean != null ? sys.quality_mean.toFixed(1) : '-',
          'USD cost': '$0',
        },
        observations: sys.prompts ?? null,
        queries: sys.success != null && sys.prompts != null ? `${sys.success}/${sys.prompts}` : null,
        date: parity.generated_at || null,
      });
    }
  } else {
    for (const sysName of ['TerranSoul', 'OpenJarvis']) {
      rows.push({
        bench: 'OpenJarvis-Parity',
        system: `${sysName} (pending PARITY-OJ-14)`,
        metrics: { 'Energy (Wh)': '-', 'Latency p50 (s)': '-', 'Quality (LLM-judge 0-10)': '-', 'USD cost': '-' },
        observations: null, queries: null, date: null,
      });
    }
  }

  const notes = {};
  if (parity && Array.isArray(parity.systems) && parity.systems.length) {
    notes['OpenJarvis-Parity'] =
      'Both local stacks answer the same 22 prompts (7 archetypes) with the same model ' +
      '(gemma4:12b-it-qat) + same injected context, judged 0–10 by the same model. ' +
      'USD = $0 (fully local). Energy = n/a*: this GPU (RTX 3080 Ti) does not expose ' +
      'power.draw via NVML/nvidia-smi, so it is reported as n/a rather than fabricated. ' +
      'Latency is inference time (excludes the OpenJarvis CLI cold-start).';
  }

  return {
    generated_at: new Date().toISOString(),
    version: 1,
    notes,
    rows,
  };
}

function fmt(val) {
  if (val == null) return '-';
  return (val * 100).toFixed(1) + '%';
}

function fmtScale(n) {
  if (n == null) return '?';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M docs`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}k docs`;
  return `${n} docs`;
}

const data = buildLeaderboard();
const outPath = resolve(__dirname, 'data.json');
writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`Leaderboard data written to ${outPath} (${data.rows.length} rows)`);
