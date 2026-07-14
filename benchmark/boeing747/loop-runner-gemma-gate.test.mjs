/**
 * Real-data replay proving the frozen-gemma-track edit gate (wired into
 * loop-runner-terransoul.mjs's `else if (!claudeGates)` branch) closes the
 * exact regression a live run measured: peaked at iter 26 (50.86/100, 9/9
 * views), then wandered for 20 more iterations without ever re-finding or
 * beating that peak, ending at iter 46 (40.99/100) -- see
 * rules/completion-log.md's BOEING-GEMMA-CLIMB-2026-07-14 entry.
 *
 * All per-view numbers below are copied verbatim from the committed
 * results/terransoul-gemma/iter-{26,31,33,45}.json (commit b126f9ea) — a
 * future refactor that silently reverts to "accept everything unconditionally"
 * fails here with the SAME figures the live run produced, mirroring the
 * precedent set by loop-runner-record.test.mjs for the record-plane.js bug.
 */
import { describe, expect, it } from 'vitest';
import { comparablePerViewDelta, decideEditAcceptance } from './lib/edit-gate.mjs';

const UNIFORM_BAR = Array(9).fill(8.0); // rubric.json's view_threshold, broadcast per-view

// iter 26 (results/terransoul-gemma/iter-26.json): the measured peak.
const ITER_26_BEST = { total: 50.86, perView: [3.9, 6.82, 3.42, 5.5, 3.74, 8.69, 3.76, 6.95, 2.99] };

describe('frozen-gemma-track edit gate — real regression replay (results/terransoul-gemma/)', () => {
  it('would have REJECTED iter-31 (49.96) against the iter-26 best (50.86) -- the exact point the live run started wandering', () => {
    const iter31 = { total: 49.96, perView: [4.08, 8.69, 3.42, 6.94, 2.94, 7.54, 2.9, 4.8, 3.65] };
    const decision = decideEditAcceptance({
      gateTotal: iter31.total,
      gatePerView: iter31.perView,
      bestTotal: ITER_26_BEST.total,
      bestPerView: ITER_26_BEST.perView,
      clearedViewsBar: UNIFORM_BAR,
      epsilonTotal: 0,
    });
    expect(decision.decision).toBe('reject');
    expect(decision.reason).toContain('total regression');
  });

  it('would have REJECTED iter-33 (44.53, view 4 null) against the iter-26 best -- a null view is not confused with a collapse, the TOTAL regression alone is enough', () => {
    const iter33 = { total: 44.53, perView: [3.78, 8.69, 3.42, null, 3.22, 4.8, 2.97, 4.8, 3.94] };
    const decision = decideEditAcceptance({
      gateTotal: iter33.total,
      gatePerView: iter33.perView,
      bestTotal: ITER_26_BEST.total,
      bestPerView: ITER_26_BEST.perView,
      clearedViewsBar: UNIFORM_BAR,
      epsilonTotal: 0,
    });
    expect(decision.decision).toBe('reject');
  });

  it('would have REJECTED the terminal iter-45/46 (40.99) against the iter-26 best -- the loop would have backtracked long before a ~10-point, ~19% loss accumulated', () => {
    const iter45 = { total: 40.99, perView: [4.08, 6.48, 3.42, null, 2.83, 4.37, 2.87, 4.8, 3.94] };
    const decision = decideEditAcceptance({
      gateTotal: iter45.total,
      gatePerView: iter45.perView,
      bestTotal: ITER_26_BEST.total,
      bestPerView: ITER_26_BEST.perView,
      clearedViewsBar: UNIFORM_BAR,
      epsilonTotal: 0,
    });
    expect(decision.decision).toBe('reject');
  });

  it('would have ACCEPTED the iter-26 edit itself against an earlier-in-the-climb baseline -- the gate protects the peak without blocking genuine improvement', () => {
    // iter 13 (results/terransoul-gemma/iter-13.json): a representative
    // earlier-climb total, same 9 views, well before the peak.
    const earlierBaseline = { total: 43.93, perView: [2.75, 6.82, 4.39, 7.36, 3.46, 4.8, 3.6, 3.99, 2.37] };
    const decision = decideEditAcceptance({
      gateTotal: ITER_26_BEST.total,
      gatePerView: ITER_26_BEST.perView,
      bestTotal: earlierBaseline.total,
      bestPerView: earlierBaseline.perView,
      clearedViewsBar: UNIFORM_BAR,
      epsilonTotal: 0,
    });
    expect(decision.decision).toBe('accept');
  });

  it('comparablePerViewDelta on iter-33 (8 scored views) shows a real, smaller-than-the-raw-total-implies regression -- not a measurement artifact of the missing view', () => {
    const iter33PerView = [3.78, 8.69, 3.42, null, 3.22, 4.8, 2.97, 4.8, 3.94];
    const cmp = comparablePerViewDelta(iter33PerView, ITER_26_BEST.perView);
    expect(cmp.comparableViews).toBe(8); // view 4 (index 3) excluded on both sides
    expect(cmp.delta).toBeLessThan(0); // still a genuine regression on the comparable views
  });
});
