// SPDX-License-Identifier: MIT
// MILLION-RESUME-BENCH: gold.json cache-staleness check fixtures.

import { describe, expect, it } from 'vitest';
import { goldMatchesQueries } from './jd-gold-cache.mjs';

const queries = [{ id: 'jd-en-backend' }, { id: 'jd-vi-data-engineering' }, { id: 'jd-ja-mobile' }];

describe('goldMatchesQueries', () => {
  it('accepts a gold set whose ids exactly match the current queries (any order)', () => {
    const gold = { jds: [{ id: 'jd-ja-mobile' }, { id: 'jd-en-backend' }, { id: 'jd-vi-data-engineering' }] };
    expect(goldMatchesQueries(gold, queries)).toBe(true);
  });

  it('rejects a gold set missing a newly-added query id (the exact bug reproduced 2026-07-09)', () => {
    const staleGold = { jds: [{ id: 'jd-en-backend' }, { id: 'jd-vi-data-engineering' }, { id: 'jd-ja-mobile' }] };
    const withTypoFixture = [...queries, { id: 'jd-en-backend-typo' }];
    expect(goldMatchesQueries(staleGold, withTypoFixture)).toBe(false);
  });

  it('rejects a gold set with extra stale ids no longer in the query list', () => {
    const gold = { jds: [...queries, { id: 'jd-retired-query' }] };
    expect(goldMatchesQueries(gold, queries)).toBe(false);
  });

  it('rejects null, undefined, or malformed gold payloads', () => {
    expect(goldMatchesQueries(null, queries)).toBe(false);
    expect(goldMatchesQueries(undefined, queries)).toBe(false);
    expect(goldMatchesQueries({}, queries)).toBe(false);
    expect(goldMatchesQueries({ jds: 'not-an-array' }, queries)).toBe(false);
  });

  it('handles an empty query list against an empty gold set', () => {
    expect(goldMatchesQueries({ jds: [] }, [])).toBe(true);
  });
});
