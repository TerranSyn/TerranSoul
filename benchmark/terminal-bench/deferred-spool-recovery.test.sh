#!/usr/bin/env bash
# A deferred lesson must survive the proxy being KILLED.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: deferred writes lived only in the
# in-memory `deferred[]` array. The agent is told "Lesson accepted" the instant a
# write is deferred, but the payload was not durable until the explicit /__flush.
# This sweep's driver was killed six times mid-run (script edits, a credential
# blip, a retry-policy fix) and every kill silently discarded whatever was
# buffered — lessons the agent believed it had stored, gone, with the log still
# showing the synthetic ack. Pre-change, `spool_survives_a_kill` finds no spool
# file at all and `a_new_proxy_recovers_them` flushes 0.
#
# Hermetic: a fake upstream stands in for the brain, so this needs no brain, no
# model and no network.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="${PROXY_OVERRIDE:-$HERE/mcp-auth-proxy.mjs}"
PORT="${TB_TEST_PORT:-7438}"
UPSTREAM="${TB_TEST_UPSTREAM_PORT:-7439}"
WORK="$(mktemp -d)"
LOG="$WORK/proxy.jsonl"
SPOOL="$LOG.deferred.jsonl"
CAPTURE="$WORK/upstream.txt"
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

node -e "
const http=require('node:http'), fs=require('node:fs')
http.createServer((req,res)=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>{
  fs.appendFileSync(process.argv[1], Buffer.concat(c).toString('utf8').replace(/\n/g,' ')+'\n')
  const b=JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'ok'}]}})
  res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(b)});res.end(b)})
}).listen($UPSTREAM,'127.0.0.1')
" "$CAPTURE" &
UP=$!
trap 'kill $UP 2>/dev/null; [ -n "${P1:-}" ] && kill $P1 2>/dev/null; [ -n "${P2:-}" ] && kill $P2 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 1

start_proxy() {
  TERRANSOUL_MCP_TOKEN=dummy TB_PROXY_PORT="$PORT" TB_PROXY_UPSTREAM_PORT="$UPSTREAM" \
  TB_PROXY_MODE=learn TB_DEFER_WRITES=1 TB_PROXY_LOG="$LOG" \
    node "$PROXY" >>"$WORK/proxy.log" 2>&1 &
  for _ in $(seq 1 40); do
    curl -s -m 2 -o /dev/null -X POST "http://127.0.0.1:$PORT/mcp" \
      -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":0,"method":"tools/list"}' && return 0
    sleep 0.25
  done
  return 1
}

write_lesson() {
  curl -s -m 10 -X POST "http://127.0.0.1:$PORT/mcp" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"brain_ingest_lesson","arguments":{"content":"probe lesson that must survive a kill","category":"lesson"}}}'
}

# 1. write is deferred and acknowledged
start_proxy || { no "proxy_started" "never became ready"; echo "  ---- $pass passed, $((fail+1)) failed ----"; exit 1; }
P1=$!
out="$(write_lesson)"
# The ack is nested JSON inside a text field, so its quotes arrive escaped.
printf '%s' "$out" | grep -qE '\\?"deferred\\?":ate|\\?"deferred\\?":true' && ok "write_is_acknowledged_as_deferred" \
  || no "write_is_acknowledged_as_deferred" "$out"

# 2. the payload is on DISK before any flush — this is what a kill would destroy
sleep 0.5
if [ -s "$SPOOL" ] && grep -q "must survive a kill" "$SPOOL"; then
  ok "spool_survives_a_kill"
else
  no "spool_survives_a_kill" "no spooled body at $SPOOL"
fi

# 3. kill the proxy WITHOUT flushing — the exact thing that happened six times
kill -9 "$P1" 2>/dev/null; wait "$P1" 2>/dev/null; P1=""
sleep 0.5
grep -q "must survive a kill" "$CAPTURE" 2>/dev/null \
  && no "kill_before_flush_sends_nothing" "the lesson reached upstream despite no flush" \
  || ok "kill_before_flush_sends_nothing"

# 4. a NEW proxy drains what the dead one left behind
start_proxy || { no "second_proxy_started" "never became ready"; echo "  ---- $pass passed, $((fail+1)) failed ----"; exit 1; }
P2=$!
flush="$(curl -s -m 30 -X POST "http://127.0.0.1:$PORT/__flush")"
if printf '%s' "$flush" | grep -q '"flushed":1'; then
  ok "a_new_proxy_recovers_them"
else
  no "a_new_proxy_recovers_them" "flush reported: $flush"
fi
grep -q "must survive a kill" "$CAPTURE" 2>/dev/null \
  && ok "recovered_lesson_reached_the_brain" \
  || no "recovered_lesson_reached_the_brain" "upstream never saw it"

# 5. and the spool is cleared once every body is answered for
[ -s "$SPOOL" ] && no "spool_cleared_after_flush" "spool still present" || ok "spool_cleared_after_flush"

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
