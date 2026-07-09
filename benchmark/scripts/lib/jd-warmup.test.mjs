// SPDX-License-Identifier: MIT
// MILLION-RESUME-BENCH: warmupThenMeasure proves the cold-sample is excluded
// from the timed/warm latency series (JD-MILLION-WARMP50-1).

import { describe, expect, it } from 'vitest';
import { warmupThenMeasure } from './jd-warmup.mjs';
import { percentile } from './jd-metrics.mjs';

/**
 * Builds a matched (now, sendOnce) pair where "time" elapses only while
 * `sendOnce` is in flight (mirroring the real await client.send(...) call) --
 * each `sendOnce()` invocation advances a shared clock by the next duration
 * popped off `durations`, and `now()` just reads that shared clock.
 */
function fakeTimedCalls(durations) {
  let clockValue = 0;
  let cursor = 0;
  const now = () => clockValue;
  const sendOnce = async () => {
    const duration = durations[cursor];
    cursor += 1;
    clockValue += duration;
    return `call-${cursor - 1}`;
  };
  return { now, sendOnce };
}

describe('warmupThenMeasure', () => {
  it('excludes the cold warm-up sample from the timed latencies (synthetic outlier-first sequence)', async () => {
    // Synthetic sequence: cold warm-up = 2600ms (outlier, matches the measured
    // 1900-2600ms p95 cold spike), then 4 consistent warm samples ~1300ms.
    const coldSample = 2600;
    const warmSamples = [1300, 1290, 1310, 1295];
    const { now, sendOnce } = fakeTimedCalls([coldSample, ...warmSamples]);

    const { coldMs, latencies, lastResult } = await warmupThenMeasure(sendOnce, warmSamples.length, now);

    // Cold sample is captured separately, not silently dropped.
    expect(coldMs).toBe(coldSample);
    // Exactly `runs` timed samples, none of them the cold one.
    expect(latencies).toEqual(warmSamples);
    expect(latencies).not.toContain(coldSample);
    // Accuracy is still computed from the LAST timed call (call 0 was the
    // warm-up; calls 1..4 are the timed runs; lastResult is call 4).
    expect(lastResult).toBe(`call-${warmSamples.length}`);

    // The reported p50/p95 (same percentile() the bench uses) reflect ONLY
    // the warm samples -- proving the methodology fix, not just the plumbing.
    expect(percentile(latencies, 50)).toBeCloseTo(1297.5, 6);
    // sorted warm samples [1290,1295,1300,1310]; rank=0.95*3=2.85 -> 1300 + 0.85*(1310-1300) = 1308.5
    expect(percentile(latencies, 95)).toBeCloseTo(1308.5, 6);
    expect(percentile(latencies, 95)).toBeLessThan(coldSample);
  });

  it('calls sendOnce exactly runs + 1 times (1 warm-up + N timed)', async () => {
    let calls = 0;
    const sendOnce = async () => {
      calls += 1;
      return calls;
    };
    await warmupThenMeasure(sendOnce, 5);
    expect(calls).toBe(6);
  });

  it('propagates a rejection from the warm-up call without running timed iterations', async () => {
    let calls = 0;
    const sendOnce = async () => {
      calls += 1;
      if (calls === 1) throw new Error('cold call failed');
      return 'ok';
    };
    await expect(warmupThenMeasure(sendOnce, 3)).rejects.toThrow('cold call failed');
    expect(calls).toBe(1);
  });

  it('defaults to a real clock when none is injected', async () => {
    const sendOnce = async () => 'ok';
    const { coldMs, latencies } = await warmupThenMeasure(sendOnce, 2);
    expect(coldMs).toBeGreaterThanOrEqual(0);
    expect(latencies).toHaveLength(2);
    for (const value of latencies) expect(value).toBeGreaterThanOrEqual(0);
  });
});
