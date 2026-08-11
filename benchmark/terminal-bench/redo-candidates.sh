#!/usr/bin/env bash
# WHICH TASKS ARE WORTH RE-RUNNING, AND WHY — classified by ROOT CAUSE.
#
#   usage: redo-candidates.sh [jobs-dir] [sweep-log]
#
# WHY CAUSE MATTERS MORE THAN SCORE. "Re-run everything that scored 0" wastes
# hours on tasks that failed for reasons a re-run reproduces exactly, and misses
# tasks that scored 1.0 while losing everything they learned. The four classes
# want four different responses:
#
#   TIMEOUT        the agent ran out of wall clock. A re-run reproduces it
#                  UNLESS the root cause is fixed first (see below). These are
#                  the highest-value targets: on this campaign all six tasks
#                  with no clean trial are timeout-bound, and converting them is
#                  worth ~6.7 pp — the entire gap to a 90% target.
#   LOST-LESSON    the task called a write tool and nothing was accepted. It did
#                  the work and taught nobody. Re-running it is worth it ONLY
#                  after the flush fix, otherwise it loses the lesson again.
#   INFRA          UnknownApiError / rate limits / setup failures. A re-run is
#                  usually enough; nothing to fix in the agent.
#   CAPABILITY     scored 0 with no error and no timeout. The agent genuinely
#                  could not do it. A re-run without a change is a coin flip and
#                  the honest label is "not solved", not "flaky".
#
# SAFE BY CONSTRUCTION. merge-sweep.sh collapses to ONE ROW PER TASK across all
# prefixes and counts a task solved if ANY trial scored 1.0. So re-running a
# single task under a NEW prefix can only raise its row — it cannot disturb a
# task that already succeeded. That is what makes per-task redo safe without
# rebuilding the campaign.
set -uo pipefail

# Python here writes report text containing non-ASCII glyphs (arrows, +/-).
# Windows Python defaults stdout to cp1252, so an un-guarded run either CRASHES
# mid-report (self-improve-rate.sh died with UnicodeEncodeError after printing
# only its first line) or emits mojibake (attempt-uplift.sh printed a literal
# replacement char). merge-sweep.sh produces the HEADLINE NUMBER, so a crash
# there truncates the very result the campaign exists to report. The sweep
# drivers inherit this from run-parallel.sh, but not when run standalone.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
JOBS="${1:-$HERE/jobs}"
LOG="${2:-$REPO/mcp-data/logs/tbench-sweep.log}"

JOBS="$JOBS" LOG="$LOG" TASKS_DIR="${TB21_DIR:-D:/Git/terminal-bench-2-1}/tasks" python - <<'PY'
import json, os, glob, re, collections

jobs = os.environ["JOBS"]
log_path = os.environ["LOG"]
tasks_dir = os.environ["TASKS_DIR"]

# ── ceilings, so a timeout can be reported as a fraction rather than a bare fact
ceiling = {}
for tf in glob.glob(os.path.join(tasks_dir, "*", "task.toml")):
    name = tf.replace("\\", "/").split("/")[-2]
    m = re.search(r"timeout_sec\s*=\s*([0-9.]+)", open(tf, encoding="utf-8", errors="replace").read())
    if m:
        ceiling[name] = float(m.group(1))

# ── per-task trial outcomes from result.json (authoritative for score)
#
# SHAPE MATTERS AND IS COUNTERINTUITIVE: `reward_stats.reward` maps
# SCORE -> [trial_ids], not trial_id -> score. Reading it the intuitive way
# yields 0.00 for every task, which reads exactly like a catastrophic campaign
# rather than a parsing bug — it did, on this script's first run. Extraction is
# copied from merge-sweep.sh, which is the authority for the published number,
# so the two can never disagree about who passed.
#
# Task id is everything before the LAST "__": trial ids are
# `<task>__<suffix>` and task names themselves contain hyphens, not underscores.
best = {}          # task -> best reward seen
errs = collections.defaultdict(collections.Counter)
for rj in sorted(glob.glob(os.path.join(jobs, "*", "result.json"))):
    try:
        d = json.load(open(rj, encoding="utf-8"))
    except Exception:
        continue
    for ev in ((d.get("stats") or {}).get("evals") or {}).values():
        for exc, trials in (ev.get("exception_stats") or {}).items():
            for t in trials:
                errs[t.rsplit("__", 1)[0]][exc] += 1
        for score, ids in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
            for t in ids:
                task = t.rsplit("__", 1)[0]
                try:
                    r = float(score)
                except Exception:
                    continue
                best[task] = max(best.get(task, 0.0), r)

# ── which tasks wrote a lesson that was ACCEPTED (effect, not intent)
accepted, attempted = collections.Counter(), collections.Counter()
if os.path.exists(log_path):
    text = open(log_path, encoding="utf-8", errors="replace").read()
    blocks = re.split(r'^\[sweep\]   task ([a-z0-9-]+) \(own job', text, flags=re.M)
    for i in range(1, len(blocks), 2):
        task, body = blocks[i], blocks[i + 1]
        accepted[task] += len(re.findall(r'"name":"brain_(?:ingest_lesson|append)","verdict":"accepted"', body))
        attempted[task] += body.count('"tool":"brain_ingest_lesson"') + body.count('"tool":"brain_append"')

TERMINAL = {"AgentTimeoutError"}
INFRA = {"UnknownApiError", "ApiRateLimitError", "AgentSetupTimeoutError", "NonZeroAgentExitCodeError"}

# ⛔ "NEVER RAN" IS NOT "SCORED ZERO". `best` defaults to 0.0 for any task
# missing from the jobs dir, and the task roster here is a UNION that includes
# names harvested from the sweep LOG — which spans earlier campaigns. So every
# task the analysed corpus has not reached yet arrived at `score = 0.0` with no
# recorded exception, and fell straight into the CAPABILITY bucket.
#
# Measured against jobs-submit/ on 2026-08-07: 51 of the 52 tasks that had never
# been attempted were reported as "CAPABILITY — scored 0, no error recorded",
# and the footer announced "52 unsolved task(s)". The corpus actually contained
# 35 tasks at 5/5 clean and 52 with no trials at all. An operator reading that
# would conclude the agent was failing 51 tasks on ability, and would go looking
# for a reasoning regression that does not exist — when the only true capability
# failure was ONE task.
#
# `best` is now consulted only for tasks that really produced a trial.
attempted_tasks = set(best) | set(errs)
rows = []
not_run = []
for task in sorted(set(list(best) + list(errs) + list(accepted))):
    if task not in attempted_tasks:
        not_run.append(task)
        continue
    score = best.get(task, 0.0)
    e = errs.get(task, collections.Counter())
    if any(k in TERMINAL for k in e):
        cause, detail = "TIMEOUT", f"{sum(e[k] for k in e if k in TERMINAL)}x, ceiling {ceiling.get(task, 0):.0f}s"
    elif attempted[task] > 0 and accepted[task] == 0:
        cause, detail = "LOST-LESSON", f"{attempted[task]} write(s) attempted, 0 accepted"
    elif any(k in INFRA for k in e):
        cause, detail = "INFRA", ", ".join(f"{k}x{v}" for k, v in e.items() if k in INFRA)
    elif score < 1.0:
        cause, detail = "CAPABILITY", "scored 0, no error recorded"
    else:
        continue
    rows.append((cause, task, score, detail))

order = {"TIMEOUT": 0, "LOST-LESSON": 1, "INFRA": 2, "CAPABILITY": 3}
rows.sort(key=lambda r: (order[r[0]], r[1]))

print(f"  jobs dir : {jobs}")
print(f"  {'cause':<13}{'task':<34}{'best':<7}detail")
for cause, task, score, detail in rows:
    print(f"  {cause:<13}{task[:33]:<34}{score:<7.2f}{detail}")

counts = collections.Counter(r[0] for r in rows)
print()
for c in ("TIMEOUT", "LOST-LESSON", "INFRA", "CAPABILITY"):
    if counts[c]:
        print(f"  {c:<13} {counts[c]}")
print()
unsolved = [r for r in rows if r[2] < 1.0]
print(f"  {len(unsolved)} unsolved task(s). Each one converted is +{100/89:.2f} pp on an 89-task suite.")

# NEVER-RUN tasks are reported as their own line, from the dataset roster rather
# than from whatever the log happened to mention. They are remaining WORK, not
# remaining failures, and conflating the two is what made this script announce
# 52 unsolved tasks against a corpus with exactly one capability failure.
roster = set(ceiling)
never = sorted((roster - attempted_tasks) | set(not_run)) if roster else sorted(not_run)
if never:
    print(f"  {len(never)} task(s) have NO trial in this corpus — not run, not failed:")
    print("    " + " ".join(never[:12]) + (" ..." if len(never) > 12 else ""))
print()
print("  Re-run one with:  bash redo-task.sh <task-id>")
print("  It runs in its OWN prefix; merge-sweep takes the best trial per task,")
print("  so a redo can only raise that task's row and cannot disturb any other.")
PY
