// Tests for the BRU-3 best-of-N judge-once PURE primitives
// (lib/best-of-n-judge-once.mjs): config loading (env > seed > DISABLED
// defaults, fail-open), the free filter cascade, novelty, and survivor
// selection (prefer novel > first).
import { describe, expect, it } from 'vitest';
import {
  CONFIG_ANCHOR,
  CONFIG_JSON_MARKER,
  DEFAULT_ELITES_CAP,
  DEFAULT_ENABLED,
  DEFAULT_N,
  DEFAULT_USE_ELITES,
  ENV_VAR,
  MAX_N,
  evaluateCandidateEdit,
  loadBestOfNJudgeOnceConfig,
  normalizeBestOfNJudgeOnceConfig,
  parseBestOfNJudgeOnceConfig,
  recentRejectedShas,
  selectSurvivor,
} from './best-of-n-judge-once.mjs';

const okValidate = () => ({ ok: true });
const okSmoke = () => ({ ok: true });

describe('config loading (env > seed > DISABLED defaults)', () => {
  const seedRow = `${CONFIG_ANCHOR}: docs. ${CONFIG_JSON_MARKER} {"enabled": true, "n": 4, "use_elites": true, "elites_cap": 8} -- fail-open`;

  it('DEFAULT is DISABLED (bare runs stay byte-identical)', () => {
    expect(DEFAULT_ENABLED).toBe(false);
    const cfg = loadBestOfNJudgeOnceConfig({
      env: {},
      readFileSyncFn: () => {
        throw new Error('missing');
      },
    });
    expect(cfg).toEqual({
      enabled: false,
      n: DEFAULT_N,
      useElites: DEFAULT_USE_ELITES,
      elitesCap: DEFAULT_ELITES_CAP,
      source: 'default',
    });
  });

  it('parses the seed row', () => {
    const cfg = loadBestOfNJudgeOnceConfig({ env: {}, readFileSyncFn: () => seedRow });
    expect(cfg).toEqual({ enabled: true, n: 4, useElites: true, elitesCap: 8, source: 'seed' });
  });

  it('env var overrides the seed row', () => {
    const cfg = loadBestOfNJudgeOnceConfig({
      env: { [ENV_VAR]: '{"enabled": true, "n": 2}' },
      readFileSyncFn: () => seedRow,
    });
    expect(cfg).toEqual({ enabled: true, n: 2, useElites: DEFAULT_USE_ELITES, elitesCap: DEFAULT_ELITES_CAP, source: 'env' });
  });

  it('malformed env falls through to seed; out-of-range seed to defaults', () => {
    expect(loadBestOfNJudgeOnceConfig({ env: { [ENV_VAR]: '{oops' }, readFileSyncFn: () => seedRow }).source).toBe('seed');
    const bad = `${CONFIG_ANCHOR} .. ${CONFIG_JSON_MARKER} {"enabled": true, "n": 99}`;
    expect(loadBestOfNJudgeOnceConfig({ env: {}, readFileSyncFn: () => bad }).source).toBe('default');
  });

  it('normalize rejects malformed shapes and clamps via validation', () => {
    expect(normalizeBestOfNJudgeOnceConfig(null)).toBeNull();
    expect(normalizeBestOfNJudgeOnceConfig([])).toBeNull();
    expect(normalizeBestOfNJudgeOnceConfig({ enabled: 'yes' })).toBeNull();
    expect(normalizeBestOfNJudgeOnceConfig({ n: 0 })).toBeNull();
    expect(normalizeBestOfNJudgeOnceConfig({ n: MAX_N + 1 })).toBeNull();
    expect(normalizeBestOfNJudgeOnceConfig({ elites_cap: 0 })).toBeNull();
    expect(parseBestOfNJudgeOnceConfig('no anchor')).toBeNull();
    expect(parseBestOfNJudgeOnceConfig(7)).toBeNull();
  });
});

describe('recentRejectedShas', () => {
  it('extracts distinct trailing shas from the ledger shape', () => {
    const ledger = [
      { rejected_sha256: 'a' },
      { rejected_sha256: 'b' },
      { rejected_sha256: 'a' },
      { rejected_sha256: null },
      {},
      { rejected_sha256: 'c' },
    ];
    expect(recentRejectedShas(ledger)).toEqual(['a', 'b', 'c']);
    expect(recentRejectedShas(ledger, 2)).toEqual(['b', 'c']);
    expect(recentRejectedShas(undefined)).toEqual([]);
  });
});

describe('evaluateCandidateEdit — free filter cascade', () => {
  const base = {
    source: 'export function buildPlane(THREE) { return new THREE.Group(); }',
    sha: 'sha-new',
    status: 'edited',
    incumbentSha: 'sha-incumbent',
    rejectedShas: ['sha-rejected'],
    validateFn: okValidate,
    smokeFn: okSmoke,
  };

  it('a genuine novel edit passes and is novel', () => {
    expect(evaluateCandidateEdit(base)).toEqual({ pass: true, novel: true, reasons: [] });
  });

  it('status filter: non-edited outcomes are filtered with the status as reason', () => {
    for (const status of ['no_change', 'contract_failed', 'runtime_failed', 'actor_exhausted_retries']) {
      const r = evaluateCandidateEdit({ ...base, status });
      expect(r.pass).toBe(false);
      expect(r.reasons[0]).toContain(status);
    }
  });

  it('contract filter: a validator rejection filters with the violations', () => {
    const r = evaluateCandidateEdit({
      ...base,
      validateFn: () => ({ ok: false, violations: ['bad token'] }),
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain('contract: bad token');
  });

  it('contract filter: a throwing validator fails closed (filtered, not crashed)', () => {
    const r = evaluateCandidateEdit({
      ...base,
      validateFn: () => {
        throw new Error('boom');
      },
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain('boom');
  });

  it('runtime filter: a smoke failure filters with the error', () => {
    const r = evaluateCandidateEdit({ ...base, smokeFn: () => ({ ok: false, error: 'ReferenceError: x' }) });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain('runtime: ReferenceError: x');
  });

  it('missing source is filtered', () => {
    const r = evaluateCandidateEdit({ ...base, source: null });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain('source');
  });

  it('novelty is SOFT: sha == incumbent still passes but is not novel', () => {
    const r = evaluateCandidateEdit({ ...base, sha: 'sha-incumbent' });
    expect(r.pass).toBe(true);
    expect(r.novel).toBe(false);
    expect(r.reasons[0]).toContain('incumbent');
  });

  it('novelty is SOFT: a recently rejected sha still passes but is not novel', () => {
    const r = evaluateCandidateEdit({ ...base, sha: 'sha-rejected' });
    expect(r.pass).toBe(true);
    expect(r.novel).toBe(false);
    expect(r.reasons[0]).toContain('rejected');
  });

  it('cascade order: status is checked before contract/runtime (filters never even run)', () => {
    let called = 0;
    const spyValidate = () => {
      called += 1;
      return { ok: true };
    };
    evaluateCandidateEdit({ ...base, status: 'no_change', validateFn: spyValidate });
    expect(called).toBe(0);
  });
});

describe('selectSurvivor — prefer novel > first', () => {
  it('picks the first NOVEL survivor over an earlier non-novel one', () => {
    const sel = selectSurvivor([
      { pass: true, novel: false },
      { pass: false, novel: false },
      { pass: true, novel: true },
    ]);
    expect(sel).toEqual({ index: 2, novel: true });
  });

  it('falls back to the FIRST survivor when none is novel', () => {
    const sel = selectSurvivor([
      { pass: false, novel: false },
      { pass: true, novel: false },
      { pass: true, novel: false },
    ]);
    expect(sel).toEqual({ index: 1, novel: false });
  });

  it('no survivor => index -1', () => {
    expect(selectSurvivor([{ pass: false, novel: false }])).toEqual({ index: -1, novel: false });
    expect(selectSurvivor([])).toEqual({ index: -1, novel: false });
    expect(selectSurvivor(undefined)).toEqual({ index: -1, novel: false });
  });
});
