import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG_ANCHOR,
  CONFIG_JSON_MARKER,
  DEFAULT_BASE_TIMEOUT_MS,
  DEFAULT_EXHAUSTION_CAP,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_CAP_MS,
  computeAttemptTimeoutMs,
  computeTrailingExhaustionStreak,
  filterGenuineIterationsForStopConditions,
  loadActorRetryConfig,
  parseActorRetryConfig,
  shouldRetryActor,
} from './actor-retry.mjs';
import { evaluateStopConditions } from './stop-conditions.mjs';

function seedFixture(json) {
  return `-- some unrelated seed content\n${CONFIG_ANCHOR}, read by lib/actor-retry.mjs: ${CONFIG_JSON_MARKER} ${JSON.stringify(json)}\n-- trailing content\n`;
}

describe('parseActorRetryConfig', () => {
  it('parses a well-formed config row', () => {
    const cfg = parseActorRetryConfig(
      seedFixture({ max_retries: 2, base_timeout_ms: 600000, timeout_cap_ms: 2400000, exhaustion_cap: 3 }),
    );
    expect(cfg).toEqual({
      maxRetries: 2,
      baseTimeoutMs: 600000,
      timeoutCapMs: 2400000,
      exhaustionCap: 3,
      source: 'seed',
    });
  });

  it('defaults exhaustion_cap when the seed omits it', () => {
    const cfg = parseActorRetryConfig(seedFixture({ max_retries: 1, base_timeout_ms: 600000, timeout_cap_ms: 1200000 }));
    expect(cfg.exhaustionCap).toBe(DEFAULT_EXHAUSTION_CAP);
  });

  it('returns null when the anchor is missing entirely', () => {
    expect(parseActorRetryConfig('no config here at all')).toBeNull();
  });

  it('returns null when the anchor is present but the JSON marker is not', () => {
    expect(parseActorRetryConfig(`${CONFIG_ANCHOR} but no marker follows`)).toBeNull();
  });

  it('returns null on malformed JSON after the marker', () => {
    expect(parseActorRetryConfig(`${CONFIG_ANCHOR} ${CONFIG_JSON_MARKER} {not json}`)).toBeNull();
  });

  it('returns null when a required field is out of range (negative retries)', () => {
    expect(
      parseActorRetryConfig(seedFixture({ max_retries: -1, base_timeout_ms: 600000, timeout_cap_ms: 1200000 })),
    ).toBeNull();
  });

  it('returns null when timeout_cap_ms is below base_timeout_ms', () => {
    expect(
      parseActorRetryConfig(seedFixture({ max_retries: 1, base_timeout_ms: 600000, timeout_cap_ms: 100 })),
    ).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseActorRetryConfig(null)).toBeNull();
    expect(parseActorRetryConfig(undefined)).toBeNull();
    expect(parseActorRetryConfig(42)).toBeNull();
  });
});

describe('loadActorRetryConfig', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'actor-retry-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a valid seed file from disk', () => {
    const seedPath = path.join(dir, 'memory-seed.sql');
    writeFileSync(seedPath, seedFixture({ max_retries: 4, base_timeout_ms: 500000, timeout_cap_ms: 2000000, exhaustion_cap: 5 }));
    const cfg = loadActorRetryConfig({ seedPath });
    expect(cfg).toEqual({
      maxRetries: 4,
      baseTimeoutMs: 500000,
      timeoutCapMs: 2000000,
      exhaustionCap: 5,
      source: 'seed',
    });
  });

  it('fails open to the documented defaults when the file does not exist', () => {
    const cfg = loadActorRetryConfig({ seedPath: path.join(dir, 'missing.sql') });
    expect(cfg).toEqual({
      maxRetries: DEFAULT_MAX_RETRIES,
      baseTimeoutMs: DEFAULT_BASE_TIMEOUT_MS,
      timeoutCapMs: DEFAULT_TIMEOUT_CAP_MS,
      exhaustionCap: DEFAULT_EXHAUSTION_CAP,
      source: 'fallback',
    });
  });

  it('fails open to the documented defaults when the seed content is unparsable', () => {
    const seedPath = path.join(dir, 'memory-seed.sql');
    writeFileSync(seedPath, 'nothing relevant in this file');
    const cfg = loadActorRetryConfig({ seedPath });
    expect(cfg.source).toBe('fallback');
    expect(cfg.maxRetries).toBe(DEFAULT_MAX_RETRIES);
  });

  it('lets an explicit CLI override win over the seed value', () => {
    const seedPath = path.join(dir, 'memory-seed.sql');
    writeFileSync(seedPath, seedFixture({ max_retries: 2, base_timeout_ms: 600000, timeout_cap_ms: 2400000 }));
    const cfg = loadActorRetryConfig({ seedPath, overrideMaxRetries: 7 });
    expect(cfg.maxRetries).toBe(7);
    expect(cfg.source).toBe('seed+cli-override');
    // Non-retry fields still come from the seed.
    expect(cfg.baseTimeoutMs).toBe(600000);
  });

  it('lets a CLI override win even over the fallback', () => {
    const cfg = loadActorRetryConfig({ seedPath: path.join(dir, 'missing.sql'), overrideMaxRetries: 0 });
    expect(cfg.maxRetries).toBe(0);
    expect(cfg.source).toBe('fallback+cli-override');
  });
});

describe('computeAttemptTimeoutMs', () => {
  it('keeps attempt 0 at exactly the base timeout (no behavior change for the first attempt)', () => {
    expect(computeAttemptTimeoutMs(0, 600000, 2400000)).toBe(600000);
  });

  it('scales linearly with attempt index before the cap', () => {
    expect(computeAttemptTimeoutMs(1, 600000, 2400000)).toBe(1200000);
    expect(computeAttemptTimeoutMs(2, 600000, 2400000)).toBe(1800000);
  });

  it('caps at timeoutCapMs once the linear schedule would exceed it', () => {
    expect(computeAttemptTimeoutMs(3, 600000, 2400000)).toBe(2400000);
    expect(computeAttemptTimeoutMs(10, 600000, 2400000)).toBe(2400000);
  });

  it('treats a negative/garbage attempt index as attempt 0', () => {
    expect(computeAttemptTimeoutMs(-5, 600000, 2400000)).toBe(600000);
    expect(computeAttemptTimeoutMs(NaN, 600000, 2400000)).toBe(600000);
  });

  it('uses the documented defaults when base/cap are omitted', () => {
    expect(computeAttemptTimeoutMs(0)).toBe(DEFAULT_BASE_TIMEOUT_MS);
  });
});

describe('shouldRetryActor', () => {
  it('allows a retry while attemptIndex is below maxRetries', () => {
    expect(shouldRetryActor(0, 2)).toBe(true);
    expect(shouldRetryActor(1, 2)).toBe(true);
  });

  it('refuses once attemptIndex reaches maxRetries', () => {
    expect(shouldRetryActor(2, 2)).toBe(false);
    expect(shouldRetryActor(3, 2)).toBe(false);
  });

  it('never retries when maxRetries is 0', () => {
    expect(shouldRetryActor(0, 0)).toBe(false);
  });

  // WIRE-CLI-PARITY-GAP-3 rewire: `denied` (an `action_trust` ledger DENIAL,
  // a NEW failure mode introduced by driving the edit through
  // `terransoul-cli --agent-task`) short-circuits retrying even on attempt 0
  // with a full retry budget remaining — a longer timeout cannot change a
  // trust decision, so retrying is guaranteed-futile.
  it('refuses to retry a denied call even with retry budget remaining', () => {
    expect(shouldRetryActor(0, 2, { denied: true })).toBe(false);
    expect(shouldRetryActor(0, 5, { denied: true })).toBe(false);
  });

  it('is unaffected by an explicit denied:false (matches the default)', () => {
    expect(shouldRetryActor(0, 2, { denied: false })).toBe(true);
  });

  it('defaults to non-denied behavior when the options object is omitted (backward compatible)', () => {
    expect(shouldRetryActor(0, 2)).toBe(true);
    expect(shouldRetryActor(2, 2)).toBe(false);
  });
});

describe('computeTrailingExhaustionStreak', () => {
  it('is zero on an empty or all-genuine history', () => {
    expect(computeTrailingExhaustionStreak([])).toBe(0);
    expect(computeTrailingExhaustionStreak([{ actor_status: 'edited' }, { actor_status: 'no_change' }])).toBe(0);
  });

  it('counts only the TRAILING consecutive exhausted entries', () => {
    const records = [
      { actor_status: 'actor_exhausted_retries' }, // not trailing — broken by the entry below
      { actor_status: 'edited' },
      { actor_status: 'actor_exhausted_retries' },
      { actor_status: 'actor_exhausted_retries' },
    ];
    expect(computeTrailingExhaustionStreak(records)).toBe(2);
  });

  it('counts the full history when every entry is exhausted', () => {
    const records = Array.from({ length: 4 }, () => ({ actor_status: 'actor_exhausted_retries' }));
    expect(computeTrailingExhaustionStreak(records)).toBe(4);
  });

  it('tolerates missing actor_status fields (legacy pre-fix records) as genuine', () => {
    expect(computeTrailingExhaustionStreak([{ total_0_100: 40 }])).toBe(0);
  });
});

describe('filterGenuineIterationsForStopConditions', () => {
  const nine = (v) => Array.from({ length: 9 }, () => ({ score: v }));

  it('maps a genuine record into the {iter,total,perView} shape evaluateStopConditions expects', () => {
    const out = filterGenuineIterationsForStopConditions([
      { iter: 1, total_0_100: 40, per_view: nine(4), actor_status: 'edited' },
    ]);
    expect(out).toEqual([{ iter: 1, total: 40, perView: nine(4).map((v) => v.score) }]);
  });

  it('excludes actor_exhausted_retries entries entirely', () => {
    const out = filterGenuineIterationsForStopConditions([
      { iter: 1, total_0_100: 40, per_view: nine(4), actor_status: 'edited' },
      { iter: 2, total_0_100: 999, per_view: nine(99), actor_status: 'actor_exhausted_retries' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].iter).toBe(1);
  });

  it('treats a record with no actor_status field as genuine (legacy history)', () => {
    const out = filterGenuineIterationsForStopConditions([{ iter: 1, total_0_100: 40, per_view: nine(4) }]);
    expect(out).toHaveLength(1);
  });

  it('returns [] for a non-array input', () => {
    expect(filterGenuineIterationsForStopConditions(null)).toEqual([]);
    expect(filterGenuineIterationsForStopConditions(undefined)).toEqual([]);
  });
});

describe('REGRESSION: mixed genuine/actor_exhausted_retries history feeds the FROZEN evaluateStopConditions honestly', () => {
  const nine = (v) => Array.from({ length: 9 }, () => ({ score: v }));
  const stopCfg = { viewThreshold: 8, patience: 3, budget: 12 };

  // Reproduces the exact shape of LESSON BOEING-747-ACTOR-RETRY-1's root
  // cause: 3 genuine non-improving iterations followed by actor-timeout
  // iterations that must NOT be allowed to push the stall streak to 3 (the
  // committed bug did exactly that, on 4 consecutive timeouts).
  it('actor_exhausted_retries iterations do NOT advance the stall streak', () => {
    const history = [
      { iter: 1, total_0_100: 40, per_view: nine(4), actor_status: 'edited' },
      { iter: 2, total_0_100: 38, per_view: nine(3.8), actor_status: 'edited' }, // non-improving #1 (genuine)
      { iter: 3, total_0_100: 39, per_view: nine(3.9), actor_status: 'edited' }, // non-improving #2 (genuine)
      // Four straight infra failures — the historical bug's exact scenario.
      { iter: 4, total_0_100: 39, per_view: nine(3.9), actor_status: 'actor_exhausted_retries' },
      { iter: 5, total_0_100: 39, per_view: nine(3.9), actor_status: 'actor_exhausted_retries' },
      { iter: 6, total_0_100: 39, per_view: nine(3.9), actor_status: 'actor_exhausted_retries' },
      { iter: 7, total_0_100: 39, per_view: nine(3.9), actor_status: 'actor_exhausted_retries' },
    ];

    const filtered = filterGenuineIterationsForStopConditions(history);
    // Only the 3 genuine iterations survive the filter.
    expect(filtered).toHaveLength(3);

    const result = evaluateStopConditions(filtered, stopCfg);
    // BUG (pre-fix) would have seen 6 non-improving iterations (2-7) and
    // fired `stall` at patience=3. Correctly filtered, only 2 non-improving
    // genuine iterations (2, 3) exist — stall must NOT fire yet.
    expect(result.consecutiveNonImproving).toBe(2);
    expect(result.stop).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('stall'))).toBe(false);
  });

  it('a genuine iteration AFTER the exhausted run resumes the streak correctly (not reset by the exclusion)', () => {
    const history = [
      { iter: 1, total_0_100: 40, per_view: nine(4), actor_status: 'edited' },
      { iter: 2, total_0_100: 38, per_view: nine(3.8), actor_status: 'edited' },
      { iter: 3, total_0_100: 39, per_view: nine(3.9), actor_status: 'actor_exhausted_retries' },
      { iter: 4, total_0_100: 37, per_view: nine(3.7), actor_status: 'edited' }, // 3rd genuine non-improving
    ];
    const result = evaluateStopConditions(filterGenuineIterationsForStopConditions(history), stopCfg);
    expect(result.consecutiveNonImproving).toBe(2); // iter 2 and iter 4 (iter 3 excluded, not counted at all)
    expect(result.stop).toBe(false);
  });

  it('genuine iterations alone still correctly trigger a real stall (the fix does not mask an actual plateau)', () => {
    const history = [
      { iter: 1, total_0_100: 40, per_view: nine(4), actor_status: 'edited' },
      { iter: 2, total_0_100: 38, per_view: nine(3.8), actor_status: 'edited' },
      { iter: 3, total_0_100: 39, per_view: nine(3.9), actor_status: 'no_change' },
      { iter: 4, total_0_100: 39, per_view: nine(3.9), actor_status: 'contract_failed' },
    ];
    const result = evaluateStopConditions(filterGenuineIterationsForStopConditions(history), stopCfg);
    expect(result.stop).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('stall'))).toBe(true);
  });
});
