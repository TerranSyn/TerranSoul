// Tests for judge/judge-pairwise.mjs — the BLIND, ORDER-SWAPPED,
// REFERENCE-BUILD-ANCHORED opus-pairwise gating judge. Every `claude` CLI call
// is mocked via an injected execImpl that INSPECTS the prompt to see which
// physical render is bound to RENDER-A (candidate vs the cached reference build)
// and answers accordingly — exactly how a real blind judge behaves — so the
// order-swap reconciliation, parity scoring, review-fix-#1 flip handling and
// review-fix-#6 rig-stamp guard are all validated with NO network / GPU.
//
// The reference-photo loader is injected too (the real one reads a gitignored,
// fetched-not-committed references/prepared/meta.json), mirroring
// actor-claude.test.mjs's copyReferenceImagesFn seam, so the suite is CI-safe.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWS } from '../lib/cameras.mjs';
import { assertReferenceRigMatches, judgeShotsPairwise } from './judge-pairwise.mjs';
import { loadRubric } from './judge.mjs';

const { rubric } = loadRubric();
const CRITERIA_IDS = rubric.criteria.map((c) => c.id);

// Fake reference PHOTO paths for every rubric.reference_keys entry (the real
// loader reads the gitignored prepared/meta.json — mocked here).
const fakeRefs = () =>
  Object.fromEntries(
    Object.entries(rubric.reference_keys).map(([key, depicts]) => [
      key,
      { key, depicts, sha256: `sha-${key}`, file: `/fake/refs/${key}.png` },
    ]),
  );

const RIG_META = { cameraSpecVersion: 2, threeRevision: 'r160', supersample: 3, runId: 'run-x' };

function writeMeta(dir, overrides = {}) {
  writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ ...RIG_META, planePath: 'candidates/x/plane.js', planeSha256: 'plane-sha', ...overrides }),
  );
}

/** Concrete (>=20 chars, no lack-statement) winning-side evidence so the
 *  evidence+confidence cap keeps a `much_better` verdict at magnitude 2. */
const CONCRETE = 'clearly shows four slung engine nacelles beneath the swept wing on pylons';

function extractRenderAPath(prompt) {
  const m = prompt.match(/RENDER-A \(a 3D model of an aircraft\) = (.+)/);
  return m ? m[1].trim() : '';
}

/** Build one canned strict-JSON pairwise reply for all criteria ids. */
function buildInner(mode, isACandidate) {
  const comparisons = {};
  for (const id of CRITERIA_IDS) {
    if (mode === 'na-craftsmanship' && id === 'craftsmanship') {
      comparisons[id] = { evidence_a: 'edge-on', evidence_b: 'edge-on', verdict: 'NA', confidence: 'low' };
    } else if (mode === 'tie' || mode === 'na-craftsmanship') {
      comparisons[id] = { evidence_a: 'similar rounded body', evidence_b: 'similar rounded body', verdict: 'tie', confidence: 'high' };
    } else if (mode === 'always-A') {
      // Always favor the PHYSICAL A slot regardless of which render it is: AB
      // gives the candidate +2, BA gives it -2 => an order FLIP => undecided.
      comparisons[id] = { evidence_a: CONCRETE, evidence_b: 'a plain featureless wing', verdict: 'A_much_better', confidence: 'high' };
    } else if (mode === 'candidate-wins') {
      comparisons[id] = isACandidate
        ? { evidence_a: CONCRETE, evidence_b: 'a plain featureless wing', verdict: 'A_much_better', confidence: 'high' }
        : { evidence_a: 'a plain featureless wing', evidence_b: CONCRETE, verdict: 'B_much_better', confidence: 'high' };
    }
  }
  return JSON.stringify({ comparisons, notes: 'both renders read as wide-body airliners' });
}

function makeExec(mode, resolvedShotsDir) {
  const prompts = [];
  const fn = vi.fn(async (binary, args) => {
    const prompt = args[1];
    prompts.push(prompt);
    const isACandidate = extractRenderAPath(prompt).startsWith(resolvedShotsDir);
    return {
      stdout: JSON.stringify({
        subtype: 'success',
        is_error: false,
        result: buildInner(mode, isACandidate),
        total_cost_usd: 0.002,
        duration_ms: 100,
      }),
    };
  });
  fn.prompts = prompts;
  return fn;
}

describe('judgeShotsPairwise', () => {
  let shotsDir;
  let refDir;

  beforeEach(() => {
    shotsDir = mkdtempSync(path.join(tmpdir(), 'boeing747-pw-cand-'));
    refDir = mkdtempSync(path.join(tmpdir(), 'boeing747-pw-ref-'));
    writeMeta(shotsDir);
    writeMeta(refDir, { planePath: 'candidates/terransoul-opus48/plane.js', planeSha256: 'ref-plane-sha' });
  });

  afterEach(() => {
    rmSync(shotsDir, { recursive: true, force: true });
    rmSync(refDir, { recursive: true, force: true });
  });

  async function run(mode, opts = {}) {
    const execImpl = makeExec(mode, path.resolve(shotsDir));
    const results = await judgeShotsPairwise({
      shotsDir,
      referenceShotsDir: refDir,
      execImpl,
      loadReferencePathsFn: fakeRefs,
      ...opts,
    });
    return { results, execImpl };
  }

  it('emits an object SHAPE-IDENTICAL to judgeShotsClaude (all downstream-consumed keys present)', async () => {
    const { results } = await run('tie');
    for (const key of [
      'protocol', 'judge_track', 'rubric_version', 'rubric_sha256', 'judge_model', 'judge_samples',
      'supersample', 'run_id', 'plane_path', 'plane_sha256', 'camera_spec_version', 'three_revision',
      'reference_sha256', 'per_view', 'total_0_100', 'total_0_100_unmasked', 'scored_views',
      'missing_views', 'weakest_feature', 'total_cost_usd', 'created_at',
    ]) {
      expect(results, `missing key ${key}`).toHaveProperty(key);
    }
    expect(results.judge_track).toBe('claude-opus-4-8-pairwise-vision');
    expect(results.per_view).toHaveLength(9);
    for (const v of results.per_view) {
      expect(typeof v.view).toBe('number');
      expect(typeof v.score).toBe('number');
      expect(v.criteria_medians).toBeTypeOf('object');
      expect(v).toHaveProperty('decided_fraction');
    }
    // weakest_feature keeps the frozen { id, mean, perCriterion } shape.
    expect(results.weakest_feature).toHaveProperty('id');
    expect(results.weakest_feature).toHaveProperty('mean');
    expect(results.weakest_feature).toHaveProperty('perCriterion');
    // pairwise-only stamps the reference build sha256.
    expect(results.reference_plane_sha256).toBe('ref-plane-sha');
  });

  it('a consistent all-TIE panel scores every view at parity 5.0 (total 50) with full decided_fraction', async () => {
    const { results, execImpl } = await run('tie');
    for (const v of results.per_view) {
      expect(v.score).toBe(5);
      expect(v.decided_fraction).toBe(1);
      expect(v.inconclusive).toBe(false);
    }
    expect(results.total_0_100).toBe(50);
    // K=1 default => 2 calls (AB + BA) per view * 9 views.
    expect(execImpl).toHaveBeenCalledTimes(18);
  });

  it('a consistent CANDIDATE-WINS panel (concrete evidence, high confidence) scores 10.0 (total 100)', async () => {
    const { results } = await run('candidate-wins');
    for (const v of results.per_view) expect(v.score).toBe(10);
    expect(results.total_0_100).toBe(100);
  });

  it('REVIEW FIX #1: an order-FLIP is routed to UNDECIDED — it never manufactures a hollow 5.0 clear', async () => {
    const { results } = await run('always-A');
    for (const v of results.per_view) {
      expect(v.decided_fraction).toBe(0);
      expect(v.inconclusive).toBe(true);
      expect(v.score).toBeNull();
    }
    expect(results.total_0_100).toBeNull();
  });

  it('an all-NA criterion is null + weight-renormalized without sinking the view', async () => {
    const { results } = await run('na-craftsmanship');
    const v1 = results.per_view.find((v) => v.view === 1);
    expect(v1.criteria_medians.craftsmanship).toBeNull();
    expect(v1.score).toBe(5); // remaining tied criteria renormalize to parity
    expect(v1.decided_fraction).toBeLessThan(1); // the NA pair is undecided
    expect(v1.decided_fraction).toBeGreaterThan(0.5); // still conclusive
  });

  it('reads the reference render from referenceShotsDir and NEVER treats it as the candidate/grant dir', async () => {
    const { execImpl } = await run('tie');
    const resolvedShots = path.resolve(shotsDir);
    const resolvedRef = path.resolve(refDir);
    for (const prompt of execImpl.prompts) {
      // Every call compares exactly one candidate render and one reference render.
      expect(prompt).toContain(path.join(resolvedShots, 'view-'));
      expect(prompt).toContain(path.join(resolvedRef, 'view-'));
      // The reference-shot dir is never handed to the model as a candidate to score.
    }
    // Across the AB/BA swap the candidate occupies slot A in half the calls and
    // slot B in the other half (proof the order actually swaps physical paths).
    const aIsCandidate = execImpl.prompts.filter((p) => extractRenderAPath(p).startsWith(resolvedShots)).length;
    expect(aIsCandidate).toBe(9); // exactly the 9 AB calls
  });

  it('K panels multiply the call count (K=2 => 4 calls per view)', async () => {
    const { execImpl } = await run('tie', { samples: 2 });
    expect(execImpl).toHaveBeenCalledTimes(2 * 2 * 9);
  });

  it('is fail-open: a panel whose CLI call throws is DROPPED, not scored as zero', async () => {
    // execImpl throws on every call => every panel dropped => scores null, but
    // the run still returns an object (never throws, never zeroes).
    const execImpl = vi.fn(async () => {
      throw new Error('claude CLI exploded');
    });
    const results = await judgeShotsPairwise({
      shotsDir,
      referenceShotsDir: refDir,
      execImpl,
      loadReferencePathsFn: fakeRefs,
    });
    for (const v of results.per_view) {
      expect(v.score).toBeNull();
      expect(v.decided_fraction).toBe(0);
    }
    expect(results.total_0_100).toBeNull();
  });

  it('REVIEW FIX #6: refuses to score when the cached reference rig meta mismatches the candidate', async () => {
    writeMeta(refDir, { cameraSpecVersion: 1, planePath: 'candidates/terransoul-opus48/plane.js', planeSha256: 'ref-plane-sha' });
    const execImpl = makeExec('tie', path.resolve(shotsDir));
    await expect(
      judgeShotsPairwise({ shotsDir, referenceShotsDir: refDir, execImpl, loadReferencePathsFn: fakeRefs }),
    ).rejects.toThrow(/reference-rig mismatch/);
    expect(execImpl).not.toHaveBeenCalled();
  });

  it('throws when referenceShotsDir is omitted (no silent same-dir comparison)', async () => {
    await expect(
      judgeShotsPairwise({ shotsDir, execImpl: vi.fn(), loadReferencePathsFn: fakeRefs }),
    ).rejects.toThrow(/requires referenceShotsDir/);
  });
});

describe('assertReferenceRigMatches (review fix #6 stamp)', () => {
  const base = { cameraSpecVersion: 2, threeRevision: 'r160', supersample: 3 };

  it('passes when camera_spec_version, three_revision and supersample all match', () => {
    expect(() => assertReferenceRigMatches({ ...base }, { ...base })).not.toThrow();
  });

  it('normalizes an unstamped supersample to the frozen default (1)', () => {
    expect(() =>
      assertReferenceRigMatches({ cameraSpecVersion: 2, threeRevision: 'r160' }, { ...base, supersample: 1 }),
    ).not.toThrow();
    expect(() =>
      assertReferenceRigMatches({ cameraSpecVersion: 2, threeRevision: 'r160' }, { ...base, supersample: 3 }),
    ).toThrow(/supersample/);
  });

  it('throws on a camera_spec_version or three_revision drift', () => {
    expect(() => assertReferenceRigMatches({ ...base }, { ...base, cameraSpecVersion: 1 })).toThrow(/camera_spec_version/);
    expect(() => assertReferenceRigMatches({ ...base }, { ...base, threeRevision: 'r159' })).toThrow(/three_revision/);
  });
});

describe('VIEWS coverage sanity', () => {
  it('the judge iterates all nine frozen views', () => {
    expect(VIEWS).toHaveLength(9);
  });
});
