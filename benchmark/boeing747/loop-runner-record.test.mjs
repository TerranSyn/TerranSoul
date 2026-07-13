/**
 * Regressions for the two bookkeeping bugs that destroyed run bjke07o2u's record.
 *
 * Both are reproduced with the run's REAL numbers, so a future refactor that reintroduces
 * either failure fails here with the same figures that appear in the incident notes.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { bookkeepTrack, resolveUngatedGateState } from './loop-runner-terransoul.mjs';

const dirs = [];
function workspace() {
  const d = mkdtempSync(path.join(tmpdir(), 'boeing-record-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const RUBRIC = { criteria: [], views: [] };
function judged(total, sha) {
  return {
    total_0_100: total,
    plane_sha256: sha,
    per_view: [{ view: 1, key: 'left-profile', score: total / 10 }],
    weakest_feature: { id: 'engines_four_underwing', mean: 5.44 },
    critic: { weakest_feature: 'engines_four_underwing', fix_suggestion: 'x', source: 'anchor' },
  };
}

describe('the record plane is persisted with the record (bookkeepTrack)', () => {
  // WHY: best.json is monotone and correctly held 61.29/iter-8. But nothing saved the
  // GEOMETRY behind it — best-plane.js is the edit-gate's backtrack anchor, advanced only
  // on ACCEPT, and iter-8's accept was demoted to `within_noise` by the gemma veto. So the
  // record plane lived only in the working plane.js and iter-9's actor overwrote it.
  // best.json still names a sha256 that matches no file on disk. A record you cannot
  // re-render is not a record.
  it('writes record-plane.js whenever a new all-time best is recorded', () => {
    const ws = workspace();
    const actorDir = path.join(ws, 'results', 'actor');
    const planePath = path.join(ws, 'plane.js');
    writeFileSync(planePath, '// the 61.29 geometry\n');

    bookkeepTrack({ actorDir, iterNum: 8, runId: 'r-8', judged: judged(61.29, 'a767'), rubric: RUBRIC, planePath });

    const recordPlane = path.join(actorDir, 'record-plane.js');
    expect(existsSync(recordPlane)).toBe(true);
    expect(readFileSync(recordPlane, 'utf8')).toBe('// the 61.29 geometry\n');
    expect(JSON.parse(readFileSync(path.join(actorDir, 'best.json'), 'utf8')).total_0_100).toBe(61.29);
  });

  it('does NOT overwrite the record plane when a later iteration scores lower', () => {
    const ws = workspace();
    const actorDir = path.join(ws, 'results', 'actor');
    const planePath = path.join(ws, 'plane.js');

    writeFileSync(planePath, '// the 61.29 geometry\n');
    bookkeepTrack({ actorDir, iterNum: 8, runId: 'r-8', judged: judged(61.29, 'a767'), rubric: RUBRIC, planePath });

    // iter 9 regresses and the actor rewrites the working plane in place
    writeFileSync(planePath, '// the 54.99 regression\n');
    bookkeepTrack({ actorDir, iterNum: 9, runId: 'r-9', judged: judged(54.99, 'b999'), rubric: RUBRIC, planePath });

    // the record geometry must survive the regression that overwrote the working file
    expect(readFileSync(path.join(actorDir, 'record-plane.js'), 'utf8')).toBe('// the 61.29 geometry\n');
    expect(JSON.parse(readFileSync(path.join(actorDir, 'best.json'), 'utf8')).iter).toBe(8);
  });

  it('the record plane and best.json always describe the same iteration', () => {
    const ws = workspace();
    const actorDir = path.join(ws, 'results', 'actor');
    const planePath = path.join(ws, 'plane.js');

    for (const [iter, total, body] of [
      [1, 36.72, '// v1'],
      [6, 59.39, '// v6'],
      [8, 61.29, '// v8'],
      [10, 56.49, '// v10'],
    ]) {
      writeFileSync(planePath, `${body}\n`);
      bookkeepTrack({ actorDir, iterNum: iter, runId: `r-${iter}`, judged: judged(total, `s${iter}`), rubric: RUBRIC, planePath });
    }

    const best = JSON.parse(readFileSync(path.join(actorDir, 'best.json'), 'utf8'));
    expect(best.iter).toBe(8);
    expect(best.total_0_100).toBe(61.29);
    expect(readFileSync(path.join(actorDir, 'record-plane.js'), 'utf8')).toBe('// v8\n');
  });

  it('survives an unwritable plane path without killing the run', () => {
    const ws = workspace();
    const actorDir = path.join(ws, 'results', 'actor');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // planePath that does not exist: the snapshot must be skipped, not thrown
    expect(() =>
      bookkeepTrack({
        actorDir,
        iterNum: 1,
        runId: 'r-1',
        judged: judged(50, 's1'),
        rubric: RUBRIC,
        planePath: path.join(ws, 'nope', 'plane.js'),
      }),
    ).not.toThrow();
    expect(existsSync(path.join(actorDir, 'best.json'))).toBe(true);
    spy.mockRestore();
  });
});

describe('the gate-state ratchet cannot leak downward (resolveUngatedGateState)', () => {
  // WHY: canGate went false at iter-10 because iter-9's actor exhausted its retries, and
  // the ungated branch then overwrote best_total with iter-10's own 56.49 — no comparison.
  // gate-state is the acceptance baseline, the backtrack target AND the best-of-N promotion
  // floor, so the leak lowered the bar for everything after it.
  it('HOLDS the existing best when the iteration cannot be gated (the real 59.39 -> 56.49 leak)', () => {
    const held = {
      best_total: 59.39,
      best_per_view: [6.1, 8.69, 6.51],
      best_gemma_total: 73.68,
      gemma_downside_streak: 1,
      contested_streaks: [0, 0, 0],
      best_iter: 6,
    };

    const out = resolveUngatedGateState({
      gateState: held,
      gateTotal: 56.49, // iter-10's own, lower score
      gatePerView: [3.01, 3.45, 2.8],
      gemmaTotal: 73.82,
      contestedStreaks: [1, 0, 0],
      iterNum: 10,
    });

    expect(out.action).toBe('hold');
    expect(out.state.best_total).toBe(59.39); // NOT 56.49
    expect(out.state.best_iter).toBe(6); // NOT 10
    expect(out.state.best_per_view).toEqual([6.1, 8.69, 6.51]);
    expect(out.state.best_gemma_total).toBe(73.68);
    // streaks are iteration-local and DO advance
    expect(out.state.contested_streaks).toEqual([1, 0, 0]);
  });

  it('still establishes a baseline when there is genuinely no best to protect', () => {
    const out = resolveUngatedGateState({
      gateState: null,
      gateTotal: 36.72,
      gatePerView: [4.0],
      gemmaTotal: 70.0,
      contestedStreaks: [0],
      iterNum: 1,
    });

    expect(out.action).toBe('baseline');
    expect(out.state.best_total).toBe(36.72);
    expect(out.state.best_iter).toBe(1);
  });

  it('treats a corrupt gate-state (no numeric best) as no best', () => {
    const out = resolveUngatedGateState({
      gateState: { best_total: null, contested_streaks: [] },
      gateTotal: 42.0,
      gatePerView: [4.2],
      gemmaTotal: 71.0,
      contestedStreaks: [0],
      iterNum: 3,
    });

    expect(out.action).toBe('baseline');
    expect(out.state.best_total).toBe(42.0);
  });

  it('holds even when the ungated iteration scores HIGHER (the gate, not this branch, banks a gain)', () => {
    // An ungated iteration has no genuine prior actor, so its score is not evidence that an
    // EDIT improved anything. Banking it here would let an unattributable score become the
    // new floor. bookkeepTrack still records the all-time high independently.
    const out = resolveUngatedGateState({
      gateState: { best_total: 59.39, best_per_view: [6.1], best_gemma_total: 73.68, best_iter: 6, contested_streaks: [] },
      gateTotal: 70.0,
      gatePerView: [7.0],
      gemmaTotal: 75.0,
      contestedStreaks: [0],
      iterNum: 11,
    });

    expect(out.action).toBe('hold');
    expect(out.state.best_total).toBe(59.39);
    expect(out.state.best_iter).toBe(6);
  });
});
