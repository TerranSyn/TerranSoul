// Tests for the BRU-3 best-of-N judge-once WIRING
// (lib/best-of-n-judge-once-wiring.mjs) with fully mocked seams — no rig, no
// CLI, no GPU, no real filesystem — plus a SOURCE-SHAPE guard asserting
// loop-runner-terransoul.mjs wires the step behind the config flag WITHOUT
// touching the direct single-edit call (byte-identical when disabled) and a
// JUDGE-CALL-INVARIANT grep (the wiring module never imports a judge).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maintainElitesOnAccept, maybeRunBestOfNJudgeOnce } from './best-of-n-judge-once-wiring.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** In-memory fs mock keyed by path.resolve so join/resolve callers agree. */
function makeFs(files = {}) {
  const store = {};
  for (const [k, v] of Object.entries(files)) store[path.resolve(k)] = v;
  return {
    store,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(store, path.resolve(p)),
    readFileSync: (p) => {
      const key = path.resolve(p);
      if (!Object.prototype.hasOwnProperty.call(store, key)) throw new Error(`ENOENT: ${p}`);
      return store[key];
    },
    mkdirSync: () => {},
    copyFileSync: (src, dest) => {
      store[path.resolve(dest)] = store[path.resolve(src)];
    },
    writeFileSync: (p, data) => {
      store[path.resolve(p)] = data;
    },
  };
}

const sha256Fn = (s) => `sha:${s}`;
const okValidate = () => ({ ok: true });
const okSmoke = () => ({ ok: true });
const PLANE = '/work/plane.js';
const GEMMA_DIR = '/results/actor-x';
const cfg = (over = {}) => ({ enabled: true, n: 3, useElites: false, elitesCap: 5, source: 'env', ...over });

/** Scripted actor: round k writes contents[k-1] (null = leave copy untouched) and returns statuses[k-1]. */
function makeActor(fs, { contents, statuses, denials = [] }) {
  const calls = [];
  const runActorWithRetries = async ({ candidatePath, retryCfg: _r, ...rest }) => {
    const k = calls.length;
    calls.push({ candidatePath, rest });
    if (contents[k] !== null && contents[k] !== undefined) fs.writeFileSync(candidatePath, contents[k]);
    return {
      status: statuses[k],
      changed: contents[k] != null,
      cost_usd: 0.01,
      ms: 100,
      attempts: [{ attempt: 1, status: statuses[k], denied: Boolean(denials[k]) }],
      claude_result_text: `round-${k + 1} summary`,
      observability: { round: k + 1 },
    };
  };
  return { calls, runActorWithRetries };
}

function baseCtx(fs, actor, over = {}) {
  return {
    config: cfg(),
    planePath: PLANE,
    iterNum: 7,
    gemmaDir: GEMMA_DIR,
    lastGateDecision: null,
    acceptedTotal: null,
    retryCfg: { maxRetries: 0 },
    actorBase: { model: 'm', effort: 'e' },
    runActorWithRetries: actor.runActorWithRetries,
    fsImpl: fs,
    sha256Fn,
    validateFn: okValidate,
    smokeFn: okSmoke,
    rng: () => 0,
    tempPathFor: (round) => `/tmp/bon/round-${round}/plane.js`,
    loadLedgerFn: () => [],
    logger: () => {},
    ...over,
  };
}

describe('maybeRunBestOfNJudgeOnce — disabled/enabled gating', () => {
  it('returns null when the config is disabled or absent (bare runs unchanged)', async () => {
    const fs = makeFs({ [PLANE]: 'INC' });
    const actor = makeActor(fs, { contents: [], statuses: [] });
    expect(await maybeRunBestOfNJudgeOnce(baseCtx(fs, actor, { config: cfg({ enabled: false }) }))).toBeNull();
    expect(await maybeRunBestOfNJudgeOnce(baseCtx(fs, actor, { config: null }))).toBeNull();
    expect(actor.calls).toHaveLength(0);
    expect(fs.store[path.resolve(PLANE)]).toBe('INC');
  });
});

describe('maybeRunBestOfNJudgeOnce — sampling, filtering, promotion', () => {
  it('samples N, filters non-edits and non-novel shas, promotes the novel survivor', async () => {
    const fs = makeFs({ [PLANE]: 'INC' });
    // round 1: no_change; round 2: edited to a recently-REJECTED sha; round 3: edited novel.
    const actor = makeActor(fs, { contents: [null, 'REJ', 'NEW'], statuses: ['no_change', 'edited', 'edited'] });
    const step = await maybeRunBestOfNJudgeOnce(
      baseCtx(fs, actor, { loadLedgerFn: () => [{ rejected_sha256: 'sha:REJ' }] }),
    );
    expect(actor.calls).toHaveLength(3); // exactly N actor calls
    // Every actor call landed on a throwaway copy, never the real candidate.
    for (const c of actor.calls) expect(path.resolve(c.candidatePath)).not.toBe(path.resolve(PLANE));
    expect(step.info.promoted).toBe(true);
    expect(step.info.selected_round).toBe(3);
    expect(step.info.selected_novel).toBe(true);
    expect(step.actorResult.status).toBe('edited');
    expect(step.actorResult.changed).toBe(true);
    expect(step.actorResult.plane_sha256_before).toBe('sha:INC');
    expect(step.actorResult.plane_sha256_after).toBe('sha:NEW');
    expect(fs.store[path.resolve(PLANE)]).toBe('NEW'); // promoted onto the real candidate
    expect(step.actorResult.claude_result_text).toBe('round-3 summary');
    expect(step.actorResult.attempts).toHaveLength(3);
    expect(step.actorResult.attempts.map((a) => a.round)).toEqual([1, 2, 3]);
    expect(step.actorResult.cost_usd).toBeCloseTo(0.03, 6);
    expect(step.info.rounds.map((r) => r.pass)).toEqual([false, true, true]);
    expect(step.info.rounds.map((r) => r.novel)).toEqual([false, false, true]);
  });

  it('falls back to the FIRST survivor when no survivor is novel', async () => {
    const fs = makeFs({ [PLANE]: 'INC' });
    const actor = makeActor(fs, { contents: ['REJ', 'REJ2', null], statuses: ['edited', 'edited', 'no_change'] });
    const step = await maybeRunBestOfNJudgeOnce(
      baseCtx(fs, actor, {
        loadLedgerFn: () => [{ rejected_sha256: 'sha:REJ' }, { rejected_sha256: 'sha:REJ2' }],
      }),
    );
    expect(step.info.promoted).toBe(true);
    expect(step.info.selected_round).toBe(1);
    expect(step.info.selected_novel).toBe(false);
    expect(fs.store[path.resolve(PLANE)]).toBe('REJ');
  });

  it('no survivor => candidate untouched, status no_change', async () => {
    const fs = makeFs({ [PLANE]: 'INC' });
    const actor = makeActor(fs, {
      contents: [null, 'BAD', null],
      statuses: ['no_change', 'edited', 'contract_failed'],
    });
    const step = await maybeRunBestOfNJudgeOnce(
      baseCtx(fs, actor, { validateFn: (src) => (src === 'BAD' ? { ok: false, violations: ['nope'] } : { ok: true }) }),
    );
    expect(step.info.promoted).toBe(false);
    expect(step.actorResult.status).toBe('no_change');
    expect(step.actorResult.changed).toBe(false);
    expect(fs.store[path.resolve(PLANE)]).toBe('INC');
    expect(step.actorResult.plane_sha256_after).toBe('sha:INC');
  });

  it('ALL rounds pure infra exhaustion => actor_exhausted_retries is preserved (stop-condition exclusion intact)', async () => {
    const fs = makeFs({ [PLANE]: 'INC' });
    const actor = makeActor(fs, {
      contents: [null, null, null],
      statuses: ['actor_exhausted_retries', 'actor_exhausted_retries', 'actor_exhausted_retries'],
    });
    const step = await maybeRunBestOfNJudgeOnce(baseCtx(fs, actor));
    expect(step.actorResult.status).toBe('actor_exhausted_retries');
    expect(step.actorResult.changed).toBe(false);
    expect(fs.store[path.resolve(PLANE)]).toBe('INC');
  });
});

describe('elites — append-on-accept + parent selection for round k>1', () => {
  const elitesJson = path.resolve(path.join(GEMMA_DIR, 'elites.json'));

  it('banks an elite when the gate accepted, capped and deduped', () => {
    const fs = makeFs({ [PLANE]: 'ACCEPTED' });
    const next = maintainElitesOnAccept({
      lastGateDecision: 'accept',
      planePath: PLANE,
      acceptedTotal: 44.4,
      iterNum: 7,
      elitesPath: path.join(GEMMA_DIR, 'elites.json'),
      elitesDir: path.join(GEMMA_DIR, 'elites'),
      cap: 5,
      fsImpl: fs,
      sha256Fn,
    });
    expect(next).toHaveLength(1);
    expect(next[0].sha).toBe('sha:ACCEPTED');
    expect(next[0].total).toBe(44.4);
    expect(JSON.parse(fs.store[elitesJson])[0].sha).toBe('sha:ACCEPTED');
    // snapshot copied next to the archive
    expect(fs.store[path.resolve(next[0].path)]).toBe('ACCEPTED');
  });

  it('non-accept decisions leave the archive untouched', () => {
    const fs = makeFs({ [PLANE]: 'X' });
    for (const d of ['reject', 'within_noise', null]) {
      const r = maintainElitesOnAccept({
        lastGateDecision: d,
        planePath: PLANE,
        acceptedTotal: 10,
        iterNum: 1,
        elitesPath: path.join(GEMMA_DIR, 'elites.json'),
        elitesDir: path.join(GEMMA_DIR, 'elites'),
        cap: 5,
        fsImpl: fs,
        sha256Fn,
      });
      expect(r).toEqual([]);
    }
    expect(fs.store[elitesJson]).toBeUndefined();
  });

  it('use_elites: round 1 edits from the incumbent, round k>1 from the picked elite snapshot', async () => {
    const snap = path.join(GEMMA_DIR, 'elites', 'elite-abc.js');
    const fs = makeFs({
      [PLANE]: 'INC',
      [snap]: 'ELITE',
      [path.join(GEMMA_DIR, 'elites.json')]: JSON.stringify([{ sha: 'sha:ELITE', total: 50, iter: 3, path: snap }]),
    });
    const seen = [];
    const actor = {
      runActorWithRetries: async ({ candidatePath }) => {
        seen.push(fs.readFileSync(candidatePath)); // the BASE each round edits from
        fs.writeFileSync(candidatePath, `EDIT-${seen.length}`);
        return { status: 'edited', changed: true, cost_usd: 0, ms: 1, attempts: [], claude_result_text: null };
      },
    };
    const step = await maybeRunBestOfNJudgeOnce(
      baseCtx(fs, actor, { config: cfg({ n: 2, useElites: true }), rng: () => 0 }),
    );
    expect(seen).toEqual(['INC', 'ELITE']); // round 1 incumbent, round 2 elite
    expect(step.info.promoted).toBe(true);
  });
});

describe('source shape: loop-runner wires judge-once behind the config flag', () => {
  const runnerSource = readFileSync(path.join(HERE, '..', 'loop-runner-terransoul.mjs'), 'utf8');

  it('imports the config loader + wiring seam', () => {
    expect(runnerSource).toContain("from './lib/best-of-n-judge-once.mjs'");
    expect(runnerSource).toContain("from './lib/best-of-n-judge-once-wiring.mjs'");
  });

  it('gates the step on the loaded config (default disabled)', () => {
    expect(runnerSource).toContain('loadBestOfNJudgeOnceConfig()');
    expect(runnerSource).toContain('judgeOnceCfg?.enabled');
    expect(runnerSource).toContain('maybeRunBestOfNJudgeOnce(');
  });

  it('keeps the direct single-edit call intact (byte-identical disabled path)', () => {
    expect(runnerSource).toContain('actorResult = await runActorWithRetries({');
  });

  it('JUDGE-CALL INVARIANT: the wiring module never imports a judge', () => {
    const wiringSource = readFileSync(path.join(HERE, 'best-of-n-judge-once-wiring.mjs'), 'utf8');
    expect(wiringSource).not.toMatch(/judge\/judge/);
    expect(wiringSource).not.toMatch(/judgeShots/);
  });
});
