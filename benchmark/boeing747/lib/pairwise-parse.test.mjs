import { describe, expect, it } from 'vitest';
import {
  cappedMagnitudeA,
  confidenceRank,
  isConcreteEvidence,
  MIN_EVIDENCE_CHARS,
  parseComparisonsReply,
  parseOrder,
  rawMagnitudeA,
  reconcileOrders,
  reconcilePanel,
  signedMagnitude,
  VALID_VERDICTS,
} from './pairwise-parse.mjs';

// A concrete, non-vacuous winning-side evidence string (>= MIN_EVIDENCE_CHARS,
// no lack-statement) so the evidence cap survives when we want an uncapped |2|.
const CONCRETE = 'four nacelles hung under the swept wings on visible pylons';

describe('rawMagnitudeA', () => {
  it('maps every scored verdict to its A-relative magnitude', () => {
    expect(rawMagnitudeA('A_much_better')).toBe(2);
    expect(rawMagnitudeA('A_better')).toBe(1);
    expect(rawMagnitudeA('tie')).toBe(0);
    expect(rawMagnitudeA('B_better')).toBe(-1);
    expect(rawMagnitudeA('B_much_better')).toBe(-2);
  });
  it('is null for NA, unknown, and non-string verdicts', () => {
    expect(rawMagnitudeA('NA')).toBeNull();
    expect(rawMagnitudeA('sideways')).toBeNull();
    expect(rawMagnitudeA(undefined)).toBeNull();
    expect(rawMagnitudeA(2)).toBeNull();
  });
  it('exposes the full verdict vocabulary', () => {
    expect(VALID_VERDICTS).toContain('NA');
    expect(VALID_VERDICTS).toHaveLength(6);
  });
});

describe('signedMagnitude (candidate-relative, no cap)', () => {
  it('AB order (candidate=A) uses the verdict directly', () => {
    expect(signedMagnitude('A_much_better', 'A')).toBe(2);
    expect(signedMagnitude('A_better', 'A')).toBe(1);
    expect(signedMagnitude('tie', 'A')).toBe(0);
    expect(signedMagnitude('B_better', 'A')).toBe(-1);
    expect(signedMagnitude('B_much_better', 'A')).toBe(-2);
  });
  it('BA order (candidate=B) inverts the verdict', () => {
    expect(signedMagnitude('A_much_better', 'B')).toBe(-2);
    expect(signedMagnitude('A_better', 'B')).toBe(-1);
    expect(signedMagnitude('tie', 'B')).toBe(0);
    expect(signedMagnitude('B_better', 'B')).toBe(1);
    expect(signedMagnitude('B_much_better', 'B')).toBe(2);
  });
  it('is null for NA in either slot', () => {
    expect(signedMagnitude('NA', 'A')).toBeNull();
    expect(signedMagnitude('NA', 'B')).toBeNull();
  });
});

describe('confidenceRank', () => {
  it('orders low < medium < high, unknown = low', () => {
    expect(confidenceRank('low')).toBe(0);
    expect(confidenceRank('medium')).toBe(1);
    expect(confidenceRank('high')).toBe(2);
    expect(confidenceRank('bogus')).toBe(0);
    expect(confidenceRank(undefined)).toBe(0);
  });
});

describe('isConcreteEvidence', () => {
  it('accepts a long, non-vacuous cited feature', () => {
    expect(isConcreteEvidence(CONCRETE)).toBe(true);
  });
  it('rejects a too-short string', () => {
    expect(CONCRETE.length).toBeGreaterThanOrEqual(MIN_EVIDENCE_CHARS);
    expect(isConcreteEvidence('a'.repeat(MIN_EVIDENCE_CHARS - 1))).toBe(false);
    expect(isConcreteEvidence('engines')).toBe(false);
    expect(isConcreteEvidence('')).toBe(false);
    expect(isConcreteEvidence('   ')).toBe(false);
  });
  it('rejects evidence that states the side LACKS the feature', () => {
    expect(isConcreteEvidence('no engines are visible anywhere on this render')).toBe(false);
    expect(isConcreteEvidence('the upper-deck hump is missing entirely from the model')).toBe(false);
    expect(isConcreteEvidence('lacks any tail surfaces at the rear of the fuselage')).toBe(false);
    expect(isConcreteEvidence('the wing is not present in this camera angle at all')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isConcreteEvidence(null)).toBe(false);
    expect(isConcreteEvidence(42)).toBe(false);
  });
});

describe('cappedMagnitudeA (evidence + confidence cap)', () => {
  it('keeps |2| when winning evidence is concrete AND confidence >= medium', () => {
    expect(
      cappedMagnitudeA({ verdict: 'A_much_better', evidence_a: CONCRETE, confidence: 'high' }),
    ).toBe(2);
    expect(
      cappedMagnitudeA({ verdict: 'A_much_better', evidence_a: CONCRETE, confidence: 'medium' }),
    ).toBe(2);
  });
  it('downgrades |2|->|1| when confidence is low', () => {
    expect(
      cappedMagnitudeA({ verdict: 'A_much_better', evidence_a: CONCRETE, confidence: 'low' }),
    ).toBe(1);
  });
  it('downgrades |2|->|1| when winning evidence is short or vacuous', () => {
    expect(
      cappedMagnitudeA({ verdict: 'A_much_better', evidence_a: 'engines', confidence: 'high' }),
    ).toBe(1);
    expect(
      cappedMagnitudeA({
        verdict: 'A_much_better',
        evidence_a: 'there are no engines at all here',
        confidence: 'high',
      }),
    ).toBe(1);
  });
  it('is symmetric for the B winning side', () => {
    // B_much_better: the WINNING side is B, so evidence_b is what must be concrete.
    expect(
      cappedMagnitudeA({ verdict: 'B_much_better', evidence_b: CONCRETE, confidence: 'high' }),
    ).toBe(-2);
    expect(
      cappedMagnitudeA({ verdict: 'B_much_better', evidence_b: 'x', confidence: 'high' }),
    ).toBe(-1);
    // A weak evidence_a must NOT rescue a B_much_better (wrong side checked).
    expect(
      cappedMagnitudeA({
        verdict: 'B_much_better',
        evidence_a: CONCRETE,
        evidence_b: 'nope',
        confidence: 'high',
      }),
    ).toBe(-1);
  });
  it('passes |1|/0 through unchanged and NA -> null', () => {
    expect(cappedMagnitudeA({ verdict: 'A_better', confidence: 'low' })).toBe(1);
    expect(cappedMagnitudeA({ verdict: 'tie' })).toBe(0);
    expect(cappedMagnitudeA({ verdict: 'NA' })).toBeNull();
    expect(cappedMagnitudeA(undefined)).toBeNull();
  });
});

describe('parseOrder', () => {
  it('applies the cap then flips for the candidate slot', () => {
    // BA order: candidate=B. B_much_better with concrete evidence_b => +2 candidate.
    expect(parseOrder({ verdict: 'B_much_better', evidence_b: CONCRETE, confidence: 'high' }, 'B')).toEqual(
      { m: 2, decided: true },
    );
    // Same verdict but weak evidence => capped to +1 candidate.
    expect(parseOrder({ verdict: 'B_much_better', evidence_b: 'x', confidence: 'high' }, 'B')).toEqual(
      { m: 1, decided: true },
    );
  });
  it('reports undecided for NA / malformed', () => {
    expect(parseOrder({ verdict: 'NA' }, 'A')).toEqual({ m: null, decided: false });
    expect(parseOrder({ verdict: 'garbage' }, 'A')).toEqual({ m: null, decided: false });
    expect(parseOrder(undefined, 'A')).toEqual({ m: null, decided: false });
  });
});

describe('reconcileOrders', () => {
  it('same-sign orders combine as the mean (CONSISTENT, decided)', () => {
    expect(reconcileOrders({ m: 2, decided: true }, { m: 1, decided: true })).toEqual({
      combined: 1.5,
      status: 'consistent',
      decided: true,
    });
    expect(reconcileOrders({ m: -1, decided: true }, { m: -2, decided: true })).toEqual({
      combined: -1.5,
      status: 'consistent',
      decided: true,
    });
  });
  it('one order exactly 0 (tie) stays CONSISTENT and keeps the other', () => {
    expect(reconcileOrders({ m: 0, decided: true }, { m: 1, decided: true })).toEqual({
      combined: 0.5,
      status: 'consistent',
      decided: true,
    });
    expect(reconcileOrders({ m: 0, decided: true }, { m: 0, decided: true })).toEqual({
      combined: 0,
      status: 'consistent',
      decided: true,
    });
  });
  it('strictly-opposite signs (an order FLIP) route to UNDECIDED, never a credit', () => {
    const flip = reconcileOrders({ m: 1, decided: true }, { m: -1, decided: true });
    expect(flip).toEqual({ combined: null, status: 'inconsistent', decided: false });
    const bigFlip = reconcileOrders({ m: 2, decided: true }, { m: -2, decided: true });
    expect(bigFlip.status).toBe('inconsistent');
    expect(bigFlip.combined).toBeNull();
    expect(bigFlip.decided).toBe(false);
  });
  it('either order NA/undecided => UNDECIDED', () => {
    expect(reconcileOrders({ m: null, decided: false }, { m: 1, decided: true })).toEqual({
      combined: null,
      status: 'undecided',
      decided: false,
    });
    expect(reconcileOrders({ m: 1, decided: true }, { m: null, decided: false }).status).toBe(
      'undecided',
    );
  });
});

describe('reconcilePanel (both orders end-to-end)', () => {
  it('agreeing orders (candidate wins both ways) is CONSISTENT positive', () => {
    // AB: candidate=A, A_better (+1). BA: candidate=B, B_better (+1). Consistent +1.
    const r = reconcilePanel({ verdict: 'A_better' }, { verdict: 'B_better' });
    expect(r).toEqual({ combined: 1, status: 'consistent', decided: true });
  });
  it('an order flip in the raw verdicts is caught as inconsistent', () => {
    // AB: A_better (candidate +1). BA: A_better => candidate=B so -1. Opposite => flip.
    const r = reconcilePanel({ verdict: 'A_better' }, { verdict: 'A_better' });
    expect(r.status).toBe('inconsistent');
    expect(r.decided).toBe(false);
  });
});

describe('parseComparisonsReply', () => {
  const ids = ['engines', 'hump', 'wings'];
  const good = JSON.stringify({
    comparisons: {
      engines: { evidence_a: 'four pods', evidence_b: 'two pods', verdict: 'A_better', confidence: 'high' },
      hump: { evidence_a: 'front hump', evidence_b: 'no hump', verdict: 'A_much_better', confidence: 'medium' },
      wings: { evidence_a: 'swept', evidence_b: 'swept', verdict: 'tie', confidence: 'low' },
    },
    notes: 'both models plausible',
  });
  it('parses well-formed comparisons and notes', () => {
    const out = parseComparisonsReply(good, ids);
    expect(Object.keys(out.comparisons)).toEqual(ids);
    expect(out.comparisons.engines.verdict).toBe('A_better');
    expect(out.notes).toBe('both models plausible');
    expect(out.dropped).toEqual([]);
  });
  it('tolerates a stray code fence around the JSON', () => {
    const fenced = '```json\n' + good + '\n```';
    const out = parseComparisonsReply(fenced, ids);
    expect(out.comparisons.wings.verdict).toBe('tie');
  });
  it('accepts a bare (no "comparisons" wrapper) object', () => {
    const bare = JSON.stringify({
      engines: { verdict: 'tie' },
      hump: { verdict: 'A_better' },
      wings: { verdict: 'NA' },
    });
    const out = parseComparisonsReply(bare, ids);
    expect(out.comparisons.engines.verdict).toBe('tie');
    expect(out.comparisons.wings.verdict).toBe('NA');
  });
  it('drops a malformed/missing criterion but keeps the others (fail-open)', () => {
    const partial = JSON.stringify({
      comparisons: {
        engines: { verdict: 'A_better' },
        hump: { verdict: 'not-a-verdict' },
        // wings missing entirely
      },
    });
    const out = parseComparisonsReply(partial, ids);
    expect(Object.keys(out.comparisons)).toEqual(['engines']);
    expect(out.dropped.sort()).toEqual(['hump', 'wings']);
  });
  it('throws only when the whole reply is unparseable', () => {
    expect(() => parseComparisonsReply('', ids)).toThrow(/empty/);
    expect(() => parseComparisonsReply('not json at all', ids)).toThrow(/not JSON/);
    expect(() => parseComparisonsReply('[1,2,3]', ids)).toThrow(/not an object/);
  });
});
