import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { acquireRunLock, lockPathFor } from './run-lock.mjs';

const dirs = [];
function candidateDir() {
  const d = mkdtempSync(path.join(tmpdir(), 'boeing-lock-'));
  dirs.push(d);
  mkdirSync(path.join(d, 'candidates', 'actor-x'), { recursive: true });
  const plane = path.join(d, 'candidates', 'actor-x', 'plane.js');
  writeFileSync(plane, 'export function build() {}\n');
  return plane;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('boeing747 single-writer run lock', () => {
  it('lets a first run acquire the lock and writes the holder pid', () => {
    const plane = candidateDir();
    const lock = acquireRunLock({ candidatePath: plane, actorName: 'actor-x', runId: 'r1' });

    expect(lock.ok).toBe(true);
    const held = JSON.parse(readFileSync(lockPathFor(plane), 'utf8'));
    expect(held.pid).toBe(process.pid);
    expect(held.actor).toBe('actor-x');
    lock.release();
  });

  // THE regression: a concurrent second loop-runner corrupted a real run by editing the
  // same plane.js between the first run's Read and Edit, and clobbering gate-state.json.
  it('refuses a second, concurrent run on the same candidate plane', () => {
    const plane = candidateDir();
    const first = acquireRunLock({ candidatePath: plane, actorName: 'actor-x' });
    expect(first.ok).toBe(true);

    // a DIFFERENT live process (use this test process's own pid as the holder, and
    // present the newcomer as a different, also-live pid)
    const second = acquireRunLock({ candidatePath: plane, actorName: 'actor-x', pid: process.pid + 1 });

    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already owns/i);
    expect(second.holder.pid).toBe(process.pid);
    first.release();
  });

  // Two runs may pass different --actor but the same --plane; the file they would
  // corrupt is the plane, so the plane is the lock key.
  it('refuses a second run even under a different actor name, when the plane is shared', () => {
    const plane = candidateDir();
    const first = acquireRunLock({ candidatePath: plane, actorName: 'actor-x' });
    const second = acquireRunLock({ candidatePath: plane, actorName: 'actor-y', pid: process.pid + 1 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    first.release();
  });

  // Nothing in the harness handled SIGINT, so a Ctrl-C'd bench leaves a lock behind.
  // A lock that could not be reclaimed would brick the bench on its most common failure.
  it('reclaims a stale lock whose owning process is dead', () => {
    const plane = candidateDir();
    const deadPid = 999_999_999; // no such process
    writeFileSync(
      lockPathFor(plane),
      JSON.stringify({ pid: deadPid, actor: 'actor-x', startedAt: '2026-07-13T00:00:00.000Z' }),
    );

    const lock = acquireRunLock({ candidatePath: plane, actorName: 'actor-x' });

    expect(lock.ok).toBe(true);
    expect(JSON.parse(readFileSync(lockPathFor(plane), 'utf8')).pid).toBe(process.pid);
    lock.release();
  });

  it('reclaims an unparseable lock file rather than deadlocking', () => {
    const plane = candidateDir();
    writeFileSync(lockPathFor(plane), 'not json at all');

    const lock = acquireRunLock({ candidatePath: plane, actorName: 'actor-x' });

    expect(lock.ok).toBe(true);
    lock.release();
  });

  it('release() removes the lock, and never removes a lock owned by someone else', () => {
    const plane = candidateDir();
    const lock = acquireRunLock({ candidatePath: plane, actorName: 'actor-x' });
    lock.release();
    expect(existsSync(lockPathFor(plane))).toBe(false);

    // a live foreign holder must survive our release()
    const foreign = acquireRunLock({ candidatePath: plane, actorName: 'actor-y' });
    writeFileSync(
      lockPathFor(plane),
      JSON.stringify({ pid: process.pid + 1, actor: 'someone-else', startedAt: 'x' }),
    );
    foreign.release();
    expect(existsSync(lockPathFor(plane))).toBe(true);
    expect(JSON.parse(readFileSync(lockPathFor(plane), 'utf8')).actor).toBe('someone-else');
  });

  it('is idempotent: release() twice is safe', () => {
    const plane = candidateDir();
    const lock = acquireRunLock({ candidatePath: plane, actorName: 'actor-x' });
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });
});
