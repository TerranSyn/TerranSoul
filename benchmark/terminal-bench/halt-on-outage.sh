#!/usr/bin/env bash
# Watchdog: HALT the sweep the moment the model becomes unreachable, so an
# outage cannot be recorded as a wall of 0.0 scores.
#
# THE FAILURE IT PREVENTS. When credits run out, every remaining task errors.
# classify_errored_task() then spends its retry budget on each one and writes it
# to $STATE + $ACCEPTED as "accepted as a failed trial (0.0)". Those tasks are
# now marked DONE, so resuming after the credit reset SKIPS them — the run ends
# "complete" with dozens of zeros TerranSoul never earned. Detecting that
# afterwards (credit-outage-check.sh) means unpicking ledgers by hand; not
# letting it happen is much cheaper.
#
# WHY KILLING IS SAFE. $STATE is appended per TASK, only after that task's job
# finishes. Killing a worker mid-task therefore loses the in-flight task and
# nothing else — it simply re-runs on resume. At most one task per worker.
#
# Exits non-zero on halt so the caller is notified; exits 0 when the sweep has
# finished on its own and there is nothing left to guard.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LOGS="$REPO/mcp-data/logs"
JOBS="${TB_JOBS_DIR:-$HERE/jobs-submit}"
INTERVAL="${TB_WATCHDOG_INTERVAL_S:-60}"

# Deliberately broad. A false positive costs one halt and a manual restart; a
# false negative bakes unearned zeros into a public leaderboard submission.
# "RateLimit" alone — what the in-sweep guard checks — is far too narrow.
OUTAGE_RE='[Cc]redit balance|[Uu]sage limit|usage_limit|insufficient_quota|quota exceeded|billing|Authentication.?[Ee]rror|Unauthorized|invalid_api_key|OAuth.*(expired|failed)|status.?(401|403)'

_alive_pids() {
  for w in 0 1 2 3 4; do
    l="$REPO/mcp-data/.tb-par${w}.lock"
    [ -f "$l" ] || continue
    p="$(tr -dc '0-9' < "$l" 2>/dev/null)"
    [ -n "$p" ] || continue
    ps -W 2>/dev/null | awk -v p="$p" '$1==p{f=1} END{exit !f}' && echo "$p"
  done
}

echo "[watchdog] armed; polling every ${INTERVAL}s for model-unreachable signatures"

while true; do
  pids="$(_alive_pids)"
  if [ -z "$pids" ]; then
    echo "[watchdog] no live workers — sweep finished or already stopped; standing down"
    exit 0
  fi

  hit=""
  # Only look at the last slice of each log, so an outage that happened in a
  # PREVIOUS run does not trigger a halt of this one. (The appended-log trap:
  # these logs are never truncated between runs.)
  for f in "$LOGS"/tbench-par[0-9].log; do
    [ -f "$f" ] || continue
    m="$(tail -n 400 "$f" 2>/dev/null | grep -oE "$OUTAGE_RE" | sort -u | tr '\n' ',' | sed 's/,$//')"
    [ -n "$m" ] && hit="${hit:+$hit; }$(basename "$f"): $m"
  done

  if [ -n "$hit" ]; then
    echo "[watchdog] ⛔ MODEL UNREACHABLE — halting the sweep before it records 0.0s"
    echo "[watchdog] signature: $hit"
    echo "[watchdog] killing worker pids: $(echo $pids | tr '\n' ' ')"
    for p in $pids; do kill "$p" 2>/dev/null || true; done
    sleep 5
    for p in $pids; do kill -9 "$p" 2>/dev/null || true; done
    echo "[watchdog]"
    echo "[watchdog] Workers stopped. NOTHING is corrupted: \$STATE is written"
    echo "[watchdog] per task after the job completes, so only the in-flight"
    echo "[watchdog] tasks were lost and they re-run on resume."
    echo "[watchdog] Resume with the command in benchmark/terminal-bench/RESUME.md"
    echo "[watchdog] after running: bash credit-outage-check.sh"
    exit 1
  fi

  sleep "$INTERVAL"
done
