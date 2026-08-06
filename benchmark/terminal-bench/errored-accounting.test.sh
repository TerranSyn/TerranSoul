#!/usr/bin/env bash
# A task whose run-dg.sh exited NON-ZERO must still be classified and ledgered.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: neither `classify_errored_task` nor
# `last_job_is_for_task` existed, so the extraction below finds nothing and the
# test aborts before its first assertion. The whole errored-trial policy lived
# inline inside the `if run-dg.sh; then` branch and simply did not run when
# run-dg.sh failed.
#
# THE BUG IT PINS, measured 2026-08-05: `train-fasttext` burned its full 3600 s
# ceiling, returned AgentTimeoutError, and landed in NO ledger — not state, not
# retries, not accepted-failures. TB_RESUME=1 would have re-run it for another
# hour and ~$2 to fail identically, with its attempt counter still reading 0 so
# the retry bound could never engage.
#
# WHAT IT DOES NOT CLAIM: the published number was never wrong. merge-sweep.sh
# scores an errored trial 0.0 from result.json regardless of any ledger. These
# assertions are about cost and convergence, and the test says so rather than
# letting a future reader infer a correctness scare that did not happen.
#
# Hermetic: fabricated job dirs and temp ledgers. No harbor, no brain, no docker.
set -uo pipefail
HERE_T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE_T/run-sweep.next.sh"
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

# Pull the REAL function bodies out of the REAL script. Re-implementing them
# here would assert a literal against a literal and could never fail.
extract() { awk "/^$1\(\) \{/,/^\}/" "$SRC"; }
FNS=""
for f in last_job_is_for_task last_job_errored last_job_error_is_terminal classify_errored_task; do
  body="$(extract "$f")"
  if [ -z "$body" ]; then
    echo "  FAIL function '$f' not found in run-sweep.next.sh — nothing to test" >&2
    exit 1
  fi
  FNS="$FNS
$body"
done

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Build a fake job dir for $task whose result.json carries $exc.
#
# The shape here is copied from a REAL harbor result.json
# (sweep08051232-20260805-193220, train-fasttext, AgentTimeoutError), not
# invented. `n_errored_trials` and `evals[].n_errors` are load-bearing:
# last_job_errored counts THOSE, while last_job_error_is_terminal reads
# `exception_stats`. My first fixture set only exception_stats, so
# last_job_errored returned false and every assertion failed against correct
# code — a fixture bug that reads exactly like a broken implementation.
mkjob() {
  local job="$WORK/jobs/$1" task="$2" exc="$3"
  mkdir -p "$job/${task}__abc123"
  cat > "$job/result.json" <<JSON
{"stats":{"n_errored_trials":1,"evals":{"e":{
  "n_errors":1,"n_trials":1,
  "exception_stats":{"$exc":["${task}__abc123"]}}}}}
JSON
  sleep 0.05   # keep `ls -1dt` ordering unambiguous between successive jobs
}

# Run one scenario in a subshell with the real functions loaded.
scenario() {
  local task="$1" exc="$2" maxattempts="${3:-2}" preseed="${4:-}"
  : > "$WORK/state.txt"; : > "$WORK/retries.txt"; : > "$WORK/accepted.txt"
  [ -n "$preseed" ] && printf '%s\n' $preseed > "$WORK/retries.txt"
  HERE="$WORK" STATE="$WORK/state.txt" RETRIES="$WORK/retries.txt" \
  ACCEPTED="$WORK/accepted.txt" TERMINAL_ERRORS="AgentTimeoutError" \
  TB_MAX_ATTEMPTS_PER_TASK="$maxattempts" TASK="$task" bash -c '
    set -uo pipefail
    batch_ok=1
    '"$FNS"'
    if last_job_is_for_task "$TASK" && last_job_errored; then
      classify_errored_task "$TASK"
    fi
    echo "batch_ok=$batch_ok"
  ' 2>/dev/null
}

has() { grep -qx "$2" "$WORK/$1.txt" 2>/dev/null; }

# ── 1. terminal error -> accepted as 0.0, never retried ─────────────────────
mkjob job1 train-fasttext AgentTimeoutError
scenario train-fasttext AgentTimeoutError >/dev/null
has state   train-fasttext && ok "terminal_marks_complete"        || no "terminal_marks_complete" "not in state"
has accepted train-fasttext && ok "terminal_records_accepted"     || no "terminal_records_accepted" "not in accepted-failures"
has retries train-fasttext && ok "terminal_records_attempt"       || no "terminal_records_attempt" "not in retries"

# ── 2. non-terminal, first attempt -> retry, NOT marked complete ────────────
mkjob job2 flaky-task UnknownApiError
out="$(scenario flaky-task UnknownApiError)"
has state flaky-task && no "transient_must_not_complete" "marked complete on attempt 1" \
                     || ok "transient_must_not_complete"
has retries flaky-task && ok "transient_records_attempt" || no "transient_records_attempt" "attempt not counted"
printf '%s' "$out" | grep -q "batch_ok=0" && ok "transient_sets_batch_ok_0" \
                                          || no "transient_sets_batch_ok_0" "got: $out"

# ── 3. non-terminal, budget spent -> accepted, bound engages ────────────────
out="$(scenario flaky-task UnknownApiError 2 "flaky-task")"
has state    flaky-task && ok "budget_spent_completes"        || no "budget_spent_completes" "not in state"
has accepted flaky-task && ok "budget_spent_records_accepted" || no "budget_spent_records_accepted" "not in accepted"

# ── 4. THE GUARD: newest job belongs to a DIFFERENT task ────────────────────
# Preflight death creates no job dir, so "newest" is the previous task's job.
# Without last_job_is_for_task we would classify this task from that result.
mkjob job3 other-task AgentTimeoutError
scenario preflight-died AgentTimeoutError >/dev/null
has state    preflight-died && no "guard_blocks_foreign_job" "classified from another task's result.json" \
                            || ok "guard_blocks_foreign_job"
has accepted preflight-died && no "guard_no_false_accept" "scored an infra failure as 0.0" \
                            || ok "guard_no_false_accept"

echo "  ---- $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
