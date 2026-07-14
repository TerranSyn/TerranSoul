import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  comparablePerViewDelta,
  decideEditAcceptance,
  DEFAULT_GEMMA_PERSIST_THRESHOLD,
  snapshotBest,
  restoreBest,
  editFingerprint,
  isDuplicateRejectedEdit,
  loadRejectedEdits,
  appendRejectedEdit,
  formatRejectedEditsSection,
} from './edit-gate.mjs';

// The DECISION function is pure — every case below runs with plain objects, no
// filesystem and no live judge. The I/O helpers are exercised on a real tmp
// dir (round-trip) and, for the fail-open paths, with a fake fsImpl that
// throws. Mirrors the injected-seam pattern in self-learning.test.mjs.

const EPS = { epsilonTotal: 1, epsilonView: 0.3, epsilonGemma: 2 };

describe('decideEditAcceptance — accept / within_noise / reject core', () => {
  it('ACCEPTS a clear improvement above epsilonTotal (best advances)', () => {
    const d = decideEditAcceptance({ gateTotal: 75, bestTotal: 70, ...EPS });
    expect(d.decision).toBe('accept');
    expect(d.totalDelta).toBe(5);
    expect(d.reason).toContain('accepted improvement');
  });

  it('is WITHIN_NOISE when |delta| <= epsilonTotal (best NOT advanced)', () => {
    const up = decideEditAcceptance({ gateTotal: 70.5, bestTotal: 70, ...EPS });
    expect(up.decision).toBe('within_noise');
    const down = decideEditAcceptance({ gateTotal: 69.5, bestTotal: 70, ...EPS });
    expect(down.decision).toBe('within_noise');
    expect(down.totalDelta).toBe(-0.5);
  });

  it('REJECTS a total regression beyond epsilonTotal', () => {
    const d = decideEditAcceptance({ gateTotal: 66, bestTotal: 70, ...EPS });
    expect(d.decision).toBe('reject');
    expect(d.reason).toContain('total regression');
    expect(d.totalDelta).toBe(-4);
  });

  it('establishes a BASELINE accept when there is no prior best', () => {
    const d = decideEditAcceptance({ gateTotal: 62, bestTotal: null, ...EPS });
    expect(d.decision).toBe('accept');
    expect(d.reason).toContain('baseline');
    expect(d.totalDelta).toBeNull();
  });

  it('FAILS OPEN to within_noise (no backtrack) when the gate total is unavailable', () => {
    const d = decideEditAcceptance({ gateTotal: null, bestTotal: 70, ...EPS });
    expect(d.decision).toBe('within_noise');
    expect(d.reason).toContain('fail-open');
  });
});

describe('decideEditAcceptance — cleared-view collapse & escalation exemption', () => {
  const bars = [8, 8, 8];
  it('REJECTS when a previously-cleared view collapses below its bar (not escalation-armed)', () => {
    const d = decideEditAcceptance({
      gateTotal: 71, // aggregate up, so only the view-collapse key can reject
      bestTotal: 70,
      gatePerView: [8.2, 7.0, 8.1], // view 1 fell from cleared 8.5 to 7.0
      bestPerView: [8.0, 8.5, 8.0],
      clearedViewsBar: bars,
      ...EPS,
    });
    expect(d.decision).toBe('reject');
    expect(d.reason).toContain('cleared-view collapse');
    expect(d.collapsedViews).toEqual([1]);
  });

  it('does NOT reject a 1-view dip when escalationArmed (aggregate-only gate)', () => {
    const d = decideEditAcceptance({
      gateTotal: 72,
      bestTotal: 70,
      gatePerView: [8.2, 7.0, 8.1],
      bestPerView: [8.0, 8.5, 8.0],
      clearedViewsBar: bars,
      escalationArmed: true,
      ...EPS,
    });
    expect(d.decision).toBe('accept');
    expect(d.collapsedViews).toEqual([]);
  });

  it('still REJECTS an aggregate-total regression even when escalationArmed', () => {
    const d = decideEditAcceptance({
      gateTotal: 66,
      bestTotal: 70,
      gatePerView: [7, 7, 7],
      bestPerView: [8, 8, 8],
      clearedViewsBar: bars,
      escalationArmed: true,
      ...EPS,
    });
    expect(d.decision).toBe('reject');
    expect(d.reason).toContain('total regression');
  });

  it('a small dip within epsilonView on a cleared view is NOT a collapse', () => {
    const d = decideEditAcceptance({
      gateTotal: 72,
      bestTotal: 70,
      gatePerView: [8.0, 7.8, 8.1], // 8.5 -> 7.8 is only 0.2 below the 8 bar within epsilonView 0.3
      bestPerView: [8.0, 8.5, 8.0],
      clearedViewsBar: bars,
      ...EPS,
    });
    expect(d.collapsedViews).toEqual([]);
    expect(d.decision).toBe('accept');
  });

  it('an unscored (null) cleared view is a judge miss, not a collapse (fail-open, no thrash)', () => {
    const d = decideEditAcceptance({
      gateTotal: 72,
      bestTotal: 70,
      gatePerView: [8.0, null, 8.1],
      bestPerView: [8.0, 8.5, 8.0],
      clearedViewsBar: bars,
      ...EPS,
    });
    expect(d.collapsedViews).toEqual([]);
    expect(d.decision).toBe('accept');
  });

  it('never treats a view with no calibrated bar as clearable/collapsible', () => {
    const d = decideEditAcceptance({
      gateTotal: 72,
      bestTotal: 70,
      gatePerView: [1, 1, 1],
      bestPerView: [9, 9, 9],
      clearedViewsBar: [null, undefined, NaN],
      ...EPS,
    });
    expect(d.collapsedViews).toEqual([]);
    expect(d.decision).toBe('accept');
  });
});

describe('decideEditAcceptance — gemma downside is a SOFT-FLAG that must PERSIST (review fixes #4/#5)', () => {
  const gemmaArgs = { gemmaTotal: 40, prevGemmaBest: 60 }; // 20 below, well past epsilonGemma 2

  it('a SINGLE-iteration gemma downside NEVER rejects and NEVER blocks an Opus improvement', () => {
    const d = decideEditAcceptance({
      gateTotal: 75,
      bestTotal: 70,
      ...gemmaArgs,
      priorGemmaDownsideStreak: 0,
      ...EPS,
    });
    expect(d.decision).toBe('accept'); // Opus improvement banked despite gemma dip
    expect(d.gemmaDownside).toBe(true);
    expect(d.gemmaDownsideStreak).toBe(1);
    expect(d.gemmaSoftFlag).toBe(true);
    expect(d.gemmaPersistedDownside).toBe(false);
  });

  it('a PERSISTED gemma downside (>=2 iters) downgrades an ACCEPT to within_noise but never rejects/backtracks', () => {
    const d = decideEditAcceptance({
      gateTotal: 75,
      bestTotal: 70,
      ...gemmaArgs,
      priorGemmaDownsideStreak: 1, // this makes the streak 2 == threshold
      ...EPS,
    });
    expect(d.decision).toBe('within_noise'); // NOT reject — no thrash
    expect(d.gemmaDownsideStreak).toBe(2);
    expect(d.gemmaPersistedDownside).toBe(true);
    expect(d.reason).toContain('PERSISTED gemma downside');
  });

  it('the persist threshold is 2 by default and is configurable', () => {
    expect(DEFAULT_GEMMA_PERSIST_THRESHOLD).toBe(2);
    const d = decideEditAcceptance({
      gateTotal: 75,
      bestTotal: 70,
      ...gemmaArgs,
      priorGemmaDownsideStreak: 2,
      gemmaPersistThreshold: 3, // needs 3 in a row; streak is 3 here
      ...EPS,
    });
    expect(d.gemmaDownsideStreak).toBe(3);
    expect(d.gemmaPersistedDownside).toBe(true);
    expect(d.decision).toBe('within_noise');
  });

  it('resets the streak when the gemma downside disappears', () => {
    const d = decideEditAcceptance({
      gateTotal: 75,
      bestTotal: 70,
      gemmaTotal: 61, // back up, no downside
      prevGemmaBest: 60,
      priorGemmaDownsideStreak: 5,
      ...EPS,
    });
    expect(d.gemmaDownside).toBe(false);
    expect(d.gemmaDownsideStreak).toBe(0);
    expect(d.gemmaSoftFlag).toBe(false);
    expect(d.decision).toBe('accept');
  });

  it('a persisted gemma downside does NOT rescue/alter a real total regression reject', () => {
    const d = decideEditAcceptance({
      gateTotal: 66,
      bestTotal: 70,
      ...gemmaArgs,
      priorGemmaDownsideStreak: 3,
      ...EPS,
    });
    expect(d.decision).toBe('reject');
    expect(d.reason).toContain('total regression'); // gemma is never the reject KEY
  });

  it('fails open on missing gemma numbers (no downside, no influence)', () => {
    const d = decideEditAcceptance({
      gateTotal: 75,
      bestTotal: 70,
      gemmaTotal: null,
      prevGemmaBest: 60,
      priorGemmaDownsideStreak: 4,
      ...EPS,
    });
    expect(d.gemmaDownside).toBe(false);
    expect(d.gemmaDownsideStreak).toBe(0);
    expect(d.decision).toBe('accept');
  });

  it('reports the soft-flag on a within_noise iteration without persisting', () => {
    const d = decideEditAcceptance({
      gateTotal: 70.2, // within noise
      bestTotal: 70,
      ...gemmaArgs,
      priorGemmaDownsideStreak: 0,
      ...EPS,
    });
    expect(d.decision).toBe('within_noise');
    expect(d.gemmaSoftFlag).toBe(true);
    expect(d.reason).toContain('gemma soft-flag');
    expect(d.reason).toContain('not yet persisted');
  });
});

describe('decideEditAcceptance — perViewDelta reporting', () => {
  it('computes rounded per-view deltas and null where either side is unscored', () => {
    const d = decideEditAcceptance({
      gateTotal: 71,
      bestTotal: 70,
      gatePerView: [8.25, null, 7.1],
      bestPerView: [8.0, 8.0, null],
      clearedViewsBar: [7, 7, 7],
      ...EPS,
    });
    expect(d.perViewDelta).toEqual([0.25, null, null]);
  });
});

describe('comparablePerViewDelta', () => {
  it('means the diff over all views when every index is scored on both sides', () => {
    const r = comparablePerViewDelta([5, 6, 7], [4, 6, 8], { minComparable: 3 });
    // diffs: 1, 0, -1 -> mean 0
    expect(r).toEqual({ delta: 0, comparableViews: 3, insufficient: false });
  });

  it('pairs only indices where BOTH sides are numeric — a null on either side is excluded, not treated as 0', () => {
    const r = comparablePerViewDelta([5, null, 7, 8], [4, 6, null, 6]);
    // comparable pairs: (5,4)->1, (8,6)->2 ; mean 1.5
    expect(r.comparableViews).toBe(2);
    expect(r.delta).toBe(1.5);
  });

  it('flags insufficient when fewer than minComparable views pair up', () => {
    const r = comparablePerViewDelta([5, null, null, null], [4, 6, 7, 8], { minComparable: 2 });
    expect(r.comparableViews).toBe(1);
    expect(r.insufficient).toBe(true);
  });

  it('returns a null delta (not zero/NaN) when nothing is comparable', () => {
    const r = comparablePerViewDelta([null, null], [1, 2]);
    expect(r).toEqual({ delta: null, comparableViews: 0, insufficient: true });
  });
});

describe('editFingerprint / isDuplicateRejectedEdit', () => {
  it('normalizes case, punctuation and whitespace to a stable fingerprint', () => {
    const a = editFingerprint('Rebuild the Nacelle, as a LatheGeometry!', 'engines');
    const b = editFingerprint('rebuild   the nacelle as a lathegeometry', 'engines');
    expect(a).toBe(b);
  });

  it('distinguishes different criteria for the same summary', () => {
    expect(editFingerprint('widen radius', 'engines')).not.toBe(editFingerprint('widen radius', 'wings'));
  });

  it('caps to the first ~12 significant tokens', () => {
    const long = Array.from({ length: 30 }, (_, i) => `tok${i}`).join(' ');
    const fp = editFingerprint(long, 'c');
    expect(fp).toContain('tok11');
    expect(fp).not.toContain('tok12');
  });

  it('matches a duplicate by fingerprint and by sha256', () => {
    const ledger = [
      { edit_summary: 'Widen the nacelle radius', weakest_feature_targeted: 'engines', rejected_sha256: 'abc' },
    ];
    expect(isDuplicateRejectedEdit(ledger, { summary: 'widen the nacelle radius', criterion: 'engines' })).toBe(true);
    expect(isDuplicateRejectedEdit(ledger, { summary: 'totally different', criterion: 'engines', sha256: 'abc' })).toBe(true);
    expect(isDuplicateRejectedEdit(ledger, { summary: 'totally different', criterion: 'wings' })).toBe(false);
    expect(isDuplicateRejectedEdit([], { summary: 'x', criterion: 'y' })).toBe(false);
  });
});

describe('formatRejectedEditsSection', () => {
  it('returns null for an empty/missing ledger (never injects noise)', () => {
    expect(formatRejectedEditsSection([])).toBeNull();
    expect(formatRejectedEditsSection(null)).toBeNull();
  });

  it('renders the most recent rejects with the default anti-example header', () => {
    const ledger = [
      { iter: 3, edit_summary: 'moved engines inboard', weakest_feature_targeted: 'engines', gating_delta: -1.4 },
    ];
    const section = formatRejectedEditsSection(ledger);
    expect(section).toContain('REJECTED EDITS ON THIS BENCHMARK');
    expect(section).toContain('iter 3 on engines');
    expect(section).toContain('moved engines inboard');
    expect(section).toContain('regressed total by -1.4');
  });

  it('bounds to maxItems, most-recent first', () => {
    const ledger = Array.from({ length: 8 }, (_, i) => ({ iter: i, edit_summary: `edit ${i}`, weakest_feature_targeted: 'c' }));
    const section = formatRejectedEditsSection(ledger, { maxItems: 3 });
    const bullets = section.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toContain('iter 7'); // most recent first
    expect(bullets[2]).toContain('iter 5');
  });

  it('truncates an over-long summary', () => {
    const ledger = [{ iter: 1, edit_summary: 'x'.repeat(1000), weakest_feature_targeted: 'c' }];
    const section = formatRejectedEditsSection(ledger, { maxCharsPerItem: 40 });
    expect(section).toContain('...');
  });
});

describe('I/O helpers — snapshot/restore/ledger round-trip on a real tmp dir', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'edit-gate-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('snapshotBest copies candidate -> best-plane.js (creating the target dir)', () => {
    const candidate = path.join(dir, 'candidates', 'x', 'plane.js');
    const best = path.join(dir, 'results', 'x-claude', 'best-plane.js'); // nested target dir does not exist yet
    mkdirSync(path.dirname(candidate), { recursive: true });
    writeFileSync(candidate, 'BEST GEOMETRY V1');
    const r = snapshotBest({ candidatePath: candidate, bestPlanePath: best });
    expect(r.ok).toBe(true);
    expect(readFileSync(best, 'utf8')).toBe('BEST GEOMETRY V1');
  });

  it('restoreBest copies best-plane.js -> candidate verbatim (backtrack)', () => {
    const candidate = path.join(dir, 'plane.js');
    const best = path.join(dir, 'best-plane.js');
    writeFileSync(best, 'GOOD');
    writeFileSync(candidate, 'REGRESSED');
    const r = restoreBest({ bestPlanePath: best, candidatePath: candidate });
    expect(r.ok).toBe(true);
    expect(readFileSync(candidate, 'utf8')).toBe('GOOD');
  });

  it('restoreBest fails open when the snapshot is missing', () => {
    const r = restoreBest({ bestPlanePath: path.join(dir, 'nope.js'), candidatePath: path.join(dir, 'plane.js') });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('missing');
  });

  it('loadRejectedEdits fails open to [] for a missing/corrupt ledger', () => {
    expect(loadRejectedEdits({ ledgerPath: path.join(dir, 'nope.json') })).toEqual([]);
    const corrupt = path.join(dir, 'corrupt.json');
    writeFileSync(corrupt, 'not json{{');
    expect(loadRejectedEdits({ ledgerPath: corrupt })).toEqual([]);
  });

  it('appendRejectedEdit persists, then DEDUPES a repeat dead-end', () => {
    const ledgerPath = path.join(dir, 'sub', 'rejected-edits.json');
    const entry = {
      iter: 2,
      weakest_feature_targeted: 'engines',
      edit_summary: 'widen nacelle radius',
      rejected_sha256: 'deadbeef',
      gating_delta: -1.4,
    };
    const first = appendRejectedEdit({ ledgerPath, entry });
    expect(first.ok).toBe(true);
    expect(first.appended).toBe(true);
    expect(loadRejectedEdits({ ledgerPath })).toHaveLength(1);

    // same fingerprint (different case/punctuation) => not appended again
    const dup = appendRejectedEdit({
      ledgerPath,
      entry: { ...entry, iter: 5, edit_summary: 'Widen Nacelle Radius!', rejected_sha256: 'other' },
    });
    expect(dup.appended).toBe(false);
    expect(loadRejectedEdits({ ledgerPath })).toHaveLength(1);

    // a genuinely different edit does append
    const other = appendRejectedEdit({
      ledgerPath,
      entry: { ...entry, iter: 6, weakest_feature_targeted: 'wings', edit_summary: 'raise dihedral', rejected_sha256: 'x' },
    });
    expect(other.appended).toBe(true);
    expect(loadRejectedEdits({ ledgerPath })).toHaveLength(2);
  });

  it('snapshotBest / appendRejectedEdit fail open (no throw) when fsImpl throws', () => {
    const boom = () => {
      throw new Error('disk full');
    };
    const fsImpl = { readFileSync: boom, writeFileSync: boom, copyFileSync: boom, existsSync: () => false, mkdirSync: boom };
    const s = snapshotBest({ candidatePath: 'a', bestPlanePath: 'b', fsImpl });
    expect(s.ok).toBe(false);
    expect(s.error).toContain('disk full');
    const a = appendRejectedEdit({ ledgerPath: 'l.json', entry: { edit_summary: 'x', weakest_feature_targeted: 'c' }, fsImpl });
    expect(a.ok).toBe(false);
  });

  it('validates required arguments (fail-open, no throw)', () => {
    expect(snapshotBest({}).ok).toBe(false);
    expect(restoreBest({}).ok).toBe(false);
    expect(appendRejectedEdit({}).ok).toBe(false);
    expect(loadRejectedEdits({})).toEqual([]);
  });
});
