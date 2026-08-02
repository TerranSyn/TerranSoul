#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME JD-DEMO — MAX level ("highest thinking"): AGENTIC WIDE
// RETRIEVAL + VERIFY-FROM-TEXT, 2026-07-05.
//
// The MAX level trades retrieval TIME for 100% accuracy. Instead of one
// blended query it reasons about the JD and drives an iterative retrieval
// loop, then earns precision by re-deriving the gold predicate from each
// candidate's OWN stored text (never from meta.jsonl / gold.json):
//
//   (a) RECALL — agentic wide retrieval (fair; only jd.queryText + the JD's
//       own required-skill surface forms reach the store, never gold):
//       Round 1  one rrf retrieval PER PAIR of required-skill surface forms.
//                Each pair's strict-AND ladder captures the full co-occurrence
//                set under the store's 1000-candidate pool, and the Latin
//                skills line every résumé carries makes this cross-lingual by
//                construction (ja/vi/zh gold surfaced by Latin skill tokens).
//       Round 2+ COVERAGE-DRIVEN widening: discover the tech tokens that
//                co-occur most with the required skills IN THE RETRIEVED TEXT
//                (generic frequency, no hardcoded vocabulary), then issue
//                required×discovered pair retrievals. This cracks the common-
//                skill pools (e.g. Python/SQL) whose blended AND-set overflows
//                the 1000 cap. Optional dense round (LONGMEM_EMBED=1) folds in
//                the cross-lingual embedding channel.
//       The loop stops on a FAIR saturation signal (marginal new candidates
//       per round < epsilon) — gold is never consulted to steer retrieval.
//   (b) VERIFY — precision earned from text (generic, AGI-pure):
//       deterministic slice (>=2 required surface forms present AND parsed
//       years >= JD minimum; see lib/jd-verify.mjs), then a generic LLM
//       DOMAIN judge (gemma4:12b-it-qat reads JD + résumé, "same role/domain?"
//       yes/no — no area names, no role→area map) removes wrong-area résumés
//       that merely share a couple of tools (e.g. a Backend résumé listing
//       Python+SQL for the Data-Engineering JD). Survivors rank first.
//
// FAIRNESS: only jd.queryText + résumé TEXT reach retrieval/verify. gold.json
// and matchesJd are consulted ONLY in scoring, AFTER ranking.
// LOCAL-ONLY per rules/ci-vs-local-testing.md (cargo shim + local Ollama);
// self-guards to a clean SKIP when the store dir or Ollama is absent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JD_QUERIES } from './jd-queries.mjs';
import { SKILL_SURFACES } from './jd-corpus.mjs';
import { recallAtK, precisionAtK, ndcgAtK } from './lib/jd-metrics.mjs';
import { JsonlClient } from './lib/jd-ipc.mjs';
import {
  stripStoreEnvelope,
  deterministicVerify,
  buildDomainJudgePrompt,
  parseDomainVerdicts,
  rankVerified,
} from './lib/jd-verify.mjs';
import { runBenchPreflight } from './lib/bench-preflight.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_TARGET_DIR = resolve(REPO_ROOT, 'target-copilot-bench');
const DEFAULT_CORPUS_DIR = resolve(DEFAULT_TARGET_DIR, 'jdbench');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'benchmark', 'results', 'jd-million');
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

function option(name, def) {
  const argv = process.argv.slice(3);
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return def;
}
function numOpt(name, def) {
  const v = Number(option(name, String(def)));
  if (!Number.isFinite(v)) throw new Error(`--${name} must be numeric`);
  return v;
}
const pct = v => `${(v * 100).toFixed(1)}%`;

// ── Generic tech-token discovery (no hardcoded vocabulary) ─────────────────
// Frequency of Latin tokens + adjacent-Latin bigrams across retrieved text.
// A tiny generic English function-word / résumé-boilerplate stoplist keeps
// prose out; it names NO skill, area, or role. Multi-word skill surfaces
// (e.g. "React Native", "Next.js") survive via the bigram pass.
// `session`/`date`/`turns` are the IPC memory-wrapper header words (every
// stored résumé begins "Session: … Date: … Turns: …"), not résumé content —
// generic corpus-structure noise, safe to stop. No skill/area/role is named.
const TOKEN_STOP = new Set((
  'session date turns and the with for using of to in on at by a an is are was were be been we you '
  + 'your our i my years year experience experienced professional hands results driven passionate '
  + 'track record engineer developer designer manager skills skill team teams systems system '
  + 'production product products building build built work worked working delivered led leading '
  + 'maintained maintaining designed design optimised optimized improving improved cutting owning '
  + 'across modern practice practices services core migration mentored best reliable end whole '
  + 'speed better use'
).split(/\s+/));

// Discover candidate tech tokens by frequency of length>=3 Latin tokens and
// adjacent-Latin bigrams. min-len 3 drops the 2-char fragments the tokenizer
// carves out of accented/CJK words ("ng", "de", "nh"); the surviving high-
// frequency entries are real skill surface forms and role phrases (ETL,
// Snowflake, "Data Engineer") — derived from retrieved text, never seeded.
function discoverTokens(text, freq) {
  const toks = text.match(/[A-Za-z][A-Za-z0-9.+#-]{2,}/g) || [];
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    const tStop = TOKEN_STOP.has(t.toLowerCase());
    if (!tStop) freq.set(t, (freq.get(t) ?? 0) + 1);
    if (i + 1 < toks.length) {
      const next = toks[i + 1];
      // Keep a bigram only when at least one half is a content token — drops
      // wrapper-word bigrams like "Date Turns".
      if (!(tStop && TOKEN_STOP.has(next.toLowerCase()))) {
        const b = `${t} ${next}`;
        freq.set(b, (freq.get(b) ?? 0) + 1);
      }
    }
  }
}

/** Count deterministic-verify passers currently in the pool (fair — text only). */
function countPassers(pool, surfaces, minYears) {
  let n = 0;
  for (const c of pool.values()) if (deterministicVerify(c.text, surfaces, minYears).pass) n += 1;
  return n;
}

function pairsOf(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 1) for (let j = i + 1; j < arr.length; j += 1) out.push([arr[i], arr[j]]);
  return out;
}

async function ollamaUp() {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

/**
 * One retrieval; records content + best (lowest) retrieval rank per id.
 * Returns the count of NEWLY added ids (for the saturation signal).
 */
async function retrieve(client, { query, mode, limit }, pool) {
  const res = await client.send({ op: 'search', query, mode, limit, include_content: true });
  const hits = res.results ?? [];
  let added = 0;
  hits.forEach((h, rank) => {
    if (!h.session_id) return;
    const text = stripStoreEnvelope(h.content ?? '');
    const prev = pool.get(h.session_id);
    if (!prev) {
      pool.set(h.session_id, { id: h.session_id, text, rank });
      added += 1;
    } else {
      if (rank < prev.rank) prev.rank = rank;
      if (!prev.text && text) prev.text = text;
    }
  });
  return added;
}

async function domainJudge(model, jdText, candidates, { batch, numCtx, numPredict }, acc) {
  const keep = new Set();
  for (let i = 0; i < candidates.length; i += batch) {
    const group = candidates.slice(i, i + batch);
    const prompt = buildDomainJudgePrompt(jdText, group);
    const t0 = performance.now();
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0, num_ctx: numCtx, num_predict: numPredict },
        keep_alive: '2h',
      }),
    });
    if (!res.ok) throw new Error(`domain judge /api/chat -> ${res.status}`);
    const body = await res.json();
    acc.ms += performance.now() - t0;
    acc.calls += 1;
    acc.promptTokens += body.prompt_eval_count ?? 0;
    acc.evalTokens += body.eval_count ?? 0;
    const reply = body.message?.content || body.message?.thinking || '';
    const verdicts = parseDomainVerdicts(reply, new Set(group.map(c => c.id)));
    for (const c of group) if (verdicts.get(c.id) === true) keep.add(c.id);
  }
  return keep;
}

function metricsFor(ranked, goldSet) {
  const r10 = recallAtK(ranked, goldSet, 10);
  return {
    recall_at_10: { capped: r10.capped, raw: r10.raw, hits: r10.hits },
    precision_at_10: precisionAtK(ranked, goldSet, 10),
    ndcg_at_10: ndcgAtK(ranked, goldSet, 10),
  };
}

async function run() {
  const mode = option('mode', 'million');
  const corpusDir = resolve(REPO_ROOT, option('corpus-dir', DEFAULT_CORPUS_DIR));
  const rrfMode = option('rrf-mode', 'rrf'); // 'rrf' (lexical+dense) — 'rrf_kg' if edges present
  // `product` (default) = the real ChatMode::Max pipeline via op:search mode=max.
  // `legacy`  = the JavaScript reimplementation retained for A/B only. Its output
  // is NOT a Max number (see the block in the JD loop and docs/agent-parity-2026.md).
  const engine = option('engine', 'product');
  const productTopK = numOpt('product-top-k', 20);
  const perQ = numOpt('per-q', 1000);
  const discoverN = numOpt('discover', 14);
  const maxRounds = numOpt('max-rounds', 2);
  const epsilon = numOpt('epsilon', 0.004); // saturation: stop when marginal new < 0.4% of pool
  const denseQuery = !process.argv.includes('--no-dense') && process.env.LONGMEM_EMBED === '1';
  const judgeModel = option('judge-model', 'gemma4:12b-it-qat');
  const judgeHead = numOpt('judge-head', 150);
  const judgeBatch = numOpt('judge-batch', 10);
  const judgeCtx = numOpt('judge-ctx', 8192);
  const judgePredict = numOpt('judge-predict', 400);
  const noJudge = process.argv.includes('--no-judge'); // diagnostics: deterministic only
  const jdFilter = option('jd', null);
  const outDir = resolve(REPO_ROOT, option('out-dir', DEFAULT_OUT_DIR));
  const label = option('label', 'max');
  const expected = numOpt('expected-count', 1000000);

  // ── Self-guard: SKIP cleanly if prerequisites are absent ─────────────────
  const storeDir = process.env.LONGMEM_DATA_DIR;
  if (mode === 'million' && (!storeDir || !existsSync(resolve(storeDir, 'memory.db')))) {
    console.log(`[jd-max] SKIP: LONGMEM_DATA_DIR / memory.db not found (${storeDir ?? 'unset'}). Local-only bench.`);
    return;
  }
  if (!existsSync(resolve(corpusDir, 'gold.json'))) {
    console.log(`[jd-max] SKIP: gold.json not found under ${corpusDir}. Local-only bench.`);
    return;
  }
  if (!(await ollamaUp())) {
    console.log('[jd-max] SKIP: Ollama not reachable — MAX needs the domain judge. Local-only bench.');
    return;
  }
  const goldDoc = JSON.parse(readFileSync(resolve(corpusDir, 'gold.json'), 'utf8'));

  const client = new JsonlClient({ repoRoot: REPO_ROOT, targetDir: DEFAULT_TARGET_DIR });
  process.on('SIGINT', () => { client.close().finally(() => process.exit(130)); });

  let report;
  const tWall = performance.now();
  try {
    const data = await client.send({ op: 'count' });
    // The shim writes ONE `system:default-system-setting` row per entry in
    // LONGMEM_SET_FLAGS, and on a persistent store (LONGMEM_DATA_DIR) those
    // rows land in the same `memories` table the corpus lives in. They are
    // config, not corpus — but `op:count` counts rows, so this guard has to
    // account for them or it mis-reports a healthy store as the wrong
    // directory (observed 2026-07-25: "store holds 1000002 rows, expected
    // 1000000"). The shim purges stale override rows first, so at most one
    // row per currently-set flag is present.
    const flagRows = (process.env.LONGMEM_SET_FLAGS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.includes(':') && s.includes('=')).length;
    const tolerated = expected + flagRows;
    if (Number(data.count) !== tolerated) {
      throw new Error(
        `store holds ${data.count} rows, expected ${expected}` +
          (flagRows ? ` (+${flagRows} LONGMEM_SET_FLAGS override rows = ${tolerated})` : '') +
          ' — wrong LONGMEM_DATA_DIR?',
      );
    }
    console.log(
      `[jd-max] store verified at ${data.count} rows` +
        (flagRows ? ` (${expected} corpus + ${flagRows} flag override)` : '') +
        ` (mode=${rrfMode}, dense=${denseQuery})`,
    );

    const results = [];
    for (const jd of JD_QUERIES) {
      if (jdFilter && jd.id !== jdFilter) continue;
      const surfaces = jd.requiredSkills.map(s => SKILL_SURFACES[s]);
      const goldSet = new Set(goldDoc.gold[jd.id] ?? []);

      // ── ENGINE: product ──────────────────────────────────────────────────
      // Owner directive 2026-07-25: "All bench must use our same workflow of
      // Desktop chat, cli and mcp." One `op:'search'` with `mode:'max'` routes
      // through the SAME Rust pipeline the product uses —
      // `thinking_mode_search` -> deep_research (decomposition + coverage
      // rounds) -> agentic_verify_rank (deterministic_verify + rankVerified +
      // domain judge + windowed reorder).
      //
      // The legacy engine below is a JAVASCRIPT REIMPLEMENTATION of that same
      // pipeline (`discoverTokens` = decomposition, the round loop = coverage
      // widening, `domainJudge` = the judge). It never calls ChatMode::Max, so
      // its numbers — including the published "Max 100%" in
      // benchmark/JD-DEMO-COMPARISON.md — describe the harness, not the
      // product. Kept only for A/B against the product path; never publish it
      // as a Max number.
      if (engine === 'product') {
        const tAll = performance.now();
        const res = await client.send({
          op: 'search',
          query: jd.queryText,
          mode: 'max',
          limit: productTopK,
          include_content: false,
        });
        const rankedIds = [];
        const seen = new Set();
        for (const h of res.results ?? []) {
          if (!h.session_id || seen.has(h.session_id)) continue;
          seen.add(h.session_id);
          rankedIds.push(h.session_id);
        }
        const totalMs = performance.now() - tAll;
        const m = metricsFor(rankedIds, goldSet);
        const goldInRanked = rankedIds.filter(id => goldSet.has(id));
        results.push({
          jd_id: jd.id,
          jd_lang: jd.lang,
          gold_size: goldSet.size,
          engine: 'product',
          retrieval: {
            mode: 'max',
            note: 'single op:search mode=max — the product path (thinking_mode_search)',
            returned: rankedIds.length,
            gold_in_returned: goldInRanked.length,
            latency_ms: Number(totalMs.toFixed(0)),
          },
          accuracy: { ...m, top_10: rankedIds.slice(0, 10), top_3: rankedIds.slice(0, 3) },
          total_ms: totalMs,
        });
        console.log(
          `[jd-max] ${jd.id} (${jd.lang}) engine=product mode=max ` +
            `p@10=${m.precision_at_10.toFixed(3)} ndcg@10=${m.ndcg_at_10.toFixed(3)} ` +
            `returned=${rankedIds.length} ${Math.round(totalMs)}ms`,
        );
        continue;
      }

      // ── (a) Agentic wide retrieval ───────────────────────────────────────
      const pool = new Map();
      const freq = new Map();
      const rounds = [];
      let retrievalMs = 0;
      let queryCount = 0;

      // Round 1: required-skill pair retrievals.
      let roundAdded = 0;
      for (const [a, b] of pairsOf(surfaces)) {
        const t0 = performance.now();
        roundAdded += await retrieve(client, { query: `${a} ${b}`, mode: rrfMode, limit: perQ }, pool);
        retrievalMs += performance.now() - t0;
        queryCount += 1;
      }
      for (const c of pool.values()) if (c.text) discoverTokens(c.text, freq);
      rounds.push({ round: 1, kind: 'required-pairs', queries: pairsOf(surfaces).length, added: roundAdded, pool: pool.size });

      // Optional dense/semantic round (cross-lingual embedding channel).
      if (denseQuery) {
        const t0 = performance.now();
        let a2 = await retrieve(client, { query: jd.queryText, mode: rrfMode, limit: perQ }, pool);
        a2 += await retrieve(client, { query: surfaces.join(' '), mode: rrfMode, limit: perQ }, pool);
        retrievalMs += performance.now() - t0;
        queryCount += 2;
        for (const c of pool.values()) if (c.text) discoverTokens(c.text, freq);
        rounds.push({ round: rounds.length + 1, kind: 'dense-semantic', queries: 2, added: a2, pool: pool.size });
      }

      // Rounds 2+: coverage-driven discovered-skill expansion until the pool
      // of plausible candidates SATURATES. The stop signal is the marginal
      // gain in deterministic-verify PASSERS (a fair, text-only proxy for "did
      // widening surface new plausible matches") — NOT gold. This lets JDs
      // whose required skills are area-exclusive (en/ja) stop after round 1,
      // while common-skill JDs (vi: Python/SQL) keep widening.
      const reqLower = new Set(surfaces.map(s => s.toLowerCase()));
      const used = new Set();
      let round = rounds.length + 1;
      let prevPassers = countPassers(pool, surfaces, jd.minYears);
      while (round <= maxRounds + 1) {
        const discovered = [...freq.entries()]
          .filter(([t]) => !reqLower.has(t.toLowerCase()) && !used.has(t.toLowerCase()))
          .sort((x, y) => y[1] - x[1])
          .slice(0, discoverN)
          .map(([t]) => t);
        if (discovered.length === 0) break;
        for (const d of discovered) used.add(d.toLowerCase());
        let added = 0;
        for (const req of surfaces) {
          for (const d of discovered) {
            const t0 = performance.now();
            added += await retrieve(client, { query: `${req} ${d}`, mode: rrfMode, limit: perQ }, pool);
            retrievalMs += performance.now() - t0;
            queryCount += 1;
          }
        }
        for (const c of pool.values()) if (c.text) discoverTokens(c.text, freq);
        const passersNow = countPassers(pool, surfaces, jd.minYears);
        const newPassers = passersNow - prevPassers;
        rounds.push({ round, kind: 'discovered-pairs', discovered, queries: surfaces.length * discovered.length, added, pool: pool.size, passers: passersNow, new_passers: newPassers });
        round += 1;
        const saturated = newPassers / Math.max(prevPassers, 1) < epsilon;
        prevPassers = passersNow;
        if (saturated) break; // fair saturation stop
      }

      // ── (b) Verify — deterministic slice, then generic LLM domain gate ────
      const tVerify = performance.now();
      const passers = [];
      for (const c of pool.values()) {
        const v = deterministicVerify(c.text, surfaces, jd.minYears);
        if (v.pass) passers.push({ id: c.id, text: c.text, retrievalRank: c.rank, skillsPresent: v.skillsPresent, years: v.years });
      }
      const rankedPassers = rankVerified(passers);
      const verifyMs = performance.now() - tVerify;

      const judgeAcc = { ms: 0, calls: 0, promptTokens: 0, evalTokens: 0 };
      const head = rankedPassers.slice(0, judgeHead);
      const tail = rankedPassers.slice(judgeHead);
      let kept;
      if (noJudge) {
        kept = rankedPassers; // diagnostics path
      } else {
        const keepSet = await domainJudge(judgeModel, jd.queryText, head, { batch: judgeBatch, numCtx: judgeCtx, numPredict: judgePredict }, judgeAcc);
        const keptHead = head.filter(c => keepSet.has(c.id));
        // Final ranking: domain-confirmed head first (guarantees a clean @10),
        // then the un-judged passer tail, then the non-passer retrieval tail.
        const nonPassers = [...pool.values()]
          .filter(c => !passers.some(p => p.id === c.id))
          .sort((x, y) => x.rank - y.rank)
          .map(c => c.id);
        kept = [...keptHead, ...tail, ...nonPassers.map(id => ({ id }))];
      }
      const rankedIds = [];
      const seen = new Set();
      for (const c of kept) if (!seen.has(c.id)) { seen.add(c.id); rankedIds.push(c.id); }

      // ── Scoring (gold consulted here ONLY, after ranking) ────────────────
      const goldInPool = [...pool.keys()].filter(id => goldSet.has(id));
      const byLangPool = {};
      for (const id of goldInPool) { const l = goldDoc.langOf[id] ?? '?'; byLangPool[l] = (byLangPool[l] ?? 0) + 1; }
      const m = metricsFor(rankedIds, goldSet);

      results.push({
        jd_id: jd.id,
        jd_lang: jd.lang,
        gold_size: goldSet.size,
        retrieval: {
          rrf_mode: rrfMode,
          dense: denseQuery,
          query_count: queryCount,
          pool_size: pool.size,
          rounds,
          gold_in_pool: goldInPool.length,
          gold_in_pool_pct: Number((100 * goldInPool.length / goldSet.size).toFixed(2)),
          gold_in_pool_by_lang: byLangPool,
          gold_total_by_lang: goldDoc.jds.find(j => j.id === jd.id)?.byLang ?? {},
          latency_ms: Number(retrievalMs.toFixed(0)),
        },
        verify: {
          passers: passers.length,
          judged: noJudge ? 0 : head.length,
          domain_kept: noJudge ? passers.length : kept.filter(c => c.skillsPresent != null).length,
          judge_calls: judgeAcc.calls,
          judge_ms: Number(judgeAcc.ms.toFixed(0)),
          judge_tokens: { prompt: judgeAcc.promptTokens, eval: judgeAcc.evalTokens },
          verify_ms: Number(verifyMs.toFixed(0)),
          no_judge: noJudge,
        },
        accuracy: {
          ...m,
          top_10: rankedIds.slice(0, 10),
        },
        total_ms: Number((retrievalMs + verifyMs + judgeAcc.ms).toFixed(0)),
      });
      const r = results.at(-1);
      console.log(`[jd-max] ${jd.id}: recall(gold_in_pool)=${r.retrieval.gold_in_pool}/${r.gold_size} (${r.retrieval.gold_in_pool_pct}%) `
        + `-> verify passers=${r.verify.passers} judged=${r.verify.judged} `
        + `-> NDCG@10=${pct(r.accuracy.ndcg_at_10)} P@10=${pct(r.accuracy.precision_at_10)} `
        + `[retrieve ${(r.retrieval.latency_ms / 1000).toFixed(1)}s, judge ${(r.verify.judge_ms / 1000).toFixed(1)}s]`);
    }

    const longmemVars = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('LONGMEM_') || k === 'LCM_CONV_AWARE') longmemVars[k] = v;
    }
    report = {
      benchmark: 'MILLION-RESUME JD-DEMO — MAX (agentic wide retrieve + verify-from-text)',
      generated_at: new Date().toISOString(),
      mode,
      config: {
        // `engine` is load-bearing for artifact honesty: only engine=product
        // measures ChatMode::Max. engine=legacy measures a JS reimplementation
        // and must never be published as a Max number.
        engine,
        rrf_mode: rrfMode, dense: denseQuery, per_q: perQ, discover_n: discoverN,
        max_rounds: maxRounds, epsilon, judge_model: judgeModel, judge_head: judgeHead,
        judge_batch: judgeBatch, judge_ctx: judgeCtx, no_judge: noJudge,
      },
      env: { longmem_vars: longmemVars, ollama_host: OLLAMA_HOST, node: process.version, platform: `${process.platform} ${process.arch}` },
      results,
    };
  } finally {
    await client.close();
  }
  report.wall_seconds_total = Number(((performance.now() - tWall) / 1000).toFixed(3));

  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `jd-max-${label}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[jd-max] wrote ${outPath} (wall ${report.wall_seconds_total}s)`);
}

async function main() {
  // BENCH-GUARD-SWEEP-1: this harness gates its dense channel on
  // LONGMEM_EMBED, so a CPU-pinned embedder silently costs it hours.
  // The guard is shared, not copied -- see lib/bench-preflight.mjs.
  runBenchPreflight({
    repoRoot: REPO_ROOT,
    outDir: process.cwd(),
    label: 'jd-max',
    skip: process.argv.includes('--skip-preflight'),
    allowCpuEmbedder: process.argv.includes('--allow-cpu-embedder'),
  });
  const cmd = process.argv[2];
  if (cmd === 'run') return run();
  console.log('Usage: node benchmark/scripts/jd-max-bench.mjs run [--mode million]');
  console.log('  [--rrf-mode rrf] [--per-q 1000] [--discover 14] [--max-rounds 4] [--epsilon 0.004]');
  console.log('  [--judge-model gemma4:12b-it-qat] [--judge-head 150] [--judge-batch 10] [--judge-ctx 8192]');
  console.log('  [--no-dense] [--no-judge] [--jd <id>] [--label max] [--out-dir <dir>]');
  if (cmd) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[jd-max] failed: ${err.message}`);
  process.exit(1);
});
