#!/usr/bin/env bash
# run-dg.sh renders its extra-instruction into a per-task mktemp and, until
# 2026-08-06, never removed it: 93 `tb-instruction-*.md` were left in /tmp after
# ~180 trials of the k=1/k=2 campaign.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md): case 1 greps the
# EXIT trap for the `rm -f "${INSTRUCTION_FILE...}"` line, which simply does not
# exist on the pre-change tree — revert the edit and case 1 goes red. Case 2
# executes the real `_flush_deferred_on_exit` body extracted from the script, so
# it fails too if the line is present but guarded so it cannot run. Case 3 pins
# the ordering that makes the fix safe: the deferred-lesson flush must happen
# BEFORE the file is removed, because a lesson lost to save 8 KB is a bad trade
# and that ordering is exactly what a careless later refactor would invert.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DG="$HERE/run-dg.sh"
pass=0; fail=0
ok()   { echo "  ok   - $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "instruction-file-cleanup:"

# ── 1. the trap actually contains the removal ────────────────────────────────
if grep -qE 'rm -f "\$\{INSTRUCTION_FILE:?-?\}"' "$DG"; then
  ok "EXIT trap removes INSTRUCTION_FILE"
else
  bad "EXIT trap does NOT remove INSTRUCTION_FILE (the leak is unfixed)"
fi

# ── 2. the removal is INSIDE the trap function, not stranded after harbor ────
# A cleanup placed after the harbor call never runs on a non-zero exit, which is
# the case that matters: harbor exits non-zero on errored and timed-out tasks.
trap_body="$(awk '/^_flush_deferred_on_exit\(\) \{/,/^\}/' "$DG")"
if printf '%s' "$trap_body" | grep -qE 'rm -f "\$\{INSTRUCTION_FILE'; then
  ok "removal sits inside _flush_deferred_on_exit (runs on failure paths too)"
else
  bad "removal is not inside the EXIT trap - it will be skipped when harbor fails"
fi

# ── 3. flush must precede removal ────────────────────────────────────────────
flush_ln="$(printf '%s\n' "$trap_body" | grep -nE '__flush|kill "\$\{PROXY_PID' | head -1 | cut -d: -f1)"
rm_ln="$(printf '%s\n' "$trap_body" | grep -nE 'rm -f "\$\{INSTRUCTION_FILE' | head -1 | cut -d: -f1)"
if [ -n "$flush_ln" ] && [ -n "$rm_ln" ] && [ "$flush_ln" -lt "$rm_ln" ]; then
  ok "deferred-lesson flush happens before the file is removed"
else
  bad "ordering wrong: flush=${flush_ln:-none} rm=${rm_ln:-none} (a lesson must never be lost to cleanup)"
fi

# ── 4. behavioural: run the extracted trap and confirm the file is gone ──────
tmpf="$(mktemp -t tb-instruction-TESTXXXXXX.md)"
echo "probe" > "$tmpf"
# PROXY_PID must be a REAL, HARMLESS pid — not 0 and not empty. The trap ends in
# `kill "${PROXY_PID:-0}"`, and `kill 0` signals the WHOLE PROCESS GROUP: the
# first version of this test killed its own runner and printed nothing after
# case 3. (run-dg.sh itself is safe — it assigns PROXY_PID at line 279 and arms
# the trap at 335, so the `:-0` default is unreachable there.) A background
# `sleep` gives the trap something it may legitimately kill.
sleep 30 & probe_pid=$!
(
  INSTRUCTION_FILE="$tmpf"; TB_DEFER_WRITES=0; PROXY_PID="$probe_pid"; PROXY_PORT=""
  eval "$trap_body"
  _flush_deferred_on_exit >/dev/null 2>&1 || true
)
kill "$probe_pid" 2>/dev/null || true; wait "$probe_pid" 2>/dev/null || true
if [ -f "$tmpf" ]; then
  bad "trap ran but $tmpf still exists"
  rm -f "$tmpf"
else
  ok "trap execution really deletes the rendered instruction file"
fi

echo "  ---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
