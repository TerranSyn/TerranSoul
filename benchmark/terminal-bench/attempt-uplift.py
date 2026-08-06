# -*- coding: utf-8 -*-
"""Measure the attempts-2-5 uplift: the attribution signal for cross-attempt memory.

THE CLAIM UNDER TEST. With TB_DEFER_WRITES=0, attempt 1 of a task writes lessons
that attempts 2-5 of the SAME task can read. If memory is doing anything, later
attempts should be FASTER (the agent stops re-deriving what attempt 1 learned)
and at least as accurate. If they are not, memory is not paying for itself
within a task and the root cause is worth chasing.

HOW DURATION IS DERIVED, and why it is a proxy. result.json records start/finish
for the JOB, and reward per TRIAL, but no per-attempt clock. Attempts run
sequentially (TB_ONE_JOB_PER_TASK=1, TB_CONCURRENCY=1), so consecutive trial
directory mtimes are the attempt boundaries: attempt 1 spans job start -> first
trial mtime, attempt N spans mtime(N-1) -> mtime(N).

That is a PROXY and it is stated as one. It inherits any filesystem clock skew,
and a trial whose directory is touched after completion would be over-counted.
It is good enough to answer "are later attempts markedly faster", which is a
large effect, and not good enough to publish a precise per-attempt latency.

Wall-clock is also contention-sensitive: three workers share this machine, so
compare attempt 1 against attempts 2-5 WITHIN a task (same contention regime),
never across tasks.
"""
import json, os, glob, sys, datetime, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = os.environ.get('TB_JOBS_DIR', os.path.join(HERE, 'jobs-submit'))


def parse_iso(s):
    try:
        return datetime.datetime.fromisoformat(s.replace('Z', ''))
    except Exception:
        return None


def main():
    rows = []
    for jd in sorted(glob.glob(os.path.join(JOBS, '*'))):
        rj = os.path.join(jd, 'result.json')
        if not os.path.isdir(jd) or not os.path.exists(rj):
            continue
        try:
            r = json.load(open(rj))
        except Exception:
            continue

        start = parse_iso(r.get('started_at') or '')
        if not start:
            continue

        # reward per trial name, so we can pair duration with outcome
        reward = {}
        for ev in r.get('stats', {}).get('evals', {}).values():
            for score, names in (ev.get('reward_stats', {}).get('reward', {}) or {}).items():
                for n in names:
                    try:
                        reward[n] = float(score)
                    except Exception:
                        pass

        trials = [d for d in glob.glob(os.path.join(jd, '*__*')) if os.path.isdir(d)]
        if len(trials) < 2:
            continue
        trials.sort(key=lambda d: os.path.getmtime(d))

        task = os.path.basename(trials[0]).rsplit('__', 1)[0]
        prev = start.timestamp()
        seq = []
        for t in trials:
            m = os.path.getmtime(t)
            seq.append((os.path.basename(t), max(0.0, m - prev), reward.get(os.path.basename(t))))
            prev = m
        rows.append((task, seq))

    if not rows:
        print('no completed multi-attempt tasks yet under', JOBS)
        return 1

    print('ATTEMPT-2..N UPLIFT  (n=%d tasks with >=2 attempts)' % len(rows))
    print('duration is a PROXY from trial-dir mtimes; compare WITHIN a task only')
    print()
    print('  %-34s %9s %9s %8s  %s' % ('task', 'att1', 'att2+avg', 'speedup', 'rewards'))
    print('  ' + '-' * 78)

    ratios, first_r, later_r = [], [], []
    for task, seq in rows:
        a1 = seq[0][1]
        rest = [d for _, d, _ in seq[1:]]
        if not rest or a1 <= 0:
            continue
        avg = sum(rest) / len(rest)
        ratio = a1 / avg if avg > 0 else float('nan')
        ratios.append(ratio)
        if seq[0][2] is not None:
            first_r.append(seq[0][2])
        later_r += [x for _, _, x in seq[1:] if x is not None]
        rw = ''.join('.' if r is None else ('1' if r >= 1 else '0') for _, _, r in seq)
        print('  %-34s %8.1fs %8.1fs %7.2fx  %s' % (task[:34], a1, avg, ratio, rw))

    print()
    if ratios:
        med = statistics.median(ratios)
        print('  median speedup attempts 2+ vs attempt 1 : %.2fx' % med)
        print('  faster on %d of %d tasks' % (sum(1 for r in ratios if r > 1), len(ratios)))
        if med > 1.15:
            print('  => later attempts ARE materially faster: cross-attempt memory is paying off')
        elif med < 0.87:
            print('  => later attempts are SLOWER. Root cause needed: memory should not cost time.')
        else:
            print('  => no material difference yet (within noise). Needs more tasks, or memory')
            print('     is not being retrieved on the attempt-2+ path - worth tracing.')
    if first_r and later_r:
        print('  reward  attempt1=%.2f   attempts2+=%.2f' % (
            sum(first_r) / len(first_r), sum(later_r) / len(later_r)))

    # ---- RECOVERY, which is the metric that can actually move -------------
    # Speed is the wrong headline here. Terminal-Bench wall-clock is dominated
    # by compiling and running things, not by deliberation, so a lesson that
    # saves the agent a wrong turn barely dents the clock. And a task that
    # already passes on attempt 1 gives memory NO headroom at all - on those,
    # "no uplift" is a property of the sample, not evidence about memory.
    #
    # The question memory can actually answer is: when attempt 1 FAILS, do
    # later attempts recover? That is the population where a lesson written by
    # attempt 1 has something to contribute.
    saturated = recov = norecov = 0
    for task, seq in rows:
        rs = [r for _, _, r in seq if r is not None]
        if len(rs) < 2:
            continue
        if rs[0] >= 1:
            saturated += 1
        elif any(r >= 1 for r in rs[1:]):
            recov += 1
        else:
            norecov += 1

    print()
    print('  RECOVERY (the population where memory has headroom)')
    print('    attempt 1 already passed : %d task(s) - no headroom, excluded' % saturated)
    print('    attempt 1 failed, later attempt passed : %d' % recov)
    print('    attempt 1 failed, never recovered      : %d' % norecov)
    if recov + norecov == 0:
        print('    => NO measurable population yet. Every task with data passed first')
        print('       try, so this sweep cannot yet say whether memory helps. Not a')
        print('       negative result - an absent one. Re-run once harder tasks land.')
    else:
        print('    => recovery rate %.0f%% (n=%d)' % (
            100.0 * recov / (recov + norecov), recov + norecov))
    return 0


if __name__ == '__main__':
    sys.exit(main())
