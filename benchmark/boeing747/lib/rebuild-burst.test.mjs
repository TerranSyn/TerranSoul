import { describe, expect, it } from 'vitest';
import {
  CONFIG_ANCHOR,
  CONFIG_JSON_MARKER,
  DEFAULT_ENABLED,
  DEFAULT_MAX_DEPTH,
  decideBurstAction,
  loadRebuildBurstConfig,
  parseRebuildBurstConfig,
} from './rebuild-burst.mjs';

const cfg = { enabled: true, maxDepth: 3 };

describe('decideBurstAction', () => {
  it('accept always banks and clears any live burst', () => {
    const idle = decideBurstAction({ decision: 'accept', escalationArmed: true, burst: null, ...cfg, iterNum: 10 });
    expect(idle).toMatchObject({ action: 'bank', burst: null });
    const live = decideBurstAction({
      decision: 'accept', escalationArmed: true,
      burst: { active: true, started_iter: 8, depth_used: 2 }, ...cfg, iterNum: 10,
    });
    expect(live.action).toBe('bank');
    expect(live.burst).toBeNull();
    expect(live.note).toContain('BANKED');
  });

  it('reject with escalation armed ENTERS a burst instead of restoring', () => {
    const d = decideBurstAction({ decision: 'reject', escalationArmed: true, burst: null, ...cfg, iterNum: 71 });
    expect(d.action).toBe('defer-restore');
    expect(d.burst).toMatchObject({ active: true, started_iter: 71, depth_used: 1 });
  });

  it('reject without escalation restores exactly as before (no burst)', () => {
    const d = decideBurstAction({ decision: 'reject', escalationArmed: false, burst: null, ...cfg, iterNum: 71 });
    expect(d).toMatchObject({ action: 'restore', burst: null });
  });

  it('reject inside a live burst defers until max_depth, then restores', () => {
    const mid = decideBurstAction({
      decision: 'reject', escalationArmed: true,
      burst: { active: true, started_iter: 71, depth_used: 1 }, ...cfg, iterNum: 72,
    });
    expect(mid.action).toBe('defer-restore');
    expect(mid.burst.depth_used).toBe(2);
    const last = decideBurstAction({
      decision: 'reject', escalationArmed: true,
      burst: { active: true, started_iter: 71, depth_used: 3 }, ...cfg, iterNum: 74,
    });
    expect(last.action).toBe('end-burst-restore');
    expect(last.burst).toBeNull();
    expect(last.note).toContain('exhausted');
  });

  it('burst continuation does not depend on the escalation flag staying up', () => {
    const d = decideBurstAction({
      decision: 'reject', escalationArmed: false,
      burst: { active: true, started_iter: 71, depth_used: 1 }, ...cfg, iterNum: 72,
    });
    expect(d.action).toBe('defer-restore');
  });

  it('within_noise keeps the file and rides an active burst unchanged', () => {
    const burst = { active: true, started_iter: 71, depth_used: 2 };
    const d = decideBurstAction({ decision: 'within_noise', escalationArmed: true, burst, ...cfg, iterNum: 73 });
    expect(d.action).toBe('keep');
    expect(d.burst).toEqual(burst);
  });

  it('disabled config never enters a burst', () => {
    const d = decideBurstAction({
      decision: 'reject', escalationArmed: true, burst: null,
      enabled: false, maxDepth: 3, iterNum: 71,
    });
    expect(d).toMatchObject({ action: 'restore', burst: null });
  });
});

describe('downgradeSameShaAccept (phantom-record guard)', async () => {
  const { downgradeSameShaAccept } = await import('./gemma-gate-wiring.mjs');

  it('downgrades an accept whose candidate is byte-identical to the banked best', () => {
    const d = downgradeSameShaAccept({ decision: 'accept', candidateSha: 'abc', bestSha: 'abc' });
    expect(d).toEqual({ decision: 'within_noise', downgraded: true });
  });

  it('leaves a genuine accept (different sha) untouched', () => {
    const d = downgradeSameShaAccept({ decision: 'accept', candidateSha: 'abc', bestSha: 'def' });
    expect(d).toEqual({ decision: 'accept', downgraded: false });
  });

  it('never touches rejects/within_noise and tolerates missing shas', () => {
    expect(downgradeSameShaAccept({ decision: 'reject', candidateSha: 'abc', bestSha: 'abc' }).downgraded).toBe(false);
    expect(downgradeSameShaAccept({ decision: 'accept', candidateSha: null, bestSha: 'abc' }).downgraded).toBe(false);
    expect(downgradeSameShaAccept({ decision: 'accept', candidateSha: 'abc', bestSha: null }).downgraded).toBe(false);
  });
});

describe('config parsing', () => {
  const row = `${CONFIG_ANCHOR}: ... ${CONFIG_JSON_MARKER} {"enabled": true, "max_depth": 4}`;

  it('parses a well-formed seed row', () => {
    expect(parseRebuildBurstConfig(row)).toEqual({ enabled: true, maxDepth: 4, source: 'seed' });
  });

  it('rejects malformed or out-of-range payloads', () => {
    expect(parseRebuildBurstConfig(`${CONFIG_ANCHOR} ${CONFIG_JSON_MARKER} {"enabled": "yes", "max_depth": 4}`)).toBeNull();
    expect(parseRebuildBurstConfig(`${CONFIG_ANCHOR} ${CONFIG_JSON_MARKER} {"enabled": true, "max_depth": 0}`)).toBeNull();
    expect(parseRebuildBurstConfig(`${CONFIG_ANCHOR} ${CONFIG_JSON_MARKER} {"enabled": true, "max_depth": 99}`)).toBeNull();
    expect(parseRebuildBurstConfig('no anchor here')).toBeNull();
  });

  it('loadRebuildBurstConfig fails open to the documented defaults', () => {
    const fromMissing = loadRebuildBurstConfig({ readFileSyncFn: () => { throw new Error('nope'); } });
    expect(fromMissing).toEqual({ enabled: DEFAULT_ENABLED, maxDepth: DEFAULT_MAX_DEPTH, source: 'default' });
    const fromSeed = loadRebuildBurstConfig({ readFileSyncFn: () => row });
    expect(fromSeed).toEqual({ enabled: true, maxDepth: 4, source: 'seed' });
  });
});
