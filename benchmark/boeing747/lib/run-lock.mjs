/**
 * Single-writer lock for a Boeing bench run.
 *
 * WHY THIS EXISTS. A real run (2026-07-13) was corrupted by two loop-runner processes
 * sharing one candidate directory. The lingering process and the relaunched one both
 * edited the same `candidates/<actor>/plane.js` and both wrote the same
 * `gate-state.json`, so an actor's Read-then-Edit interleaved with the other's write:
 * the reverted lessons from that run literally record "a concurrent process running
 * this same actor prompt rewrote the engine block between my Read and my Edit". The
 * iterations were unusable and the run was thrown away.
 *
 * The bench has no coordination of any kind — no lock, no PID file, no signal handler
 * anywhere under benchmark/boeing747. One writer per candidate plane is an invariant
 * the harness must ENFORCE, not one the operator must remember.
 *
 * This is also a hard prerequisite for --best-of-n: best-of-n multiplies an iteration's
 * wall-clock several-fold, which widens exactly the window in which an operator, seeing
 * no output, concludes the run has hung and starts a second one.
 *
 * DESIGN NOTES
 * - The lock key is the resolved candidate plane path: that is the file two runs would
 *   actually corrupt. Two runs with different --actor but the same --plane still collide,
 *   so keying on the actor name alone would not be enough.
 * - Stale locks must be reclaimable. Nothing under benchmark/boeing747 registers a
 *   SIGINT/SIGTERM handler, so Ctrl-C on a long bench kills the process without running
 *   any cleanup — a lock that could not be reclaimed after a kill would brick the bench
 *   on the very failure that is most common. We therefore record the PID and treat a
 *   lock whose process is gone as free.
 * - We do NOT try to be robust against PID reuse across a reboot. The lock also stores
 *   the boot-independent start time we can cheaply check (process existence is enough in
 *   practice for a single-machine bench harness); the honest limit is stated rather than
 *   papered over.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Is a process with this pid alive? signal 0 checks existence without delivering. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to another user — alive for our purposes.
    return err?.code === 'EPERM';
  }
}

export function lockPathFor(candidatePath) {
  const resolved = path.resolve(candidatePath);
  return path.join(path.dirname(resolved), '.bench-run.lock');
}

/**
 * Acquire the single-writer lock for a candidate plane.
 * @returns {{ok:true, release:() => void, lockPath:string}
 *          | {ok:false, reason:string, holder:{pid:number, actor?:string, runId?:string, startedAt?:string}}}
 */
export function acquireRunLock({ candidatePath, actorName, runId, pid = process.pid, now = null } = {}) {
  if (!candidatePath) throw new Error('acquireRunLock requires candidatePath');
  const lockPath = lockPathFor(candidatePath);
  mkdirSync(path.dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    let holder;
    try {
      holder = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      holder = null; // an unparseable lock is a dead lock
    }
    if (holder && pidAlive(holder.pid) && holder.pid !== pid) {
      return {
        ok: false,
        reason:
          `another bench run (pid ${holder.pid}${holder.actor ? `, actor ${holder.actor}` : ''}) already owns ` +
          `${path.basename(path.dirname(path.resolve(candidatePath)))}/plane.js. ` +
          `One writer per candidate: a second run corrupts the plane mid-edit and clobbers gate-state.json. ` +
          `Stop that run, or delete ${lockPath} if you are certain it is dead.`,
        holder,
      };
    }
    // stale (dead pid, or our own re-entry): reclaim it
    try {
      rmSync(lockPath, { force: true });
    } catch {
      /* fall through; the write below will overwrite it anyway */
    }
  }

  const record = {
    pid,
    actor: actorName ?? null,
    runId: runId ?? null,
    candidate: path.resolve(candidatePath),
    startedAt: now ?? new Date().toISOString(),
  };
  writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      // only remove a lock we still own — never delete someone else's
      const current = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (current.pid === pid) rmSync(lockPath, { force: true });
    } catch {
      /* already gone, or unreadable: nothing to do */
    }
  };

  return { ok: true, release, lockPath };
}
