#!/usr/bin/env bash
# Decide whether a Terminal-Bench job may carry TerranSoul's name.
#
#   usage: check-terransoul-used.sh <job-dir> <proxy-log> [mem-before] [mem-after]
#   exit 0 = TerranSoul was genuinely used
#   exit 1 = zero use, the witnesses disagree, or the BRAIN refused the calls
#
# THIRD BUG, fixed 2026-08-04 (rules/tbench-playbook.md flagged it before a
# sweep could spend money on it): both original witnesses count ATTEMPTS. The
# proxy logged `allowed:true` before forwarding and the job dir records that the
# agent *called* a tool — neither knows what the brain answered. With
# `safe_write` trust stuck at 0.50 vs a 0.60 threshold (TRUST-BOOTSTRAP-1), a
# learn-mode sweep would have reported "N tool call(s) served" while the brain
# refused every single write. Witness 3 reads the brain's own verdicts, now
# recorded by the proxy, and is DECISIVE: attempts are not use.
#
# A SEPARATE SCRIPT ON PURPOSE. Inline in run-dg.sh this logic could only ever
# be exercised by finishing a real (paid) harbor job, so its bugs surfaced only
# after spending money — and it shipped two of them:
#
#   1. It counted the MCP HANDSHAKE as usage. initialize / tools/list /
#      resources/list / prompts/list are emitted by merely connecting, so a
#      brain that was never called scored 7 "calls" and passed.
#   2. Under `set -euo pipefail`, `grep -c` exits 1 on a zero count, which
#      killed the whole block. On job dg-20260804-160416 the section printed
#      its header and NOTHING else — silent, in precisely the case it exists
#      to report.
#
# Both are the same underlying mistake: a check whose failure path is never
# executed is not a check. This file has a test (check-terransoul-used.test.sh).
set -uo pipefail

JOB_DIR="${1:?usage: check-terransoul-used.sh <job-dir> <proxy-log> [mem-before] [mem-after]}"
PROXY_LOG="${2:?usage: check-terransoul-used.sh <job-dir> <proxy-log> [mem-before] [mem-after]}"
MEM_BEFORE="${3:-}"
MEM_AFTER="${4:-}"

# `grep -c` exits 1 on a zero count, which under the original `set -e` killed
# the whole block (see the header). Every count goes through here.
count_in_log() {
  local n
  n="$(grep -c "$1" "$PROXY_LOG" 2>/dev/null || true)"
  n="$(printf '%s' "${n:-0}" | tr -dc '0-9')"
  printf '%s' "${n:-0}"
}

# Witness 1 — host-side, independent of harbor's log format.
# `"tool":` is written by the proxy ONLY for a tools/call it serviced; protocol
# methods are logged as `"method":` and must not count.
proxy_calls="$(grep -c '"tool":' "$PROXY_LOG" 2>/dev/null || true)"
proxy_calls="$(printf '%s' "${proxy_calls:-0}" | tr -dc '0-9')"
proxy_calls="${proxy_calls:-0}"

blocked="$(grep -c '"allowed":false' "$PROXY_LOG" 2>/dev/null || true)"
blocked="$(printf '%s' "${blocked:-0}" | tr -dc '0-9')"
blocked="${blocked:-0}"

proxy_tools="$(grep -o '"tool":"[a-z_]*"' "$PROXY_LOG" 2>/dev/null | sort | uniq -c | sort -rn | head -8 || true)"

# Witness 2 — job-dir side, independent of the proxy still running.
# `"name":"mcp__terransoul__…"` appears only inside an actual tool_use block.
# The tool list Claude Code ADVERTISES at startup is a bare array of strings
# with no `"name":` prefix, which is why the earlier `grep brain_search` was
# wrong: it matched availability, not invocation.
# NOTE: this is a CORROBORATION signal, not a call count. Harbor writes the
# same tool_use into both trajectory.json and the session jsonl, so one real
# invocation shows up at least twice. Reporting it as "invocations" overstated
# usage on job dg-20260804-174333 (2 reported, 1 actual). Witness 1 is the
# authoritative count; this one answers only "does the job dir agree that the
# brain was called at all?".
hits="$(grep -rho '"name":"mcp__terransoul__[a-z_]*"' "$JOB_DIR" 2>/dev/null | wc -l | tr -d ' ' || true)"
hits="${hits:-0}"
hit_files="$(grep -rl '"name":"mcp__terransoul__' "$JOB_DIR" 2>/dev/null | wc -l | tr -d ' ' || true)"
hit_files="${hit_files:-0}"

# Witness 3 — the BRAIN's own verdict per forwarded call, teed out of the
# upstream response by the proxy (mcp-auth-proxy.mjs::noteOutcome). This is the
# only witness that distinguishes "the agent called TerranSoul" from
# "TerranSoul did something". An MCP refusal is HTTP 200 with
# `result.isError:true`, so nothing below the body can see it.
accepted="$(count_in_log '"verdict":"accepted"')"
gate_denied="$(count_in_log '"verdict":"gate-denied"')"
refused="$(count_in_log '"verdict":"refused"')"
unreadable="$(count_in_log '"verdict":"unparseable"')"
verdicts=$((accepted + gate_denied + refused + unreadable))

echo "  witness 1 (host-side proxy log): ${proxy_calls} tool call(s) FORWARDED, ${blocked} write(s) blocked by the proxy"
[ -n "$proxy_tools" ] && echo "$proxy_tools" | sed 's/^/    /'
echo "  witness 2 (job dir, corroboration): ${hits} mention(s) across ${hit_files} file(s) — duplicated per file, not a call count"

if [ "$verdicts" -eq 0 ]; then
  echo "  witness 3 (brain-side verdicts): NONE recorded — this proxy log predates the"
  echo "    accepted/refused instrumentation, so witness 1 counts attempts only."
else
  echo "  witness 3 (brain-side, DECISIVE): ${accepted} accepted, ${refused} refused, ${gate_denied} gate-denied, ${unreadable} unreadable"
fi

# Witness 5 — WHICH RUNG actually ran. The campaign deliberately runs two
# (`think` for the sweep, `max` on a subset), and the single most damaging
# publishing mistake available here is attaching the wrong one to a number —
# the same misattribution `rules/one-path-three-surfaces.md` exists to prevent.
# Read from the wire, not from the config that was meant to apply.
rungs="$(grep -o '"thinkingMode":"[a-z]*"' "$PROXY_LOG" 2>/dev/null | sed 's/.*:"//;s/"//' | sort | uniq -c | awk '{print $2"("$1")"}' | tr '\n' ' ' || true)"
if [ -n "$rungs" ]; then
  echo "  witness 5 (retrieval rung ON THE WIRE): ${rungs}"
  distinct="$(printf '%s' "$rungs" | wc -w | tr -d ' ')"
  [ "${distinct:-0}" -gt 1 ] && echo "    *** MORE THAN ONE RUNG IN ONE RUN — do not publish this as a single arm. ***"
else
  echo "  witness 5 (retrieval rung): not recorded — brain_search ran at the server default (chat)."
fi

if [ -n "$MEM_BEFORE" ] && [ -n "$MEM_AFTER" ]; then
  echo "  witness 4 (brain memory_total): ${MEM_BEFORE} -> ${MEM_AFTER} (delta $((MEM_AFTER - MEM_BEFORE)))"
  if [ "$accepted" -gt 0 ] && [ "$((MEM_AFTER - MEM_BEFORE))" -lt 0 ]; then
    echo "  *** memory_total went DOWN while writes were accepted — investigate. ***"
    exit 1
  fi
fi

if [ "$gate_denied" -gt 0 ]; then
  echo "  *** ${gate_denied} CALL(S) GATE-DENIED BY EARNED AUTONOMY. ***"
  echo "  The brain was reachable and refused to act: its action_trust ledger does not"
  echo "  trust this category yet. A sweep in this state learns nothing while every"
  echo "  attempt counter still climbs. Check action_trust_ledger before re-running."
  exit 1
fi

if [ "$verdicts" -gt 0 ] && [ "$accepted" -eq 0 ]; then
  echo "  *** THE BRAIN ACCEPTED NOTHING. ${verdicts} call(s) forwarded, 0 accepted. ***"
  echo "  Calls reached TerranSoul and every one came back an error. This is not use."
  exit 1
fi

if [ "$proxy_calls" -gt 0 ] && [ "$hits" -gt 0 ]; then
  echo "  OK — TerranSoul was genuinely used. The number may carry its name."
  exit 0
fi

if [ "$proxy_calls" -gt 0 ] || [ "$hits" -gt 0 ]; then
  echo "  *** WITNESSES DISAGREE — investigate before publishing anything. ***"
  exit 1
fi

echo "  *** ZERO MCP CALLS. ***"
echo "  The brain may have CONNECTED, but it was never called. This is Claude"
echo "  Code's own score with TerranSoul as decoration — do NOT publish it under"
echo "  a name containing 'TS'. Connecting is not using."
exit 1
