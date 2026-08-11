#!/usr/bin/env bash
# Merge every batch job of a sweep into one honest result.
#
#   usage: merge-sweep.sh <jobs-dir> [prefix ...]
#          merge-sweep.sh <jobs-dir>            # reads mcp-data/.tb-sweep-prefixes.txt
#
# "Honest" means the things this project has already been burned by:
#
#   * ERRORED TRIALS ARE SCORED 0, NEVER DROPPED (leaderboard/SUBMIT.md). A trial
#     that died with UnknownApiError still reported reward 1.0 on job
#     dg-20260804-161447, because the verifier ran regardless of the agent
#     erroring. Both figures are printed: the official one scores errors 0, the
#     diagnostic one excludes them to show how much of a gap is infrastructure.
#   * ONE ROW PER TASK. A sweep that restarts re-runs tasks, so a task with one
#     pass and two errored attempts contributed 0.33 to a per-TRIAL mean. The
#     leaderboard reports per-TASK, so trials are collapsed per task first.
#   * EVERY PREFIX, NOT THE LAST ONE. Each restart of run-sweep.sh mints a new
#     TB_JOB_PREFIX. Merging only the final prefix published a number computed
#     from 1 job out of 56 — measured 2026-08-05, when the four live prefixes
#     scored 0.857 / 0.790 / 0.500 / 0.000 depending on which you happened to
#     pick. A prefix-LESS merge is equally wrong in the other direction: it
#     sweeps in probes and aborted runs. So prefixes are explicit and plural.
#   * NO VERDICT WITHOUT COVERAGE. "BEATS THE BAR" once fired off a single
#     trial. It now refuses to render until the run is actually comparable.
#   * BRAIN USAGE IS COUNTED FROM THE PROXY LOG ONLY. The job dir duplicates
#     each tool_use across trajectory.json and the session jsonl, so grepping it
#     double-counts. See check-terransoul-used.sh.
set -uo pipefail

# Python here writes report text containing non-ASCII glyphs (arrows, +/-).
# Windows Python defaults stdout to cp1252, so an un-guarded run either CRASHES
# mid-report (self-improve-rate.sh died with UnicodeEncodeError after printing
# only its first line) or emits mojibake (attempt-uplift.sh printed a literal
# replacement char). merge-sweep.sh produces the HEADLINE NUMBER, so a crash
# there truncates the very result the campaign exists to report. The sweep
# drivers inherit this from run-parallel.sh, but not when run standalone.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
JOBS="${1:?usage: merge-sweep.sh <jobs-dir> [prefix ...]}"
shift || true
PREFIXES=("$@")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PREFIX_FILE="$REPO/mcp-data/.tb-sweep-prefixes.txt"
ACCEPTED_FILE="$REPO/mcp-data/.tb-sweep-accepted-failures.txt"

# ── THE QUARANTINE IS DERIVED, NOT TRUSTED ───────────────────────────────
# `$REPO/mcp-data/.tb-sweep-quarantine.txt` is a FIXED SHARED PATH, and this
# machine runs several agent sessions at once. A merge that simply read that
# file would inherit whatever the last writer put there — and the dangerous
# direction is silent: a scan of a DIFFERENT cohort overwrites it with a
# shorter list, and a tainted trial in THIS cohort quietly stops being
# quarantined. Nothing in the output would look wrong.
#
# So recompute it here, from this jobs dir, into a merge-scoped temp file.
# TB_QUARANTINE_FILE still overrides (the test suite uses it), and the shared
# file is used only if the scanner is missing.
QUARANTINE_FILE="${TB_QUARANTINE_FILE:-}"
if [ -z "$QUARANTINE_FILE" ]; then
  if [ -f "$HERE/integrity-scan.py" ]; then
    QUARANTINE_FILE="$(mktemp)"
    python "$HERE/integrity-scan.py" "$JOBS" --write "$QUARANTINE_FILE" >/dev/null 2>&1
    trap 'rm -f "$QUARANTINE_FILE"' EXIT
  else
    echo "merge-sweep: integrity-scan.py missing — falling back to the shared quarantine file," >&2
    echo "  which may have been written by another session against another cohort." >&2
    QUARANTINE_FILE="$REPO/mcp-data/.tb-sweep-quarantine.txt"
  fi
fi

if [ "${#PREFIXES[@]}" -eq 0 ] && [ -f "$PREFIX_FILE" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && PREFIXES+=("$line")
  done < <(sort -u "$PREFIX_FILE")
fi

if [ "${#PREFIXES[@]}" -eq 0 ]; then
  echo "merge-sweep: refusing to merge without a prefix." >&2
  echo "  A prefix-less merge mixes probes and aborted runs into the number." >&2
  echo "  Pass them explicitly, or write one per line into $PREFIX_FILE" >&2
  exit 2
fi

TASKS_EXPECTED="${TB_TASKS_EXPECTED:-89}" \
TRIALS_REQUIRED="${TB_ATTEMPTS:-1}" \
ACCEPTED_FILE="$ACCEPTED_FILE" \
QUARANTINE_FILE="$QUARANTINE_FILE" \
python - "$JOBS" "${PREFIXES[@]}" <<'PY'
import json, os, sys, glob
from collections import defaultdict

jobs_dir = sys.argv[1]
prefixes = sys.argv[2:]
expected = int(os.environ.get("TASKS_EXPECTED", "89"))
required_k = int(os.environ.get("TRIALS_REQUIRED", "1"))
accepted_file = os.environ.get("ACCEPTED_FILE", "")
quarantine_file = os.environ.get("QUARANTINE_FILE", "")

trials = defaultdict(list)   # task -> [(reward, errored, exception)]
cost = 0.0
barren_cost = 0.0            # spend by jobs that produced no trial at all
barren_jobs = 0
cost_missing = 0             # jobs whose result.json carried no cost_usd
seen_jobs = 0
unreadable = []
seen_paths = set()

for prefix in prefixes:
    for rj in sorted(glob.glob(os.path.join(jobs_dir, prefix + "*", "result.json"))):
        if rj in seen_paths:
            continue
        seen_paths.add(rj)
        try:
            with open(rj, encoding="utf-8", errors="replace") as fh:
                d = json.load(fh)
        except Exception as exc:
            # A job that cannot be parsed must NOT vanish silently — that is a
            # job's worth of result quietly leaving the denominator.
            unreadable.append((rj, str(exc)[:80]))
            continue
        stats = d.get("stats") or {}
        evals = stats.get("evals") or {}
        # COST IS BILLED WHETHER OR NOT THE JOB PRODUCED A TRIAL. Accumulate it
        # BEFORE the evals check: a job that dies before its first trial still
        # spent real money, and skipping it here dropped that spend from a figure
        # labelled "all jobs".
        #
        # Measured 2026-08-08: a merge reporting "$108.36 (all jobs)" sat against
        # $120.98 summed over every readable result.json — a $12.62 gap across 16
        # jobs. MOST of that gap was jobs still IN FLIGHT (harbor writes
        # result.json at job start and fills evals as trials finish), so it closed
        # on its own as they completed, and the steady-state understatement is
        # smaller than that number suggests. The durable defect is the permanently
        # barren job — one that errors out before any trial — whose cost vanished
        # silently. Both are now counted, and barren spend is reported separately
        # so an in-flight snapshot cannot be mistaken for waste.
        c = stats.get("cost_usd")
        if isinstance(c, (int, float)):
            cost += c
        else:
            cost_missing += 1
        if not evals:
            if isinstance(c, (int, float)) and c > 0:
                barren_cost += c
            barren_jobs += 1
            continue
        seen_jobs += 1
        for ev in evals.values():
            bad = {}
            for exc, ids in (ev.get("exception_stats") or {}).items():
                for t in ids:
                    bad[t] = exc
            for score, ids in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
                for t in ids:
                    task = t.rsplit("__", 1)[0]
                    trials[task].append((float(score), t in bad, bad.get(t), t))

# ── INTEGRITY QUARANTINE ─────────────────────────────────────────────────
# A trial that reached the BENCHMARK'S OWN oracle solution / grading tests did
# not solve the task, whatever its verifier said, so it is forced to 0.0 here.
# Produced by integrity-scan.py; see that file for the 2026-08-08 build-pov-ray
# incident that motivated it. Scoring-side ONLY: the agent never sees this, so
# it can be enabled mid-sweep without breaking cohort uniformity.
quarantine = set()
if quarantine_file and os.path.exists(quarantine_file):
    with open(quarantine_file, encoding="utf-8", errors="replace") as fh:
        quarantine = {ln.strip() for ln in fh if ln.strip()}
quarantined_rows = []
if quarantine:
    for task, rows in trials.items():
        for i, (score, err, exc, tid) in enumerate(rows):
            if tid in quarantine:
                quarantined_rows.append((task, tid, score))
                rows[i] = (0.0, err, exc, tid)

accepted = set()
if accepted_file and os.path.exists(accepted_file):
    with open(accepted_file, encoding="utf-8", errors="replace") as fh:
        accepted = {ln.strip() for ln in fh if ln.strip()}

# ── collapse to ONE ROW PER TASK ─────────────────────────────────────────
# Official (SUBMIT.md): a task is solved if any trial scored 1.0; an errored
# trial is a 0, not an absence. A task whose every attempt errored is therefore
# a 0 that stays in the denominator — dropping it is what inflates a score.
per_task_official, per_task_diag = {}, {}
errored_rows, all_errored_tasks = [], []
for task, rows in sorted(trials.items()):
    clean = [r for r, e, _, _ in rows if not e]
    per_task_official[task] = 1.0 if any(r >= 1.0 for r, e, _, _ in rows if not e) else 0.0
    if clean:
        per_task_diag[task] = 1.0 if max(clean) >= 1.0 else 0.0
    else:
        all_errored_tasks.append(task)
    for r, e, exc, _tid in rows:
        if e:
            errored_rows.append((task, exc or "?"))

n_tasks = len(per_task_official)
off = sum(per_task_official.values()) / n_tasks if n_tasks else 0.0
diag = sum(per_task_diag.values()) / len(per_task_diag) if per_task_diag else 0.0
n_trials = sum(len(v) for v in trials.values())

print(f"  prefixes merged    : {len(prefixes)}  ({', '.join(prefixes)})")
print(f"  jobs merged        : {seen_jobs}")
print(f"  trials on disk     : {n_trials}")
print(f"  distinct tasks     : {n_tasks} / {expected} expected")
print(f"  errored trials     : {len(errored_rows)}")
print(f"  tasks with NO clean trial : {len(all_errored_tasks)}  (scored 0.0, kept in the denominator)")
if quarantined_rows:
    print(f"  INTEGRITY-QUARANTINED     : {len(quarantined_rows)}  (reached the benchmark's own oracle; forced to 0.0)")
    for task, tid, was in quarantined_rows:
        print(f"      {tid}  (verifier said {was:.1f}, counted 0.0)")
if accepted:
    # ⛔ THIS LINE USED TO CLAIM "counted as 0.0" AND NOTHING IMPLEMENTED IT.
    # `accepted` was read, intersected, printed, and never applied — the score
    # came from reward_stats either way. The label was false in both directions:
    # a task that exhausted its retries and never passed already scores 0 without
    # help, and one that exhausted its retries and LATER PASSED on another prefix
    # was being announced as a zero while correctly counting as solved.
    #
    # The fix is NOT to start zeroing them. `adaptive-rejection-sampler` sits in
    # this ledger and passes 5 of 5 trials; forcing it to 0 would understate a
    # real result to satisfy a stale ledger entry. The ledger records that the
    # SWEEP stopped retrying, which is a scheduling fact, not a verdict on the
    # task. So print what is true: the entry, and its actual score.
    listed = sorted(accepted & set(trials))
    print(f"  retry budget exhausted : {len(listed)}  (scheduling ledger; scored from trials, NOT forced to 0)")
    for t in listed:
        got = per_task_official.get(t)
        n_pass = sum(1 for r, e, _, _ in trials[t] if not e and r >= 1.0)
        print(f"      {t}: scored {got:.1f} ({n_pass}/{len(trials[t])} trial(s) passed)")
print("")
print(f"  OFFICIAL per-task  : {off:.4f}   <- errored = 0, one row per task; the submittable shape")
print(f"  diagnostic per-task: {diag:.4f}   <- errored-only tasks EXCLUDED; infra-vs-capability only")
print(f"  cost_usd THIS COHORT: ${cost:.2f}   <- {jobs_dir} + the listed prefixes ONLY")
if barren_jobs:
    print(f"      of which ${barren_cost:.2f} bought no trial ({barren_jobs} job(s) with a result.json but no evals)")
if cost_missing:
    print(f"      {cost_missing} job(s) reported NO cost_usd — real spend, not counted above")
print( "      NOT a session or account total: this counts harbor job spend for this")
print( "      cohort only. Other Claude Code sessions on this machine are billed")
print( "      separately and never appear here.")

# ── the verdict, gated ───────────────────────────────────────────────────
incomplete = []
if n_tasks < expected:
    incomplete.append(f"{n_tasks}/{expected} tasks")
if required_k < 5:
    incomplete.append(f"k={required_k} (<5)")
print("")
if incomplete:
    print(f"  bar 0.8380         : NO VERDICT — {', '.join(incomplete)}; not comparable to the bar")
else:
    print(f"  bar 0.8380         : {'BEATS THE BAR' if off > 0.838 else 'below the bar'}")

if unreadable:
    print("")
    print(f"  *** {len(unreadable)} UNREADABLE result.json — these left the denominator: ***")
    for rj, why in unreadable[:10]:
        print(f"    {rj}  ({why})")

if errored_rows:
    print("")
    print("  errored trials (re-run or exclude, and SAY WHICH):")
    for t, exc in errored_rows[:25]:
        print(f"    {exc:<28} {t}")
    if len(errored_rows) > 25:
        print(f"    … and {len(errored_rows)-25} more")

print("")
print("  SUBMISSION REQUIREMENTS (leaderboard/SUBMIT.md):")
print("    * every task covered, >=5 trials each -- a k=1 run is NOT submittable")
print("    * errored trials count as reward 0, never excluded")
print("    * default execution settings; no timeout or resource overrides")
print("  Do not attach TerranSoul's name unless check-terransoul-used.sh confirmed")
print("  real brain calls, and disclose that memory WRITES occurred during the run.")

sys.exit(1 if unreadable else 0)
PY
