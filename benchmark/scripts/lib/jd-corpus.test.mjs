// SPDX-License-Identifier: MIT
// MILLION-RESUME-BENCH: generator determinism, histogram bands, gold
// densities, and JD gold-predicate unit tests.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AREAS,
  AREA_POOLS,
  DEFAULT_SEED,
  LANG_WEIGHTS,
  SKILL_SURFACES,
  TEXT_MAX,
  TEXT_MIN,
  buildResume,
  computeGold,
  matchesJd,
  seniorityForYears,
} from '../jd-corpus.mjs';
import { JD_QUERIES } from '../jd-queries.mjs';

describe('generator determinism', () => {
  it('same seed -> identical first 5 resumes (meta AND text)', () => {
    for (let i = 0; i < 5; i += 1) {
      const a = buildResume(i, DEFAULT_SEED);
      const b = buildResume(i, DEFAULT_SEED);
      expect(b).toEqual(a);
      // Byte-for-byte on the serialized session line (what lands in resumes.jsonl).
      expect(JSON.stringify(b.session)).toBe(JSON.stringify(a.session));
    }
  });

  it('different seeds -> different corpus', () => {
    const a = buildResume(0, DEFAULT_SEED);
    const b = buildResume(0, DEFAULT_SEED + 1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('metaOnly agrees with the full build (draw-order contract)', () => {
    for (let i = 0; i < 50; i += 1) {
      const full = buildResume(i, DEFAULT_SEED);
      const metaOnly = buildResume(i, DEFAULT_SEED, { metaOnly: true });
      expect(metaOnly.meta).toEqual(full.meta);
    }
  });

  it('row N is independent of how many rows precede it (resume contract)', () => {
    // an internal work item: a resumed run re-derives the tail purely from indices.
    const later = buildResume(4321, DEFAULT_SEED);
    expect(later.meta.id).toBe('res-4321');
    expect(later).toEqual(buildResume(4321, DEFAULT_SEED));
  });
});

describe('resume shape', () => {
  const SAMPLE = 500;

  it('renders 400-900 chars, valid date, 4-8 skills, session fields', () => {
    for (let i = 0; i < SAMPLE; i += 1) {
      const { meta, session } = buildResume(i, DEFAULT_SEED);
      expect(session.session_id).toBe(`res-${i}`);
      expect(session.turn_count).toBe(1);
      expect(session.text.length).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(session.text.length).toBeLessThanOrEqual(TEXT_MAX);
      expect(session.date).toMatch(/^202[456]-\d{2}-\d{2}$/);
      expect(meta.skills.length).toBeGreaterThanOrEqual(4);
      expect(meta.skills.length).toBeLessThanOrEqual(8);
      expect(new Set(meta.skills).size).toBe(meta.skills.length); // no dupes
      expect(meta.years).toBeGreaterThanOrEqual(1);
      expect(meta.years).toBeLessThanOrEqual(15);
      expect(meta.seniority).toBe(seniorityForYears(meta.years));
      // Every skill id resolves to a Latin-script surface form present in the text.
      for (const sid of meta.skills) {
        expect(SKILL_SURFACES[sid], `missing surface for ${sid}`).toBeTruthy();
        expect(session.text).toContain(SKILL_SURFACES[sid]);
      }
    }
  });
});

describe('histograms (10K sample)', () => {
  const N = 10000;
  const langHist = {};
  const areaHist = {};
  for (let i = 0; i < N; i += 1) {
    const { meta } = buildResume(i, DEFAULT_SEED, { metaOnly: true });
    langHist[meta.lang] = (langHist[meta.lang] ?? 0) + 1;
    areaHist[meta.area] = (areaHist[meta.area] ?? 0) + 1;
  }

  it('language mix tracks the configured weights (±3pp)', () => {
    for (const [lang, weight] of LANG_WEIGHTS) {
      const share = (langHist[lang] ?? 0) / N;
      expect(share, `lang ${lang}`).toBeGreaterThan(weight - 0.03);
      expect(share, `lang ${lang}`).toBeLessThan(weight + 0.03);
    }
  });

  it('areas are uniform at 10% each (±2pp)', () => {
    expect(AREAS).toHaveLength(10);
    for (const area of AREAS) {
      const share = (areaHist[area] ?? 0) / N;
      expect(share, `area ${area}`).toBeGreaterThan(0.08);
      expect(share, `area ${area}`).toBeLessThan(0.12);
    }
  });
});

describe('JD gold predicate (matchesJd)', () => {
  const jd = {
    id: 'jd-test', area: 'backend', minYears: 5,
    requiredSkills: ['skill:rust', 'skill:postgresql', 'skill:kubernetes', 'skill:grpc'],
  };
  const base = {
    id: 'res-0', lang: 'en', area: 'backend', years: 7, seniority: 'senior',
    skills: ['skill:rust', 'skill:postgresql', 'skill:java'],
  };

  it('accepts area + >=2 required skills + enough years', () => {
    expect(matchesJd(base, jd)).toBe(true);
  });

  it('rejects on area mismatch', () => {
    expect(matchesJd({ ...base, area: 'devops' }, jd)).toBe(false);
  });

  it('rejects with only 1 required skill present', () => {
    expect(matchesJd({ ...base, skills: ['skill:rust', 'skill:java'] }, jd)).toBe(false);
  });

  it('accepts with exactly 2 required skills present', () => {
    expect(matchesJd({ ...base, skills: ['skill:kubernetes', 'skill:grpc'] }, jd)).toBe(true);
  });

  it('rejects below minYears (boundary: years == minYears passes)', () => {
    expect(matchesJd({ ...base, years: 4 }, jd)).toBe(false);
    expect(matchesJd({ ...base, years: 5 }, jd)).toBe(true);
  });

  it('enforces seniorityAtLeast only when the JD sets it', () => {
    const withSen = { ...jd, seniorityAtLeast: 'senior' };
    expect(matchesJd({ ...base, seniority: 'mid' }, withSen)).toBe(false);
    expect(matchesJd({ ...base, seniority: 'senior' }, withSen)).toBe(true);
    expect(matchesJd({ ...base, seniority: 'lead' }, withSen)).toBe(true);
    expect(matchesJd({ ...base, seniority: 'mid' }, jd)).toBe(true); // unset -> ignored
  });

  it('all 3 shipped JDs require skills that exist in their area pool', () => {
    for (const shipped of JD_QUERIES) {
      expect(AREAS).toContain(shipped.area);
      for (const sid of shipped.requiredSkills) {
        expect(AREA_POOLS[shipped.area], `${shipped.id} ${sid}`).toContain(sid);
      }
      expect(shipped.queryText.length).toBeGreaterThan(80);
    }
    // three different positions, three different languages
    expect(new Set(JD_QUERIES.map(jdq => jdq.area)).size).toBe(3);
    expect(new Set(JD_QUERIES.map(jdq => jdq.lang))).toEqual(new Set(['en', 'vi', 'ja']));
  });
});

describe('gold densities (100K sample)', () => {
  // Scale-proportional band: [50, 5000] gold per 100K rows, plus the tuned
  // target of 200-2000 per 1M projected. Calibrated 2026-07-03:
  // en-backend ~146/100K, vi-data-eng ~131/100K, ja-mobile ~107/100K.
  const N = 100000;
  const counts = Object.fromEntries(JD_QUERIES.map(jdq => [jdq.id, 0]));
  for (let i = 0; i < N; i += 1) {
    const { meta } = buildResume(i, DEFAULT_SEED, { metaOnly: true });
    for (const jdq of JD_QUERIES) {
      if (matchesJd(meta, jdq)) counts[jdq.id] += 1;
    }
  }

  it.each(JD_QUERIES.map(jdq => [jdq.id]))('%s density in [50, 5000] per 100K', (jdId) => {
    const per100k = counts[jdId] * (100000 / N);
    expect(per100k).toBeGreaterThanOrEqual(50);
    expect(per100k).toBeLessThanOrEqual(5000);
  });

  it.each(JD_QUERIES.map(jdq => [jdq.id]))('%s projects to 200-2000 gold per 1M', (jdId) => {
    const projected = counts[jdId] * (1000000 / N);
    expect(projected).toBeGreaterThanOrEqual(200);
    expect(projected).toBeLessThanOrEqual(2000);
  });
});

describe('computeGold streaming', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jd-corpus-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('streams meta.jsonl and returns ids, counts, byLang and langOf', async () => {
    const jd = {
      id: 'jd-x', area: 'backend', minYears: 5,
      requiredSkills: ['skill:rust', 'skill:postgresql', 'skill:kubernetes', 'skill:grpc'],
    };
    const rows = [
      { id: 'res-0', lang: 'en', area: 'backend', skills: ['skill:rust', 'skill:grpc'], years: 6, seniority: 'senior' },
      { id: 'res-1', lang: 'vi', area: 'backend', skills: ['skill:rust', 'skill:kubernetes'], years: 9, seniority: 'senior' },
      { id: 'res-2', lang: 'en', area: 'backend', skills: ['skill:rust'], years: 9, seniority: 'senior' }, // 1 skill only
      { id: 'res-3', lang: 'en', area: 'devops', skills: ['skill:rust', 'skill:grpc'], years: 9, seniority: 'senior' }, // wrong area
      { id: 'res-4', lang: 'ja', area: 'backend', skills: ['skill:postgresql', 'skill:grpc'], years: 3, seniority: 'mid' }, // too few years
    ];
    const metaPath = join(dir, 'meta.jsonl');
    writeFileSync(metaPath, `${rows.map(r => JSON.stringify(r)).join('\n')}\n`, 'utf8');

    const result = await computeGold([jd], metaPath);
    expect(result.scanned).toBe(5);
    expect(result.counts['jd-x']).toBe(2);
    expect(result.gold['jd-x']).toEqual(['res-0', 'res-1']);
    expect(result.byLang['jd-x']).toEqual({ en: 1, vi: 1 });
    expect(result.langOf['res-0']).toBe('en');
    expect(result.langOf['res-1']).toBe('vi');
    expect(result.langOf['res-2']).toBeUndefined();
  });
});
