// Tests for the BRU-6 flatline health-check (lib/flatline-health.mjs): pure
// streak detection + config loading, plus a SOURCE-SHAPE guard asserting the
// loop-runner actually wires the detector (mirrors
// loop-runner-actor-sections.test.mjs's precedent — a pure module whose call
// site was never wired is invisible to unit tests of the module itself).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_ANCHOR,
  CONFIG_JSON_MARKER,
  DEFAULT_ENABLED,
  DEFAULT_THRESHOLD,
  ENV_VAR,
  detectFlatline,
  flatlineItersFromRecords,
  loadFlatlineHealthConfig,
  normalizeFlatlineHealthConfig,
  parseFlatlineHealthConfig,
} from './flatline-health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Build a within-noise, sha-unchanged row. */
const flat = (status = 'no_change') => ({ delta: 0.05, sha: 'aaa', status });

describe('detectFlatline — streak counting', () => {
  it('fires at exactly the threshold', () => {
    // 7 rows: row 0 can never qualify (no previous), rows 1..6 all flat = streak 6.
    const rows = [{ delta: null, sha: 'aaa', status: 'edited' }, ...Array.from({ length: 6 }, () => flat())];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 6 });
    expect(r.flatline).toBe(true);
    expect(r.streak).toBe(6);
    expect(r.reason).toContain('6 consecutive');
    expect(r.reason).toContain('unchanged candidate sha');
    expect(r.reason).toContain('no_change x6');
  });

  it('below threshold: reports the streak but does not fire', () => {
    const rows = [{ delta: null, sha: 'aaa', status: 'edited' }, ...Array.from({ length: 3 }, () => flat())];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 6 });
    expect(r.flatline).toBe(false);
    expect(r.streak).toBe(3);
    expect(r.reason).toBeNull();
  });

  it('mixes statuses into the reason summary', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      flat('no_change'),
      flat('actor_exhausted_retries'),
      flat('no_change'),
    ];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 3 });
    expect(r.flatline).toBe(true);
    expect(r.reason).toContain('no_change x2');
    expect(r.reason).toContain('actor_exhausted_retries x1');
  });

  it('the first row never qualifies (no previous sha/delta to compare)', () => {
    const r = detectFlatline({ recentIters: [flat()], epsilon: 1, threshold: 1 });
    expect(r.flatline).toBe(false);
    expect(r.streak).toBe(0);
  });

  it('empty/absent input is a zero streak', () => {
    expect(detectFlatline({ recentIters: [], epsilon: 1, threshold: 1 }).streak).toBe(0);
    expect(detectFlatline({ epsilon: 1, threshold: 1 }).flatline).toBe(false);
  });
});

describe('detectFlatline — resets', () => {
  it('a sha change resets the streak', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      flat(),
      flat(),
      { delta: 0.02, sha: 'bbb', status: 'edited' }, // within noise but sha CHANGED — resets
      { delta: 0.01, sha: 'bbb', status: 'no_change' },
      { delta: 0.03, sha: 'bbb', status: 'no_change' },
    ];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 2 });
    expect(r.streak).toBe(2); // only the two trailing sha=bbb-unchanged rows
    expect(r.flatline).toBe(true);
  });

  it('a delta above epsilon resets the streak', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      flat(),
      flat(),
      { delta: 2.5, sha: 'aaa', status: 'no_change' }, // sha unchanged but delta beyond eps — resets
      flat(),
    ];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 1 });
    expect(r.streak).toBe(1);
  });

  it('a null delta resets the streak (cannot be within-noise evidence)', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      flat(),
      { delta: null, sha: 'aaa', status: 'no_change' },
      flat(),
    ];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 1 });
    expect(r.streak).toBe(1);
  });

  it('a missing sha resets the streak', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      flat(),
      { delta: 0.1, sha: null, status: 'no_change' },
      { delta: 0.1, sha: null, status: 'no_change' },
    ];
    const r = detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 1 });
    expect(r.streak).toBe(0);
  });

  it('delta exactly at epsilon still counts as within noise', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      { delta: 0.4, sha: 'aaa', status: 'no_change' },
    ];
    expect(detectFlatline({ recentIters: rows, epsilon: 0.4, threshold: 1 }).flatline).toBe(true);
  });

  it('non-finite epsilon is treated as 0 (only exact-zero deltas qualify)', () => {
    const rows = [
      { delta: null, sha: 'aaa', status: 'edited' },
      { delta: 0, sha: 'aaa', status: 'no_change' },
      { delta: 0.1, sha: 'aaa', status: 'no_change' },
    ];
    expect(detectFlatline({ recentIters: rows, epsilon: null, threshold: 1 }).streak).toBe(0);
    expect(detectFlatline({ recentIters: rows.slice(0, 2), epsilon: null, threshold: 1 }).streak).toBe(1);
  });
});

describe('flatlineItersFromRecords', () => {
  it('maps loadHistory-shaped records to {delta, sha, status} rows', () => {
    const rows = flatlineItersFromRecords([
      { total_0_100: 40, plane_sha256: 'aaa', actor_status: 'edited' },
      { total_0_100: 40.05, plane_sha256: 'aaa', actor_status: 'no_change' },
      { total_0_100: 43, plane_sha256: 'bbb' },
    ]);
    expect(rows).toEqual([
      { delta: null, sha: 'aaa', status: 'edited' },
      { delta: 0.05, sha: 'aaa', status: 'no_change' },
      { delta: 2.95, sha: 'bbb', status: null },
    ]);
  });

  it('non-finite totals yield null deltas on both sides', () => {
    const rows = flatlineItersFromRecords([
      { total_0_100: null, plane_sha256: 'aaa' },
      { total_0_100: 40, plane_sha256: 'aaa' },
      { total_0_100: 40, plane_sha256: 'aaa' },
    ]);
    expect(rows[1].delta).toBeNull();
    expect(rows[2].delta).toBe(0);
  });

  it('tolerates a non-array input', () => {
    expect(flatlineItersFromRecords(undefined)).toEqual([]);
  });
});

describe('config loading (env > seed > defaults, fail-open)', () => {
  const seedRow = `${CONFIG_ANCHOR}: blah blah. ${CONFIG_JSON_MARKER} {"enabled": true, "threshold": 9} -- fails open`;

  it('defaults when neither env nor seed provide the row', () => {
    const cfg = loadFlatlineHealthConfig({
      env: {},
      readFileSyncFn: () => {
        throw new Error('missing');
      },
    });
    expect(cfg).toEqual({ enabled: DEFAULT_ENABLED, threshold: DEFAULT_THRESHOLD, source: 'default' });
  });

  it('parses the seed row', () => {
    const cfg = loadFlatlineHealthConfig({ env: {}, readFileSyncFn: () => seedRow });
    expect(cfg).toEqual({ enabled: true, threshold: 9, source: 'seed' });
  });

  it('env var overrides the seed row', () => {
    const cfg = loadFlatlineHealthConfig({
      env: { [ENV_VAR]: '{"enabled": false, "threshold": 3}' },
      readFileSyncFn: () => seedRow,
    });
    expect(cfg).toEqual({ enabled: false, threshold: 3, source: 'env' });
  });

  it('a malformed env payload falls through to the seed row', () => {
    const cfg = loadFlatlineHealthConfig({ env: { [ENV_VAR]: '{nope' }, readFileSyncFn: () => seedRow });
    expect(cfg.source).toBe('seed');
  });

  it('an out-of-range seed payload falls through to defaults', () => {
    const bad = `${CONFIG_ANCHOR} ... ${CONFIG_JSON_MARKER} {"enabled": true, "threshold": 0}`;
    const cfg = loadFlatlineHealthConfig({ env: {}, readFileSyncFn: () => bad });
    expect(cfg.source).toBe('default');
  });

  it('partial payloads inherit the defaults for missing keys', () => {
    expect(normalizeFlatlineHealthConfig({ threshold: 4 })).toEqual({ enabled: DEFAULT_ENABLED, threshold: 4 });
    expect(normalizeFlatlineHealthConfig({ enabled: false })).toEqual({ enabled: false, threshold: DEFAULT_THRESHOLD });
  });

  it('rejects malformed payload shapes', () => {
    expect(normalizeFlatlineHealthConfig(null)).toBeNull();
    expect(normalizeFlatlineHealthConfig([])).toBeNull();
    expect(normalizeFlatlineHealthConfig({ enabled: 'yes' })).toBeNull();
    expect(normalizeFlatlineHealthConfig({ threshold: 2.5 })).toBeNull();
    expect(parseFlatlineHealthConfig('no anchor here')).toBeNull();
    expect(parseFlatlineHealthConfig(42)).toBeNull();
  });
});

describe('source shape: the loop-runner wires the flatline health-check', () => {
  const runnerSource = readFileSync(path.join(HERE, '..', 'loop-runner-terransoul.mjs'), 'utf8');

  it('imports the detector from lib/flatline-health.mjs', () => {
    expect(runnerSource).toContain("from './lib/flatline-health.mjs'");
  });

  it('calls detectFlatline with the configured threshold', () => {
    expect(runnerSource).toContain('detectFlatline(');
    expect(runnerSource).toContain('loadFlatlineHealthConfig(');
    expect(runnerSource).toContain('flatlineItersFromRecords(');
  });

  it('prints the loud FLATLINE HEALTH-CHECK line on detection', () => {
    expect(runnerSource).toContain('FLATLINE HEALTH-CHECK:');
    expect(runnerSource).toMatch(/RESTART/i);
  });
});
