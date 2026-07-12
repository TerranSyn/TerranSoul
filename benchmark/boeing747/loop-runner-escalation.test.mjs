// Regression tests for the AGI-pure plateau -> computed-mesh escalation
// decision (loop-runner-terransoul.mjs). The escalation is GENERIC: it fires on
// a structural gap-to-target or a persistent-weakest streak, names only the
// rubric's own feature id, and seeds NO geometry/coordinates. These tests pin
// (a) the gap/streak decision and (b) the escalation text's AGI purity so a
// future edit can never quietly turn it into an answer-seeding hint.
import { describe, expect, it } from 'vitest';
import { MESH_ESCALATION_GAP, buildMeshEscalation, meshEscalationStreak } from './loop-runner-terransoul.mjs';

const VIEW_THRESHOLD = 8.0;

// The real committed opus48-open breakdown (results/terransoul-opus48-open/best.json).
const OPUS48_OPEN = [
  { id: 'nose_hump', mean: 4.85 },
  { id: 'left_profile', mean: 5.65 },
  { id: 'rear_34', mean: 6.02 },
  { id: 'front', mean: 6.66 },
  { id: 'rear', mean: 7.36 },
  { id: 'top_down', mean: 7.82 },
];

// A feature escalates on a fresh run (streak === 1) iff its gap-to-target
// exceeds MESH_ESCALATION_GAP. This mirrors the runner's gate exactly.
const escalatesFresh = (mean) => VIEW_THRESHOLD - mean > MESH_ESCALATION_GAP;

describe('plateau -> mesh escalation decision (gap-to-target)', () => {
  it('escalates the two structural gaps (hump, profile) and tweaks the near-target views', () => {
    const decision = Object.fromEntries(OPUS48_OPEN.map((f) => [f.id, escalatesFresh(f.mean)]));
    expect(decision.nose_hump).toBe(true); // 4.85, gap 3.15
    expect(decision.left_profile).toBe(true); // 5.65, gap 2.35
    expect(decision.rear_34).toBe(false); // 6.02, gap 1.98 -> tweak first
    expect(decision.front).toBe(false);
    expect(decision.rear).toBe(false);
    expect(decision.top_down).toBe(false); // 7.82, gap 0.18
  });

  it('a view exactly at the 2.0 gap does NOT escalate (strictly greater-than)', () => {
    expect(escalatesFresh(VIEW_THRESHOLD - MESH_ESCALATION_GAP)).toBe(false);
  });
});

describe('meshEscalationStreak (persistent-weakest counter)', () => {
  const rec = (id) => ({ weakest_feature: { id } });

  it('counts consecutive trailing iterations with the SAME weakest feature', () => {
    expect(meshEscalationStreak([rec('a'), rec('b'), rec('hump'), rec('hump')], 'hump')).toBe(2);
    expect(meshEscalationStreak([rec('hump'), rec('hump'), rec('hump')], 'hump')).toBe(3);
  });

  it('resets when the weakest feature changed on the most recent iteration', () => {
    expect(meshEscalationStreak([rec('hump'), rec('hump'), rec('front')], 'front')).toBe(1);
  });

  it('is 0 for an empty chain or a null id', () => {
    expect(meshEscalationStreak([], 'hump')).toBe(0);
    expect(meshEscalationStreak([rec('hump')], null)).toBe(0);
  });
});

describe('buildMeshEscalation text is AGI-pure (strategy only, no seeded geometry)', () => {
  const text = buildMeshEscalation({
    weakest: { id: 'nose_hump', mean: 4.85 },
    streak: 3,
    gap: 3.15,
    viewThreshold: VIEW_THRESHOLD,
  });

  it('names the strategy (computed mesh rebuild) and the rubric feature id only', () => {
    expect(text).toContain('COMPUTED MESH');
    expect(text).toContain("'nose_hump'");
    expect(text).toContain('LatheGeometry');
  });

  it('tells the actor to derive the profile itself and seeds NO coordinates', () => {
    expect(text).toContain('Derive the profile/cross-section YOURSELF');
    expect(text).toContain('no coordinates in these instructions to copy');
    // No numeric coordinate triples / vertex arrays leaked into the hint.
    expect(text).not.toMatch(/\[\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*,/);
  });

  it('surfaces the persistence signal when the feature has plateaued', () => {
    expect(text).toContain('3 consecutive iterations');
    const noStreak = buildMeshEscalation({ weakest: { id: 'x', mean: 4 }, streak: 1, gap: 4, viewThreshold: 8 });
    expect(noStreak).not.toContain('consecutive iterations');
  });
});
