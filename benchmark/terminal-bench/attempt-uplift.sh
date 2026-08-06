#!/usr/bin/env bash
# ATTRIBUTION: does a lesson written by attempt 1 help attempts 2..k of the SAME task?
#
#   usage: attempt-uplift.sh <jobs-dir> [prefix ...]
#
# WHY THIS EXISTS. Every witness built so far proves the brain was CALLED (searches
# forwarded, writes accepted, memory_total climbing). None of them proves the brain
# HELPED. Aggregate pass-rate against the leaderboard cannot settle it either: there
# is no Claude Code + Opus 5 baseline published, so a good score is indistinguishable
# from "Opus 5 is simply better than Opus 4.8".
#
# The owner's design closes that without a separate control arm. Run k=5 with
# cross-attempt learning ENABLED, and each task becomes its own paired experiment:
#
#     attempt 1     no lesson for THIS task can exist yet  -> the control
#     attempts 2..k attempt 1's lesson is readable         -> the treatment
#
# ⚠️ THE NUMBER THIS PRODUCES IS NOT A LEADERBOARD NUMBER. A pass@5 where attempt 1
# teaches attempts 2..5 is not comparable to entries without cross-attempt learning —
# that is the leakage rules/tbench-playbook.md forbids for a SCORE. It is legitimate as
# an EXPERIMENT, and the comparable figure is the attempt-1-only rate printed below.
#
# TWO ASSUMPTIONS, both verified on job dg-20260804-182446 before this was written:
#   1. Attempts run SEQUENTIALLY. Measured starts for one task's 5 attempts:
#      18:24:47 -> 18:45:35 -> 19:03:14 -> 19:10:30 -> 19:19:07, no overlap. Had they
#      run concurrently, attempt 1's lesson would not exist when attempt 2 started and
#      the whole design would silently return a null result.
#   2. Attempt ORDER is recoverable. harbor's trial ids carry a RANDOM suffix
#      (bn-fit-modify__PGPwJS4) with no attempt index, so ordering comes from the
#      earliest file mtime inside each trial directory.
#
# CONFOUND, stated because it is the whole reason the trajectory analysis matters: a
# later attempt can also succeed by plain retry luck. Uplift alone cannot separate
# "the lesson helped" from "the second roll landed". This script measures the effect;
# the trajectory linkage establishes the mechanism. Report both or neither.
set -uo pipefail

# Python here writes report text containing non-ASCII glyphs (arrows, +/-).
# Windows Python defaults stdout to cp1252, so an un-guarded run either CRASHES
# mid-report (self-improve-rate.sh died with UnicodeEncodeError after printing
# only its first line) or emits mojibake (attempt-uplift.sh printed a literal
# replacement char). merge-sweep.sh produces the HEADLINE NUMBER, so a crash
# there truncates the very result the campaign exists to report. The sweep
# drivers inherit this from run-parallel.sh, but not when run standalone.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
JOBS="${1:?usage: attempt-uplift.sh <jobs-dir> [prefix ...]}"
shift || true
PREFIXES=("$@")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
if [ "${#PREFIXES[@]}" -eq 0 ] && [ -f "$REPO/mcp-data/.tb-sweep-prefixes.txt" ]; then
  while IFS= read -r l; do [ -n "$l" ] && PREFIXES+=("$l"); done < <(sort -u "$REPO/mcp-data/.tb-sweep-prefixes.txt")
fi
[ "${#PREFIXES[@]}" -eq 0 ] && PREFIXES=("")

python - "$JOBS" "${PREFIXES[@]}" <<'PY'
import json, os, sys, glob
from collections import defaultdict

jobs_dir = sys.argv[1]
prefixes = [p for p in sys.argv[2:]] or [""]

def span(d):
    """(start, end) of a trial from its files. The directory's own mtime moves as
    files are written, so the earliest file inside it is the honest start marker
    and the latest is the finish."""
    lo = hi = None
    for root, _dirs, files in os.walk(d):
        for f in files:
            try:
                t = os.path.getmtime(os.path.join(root, f))
            except OSError:
                continue
            if lo is None or t < lo: lo = t
            if hi is None or t > hi: hi = t
    if lo is None:
        m = os.path.getmtime(d)
        return m, m
    return lo, hi

# task -> [(start_time, trial_id, reward, errored)]
trials = defaultdict(list)
seen = set()
for prefix in prefixes:
    for rj in sorted(glob.glob(os.path.join(jobs_dir, prefix + "*", "result.json"))):
        if rj in seen:
            continue
        seen.add(rj)
        try:
            with open(rj, encoding="utf-8", errors="replace") as fh:
                d = json.load(fh)
        except Exception:
            continue
        job = os.path.dirname(rj)
        for ev in ((d.get("stats") or {}).get("evals") or {}).values():
            bad = set()
            for _exc, ids in (ev.get("exception_stats") or {}).items():
                bad.update(ids)
            for score, ids in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
                for tid in ids:
                    task = tid.rsplit("__", 1)[0]
                    tdir = os.path.join(job, tid)
                    if os.path.isdir(tdir):
                        start, end = span(tdir)
                    else:
                        start = end = os.path.getmtime(rj)
                    trials[task].append((start, tid, float(score), tid in bad, end - start))

first_pass = first_n = later_pass = later_n = 0
rescued, regressed, single = [], [], 0
for task, rows in sorted(trials.items()):
    rows.sort(key=lambda r: r[0])            # chronological = attempt order
    if len(rows) < 2:
        single += 1
    for idx, (_start, _tid, score, errored, _dur) in enumerate(rows, start=1):
        solved = (score >= 1.0) and not errored
        if idx == 1:
            first_n += 1; first_pass += int(solved)
        else:
            later_n += 1; later_pass += int(solved)
    if len(rows) >= 2:
        a1 = (rows[0][2] >= 1.0) and not rows[0][3]
        rest = [(r[2] >= 1.0) and not r[3] for r in rows[1:]]
        if not a1 and any(rest):
            rescued.append(task)            # attempt 1 failed, memory-era attempt solved it
        if a1 and not all(rest):
            regressed.append(task)

def pct(a, b):
    return f"{100.0*a/b:.1f}%" if b else "n/a"

print(f"  tasks analysed        : {len(trials)}  ({single} with only ONE attempt — no uplift signal)")
print(f"  attempt 1  (control)  : {first_pass}/{first_n}  {pct(first_pass, first_n)}")
print(f"  attempts 2+ (treated) : {later_pass}/{later_n}  {pct(later_pass, later_n)}")
if first_n and later_n:
    d = 100.0*later_pass/later_n - 100.0*first_pass/first_n
    print(f"  UPLIFT                : {d:+.1f} pp")
    # Binomial SE on the difference of two independent proportions.
    p1, p2 = first_pass/first_n, later_pass/later_n
    se = ((p1*(1-p1)/first_n) + (p2*(1-p2)/later_n)) ** 0.5 * 100
    print(f"  std error on uplift   : +/-{se:.1f} pp   -> {'RESOLVABLE' if abs(d) > 2*se else 'INDISTINGUISHABLE FROM NOISE'}")
# ── RUNTIME, the higher-powered signal ───────────────────────────────────
# Owner's insight: with memory, attempts 2..k should not merely pass more often,
# they should FINISH SOONER — the agent skips the dead ends attempt 1 paid for.
# Runtime is continuous, so a paired per-task comparison has far more statistical
# power than a binary pass/fail at this sample size, where the pass-rate uplift is
# swamped by its own standard error.
import statistics
paired = []
for task, rows in sorted(trials.items()):
    if len(rows) < 2:
        continue
    a1 = rows[0]
    rest = rows[1:]
    # Compare like with like: only tasks SOLVED in attempt 1 and in at least one
    # later attempt. A failed attempt's runtime is a timeout, not a solve time.
    if not ((a1[2] >= 1.0) and not a1[3]):
        continue
    later_ok = [r for r in rest if (r[2] >= 1.0) and not r[3]]
    if not later_ok:
        continue
    paired.append((task, a1[4], statistics.median(r[4] for r in later_ok)))
print("")
if paired:
    d1 = statistics.median(p[1] for p in paired)
    d2 = statistics.median(p[2] for p in paired)
    faster = sum(1 for p in paired if p[2] < p[1])
    print(f"  runtime, tasks solved in BOTH attempt 1 and a later attempt : n={len(paired)}")
    print(f"    attempt 1  median : {d1/60:.1f} min")
    print(f"    attempts 2+ median: {d2/60:.1f} min")
    print(f"    change            : {100.0*(d2-d1)/d1:+.1f}%   ({faster}/{len(paired)} tasks finished faster with memory)")
    print("    a sign test needs ~6+ paired tasks before this means anything")
else:
    print("  runtime: no task yet solved in BOTH attempt 1 and a later attempt (needs k>1)")
print(f"  rescued by a later attempt : {len(rescued)}" + (f"  {rescued[:8]}" if rescued else ""))
print(f"  attempt 1 solved, later failed : {len(regressed)}" + (f"  {regressed[:8]}" if regressed else ""))
print("")
print("  attempt 1 is the LEADERBOARD-COMPARABLE figure: no lesson for its own task")
print("  existed yet. The attempts-2+ rate is an experiment, not a submittable score.")
print("  Uplift alone cannot separate 'the lesson helped' from 'the retry got lucky' —")
print("  pair it with the trajectory evidence that a retrieved lesson was actually used.")
PY
