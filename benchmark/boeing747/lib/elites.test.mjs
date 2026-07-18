// Tests for the archive-of-elites parent selection (lib/elites.mjs):
// append/dedupe/cap ordering, deterministic uniform pick, sampling-base
// selection (round 1 always incumbent; k>1 elites with missing-snapshot
// fallback), and fail-open load/save.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ELITES_CAP,
  appendElite,
  loadElites,
  pickElite,
  pickSamplingBase,
  saveElites,
} from './elites.mjs';

const e = (sha, total, iter = 1, p = `/snap/${sha}.js`) => ({ sha, total, iter, path: p });

describe('appendElite — append/dedupe/cap', () => {
  it('appends and keeps the archive sorted by total DESC', () => {
    const a1 = appendElite({ elites: [], entry: e('a', 40) });
    const a2 = appendElite({ elites: a1, entry: e('b', 55) });
    const a3 = appendElite({ elites: a2, entry: e('c', 47) });
    expect(a3.map((x) => x.sha)).toEqual(['b', 'c', 'a']);
  });

  it('dedupes by sha — a re-accept updates the entry instead of duplicating', () => {
    const a1 = appendElite({ elites: [e('a', 40, 1)], entry: e('a', 42, 9) });
    expect(a1).toHaveLength(1);
    expect(a1[0].total).toBe(42);
    expect(a1[0].iter).toBe(9);
  });

  it('caps the archive, dropping the lowest total', () => {
    let arch = [];
    for (const [sha, total] of [['a', 10], ['b', 50], ['c', 30], ['d', 40]]) {
      arch = appendElite({ elites: arch, entry: e(sha, total), cap: 3 });
    }
    expect(arch.map((x) => x.sha)).toEqual(['b', 'd', 'c']); // 'a' (10) dropped
  });

  it('default cap applies and malformed entries/archives are tolerated', () => {
    expect(DEFAULT_ELITES_CAP).toBeGreaterThanOrEqual(1);
    expect(appendElite({ elites: 'nope', entry: e('a', 1) })).toHaveLength(1);
    expect(appendElite({ elites: [], entry: { sha: 'x' } })).toEqual([]);
    expect(appendElite({ elites: [{ bogus: true }, e('a', 5)], entry: e('b', 6) }).map((x) => x.sha)).toEqual([
      'b',
      'a',
    ]);
  });

  it('ties on total prefer the newer iter', () => {
    const arch = appendElite({ elites: [e('a', 50, 2)], entry: e('b', 50, 7) });
    expect(arch.map((x) => x.sha)).toEqual(['b', 'a']);
  });
});

describe('pickElite — deterministic injectable RNG', () => {
  const arch = [e('a', 50), e('b', 40), e('c', 30)];

  it('maps rng() uniformly onto indices', () => {
    expect(pickElite({ elites: arch, rng: () => 0 }).sha).toBe('a');
    expect(pickElite({ elites: arch, rng: () => 0.34 }).sha).toBe('b');
    expect(pickElite({ elites: arch, rng: () => 0.999 }).sha).toBe('c');
  });

  it('empty archive => null; out-of-range rng clamps', () => {
    expect(pickElite({ elites: [] })).toBeNull();
    expect(pickElite({ elites: arch, rng: () => 1.5 }).sha).toBe('c');
    expect(pickElite({ elites: arch, rng: () => -1 }).sha).toBe('a');
    expect(pickElite({ elites: arch, rng: () => NaN }).sha).toBe('a');
  });
});

describe('pickSamplingBase', () => {
  const arch = [e('a', 50, 1, '/snap/a.js'), e('b', 40, 2, '/snap/b.js')];
  const existsYes = () => true;

  it('round 1 ALWAYS edits from the incumbent, even with elites enabled', () => {
    const base = pickSamplingBase({ round: 1, incumbentPath: '/p.js', elites: arch, useElites: true, rng: () => 0, existsFn: existsYes });
    expect(base).toEqual({ kind: 'incumbent', path: '/p.js', elite: null });
  });

  it('round k>1 with use_elites picks an elite snapshot', () => {
    const base = pickSamplingBase({ round: 2, incumbentPath: '/p.js', elites: arch, useElites: true, rng: () => 0.6, existsFn: existsYes });
    expect(base.kind).toBe('elite');
    expect(base.path).toBe('/snap/b.js');
    expect(base.elite.sha).toBe('b');
  });

  it('use_elites off, empty archive, or missing snapshot => incumbent', () => {
    expect(pickSamplingBase({ round: 3, incumbentPath: '/p.js', elites: arch, useElites: false, existsFn: existsYes }).kind).toBe('incumbent');
    expect(pickSamplingBase({ round: 3, incumbentPath: '/p.js', elites: [], useElites: true, existsFn: existsYes }).kind).toBe('incumbent');
    const missing = pickSamplingBase({ round: 2, incumbentPath: '/p.js', elites: arch, useElites: true, rng: () => 0, existsFn: () => false });
    expect(missing).toEqual({ kind: 'incumbent', path: '/p.js', elite: null });
  });

  it('a throwing existsFn fails open to the incumbent', () => {
    const base = pickSamplingBase({
      round: 2,
      incumbentPath: '/p.js',
      elites: arch,
      useElites: true,
      rng: () => 0,
      existsFn: () => {
        throw new Error('io');
      },
    });
    expect(base.kind).toBe('incumbent');
  });
});

describe('loadElites / saveElites — fail-open I/O', () => {
  it('loads a valid archive and filters malformed rows', () => {
    const fsImpl = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify([e('a', 50), { bogus: 1 }, e('b', 'NaN-ish')]),
    };
    expect(loadElites({ elitesPath: '/x/elites.json', fsImpl }).map((x) => x.sha)).toEqual(['a']);
  });

  it('missing/corrupt file or missing path => []', () => {
    expect(loadElites({ elitesPath: '/x.json', fsImpl: { existsSync: () => false, readFileSync: () => '' } })).toEqual([]);
    expect(loadElites({ elitesPath: '/x.json', fsImpl: { existsSync: () => true, readFileSync: () => '{oops' } })).toEqual([]);
    expect(loadElites({})).toEqual([]);
  });

  it('save writes JSON and reports a write failure without throwing', () => {
    const writes = [];
    const okFs = {
      existsSync: () => true,
      mkdirSync: () => {},
      writeFileSync: (p, data) => writes.push([p, data]),
    };
    expect(saveElites({ elitesPath: '/x/elites.json', elites: [e('a', 50)], fsImpl: okFs }).ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1])[0].sha).toBe('a');
    const badFs = {
      existsSync: () => true,
      mkdirSync: () => {},
      writeFileSync: () => {
        throw new Error('disk full');
      },
    };
    const r = saveElites({ elitesPath: '/x/elites.json', elites: [], fsImpl: badFs });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('disk full');
    expect(saveElites({}).ok).toBe(false);
  });
});
