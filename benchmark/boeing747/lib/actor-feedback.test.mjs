import { describe, expect, it } from 'vitest';
import { computeSentinelView, formatLastEditEffectSection, formatSentinelLine } from './actor-feedback.mjs';

const VIEWS = [
  { view: 1, key: 'left-profile' },
  { view: 2, key: 'right-profile' },
  { view: 3, key: 'front' },
];

describe('formatLastEditEffectSection', () => {
  it('reports improved and regressed views with the gate verdict', () => {
    const s = formatLastEditEffectSection({
      lastEditEffect: { decision: 'reject', totalDelta: -2.3, perViewDelta: [0.4, -1.1, 0.01] },
      views: VIEWS,
    });
    expect(s).toContain('REJECTED and rolled back');
    expect(s).toContain('view 1 (left-profile) +0.40');
    expect(s).toContain('view 2 (right-profile) -1.10');
    // sub-0.05 moves are noise, not credit:
    expect(s).not.toContain('front');
    expect(s).toContain('-2.30');
  });

  it('is null with no prior gated edit or no per-view data', () => {
    expect(formatLastEditEffectSection({ lastEditEffect: null, views: VIEWS })).toBeNull();
    expect(formatLastEditEffectSection({ lastEditEffect: { decision: 'accept', totalDelta: 1, perViewDelta: null }, views: VIEWS })).toBeNull();
  });

  it('labels an accepted edit as banked', () => {
    const s = formatLastEditEffectSection({
      lastEditEffect: { decision: 'accept', totalDelta: 1.4, perViewDelta: [0.5, 0.9, 0] },
      views: VIEWS,
    });
    expect(s).toContain('ACCEPTED and banked');
    expect(s).toContain('Views regressed: none');
  });
});

describe('computeSentinelView', () => {
  const entry = (deltas) => ({ per_view_delta: deltas });

  it('picks the view with the hardest mean drop across rejected edits', () => {
    const s = computeSentinelView([
      entry([-0.2, -1.5, 0.1]),
      entry([-0.1, -2.0, -0.3]),
      entry([0, -1.0, -0.2]),
    ]);
    expect(s.index).toBe(1);
    expect(s.meanDrop).toBeCloseTo(-1.5, 5);
  });

  it('returns null below the sample floor or with no usable arrays', () => {
    expect(computeSentinelView([entry([-1, 0, 0])])).toBeNull();
    expect(computeSentinelView([{}, {}, {}])).toBeNull();
    expect(computeSentinelView([])).toBeNull();
  });
});

describe('formatSentinelLine', () => {
  it('names the derived view and the pre-commit instruction', () => {
    const line = formatSentinelLine({ sentinel: { index: 1, meanDrop: -1.5, samples: 3 }, views: VIEWS });
    expect(line).toContain('view 2 (right-profile)');
    expect(line).toContain('mean drop -1.50');
    expect(line).toContain('make the edit smaller');
  });

  it('is null when no sentinel is derivable', () => {
    expect(formatSentinelLine({ sentinel: null, views: VIEWS })).toBeNull();
  });
});
