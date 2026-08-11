# -*- coding: utf-8 -*-
"""Measure brain-call latency from the proxy log: p50 / p95 / p99 per tool.

WHY THIS IS MEASURABLE WITHOUT NEW INSTRUMENTATION. mcp-auth-proxy logs two
lines per call — the request, `{"tool":"brain_search",...,"at":T1}`, and the
verdict, `{"name":"brain_search","verdict":"accepted","at":T2}`. T2-T1 is the
end-to-end latency the agent actually waited, including retrieval, any model
work, and — critically — a VRAM reload if the model had been evicted.

WHY THE RELOAD CASE IS THE WHOLE POINT. gpu-polite.sh unloads the model when
the GPU goes idle so the owner's other applications can use the card. That is
only acceptable if the reload comes from the OS page cache rather than disk.
This script separates the two populations instead of averaging them away: a
handful of multi-second outliers among fast calls is the reload signature, and
it is exactly what a p99 target catches and a p50 hides.

Owner's bar: p99 < 1 s.
"""
import re, json, glob, os, sys, statistics
from datetime import datetime

LOGS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    '..', '..', 'mcp-data', 'logs')
REQ = re.compile(r'\{"tool":"([a-z_]+)".*?"at":"([0-9T:.\-]+Z)"\}')
RES = re.compile(r'\{"name":"([a-z_]+)","verdict":"([a-z-]+)".*?"at":"([0-9T:.\-]+Z)"\}')


def ts(s):
    try:
        return datetime.strptime(s, '%Y-%m-%dT%H:%M:%S.%fZ')
    except ValueError:
        return None


def pct(xs, p):
    if not xs:
        return float('nan')
    xs = sorted(xs)
    k = min(len(xs) - 1, int(round((p / 100.0) * (len(xs) - 1))))
    return xs[k]


def main():
    per = {}
    files = sorted(glob.glob(os.path.join(LOGS, 'tbench-par*.log')) +
                   glob.glob(os.path.join(LOGS, 'archive-par*.log')))
    if not files:
        print('no proxy logs found under', LOGS)
        return 1

    for f in files:
        pending = {}
        try:
            fh = open(f, encoding='utf-8', errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                m = REQ.search(line)
                if m:
                    t = ts(m.group(2))
                    if t:
                        pending.setdefault(m.group(1), []).append(t)
                    continue
                m = RES.search(line)
                if m:
                    tool, verdict, t2 = m.group(1), m.group(2), ts(m.group(3))
                    q = pending.get(tool)
                    if q and t2:
                        t1 = q.pop(0)
                        d = (t2 - t1).total_seconds()
                        # A negative or absurd delta means the log interleaved
                        # two workers' lines; drop rather than pollute the tail.
                        if 0 <= d < 600:
                            per.setdefault(tool, []).append(d)

    if not per:
        print('no completed brain calls parsed yet')
        return 1

    print('BRAIN CALL LATENCY  (from proxy request -> verdict)')
    print('owner bar: p99 < 1.000 s')
    print()
    print('  %-24s %6s %8s %8s %8s %8s %8s' %
          ('tool', 'n', 'p50', 'p95', 'p99', 'max', 'over1s'))
    print('  ' + '-' * 74)

    all_d = []
    worst = None
    for tool in sorted(per, key=lambda k: -len(per[k])):
        d = per[tool]
        all_d += d
        over = sum(1 for x in d if x > 1.0)
        p99 = pct(d, 99)
        flag = '' if p99 < 1.0 else '   <-- OVER BAR'
        print('  %-24s %6d %7.3fs %7.3fs %7.3fs %7.3fs %5d%s'
              % (tool, len(d), pct(d, 50), pct(d, 95), p99, max(d), over, flag))
        if worst is None or p99 > worst[1]:
            worst = (tool, p99)

    print()
    p99all = pct(all_d, 99)
    over = [x for x in all_d if x > 1.0]
    print('  ALL CALLS  n=%d  p50=%.3fs  p99=%.3fs  max=%.3fs'
          % (len(all_d), pct(all_d, 50), p99all, max(all_d)))
    print('  calls over 1s: %d of %d (%.2f%%)'
          % (len(over), len(all_d), 100.0 * len(over) / len(all_d)))

    if p99all < 1.0:
        print('  => MEETS the p99 < 1s bar')
    else:
        print('  => FAILS the p99 < 1s bar (worst tool: %s at %.3fs)' % worst)
        if over:
            print('  slowest calls, which is where a VRAM reload would show:')
            for x in sorted(over, reverse=True)[:5]:
                print('     %.3fs' % x)
    return 0


if __name__ == '__main__':
    sys.exit(main())
