# -*- coding: utf-8 -*-
"""Where does a sweep's wall-clock actually go? Find the optimisable time.

Sweeps are long and the instinct is to add workers, but that is rate-limited.
This ranks tasks by cost so the expensive minority is visible, and separates
the two kinds of expensive:

  * LEGITIMATELY LONG - the agent works the whole time and solves it. The only
    lever is a faster agent; nothing to reclaim.
  * TIMED OUT / ERRORED - the agent burns the FULL timeout and then scores 0.
    Every second of that is pure waste, and it is spent at the WORST possible
    rate: 5 attempts x full timeout on a task that yields nothing.

The second category is where a sweep is actually shortened. A task that times
out five times costs more than ten tasks that pass quickly.
"""
import json, glob, os, sys, statistics
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = os.environ.get('TB_JOBS_DIR', os.path.join(HERE, 'jobs-submit'))


def parse(s):
    try:
        return datetime.fromisoformat((s or '').replace('Z', ''))
    except Exception:
        return None


def main():
    rows = []
    for f in sorted(glob.glob(os.path.join(JOBS, '*', 'result.json'))):
        try:
            r = json.load(open(f))
        except Exception:
            continue
        st, fin = parse(r.get('started_at')), parse(r.get('finished_at'))
        if not st or not fin:
            continue
        s = r.get('stats', {})
        for ev in (s.get('evals') or {}).values():
            names, rewards = [], []
            for score, ns in (ev.get('reward_stats', {}).get('reward', {}) or {}).items():
                for n in ns:
                    names.append(n)
                    try:
                        rewards.append(float(score))
                    except Exception:
                        pass
            if not names:
                continue
            task = names[0].rsplit('__', 1)[0]
            dur = (fin - st).total_seconds()
            ntr = ev.get('n_trials') or len(names)
            nerr = s.get('n_errored_trials') or 0
            exc = list((ev.get('exception_stats') or {}).keys())
            passed = sum(1 for x in rewards if x >= 1)
            rows.append(dict(task=task, dur=dur, ntr=ntr, nerr=nerr, exc=exc,
                             passed=passed, started=r.get('started_at', '')))

    if not rows:
        print('no finished jobs under', JOBS)
        return 1

    # keep the newest job per task
    latest = {}
    for x in rows:
        if x['task'] not in latest or x['started'] > latest[x['task']]['started']:
            latest[x['task']] = x
    rows = sorted(latest.values(), key=lambda x: -x['dur'])

    total = sum(x['dur'] for x in rows)
    print('SWEEP TIME BREAKDOWN  (%d tasks, %.1f h of job wall-clock)'
          % (len(rows), total / 3600.0))
    print()
    print('  %-34s %8s %5s %6s %s' % ('task', 'job time', 'pass', 'per-att', 'note'))
    print('  ' + '-' * 78)
    for x in rows[:12]:
        per = x['dur'] / max(1, x['ntr'])
        note = ''
        if x['exc']:
            note = 'WASTED: ' + ','.join(x['exc'])[:34]
        elif x['passed'] == 0:
            note = 'all attempts failed'
        print('  %-34s %7.0fs %2d/%-2d %6.0fs %s'
              % (x['task'][:34], x['dur'], x['passed'], x['ntr'], per, note))

    # the reclaimable share
    wasted = [x for x in rows if x['exc'] or x['passed'] == 0]
    w_time = sum(x['dur'] for x in wasted)
    durs = [x['dur'] for x in rows]

    print()
    print('  median task : %.0fs      mean: %.0fs' % (statistics.median(durs), total / len(durs)))
    print('  slowest 10%% : %.0fs+  (%d task(s))'
          % (sorted(durs)[int(0.9 * len(durs))], max(1, len(durs) // 10)))
    print()
    print('  RECLAIMABLE — tasks that spent time and returned nothing')
    print('    %d task(s), %.1f h = %.0f%% of all job wall-clock'
          % (len(wasted), w_time / 3600.0, 100.0 * w_time / total if total else 0))
    for x in sorted(wasted, key=lambda y: -y['dur'])[:6]:
        print('      %-34s %6.0fs  %s'
              % (x['task'][:34], x['dur'], ','.join(x['exc']) or 'scored 0 on every attempt'))
    print()
    print('  A task that fails all 5 attempts costs the same as one that passes')
    print('  all 5, and yields nothing. Capping attempts once a task is provably')
    print('  hopeless is the only lever here that does not need more quota.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
