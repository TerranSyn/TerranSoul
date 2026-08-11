# -*- coding: utf-8 -*-
"""Attempts-2..5 uplift, indexed ACROSS jobs — the attribution signal for memory.

⛔ WHY THIS EXISTS ALONGSIDE attempt-uplift.py, WHICH REPORTS ZERO.

`attempt-uplift.py` counts attempts WITHIN one harbor job (`n_total_trials`).
That was right until the k=1-per-job change, which gives every attempt its OWN
job so the runner can inject the previous attempt's score between them. Since
then every job has exactly one trial, so the old tool sees "230 jobs with only
ONE attempt", finds an empty treatment arm, and concludes:

    "stratum B is EMPTY. This corpus cannot answer whether memory helps;
     that is an ABSENT result, not a negative one."

It is stated honestly and it is completely wrong — the corpus holds 46 tasks at
up to 5 attempts each. A measurement tool reporting "no signal" when the signal
is merely on a different axis is worse than one that crashes, because the
sentence above is quotable and reads like a finding.

THE CORRECT AXIS: group jobs by task, order by `started_at`, and the attempt
index is the position in that sequence. NOT directory mtime — `cp -r` rewrites
mtimes, and a trial dir touched after completion reorders the sequence silently.

STRATIFY, ALWAYS. Pooled uplift is dominated by tasks that passed on attempt 1,
where memory has no headroom to help and retry variance can only lose. The
experiment lives in stratum B: attempt 1 FAILED. Anything else averages the
question away.

WHAT THIS CANNOT SEPARATE: "the lesson helped" from "the retry got lucky". A
rescue is consistent with both. Pair it with trajectory evidence that a retrieved
lesson was actually used before claiming attribution.
"""
import glob
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TB_JOBS_DIR", "jobs-sonnet5")
QUAR = os.environ.get("TB_QUARANTINE_FILE", "")

quarantined = set()
if QUAR and os.path.exists(QUAR):
    quarantined = {ln.strip() for ln in open(QUAR, encoding="utf-8") if ln.strip()}

# task -> [(started_at, trial_id, passed)]
seq = defaultdict(list)
for rj in glob.glob(os.path.join(JOBS, "*", "result.json")):
    try:
        d = json.load(open(rj, encoding="utf-8"))
    except Exception:
        continue
    started = d.get("started_at") or ""
    for ev in ((d.get("stats") or {}).get("evals") or {}).values():
        for rew, ids in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
            for tid in ids:
                ok = float(rew) >= 1.0
                if tid in quarantined:
                    ok = False  # integrity-quarantined trials are worth 0
                seq[tid.split("__")[0]].append((started, tid, ok))

for t in seq:
    seq[t].sort()

# ── per attempt index ────────────────────────────────────────────────────
by_idx = defaultdict(lambda: [0, 0])
for t, rows in seq.items():
    for i, (_s, _tid, ok) in enumerate(rows, 1):
        by_idx[i][1] += 1
        if ok:
            by_idx[i][0] += 1

print("  jobs dir            : %s" % JOBS)
print("  tasks with >=1 attempt : %d   trials: %d"
      % (len(seq), sum(len(v) for v in seq.values())))
if quarantined:
    print("  integrity-quarantined  : %d trial(s) forced to 0" % len(quarantined))
print("")
print("  ── pass rate BY ATTEMPT INDEX ──")
for i in sorted(by_idx):
    p, n = by_idx[i]
    print("    attempt %d : %3d/%-3d  %5.1f%%" % (i, p, n, 100 * p / n if n else 0))

a1p, a1n = by_idx.get(1, [0, 0])
lat_p = sum(by_idx[i][0] for i in by_idx if i > 1)
lat_n = sum(by_idx[i][1] for i in by_idx if i > 1)
print("")
print("  attempt 1  (control) : %d/%d  %.1f%%" % (a1p, a1n, 100 * a1p / a1n if a1n else 0))
print("  attempts 2+ (treat)  : %d/%d  %.1f%%" % (lat_p, lat_n, 100 * lat_p / lat_n if lat_n else 0))
if a1n and lat_n:
    print("  pooled uplift        : %+.1f pp   <- DOMINATED by stratum A, see below"
          % (100 * lat_p / lat_n - 100 * a1p / a1n))

# ── stratified ───────────────────────────────────────────────────────────
A = [t for t, r in seq.items() if r and r[0][2]]          # attempt 1 passed
B = [t for t, r in seq.items() if r and not r[0][2]]      # attempt 1 failed
print("")
print("  ── STRATIFIED (this is where the experiment actually lives) ──")

a_p = sum(1 for t in A for _s, _i, ok in seq[t][1:] if ok)
a_n = sum(len(seq[t][1:]) for t in A)
print("    A. attempt 1 PASSED  : %d task(s); later attempts %d/%d %.1f%%"
      % (len(A), a_p, a_n, 100 * a_p / a_n if a_n else 0))
print("       no headroom — memory cannot improve a solved task, only variance can lose it")

b_p = sum(1 for t in B for _s, _i, ok in seq[t][1:] if ok)
b_n = sum(len(seq[t][1:]) for t in B)
print("    B. attempt 1 FAILED  : %d task(s); later attempts %d/%d %.1f%%   <- THE SIGNAL"
      % (len(B), b_p, b_n, 100 * b_p / b_n if b_n else 0))

rescued = [t for t in B if any(ok for _s, _i, ok in seq[t][1:])]
lost = [t for t in A if not all(ok for _s, _i, ok in seq[t][1:]) and len(seq[t]) > 1]
print("")
print("    RESCUED (failed attempt 1, passed later) : %d/%d = %.0f%% of stratum B"
      % (len(rescued), len(B), 100 * len(rescued) / len(B) if B else 0))
for t in sorted(rescued):
    print("        %-32s %s" % (t, "".join("P" if ok else "F" for _s, _i, ok in seq[t])))
never = sorted(set(B) - set(rescued))
if never:
    print("    NEVER RESCUED : %d" % len(never))
    for t in never:
        print("        %-32s %s" % (t, "".join("P" if ok else "F" for _s, _i, ok in seq[t])))
if lost:
    print("    attempt 1 passed then a later attempt FAILED : %d (retry variance)" % len(lost))
    for t in sorted(lost):
        print("        %-32s %s" % (t, "".join("P" if ok else "F" for _s, _i, ok in seq[t])))

print("")
print("  attempt 1 is the LEADERBOARD-COMPARABLE figure — no lesson for its own")
print("  task existed yet. Attempts 2+ are an experiment, not a submittable score.")
