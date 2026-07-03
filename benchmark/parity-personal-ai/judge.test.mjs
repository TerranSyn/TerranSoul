/**
 * Regression tests for JUDGE-STABILITY-1 (2026-07-03) — the parity bench's
 * LLM-as-judge median-of-repeats reduction and verdict parsing.
 *
 * Pure-logic only (no Ollama, no network): pins the mechanism chosen after
 * per-prompt forensics showed single-call judge variance dominated
 * run-to-run head-to-head quality drift.
 */
import { describe, it, expect } from 'vitest';
import { medianScore, parseJudgeVerdict } from './judge.mjs';

describe('medianScore (JUDGE-STABILITY-1 median-of-repeats reduction)', () => {
  it('odd count: returns the middle value', () => {
    expect(medianScore([8, 10, 9])).toBe(9);
    expect(medianScore([5, 5, 10])).toBe(5);
  });

  it('a single outlier repeat cannot move the verdict (the observed 8-vs-6-vs-5 failure mode)', () => {
    // Judge draws like the sm-2 forensics: two consistent scores + one harsh outlier.
    expect(medianScore([8, 8, 5])).toBe(8);
    expect(medianScore([6, 8, 8])).toBe(8);
    expect(medianScore([10, 10, 2])).toBe(10);
  });

  it('even count (a repeat failed): mean of the two middle values', () => {
    expect(medianScore([8, 10])).toBe(9);
    expect(medianScore([7, 8, 9, 10])).toBe(8.5);
  });

  it('single valid score passes through', () => {
    expect(medianScore([7])).toBe(7);
  });

  it('empty input returns the -1 judge-failed sentinel', () => {
    expect(medianScore([])).toBe(-1);
  });

  it('ignores non-finite garbage instead of corrupting the median', () => {
    expect(medianScore([8, NaN, 9, Infinity, 10])).toBe(9);
  });

  it('does not mutate the caller\'s array', () => {
    const scores = [10, 8, 9];
    medianScore(scores);
    expect(scores).toEqual([10, 8, 9]);
  });
});

describe('parseJudgeVerdict', () => {
  it('parses the strict JSON verdict shape', () => {
    expect(parseJudgeVerdict('{"score": 9, "reason": "accurate recall"}'))
      .toEqual({ score: 9, reason: 'accurate recall' });
  });

  it('parses a verdict wrapped in markdown fences / prose', () => {
    const out = 'Here is my verdict:\n```json\n{"score": 7, "reason": "misses one item"}\n```';
    expect(parseJudgeVerdict(out)).toEqual({ score: 7, reason: 'misses one item' });
  });

  it('falls back to a bare number when no JSON object is present', () => {
    const v = parseJudgeVerdict('I would rate this 8 out of 10.');
    expect(v.score).toBe(8);
  });

  it('returns the -1 sentinel when nothing parseable is found', () => {
    const v = parseJudgeVerdict('no verdict here');
    expect(v.score).toBe(-1);
    expect(v.reason).toContain('Could not parse');
  });
});
