#!/usr/bin/env bash
# Deferred lessons must be flushed even when the run FAILS.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: `_flush_deferred_on_exit` did not
# exist, so the extraction below finds nothing and the test aborts before its
# first assertion. The old trap was `kill $PROXY_PID` and nothing else.
#
# THE BUG IT PINS, measured over this campaign's own log: 98 flushes across 119
# task runs -- 21 runs (18%) never flushed, losing every lesson they had
# written. run-dg.sh runs `set -euo pipefail` and the explicit flush sits AFTER
# the harbor call, so a non-zero harbor exit terminated the script first.
#
# AND IT IS THE WORST POSSIBLE 18%: harbor exits non-zero on errored and
# timed-out tasks -- exactly the runs whose lessons are worth most.
# `train-fasttext` spent five ~600s blocks rediscovering that the agent tool
# timeout is capped at 10 minutes, wrote one lesson, and lost it; the next task
# rediscovered the same cap from scratch. This is the self-improvement loop
# losing precisely the failures it exists to learn from, and it is why a
# headline "100% of tasks wrote a lesson" was misleading: that counted
# brain_ingest_lesson CALLS (intent), not writes that reached the brain (effect).
#
# Hermetic: one fake flush endpoint, started once. No brain, no harbor.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/run-dg.sh"
PORT="${TB_TEST_FLUSH_PORT:-7461}"
WORK="$(mktemp -d)"
HITS="$WORK/hits.txt"
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

FN="$(awk '/^_flush_deferred_on_exit\(\) \{/,/^\}/' "$SRC")"
if [ -z "$FN" ]; then
  echo "  FAIL _flush_deferred_on_exit not found in run-dg.sh — nothing to test" >&2
  exit 1
fi

# Fake proxy. Replies flushed:1 normally; replies flushed:0 when the path is
# /__flush?empty, so both branches are exercised without restarting the server
# (an earlier version restarted it mid-test and deadlocked against curl).
: > "$HITS"
node -e "
const http=require('node:http'), fs=require('node:fs')
http.createServer((req,res)=>{
  fs.appendFileSync(process.argv[1], req.url+'\n')
  const empty = req.url.indexOf('empty') >= 0
  res.writeHead(200,{'content-type':'application/json'})
  res.end(empty ? '{\"flushed\":0,\"sent\":0}' : '{\"flushed\":1,\"sent\":1,\"refused\":0}')
}).listen($PORT,'127.0.0.1')
" "$HITS" &
FAKE=$!
trap 'kill $FAKE 2>/dev/null || true; rm -rf "$WORK"' EXIT
for _ in $(seq 1 20); do
  curl -s -m 1 -o /dev/null "http://127.0.0.1:$PORT/ping" 2>/dev/null && break
  sleep 0.25
done

# Run the REAL trap function under `set -e` with a command that fails, exactly
# as harbor does on an errored or timed-out task.
run_failing() {
  env TB_DEFER_WRITES="$1" PROXY_PORT="${2:-$PORT}" timeout 30 bash -c '
    set -euo pipefail
    PROXY_PID=0
    '"$FN"'
    trap _flush_deferred_on_exit EXIT INT TERM
    false            # harbor exits non-zero
    echo "UNREACHABLE: the explicit post-harbor flush never runs on this path"
  ' 2>&1
}

: > "$HITS"
out="$(run_failing 1)"; rc=$?

grep -q "__flush" "$HITS" \
  && ok "flushes_when_the_run_fails" \
  || no "flushes_when_the_run_fails" "no /__flush arrived; hits=[$(cat "$HITS" 2>/dev/null)]"

[ "$rc" -ne 0 ] \
  && ok "failure_exit_code_is_preserved" \
  || no "failure_exit_code_is_preserved" "trap swallowed the failure (rc=$rc); run-sweep would mark a failed task complete"

printf '%s' "$out" | grep -q "UNREACHABLE" \
  && no "confirms_explicit_flush_is_skipped" "the failing path did not stop early — the bug's premise is wrong" \
  || ok "confirms_explicit_flush_is_skipped"

printf '%s' "$out" | grep -q "LATE FLUSH" \
  && ok "announces_a_rescue" \
  || no "announces_a_rescue" "rescued silently; an operator cannot tell it happened. out=[$out]"

# Deferral OFF must not call the endpoint at all.
: > "$HITS"
run_failing 0 >/dev/null 2>&1
[ -s "$HITS" ] \
  && no "no_flush_when_deferral_off" "called /__flush with TB_DEFER_WRITES=0" \
  || ok "no_flush_when_deferral_off"

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
