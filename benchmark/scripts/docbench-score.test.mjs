// Node built-in test runner — vitest is NOT wired to benchmark/scripts
// (see the NOT-HERE-ON-PURPOSE note in vitest.config.ts). Follows the
// longmemeval-mrr.test.mjs convention.
//
// WHY EACH CASE CAN FAIL (rules/tests-must-be-able-to-fail.md). Every case
// here fails on a scorer that is plausible but wrong, and each wrong version
// is one someone would actually write:
//
//   gold_page_conversion_is_1_based   a scorer that passes evidence_page_num
//                                     through unchanged. This is THE bug this
//                                     bench is most likely to ship with: the
//                                     gold is 0-indexed, DocBlock.page is
//                                     1-based, and an off-by-one page score
//                                     looks entirely reasonable.
//   multi_gold_*                      a scorer that takes evidence[0] only.
//                                     35 of the 150 questions are multi-gold,
//                                     so this silently drops a fifth of the
//                                     gold and INFLATES nothing — it deflates
//                                     recall, which reads as a product
//                                     regression.
//   ndcg_ideal_accounts_for_gold_size a scorer whose ideal DCG assumes ONE
//                                     gold, which caps a perfect multi-gold
//                                     ranking below 1.0.
//   summary_is_recomputable           an artifact whose summary is not the
//                                     mean of its own rows (the property the
//                                     2026-07-27 audit checked across 13
//                                     committed artifacts).
//
// Run with: npm run bench:docbench:test

import test from 'node:test';
import assert from 'node:assert/strict';

import { goldPageKeys, loadGold, pageKey, scoreRun } from './docbench-score.mjs';

// A real row's shape, trimmed. Page 59 zero-indexed is page 60 of the PDF —
// confirmed against 3M_2018_10K.pdf via evidence_text_full_page.
const Q_SINGLE = {
  financebench_id: 'financebench_id_04672',
  doc_name: '3M_2018_10K',
  evidence: [{ evidence_text: '...', doc_name: '3M_2018_10K', evidence_page_num: 59 }],
};

const Q_MULTI = {
  financebench_id: 'financebench_id_multi',
  doc_name: 'ACME_2022_10K',
  evidence: [
    { doc_name: 'ACME_2022_10K', evidence_page_num: 0 },
    { doc_name: 'ACME_2022_10K', evidence_page_num: 4 },
  ],
};

test('gold page conversion is 1-based (evidence_page_num is 0-indexed)', () => {
  assert.deepEqual(goldPageKeys(Q_SINGLE), ['3M_2018_10K#60']);
  // The failure mode this guards: passing the value through unchanged.
  assert.notDeepEqual(goldPageKeys(Q_SINGLE), ['3M_2018_10K#59']);
});

test('page 0 in the gold is the FIRST page, not a missing value', () => {
  // 0 is a legitimate page number in this dataset, so a truthiness check on
  // the page (`if (!page)`) would silently drop it.
  assert.ok(goldPageKeys(Q_MULTI).includes('ACME_2022_10K#1'));
});

test('multi-gold questions keep every evidence page', () => {
  assert.deepEqual(goldPageKeys(Q_MULTI), ['ACME_2022_10K#1', 'ACME_2022_10K#5']);
});

test('evidence carrying its own doc_name wins over the question-level one', () => {
  const cross = {
    doc_name: 'QUESTION_LEVEL_DOC',
    evidence: [{ doc_name: 'EVIDENCE_LEVEL_DOC', evidence_page_num: 2 }],
  };
  assert.deepEqual(goldPageKeys(cross), ['EVIDENCE_LEVEL_DOC#3']);
});

test('malformed evidence is skipped rather than scored as page NaN', () => {
  const junk = {
    doc_name: 'D',
    evidence: [
      { doc_name: 'D', evidence_page_num: null },
      { doc_name: 'D', evidence_page_num: -1 },
      { doc_name: 'D' },
      { doc_name: 'D', evidence_page_num: 7 },
    ],
  };
  assert.deepEqual(goldPageKeys(junk), ['D#8']);
});

test('recall@k respects the cutoff', () => {
  const gold = [pageKey('D', 3)];
  const retrieved = Array.from({ length: 12 }, (_, i) => pageKey('D', 100 + i));
  retrieved[10] = pageKey('D', 3); // rank 11 — outside 5 and 10, inside 20
  const { summary } = scoreRun([{ gold_pages: gold, retrieved_pages: retrieved }]);
  assert.equal(summary.recall_any_at_5, 0);
  assert.equal(summary.recall_any_at_10, 0);
  assert.equal(summary.recall_any_at_20, 1);
});

test('ndcg ideal accounts for gold set size, so a perfect multi-gold ranking scores 1.0', () => {
  const gold = [pageKey('D', 1), pageKey('D', 5)];
  const retrieved = [pageKey('D', 1), pageKey('D', 5), pageKey('D', 9)];
  const { summary } = scoreRun([{ gold_pages: gold, retrieved_pages: retrieved }]);
  assert.equal(summary.ndcg_at_10, 1, 'both golds at the top must be a perfect score');
});

test('a multi-gold question ranked one-of-two scores between 0 and 1', () => {
  const gold = [pageKey('D', 1), pageKey('D', 5)];
  const retrieved = [pageKey('D', 1), pageKey('D', 9)];
  const { summary } = scoreRun([{ gold_pages: gold, retrieved_pages: retrieved }]);
  assert.ok(summary.ndcg_at_10 > 0 && summary.ndcg_at_10 < 1, `got ${summary.ndcg_at_10}`);
});

test('summary is recomputable as the mean of its own per_question rows', () => {
  const rows = [
    { gold_pages: [pageKey('D', 1)], retrieved_pages: [pageKey('D', 1)] },
    { gold_pages: [pageKey('D', 2)], retrieved_pages: [pageKey('D', 9)] },
  ];
  const result = scoreRun(rows);
  for (const key of ['recall_any_at_5', 'recall_any_at_10', 'ndcg_at_10', 'mrr_at_10']) {
    const mean = result.per_question.reduce((s, r) => s + r[key], 0) / result.per_question.length;
    assert.ok(Math.abs(result.summary[key] - mean) < 1e-9, `${key} must be the mean of its rows`);
  }
  assert.equal(result.summary.recall_any_at_5, 0.5);
});

test('loadGold indexes by financebench_id and precomputes gold pages', () => {
  const jsonl = `${JSON.stringify(Q_SINGLE)}\n\n${JSON.stringify(Q_MULTI)}\n`;
  const gold = loadGold(jsonl);
  assert.equal(gold.size, 2, 'blank lines must not become entries');
  assert.deepEqual(gold.get('financebench_id_04672').gold_pages, ['3M_2018_10K#60']);
  assert.equal(gold.get('financebench_id_multi').gold_pages.length, 2);
});
