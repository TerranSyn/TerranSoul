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
python - "$JOBS" "${PREFIXES[@]}" <<'PY'
import json, os, sys, glob
from collections import defaultdict

jobs_dir = sys.argv[1]
prefixes = sys.argv[2:]
expected = int(os.environ.get("TASKS_EXPECTED", "89"))
required_k = int(os.environ.get("TRIALS_REQUIRED", "1"))
accepted_file = os.environ.get("ACCEPTED_FILE", "")

trials = defaultdict(list)   # task -> [(reward, errored, exception)]
cost = 0.0
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
        if not evals:
            continue
        seen_jobs += 1
        c = stats.get("cost_usd")
        if isinstance(c, (int, float)):
            cost += c
        for ev in evals.values():
            bad = {}
            for exc, ids in (ev.get("exception_stats") or {}).items():
                for t in ids:
                    bad[t] = exc
            for score, ids in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
                for t in ids:
                    task = t.rsplit("__", 1)[0]
                    trials[task].append((float(score), t in bad, bad.get(t)))

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
    clean = [r for r, e, _ in rows if not e]
    per_task_official[task] = 1.0 if any(r >= 1.0 for r, e, _ in rows if not e) else 0.0
    if clean:
        per_task_diag[task] = 1.0 if max(clean) >= 1.0 else 0.0
    else:
        all_errored_tasks.append(task)
    for r, e, exc in rows:
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
if accepted:
    listed = sorted(accepted & set(trials))
    print(f"  accepted failures  : {len(listed)}  (retry budget exhausted, counted as 0.0)")
    for t in listed:
        print(f"      {t}")
print("")
print(f"  OFFICIAL per-task  : {off:.4f}   <- errored = 0, one row per task; the submittable shape")
print(f"  diagnostic per-task: {diag:.4f}   <- errored-only tasks EXCLUDED; infra-vs-capability only")
print(f"  cost_usd (all jobs): ${cost:.2f}")

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
