#!/usr/bin/env bash
# redo-candidates.sh classifies why each task is unsolved so an operator knows
# what to re-run. It treated "this task has no trial in the corpus" as "this
# task ran and scored zero".
#
# The mechanism: `best.get(task, 0.0)` defaults a missing task to 0.0, and the
# task roster is a UNION that includes names harvested from the sweep LOG, which
# spans earlier campaigns. Any task the analysed corpus has not reached yet
# therefore arrived with score 0.0 and no recorded exception, and fell into the
# CAPABILITY bucket — "scored 0, no error recorded".
#
# Measured against jobs-submit/ on 2026-08-07: 51 never-attempted tasks were
# reported as capability failures and the footer announced "52 unsolved task(s)".
# The corpus actually held 35 tasks at 5/5 clean, ONE real capability failure,
# and 52 tasks with no trials at all. An operator reading that would go hunting
# for a reasoning regression across 51 tasks that had simply never run — the
# same class of error as reporting a crashed trial's reward as a score.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md). The fixture gives
# `ranfail` one real 0.0 trial and mentions `neverran` ONLY in the sweep log,
# with no trial anywhere. On the pre-change tree both land in CAPABILITY and the
# footer says "2 unsolved", so cases 2, 3 and 4 all go red. Case 1 (the genuine
# failure is still reported) guards against a "fix" that just drops zero-score
# tasks entirely. Verified red against `git show HEAD:...redo-candidates.sh`.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${TB_REDO_SCRIPT:-$HERE/redo-candidates.sh}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "redo-candidates-notrun:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
JOBS="$TMP/jobs"; mkdir -p "$JOBS/j1"
TASKS="$TMP/ds/tasks"; mkdir -p "$TASKS/ranfail" "$TASKS/neverran"
printf 'timeout_sec = 900\n' > "$TASKS/ranfail/task.toml"
printf 'timeout_sec = 900\n' > "$TASKS/neverran/task.toml"

# ranfail: one real trial, scored 0.0, no exception -> a TRUE capability failure.
cat > "$JOBS/j1/result.json" <<'JSON'
{"started_at":"2026-08-07T10:00:00","stats":{"evals":{"e":{
  "exception_stats":{},
  "reward_stats":{"reward":{"0.0":["ranfail__x1"]}}}}}}
JSON
mkdir -p "$JOBS/j1/ranfail__x1"

# The sweep log mentions BOTH tasks. neverran has no trial anywhere — it is
# remaining work, not a failure.
LOG="$TMP/sweep.log"
cat > "$LOG" <<'LOG'
[sweep]   task ranfail (own job dg-1)
  {"tool":"brain_ingest_lesson"} {"name":"brain_ingest_lesson","verdict":"accepted"}
[sweep]   task neverran (own job dg-2)
  {"tool":"brain_ingest_lesson"} {"name":"brain_ingest_lesson","verdict":"accepted"}
LOG

OUT="$(TB21_DIR="$TMP/ds" bash "$SCRIPT" "$JOBS" "$LOG" 2>&1)"

# ── case 1: the genuine capability failure is still reported ───────────────
if grep -qE "CAPABILITY +ranfail" <<<"$OUT"; then
  ok "a task that really ran and scored 0 is still reported as CAPABILITY"
else
  bad "the real capability failure disappeared: $(grep -c . <<<"$OUT") line(s) of output"
fi

# ── case 2: a never-run task is NOT a capability failure ──────────────────
if grep -qE "CAPABILITY +neverran" <<<"$OUT"; then
  bad "a task with NO trial is reported as a CAPABILITY failure"
else
  ok "a task with no trial is not reported as a capability failure"
fi

# ── case 3: it is reported as remaining WORK, by name ─────────────────────
if grep -qi "NO trial in this corpus" <<<"$OUT" && grep -q "neverran" <<<"$OUT"; then
  ok "never-run tasks are reported separately, by name"
else
  bad "never-run tasks are invisible — the operator cannot tell work from failure"
fi

# ── case 4: the unsolved COUNT excludes them ──────────────────────────────
# One real failure, one never-run -> the footer must say 1, not 2.
if grep -qE "^ +1 unsolved task\(s\)" <<<"$OUT"; then
  ok "the unsolved count is 1 (the real failure), not 2"
else
  bad "unsolved count wrong: $(grep 'unsolved task' <<<"$OUT" | tr -d '\n')"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
