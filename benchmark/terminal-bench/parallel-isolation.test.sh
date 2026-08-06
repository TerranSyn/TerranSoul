#!/usr/bin/env bash
# run-dg.sh carried two assumptions that are correct for ONE sequential runner
# and destructive for N parallel workers. Both were found on 2026-08-06 after
# 40 k=2 trials died with `NonZeroAgentExitCodeError (exit 137)` inside
# harbor's _setup_agent — a signature that reads exactly like an out-of-memory
# kill and is not one.
#
#  1. CONTAINER REAP. `docker ps -a | grep env-main | xargs docker rm -f` ran at
#     the start of every task, so worker B force-removed worker A's LIVE
#     container. Evidence it was never memory: victims died 5-38s into setup,
#     `dmesg` had zero OOM records, and live containers sat at 40-94 MiB against
#     a 2 GiB cap.
#  2. MCP CONFIG PATH. All workers rendered their proxy port into ONE shared
#     file, so a container could be pointed at another worker's proxy — which
#     mis-attributes brain calls and rips out brain access when that worker's
#     task ends.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md): cases 1-3 run
# the REAL reap function against REAL docker containers, one named for a task
# this invocation owns and one named for a task it does not. On the pre-change
# tree the blanket `xargs docker rm -f` deletes BOTH, so case 2 goes red. Case 4
# greps for the per-port config path, which does not exist pre-change. Case 5
# asserts the whole-suite fallback still reaps everything, so a "fix" that
# simply deletes the reap also fails.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DG="$HERE/run-dg.sh"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "parallel-isolation:"

if ! docker ps -q >/dev/null 2>&1; then
  echo "  SKIP - docker engine not available"; exit 0
fi

MINE="ptest-mine__aaa111__env-main-1"
THEIRS="ptest-theirs__bbb222__env-main-1"
cleanup() { docker rm -f "$MINE" "$THEIRS" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# Two stopped containers standing in for "my task" and "another worker's task".
docker create --name "$MINE"   alpine:latest sleep 300 >/dev/null 2>&1 \
  || docker create --name "$MINE"   busybox sleep 300 >/dev/null 2>&1
docker create --name "$THEIRS" alpine:latest sleep 300 >/dev/null 2>&1 \
  || docker create --name "$THEIRS" busybox sleep 300 >/dev/null 2>&1

if docker ps -a --format '{{.Names}}' | grep -qx "$MINE" && \
   docker ps -a --format '{{.Names}}' | grep -qx "$THEIRS"; then
  ok "fixture containers created"
else
  bad "could not create fixture containers (no alpine/busybox image?)"
  echo "  ---- $pass passed, $fail failed"; exit 1
fi

# Extract and run the REAL reap function, scoped to ptest-mine only.
reap_src="$(awk '/^_reap_stale_containers\(\) \{/,/^\}/' "$DG")"
if [ -z "$reap_src" ]; then
  # Pre-change tree: no function exists, the reap is a bare blanket pipeline.
  reap_src='_reap_stale_containers() { docker ps -a --format "{{.Names}}" | grep -E "env-main" | xargs -r docker rm -f >/dev/null 2>&1 || true; }'
fi
( TB_TASKS="ptest-mine"; TASK=""; eval "$reap_src"; _reap_stale_containers ) >/dev/null 2>&1

still_mine=$(docker ps -a --format '{{.Names}}' | grep -cx "$MINE" || true)
still_theirs=$(docker ps -a --format '{{.Names}}' | grep -cx "$THEIRS" || true)

# ── 1. it must reap its OWN stale container ─────────────────────────────────
if [ "$still_mine" = "0" ]; then
  ok "reaped its own stale container"
else
  bad "did NOT reap its own container - leftovers will collide"
fi

# ── 2. it must NOT touch another worker's container (THE BUG) ───────────────
if [ "$still_theirs" = "1" ]; then
  ok "left another worker's container ALIVE (no cross-worker sabotage)"
else
  bad "DESTROYED another worker's container - this is the exit-137 sabotage bug"
fi

# ── 3. the reap must be a scoped function, not a blanket pipeline ───────────
if grep -qE '^_reap_stale_containers\(\) \{' "$DG" && \
   ! grep -qE "^docker ps -a --format '\{\{\.Names\}\}' \| grep -E 'env-main' \| xargs -r docker rm -f" "$DG"; then
  ok "reap is scoped by task name, no top-level blanket rm -f"
else
  bad "a top-level blanket 'rm -f all env-main' still exists in run-dg.sh"
fi

# ── 4. MCP config path must be per-proxy-port ───────────────────────────────
if grep -qE 'MCP_CONFIG="\$REPO/mcp-data/\.tb-mcp-\$PROXY_PORT\.json"' "$DG"; then
  ok "MCP config path is per-proxy-port"
else
  bad "MCP config path is shared across workers - ports will race"
fi

# ── 4b. proxy CALL LOG must be per-proxy-port ───────────────────────────────
# This one is the worst of the shared-path family: the file is truncated at the
# start of every task AND is the input to check-terransoul-used.sh's witness 3,
# which the playbook calls DECISIVE. Shared, it makes a worker count other
# workers' brain calls and lose its own — so "TerranSoul was genuinely used"
# becomes unfalsifiable.
if grep -qE 'PROXY_LOG="\$REPO/mcp-data/\.tb-proxy-calls-\$PROXY_PORT\.jsonl"' "$DG"; then
  ok "proxy call log is per-proxy-port (witness 3 cannot cross-contaminate)"
else
  bad "proxy call log is SHARED and truncated per task - witness 3 is corrupted"
fi

# ── 5. whole-suite runs (no -i) must still reap everything ──────────────────
docker rm -f "$MINE" "$THEIRS" >/dev/null 2>&1 || true
docker create --name "$THEIRS" alpine:latest sleep 300 >/dev/null 2>&1 \
  || docker create --name "$THEIRS" busybox sleep 300 >/dev/null 2>&1
( TB_TASKS=""; TASK=""; eval "$reap_src"; _reap_stale_containers ) >/dev/null 2>&1
if [ "$(docker ps -a --format '{{.Names}}' | grep -cx "$THEIRS" || true)" = "0" ]; then
  ok "whole-suite run still reaps everything (fallback intact)"
else
  bad "whole-suite fallback no longer reaps - stale containers will accumulate"
fi

# ── 6. the reap must SURVIVE `set -euo pipefail` when nothing matches ───────
# This is the normal path — a clean host has no leftovers — and it regressed
# the moment network reaping was added: `grep` exits 1 on no match, pipefail
# propagates it, and `set -e` killed run-dg between "MCP auth proxy up" and
# "job=" with NO error message. The sweep then reported three tasks in a row as
# "FAILED before producing a result (preflight/infra)". A reap that only works
# when there is something to reap is worse than none.
probe="$TMP/reap_under_set_e.sh"
{ echo 'set -euo pipefail'
  awk '/^_reap_stale_containers\(\) \{/,/^_reap_stale_containers$/' "$DG"
  echo 'echo REACHED_END'
} > "$probe"
for scope in "scoped" "whole-suite"; do
  if [ "$scope" = "scoped" ]; then env_tasks="ptest-nonexistent-task"; else env_tasks=""; fi
  out="$(TB_TASKS="$env_tasks" TASK="" bash "$probe" 2>/dev/null)"; rc=$?
  if [ "$rc" = "0" ] && printf '%s' "$out" | grep -q REACHED_END; then
    ok "reap survives set -euo pipefail with no matches ($scope)"
  else
    bad "reap ABORTS under set -e when nothing matches ($scope, rc=$rc) - run-dg will die silently"
  fi
done

echo "  ---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
