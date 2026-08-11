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

# ⛔ THE ATTEMPT UNIT IS THE JOB, NOT THE TASK.
#
# `run-sweep.par.sh` runs ONE harbor job per task carrying all k attempts back
# to back (TB_ONE_JOB_PER_TASK=1, TB_CONCURRENCY=1), so "attempt 1 has no lesson
# for its own task yet" is a property of a JOB, not of a task name. A task that
# was re-run gets a SECOND job with its own fresh attempt 1 — and keying by task
# pools the two, filing every re-run's attempt 1 into the "attempts 2+" bucket.
#
# That is not a rounding difference, it inverts the result. On the 2026-08-07
# corpus (52 jobs; 30 tasks x5, 5 tasks x10, 2 tasks x30):
#
#     per-TASK indexing : attempt 1 93.9% vs attempts 2+ 88.2%  =  -5.7 pp
#     per-JOB indexing  : jidx1     87.5% vs jidx>=2     89.6%  =  +2.1 pp
#     first 5 per task  : attempt 1 93.9% vs attempts 2-5 97.6% =  +3.7 pp
#
# The re-run tasks are exactly the pathological ones (`extract-moves-from-video`
# at 30 trials, `filter-js-from-html` at 30), so pooling loads the treatment arm
# with the hardest task's every restart. Their fresh attempt-1 failures were
# being counted as memory failing to help.
#
# It also explains an error pattern that looked meaningful and is not. Keyed by
# task, errors appear to climb with attempt index; keyed by JOB they are flat —
# 12 / 11 / 10 / 9 / 15 across the five positions. ApiRateLimitError alone IS
# still graded (2 / 5 / 4 / 5 / 9), which is real quota drain across a job's
# five back-to-back attempts, but it is one error class, not the whole trend.
#
# (job_dir, task) -> [(start_time, trial_id, reward, errored, duration)]
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
                    trials[(job, task)].append((start, tid, float(score), tid in bad, end - start))

# ── HOW ERRORED TRIALS ARE COUNTED, AND WHY IT DECIDES THE ANSWER ──────────
#
# An errored trial is a HARNESS failure — ApiRateLimitError, NetworkConnection-
# Error, a token that expired mid-task. It is not the agent failing to solve the
# task, and it is not memory failing to help.
#
# This script used to count them in the DENOMINATOR as treatment failures:
#     solved = (score >= 1.0) and not errored     # errored -> counted, as a miss
# which is only defensible if errors fall evenly across attempts. On the
# 2026-08-07 jobs-submit corpus they did not: 3 in attempt 1 against 17 in
# attempts 2-5 (a1=3 a2=3 a3=4 a4=5 a5=5).
#
# ⚠️ BE CAREFUL WITH THE MECHANISM. The tempting story — "request volume rises
# with attempt index, so later attempts get rate-limited more" — is only true of
# ONE error class. An independent re-derivation over a 260-trial extraction
# found total errors essentially FLAT by within-job position (12/11/10/9/15)
# while ApiRateLimitError alone WAS graded (2/5/4/5/9). So quota drain across a
# job's five back-to-back attempts is real, and it is not the whole trend; the
# rest is task composition. Do not restate the general claim.
#
# Either way, charging harness failures to the treatment arm biases the uplift
# downward, and the correction is not cosmetic: combined with the per-JOB
# indexing fix above, the headline moved from -9.6 pp to +9.7 pp. Both defects
# pushed the same direction, which is how "memory does not help" survived as
# long as it did.
#
# So the PRIMARY figure now excludes errored trials, and the old inclusive
# figure is kept as an explicit pessimistic bound. The playbook already required
# this of the headline mean ("re-run or exclude errored trials, and state which
# you did"); the attribution metric never got the same treatment.
first_pass = first_n = later_pass = later_n = 0           # errored EXCLUDED (primary)
inc_first_pass = inc_first_n = inc_later_pass = inc_later_n = 0   # errored as failures
err_by_attempt = {}
rescued, regressed, single = set(), set(), 0
# Headroom strata. Memory can only demonstrate uplift where attempt 1 FAILED;
# a task attempt 1 already solved gives it nothing to improve, so those tasks
# contribute only downside from retry variance.
stratA_pass = stratA_n = stratB_pass = stratB_n = 0        # A: att1 passed, B: att1 failed
for (job, task), rows in sorted(trials.items()):
    rows.sort(key=lambda r: r[0])            # chronological = attempt order WITHIN the job
    if len(rows) < 2:
        single += 1
    for idx, (_start, _tid, score, errored, _dur) in enumerate(rows, start=1):
        if errored:
            err_by_attempt[idx] = err_by_attempt.get(idx, 0) + 1
        solved = (score >= 1.0) and not errored
        if idx == 1:
            inc_first_n += 1; inc_first_pass += int(solved)
            if not errored:
                first_n += 1; first_pass += int(score >= 1.0)
        else:
            inc_later_n += 1; inc_later_pass += int(solved)
            if not errored:
                later_n += 1; later_pass += int(score >= 1.0)
    if len(rows) >= 2:
        a1_err = rows[0][3]
        a1 = (rows[0][2] >= 1.0) and not a1_err
        # Later attempts, HARNESS FAILURES REMOVED. A rate-limited attempt 3 is
        # not evidence that attempt 1's lesson failed to transfer.
        rest_clean = [(r[2] >= 1.0) for r in rows[1:] if not r[3]]
        if not a1_err:
            for solved_later in rest_clean:
                if a1:
                    stratA_n += 1; stratA_pass += int(solved_later)
                else:
                    stratB_n += 1; stratB_pass += int(solved_later)
        if not a1 and not a1_err and any(rest_clean):
            rescued.add(task)               # attempt 1 failed, memory-era attempt solved it
        if a1 and rest_clean and not all(rest_clean):
            regressed.add(task)

def pct(a, b):
    return f"{100.0*a/b:.1f}%" if b else "n/a"

def uplift(fp, fn, lp, ln, label):
    if not (fn and ln):
        return
    d = 100.0*lp/ln - 100.0*fp/fn
    p1, p2 = fp/fn, lp/ln
    se = ((p1*(1-p1)/fn) + (p2*(1-p2)/ln)) ** 0.5 * 100
    verdict = 'RESOLVABLE' if abs(d) > 2*se else 'INDISTINGUISHABLE FROM NOISE'
    print(f"  {label:<21}: {d:+.1f} pp   +/-{se:.1f} pp   -> {verdict}")

n_err = sum(err_by_attempt.values())
print(f"  jobs analysed         : {len(trials)} job(s) over {len({t for _j, t in trials})} distinct task(s)")
print(f"                          ({single} job(s) with only ONE attempt — no uplift signal)")
print(f"  trials                : {inc_first_n + inc_later_n}  ({first_n + later_n} clean, {n_err} ERRORED)")
if n_err:
    spread = "  ".join(f"a{k}={v}" for k, v in sorted(err_by_attempt.items()))
    print(f"  errored by attempt    : {spread}")
    later_err = sum(v for k, v in err_by_attempt.items() if k > 1)
    if later_err > err_by_attempt.get(1, 0):
        print(f"     ^ {later_err} of {n_err} land in attempts 2+ — harness errors bias uplift DOWNWARD;")
        print(f"       they are EXCLUDED below, which is why the primary figure differs from the bound")
print()
print("  ── pass rate, errored trials EXCLUDED (PRIMARY) ──")
print(f"  job-attempt 1 (control): {first_pass}/{first_n}  {pct(first_pass, first_n)}")
print(f"  job-attempts 2+ (treat): {later_pass}/{later_n}  {pct(later_pass, later_n)}")
uplift(first_pass, first_n, later_pass, later_n, "UPLIFT")
print("  ── pass rate, errored counted as failures (PESSIMISTIC BOUND) ──")
uplift(inc_first_pass, inc_first_n, inc_later_pass, inc_later_n, "uplift (bound)")

# ── HEADROOM. The uplift above averages two populations that cannot behave the
# same way, and on a saturated sample the no-headroom one dominates it.
print()
print("  ── HEADROOM: where uplift can and cannot appear ──")
print(f"    A. attempt 1 PASSED -> later attempts {stratA_pass}/{stratA_n} {pct(stratA_pass, stratA_n)}")
print(f"       no headroom: memory cannot improve on a solved task, only retry variance can lose it")
print(f"    B. attempt 1 FAILED -> later attempts {stratB_pass}/{stratB_n} {pct(stratB_pass, stratB_n)}")
print(f"       THIS is the population the experiment is about")
if first_n:
    ceiling = 100.0 * (first_n - first_pass) / first_n
    print(f"    arithmetic ceiling on the pooled uplift with {first_pass}/{first_n} attempt-1 passes:")
    print(f"       at most {ceiling:+.1f} pp — a pooled figure near zero is EXPECTED here, not evidence")
if stratB_n == 0:
    print("    => stratum B is EMPTY. This corpus cannot answer whether memory helps;")
    print("       that is an ABSENT result, not a negative one. Needs harder tasks.")
elif stratB_n < 10:
    print(f"    => stratum B has only {stratB_n} trial(s) — far too few to resolve any effect.")
# ── RUNTIME, the higher-powered signal ───────────────────────────────────
# Owner's insight: with memory, attempts 2..k should not merely pass more often,
# they should FINISH SOONER — the agent skips the dead ends attempt 1 paid for.
# Runtime is continuous, so a paired per-task comparison has far more statistical
# power than a binary pass/fail at this sample size, where the pass-rate uplift is
# swamped by its own standard error.
import statistics
paired = []
for (job, task), rows in sorted(trials.items()):
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
    # A zero attempt-1 median is possible whenever the mtime proxy collapses —
    # a trial whose files all carry one timestamp, or a corpus small enough that
    # the median lands on such a trial. Dividing by it raised ZeroDivisionError
    # and killed the report AT THIS LINE, taking the rescued/regressed lists and
    # the closing caveats with it. Same failure shape the UnicodeEncodeError
    # guard at the top of this file exists for: a crash in the reporter destroys
    # the result the campaign exists to produce, so the reporter must not crash.
    if d1 > 0:
        print(f"    change            : {100.0*(d2-d1)/d1:+.1f}%   ({faster}/{len(paired)} tasks finished faster with memory)")
    else:
        print(f"    change            : n/a (attempt-1 median is 0s — the mtime proxy has no resolution here)")
    print("    a sign test needs ~6+ paired tasks before this means anything")
else:
    print("  runtime: no task yet solved in BOTH attempt 1 and a later attempt (needs k>1)")
print(f"  rescued by a later attempt : {len(rescued)}" + (f"  {sorted(rescued)[:8]}" if rescued else ""))
print(f"  attempt 1 solved, later failed : {len(regressed)}" + (f"  {sorted(regressed)[:8]}" if regressed else ""))
print("")
print("  attempt 1 is the LEADERBOARD-COMPARABLE figure: no lesson for its own task")
print("  existed yet. The attempts-2+ rate is an experiment, not a submittable score.")
print("  Uplift alone cannot separate 'the lesson helped' from 'the retry got lucky' —")
print("  pair it with the trajectory evidence that a retrieved lesson was actually used.")
PY
