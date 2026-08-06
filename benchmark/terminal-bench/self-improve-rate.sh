#!/usr/bin/env bash
# IS THE BRAIN ACTUALLY LEARNING? Write-rate by task OUTCOME, split before/after a fix.
#
#   usage: self-improve-rate.sh [sweep-log] [iso-cutoff-UTC]
#          self-improve-rate.sh mcp-data/logs/tbench-sweep.log 2026-08-05T04:56:55
#
# ⚠️ THE CUTOFF IS UTC. The proxy stamps `new Date().toISOString()`, i.e. UTC,
# while `git log` prints local time -- this host is UTC+10, so passing the local
# commit time silently classified every post-fix task as "before" and reported
# the fix as untested when it had simply been mis-bucketed by ten hours.
#
# WHY OUTCOME-SPLIT IS THE ONLY USEFUL CUT. A headline "65% of tasks wrote a
# lesson" hides the defect completely. Measured on this sweep:
#
#     among tasks that PASSED  : 82% wrote a lesson
#     among tasks that FAILED  : 19% wrote a lesson
#
# So the corpus learns from successes and is BLIND TO THE FAILURES THAT REPEAT --
# caffe-cifar-10 was attempted three times, failed three times, wrote nothing
# three times, and opened every attempt with "memory had nothing on Caffe".
#
# ROOT CAUSE: TB_DEFER_WRITES flushes at job END and the agent was saving its
# write-up for a final summary turn, so any task that timed out lost its lesson.
# The fix is in extra-instruction.md ("write it the moment you have it"), and
# THIS script is how we tell whether the fix took, rather than assuming it did.
#
# The cutoff splits tasks by their first proxy timestamp, so a fix landing
# mid-sweep can be evaluated on the tasks that actually saw it.
set -uo pipefail

# Python here writes report text containing non-ASCII glyphs (arrows, +/-).
# Windows Python defaults stdout to cp1252, so an un-guarded run either CRASHES
# mid-report (self-improve-rate.sh died with UnicodeEncodeError after printing
# only its first line) or emits mojibake (attempt-uplift.sh printed a literal
# replacement char). merge-sweep.sh produces the HEADLINE NUMBER, so a crash
# there truncates the very result the campaign exists to report. The sweep
# drivers inherit this from run-parallel.sh, but not when run standalone.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
LOG="${1:-mcp-data/logs/tbench-sweep.log}"
CUTOFF="${2:-}"

LOG="$LOG" CUTOFF="$CUTOFF" python - <<'PY'
import os, re

log_path = os.environ.get("LOG")
cutoff = (os.environ.get("CUTOFF") or "").strip()
text = open(log_path, encoding="utf-8", errors="replace").read()

blocks = re.split(r'^\[sweep\]   task ([a-z0-9-]+) \(own job', text, flags=re.M)
rows = []
for i in range(1, len(blocks), 2):
    task, body = blocks[i], blocks[i + 1]
    # First proxy timestamp inside the block dates the task.
    m = re.search(r'"at":"([0-9T:\-\.]+)Z?"', body)
    when = m.group(1) if m else ""
    rows.append({
        "task": task,
        "when": when,
        "passed": "Mean: 1.000" in body,
        # ⚠️ COUNT ACCEPTED WRITES (effect), NOT FORWARDED CALLS (intent).
        # This script previously counted `"tool":"brain_ingest_lesson"`, which
        # the proxy logs when it FORWARDS a call. It reported "100% of post-fix
        # tasks wrote a lesson" for a campaign in which 21 of 119 runs (18%)
        # had every write discarded unflushed — the failures, specifically.
        # Same intent-vs-effect error as the MCP verdict counter, one layer up.
        # The brain's own verdict line is the only honest witness.
        "wrote": len(re.findall(r'"name":"brain_ingest_lesson","verdict":"accepted"', body)),
        "appended": len(re.findall(r'"name":"brain_append","verdict":"accepted"', body)),
        # Kept separately so a task that TRIED and was refused is visible rather
        # than indistinguishable from one that never tried.
        "attempted": body.count('"tool":"brain_ingest_lesson"') + body.count('"tool":"brain_append"'),
        "refused": len(re.findall(r'"name":"brain_(?:ingest_lesson|append)","verdict":"(?:refused|gate-denied)"', body)),
        "searched": body.count('"tool":"brain_search"'),
        # A task still running has no result block yet; counting it as a
        # non-writer would understate the rate on every early read.
        "finished": ("trials completed:" in body),
    })

def report(label, sel):
    sub = [r for r in rows if sel(r) and r["finished"]]
    if not sub:
        print(f"  {label:<26} (no finished tasks)")
        return
    def rate(rs):
        if not rs:
            return "n/a"
        w = sum(1 for r in rs if r["wrote"] + r["appended"] > 0)
        return f"{w}/{len(rs)} = {100.0*w/len(rs):.0f}%"
    passed = [r for r in sub if r["passed"]]
    failed = [r for r in sub if not r["passed"]]
    print(f"  {label:<26} n={len(sub):<4} all={rate(sub):<12} passed={rate(passed):<12} FAILED={rate(failed)}")
    # THE SILENT-LOSS LINE. A task that called the write tool and had NOTHING
    # accepted did the work and taught nobody — invisible to any call-counting
    # metric, and the exact shape of the 18% of runs whose deferred writes were
    # discarded when the runner exited non-zero.
    lost = [r for r in sub if r["attempted"] > 0 and r["wrote"] + r["appended"] == 0]
    if lost:
        print(f"  {'':<26} ⚠️  {len(lost)} task(s) ATTEMPTED a write and had none accepted: "
              f"{', '.join(r['task'] for r in lost[:6])}{' …' if len(lost) > 6 else ''}")
    refused = sum(r["refused"] for r in sub)
    if refused:
        print(f"  {'':<26} ⚠️  {refused} write(s) refused or gate-denied by the brain")

print(f"  sweep log: {log_path}")
report("all tasks", lambda r: True)
if cutoff:
    print(f"  cutoff: {cutoff}")
    report("before the fix", lambda r: r["when"] and r["when"] < cutoff)
    report("AFTER the fix", lambda r: r["when"] and r["when"] >= cutoff)
    after_failed = [r for r in rows if r["finished"] and r["when"] >= cutoff and not r["passed"]]
    if after_failed:
        print("\n  post-fix FAILED tasks (the ones that used to teach nothing):")
        for r in after_failed:
            mark = "wrote" if r["wrote"] + r["appended"] else "STILL SILENT"
            print(f"    {r['task']:<34} {mark:<12} ingest={r['wrote']} append={r['appended']}")
    else:
        print("\n  no FAILED task has finished since the cutoff yet -- the fix is untested.")
print("")
print("  The number that matters is FAILED. A brain that only records its wins")
print("  cannot help the next agent hit the same wall.")
PY
