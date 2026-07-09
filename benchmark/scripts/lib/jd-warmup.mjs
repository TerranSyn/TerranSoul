// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: warm-up-then-measure query timing helper.
//
// Extracted from jd-million-bench.mjs's runQueries (JD-MILLION-WARMP50-1,
// 2026-07-09). The bench previously timed ALL `QUERY_RUNS` repetitions of a
// query, including the very first one against a cold cache/plan (measured
// 1900-2600ms p95 spikes vs ~1300ms p50 on repeated runs of the SAME query
// against the SAME 1M-row corpus). Mixing that cold sample into a "warm p50"
// figure is a methodology mismatch: rules/milestones.md's "jd-million
// rebench" section flags this exact gap.
//
// Fix: issue ONE untimed-for-reporting warm-up call first (its latency is
// still measured and returned as `coldMs` for auditability, just excluded
// from the timed `latencies` array), then time exactly `runs` further calls.
// The LAST timed call's result is returned as `lastResult` so accuracy can
// still be computed "from the last run" as before -- only the latency
// bookkeeping changes.

/**
 * @param {() => Promise<T>} sendOnce  issues one request and resolves with its result
 * @param {number} runs                 number of TIMED repetitions after the warm-up
 * @param {() => number} [now]          clock function (injectable for tests); defaults to performance.now
 * @returns {Promise<{ coldMs: number, latencies: number[], lastResult: T }>}
 * @template T
 */
export async function warmupThenMeasure(sendOnce, runs, now = () => performance.now()) {
  const warmupStart = now();
  await sendOnce();
  const coldMs = now() - warmupStart;

  const latencies = [];
  let lastResult;
  for (let runIdx = 0; runIdx < runs; runIdx += 1) {
    const start = now();
    lastResult = await sendOnce();
    latencies.push(now() - start);
  }
  return { coldMs, latencies, lastResult };
}
