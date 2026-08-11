#!/usr/bin/env bash
# A trial that reached the BENCHMARK'S OWN oracle must be detected and must score 0.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: `integrity-scan.py` did not exist, so
# assertions 1-4 abort at the first invocation; and merge-sweep.sh had no
# QUARANTINE_FILE, so assertion 5 measures 1.0000 where it now measures 0.0000.
# Assertion 5 is the behavioural guard — it fails by VALUE, not by absence.
#
# THE INCIDENT IT PINS, measured 2026-08-08: `build-pov-ray` had failed twice, so
# the extra-instruction's "after two scored failures, consult external sources"
# clause fired. The agent searched `github.com laude-institute terminal-bench-2
# build-pov-ray tests test.sh`, pulled the oracle solve.sh, the grading
# test_outputs.py and reference_illum1.png, reproduced the grader's SSIM check
# locally, scored 1.0 — and wrote a GENERALISED directive into the shared bench
# brain telling every later task to look up the public repo first. One trial in
# the cohort, but a self-propagating one.
#
# WHAT IT DOES NOT CLAIM: the published per-task number did not move. build-pov-ray
# also passed twice WITHOUT oracle access, so quarantining the tainted trial left
# the task solved. The control exists so that the next such trial cannot pay off,
# not because this one changed a score.
#
# Hermetic: fabricated trajectories and job dirs. No harbor, no brain, no docker.
set -uo pipefail
HERE_T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN="$HERE_T/integrity-scan.py"
MERGE="$HERE_T/merge-sweep.sh"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

[ -f "$SCAN" ] || { echo "  FAIL integrity-scan.py missing — nothing to test" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
JOBS="$WORK/jobs"; mkdir -p "$JOBS"

# One fabricated trial. $4 is pasted verbatim into the trajectory text.
mk_trial() {
  local job="$1" task="$2" reward="$3" text="$4"
  local trial="${task}__T${RANDOM}"
  mkdir -p "$JOBS/$job/$trial/agent" "$JOBS/$job/$trial/verifier"
  printf '%s' "$reward" > "$JOBS/$job/$trial/verifier/reward.txt"
  python - "$JOBS/$job/$trial/agent/trajectory.json" "$text" <<'PY'
import json, sys
json.dump({"schema_version": "ATIF-v1.7", "steps": [
    {"step_id": 1, "source": "agent", "message": sys.argv[2]}]},
    open(sys.argv[1], "w", encoding="utf-8"))
PY
  python - "$JOBS/$job/result.json" "$trial" "$reward" <<'PY'
import json, sys
json.dump({"stats": {"n_errored_trials": 0, "cost_usd": 1.0, "evals": {"e": {
    "reward_stats": {"reward": {sys.argv[3]: [sys.argv[2]]}}, "exception_stats": {}}}}},
    open(sys.argv[1], "w", encoding="utf-8"))
PY
  echo "$trial"
}

# ── the tainted shape: the benchmark's own repo ──────────────────────────
TAINTED="$(mk_trial qq-0001 build-pov-ray 1.0 \
  'Pulled https://raw.githubusercontent.com/laude-institute/terminal-bench-2/main/tasks/build-pov-ray/solve.sh and matched the grader.')"
# ── the honest shape: a real upstream dependency the task legitimately needs ──
CLEAN="$(mk_trial qq-0002 compile-compcert 1.0 \
  'Cloned https://github.com/AbsInt/CompCert/archive/refs/tags/v3.13.1.tar.gz and built it from source.')"
# ── the honest-but-wordy shape: says "oracle" without fetching anything ──
SOFT="$(mk_trial qq-0003 filter-js-from-html 0.0 \
  'Built a Chromium --dump-dom oracle script of my own to check the filter.')"

OUT="$WORK/scan.txt"
python "$SCAN" "$JOBS" --write "$WORK/q.txt" > "$OUT" 2>&1
rc=$?

# 1. it must exit non-zero on contamination, or no gate can ever consume it
[ "$rc" = "1" ] && ok "exits 1 when a trial reached the benchmark's own material" \
                || no "exit code" "expected 1, got $rc"

# 2. the tainted trial is named
grep -q "$TAINTED" "$WORK/q.txt" \
  && ok "quarantines the trial that fetched the oracle" \
  || no "quarantine list" "$TAINTED absent from $(cat "$WORK/q.txt" 2>/dev/null | tr '\n' ' ')"

# 3. THE FALSE-POSITIVE GUARD. A scanner that fires on every github URL would
#    quarantine most of the suite — CompCert, caffe and MobileSAM are all
#    legitimately cloned from github by their own tasks.
grep -q "$CLEAN" "$WORK/q.txt" \
  && no "false positive" "an upstream github dependency was quarantined" \
  || ok "leaves a legitimate upstream github dependency alone"

# 4. the soft signal is reported but must NOT quarantine
grep -q "$SOFT" "$WORK/q.txt" \
  && no "soft signal" "a trial that only said 'oracle' was quarantined" \
  || ok "does not quarantine a trial that merely mentions an oracle"

# 5. BEHAVIOURAL GUARD: the tainted trial's pass must not reach the score.
#    Here it is the task's ONLY trial, so the official per-task number moves
#    1.0000 -> 0.0000. On the pre-change tree merge-sweep prints 1.0000.
M1="$WORK/m1.txt"
TB_QUARANTINE_FILE="$WORK/q.txt" TB_TASKS_EXPECTED=2 \
  bash "$MERGE" "$JOBS" qq-0001 > "$M1" 2>&1
got="$(grep -o 'OFFICIAL per-task  : [0-9.]*' "$M1" | awk '{print $NF}')"
[ "$got" = "0.0000" ] \
  && ok "a quarantined pass scores 0.0 in the official number" \
  || no "official number" "expected 0.0000 with the trial quarantined, got '${got:-<none>}'"

# 6. and the same job WITHOUT the quarantine file still scores 1.0 — otherwise
#    assertion 5 could be passing for an unrelated reason.
M2="$WORK/m2.txt"
TB_QUARANTINE_FILE="$WORK/none.txt" TB_TASKS_EXPECTED=2 \
  bash "$MERGE" "$JOBS" qq-0001 > "$M2" 2>&1
got2="$(grep -o 'OFFICIAL per-task  : [0-9.]*' "$M2" | awk '{print $NF}')"
[ "$got2" = "1.0000" ] \
  && ok "without the quarantine list the same trial still scores 1.0 (control)" \
  || no "control" "expected 1.0000 unquarantined, got '${got2:-<none>}'"

echo ""
echo "  integrity-scan: $pass passed, $fail failed"
[ "$fail" = "0" ]
