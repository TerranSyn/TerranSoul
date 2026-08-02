// SPDX-License-Identifier: MIT
//
// Acceptance for the LoCoMo systems[] artifact emitter.
//
// WHAT THIS HAS TO PROVE, in the audit's own terms:
//
//   1. ROUND-TRIP. What gets written parses back identically.
//   2. RECOMPUTABILITY. Every summary metric is the mean of its own
//      per_question rows to <1e-9. The 2026-07-27 audit found ZERO
//      non-recomputable summaries across 13 committed LongMemEval artifacts;
//      LoCoMo meets the same bar or it is not evidence.
//   3. SCHEMA. The envelope matches what the LongMemEval READERS expect —
//      asserted against benchmark/results/head-full500-rrf/longmemeval_s_terransoul.json,
//      a REAL committed artifact. A hand-written mock of the schema would only
//      prove the mock and the emitter agree.
//   4. NO RE-SCORING. Every emitted number is byte-identical to the number the
//      runner's own aggregate produced. This change is plumbing; a number that
//      moved during it would be unattributable.
//
// The INPUT is not hand-written either: it is built by running the runner's
// production `scoreQuery` / `aggregate` / `aggregateOverall` over synthetic
// retrieval orderings, so the emitter is tested against numbers the harness
// really produces.
//
// WHY NOT IN lib/: vitest.config.ts globs `benchmark/scripts/lib/*.test.mjs`.
// A node:test file caught by that glob registers with node:test, vitest finds
// no suites, and it reports green having executed nothing. Run via
// `npm run brain:locomo:artifact:test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregate,
  aggregateOverall,
  scoreQuery,
  writeReports,
} from './locomo-mteb.mjs';
import {
  METRIC_KS,
  SUMMARY_METRIC_ORDER,
  SUMMARY_TO_ROW,
  assertSummaryRecomputes,
  avg,
  childEnvOverrides,
  locomoEnvStamp,
  recomputeSummaryMetric,
  rowKeyFor,
  summaryMetricKeys,
  systemsArtifactFilename,
  toSystemsArtifact,
  writeSystemsArtifacts,
} from './lib/locomo-systems-artifact.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/** The real committed LongMemEval artifact this schema must match. */
const REFERENCE_ARTIFACT = resolve(
  REPO_ROOT,
  'benchmark',
  'results',
  'head-full500-rrf',
  'longmemeval_s_terransoul.json',
);

/* ------------------------------------------------------------------ *
 * Fixture: a native LoCoMo report, scored by the production functions  *
 * ------------------------------------------------------------------ */

const TASKS = ['single_hop', 'multi_hop'];
const SYSTEMS = ['search', 'rrf'];

/** Deterministic pseudo-random so a failure is always reproducible. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Build a native report the same way `run()` does: score each query with
 * `scoreQuery`, aggregate per task with `aggregate`, then `aggregateOverall`.
 * Only the retrieval ORDERINGS are synthetic — every metric is real output of
 * the harness's own arithmetic.
 */
function buildNativeReport({ queriesPerTask = 9, corpus = 40, seed = 20260728 } = {}) {
  const rand = lcg(seed);
  const byTask = [];
  for (const task of TASKS) {
    for (const system of SYSTEMS) {
      const perQuery = [];
      for (let q = 0; q < queriesPerTask; q += 1) {
        // 1-3 golds, so single- and multi-gold rows both appear (multi-gold is
        // where recall_at_k and hit_at_k diverge, i.e. where a metric mix-up
        // would show).
        const goldCount = 1 + Math.floor(rand() * 3);
        const qrels = new Map();
        for (let g = 0; g < goldCount; g += 1) {
          qrels.set(`${task}_doc_${q}_${g}`, 1 + Math.floor(rand() * 2));
        }
        const pool = [...qrels.keys()];
        for (let d = 0; d < corpus; d += 1) pool.push(`${task}_distractor_${q}_${d}`);
        // Shuffle so golds land at varied ranks (some outside every window).
        for (let i = pool.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rand() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const retrievedIds = pool.slice(0, 30);
        perQuery.push({
          task,
          system,
          query_id: `${task}_q_${q}`,
          query: `question ${q} of ${task}`,
          latency_ms: 10 + rand() * 900,
          retrieved_tokens: Math.round(3000 + rand() * 5000),
          retrieved_ids: retrievedIds,
          gold_ids: [...qrels.keys()],
          ...scoreQuery(retrievedIds, qrels),
        });
      }
      byTask.push(aggregate(system, task, perQuery));
    }
  }
  const overall = SYSTEMS.map((system) => aggregateOverall(system, byTask.filter((r) => r.system === system)));
  return {
    benchmark: 'MTEB LoCoMo retrieval-only',
    generated_at: '2026-07-28T00:00:00.000Z',
    env: locomoEnvStamp({ LONGMEM_EMBED: '1', LONGMEM_EMBED_MODEL: 'embeddinggemma:latest' }, {}),
    dataset: 'mteb/LoCoMo',
    revision: '02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac',
    tasks: TASKS,
    systems: SYSTEMS,
    top_k: 100,
    limit: 0,
    total_queries: overall.reduce((sum, row) => Math.max(sum, row.queries), 0),
    overall,
    by_task: byTask,
  };
}

const NATIVE = buildNativeReport();
const ARTIFACT = toSystemsArtifact(NATIVE, 'rrf');

/* ------------------------------------------------------------------ *
 * 1. Round-trip                                                        *
 * ------------------------------------------------------------------ */

test('the emitted artifact round-trips through JSON unchanged', () => {
  const serialised = JSON.stringify(ARTIFACT, null, 2);
  const reparsed = JSON.parse(serialised);
  assert.deepEqual(reparsed, JSON.parse(JSON.stringify(ARTIFACT)));
  // Re-serialising the reparsed object is byte-identical: no NaN/Infinity/
  // undefined snuck in, which JSON would silently mangle into null or drop.
  assert.equal(JSON.stringify(reparsed, null, 2), serialised);
  assert.ok(!/\bNaN\b|\bInfinity\b/.test(serialised), 'artifact carries a non-finite number');
});

test('every system of the run emits its own single-system artifact', () => {
  for (const system of NATIVE.systems) {
    const artifact = toSystemsArtifact(NATIVE, system);
    assert.equal(artifact.systems.length, 1, 'both readers refuse a multi-system report');
    assert.equal(artifact.systems[0].system, system);
    assert.equal(systemsArtifactFilename(NATIVE, system), `locomo_mteb_terransoul_${system}.json`);
  }
  // Split into one file per system, but the shared process is still on record.
  assert.deepEqual(ARTIFACT.run_systems, SYSTEMS);
  assert.equal(ARTIFACT.same_process_systems, true);
});

test('a limited run keeps the runner’s _Nq filename convention', () => {
  const limited = { ...NATIVE, limit: 10, total_queries: 20 };
  assert.equal(systemsArtifactFilename(limited, 'rrf'), 'locomo_mteb_terransoul_rrf_20q.json');
});

/* ------------------------------------------------------------------ *
 * 2. Recomputability — the point of the exercise                       *
 * ------------------------------------------------------------------ */

test('every summary metric is the mean of its own per_question rows to <1e-9', () => {
  const entry = ARTIFACT.systems[0];
  const keys = summaryMetricKeys(entry);
  assert.ok(keys.length >= SUMMARY_METRIC_ORDER.length, 'summary carries fewer metrics than LoCoMo scores');
  for (const key of keys) {
    const recomputed = recomputeSummaryMetric(entry.per_question, key);
    assert.ok(
      Math.abs(recomputed - entry[key]) < 1e-9,
      `${key}: summary ${entry[key]} vs per_question mean ${recomputed}`,
    );
  }
  assert.equal(assertSummaryRecomputes(entry), true);
});

test('per_type breaks down to the same rows and reproduces the runner’s by_task', () => {
  const entry = ARTIFACT.systems[0];
  const counted = Object.values(entry.per_type).reduce((sum, t) => sum + t.count, 0);
  assert.equal(counted, entry.questions, 'per_type does not partition per_question');
  assert.deepEqual(Object.keys(entry.per_type).sort(), [...TASKS].sort());

  for (const [task, stats] of Object.entries(entry.per_type)) {
    const native = NATIVE.by_task.find((r) => r.system === 'rrf' && r.task === task);
    assert.ok(native, `no native by_task row for ${task}`);
    assert.equal(stats.count, native.queries);
    for (const key of SUMMARY_METRIC_ORDER) {
      assert.ok(
        Math.abs(stats[key] - native[key]) < 1e-9,
        `per_type.${task}.${key}: ${stats[key]} vs runner ${native[key]}`,
      );
    }
    // latency/tokens are renamed on the way out; check them through the map.
    assert.ok(Math.abs(stats.avg_latency_ms - native.latency_ms) < 1e-9);
    assert.ok(Math.abs(stats.avg_retrieved_tokens - native.retrieved_tokens) < 1e-9);
  }
});

test('a summary that does not match its rows is REFUSED, not published', () => {
  const broken = JSON.parse(JSON.stringify(ARTIFACT)).systems[0];
  broken.ndcg_at_10 += 0.01;
  assert.throws(() => assertSummaryRecomputes(broken), /ndcg_at_10: summary/);

  const short = JSON.parse(JSON.stringify(ARTIFACT)).systems[0];
  short.per_question.pop();
  assert.throws(() => assertSummaryRecomputes(short), /per_question has/);

  // And the emitter itself refuses a report whose aggregate outruns its rows —
  // the "N-question average published under a 500-question name" failure that
  // longmemeval-s.mjs guards in writeReports.
  const truncated = JSON.parse(JSON.stringify(NATIVE));
  truncated.overall.find((r) => r.system === 'rrf').per_query.pop();
  assert.throws(() => toSystemsArtifact(truncated, 'rrf'), /per_query rows/);
});

test('recomputation uses the runner’s own mean, not a re-implementation of it', () => {
  const values = [0.1, 0.2, 0.30000000000000004, 0.7];
  const rows = values.map((v) => ({ ndcg_at_10: v }));
  assert.equal(recomputeSummaryMetric(rows, 'ndcg_at_10'), avg(values));
  assert.equal(avg([]), 0);
  assert.equal(rowKeyFor('avg_latency_ms'), 'latency_ms');
  assert.equal(rowKeyFor('ndcg_at_10'), 'ndcg_at_10');
});

/* ------------------------------------------------------------------ *
 * 3. Schema — asserted against the REAL committed LongMemEval artifact *
 * ------------------------------------------------------------------ */

function loadReference() {
  assert.ok(
    existsSync(REFERENCE_ARTIFACT),
    `reference artifact missing: ${REFERENCE_ARTIFACT}. This test asserts the schema against a real ` +
      'committed run on purpose — a mock would only prove the mock and the emitter agree.',
  );
  return JSON.parse(readFileSync(REFERENCE_ARTIFACT, 'utf8'));
}

test('the envelope carries every top-level key the LongMemEval artifact carries', () => {
  const reference = loadReference();
  for (const key of Object.keys(reference)) {
    assert.ok(key in ARTIFACT, `envelope is missing '${key}', which the LongMemEval reader expects`);
  }
  assert.ok(Array.isArray(ARTIFACT.systems));
  assert.equal(typeof ARTIFACT.env, 'string');
  assert.equal(ARTIFACT.questions, ARTIFACT.systems[0].questions);
  assert.equal(ARTIFACT.judge, null);
  // Extras are additive LoCoMo provenance and must not collide with the
  // reference's meanings.
  const extras = Object.keys(ARTIFACT).filter((k) => !(k in reference));
  assert.deepEqual(extras.sort(), ['limit', 'run_systems', 'same_process_systems', 'tasks', 'top_k']);
});

test('the system entry carries every structural key the readers index by', () => {
  const referenceSystem = loadReference().systems[0];
  const entry = ARTIFACT.systems[0];
  // compare-arms.mjs reads .system/.questions/.per_question[].question_id and
  // .retrieved_session_ids; check-published-numbers.mjs reads systems[0][metric].
  for (const key of ['system', 'questions', 'judge_support_rate', 'per_question', 'per_type']) {
    assert.ok(key in referenceSystem, `reference lost '${key}' — update this test, not the emitter`);
    assert.ok(key in entry, `system entry is missing '${key}'`);
  }
  assert.equal(typeof entry.system, 'string');
  assert.equal(typeof entry.questions, 'number');
  assert.equal(entry.judge_support_rate, null, 'LoCoMo retrieval scoring runs no evidence judge');
  assert.ok(Array.isArray(entry.per_question));
  assert.equal(typeof entry.per_type, 'object');
  // The two renamed aggregates exist under the reference's spelling.
  for (const key of Object.keys(SUMMARY_TO_ROW)) {
    assert.ok(key in referenceSystem, `reference lost '${key}'`);
    assert.equal(typeof entry[key], 'number');
  }
});

test('per_question rows carry every identity field the readers navigate by', () => {
  const referenceRow = loadReference().systems[0].per_question[0];
  const navigational = [
    'question_id',
    'question_type',
    'question',
    'latency_ms',
    'retrieved_tokens',
    'retrieved_session_ids',
    'gold_session_ids',
    'judge_supported',
    'judge_reason',
  ];
  for (const key of navigational) {
    assert.ok(key in referenceRow, `reference row lost '${key}' — update this test, not the emitter`);
  }
  for (const row of ARTIFACT.systems[0].per_question) {
    for (const key of navigational) assert.ok(key in row, `row ${row.question_id} is missing '${key}'`);
    assert.equal(typeof row.question_id, 'string');
    assert.ok(Array.isArray(row.retrieved_session_ids) && row.retrieved_session_ids.length > 0);
    assert.ok(Array.isArray(row.gold_session_ids) && row.gold_session_ids.length > 0);
    assert.equal(row.judge_supported, null);
    assert.equal(row.judge_reason, null);
  }
});

test('the reference artifact itself satisfies the recomputability bar', () => {
  // If the invariant this emitter is held to did not already hold for the
  // artifacts it is imitating, the bar would be arbitrary. It is not.
  const reference = loadReference();
  for (const entry of reference.systems) assert.equal(assertSummaryRecomputes(entry), true);
});

test('the env stamp is readable by check-published-numbers.mjs embedderOf()', () => {
  const embedderOf = (report) => {
    const m = (typeof report?.env === 'string' ? report.env : '').match(/effective embed model:\s*([^|]+?)\s*$/);
    return m ? m[1].trim() : 'unknown';
  };
  assert.equal(embedderOf(ARTIFACT), 'embeddinggemma:latest');
  assert.notEqual(embedderOf(loadReference()), 'unknown', 'the regex must still read the reference');
  assert.equal(
    embedderOf({ env: locomoEnvStamp({}, {}) }),
    'none (LONGMEM_EMBED unset - dense channel OFF)',
  );
  assert.equal(embedderOf({ env: locomoEnvStamp({ LONGMEM_EMBED: '1' }, {}) }), 'mxbai-embed-large (harness default)');
  // Derived flags override the ambient shell, and LCM_* is stamped too.
  const stamp = locomoEnvStamp({ LONGMEM_EMBED: '1', LCM_CONV_AWARE: '1' }, { LONGMEM_EMBED: '0' });
  assert.match(stamp, /LCM_CONV_AWARE=1/);
  assert.match(stamp, /LONGMEM_EMBED=1/);
});

/* ------------------------------------------------------------------ *
 * 4. No re-scoring                                                     *
 * ------------------------------------------------------------------ */

test('every emitted number is byte-identical to the runner’s own aggregate', () => {
  for (const system of NATIVE.systems) {
    const native = NATIVE.overall.find((r) => r.system === system);
    const entry = toSystemsArtifact(NATIVE, system).systems[0];
    assert.equal(entry.questions, native.queries);
    for (const key of SUMMARY_METRIC_ORDER) {
      assert.equal(entry[key], native[key], `${system}.${key} was re-scored, not copied`);
    }
    assert.equal(entry.avg_latency_ms, native.latency_ms);
    assert.equal(entry.avg_retrieved_tokens, native.retrieved_tokens);
  }
});

test('per_question rows are the runner’s per_query rows, in order, unaltered', () => {
  const native = NATIVE.overall.find((r) => r.system === 'rrf');
  const rows = ARTIFACT.systems[0].per_question;
  assert.equal(rows.length, native.per_query.length);
  for (let i = 0; i < rows.length; i += 1) {
    const src = native.per_query[i];
    const out = rows[i];
    assert.equal(out.question_id, src.query_id, `row ${i} is out of order`);
    assert.equal(out.question_type, src.task);
    assert.equal(out.question, src.query);
    assert.equal(out.latency_ms, src.latency_ms);
    assert.equal(out.retrieved_tokens, src.retrieved_tokens);
    assert.deepEqual(out.retrieved_session_ids, src.retrieved_ids);
    assert.deepEqual(out.gold_session_ids, src.gold_ids);
    for (const k of METRIC_KS) {
      for (const family of ['recall', 'hit', 'ndcg', 'map', 'mrr']) {
        assert.equal(out[`${family}_at_${k}`], src[`${family}_at_${k}`], `row ${i} ${family}_at_${k} changed`);
      }
    }
  }
});

test('LoCoMo metric names are NOT aliased onto LongMemEval’s recall_any_at_k', () => {
  // recall_at_k is COVERAGE (hits/relevant); hit_at_k is the any-hit variant.
  // Publishing coverage under the key `recall_any_at_k` would make the 69.3 %
  // figure look bindable while swapping the definition underneath it.
  const entry = ARTIFACT.systems[0];
  for (const k of [5, 10, 20]) {
    assert.ok(!(`recall_any_at_${k}` in entry), `recall_any_at_${k} must not exist on a LoCoMo artifact`);
    assert.equal(typeof entry[`recall_at_${k}`], 'number');
    assert.equal(typeof entry[`hit_at_${k}`], 'number');
  }
  assert.ok(!('mrr' in entry), 'LoCoMo publishes mrr_at_100, not LongMemEval’s unqualified mrr');
  assert.equal(typeof entry.mrr_at_100, 'number');
  assert.equal(typeof entry.map_at_10, 'number');
  // And the two definitions really do differ on this fixture, so the guard
  // above is not vacuous.
  const differs = [5, 10, 20].some((k) => entry[`recall_at_${k}`] !== entry[`hit_at_${k}`]);
  assert.ok(differs, 'fixture has no multi-gold divergence — the alias guard would be vacuous');
});

test('a metric key present in the summary is present on every row', () => {
  // The structural invariant behind recomputability: no summary number may
  // exist that has no per-item evidence.
  const entry = ARTIFACT.systems[0];
  for (const key of summaryMetricKeys(entry)) {
    const rowKey = rowKeyFor(key);
    for (const row of entry.per_question) {
      assert.equal(typeof row[rowKey], 'number', `row ${row.question_id} has no '${rowKey}' for summary '${key}'`);
    }
  }
});

test('the emitter refuses a system the run never measured', () => {
  assert.throws(() => toSystemsArtifact(NATIVE, 'rrf_rerank'), /no overall row for system 'rrf_rerank'/);
});

/* ------------------------------------------------------------------ *
 * 5. The runner actually writes them                                   *
 * ------------------------------------------------------------------ */

test('writeReports lands the native pair AND one systems[] artifact per system', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'locomo-artifact-'));
  try {
    writeReports(NATIVE, { outDir });
    // The pre-existing artifacts are untouched in name and content shape.
    assert.ok(existsSync(join(outDir, 'locomo_mteb_terransoul.json')));
    assert.ok(existsSync(join(outDir, 'locomo_mteb_terransoul.md')));
    const nativeBack = JSON.parse(readFileSync(join(outDir, 'locomo_mteb_terransoul.json'), 'utf8'));
    assert.deepEqual(nativeBack.systems, SYSTEMS, 'native report still lists system NAMES');

    for (const system of SYSTEMS) {
      const path = join(outDir, `locomo_mteb_terransoul_${system}.json`);
      assert.ok(existsSync(path), `no systems[] artifact for ${system}`);
      const onDisk = JSON.parse(readFileSync(path, 'utf8'));
      assert.deepEqual(onDisk, JSON.parse(JSON.stringify(toSystemsArtifact(NATIVE, system))));
      assert.equal(assertSummaryRecomputes(onDisk.systems[0]), true);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('one unemittable system costs one artifact, not the whole set', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'locomo-artifact-'));
  try {
    const broken = JSON.parse(JSON.stringify(NATIVE));
    broken.overall.find((r) => r.system === 'search').per_query.pop();
    assert.throws(
      () => writeSystemsArtifacts(broken, outDir, { log: () => {} }),
      /wrote 1 of 2 systems\[\] artifacts[\s\S]*search:/,
    );
    assert.ok(existsSync(join(outDir, 'locomo_mteb_terransoul_rrf.json')), 'the healthy arm was withheld');
    assert.ok(!existsSync(join(outDir, 'locomo_mteb_terransoul_search.json')), 'a bad arm was published');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the env stamp and the IPC child read the same flag source', () => {
  // A stamp built from a different object than the one JsonlClient spawns with
  // is how "the embedder config was never recorded" happened the first time.
  assert.deepEqual(childEnvOverrides({ embed: true, kg: true }), {
    LONGMEM_EMBED: '1',
    LONGMEM_KG_EDGES: '1',
  });
  assert.deepEqual(childEnvOverrides(), {});
  assert.match(locomoEnvStamp(childEnvOverrides({ embed: true, rerank: true }), {}), /LONGMEM_RERANK=1/);
});
