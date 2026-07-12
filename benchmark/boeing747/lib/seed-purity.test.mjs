// AGI-purity regression guard (rules/bench-agi-purity.md).
//
// A per-attempt bench self-improve lesson carries the actor's OWN answer-derived,
// benchmark-specific geometry/measurements (e.g. "shortened the barrel 6.5 -> 4.9,
// L/D 1.58, the reference ratio", exact station coordinates, a wingChordY helper).
// Those lessons belong in the RUNTIME brain only — never in the committed shared
// seed (mcp-data/shared/memory-seed.sql). On 2026-07-13 a STALE MCP-brain binary
// (predating the gateway seed-exclusion fix) appended exactly such a Boeing lesson
// to the seed as a local change; it was caught + reverted. This test makes that
// whole class of leak fail CI permanently: it (a) proves the generic isBenchLesson
// detector flags such rows and not curated harness lessons, and (b) scans the
// committed seed for the two bench-lesson markers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBenchLesson } from './self-learning.mjs';

const SEED_PATH = path.resolve('mcp-data/shared/memory-seed.sql');

describe('isBenchLesson (generic bench self-improve-attempt detector)', () => {
  it('flags a per-attempt bench lesson by the self-improve-attempt category', () => {
    expect(isBenchLesson({ category: 'self-improve-attempt' })).toBe(true);
  });
  it('flags by the <bench>-actor-attempt tag convention (no benchmark hardcoded)', () => {
    expect(isBenchLesson({ tags: 'boeing747-actor-attempt,engines_four_underwing,edited' })).toBe(true);
    expect(isBenchLesson({ tags: 'zork-actor-attempt' })).toBe(true);
    expect(isBenchLesson({ tags: 'some-future-bench-actor-attempt,foo' })).toBe(true);
  });
  it('flags by the LESSON (<bench>-actor-attempt) content prefix', () => {
    expect(isBenchLesson({ content: 'LESSON (boeing747-actor-attempt): outcome=edited...' })).toBe(true);
  });
  it('does NOT flag curated harness lessons or ordinary memories', () => {
    expect(
      isBenchLesson({ category: 'lesson', tags: 'boeing747,faithful-actor', content: 'BOEING-747-FAITHFUL-ACTOR-1 keep the actor faithful ...' }),
    ).toBe(false);
    expect(isBenchLesson({ category: 'reference', tags: 'ci,guardian' })).toBe(false);
    expect(isBenchLesson({ content: 'a normal memory about actor rehearsal', tags: 'acting' })).toBe(false);
    expect(isBenchLesson({})).toBe(false);
  });
  it('flags the EXACT lesson that leaked into the seed on 2026-07-13', () => {
    const leaked =
      'LESSON (boeing747-actor-attempt): outcome=edited, targeted criterion=engines_four_underwing. ' +
      'I shortened the barrel 6.5 -> 4.9 (L/D 1.58, the reference ratio) and replaced the shared le + 1.6 offset ...';
    expect(
      isBenchLesson({
        content: leaked,
        tags: 'boeing747-actor-attempt,engines_four_underwing,edited,terransoul-opus48-open-mesh',
        category: 'self-improve-attempt',
      }),
    ).toBe(true);
  });
});

describe('committed shared seed stays free of bench self-improve-attempt lessons (AGI-purity)', () => {
  const seed = readFileSync(SEED_PATH, 'utf8');
  it("contains no 'self-improve-attempt' category rows", () => {
    expect(seed.includes("'self-improve-attempt'")).toBe(false);
  });
  it('contains no <bench>-actor-attempt tag/content rows', () => {
    expect(/-actor-attempt/.test(seed)).toBe(false);
  });
});
