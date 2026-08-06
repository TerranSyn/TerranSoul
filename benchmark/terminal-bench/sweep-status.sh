#!/usr/bin/env bash
# Status of the CURRENT sweep only.
#
#   usage: sweep-status.sh
#
# WHY THIS EXISTS. `mcp-data/logs/tbench-par*.log` are APPENDED across every
# launch, and this campaign has relaunched many times. So `tail -30` or a plain
# `grep ERRORED` shows entries from runs that are long dead, and it does it
# convincingly — the lines look current because they are at the end of the file.
#
# Measured 2026-08-06, three separate false alarms in one session:
#   * "worker 0 is failing every task at preflight" — those failures were from
#     the previous launch, before the fix; worker 0 was mid-task and healthy.
#   * "all three proxies are bound to :7428" — that line came from
#     tbench-par3.log, a stale 4-worker-run log the `par*.log` glob still
#     matches. Each live worker was correctly on 7425/7426/7427.
#   * an ERRORED count that mixed two launches into one total.
# run-parallel.sh's own shard guard carries the same warning for the same
# reason ("these logs are APPENDED across launches ... read the LATEST line").
#
# Anchor on the last `[sweep] job prefix:` line — run-sweep prints it once per
# launch, so everything after it belongs to the current run and nothing before
# it does.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LOGS="$REPO/mcp-data/logs"

printf '%s\n' "── sweep status @ $(date '+%H:%M:%S') ─────────────────────────────"

any=0
for f in "$LOGS"/tbench-par[0-9].log; do
  [ -f "$f" ] || continue
  w="$(basename "$f" .log | sed 's/tbench-par//')"

  # Last launch marker in THIS log. No marker => the log predates the current
  # scheme; say so rather than reporting stale numbers as if they were live.
  start="$(grep -n '\[sweep\] job prefix:' "$f" 2>/dev/null | tail -1 | cut -d: -f1)"
  if [ -z "$start" ]; then
    printf '  worker %s : no launch marker — log is stale or pre-dates this scheme\n' "$w"
    continue
  fi
  prefix="$(sed -n "${start}p" "$f" | sed 's/.*job prefix: //')"

  # Is this worker's process actually alive? A log that simply stopped being
  # written looks identical to one whose worker finished.
  lock="$REPO/mcp-data/.tb-par${w}.lock"
  alive="dead"
  if [ -f "$lock" ]; then
    pid="$(cat "$lock" 2>/dev/null)"
    if [ -n "$pid" ] && ps -W 2>/dev/null | awk -v p="$pid" '$1==p{f=1} END{exit !f}'; then
      alive="alive"
    fi
  fi

  body="$(tail -n +"$start" "$f")"
  started=$(printf '%s' "$body"  | grep -cE '^\[sweep\]   task ' || true)
  preflight=$(printf '%s' "$body"| grep -cE 'FAILED before producing' || true)
  errored=$(printf '%s' "$body"  | grep -cE '^\[sweep\]   task .* ERRORED' || true)
  accepted=$(printf '%s' "$body" | grep -oE 'witness 3 .*: [0-9]+ accepted' | grep -oE '[0-9]+ accepted' | awk '{s+=$1} END{print s+0}')
  refused=$(printf '%s' "$body"  | grep -oE '[0-9]+ refused' | awk '{s+=$1} END{print s+0}')
  denied=$(printf '%s' "$body"   | grep -oE '[0-9]+ gate-denied' | awk '{s+=$1} END{print s+0}')
  cur="$(printf '%s' "$body" | grep -E '^\[sweep\]   task ' | tail -1 | sed -E 's/^\[sweep\]   task ([^ ]+).*/\1/')"

  shard="$REPO/mcp-data/.tb-par${w}-state.txt.shard"
  state="$REPO/mcp-data/.tb-par${w}-state.txt"
  done_n="?"; tot="?"
  if [ -f "$shard" ] && [ -f "$state" ]; then
    tot=$(tr -d '\r' < "$shard" | grep -c . || true)
    done_n=$(comm -12 <(tr -d '\r' < "$shard" | sort) <(tr -d '\r' < "$state" | sort) | grep -c . || true)
  fi

  printf '  worker %s [%s] %s\n' "$w" "$alive" "$prefix"
  printf '      progress   : %s/%s done   started this run: %s   now: %s\n' "$done_n" "$tot" "$started" "${cur:-<none>}"
  printf '      failures   : %s preflight/infra, %s errored\n' "$preflight" "$errored"
  printf '      brain calls: %s accepted, %s refused, %s gate-denied\n' "$accepted" "$refused" "$denied"
  any=1
done
[ "$any" = "1" ] || echo "  no worker logs found under $LOGS"

echo
printf '  containers : %s live\n' "$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c 'env-main' || true)"
printf '  networks   : %s leftover __env (pool holds 4096)\n' "$(docker network ls --format '{{.Name}}' 2>/dev/null | grep -c '__env' || true)"
printf '  C: free    : %s\n' "$(df -h /c 2>/dev/null | tail -1 | awk '{print $4}')"
