#!/usr/bin/env bash
# Hand off from the k=1 sweep to the k=2 ATTRIBUTION run, in one command.
#
#   usage: launch-k2-attribution.sh          # checks, then launches
#          DRY=1 launch-k2-attribution.sh    # show what it would do
#
# WHY A SCRIPT AND NOT A CHECKLIST. The handoff is four steps, each of which has
# already gone wrong once in this campaign:
#   * forget to checkpoint      -> the k=1 prefixes are lost and the merge covers
#                                  one restart out of six
#   * forget to swap the script -> the attribution run batches 10 tasks x k into
#                                  one job at concurrency 4, attempts overlap,
#                                  and the experiment returns a confident null
#   * forget to clear $RETRIES  -> flaky tasks start with their budget spent
#   * forget to reset $STATE    -> 80 tasks are skipped and k=2 never runs
#
# THE DESIGN. Attempt 1 of each task is the CONTROL: no lesson for that task can
# exist yet, whatever the deferral setting. Attempt 2 is the TREATMENT: it can
# read what attempt 1 wrote. Each task is therefore its own paired experiment and
# no separate memory-off arm is needed.
#
# k=2 rather than k=5 because for a PAIRED comparison the power comes from the
# number of PAIRS, not attempts per task: 89 tasks x 1 extra attempt gives 89
# independent pairs, where 30 tasks x 4 extra attempts gives 30 clusters of
# correlated ones -- for a fifth of the cost.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DRY="${DRY:-0}"

run() { if [ "$DRY" = "1" ]; then echo "  would: $*"; else eval "$@"; fi; }

# ── refuse to start on top of a live sweep ──────────────────────────────────
if pgrep -f "run-sweep.sh" >/dev/null 2>&1 || \
   docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'env-main'; then
  echo "REFUSING: a sweep or task container is still running." >&2
  echo "  A second sweep fights the first over the proxy port (EADDRINUSE 7425)" >&2
  echo "  and both runs die -- measured 2026-08-04." >&2
  exit 2
fi

remaining=$(( 89 - $(wc -l < "$REPO/mcp-data/.tb-sweep-state.txt" 2>/dev/null || echo 0) ))
if [ "$remaining" -gt 0 ]; then
  echo "NOTE: the k=1 sweep still has $remaining task(s) unfinished."
  echo "  Its attempt-1 results are the reference this run is compared against."
  [ "${FORCE:-0}" = "1" ] || { echo "  Re-run with FORCE=1 to launch anyway." >&2; exit 3; }
fi

echo "[1/4] checkpoint the k=1 campaign"
run "bash '$HERE/checkpoint.sh' campaign-k1-final"

echo "[2/4] swap in the staged run-sweep with the attribution fixes"
run "cp -f '$HERE/run-sweep.sh' '$HERE/run-sweep.k1.bak'"
run "cp -f '$HERE/run-sweep.next.sh' '$HERE/run-sweep.sh'"

echo "[3/4] reset campaign state (k=1 prefixes are preserved in the checkpoint)"
run ": > '$REPO/mcp-data/.tb-sweep-state.txt'"
run ": > '$REPO/mcp-data/.tb-sweep-retries.txt'"
run ": > '$REPO/mcp-data/.tb-sweep-prefixes.txt'"
run ": > '$REPO/mcp-data/.tb-sweep-accepted-failures.txt'"

echo "[4/4] launch"
# TB_ONE_JOB_PER_TASK=1 with deferral OFF is the whole point: writes land
# immediately so attempt 2 can read them, while each task still gets its own
# harbor job so its attempts cannot overlap.
# TB_CONCURRENCY=1 makes the two attempts strictly sequential -- without it,
# attempt 1's lesson may not exist when attempt 2 starts and the run returns a
# null that reads as "memory does not help".
# TB_EFFORT: UNSET (harbor's CLI default), matching k=1.
#
# ⚠️ REVERTED FROM `ultracode` ON MEASURED EVIDENCE, 2026-08-06. Ultracode ran
# for exactly one task and cost $6.14 to disprove itself: both attempts of
# `adaptive-rejection-sampler` took 13.1 and 14.9 minutes against a 900 s
# (15 min) ceiling and returned AgentTimeoutError, 0.0 each. The same task at
# default effort had completed in 9.8 and 9.9 minutes.
#
# The exposure is structural, not bad luck. 48 of 89 tasks (54%) carry a 900 s
# ceiling, and 14 tasks were ALREADY at >=60% of their ceiling at default
# effort — adaptive-rejection-sampler 98%, build-cython-ext 98%,
# largest-eigenval 99%, make-doom-for-mips 97%. On this benchmark extra
# reasoning is not paid in tokens, it is paid in WALL CLOCK, and wall clock is
# the binding constraint: a task that runs out of time scores 0 however well it
# was reasoning.
#
# It also destroys the experiment. A k=2 number depressed by ~8-10 self-
# inflicted timeouts cannot be compared with k=1's 0.8315, and the memory
# uplift — the only thing this run exists to measure — becomes unrecoverable.
# Default effort restores BOTH comparability and the single-variable design.
#
# TB_THINKING_MODE is left to run-sweep.sh's `think` (owner 2026-08-05: "use
# TerranSoul thinking mode set to think, not max" — max costs ~374 s per search
# and a task that runs out of wall-clock scores 0 however good its retrieval).
#
# TB_DEFER_WRITES=0 is what makes this an attribution run: writes land
# immediately, so attempt 2 can read what attempt 1 wrote. It also sidesteps the
# flush-on-failure bug entirely — nothing is held, so nothing can be lost.
CMD="nohup env TB_ATTEMPTS=2 TB_DEFER_WRITES=0 TB_ONE_JOB_PER_TASK=1 TB_CONCURRENCY=1 \
TB_EFFORT='${TB_EFFORT:-}' \
TB_PROXY_MODE=learn PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
bash '$HERE/run-sweep.sh' >> '$REPO/mcp-data/logs/tbench-k2.log' 2>&1 &"
if [ "$DRY" = "1" ]; then
  echo "  would: $CMD"
else
  eval "$CMD"
  disown 2>/dev/null || true
  echo "  launched; log: mcp-data/logs/tbench-k2.log"
fi

echo ""
echo "  analyse with:"
echo "    bash $HERE/attempt-uplift.sh $HERE/jobs      # pass-rate + runtime delta"
echo "    bash $HERE/attempt-cost.sh   $HERE/jobs <prefix>   # token/cost ratio"
echo "  and remember: the attempts-2 rate is an EXPERIMENT, not a submittable score."
