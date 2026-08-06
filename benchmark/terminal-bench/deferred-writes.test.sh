#!/usr/bin/env bash
# Proves the deferred-write guarantee that makes k=5 submittable without
# cross-attempt leakage:
#
#   a lesson written during a task must NOT be retrievable while that task's
#   remaining attempts are still running, and MUST be retrievable afterwards.
#
# WHY IT FAILS ON THE PRE-CHANGE TREE: without TB_DEFER_WRITES the proxy
# forwards brain_ingest_lesson straight through, so step 3 finds the lesson
# immediately — which is exactly the leakage (attempt 1 feeding attempts 2..5).
#
# Requires the isolated bench brain on :7424.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PORT="${TB_TEST_PORT:-7427}"
BRAIN="${TB_TEST_BRAIN_PORT:-7424}"
MARK="DEFERPROBE-$$-$(date +%s)"
pass=0; fail=0
ok(){ echo "  ok   $1"; pass=$((pass+1)); }
no(){ echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

curl -s -m 5 -o /dev/null "http://127.0.0.1:$BRAIN/health" || { echo "bench brain :$BRAIN not up" >&2; exit 2; }

TERRANSOUL_MCP_TOKEN="$(tr -d '\r\n' < "$REPO/mcp-data-tbench/mcp-token.txt")" \
TB_PROXY_PORT="$PORT" TB_PROXY_UPSTREAM_PORT="$BRAIN" \
TB_PROXY_MODE=learn TB_DEFER_WRITES=1 TB_PROXY_LOG=/tmp/defer-test.jsonl \
  node "$HERE/mcp-auth-proxy.mjs" > /tmp/defer-test.log 2>&1 &
PROXY=$!
trap 'kill $PROXY 2>/dev/null' EXIT
for _ in $(seq 1 20); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/mcp" -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}' && break; sleep 0.5; done

call(){ curl -s -m 40 -X POST "http://127.0.0.1:$PORT/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; }
count_memories(){ # memory_total is the ONLY robust probe here.
  # brain_search does not reliably match a marker token, and brain_list_recent
  # is dominated by seed entries after a reseed — both produced false "lesson
  # lost" failures for flushes that had demonstrably worked (flushed:1).
  local tok
  tok="$(tr -d '\r\n' < "$REPO/mcp-data-tbench/mcp-token.txt")"
  curl -s -m 40 -X POST "http://127.0.0.1:$BRAIN/mcp" \
    -H "Authorization: Bearer $tok" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"brain_health","arguments":{}}}' \
    | grep -oE 'memory_total[^0-9]*[0-9]+' | grep -oE '[0-9]+' | head -1
}


BEFORE="$(count_memories)"

# 1. write is acknowledged as deferred
out="$(call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"brain_ingest_lesson\",\"arguments\":{\"content\":\"$MARK unique probe body 82782544: deferred-write verification for run $MARK; content varied so the brain dedup guard cannot collapse successive probes into one entry.\",\"category\":\"lesson\",\"tags\":\"defer-test\"}}}")"
echo "$out" | grep -qE "deferred[^,]*true" && ok "write_is_acknowledged_as_deferred" || no "write_is_acknowledged_as_deferred" "$out"

# 2. NOT retrievable while the task is still running  <-- the leakage guard
sleep 2
MID="$(count_memories)"
if [ "${MID:-0}" -gt "${BEFORE:-0}" ]; then
  no "not_retrievable_before_flush" "memory grew $BEFORE -> $MID before flush"
else
  ok "not_retrievable_before_flush"
fi

# 3. flush on shutdown, then it IS retrievable
curl -s -m 60 -X POST "http://127.0.0.1:$PORT/__flush" >/tmp/defer-flush.json
kill $PROXY 2>/dev/null; sleep 3
AFTER="$(count_memories)"
if [ "${AFTER:-0}" -gt "${BEFORE:-0}" ]; then
  ok "retrievable_after_flush"
else
  no "retrievable_after_flush" "memory did not grow ($BEFORE -> $AFTER) — deferred writes dropped"
fi

grep -q "flushed .* deferred lesson" /tmp/defer-test.log && ok "shutdown_reports_flush_count" || no "shutdown_reports_flush_count" "$(tail -2 /tmp/defer-test.log)"

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
