// SPDX-License-Identifier: MIT
//
// DOCBENCH-1 scorer — document-corpus retrieval, scored on PAGE-LEVEL gold.
//
// WHY THIS BENCH EXISTS. Nothing in `benchmark/` measures retrieval over
// ingested DOCUMENTS: LongMemEval ingests through `add_many_bench`
// (longmemeval_ipc.rs) and jd-million through JSONL, so neither touches
// `docparse`, PDF chunking, or the source guide. That blind spot is why
// `heading: None` on every PDF chunk (DOCBENCH-2) could sit in the product
// unnoticed — and, under `rules/no-unexercised-features.md`, it is why the
// fix cannot ship until an arm exercises it.
//
// WHY PAGES AND NOT ANSWERS. FinanceBench's headline 98.7% belongs to Mafin
// 2.5, is self-adjudicated (strict agreement with gold is 90.7%), and its
// shipped `eval.py` never computes an accuracy at all. None of that touches
// us here: every question ships `evidence[].evidence_page_num`, which is
// genuine RETRIEVAL gold. We score whether the right PAGE came back and never
// grade a generated answer, so no judge — ours or theirs — is in the loop.
//
// ⚠️ THE OFF-BY-ONE, PROVEN RATHER THAN ASSUMED. `evidence_page_num` is
// 0-INDEXED; `DocBlock.page` (docparse.rs) is 1-based. Verified empirically,
// not from the README: each evidence item also ships `evidence_text_full_page`,
// and comparing that against the real PDF text matched at index `p` in 50/50
// cases and at `p-1` in 0/50. Silent off-by-one page scoring produces numbers
// that look entirely plausible and are wrong, so `goldPageKeys` owns the
// conversion and a test pins it.
//
// Metrics are IMPORTED from `longmemeval-s.mjs`, never redefined here — see
// the note on the exports there.

import { mrr, ndcg, recallAny } from './longmemeval-s.mjs';

/** Stable identity for one retrievable unit: a page within a document. */
export function pageKey(docName, page1Based) {
  return `${docName}#${page1Based}`;
}

/**
 * Gold page keys for one FinanceBench question, converting 0-indexed
 * `evidence_page_num` to the 1-based page numbering the product uses.
 *
 * A question may carry 1..3 evidence items (measured on the open-source set:
 * 115 / 31 / 4), so gold is a SET, and 35 of the 150 questions are multi-gold.
 * `ndcg`'s ideal ranking already accounts for `gold.size`, which is why it is
 * reused rather than reimplemented.
 */
export function goldPageKeys(question) {
  const evidence = Array.isArray(question?.evidence) ? question.evidence : [];
  const keys = [];
  for (const item of evidence) {
    const zeroIndexed = item?.evidence_page_num;
    if (!Number.isInteger(zeroIndexed) || zeroIndexed < 0) continue;
    const doc = item?.doc_name || question?.doc_name;
    if (!doc) continue;
    const key = pageKey(doc, zeroIndexed + 1);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Score one arm. `perQuestion` rows carry the pages the product returned, in
 * rank order, as `doc#page` keys.
 *
 * Every summary metric is the mean of its own per-question rows, so the
 * artifact stays RECOMPUTABLE from what it publishes — the property the
 * 2026-07-27 artifact audit checked across 13 committed LongMemEval files and
 * that `locomo-systems-artifact.test.mjs` pins for LoCoMo.
 */
export function scoreRun(perQuestion) {
  const rows = perQuestion.map(row => {
    const retrieved = row.retrieved_pages ?? [];
    const gold = row.gold_pages ?? [];
    return {
      ...row,
      recall_any_at_5: recallAny(retrieved, gold, 5),
      recall_any_at_10: recallAny(retrieved, gold, 10),
      recall_any_at_20: recallAny(retrieved, gold, 20),
      ndcg_at_10: ndcg(retrieved, gold, 10),
      mrr_at_10: mrr(retrieved, gold, 10),
    };
  });
  const mean = key => (rows.length
    ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length
    : 0);
  return {
    n: rows.length,
    summary: {
      recall_any_at_5: mean('recall_any_at_5'),
      recall_any_at_10: mean('recall_any_at_10'),
      recall_any_at_20: mean('recall_any_at_20'),
      ndcg_at_10: mean('ndcg_at_10'),
      mrr_at_10: mean('mrr_at_10'),
    },
    per_question: rows,
  };
}

/**
 * Load the FinanceBench open-source question set and index it by id.
 * Kept separate from scoring so the scorer itself needs no corpus on disk
 * (and so its tests stay hermetic).
 */
export function loadGold(jsonlText) {
  const byId = new Map();
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const question = JSON.parse(trimmed);
    byId.set(question.financebench_id, {
      financebench_id: question.financebench_id,
      doc_name: question.doc_name,
      question: question.question,
      gold_pages: goldPageKeys(question),
    });
  }
  return byId;
}
