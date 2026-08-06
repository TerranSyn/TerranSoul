#!/usr/bin/env bash
# Tests for check-terransoul-used.sh.
#
# WHY EACH CASE FAILS ON THE PRE-CHANGE TREE (rules/tests-must-be-able-to-fail.md):
#
#   zero_use_is_reported   The first implementation counted the MCP handshake as
#                          usage, so this fixture (handshake only, no tool call)
#                          returned "OK". It also died under `set -e` before
#                          printing anything, so the test would fail on BOTH
#                          the exit code and the absent message.
#   advertised_list_is_not_use
#                          The first implementation grepped the job dir for
#                          `brain_search|mcp__terransoul`, which matches the tool
#                          list Claude Code advertises at startup. This fixture
#                          contains that list and nothing else, and used to pass
#                          as "used".
#   real_use_is_reported   Guards the opposite direction: the fix must not make
#                          the check reject genuine use.
#   disagreement_is_flagged
#                          One witness positive must not be silently accepted.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Overridable so the "does this test actually fail on the pre-change tree?"
# proof (rules/tests-must-be-able-to-fail.md) can be run for real:
#   git show HEAD:benchmark/terminal-bench/check-terransoul-used.sh > /tmp/old.sh
#   SUT_OVERRIDE=/tmp/old.sh bash check-terransoul-used.test.sh
SUT="${SUT_OVERRIDE:-$HERE/check-terransoul-used.sh}"
pass=0; fail=0

report() { # name expected_exit actual_exit output must_contain
  local name="$1" exp="$2" act="$3" out="$4" needle="$5"
  if [ "$act" = "$exp" ] && printf '%s' "$out" | grep -q "$needle"; then
    echo "  ok   $name"; pass=$((pass+1))
  else
    echo "  FAIL $name (exit want=$exp got=$act; wanted text: $needle)"
    printf '%s\n' "$out" | sed 's/^/       | /'
    fail=$((fail+1))
  fi
}

HANDSHAKE='{"method":"initialize","allowed":true,"at":"x"}
{"method":"notifications/initialized","allowed":true,"at":"x"}
{"method":"tools/list","allowed":true,"at":"x"}
{"method":"resources/list","allowed":true,"at":"x"}
{"method":"prompts/list","allowed":true,"at":"x"}'

# The literal shape Claude Code emits when it merely ADVERTISES the tools.
ADVERTISED='{"type":"system","subtype":"init","tools":["Bash","mcp__terransoul__brain_search","mcp__terransoul__brain_health"],"mcp_servers":[{"name":"terransoul","status":"connected"}]}'

# The shape of a real invocation.
INVOCATION='{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"mcp__terransoul__brain_search","input":{"query":"git"}}]}}'

t="$(mktemp -d)"

# 1. handshake only + advertised list only  -> ZERO USE
mkdir -p "$t/a/trial/agent"; printf '%s\n' "$ADVERTISED" > "$t/a/trial/agent/claude-code.txt"
printf '%s\n' "$HANDSHAKE" > "$t/a/proxy.jsonl"
out="$(bash "$SUT" "$t/a" "$t/a/proxy.jsonl" 2>&1)"; rc=$?
report "zero_use_is_reported" 1 "$rc" "$out" "ZERO MCP CALLS"
report "advertised_list_is_not_use" 1 "$rc" "$out" "0 mention(s)"

# 2. genuine use on both witnesses -> OK
mkdir -p "$t/b/trial/agent"; printf '%s\n%s\n' "$ADVERTISED" "$INVOCATION" > "$t/b/trial/agent/session.jsonl"
printf '%s\n{"tool":"brain_search","allowed":true,"at":"x"}\n' "$HANDSHAKE" > "$t/b/proxy.jsonl"
out="$(bash "$SUT" "$t/b" "$t/b/proxy.jsonl" 2>&1)"; rc=$?
report "real_use_is_reported" 0 "$rc" "$out" "genuinely used"

# 3. proxy saw a call, job dir did not -> DISAGREE
mkdir -p "$t/c/trial/agent"; printf '%s\n' "$ADVERTISED" > "$t/c/trial/agent/claude-code.txt"
printf '%s\n{"tool":"brain_search","allowed":true,"at":"x"}\n' "$HANDSHAKE" > "$t/c/proxy.jsonl"
out="$(bash "$SUT" "$t/c" "$t/c/proxy.jsonl" 2>&1)"; rc=$?
report "disagreement_is_flagged" 1 "$rc" "$out" "WITNESSES DISAGREE"

# 4. an empty proxy log must not crash the check (the `grep -c` exit-1 trap)
mkdir -p "$t/d"; : > "$t/d/proxy.jsonl"
out="$(bash "$SUT" "$t/d" "$t/d/proxy.jsonl" 2>&1)"; rc=$?
report "empty_log_still_reports" 1 "$rc" "$out" "ZERO MCP CALLS"

# ── witness 3: the brain's own verdict (added 2026-08-04) ───────────────
#
# WHY THESE FAIL ON THE PRE-CHANGE TREE: the old script read only `"tool":`
# lines (attempts) and job-dir mentions. In cases 5 and 6 BOTH old witnesses are
# positive, so it printed "TerranSoul was genuinely used" and exited 0 for a run
# in which the brain refused every call — the exact inflation that would have
# been published as a sweep result. Case 7 guards the other direction.

# 5. calls forwarded, brain errored on all of them -> NOT use
mkdir -p "$t/e/trial/agent"; printf '%s\n%s\n' "$ADVERTISED" "$INVOCATION" > "$t/e/trial/agent/session.jsonl"
{ printf '%s\n' "$HANDSHAKE"
  echo '{"tool":"brain_ingest_lesson","allowed":true,"mode":"learn-write","at":"x"}'
  echo '{"name":"brain_ingest_lesson","verdict":"refused","detail":"invalid argument: content cannot be empty","at":"x"}'
} > "$t/e/proxy.jsonl"
out="$(bash "$SUT" "$t/e" "$t/e/proxy.jsonl" 2>&1)"; rc=$?
report "brain_refused_everything_is_not_use" 1 "$rc" "$out" "ACCEPTED NOTHING"

# 6. the earned-autonomy gate refused -> named explicitly, not lumped in
mkdir -p "$t/f/trial/agent"; printf '%s\n%s\n' "$ADVERTISED" "$INVOCATION" > "$t/f/trial/agent/session.jsonl"
{ printf '%s\n' "$HANDSHAKE"
  echo '{"tool":"brain_ingest_lesson","allowed":true,"mode":"learn-write","at":"x"}'
  echo '{"name":"brain_ingest_lesson","verdict":"gate-denied","detail":"action gated by earned autonomy: tool `brain_ingest_lesson` is in the `safe_write` category","at":"x"}'
} > "$t/f/proxy.jsonl"
out="$(bash "$SUT" "$t/f" "$t/f/proxy.jsonl" 2>&1)"; rc=$?
report "gate_denial_is_named" 1 "$rc" "$out" "GATE-DENIED BY EARNED AUTONOMY"

# 7. the brain actually accepted the call -> still passes (no false alarm)
mkdir -p "$t/g/trial/agent"; printf '%s\n%s\n' "$ADVERTISED" "$INVOCATION" > "$t/g/trial/agent/session.jsonl"
{ printf '%s\n' "$HANDSHAKE"
  echo '{"tool":"brain_search","allowed":true,"at":"x"}'
  echo '{"name":"brain_search","verdict":"accepted","at":"x"}'
} > "$t/g/proxy.jsonl"
out="$(bash "$SUT" "$t/g" "$t/g/proxy.jsonl" 2>&1)"; rc=$?
report "accepted_call_is_use" 0 "$rc" "$out" "1 accepted"
report "memory_delta_absent_is_silent" 0 "$rc" "$out" "genuinely used"

# 8. optional memory_total witness is reported when supplied
out="$(bash "$SUT" "$t/g" "$t/g/proxy.jsonl" 1120 1123 2>&1)"; rc=$?
report "memory_total_delta_is_reported" 0 "$rc" "$out" "1120 -> 1123 (delta 3)"

# 9b. the rung actually used is reported, and a mixed-rung run is called out.
#     FAILS PRE-CHANGE: the old script had no concept of a retrieval rung, so a
#     `think` sweep and a `max` arm were indistinguishable in its output — and
#     the campaign now runs both.
{ printf '%s\n' "$HANDSHAKE"
  echo '{"tool":"brain_search","allowed":true,"thinkingMode":"think","thinkingModeWas":null,"at":"x"}'
  echo '{"name":"brain_search","verdict":"accepted","at":"x"}'
} > "$t/g/proxy-think.jsonl"
out="$(bash "$SUT" "$t/g" "$t/g/proxy-think.jsonl" 2>&1)"; rc=$?
report "rung_is_reported" 0 "$rc" "$out" "think(1)"

{ printf '%s\n' "$HANDSHAKE"
  echo '{"tool":"brain_search","allowed":true,"thinkingMode":"think","at":"x"}'
  echo '{"tool":"brain_search","allowed":true,"thinkingMode":"max","at":"x"}'
  echo '{"name":"brain_search","verdict":"accepted","at":"x"}'
} > "$t/g/proxy-mixed.jsonl"
out="$(bash "$SUT" "$t/g" "$t/g/proxy-mixed.jsonl" 2>&1)"; rc=$?
report "mixed_rungs_are_flagged" 0 "$rc" "$out" "MORE THAN ONE RUNG"

# 9c. no rung recorded means the server default (chat) ran — say so, because
#     silence here reads as "the configured rung applied".
out="$(bash "$SUT" "$t/b" "$t/b/proxy.jsonl" 2>&1)"; rc=$?
report "absent_rung_names_the_default" 0 "$rc" "$out" "server default (chat)"

# 9. a pre-instrumentation log must SAY so rather than imply brain-side proof
out="$(bash "$SUT" "$t/b" "$t/b/proxy.jsonl" 2>&1)"; rc=$?
report "legacy_log_declares_itself" 0 "$rc" "$out" "NONE recorded"

rm -rf "$t"
echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
