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
    # The refusal exists for ONE reason: run-dg.sh defaults TB_PROXY_PORT to
    # 7425, which is also worker 0's port, so two runs bind the same socket and
    # both die. run-parallel.sh already proves distinct ports coexist — it hands
    # worker w port 7425+w. So an EXPLICIT free port removes the reason, and the
    # guard should not be stricter than the hazard it names.
    #
    # Everything else these runs share is safe concurrently: the bench brain is
    # shared by every worker BY DESIGN, the credential file is read-only here,
    # the container/network pool holds 4096, and redo-task deliberately never
    # touches $STATE (that is what drives which tasks a SWEEP still owes).
    if [ -n "${TB_PROXY_PORT:-}" ] && [ "${TB_PROXY_PORT}" != "7425" ]; then
      if (exec 3<>"/dev/tcp/127.0.0.1/${TB_PROXY_PORT}") 2>/dev/null; then
        exec 3<&- 2>/dev/null
        echo "REFUSING: TB_PROXY_PORT=$TB_PROXY_PORT is already in use." >&2
        echo "  Pick a port no worker holds (workers use 7425+w)." >&2
        exit 3
      fi
      echo "[redo] a sweep is live (pid $pid), but TB_PROXY_PORT=$TB_PROXY_PORT is free — running alongside it"
    else
      echo "REFUSING: a sweep is running as pid $pid (lock: $LOCK)." >&2
      echo "  Two runs fight over proxy port 7425 and both die." >&2
      echo "  Either stop the sweep, or set TB_PROXY_PORT to a free port" >&2
      echo "  (workers hold 7425+w) to run this redo alongside it." >&2
      exit 3
    fi
  else
    echo "[redo] stale lock for dead pid ${pid:-?} — clearing"
    [ "$DRY" = "1" ] || rm -f "$LOCK"
  fi
fi

ceiling="$(grep -m1 -oE 'timeout_sec[[:space:]]*=[[:space:]]*[0-9.]+' "$TASKS_DIR/$TASK/task.toml" 2>/dev/null | grep -oE '[0-9.]+' || echo '?')"
PREFIX="redo$(date +%m%d%H%M)"

# ⛔ INHERIT THE COHORT'S IDENTITY, OR THE REDO LANDS IN A DIFFERENT BUCKET AND
# VANISHES. harbor keys every eval as `<agent>__<model>__<dataset>`, and the
# leaderboard's `lb filter` selects trials by (agent, agent version, model,
# reasoning effort) with the dataset pinned repo-wide. This script passed
# NEITHER TB_AGENT NOR TB_DATASET, so it produced:
#
#     claude-code__claude-sonnet-5__tasks
#   vs the cohort's
#     terransoul__claude-sonnet-5__terminal-bench/terminal-bench-2-1
#
# Both differences are fatal and SILENT. Wrong agent -> the filter never selects
# those trials, so a task "topped up" by a redo still reads below 5 trials to CI.
# Wrong dataset -> CI rejects anything not on the pinned DATASET@DATASET_REF
# outright. Measured 2026-08-08 by comparing eval keys across jobs-sonnet5 and
# the attempt-6 redo; the redo was excluded from the number for other reasons, so
# nothing was published, but the topping-up pass would have hit it squarely.
#
# The worker launch file is the single source of truth for what the cohort
# ACTUALLY ran, so read the identity from there rather than restating it.
LAUNCH="${TB_LAUNCH_REF:-$REPO/mcp-data/.tb-par0.launch}"
if [ -f "$LAUNCH" ]; then
  [ -n "${TB_AGENT:-}" ]   || TB_AGENT="$(tr ' ' '\n' < "$LAUNCH" | sed -n 's/^TB_AGENT=//p'   | head -1)"
  [ -n "${TB_DATASET:-}" ] || TB_DATASET="$(tr ' ' '\n' < "$LAUNCH" | sed -n 's/^TB_DATASET=//p' | head -1)"
  [ -n "${TB_MODEL:-}" ]   || TB_MODEL="$(tr ' ' '\n' < "$LAUNCH" | sed -n 's/^TB_MODEL=//p'   | head -1)"
fi
if [ -z "${TB_AGENT:-}" ] || [ -z "${TB_DATASET:-}" ]; then
  echo "REFUSING: cannot determine the cohort's agent/dataset identity." >&2
  echo "  Without them this redo is keyed differently from the sweep and its" >&2
  echo "  trials silently drop out of the submission. Set TB_AGENT and" >&2
  echo "  TB_DATASET explicitly, or point TB_LAUNCH_REF at a worker .launch file." >&2
  exit 2
fi
echo "[redo] identity  : agent=$TB_AGENT model=${TB_MODEL:-?}"
echo "[redo] dataset   : $TB_DATASET"

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
#
# TB_REDO_EXPERIMENT=1 deliberately SKIPS that, because some redos are questions,
# not attempts to raise a score. A cohort is k=5 for every task; quietly giving
# ONE task a 6th attempt makes the run non-uniform, and if that task then passes,
# the headline number moves for a reason no other task was offered. An experiment
# stays out of the number until its finding is applied to every task equally.
if [ "${TB_REDO_EXPERIMENT:-0}" = "1" ]; then
  echo "[redo] EXPERIMENT mode — prefix NOT registered, this run cannot move the number"
else
  echo "$PREFIX" >> "$REPO/mcp-data/.tb-sweep-prefixes.txt"
  sort -u -o "$REPO/mcp-data/.tb-sweep-prefixes.txt" "$REPO/mcp-data/.tb-sweep-prefixes.txt"
fi

# Deferral OFF by default: a single task has no cross-attempt leakage concern
# worth the risk of losing its lesson, and immediate writes mean attempt 2 can
# read attempt 1 within the same job.
TB_TASKS="$TASK" \
TB_JOB_PREFIX="$PREFIX" \
TB_ATTEMPTS="$ATTEMPTS" \
TB_CONCURRENCY=1 \
TB_DEFER_WRITES="${TB_DEFER_WRITES:-0}" \
TB_PROXY_MODE="${TB_PROXY_MODE:-learn}" \
TB_PROXY_PORT="${TB_PROXY_PORT:-7425}" \
TB_JOBS_DIR="${TB_JOBS_DIR:-}" \
TB_PRIOR_OUTCOMES="${TB_PRIOR_OUTCOMES:-}" \
TB_MODEL="${TB_MODEL:-claude-sonnet-5}" \
TB_AGENT="$TB_AGENT" \
TB_DATASET="$TB_DATASET" \
TB_UPLOAD="${TB_UPLOAD:-}" \
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  bash "$HERE/run-dg.sh" ""
rc=$?

echo
echo "[redo] run exited $rc — READ result.json, not this code (harbor exits 0 on a FAILED trial)."
echo "[redo] re-merge with:  bash $HERE/merge-sweep.sh $HERE/jobs"
echo "[redo] the redone task's row can only have gone UP; every other row is untouched."
exit $rc
