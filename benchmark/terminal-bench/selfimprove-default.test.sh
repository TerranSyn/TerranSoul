#!/usr/bin/env bash
# Within-task self-improvement is the DEFAULT — guard the two settings that
# make it real, in every sweep variant that can be launched.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE (required by
# rules/tests-must-be-able-to-fail.md):
#   * run-sweep.sh and run-sweep.next.sh both had
#     `export TB_DEFER_WRITES="${TB_DEFER_WRITES:-1}"` -> case 1 and case 2 red.
#   * neither file exported TB_ONE_JOB_PER_TASK at all, so the branch guard
#     `${TB_ONE_JOB_PER_TASK:-${TB_DEFER_WRITES:-0}}` resolved to 0 once
#     deferral flipped -> case 3 and case 4 red.
#   * case 5 is red on any tree where the two files disagree, which is the
#     trap that motivated it: launch-k2-attribution.sh does
#     `cp -f run-sweep.next.sh run-sweep.sh`, so editing only run-sweep.sh is
#     reverted on the next launch and the default silently regresses.
#
# Owner decision 2026-08-06: "It should both self-improve for every task in
# first iteration and pass these knowledge to other 2-5 iterations. It should
# be the default behaviour for TerranSoul for all self-learning."
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0; fail=0

ok()  { printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail+1)); }

# Read the default a variable falls back to, without executing the script (the
# scripts launch docker and harbor; sourcing them is not an option here).
_default_of() {  # $1=file  $2=varname
  grep -oE "^export $2=\"\\\$\{$2:-[^}]*\}\"" "$1" 2>/dev/null \
    | sed -E "s/.*:-([^}]*)\}.*/\1/" | tail -1
}

for f in run-sweep.sh run-sweep.next.sh; do
  p="$HERE/$f"
  if [ ! -f "$p" ]; then no "$f exists"; continue; fi

  d="$(_default_of "$p" TB_DEFER_WRITES)"
  [ "$d" = "0" ] \
    && ok "$f defaults TB_DEFER_WRITES=0 (attempt 1 teaches attempts 2-5)" \
    || no "$f defaults TB_DEFER_WRITES='$d', want 0 — within-task learning is off"

  j="$(_default_of "$p" TB_ONE_JOB_PER_TASK)"
  [ "$j" = "1" ] \
    && ok "$f defaults TB_ONE_JOB_PER_TASK=1 (attempt 1 completes before 2 starts)" \
    || no "$f defaults TB_ONE_JOB_PER_TASK='$j', want 1 — attempts would overlap in one batched job, so attempt 1's lesson does not exist yet when attempt 2 starts"
done

# The clobber trap: run-sweep.sh is a COPY of run-sweep.next.sh at launch time.
a="$(_default_of "$HERE/run-sweep.sh" TB_DEFER_WRITES)"
b="$(_default_of "$HERE/run-sweep.next.sh" TB_DEFER_WRITES)"
[ -n "$a" ] && [ "$a" = "$b" ] \
  && ok "run-sweep.sh and run-sweep.next.sh agree on the deferral default" \
  || no "deferral default differs ('$a' vs '$b') — launch-k2-attribution.sh copies .next.sh OVER run-sweep.sh, so this reverts on next launch"

printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
