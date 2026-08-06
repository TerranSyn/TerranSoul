#!/usr/bin/env bash
# Re-run ONE task without disturbing anything already measured.
#
#   usage: redo-task.sh <task-id> [attempts]
#          DRY=1 redo-task.sh <task-id>
#
# WHY THIS IS SAFE, and it is worth understanding rather than trusting:
# merge-sweep.sh collapses every prefix to ONE ROW PER TASK and counts a task
# solved if ANY trial scored 1.0. A redo therefore runs in its OWN prefix,
# appends that prefix to the campaign list, and can only RAISE the redone task's
# row. It cannot lower it, and it cannot touch any other task's row. That is the
# whole mechanism — there is no merge surgery and no editing of prior results.
#
# WHAT IT DELIBERATELY DOES NOT DO:
#   * it does not touch $STATE. State drives which tasks a SWEEP still owes; a
#     targeted redo is orthogonal to that, and clearing state is how a campaign
#     accidentally re-runs 89 tasks.
#   * it does not clear $ACCEPTED or $RETRIES for other tasks.
#   * it refuses to run while a sweep holds the lock, because two runs fight
#     over the proxy port (EADDRINUSE 7425) and both die.
#
# CHECKPOINT FIRST. Every redo snapshots the campaign before it runs, so the
# state that produced the current number is recoverable even if the redo is
# interrupted halfway.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TASK="${1:-}"
ATTEMPTS="${2:-${TB_ATTEMPTS:-1}}"
DRY="${DRY:-0}"

if [ -z "$TASK" ]; then
  echo "usage: redo-task.sh <task-id> [attempts]" >&2
  echo "  candidates: bash redo-candidates.sh" >&2
  exit 2
fi

TASKS_DIR="${TB21_DIR:-/d/Git/terminal-bench-2-1}/tasks"
if [ ! -d "$TASKS_DIR/$TASK" ]; then
  echo "REFUSING: '$TASK' is not a task in $TASKS_DIR" >&2
  echo "  A typo here runs nothing and looks exactly like a task that scored 0." >&2
  exit 2
fi

# ── refuse to race a live sweep. Check the LOCKFILE PID, not a command-line
# pattern: `pkill -f run-sweep.sh` silently failed to match on 2026-08-06 and a
# driver kept running inside its 600s rate-limit sleep, invisible to every
# container/process count.
LOCK="$REPO/mcp-data/.tb-sweep.lock"
if [ -f "$LOCK" ]; then
  pid="$(cat "$LOCK" 2>/dev/null)"
  if [ -n "$pid" ] && ps -W 2>/dev/null | awk -v p="$pid" '$1==p{f=1} END{exit !f}'; then
    echo "REFUSING: a sweep is running as pid $pid (lock: $LOCK)." >&2
    echo "  Two runs fight over proxy port 7425 and both die. Stop it first." >&2
    exit 3
  fi
  echo "[redo] stale lock for dead pid ${pid:-?} — clearing"
  [ "$DRY" = "1" ] || rm -f "$LOCK"
fi

ceiling="$(grep -m1 -oE 'timeout_sec[[:space:]]*=[[:space:]]*[0-9.]+' "$TASKS_DIR/$TASK/task.toml" 2>/dev/null | grep -oE '[0-9.]+' || echo '?')"
PREFIX="redo$(date +%m%d%H%M)"

echo "[redo] task      : $TASK"
echo "[redo] ceiling   : ${ceiling}s"
echo "[redo] attempts  : $ATTEMPTS"
echo "[redo] prefix    : $PREFIX  (its own; merge takes the best trial per task)"

if [ "$DRY" = "1" ]; then
  echo "  would: checkpoint, then run run-dg.sh with TB_TASKS=$TASK TB_JOB_PREFIX=$PREFIX"
  exit 0
fi

bash "$HERE/checkpoint.sh" "pre-redo-$TASK-$PREFIX" >/dev/null 2>&1 && \
  echo "[redo] checkpoint: pre-redo-$TASK-$PREFIX"

# Register the prefix so merge-sweep.sh includes this run. Without it the redo
# is invisible to the number and the whole exercise is wasted compute.
echo "$PREFIX" >> "$REPO/mcp-data/.tb-sweep-prefixes.txt"
sort -u -o "$REPO/mcp-data/.tb-sweep-prefixes.txt" "$REPO/mcp-data/.tb-sweep-prefixes.txt"

# Deferral OFF by default: a single task has no cross-attempt leakage concern
# worth the risk of losing its lesson, and immediate writes mean attempt 2 can
# read attempt 1 within the same job.
TB_TASKS="$TASK" \
TB_JOB_PREFIX="$PREFIX" \
TB_ATTEMPTS="$ATTEMPTS" \
TB_CONCURRENCY=1 \
TB_DEFER_WRITES="${TB_DEFER_WRITES:-0}" \
TB_PROXY_MODE="${TB_PROXY_MODE:-learn}" \
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  bash "$HERE/run-dg.sh" ""
rc=$?

echo
echo "[redo] run exited $rc — READ result.json, not this code (harbor exits 0 on a FAILED trial)."
echo "[redo] re-merge with:  bash $HERE/merge-sweep.sh $HERE/jobs"
echo "[redo] the redone task's row can only have gone UP; every other row is untouched."
exit $rc
