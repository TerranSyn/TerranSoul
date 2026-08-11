#!/usr/bin/env bash
# attempt-uplift.sh is the ATTRIBUTION metric for the whole campaign: does a
# lesson written by attempt 1 help attempts 2..k of the same task? It counted an
# ERRORED trial as a treatment failure.
#
# That is only sound if harness errors fall evenly across attempts. They do not,
# and the reason is structural rather than bad luck: a task's five attempts run
# sequentially inside ONE harbor job, so request volume — and therefore
# rate-limiting — accumulates with the attempt index. Measured on the real
# 2026-08-07 corpus (223 trials, 20 errored): 2 errors in attempt 1 against 18
# in attempts 2-5, rising monotonically a2=3, a3=4, a4=5, a5=5.
#
# Charging those to the treatment arm biases the uplift downward by construction.
# On the real corpus it moved the headline from -6.2 pp to -9.6 pp, and it listed
# four tasks as "attempt 1 solved, later failed" whose later attempts had merely
# been rate-limited — i.e. it reported memory losing ground where the only thing
# that happened was the API refusing a request.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md). The fixture below
# puts EVERY error in attempts 2+, so on the pre-change tree:
#   * case 2 fails — there is one uplift figure, not a primary and a bound;
#   * case 3 fails — the single figure equals the pessimistic bound (-28.6 pp)
#     rather than the errored-excluded truth (0.0 pp);
#   * case 4/5 fail — no headroom stratification is printed at all;
#   * case 6 fails — `easytask` IS listed as "attempt 1 solved, later failed",
#     which is exactly the false regression report the fix exists to remove.
# Verified red by running this against `git show HEAD:...attempt-uplift.sh`.
#
# The fixture is synthetic and self-contained: no live job data is read and no
# sweep state is touched.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPLIFT="${TB_UPLIFT_SCRIPT:-$HERE/attempt-uplift.sh}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "uplift-errored-trials:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
JOBS="$TMP/jobs"; mkdir -p "$JOBS"

# ── fixture ────────────────────────────────────────────────────────────────
# easytask : attempt 1 PASSES. Attempts 2,3 pass clean; attempts 4,5 are
#            RATE-LIMITED (errored, reward 0.0). The only "regression" is a
#            harness error, so nothing about memory can be concluded from it.
# hardtask : attempt 1 FAILS clean. Attempts 2,3 pass. This is the only stratum
#            where memory has headroom, and here it recovers.
mk_trial() { # $1 job dir, $2 trial id, $3 timestamp (YYYYMMDDhhmm.ss)
  mkdir -p "$1/$2/agent"
  echo "log" > "$1/$2/agent/claude-code.txt"
  touch -t "$3" "$1/$2/agent/claude-code.txt" "$1/$2"
}

J1="$JOBS/fx-easy"; mkdir -p "$J1"
cat > "$J1/result.json" <<'JSON'
{"started_at":"2026-08-07T10:00:00","stats":{"evals":{"e":{
  "exception_stats":{"ApiRateLimitError":["easytask__a4","easytask__a5"]},
  "reward_stats":{"reward":{
    "1.0":["easytask__a1","easytask__a2","easytask__a3"],
    "0.0":["easytask__a4","easytask__a5"]}}}}}}
JSON
mk_trial "$J1" easytask__a1 202608071001.00
mk_trial "$J1" easytask__a2 202608071002.00
mk_trial "$J1" easytask__a3 202608071003.00
mk_trial "$J1" easytask__a4 202608071004.00
mk_trial "$J1" easytask__a5 202608071005.00

J2="$JOBS/fx-hard"; mkdir -p "$J2"
cat > "$J2/result.json" <<'JSON'
{"started_at":"2026-08-07T11:00:00","stats":{"evals":{"e":{
  "exception_stats":{},
  "reward_stats":{"reward":{
    "0.0":["hardtask__b1"],
    "1.0":["hardtask__b2","hardtask__b3"]}}}}}}
JSON
mk_trial "$J2" hardtask__b1 202608071101.00
mk_trial "$J2" hardtask__b2 202608071102.00
mk_trial "$J2" hardtask__b3 202608071103.00

OUT="$(bash "$UPLIFT" "$JOBS" fx 2>&1)"

# ── case 1: the fixture was read at all ────────────────────────────────────
if grep -qE "jobs analysed +: 2 job\(s\) over 2 distinct task\(s\)" <<<"$OUT"; then
  ok "fixture parsed: 2 jobs over 2 tasks"
else
  bad "fixture not parsed — report was: $(head -3 <<<"$OUT" | tr '\n' '|')"
fi

# ── case 2: errored trials are surfaced, not silently absorbed ─────────────
if grep -q "ERRORED" <<<"$OUT" && grep -qE "errored by attempt.*a4=1.*a5=1" <<<"$OUT"; then
  ok "errored trials are counted and located by attempt index"
else
  bad "errored trials not reported by attempt index — the downward bias stays invisible"
fi

# ── case 3: the PRIMARY figure excludes them; the BOUND keeps them ─────────
# Attempt 1 across the two tasks: easytask PASSES, hardtask FAILS -> 1/2 = 50%.
# Attempts 2+ with errors EXCLUDED: easytask a2,a3 + hardtask b2,b3 = 4/4 = 100%
#   -> primary uplift +50.0 pp.
# Attempts 2+ with errors as FAILURES: 4/6 = 66.7% -> bound +16.7 pp.
# The 33.3 pp gap between the two IS the harness-error bias, on a fixture where
# every error is a rate limit in a late attempt.
if grep -qE "PRIMARY" <<<"$OUT" && grep -qE "UPLIFT +: \+50\.0 pp" <<<"$OUT"; then
  ok "primary uplift excludes errored trials (+50.0 pp on this fixture)"
else
  bad "primary uplift is not the errored-excluded figure: $(grep -iE 'uplift' <<<"$OUT" | tr '\n' '|')"
fi
if grep -qiE "PESSIMISTIC BOUND" <<<"$OUT" && grep -qE "bound\) *: \+16\.7 pp" <<<"$OUT"; then
  ok "the errored-as-failures figure is retained as an explicit bound (+16.7 pp)"
else
  bad "no pessimistic bound reported — the two readings cannot be compared"
fi

# ── case 4/5: headroom stratification ──────────────────────────────────────
# A = attempt 1 passed (easytask): 2 clean later attempts, both pass.
# B = attempt 1 failed (hardtask): 2 later attempts, both pass.
if grep -qE "A\. attempt 1 PASSED -> later attempts 2/2" <<<"$OUT"; then
  ok "stratum A (no headroom) reported separately"
else
  bad "stratum A missing — a saturated sample's pooled uplift is uninterpretable"
fi
if grep -qE "B\. attempt 1 FAILED -> later attempts 2/2" <<<"$OUT"; then
  ok "stratum B (the population with headroom) reported separately"
else
  bad "stratum B missing — the only place uplift can appear is not measured"
fi

# ── case 6: a rate-limited later attempt is NOT a memory regression ────────
if grep -qE "attempt 1 solved, later failed : 0" <<<"$OUT"; then
  ok "an ERRORED later attempt is not reported as a regression"
else
  bad "errored later attempt reported as a regression: $(grep 'later failed' <<<"$OUT")"
fi

# ── case 7: the arithmetic ceiling is stated ──────────────────────────────
if grep -qi "ceiling" <<<"$OUT"; then
  ok "the arithmetic ceiling on pooled uplift is stated"
else
  bad "no ceiling stated — a near-zero pooled uplift reads as a finding when it is forced"
fi

# ── case 8: THE ATTEMPT UNIT IS THE JOB, NOT THE TASK ─────────────────────
#
# `run-sweep.par.sh` runs one harbor job per task carrying all k attempts back
# to back, so "no lesson for this task exists yet" is a property of a JOB. A
# re-run task gets a SECOND job with its own fresh attempt 1. Keying by task
# pools them and files that fresh attempt 1 into the "attempts 2+" bucket —
# and on the real corpus the re-run tasks were the two pathological ones, so
# the treatment arm absorbed the hardest task's every restart.
#
# Fixture: `easytask` is re-run in a third job whose OWN attempt 1 fails clean.
#   per-JOB  : attempt1 = {a1 pass, b1 fail, c1 fail} = 1/3 = 33.3%
#              attempts2+ = {a2,a3,b2,b3,c2,c3} = 6/6 = 100%   -> +66.7 pp
#   per-TASK : attempt1 = {a1 pass, b1 fail} = 1/2 = 50.0%
#              attempts2+ = {a2,a3,c1 FAIL,c2,c3,b2,b3} = 6/7  -> +35.7 pp
# Pre-change the script reports the per-TASK figure, so this case goes red.
RERUN="$TMP/jobs2"; mkdir -p "$RERUN"
# -p is load-bearing: attempt ORDER comes from file mtimes, and a plain `cp -r`
# stamps every copied trial with "now", collapsing the order the fixture sets up.
cp -rp "$J1" "$J2" "$RERUN"/
J3="$RERUN/fx-rerun"; mkdir -p "$J3"
cat > "$J3/result.json" <<'JSON'
{"started_at":"2026-08-07T12:00:00","stats":{"evals":{"e":{
  "exception_stats":{},
  "reward_stats":{"reward":{
    "0.0":["easytask__c1"],
    "1.0":["easytask__c2","easytask__c3"]}}}}}}
JSON
mk_trial "$J3" easytask__c1 202608071201.00
mk_trial "$J3" easytask__c2 202608071202.00
mk_trial "$J3" easytask__c3 202608071203.00

OUT2="$(bash "$UPLIFT" "$RERUN" fx 2>&1)"
if grep -qE "UPLIFT +: \+66\.7 pp" <<<"$OUT2"; then
  ok "attempts are indexed per JOB — a re-run's own attempt 1 stays a control"
else
  bad "a re-run's fresh attempt 1 was counted as a treated attempt: $(grep -E 'UPLIFT|control|treat' <<<"$OUT2" | tr '\n' '|')"
fi
if grep -qE "jobs analysed +: 3 job\(s\) over 2 distinct task\(s\)" <<<"$OUT2"; then
  ok "the report names jobs and distinct tasks separately"
else
  bad "jobs vs tasks not distinguished: $(head -1 <<<"$OUT2")"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
