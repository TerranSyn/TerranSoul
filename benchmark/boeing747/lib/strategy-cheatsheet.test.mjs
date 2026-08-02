import { describe, expect, it } from 'vitest';
import {
  classifyOutcome,
  foldStrategyEvents,
  formatBadAttemptsSection,
  formatStrategyCheatsheetSection,
  promoteStrategy,
  rankStrategies,
  sanitizeStrategyForPurity,
  strategyFingerprint,
} from './strategy-cheatsheet.mjs';

// The EXACT leaked-contamination form the AGI-purity fix targets: PROSE with
// derived measurements ('6.5 -> 4.9', 'L/D 1.58', '0.767 x 8 = 6.14'), a
// wingChordY helper, and a THREE.Vector3(x,y,z) call — none of which a lone
// coordinate-array regex catches. This mirrors the boeing747-actor-attempt
// lessons that leaked into mcp-data/shared/seed-lessons.sql (spec fix #2).
const LEAKED_PROSE_LESSON = [
  'dropped the wing chord from 6.5 -> 4.9 to hit L/D 1.58;',
  'set the wingChordY helper via const wingChordY = 0.767 x 8 = 6.14;',
  'anchored the tip with new THREE.Vector3(30.6, 11.4, -27.3).',
].join(' ');

// Curated PARAMETRIC technique phrases the cheatsheet is ALLOWED to store.
const CURATED_TECHNIQUES = [
  'rebuild the feature as a swept LatheGeometry profile instead of hollow extrusions',
  'split the four nacelles into separate groups with a darker recessed inlet disc',
  'shear the flying surfaces with an explicit basis matrix so faces stay outward-facing',
  'rebuild the empennage as solid 4-segment CylinderGeometry frustums',
];

describe('strategyFingerprint', () => {
  it('is a stable, stopword-stripped, punctuation-free slug', () => {
    expect(strategyFingerprint('Rebuild the feature as a LatheGeometry swept profile!')).toBe(
      'rebuild-feature-lathegeometry-swept-profile',
    );
  });

  it('folds two phrasings of the same technique to the same id (emergent UPSERT)', () => {
    const a = strategyFingerprint('Rebuild the feature as a LatheGeometry swept profile');
    const b = strategyFingerprint('rebuild feature as LatheGeometry swept profile.');
    expect(a).toBe(b);
  });

  it('bounds the token count and returns "" for blank/non-string input', () => {
    const long = strategyFingerprint('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi', {
      maxTokens: 5,
    });
    expect(long.split('-')).toHaveLength(5);
    expect(strategyFingerprint('')).toBe('');
    expect(strategyFingerprint(null)).toBe('');
  });
});

describe('classifyOutcome', () => {
  it('is helpful at/above +eps, harmful at/below -eps, neutral within the band', () => {
    expect(classifyOutcome(2.0, 0.5)).toBe('helpful');
    expect(classifyOutcome(0.5, 0.5)).toBe('helpful');
    expect(classifyOutcome(-2.0, 0.5)).toBe('harmful');
    expect(classifyOutcome(-0.5, 0.5)).toBe('harmful');
    expect(classifyOutcome(0.2, 0.5)).toBe('neutral');
    expect(classifyOutcome(0, 0.5)).toBe('neutral');
  });

  it('treats a non-finite delta as neutral (never invents a signal)', () => {
    expect(classifyOutcome(NaN, 0.5)).toBe('neutral');
    expect(classifyOutcome(undefined, 0.5)).toBe('neutral');
  });
});

describe('foldStrategyEvents', () => {
  const events = [
    { strategyId: 's1', scope: 'strategy', criterion: 'engines', technique: 'split nacelles into groups', outcome: 'helpful', gateDelta: 2.0, iter: 1, runId: 'r1', snippetRef: 'sha-a' },
    { strategyId: 's1', scope: 'strategy', criterion: 'engines', technique: 'split nacelles into groups', outcome: 'helpful', gateDelta: 1.0, iter: 3, runId: 'r1', snippetRef: 'sha-b' },
    { strategyId: 's1', scope: 'strategy', criterion: 'engines', technique: 'split nacelles into groups', outcome: 'harmful', gateDelta: -0.5, iter: 5, runId: 'r1' },
    { strategyId: 's2', scope: 'anti', criterion: 'gear', technique: 'widen the strut radius', outcome: 'harmful', gateDelta: -1.4, iter: 2, runId: 'r1' },
  ];

  it('groups by id and derives helpful/harmful/neutral counts + avg_gate_delta at read time', () => {
    const folded = foldStrategyEvents(events);
    const s1 = folded.find((f) => f.id === 's1');
    expect(s1.helpful_count).toBe(2);
    expect(s1.harmful_count).toBe(1);
    expect(s1.neutral_count).toBe(0);
    // (2.0 + 1.0 - 0.5) / 3 = 0.833...
    expect(s1.avg_gate_delta).toBeCloseTo(0.83, 2);
    expect(s1.provenance).toEqual({ first_iter: 1, last_iter: 5, run_id: 'r1' });
    expect(s1.last_outcome).toBe('harmful'); // latest iter (5) wins
  });

  it('prefers a helpful snippet pointer over a later non-helpful one', () => {
    const s1 = foldStrategyEvents(events).find((f) => f.id === 's1');
    expect(s1.snippetRef).toBe('sha-b');
  });

  it('falls back to fingerprint(technique) when an event has no strategyId', () => {
    const folded = foldStrategyEvents([
      { technique: 'rebuild feature as LatheGeometry', outcome: 'helpful', gateDelta: 1, iter: 1 },
    ]);
    expect(folded[0].id).toBe(strategyFingerprint('rebuild feature as LatheGeometry'));
  });

  it('returns [] for a non-array input', () => {
    expect(foldStrategyEvents(null)).toEqual([]);
  });

  it('buckets retrieved-precedent recalls separately and INERT to the certified counts (R5 trap guard)', () => {
    const folded = foldStrategyEvents([
      { strategyId: 's1', technique: 't', outcome: 'helpful', gateDelta: 2, iter: 1 },
      // Four recalled past-successes of the SAME strategy — must NOT inflate helpful_count.
      { strategyId: 's1', technique: 't', outcome: 'helpful', gateDelta: 2, iter: 2, precedent: true },
      { strategyId: 's1', technique: 't', outcome: 'helpful', gateDelta: 2, iter: 3, recalled: true },
      { strategyId: 's1', technique: 't', outcome: 'helpful', gateDelta: 2, iter: 4, source: 'precedent' },
      { strategyId: 's1', technique: 't', outcome: 'precedent', iter: 5 },
    ]);
    const s1 = folded.find((f) => f.id === 's1');
    expect(s1.helpful_count).toBe(1); // only the ONE fresh gate observation
    expect(s1.neutral_count).toBe(0); // outcome:'precedent' must not leak into neutral
    expect(s1.precedent_count).toBe(4);
  });
});

describe('promoteStrategy (R5 strategy-persistence promotion gate)', () => {
  it('PROMOTES a strategy certified over N>=3 unanimous fresh observations', () => {
    const r = promoteStrategy({ helpful_count: 3, harmful_count: 0, neutral_count: 0 });
    expect(r.promoted).toBe(true);
    expect(r.n).toBe(3);
    expect(r.winRateLCB).toBeGreaterThan(0.5);
  });

  it('does NOT promote below the N-episode threshold (insufficient evidence)', () => {
    const r = promoteStrategy({ helpful_count: 2, harmful_count: 0, neutral_count: 0 });
    expect(r.promoted).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/independent observations/);
  });

  it('DEMOTES a strategy whose net effect regresses (harmful > helpful)', () => {
    const r = promoteStrategy({ helpful_count: 1, harmful_count: 3, neutral_count: 0 });
    expect(r.demoted).toBe(true);
    expect(r.promoted).toBe(false);
  });

  it('does NOT promote when the win-rate LCB is below the floor even with enough non-regressing episodes', () => {
    const r = promoteStrategy({ helpful_count: 3, harmful_count: 2, neutral_count: 0 });
    expect(r.demoted).toBe(false); // 2 harmful !> 3 helpful
    expect(r.promoted).toBe(false); // but LCB(3/5) < 0.5
    expect(r.deflatedLCB).toBeLessThan(0.5);
  });

  it('DEFLATES by the number of candidate strategies (selection premium flips a borderline win)', () => {
    const item = { helpful_count: 6, harmful_count: 1, neutral_count: 0 };
    expect(promoteStrategy(item, { numCandidates: 1 }).promoted).toBe(true);
    const many = promoteStrategy(item, { numCandidates: 5 });
    expect(many.promoted).toBe(false);
    expect(many.selectionPenalty).toBeGreaterThan(0);
    expect(many.deflatedLCB).toBeLessThan(promoteStrategy(item, { numCandidates: 1 }).deflatedLCB);
  });

  it('counts neutral (within-noise) results in the denominator so a mostly-neutral strategy cannot pose as a winner', () => {
    const r = promoteStrategy({ helpful_count: 3, harmful_count: 0, neutral_count: 5 });
    expect(r.n).toBe(8);
    expect(r.winRate).toBeCloseTo(0.375, 3);
    expect(r.promoted).toBe(false);
  });

  it('honors custom minEpisodes / winrateFloor knobs', () => {
    const item = { helpful_count: 3, harmful_count: 0, neutral_count: 0 };
    expect(promoteStrategy(item, { minEpisodes: 5 }).promoted).toBe(false);
    expect(promoteStrategy(item, { winrateFloor: 0.9 }).promoted).toBe(false);
  });

  it('is inert on a non-object / empty item (never invents a promotion)', () => {
    expect(promoteStrategy(null).promoted).toBe(false);
    expect(promoteStrategy({}).promoted).toBe(false);
  });
});

describe('rankStrategies', () => {
  const items = [
    { id: 'a', scope: 'strategy', criterion: 'engines', helpful_count: 3, harmful_count: 0, avg_gate_delta: 2.1 },
    { id: 'b', scope: 'strategy', criterion: 'engines', helpful_count: 1, harmful_count: 0, avg_gate_delta: 0.5 },
    { id: 'c', scope: 'strategy', criterion: 'global', helpful_count: 2, harmful_count: 0, avg_gate_delta: 1.0 },
    { id: 'soured', scope: 'strategy', criterion: 'engines', helpful_count: 0, harmful_count: 3, avg_gate_delta: -1.0 },
    { id: 'anti1', scope: 'anti', criterion: 'engines', helpful_count: 0, harmful_count: 4, avg_gate_delta: -1.4 },
  ];

  it('orders by (helpful - harmful) then avg_gate_delta, filtered by scope+criterion', () => {
    const ranked = rankStrategies(items, { scope: 'strategy', criterion: 'engines', includeGlobal: false });
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']); // soured demoted, global excluded
  });

  it('includes global-criterion strategies when includeGlobal is set', () => {
    const ranked = rankStrategies(items, { scope: 'strategy', criterion: 'engines', includeGlobal: true });
    expect(ranked.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('demotes a soured strategy (harmful >= helpful + threshold) out of re-injection', () => {
    const ranked = rankStrategies(items, { scope: 'strategy', demoteThreshold: 2 });
    expect(ranked.map((r) => r.id)).not.toContain('soured');
  });

  it('does NOT demote anti items (they are meant to surface bad attempts)', () => {
    const ranked = rankStrategies(items, { scope: 'anti', criterion: 'engines' });
    expect(ranked.map((r) => r.id)).toContain('anti1');
  });

  it('honors the limit and returns [] for non-array input', () => {
    expect(rankStrategies(items, { scope: 'strategy', limit: 1 })[0].id).toBe('a');
    expect(rankStrategies(null)).toEqual([]);
  });

  it('with promote:true keeps ONLY R5-certified strategies (uncertified ones filtered out)', () => {
    const pool = [
      { id: 'strong', scope: 'strategy', criterion: 'engines', helpful_count: 8, harmful_count: 0, neutral_count: 0 },
      { id: 'thin', scope: 'strategy', criterion: 'engines', helpful_count: 2, harmful_count: 0, neutral_count: 0 },
    ];
    // Legacy (no gate): both pass the demote filter and rank.
    expect(rankStrategies(pool, { scope: 'strategy' }).map((r) => r.id)).toEqual(['strong', 'thin']);
    // Gated: only the certified strategy survives.
    expect(rankStrategies(pool, { scope: 'strategy', promote: true }).map((r) => r.id)).toEqual(['strong']);
  });

  it('promote:true does not affect the anti scope (bad attempts still surface)', () => {
    const ranked = rankStrategies(items, { scope: 'anti', criterion: 'engines', promote: true });
    expect(ranked.map((r) => r.id)).toContain('anti1');
  });
});

describe('sanitizeStrategyForPurity (TECHNIQUE-ONLY AGI-purity gate)', () => {
  it('REJECTS the exact leaked prose lesson (derived measurements + Vector3 + wingChordY)', () => {
    const result = sanitizeStrategyForPurity({ technique: LEAKED_PROSE_LESSON });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('REJECTS the leaked prose whether passed as a raw string or on a snippet field', () => {
    expect(sanitizeStrategyForPurity(LEAKED_PROSE_LESSON).ok).toBe(false);
    expect(sanitizeStrategyForPurity({ technique: 'ok phrase', snippet: LEAKED_PROSE_LESSON }).ok).toBe(false);
  });

  it('REJECTS each demonstrated contamination form individually', () => {
    expect(sanitizeStrategyForPurity('anchor at new THREE.Vector3(1, 2, 3)').ok).toBe(false); // geometry API
    expect(sanitizeStrategyForPurity('node.position.set(0, -3, 27.3)').ok).toBe(false); // setter
    expect(sanitizeStrategyForPurity('vertices = [-30.6, 11.4, -27.3, 0, 0, 0]').ok).toBe(false); // coord triple
    expect(sanitizeStrategyForPurity('drop the chord 6.5 -> 4.9').ok).toBe(false); // derived measurement
    expect(sanitizeStrategyForPurity('target L/D 1.58 for the wing').ok).toBe(false); // ratio label
    expect(sanitizeStrategyForPurity('set x −30.6 and z 27.3 at the tip').ok).toBe(false); // axis literals
    expect(sanitizeStrategyForPurity('scale by 0.767 x 8 = 6.14 exactly').ok).toBe(false); // arithmetic
  });

  it('PASSES curated parametric technique phrases', () => {
    for (const t of CURATED_TECHNIQUES) {
      const r = sanitizeStrategyForPurity({ technique: t });
      expect(r.ok, `expected PASS: ${t} (reasons: ${r.reasons.join('; ')})`).toBe(true);
    }
  });

  it('PASSES a phrase with a single small structural count (e.g. "4-segment")', () => {
    expect(sanitizeStrategyForPurity('rebuild as a 4-segment cylinder frustum').ok).toBe(true);
  });

  it('treats empty/blank content as pure', () => {
    expect(sanitizeStrategyForPurity('').ok).toBe(true);
    expect(sanitizeStrategyForPurity({}).ok).toBe(true);
  });
});

describe('formatStrategyCheatsheetSection', () => {
  it('renders a bulleted PROVEN STRATEGIES section with counts and snippet', () => {
    const section = formatStrategyCheatsheetSection([
      { id: 'a', scope: 'strategy', criterion: 'engines', technique: 'split nacelles into groups', helpful_count: 3, avg_gate_delta: 2.1, snippet: 'group each nacelle separately' },
    ]);
    expect(section).toContain('PROVEN STRATEGIES');
    expect(section).toContain('[engines] split nacelles into groups');
    expect(section).toContain('helped 3x');
    expect(section).toContain('avg +2.1');
    expect(section).toContain('group each nacelle separately');
  });

  it('returns null when there is nothing to show', () => {
    expect(formatStrategyCheatsheetSection([])).toBeNull();
    expect(formatStrategyCheatsheetSection(null)).toBeNull();
  });

  it('DROPS an item whose snippet fails the purity guard (defense in depth)', () => {
    const section = formatStrategyCheatsheetSection([
      { id: 'dirty', scope: 'strategy', criterion: 'wing', technique: 'ok technique phrase', snippet: LEAKED_PROSE_LESSON },
    ]);
    expect(section).toBeNull();
  });

  it('bounds the number of bullets via maxItems', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      scope: 'strategy',
      technique: `technique number ${'x'.repeat(1)}`,
      helpful_count: 1,
    }));
    const section = formatStrategyCheatsheetSection(items, { maxItems: 2 });
    const bullets = section.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(bullets).toHaveLength(2);
  });

  it('truncates an over-long bullet via maxCharsPerItem', () => {
    const section = formatStrategyCheatsheetSection(
      [{ id: 'a', scope: 'strategy', technique: 'y'.repeat(1000), helpful_count: 1 }],
      { maxCharsPerItem: 50 },
    );
    const bullet = section.split('\n')[1];
    expect(bullet.length).toBeLessThan(60);
    expect(bullet.endsWith('...')).toBe(true);
  });
});

describe('formatBadAttemptsSection', () => {
  it('renders an ANTI-PATTERNS section from anti items', () => {
    const section = formatBadAttemptsSection([
      { id: 'x', scope: 'anti', criterion: 'gear', anti_pattern: 'widening strut radius', harmful_count: 2 },
    ]);
    expect(section).toContain('ANTI-PATTERNS');
    expect(section).toContain('[gear] widening strut radius');
    expect(section).toContain('regressed 2x');
  });

  it('falls back to technique when anti_pattern is absent, and returns null when empty', () => {
    const section = formatBadAttemptsSection([{ id: 'y', scope: 'anti', technique: 'floated the engines', harmful_count: 1 }]);
    expect(section).toContain('floated the engines');
    expect(formatBadAttemptsSection([])).toBeNull();
  });
});
