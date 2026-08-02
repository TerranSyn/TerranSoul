// Node built-in test runner — vitest is NOT wired to scripts/**/benchmark/scripts
// (see the NOT-HERE-ON-PURPOSE note in vitest.config.ts). Follows the
// scripts/bench/replay-verdicts.test.mjs convention.
//
// MAX-100-17: `mrr()` used to scan the WHOLE retrieved array, so it was
// really MRR@top_k — comparing it across two arms run at different --top-k
// values silently changed the metric's own definition, not just retrieval
// quality. These tests pin the fixed-k behaviour (mrr(list, gold, k) must
// only look at the first k) and that the aggregation/report layer correctly
// carries a SEPARATE fixed-k=20 metric alongside the natural MRR@top_k.
//
// Run with: npm run bench:longmem-mrr:test

import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateSystem, markdownReport, mrr, perType } from './longmemeval-s.mjs';

test('mrr() with no k scans the whole array (unchanged default behaviour)', () => {
  const retrieved = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(mrr(retrieved, ['e']), 1 / 5, 'gold at the last position, full scan');
});

test('mrr() with an explicit k only looks at the first k entries', () => {
  const retrieved = ['a', 'b', 'c', 'd', 'e'];
  // Gold sits at index 4 (rank 5) — visible to a full scan but NOT within
  // the first 3.
  assert.equal(mrr(retrieved, ['e'], 3), 0, 'gold outside the fixed window must score 0');
  assert.equal(mrr(retrieved, ['e'], 5), 1 / 5, 'gold inside the fixed window scores normally');
});

test('mrr() fixed-k is independent of how deep the array actually is', () => {
  // Two "arms" retrieving to different depths, but the SAME gold at rank 2
  // in both — MRR@20 must agree even though the full arrays differ in
  // length (this is exactly the --top-k=20 vs --top-k=50 comparison the
  // chunk exists to make honest).
  const shallowArm = ['x', 'gold', 'y'];
  const deepArm = ['x', 'gold', 'y', 'z', 'w', 'v', 'u', 't', 's', 'r'];
  assert.equal(mrr(shallowArm, ['gold'], 20), mrr(deepArm, ['gold'], 20));
});

test('mrr() returns 0 when gold never appears, at any k', () => {
  assert.equal(mrr(['a', 'b', 'c'], ['zzz'], 20), 0);
  assert.equal(mrr(['a', 'b', 'c'], ['zzz']), 0);
});

test('aggregateSystem carries mrr_at_20 as a separate average from the natural mrr', () => {
  const perQuestion = [
    { recall_any_at_5: 1, recall_any_at_10: 1, recall_any_at_20: 1, ndcg_at_10: 1, mrr_at_20: 1, mrr: 0.5, latency_ms: 10, retrieved_tokens: 100 },
    { recall_any_at_5: 0, recall_any_at_10: 0, recall_any_at_20: 0, ndcg_at_10: 0, mrr_at_20: 0, mrr: 0.25, latency_ms: 20, retrieved_tokens: 200 },
  ];
  const aggregated = aggregateSystem('rrf', perQuestion);
  assert.equal(aggregated.mrr_at_20, 0.5, 'average of [1, 0]');
  assert.equal(aggregated.mrr, 0.375, 'average of [0.5, 0.25] — must stay independent of mrr_at_20');
});

test('perType also carries mrr_at_20 per question type', () => {
  const systemResult = {
    per_question: [
      { question_type: 'single-session-user', recall_any_at_5: 1, recall_any_at_10: 1, ndcg_at_10: 1, mrr_at_20: 1, mrr: 1 },
      { question_type: 'single-session-user', recall_any_at_5: 0, recall_any_at_10: 0, ndcg_at_10: 0, mrr_at_20: 0, mrr: 0 },
    ],
  };
  const byType = perType(systemResult);
  assert.equal(byType['single-session-user'].mrr_at_20, 0.5);
});

test('markdownReport labels the fixed and natural MRR columns distinctly, with the real top_k', () => {
  const report = {
    generated_at: '2026-07-30T00:00:00Z',
    dataset_source: 'built-in sample',
    questions: 1,
    excluded_abstention: 0,
    top_k: 50,
    judge: null,
    systems: [
      {
        system: 'rrf',
        recall_any_at_5: 1,
        recall_any_at_10: 1,
        recall_any_at_20: 1,
        ndcg_at_10: 1,
        mrr_at_20: 1,
        mrr: 0.9,
        avg_latency_ms: 5,
        avg_retrieved_tokens: 10,
        judge_support_rate: null,
        per_type: {},
      },
    ],
  };
  const md = markdownReport(report);
  assert.match(md, /MRR@20/, 'the fixed-k column must be explicitly labelled MRR@20');
  assert.match(md, /MRR@50/, 'the natural-depth column must be labelled with the REAL top_k, not a bare "MRR"');
  assert.ok(!/\| MRR \|/.test(md), 'must not print an unlabelled "MRR" column that could be mistaken for a fixed window');
});
