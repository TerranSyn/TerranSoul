#!/usr/bin/env bash
# The model is the PROVENANCE of a benchmark number: a leaderboard row naming a
# model asserts that model produced the result. run-dg.sh hardcoded
# `-m claude-opus-5`, which had two consequences.
#
#  1. Switching models required editing run-dg.sh — impossible while a sweep is
#     running (bash reads scripts lazily) and invisible in the run's own record.
#  2. Nothing carried the model into `.tb-parN.launch`, so adaptive-workers.sh
#     replaying a worker would run it under whatever the script defaulted to.
#     A campaign could change models halfway and say nothing.
#
# The failure mode both enable is the same one that disqualified the previous
# corpus: a jobs directory whose trials do not all come from the thing the
# number is attributed to. merge-sweep.sh takes the BEST trial per task, so a
# mixed directory yields a score attributable to neither model — and one that
# flatters whichever model happened to win each task.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md). Case 1 greps for
# the `-m "${TB_MODEL:-...}"` form, which does not exist pre-change (the literal
# `-m claude-opus-5` is there instead). Case 2 evaluates run-parallel.sh's env
# array with TB_MODEL exported and asserts it reaches `.launch`; pre-change the
# array carries no TB_MODEL at all. Case 3 pins the DEFAULT to claude-opus-5, so
# an existing corpus cannot become ambiguous about its own provenance — that one
# passes pre-change by construction and exists to stop the fix drifting the
# default. Verified against `git show HEAD:<script>`.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DG="${TB_DG_SCRIPT:-$HERE/run-dg.sh}"
PAR="${TB_PARALLEL_SCRIPT:-$HERE/run-parallel.sh}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "model-provenance:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── case 1: the model is a parameter, not a literal ───────────────────────
if grep -qE '^\s+-m "\$\{TB_MODEL:-' "$DG"; then
  ok "run-dg.sh takes the model from TB_MODEL"
else
  bad "run-dg.sh hardcodes the model — switching it needs a file edit a live sweep forbids"
fi

# ── case 2: TB_MODEL reaches the worker launch record ─────────────────────
awk '/^  worker_env=\(/,/^  \} > "\$launch_file"/' "$PAR" > "$TMP/block.sh"
if [ -s "$TMP/block.sh" ]; then
  (
    cd "$TMP" || exit 1
    w=0; STAMP="08072100"; wstate="$TMP/state.txt"
    REPO="$TMP/repo"; HERE="$TMP/here"
    mkdir -p "$REPO/mcp-data" "$HERE"
    export TB_MODEL=claude-sonnet-5
    # shellcheck disable=SC1091
    . "$TMP/block.sh"
  ) >/dev/null 2>&1
  LAUNCH="$TMP/repo/mcp-data/.tb-par0.launch"
  if [ -s "$LAUNCH" ] && grep -q 'TB_MODEL=claude-sonnet-5' "$LAUNCH"; then
    ok "TB_MODEL is recorded in .launch, so a replayed worker keeps the model"
  else
    bad "TB_MODEL absent from .launch — adaptive-workers.sh would replay under a different model"
  fi
else
  bad "could not extract the worker env block from run-parallel.sh"
fi

# ── case 3: the default is unchanged ──────────────────────────────────────
# Every trial in jobs-submit/ was produced by claude-opus-5. A drifting default
# would make that corpus ambiguous about its own provenance retroactively.
if grep -qE 'TB_MODEL:-claude-opus-5' "$DG"; then
  ok "the default is still claude-opus-5 — the existing corpus stays unambiguous"
else
  bad "the default model changed; jobs-submit/ can no longer be read as one model"
fi

# ── case 4: the never-mix-models rule is written down where it applies ────
# A rule that lives only in a commit message is a rule nobody reads at 2am.
if grep -qi "NEVER MIX MODELS IN ONE JOBS DIR" "$DG"; then
  ok "run-dg.sh states the one-model-per-jobs-dir rule"
else
  bad "nothing warns that merge-sweep.sh over a mixed dir yields a score attributable to neither model"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
