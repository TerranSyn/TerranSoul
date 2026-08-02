// SPDX-License-Identifier: MIT
//
// LoCoMo -> systems[] artifact emitter.
//
// WHY THIS EXISTS. The 2026-07-27 published-number audit recomputed 63 numeric
// claims from their artifacts. Thirteen LoCoMo figures could not be bound at
// all -- not because the measurement was missing, but because the LoCoMo runner
// committed a MARKDOWN report and a JSON in its own private shape, and
// `scripts/docs/check-published-numbers.mjs` reads exactly one shape: a
// top-level object carrying `systems[]`, each entry holding its summary metrics
// and a `per_question` array. So `LoCoMo R@10 68.3 %` and the eight numbers in
// section 5.2 rested on prose no checker can read.
//
// This module converts the runner's native report into THAT shape. It is an
// EMITTER, NOT A RE-SCORING: every summary value is COPIED from the aggregate
// the runner already computed, and every per-question value is COPIED from the
// per-query row the runner already scored. No metric is redefined, recomputed,
// renamed, or rescaled here. `assertSummaryRecomputes` then proves the copy is
// self-consistent before anything reaches disk.
//
// WHY ONE FILE PER SYSTEM. Both readers -- `metricFrom()` in
// check-published-numbers.mjs and `readArm()` in scripts/bench/compare-arms.mjs
// -- REFUSE a report carrying more than one system, because cross-system
// contamination inside one process is proven (a rrf-only run and a
// rrf+research+max run disagreed on 20/50 orderings with the same binary and
// questions). LoCoMo runs several systems in one process, so the run is emitted
// as one artifact per system, each with `systems.length === 1`. That does not
// make them independent runs and must never be read as if it did -- they share
// `generated_at`, `run_systems` names every system the process ran, and
// `same_process_systems` is true. A checker can bind a number; a reader can
// still see the arms were not isolated.
//
// WHY THE METRIC KEYS ARE LoCoMo's OWN. LongMemEval publishes
// `recall_any_at_k` ("at least one gold in the top k"). LoCoMo publishes
// `recall_at_k` (relevant-document COVERAGE, hits/relevant) and, separately,
// `hit_at_k` (which IS the any-hit variant). Those are different definitions
// over the same window. Mapping LoCoMo's `recall_at_10` onto the key
// `recall_any_at_10` would make the published 69.3 % look bindable while
// silently swapping the definition underneath it -- the precise failure this
// artifact exists to prevent. The ENVELOPE matches LongMemEval exactly; the
// metric NAMES stay LoCoMo's, so a claim binds to the metric it was measured
// with or it does not bind at all.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Cutoffs the LoCoMo runner scores every query at (mirrors METRIC_KS). */
export const METRIC_KS = [1, 5, 10, 20, 100];

/**
 * Summary metrics a LoCoMo aggregate row publishes, in the runner's own order.
 * Mirrors `metricNames` in `aggregate()` minus latency/tokens, which are
 * renamed on the way out (see SUMMARY_TO_ROW).
 */
export const SUMMARY_METRIC_ORDER = [
  ...METRIC_KS.flatMap((k) => [`recall_at_${k}`, `hit_at_${k}`]),
  'ndcg_at_10',
  'map_at_10',
  'mrr_at_100',
];

/**
 * Summary keys whose per-item counterpart is spelled differently. LongMemEval
 * uses the same two renames (`avg_latency_ms` <- `latency_ms`), which is why
 * they are declared rather than guessed: a reader recomputing a summary from
 * `per_question` needs to know which row key feeds which summary key.
 */
export const SUMMARY_TO_ROW = Object.freeze({
  avg_latency_ms: 'latency_ms',
  avg_retrieved_tokens: 'retrieved_tokens',
});

/** Summary keys that are structure, not measurements. */
export const NON_METRIC_SYSTEM_KEYS = Object.freeze([
  'system',
  'questions',
  'judge_support_rate',
  'per_question',
  'per_type',
]);

/** The per-question row key that feeds a given summary key. */
export function rowKeyFor(summaryKey) {
  return SUMMARY_TO_ROW[summaryKey] ?? summaryKey;
}

/**
 * Mean, byte-for-byte the runner's own `avg()`: same left fold, same order,
 * same empty-list convention. Recomputation only proves anything if it is the
 * identical arithmetic.
 */
export function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** Every numeric summary key on a system entry (i.e. everything recomputable). */
export function summaryMetricKeys(systemEntry) {
  const skip = new Set(NON_METRIC_SYSTEM_KEYS);
  return Object.keys(systemEntry).filter(
    (key) => !skip.has(key) && typeof systemEntry[key] === 'number' && Number.isFinite(systemEntry[key]),
  );
}

/**
 * Recompute one summary metric from the rows it claims to summarise.
 * Exported because the test, the emitter's own pre-write guard, and any future
 * auditor must all use the SAME recomputation -- three spellings of "the mean"
 * is how a disagreement becomes a debate instead of a failure.
 */
export function recomputeSummaryMetric(rows, summaryKey) {
  const rowKey = rowKeyFor(summaryKey);
  return avg(rows.map((row) => Number(row[rowKey] ?? 0)));
}

/**
 * Throw unless every summary metric on `systemEntry` is the mean of its own
 * `per_question` rows. The audit found ZERO non-recomputable summaries across
 * the 13 committed LongMemEval artifacts; this is what holds LoCoMo to that bar
 * BEFORE an artifact reaches disk rather than after it is published.
 */
export function assertSummaryRecomputes(systemEntry, { tolerance = 1e-9 } = {}) {
  const rows = systemEntry.per_question;
  if (!Array.isArray(rows)) {
    throw new Error(`system '${systemEntry.system}': per_question is not an array`);
  }
  if (rows.length !== systemEntry.questions) {
    throw new Error(
      `system '${systemEntry.system}': questions=${systemEntry.questions} but per_question has ${rows.length} rows`,
    );
  }
  const failures = [];
  for (const key of summaryMetricKeys(systemEntry)) {
    const rowKey = rowKeyFor(key);
    const missing = rows.findIndex((row) => typeof row[rowKey] !== 'number' || !Number.isFinite(row[rowKey]));
    if (missing >= 0) {
      failures.push(`${key}: row ${missing} has no finite '${rowKey}'`);
      continue;
    }
    const recomputed = recomputeSummaryMetric(rows, key);
    const delta = Math.abs(recomputed - systemEntry[key]);
    if (!(delta <= tolerance)) {
      failures.push(`${key}: summary ${systemEntry[key]} vs per_question mean ${recomputed} (delta ${delta})`);
    }
  }
  if (failures.length) {
    throw new Error(
      `system '${systemEntry.system}': summary does not recompute from per_question:\n  ${failures.join('\n  ')}`,
    );
  }
  return true;
}

/**
 * Environment stamp, mirroring `longmemEnvStamp()` in longmemeval-s.mjs so
 * `embedderOf()` in check-published-numbers.mjs can read it unchanged. The
 * whole "RRF regression" episode was an unrecorded embedder difference between
 * two runs; `overrides` carries the LONGMEM_* flags the LoCoMo runner sets on
 * the child ITSELF (they are derived from --systems, not from the ambient
 * shell, so reading process.env alone would under-report the real config).
 */
export function locomoEnvStamp(overrides = {}, env = process.env) {
  const merged = { ...env, ...overrides };
  const keys = Object.keys(merged)
    .filter((k) => k.startsWith('LONGMEM_') || k.startsWith('OLLAMA_') || k.startsWith('LCM_'))
    .sort();
  const pairs = keys.map((k) => `${k}=${merged[k]}`);
  const embedModel = merged.LONGMEM_EMBED === '1'
    ? (merged.LONGMEM_EMBED_MODEL ?? 'mxbai-embed-large (harness default)')
    : 'none (LONGMEM_EMBED unset - dense channel OFF)';
  return `${pairs.length ? pairs.join(' ') : '(no LONGMEM_* vars set)'} | effective embed model: ${embedModel}`;
}

/** Convert one native per-query row into a LongMemEval-shaped per_question row. */
export function toQuestionRow(nativeRow) {
  const out = {
    question_id: nativeRow.query_id,
    question_type: nativeRow.task,
    question: nativeRow.query,
  };
  // Copied verbatim, in a fixed order, so two artifacts of the same run diff
  // cleanly. Only keys the runner actually scored are emitted.
  for (const k of METRIC_KS) {
    for (const family of ['recall', 'hit', 'ndcg', 'map', 'mrr']) {
      const key = `${family}_at_${k}`;
      if (typeof nativeRow[key] === 'number') out[key] = nativeRow[key];
    }
  }
  out.latency_ms = nativeRow.latency_ms;
  out.retrieved_tokens = nativeRow.retrieved_tokens;
  out.retrieved_session_ids = nativeRow.retrieved_ids ?? [];
  out.gold_session_ids = nativeRow.gold_ids ?? [];
  // LoCoMo retrieval scoring runs no evidence judge. `null` is the same
  // "not run" signal LongMemEval emits, and is NOT the same as `false`.
  out.judge_supported = null;
  out.judge_reason = null;
  return out;
}

/** Per-question-type breakdown, recomputed from the emitted rows. */
export function perTypeFrom(rows, metricKeys) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.question_type)) groups.set(row.question_type, []);
    groups.get(row.question_type).push(row);
  }
  return Object.fromEntries(
    [...groups].map(([type, typeRows]) => [
      type,
      {
        count: typeRows.length,
        ...Object.fromEntries(metricKeys.map((key) => [key, recomputeSummaryMetric(typeRows, key)])),
      },
    ]),
  );
}

/**
 * Build the systems[] artifact for ONE system of a native LoCoMo report.
 *
 * `nativeReport` is exactly what `run()` in locomo-mteb.mjs returns.
 * Nothing is measured here; the summary is lifted from `overall[]` and the
 * rows from `overall[].per_query`.
 */
export function toSystemsArtifact(nativeReport, system, { env = null } = {}) {
  const overall = (nativeReport.overall ?? []).find((row) => row.system === system);
  if (!overall) {
    const seen = (nativeReport.overall ?? []).map((row) => row.system).join(', ') || '(none)';
    throw new Error(`no overall row for system '${system}'; report carries: ${seen}`);
  }
  if (!Array.isArray(overall.per_query) || overall.per_query.length === 0) {
    throw new Error(`system '${system}': overall row carries no per_query rows to publish`);
  }
  if (overall.per_query.length !== overall.queries) {
    throw new Error(
      `system '${system}': aggregate says ${overall.queries} queries but carries ` +
        `${overall.per_query.length} per_query rows -- refusing to publish a summary over rows it does not have`,
    );
  }

  const rows = overall.per_query.map(toQuestionRow);
  const summary = {};
  for (const key of SUMMARY_METRIC_ORDER) {
    if (typeof overall[key] === 'number') summary[key] = overall[key];
  }

  const entry = {
    system,
    questions: overall.queries,
    ...summary,
    avg_latency_ms: overall.latency_ms,
    avg_retrieved_tokens: overall.retrieved_tokens,
    judge_support_rate: null,
    per_question: rows,
  };
  entry.per_type = perTypeFrom(rows, summaryMetricKeys(entry));

  // Refuse to emit a summary that cannot be re-derived from its own evidence.
  assertSummaryRecomputes(entry);

  const dataset = nativeReport.dataset ?? 'mteb/LoCoMo';
  const revision = nativeReport.revision ?? 'unpinned';
  return {
    benchmark: nativeReport.benchmark ?? 'MTEB LoCoMo retrieval-only',
    generated_at: nativeReport.generated_at,
    env: env ?? nativeReport.env ?? locomoEnvStamp({}, {}),
    dataset_source: `${dataset} @ ${revision}`,
    dataset_url: `https://huggingface.co/datasets/${dataset}/tree/${revision}`,
    methodology_source: 'https://github.com/embeddings-benchmark/mteb',
    questions: overall.queries,
    // LoCoMo has no abstention split to drop; `adversarial` is a scored task,
    // not an excluded one. Zero here means "nothing was excluded", not "unknown".
    excluded_abstention: 0,
    tasks: nativeReport.tasks ?? [],
    top_k: nativeReport.top_k ?? null,
    limit: nativeReport.limit ?? 0,
    // Provenance the split-by-system file would otherwise destroy.
    run_systems: nativeReport.systems ?? [system],
    same_process_systems: (nativeReport.systems ?? [system]).length > 1,
    systems: [entry],
    judge: null,
  };
}

/**
 * Filename for a system's artifact. Mirrors the runner's existing convention
 * (`_<N>q` suffix on a limited run) with the system name in the stem, so a
 * multi-system run cannot overwrite itself.
 */
export function systemsArtifactFilename(nativeReport, system) {
  const suffix = (nativeReport.limit ?? 0) > 0 ? `_${nativeReport.total_queries}q` : '';
  return `locomo_mteb_terransoul_${system}${suffix}.json`;
}

/** Every system artifact for a native report, keyed by filename. */
export function toSystemsArtifacts(nativeReport, { env = null } = {}) {
  return (nativeReport.systems ?? []).map((system) => ({
    filename: systemsArtifactFilename(nativeReport, system),
    artifact: toSystemsArtifact(nativeReport, system, { env }),
  }));
}

/**
 * The LONGMEM_ and LCM_ flags the LoCoMo runner sets on the IPC child. Single
 * source of truth: JsonlClient spawns with these AND the env stamp records
 * them, so the stamp cannot drift from the configuration it describes.
 */
export function childEnvOverrides({
  embed = false,
  rerank = false,
  hyde = false,
  contextualize = false,
  kg = false,
  convAware = false,
} = {}) {
  return {
    ...(embed ? { LONGMEM_EMBED: '1' } : {}),
    ...(rerank ? { LONGMEM_RERANK: '1' } : {}),
    ...(hyde ? { LONGMEM_HYDE: '1' } : {}),
    ...(contextualize ? { LONGMEM_CONTEXTUALIZE: '1' } : {}),
    ...(kg ? { LONGMEM_KG_EDGES: '1' } : {}),
    ...(convAware ? { LCM_CONV_AWARE: '1' } : {}),
  };
}

/**
 * Write one systems[] artifact per system of a finished run.
 *
 * Failures are COLLECTED rather than thrown eagerly: the caller has already put
 * the native report on disk, and every system that CAN be emitted should be,
 * so a defect in one arm costs one artifact instead of the whole set.
 */
export function writeSystemsArtifacts(nativeReport, outDir, { log = console.log } = {}) {
  const failures = [];
  const written = [];
  for (const system of nativeReport.systems ?? []) {
    try {
      // The FULL report goes in, so `run_systems` / `same_process_systems`
      // still record that these arms shared one process.
      const artifact = toSystemsArtifact(nativeReport, system, { env: nativeReport.env });
      const path = resolve(outDir, systemsArtifactFilename(nativeReport, system));
      writeFileSync(path, JSON.stringify(artifact, null, 2), 'utf8');
      log(`[locomo] wrote ${path}`);
      written.push(path);
    } catch (err) {
      failures.push(`${system}: ${err.message}`);
    }
  }
  if (failures.length) {
    throw new Error(
      `wrote ${written.length} of ${(nativeReport.systems ?? []).length} systems[] artifacts; `
        + `the native report is safe on disk. Failures:\n  ${failures.join('\n  ')}`,
    );
  }
  return written;
}
