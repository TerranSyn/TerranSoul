#!/usr/bin/env bash
# TB_UPLOAD must fail CLOSED: no upload by default, and `--public` must need its
# own differently-spelled opt-in.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: `run-dg.sh` had no TB_UPLOAD handling at
# all, so the extraction below finds no `case` block and the test aborts before
# its first assertion. Once the block exists but is wrong, the assertions catch
# it: a naive `[ -n "$TB_UPLOAD" ] && args+=(--upload --public)` passes cases 1
# and 3 and fails cases 2 and 4.
#
# WHY IT EXTRACTS INSTEAD OF RE-IMPLEMENTING: a test that inlines its own copy of
# the case statement asserts a literal against a literal and can never fail —
# a shape this repo has shipped before (`rules/tests-must-be-able-to-fail.md`).
# So it reads the REAL block out of the REAL file and executes that text.
#
# WHY IT MATTERS: `--upload --public` is PERMANENT and INDEXED — the row, the
# accuracy, the reward-hack count and every trajectory are world-readable
# forever (submission plan R1). A default that uploads, or a truthy-check that
# treats any value as "public", publishes a half-built run by accident.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/run-dg.sh"
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

BLOCK="$(awk '/^case "\$\{TB_UPLOAD:-0\}" in/,/^esac$/' "$SRC")"
if [ -z "$BLOCK" ]; then
  echo "  FAIL no TB_UPLOAD case block found in run-dg.sh — nothing to test" >&2
  exit 1
fi

# Execute the real block in isolation and print the resulting args.
#
# `tail -n1` is load-bearing: the real block also echoes an operator-facing
# notice ("uploading PUBLIC — permanent and indexed") on stdout, and that notice
# is behaviour worth keeping, not noise to suppress. The args are the LAST line
# because `printf` is the last statement. Comparing against the whole stream
# instead made this test fail against correct code on its first run.
run_case() {
  local out rc
  out="$(env TB_UPLOAD="$1" bash -c '
    set -uo pipefail
    args=()
    '"$BLOCK"'
    printf "%s\n" "${args[*]:-}"
  ' 2>/dev/null)"
  rc=$?
  printf '%s' "$(printf '%s' "$out" | tail -n1)"
  return $rc
}

out="$(run_case "")";       [ -z "$out" ] && ok "unset_does_not_upload"        || no "unset_does_not_upload" "got: $out"
out="$(run_case "0")";      [ -z "$out" ] && ok "zero_does_not_upload"         || no "zero_does_not_upload" "got: $out"

out="$(run_case "1")"
[ "$out" = "--upload --private" ] && ok "one_uploads_PRIVATE" || no "one_uploads_PRIVATE" "got: $out"
printf '%s' "$out" | grep -q -- "--public" \
  && no "one_must_not_be_public" "TB_UPLOAD=1 produced --public: $out" \
  || ok "one_must_not_be_public"

out="$(run_case "public")"
[ "$out" = "--upload --public" ] && ok "public_uploads_PUBLIC" || no "public_uploads_PUBLIC" "got: $out"

# An unrecognised value must REFUSE, not silently pick a default. "true", "yes"
# and "PUBLIC" are the plausible typos, and each one guessing wrong in the
# permissive direction is an irreversible publish.
for bad in true yes PUBLIC 2 public-ish; do
  run_case "$bad" >/dev/null 2>&1
  rc=$?
  [ "$rc" -ne 0 ] && ok "refuses_unknown_value_${bad}" \
                  || no "refuses_unknown_value_${bad}" "exited 0 instead of refusing"
done

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
