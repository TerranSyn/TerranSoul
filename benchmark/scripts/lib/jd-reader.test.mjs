// SPDX-License-Identifier: MIT
// Vitest units for the chat-pipeline reader mechanics (jd-reader.mjs).

import { describe, expect, it } from 'vitest';
import {
  buildExtractPrompt,
  buildQualifyPrompt,
  buildRankPrompt,
  candidateBlock,
  chunkByTokenBudget,
  estimateTokens,
  mergeRanked,
  parseExtraction,
  parseRankedIds,
  rrfFuseRankings,
  sortByExtraction,
} from './jd-reader.mjs';

const CANDS = [
  { id: 'res-1', text: 'Rust backend engineer, 6 years.' },
  { id: 'res-2', text: 'モバイルアプリエンジニア。Swift 4年。' },
  { id: 'res-3', text: 'Data engineer, Python and Spark, 3 years.' },
];

describe('estimateTokens', () => {
  it('is script-aware: CJK ~1 tok/char, ASCII ~1 tok/4 chars', () => {
    const ja = 'モバイルアプリ開発経験'; // 11 CJK chars -> ~11 tokens
    const en = 'mobile application development'; // 30 ASCII chars -> ~8 tokens
    expect(estimateTokens(ja)).toBeGreaterThanOrEqual(11);
    expect(estimateTokens(en)).toBeLessThanOrEqual(9);
    // The English-biased chars/4 heuristic would call the ja string ~3
    // tokens; the real cost is ~4x that. This gap overflowed the reader
    // ctx on the first live run.
    expect(estimateTokens(ja)).toBeGreaterThan(Math.ceil(ja.length / 4) * 2);
  });
});

describe('chunkByTokenBudget', () => {
  it('splits by estimated-token budget preserving order', () => {
    const budget = estimateTokens(candidateBlock(CANDS[0])) + estimateTokens(candidateBlock(CANDS[1]));
    const batches = chunkByTokenBudget(CANDS, budget);
    expect(batches.length).toBe(2);
    expect(batches[0].map(c => c.id)).toEqual(['res-1', 'res-2']);
    expect(batches[1].map(c => c.id)).toEqual(['res-3']);
  });

  it('never drops an oversized single candidate', () => {
    const batches = chunkByTokenBudget(CANDS, 2);
    expect(batches.length).toBe(3);
    expect(batches.flat().map(c => c.id)).toEqual(['res-1', 'res-2', 'res-3']);
  });
});

describe('prompts', () => {
  it('contain the JD + every candidate id', () => {
    const jd = 'We need a senior engineer with Rust and 5 years experience.';
    for (const prompt of [buildQualifyPrompt(jd, CANDS), buildRankPrompt(jd, CANDS)]) {
      expect(prompt).toContain(jd);
      for (const c of CANDS) expect(prompt).toContain(`[${c.id}]`);
    }
  });

  it('template is generic — no domain vocabulary beyond the JD/resume inputs', () => {
    // AGI purity guard: with neutral inputs, the template itself must not
    // smuggle job areas, skills, languages, or gold markers.
    const jd = 'JD_PLACEHOLDER';
    const neutral = [{ id: 'res-0', text: 'TEXT_PLACEHOLDER' }];
    for (const prompt of [buildQualifyPrompt(jd, neutral), buildRankPrompt(jd, neutral)]) {
      const template = prompt.toLowerCase();
      for (const leak of ['gold', 'backend', 'mobile', 'data-engineering', 'rust', 'swift',
        'python', 'english', 'japanese', 'vietnamese']) {
        expect(template).not.toContain(leak);
      }
    }
  });
});

describe('parseRankedIds', () => {
  const valid = new Set(['res-1', 'res-2', 'res-3']);

  it('prefers a JSON array and filters to valid ids', () => {
    const ids = parseRankedIds('Sure! ["res-3","res-99","res-1"]', valid);
    expect(ids).toEqual(['res-3', 'res-1']);
  });

  it('falls back to token scan preserving order and deduping', () => {
    const ids = parseRankedIds('Best: res-2, then res-1 (res-2 again).', valid);
    expect(ids).toEqual(['res-2', 'res-1']);
  });

  it('returns empty for no parseable ids / empty array', () => {
    expect(parseRankedIds('[]', valid)).toEqual([]);
    expect(parseRankedIds('none qualify', valid)).toEqual([]);
  });
});

describe('rrfFuseRankings', () => {
  it('rewards agreement across passes and breaks ties by tie order', () => {
    const fused = rrfFuseRankings(
      [['res-1', 'res-2', 'res-3'], ['res-2', 'res-1', 'res-3']],
      ['res-1', 'res-2', 'res-3'],
    );
    // res-1 and res-2 tie on 1/(61)+1/(62); tie order puts res-1 first.
    expect(fused).toEqual(['res-1', 'res-2', 'res-3']);
    const fused2 = rrfFuseRankings(
      [['res-2', 'res-1'], ['res-2', 'res-1']],
      ['res-1', 'res-2'],
    );
    expect(fused2).toEqual(['res-2', 'res-1']); // agreement beats tie order
  });
});

describe('extract-then-sort', () => {
  it('parses tolerant extraction lines and drops unknown ids', () => {
    const text = 'res-1 | named_skills_matched=3 | meets_minimums=yes | domain_match=yes\n'
      + 'garbage line\n'
      + 'RES-9 | named_skills_matched=9 | meets_minimums=yes | domain_match=yes\n'
      + 'res-2 | named_skills_matched = 1 | meets_minimums = no | domain_match = YES';
    const parsed = parseExtraction(text, new Set(['res-1', 'res-2']));
    expect(parsed.get('res-1')).toEqual({ skills: 3, minimums: true, domain: true });
    expect(parsed.get('res-2')).toEqual({ skills: 1, minimums: false, domain: true });
    expect(parsed.has('RES-9')).toBe(false);
  });

  it('sorts by domain, minimums, skill count; ties keep tournament order', () => {
    const extraction = new Map([
      ['res-1', { skills: 4, minimums: false, domain: true }], // fails minimum
      ['res-2', { skills: 2, minimums: true, domain: true }],  // gold-shaped
      ['res-3', { skills: 3, minimums: true, domain: true }],  // gold-shaped, more skills
      ['res-4', { skills: 5, minimums: true, domain: false }], // wrong domain
      // res-5 unparsed -> below parsed domain matches, keeps fallback slot
    ]);
    const order = sortByExtraction(
      ['res-1', 'res-2', 'res-3', 'res-4', 'res-5'],
      extraction,
      ['res-1', 'res-2', 'res-3', 'res-4', 'res-5'],
    );
    expect(order).toEqual(['res-3', 'res-2', 'res-1', 'res-4', 'res-5']);
  });

  it('extract prompt is generic and demands the exact line format', () => {
    const prompt = buildExtractPrompt('JD_PLACEHOLDER', [{ id: 'res-0', text: 'TEXT_PLACEHOLDER' }]);
    expect(prompt).toContain('named_skills_matched=N');
    for (const leak of ['gold', 'backend', 'mobile', 'rust', 'swift', 'japanese']) {
      expect(prompt.toLowerCase()).not.toContain(leak);
    }
  });
});

describe('mergeRanked', () => {
  it('reduce order leads, qualified fills, retrieval pads — no duplicates', () => {
    const merged = mergeRanked({
      reduceRanked: ['res-3'],
      qualified: ['res-3', 'res-2'],
      retrievalOrder: ['res-1', 'res-2', 'res-3'],
    });
    expect(merged).toEqual(['res-3', 'res-2', 'res-1']);
  });

  it('reader can demote but never lose retrieval recall (tail padding)', () => {
    const merged = mergeRanked({
      reduceRanked: [],
      qualified: [],
      retrievalOrder: ['res-1', 'res-2'],
    });
    expect(merged).toEqual(['res-1', 'res-2']);
  });
});
