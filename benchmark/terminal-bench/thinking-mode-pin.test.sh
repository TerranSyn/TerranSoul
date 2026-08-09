#!/usr/bin/env bash
# Tests that the bench proxy PINS TerranSoul's thinking_mode (owner: "thinking
# is max", 2026-08-04).
#
# WHY EVERY CASE FAILS ON THE PRE-CHANGE TREE: the proxy forwarded the request
# body verbatim apart from the learn-mode category rewrite. `brain_search`
# defaults to `chat` (internal module:53), so every sweep measured TerranSoul's
# CHEAPEST rung — no reason-then-rank judge, no KG-edge expansion, no
# claim-level verification — while publishing under its name. On the pre-change
# tree `pins_max_when_absent` finds no thinking_mode in the forwarded body at
# all, and `overrides_a_cheaper_choice` finds the agent's `chat` still there.
#
# Hermetic: a fake upstream captures what the proxy forwards, so this needs no
# brain, no model and no network. Runs in ~2s.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="${PROXY_OVERRIDE:-$HERE/mcp-auth-proxy.mjs}"
PORT="${TB_TEST_PORT:-7428}"
UPSTREAM="${TB_TEST_UPSTREAM_PORT:-7429}"
CAPTURE="$(mktemp -t tb-capture-XXXXXX)"
pass=0; fail=0

ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

# Fake upstream: record each body on its own line, answer a valid JSON-RPC result.
node -e "
const http = require('node:http'), fs = require('node:fs')
http.createServer((req, res) => {
  const c = []
  req.on('data', d => c.push(d))
  req.on('end', () => {
    fs.appendFileSync(process.argv[1], Buffer.concat(c).toString('utf8').replace(/\n/g, ' ') + '\n')
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  })
}).listen($UPSTREAM, '127.0.0.1')
" "$CAPTURE" &
UP_PID=$!
trap 'kill $UP_PID 2>/dev/null; [ -n "${PROXY_PID:-}" ] && kill $PROXY_PID 2>/dev/null; rm -f "$CAPTURE"' EXIT
sleep 1

start_proxy() { # $1 = TB_THINKING_MODE value ("" = leave unset -> default)
  if [ -n "${PROXY_PID:-}" ]; then
    kill "$PROXY_PID" 2>/dev/null
    wait "$PROXY_PID" 2>/dev/null
    PROXY_PID=""
  fi
  # A fixed sleep here is what made an earlier version of this test lie: the
  # restart lost the port race, every later curl failed, and the assertions
  # read the PREVIOUS capture line — so "no thinking_mode present" passed for a
  # proxy that was not running. Wait for readiness, and fail loudly if it never
  # comes.
  export TERRANSOUL_MCP_TOKEN=dummy-token
  export TB_PROXY_PORT="$PORT" TB_PROXY_UPSTREAM_PORT="$UPSTREAM"
  if [ -n "${1:-}" ]; then export TB_THINKING_MODE="$1"; else unset TB_THINKING_MODE; fi
  node "$PROXY" >/dev/null 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 1 40); do
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/__flush" -X POST 2>/dev/null; then return 0; fi
    sleep 0.25
  done
  no "proxy_started(${1:-default})" "never became ready on :$PORT"
  return 1
}

call() { # $1 = json arguments blob, $2 = tool name (default brain_search)
  local before after
  before="$(wc -l < "$CAPTURE" 2>/dev/null || echo 0)"
  curl -s -m 10 -X POST "http://127.0.0.1:$PORT/mcp" \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"${2:-brain_search}\",\"arguments\":$1}}" \
    >/dev/null 2>&1
  # The assertion below reads the LAST captured line, so it must be a NEW one.
  for _ in $(seq 1 40); do
    after="$(wc -l < "$CAPTURE" 2>/dev/null || echo 0)"
    [ "$after" -gt "$before" ] && return 0
    sleep 0.25
  done
  return 1
}

last() { tail -n1 "$CAPTURE"; }

# 1. no thinking_mode supplied -> pinned to THINK.
#    Owner 2026-08-05 revised the 2026-08-04 "thinking is max" instruction:
#    "we changed to think mode now because of timeout and uncertainty of
#    completion". max costs ~374 s per brain_search versus ~1 s at think, and on
#    a wall-clock-bounded benchmark that is a CORRECTNESS cost, not a latency
#    one — a task that runs out of time scores 0 however good its retrieval was.
#    This assertion is the guard against the default drifting back.
start_proxy ""
call '{"query":"x"}' || no "pins_think_when_absent" "no request reached the upstream"
if printf '%s' "$(last)" | grep -q '"thinking_mode":"think"'; then
  ok "pins_think_when_absent"
else
  no "pins_think_when_absent" "forwarded: $(last)"
fi

# 2. the agent's own choice is overridden either way, because an instruction the
#    agent may decline is not a configuration. `chat` is the rung it would pick
#    on its own (brain_search's schema default), so it is the realistic case.
call '{"query":"x","thinking_mode":"chat"}' || no "overrides_the_agents_choice" "no request reached the upstream"
if printf '%s' "$(last)" | grep -q '"thinking_mode":"think"'; then
  ok "overrides_the_agents_choice"
else
  no "overrides_the_agents_choice" "forwarded: $(last)"
fi

# 2b. and an EXPENSIVE choice is pulled back down. Without this, an agent that
#     asked for `max` would spend ~374 s per search inside a wall-clock budget
#     the pin exists to protect — the exact failure the think default prevents.
call '{"query":"x","thinking_mode":"max"}' || no "overrides_an_expensive_choice" "no request reached the upstream"
if printf '%s' "$(last)" | grep -q '"thinking_mode":"think"'; then
  ok "overrides_an_expensive_choice"
else
  no "overrides_an_expensive_choice" "forwarded: $(last)"
fi

# 3. a tool whose schema has NO thinking_mode must not receive one — a silent
#    no-op reads in the log exactly like a mode that took effect
call '{"query":"x"}' brain_suggest_context || no "does_not_inject_into_unsupported_tools" "no request reached the upstream"
if printf '%s' "$(last)" | grep -q '"thinking_mode"'; then
  no "does_not_inject_into_unsupported_tools" "forwarded: $(last)"
else
  ok "does_not_inject_into_unsupported_tools"
fi

# 4. TB_THINKING_MODE=off restores agent discretion
start_proxy off
call '{"query":"x"}' || no "off_restores_agent_discretion" "no request reached the upstream"
if printf '%s' "$(last)" | grep -q '"thinking_mode"'; then
  no "off_restores_agent_discretion" "forwarded: $(last)"
else
  ok "off_restores_agent_discretion"
fi

# 5. an explicit rung other than max is honoured
start_proxy research
call '{"query":"x"}' || no "explicit_rung_is_honoured" "no request reached the upstream"
if printf '%s' "$(last)" | grep -q '"thinking_mode":"research"'; then
  ok "explicit_rung_is_honoured"
else
  no "explicit_rung_is_honoured" "forwarded: $(last)"
fi

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
