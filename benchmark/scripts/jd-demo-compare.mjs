#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME JD-DEMO — consolidate the three thinking levels into one
// machine-readable comparison (2026-07-05). Reads the per-level result JSONs
// already written under benchmark/results/jd-million/ and emits
// jd-demo-comparison.json with a per-JD, per-level NDCG@10 / P@10 / latency
// table plus the shared one-time learn-1M cost and the honest recall diagnostic.
//
//   CHAT  = chat-pipeline `retrieval` block  (raw single-query rrf top-k order)
//   THINK = chat-pipeline `chat_pipeline`    (reader tournament rerank)
//   MAX   = jd-max `accuracy` + `retrieval`  (agentic wide-retrieve + verify)
//
// LOCAL-ONLY. Pure file merge — no store/Ollama needed. SKIPs missing inputs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results', 'jd-million');

function opt(name, def) {
  const argv = process.argv.slice(2);
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return def;
}
const readJson = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const r1 = v => (v == null ? null : Number((v * 100).toFixed(1)));

const chatPath = resolve(OUT_DIR, opt('chat', 'chat-pipeline-levels-million.json'));
const maxPath = resolve(OUT_DIR, opt('max', 'jd-max-max-round1.json'));
const viExpandPath = resolve(OUT_DIR, opt('vi-expand', 'jd-max-max-vi-agentic.json'));

const chat = readJson(chatPath);
const max = readJson(maxPath);
const viExpand = readJson(viExpandPath);
if (!chat || !max) {
  console.log(`[jd-compare] SKIP: need both ${chatPath} and ${maxPath}. Run bench:jd:chat and bench:jd:max first.`);
  process.exit(0);
}

const maxById = new Map(max.results.map(r => [r.jd_id, r]));
const viExpandById = new Map((viExpand?.results ?? []).map(r => [r.jd_id, r]));

const levels = chat.results.map(c => {
  const m = maxById.get(c.jd_id);
  const vx = viExpandById.get(c.jd_id);
  const recall = m
    ? { round1_pct: m.retrieval.gold_in_pool_pct, agentic_pct: vx ? vx.retrieval.gold_in_pool_pct : null,
        gold_in_pool: m.retrieval.gold_in_pool, gold_size: m.gold_size }
    : null;
  return {
    jd_id: c.jd_id,
    lang: c.jd_lang,
    chat: {
      ndcg_at_10: r1(c.retrieval.ndcg_at_10),
      precision_at_10: r1(c.retrieval.precision_at_10),
      latency_ms: c.retrieval.latency_ms, // { cold, warm }
    },
    think: {
      ndcg_at_10: r1(c.chat_pipeline.ndcg_at_10),
      precision_at_10: r1(c.chat_pipeline.precision_at_10),
      retrieval_ms: c.retrieval.latency_ms.cold,
      reader_ms: c.chat_pipeline.reader_ms,
      reader_calls: c.chat_pipeline.reader_calls,
    },
    max: m
      ? {
        ndcg_at_10: r1(m.accuracy.ndcg_at_10),
        precision_at_10: r1(m.accuracy.precision_at_10),
        retrieval_ms: m.retrieval.latency_ms,
        verify_ms: m.verify.verify_ms,
        judge_ms: m.verify.judge_ms,
        total_ms: m.total_ms,
        passers: m.verify.passers,
        judged: m.verify.judged,
        recall: recall,
      }
      : null,
  };
});

const report = {
  benchmark: 'MILLION-RESUME JD-DEMO — three thinking levels (Chat / Think / Max)',
  generated_at: new Date().toISOString(),
  scale: { resumes: 1000000, jds: 3, langs_in_corpus: 7 },
  // One-time "learn the 1M corpus" cost is the FTS5 index build at ingest —
  // paid once, then every query is milliseconds warm. Reused the existing
  // store (not re-ingested this session); throughput from the documented 1M
  // ingest (benchmark/results/jd-million/report.md).
  learn_1m: { rows: 1000000, seconds: 1493.8, rows_per_sec: 669, note: 'one-time FTS5 index build; store reused, not re-ingested this session' },
  retrieval_substrate: {
    system: 'rrf (FTS5 lexical + freshness fusion)',
    dense_channel: (max.env.longmem_vars.LONGMEM_EMBED === '1'),
    kg_edges: (max.env.longmem_vars.LONGMEM_KG_EDGES === '1'),
    note: 'All three levels run on PURELY LEXICAL retrieval (no embeddings, no KG edges). Cross-lingual recall is achieved via the universal Latin skills line every résumé carries.',
  },
  env: { chat: chat.env, max: max.env },
  levels_meaning: {
    chat: 'no thinking — raw single-query rrf top-k order',
    think: 'with thinking — reader tournament reranks the single-retrieval pool (no agentic widen, no verify)',
    max: 'highest thinking — agentic wide retrieve (per-skill-pair + coverage re-query) + verify-from-text (deterministic + generic LLM domain gate)',
  },
  levels,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, 'jd-demo-comparison.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

// Human-readable console table.
const p = (n) => (n == null ? '  -  ' : `${n.toFixed(1)}%`.padStart(6));
console.log('\nJD-DEMO 3-level NDCG@10 (1,000,000 résumés, lexical FTS5, dense/KG OFF)\n');
console.log('JD                         lang   CHAT    THINK    MAX     MAX-recall');
for (const l of levels) {
  const rec = l.max?.recall;
  const recStr = rec ? `${rec.round1_pct}%${rec.agentic_pct != null ? `→${rec.agentic_pct}%` : ''} (${rec.gold_in_pool}/${rec.gold_size})` : '-';
  console.log(`${l.jd_id.padEnd(26)} ${l.lang.padEnd(4)} ${p(l.chat.ndcg_at_10)} ${p(l.think.ndcg_at_10)} ${p(l.max?.ndcg_at_10)}   ${recStr}`);
}
console.log(`\n[jd-compare] wrote ${outPath}`);
