#!/usr/bin/env bash
# Hold the sweep at the highest worker count the API rate limit tolerates.
#
# WHY A FIXED COUNT IS THE WRONG SHAPE. Measured 2026-08-07 over 32 tasks and
# 15.4 h of job wall-clock: 4 tasks and 2.3 h — 15 % of everything — were burned
# by ApiRateLimitError, and every one of those tasks then had to run AGAIN from
# zero, so the true cost is closer to double. Meanwhile a count chosen low
# enough to never throttle leaves throughput unused for the whole run. Both
# failure modes were hit in one session: 3 workers produced the storm, 2 was
# demonstrably under the ceiling.
#
# The ceiling also is not a constant — it moves with the account's usage, the
# time of day, and what else is running. So it has to be found continuously
# rather than chosen once.
#
# HOW IT SCALES WITHOUT RESTARTING THE SWEEP. Each worker owns its own shard, so
# one can be stopped or started without touching the others. run-parallel.sh
# records each worker's exact launch line in .tb-parN.launch; this replays it.
# The supervisor never composes that environment itself — a worker relaunched
# with the wrong TB_STATE would re-run tasks that are already finished.
#
# SCALING DOWN IS IMMEDIATE, SCALING UP IS SLOW. A throttle is evidence we are
# over the ceiling right now, so back off at once. Being clean is only weak
# evidence there is headroom, so climb back one worker at a time after a long
# quiet period. Asymmetry on purpose: the cost of being one worker too low is a
# little lost throughput; the cost of being one too high is a task dying at
# attempt 5 of 5 and starting over.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LOGS="$REPO/mcp-data/logs"

MAXW="${TB_ADAPT_MAX:-3}"
MINW="${TB_ADAPT_MIN:-1}"
INTERVAL="${TB_ADAPT_INTERVAL_S:-60}"
CLEAN_MIN="${TB_ADAPT_CLEAN_MIN:-45}"     # quiet minutes before adding a worker
THROTTLE_RE='ApiRateLimitError|rate limit hit|RateLimitError|429'

_pid_of() {  # $1 = worker index -> pid if alive, else empty
  local l="$REPO/mcp-data/.tb-par${1}.lock" p
  [ -f "$l" ] || return 0
  p="$(tr -dc '0-9' < "$l" 2>/dev/null)"
  [ -n "$p" ] || return 0
  ps -W 2>/dev/null | awk -v q="$p" '$1==q{f=1} END{exit !f}' && echo "$p"
}

_alive_list() {
  local w
  for ((w=0; w<MAXW; w++)); do [ -n "$(_pid_of "$w")" ] && echo "$w"; done
}

_stop_worker() {  # $1 = index. Kill the worker AND its proxy, or nothing restarts.
  local w="$1" p port pp
  p="$(_pid_of "$w")"
  [ -n "$p" ] && { kill "$p" 2>/dev/null; sleep 4; kill -9 "$p" 2>/dev/null; }
  port=$((7425 + w))
  pp="$(netstat -ano 2>/dev/null | grep LISTENING | grep ":$port " | awk '{print $NF}' | head -1)"
  [ -n "$pp" ] && { taskkill //PID "$pp" //F >/dev/null 2>&1 || kill -9 "$pp" 2>/dev/null; }
  rm -f "$REPO/mcp-data/.tb-par${w}.lock" 2>/dev/null
  echo "[adapt] stopped worker $w (and reaped port $port)"
}

_start_worker() {  # $1 = index, replayed from the recorded launch line
  local w="$1" lf="$REPO/mcp-data/.tb-par${1}.launch"
  if [ ! -s "$lf" ]; then
    echo "[adapt] cannot start worker $w — no launch record at $lf" >&2
    return 1
  fi
  local port=$((7425 + w))
  if netstat -ano 2>/dev/null | grep LISTENING | grep -q ":$port "; then
    echo "[adapt] port $port still busy — not starting worker $w yet" >&2
    return 1
  fi
  ( cd "$HERE" && nohup bash -c "$(cat "$lf")" \
      >> "$LOGS/tbench-par${w}.log" 2>&1 & disown ) 2>/dev/null
  echo "[adapt] started worker $w"
}

# Only count throttles that happened SINCE the last check. These logs are
# append-only, so matching the whole file would re-trigger on the same event
# forever — the appended-log trap this repo has been bitten by repeatedly.
declare -A seen
for ((w=0; w<MAXW; w++)); do seen[$w]=0; done

_new_throttles() {
  local w total=0 n
  for ((w=0; w<MAXW; w++)); do
    local f="$LOGS/tbench-par${w}.log"
    [ -f "$f" ] || continue
    # NO `|| echo 0` HERE. `grep -c` already prints 0 when it matches nothing,
    # and also exits 1 — so the fallback appends a SECOND zero and the variable
    # becomes "0\n0", which fails every numeric test after it. Cost one restart
    # of this supervisor; it is the same grep exit-code trap that bit the ledger
    # cleanup earlier in this repo's history.
    n=$(grep -acE "$THROTTLE_RE" "$f" 2>/dev/null | head -1 | tr -dc '0-9')
    [ -z "$n" ] && n=0
    if [ "$n" -gt "${seen[$w]:-0}" ]; then
      total=$((total + n - ${seen[$w]:-0}))
      seen[$w]=$n
    fi
  done
  echo "$total"
}

_new_throttles >/dev/null   # prime, so pre-existing hits do not fire immediately

clean_ticks=0
need=$((CLEAN_MIN * 60 / INTERVAL))
echo "[adapt] supervising: min=$MINW max=$MAXW, back off on throttle, +1 worker after ${CLEAN_MIN}m clean"

while true; do
  alive=($(_alive_list))
  n=${#alive[@]}

  if [ "$n" -eq 0 ]; then
    echo "[adapt] no workers alive — sweep finished or stopped; standing down"
    exit 0
  fi

  hits="$(_new_throttles)"
  if [ "${hits:-0}" -gt 0 ]; then
    clean_ticks=0
    if [ "$n" -gt "$MINW" ]; then
      victim="${alive[$((n - 1))]}"
      echo "[adapt] ⛔ $hits new throttle(s) — scaling $n -> $((n - 1)) workers"
      _stop_worker "$victim"
    else
      echo "[adapt] throttled at the floor ($MINW worker) — the sweep's own backoff must ride it out"
    fi
  else
    clean_ticks=$((clean_ticks + 1))
    if [ "$clean_ticks" -ge "$need" ] && [ "$n" -lt "$MAXW" ]; then
      for ((w=0; w<MAXW; w++)); do
        if [ -z "$(_pid_of "$w")" ]; then
          echo "[adapt] ${CLEAN_MIN}m clean — scaling $n -> $((n + 1)) workers"
          _start_worker "$w" && clean_ticks=0
          break
        fi
      done
    fi
  fi

  sleep "$INTERVAL"
done
