import { describe, expect, it } from 'vitest';
import { pickWeakestView } from './judge.mjs';

// pickWeakestView is the pure targeting half of the structured critic (v4):
// given the per-view judge records, the weakest criterion, and the rubric's
// visibility mask, it names the view where that criterion is most damningly
// VISIBLE — never a view where the mask says the feature cannot be seen.
describe('pickWeakestView (structured-critic view targeting)', () => {
  const perView = [
    { view: 1, score: 5.1, criteria_medians: { wing_geometry: 4, craftsmanship: 6 } },
    { view: 2, score: 6.0, criteria_medians: { wing_geometry: 2, craftsmanship: 5 } },
    { view: 3, score: 3.0, criteria_medians: { wing_geometry: null, craftsmanship: 4 } },
    { view: 4, score: 2.0, criteria_medians: { wing_geometry: 1, craftsmanship: null } },
  ];

  it('picks the visible view with the lowest raw median for the criterion', () => {
    // view 4 has the globally-lowest wing median (1) but is masked out below.
    const visibility = { wing_geometry: [1, 2, 3] };
    expect(pickWeakestView(perView, 'wing_geometry', visibility)).toBe(2);
  });

  it('without a visibility mask every view is a candidate', () => {
    expect(pickWeakestView(perView, 'wing_geometry', undefined)).toBe(4);
  });

  it('falls back to the lowest-scoring visible VIEW when the criterion was never scored numerically', () => {
    const allNull = perView.map((v) => ({ ...v, criteria_medians: { wing_geometry: null } }));
    expect(pickWeakestView(allNull, 'wing_geometry', { wing_geometry: [1, 2, 3] })).toBe(3);
  });

  it('returns null with no usable signal (caller falls back to the contact sheet)', () => {
    expect(pickWeakestView([], 'wing_geometry', undefined)).toBeNull();
    expect(pickWeakestView([{ view: 9, score: null, criteria_medians: {} }], 'x', { x: [9] })).toBeNull();
    expect(pickWeakestView(perView, 'wing_geometry', { wing_geometry: [] })).toBeNull();
  });
});
