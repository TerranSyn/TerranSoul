#!/usr/bin/env bash
# run-parallel.sh's shard guard compared the worker's reported "N to run"
# against `wc -l` of its SHARD file. The seeding loop deliberately drops shard
# tasks the worker already finished, so on a resume the real TODO is SMALLER
# than the shard — and the guard killed every healthy worker with exit 4.
#
# Measured 2026-08-06: worker 0 owned 31 shard tasks, had already completed
# `financial-document-processor`, correctly reported "30 to run", and the guard
# reported "SHARD IGNORED" and stopped the whole campaign.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md): it drives the
# REAL run-parallel.sh in DRY mode over a synthetic task tree in which one
# worker has a prior completion, then asserts the `.expected` file holds the
# post-skip count. On the pre-change tree no `.expected` file is written at all,
# so case 2 and case 3 go red. Case 4 pins the guard to read `.expected` rather
# than the shard — revert that single line and it fails while the others pass.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
RP="$HERE/run-parallel.sh"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "shard-resume-guard:"

# ── build a synthetic 6-task tree ────────────────────────────────────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/tasks"
for t in alpha bravo charlie delta echo foxtrot; do mkdir -p "$TMP/tasks/$t"; done

# Isolate every ledger this test touches, so a real campaign's state is never
# read or written by the test run.
SBOX="$TMP/mcp-data"; mkdir -p "$SBOX/logs"
: > "$SBOX/.tb-sweep-state.txt"          # nothing globally done -> TODO = all 6

# 2 workers over 6 tasks => worker0 {alpha,charlie,echo}, worker1 {bravo,delta,foxtrot}
# Seed worker0 with a PRIOR completion of one of its OWN shard tasks.
printf 'alpha\n' > "$SBOX/.tb-par0-state.txt"

# ── run the real script in DRY mode against the sandbox ──────────────────────
out="$(cd "$TMP" && DRY=1 TB21_DIR="$TMP" HOME="$TMP" \
        bash -c "REPO_OVERRIDE=1; $(declare -f); export TB21_DIR HOME; \
                 sed 's#^REPO=.*#REPO=\"$SBOX/..\"#' '$RP' > '$TMP/rp.sh'; \
                 bash '$TMP/rp.sh' 2" 2>&1 || true)"

if printf '%s' "$out" | grep -q 'remaining     : 6'; then
  ok "sandbox drove the real script (6 remaining)"
else
  bad "sandbox did not drive the script as expected; output was: $(printf '%s' "$out" | head -3)"
fi

exp0="$SBOX/.tb-par0-state.txt.expected"
exp1="$SBOX/.tb-par1-state.txt.expected"

# ── 2. the .expected file must exist at all (absent pre-change) ──────────────
if [ -f "$exp0" ] && [ -f "$exp1" ]; then
  ok ".expected written for every worker"
else
  bad ".expected NOT written - guard will fall back to shard size and kill resumes"
fi

# ── 3. worker0 must expect 2, NOT its shard size of 3 ───────────────────────
got0="$(cat "$exp0" 2>/dev/null || echo MISSING)"
shard0="$(wc -l < "$SBOX/.tb-par0-state.txt.shard" 2>/dev/null || echo 0)"
if [ "$got0" = "2" ] && [ "$shard0" = "3" ]; then
  ok "worker0 expects 2 with a 3-task shard (prior completion skipped)"
else
  bad "worker0 expected='$got0' shard='$shard0' - want expected=2 shard=3"
fi

# ── 4. worker1 has no prior completion, so expected == shard ────────────────
got1="$(cat "$exp1" 2>/dev/null || echo MISSING)"
if [ "$got1" = "3" ]; then
  ok "worker1 (no prior work) expects its full 3-task shard"
else
  bad "worker1 expected='$got1' - want 3"
fi

# ── 5. the guard must READ .expected, not the shard file ────────────────────
if grep -qE 'want=\$\(cat "\$REPO/mcp-data/\.tb-par\$\{w\}-state\.txt\.expected"' "$RP"; then
  ok "guard reads .expected (not wc -l on the shard)"
else
  bad "guard still derives 'want' from the shard file - resumes will be killed"
fi

echo "  ---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
