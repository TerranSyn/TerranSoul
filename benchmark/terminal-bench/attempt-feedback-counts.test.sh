#!/usr/bin/env bash
# A failing attempt must tell the next one HOW MANY grader checks passed.
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: `attempt_feedback_text` read only
# reward.txt/result.json and rendered every failure as the bare string
# "FAILED (scored 0)". Assertions 1 and 2 look for the check counts and the
# narrow-defect note, neither of which that version can emit — it never opened
# verifier/ctrf.json at all.
#
# THE FAILURE IT PINS, measured across the 2026-08-08/09 cohort:
#   * pytorch-model-cli failed the SAME single check (test_cli_tool_output) on
#     all SIX attempts while passing the other five every time.
#   * 11 of 20 failing trials passed SOME grader checks, invisibly.
# Every attempt therefore re-derived deliverables that were already correct,
# because "scored 0" cannot distinguish "nothing works" from "one thing is off".
#
# NAMES IN THE SCORE LINE — owner decision 2026-08-09, REVERSING the
# counts-only rule of 2026-08-08. Withholding which check passed made two
# half-solutions indistinguishable: one approach passed the fidelity check 3/3
# and never the security one, another the reverse, and every attempt saw only
# "1 of 2" and switched architecture wholesale. The task prompt already states
# both requirements, so naming which one passed decomposes a score the agent
# already receives — it reveals no threshold, expected output or solution.
#
# The surviving rule, guarded below: a DERIVED SIGNAL may never invent a name
# of its own, and the answer-key boundary stays in the escalation clause.
#
# Hermetic: fabricated job dirs. No harbor, no brain, no docker.
set -uo pipefail
HERE_T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE_T/run-sweep.par.sh"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
pass=0; fail=0
ok() { echo "  ok   $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1 :: $2"; fail=$((fail+1)); }

FN="$(awk '/^attempt_feedback_text\(\) \{/,/^\}/' "$SRC")"
[ -n "$FN" ] || { echo "  FAIL attempt_feedback_text not found in run-sweep.par.sh" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
JOBS="$WORK/jobs"

# One fabricated trial: $3 of $4 checks passed, overall reward $2.
mk() {
  local task="$1" reward="$2" passed="$3" total="$4" job="$5"
  local trial="${task}__T${RANDOM}$$"
  mkdir -p "$JOBS/$job/$trial/verifier"
  python - "$JOBS/$job/$trial/verifier/ctrf.json" "$passed" "$total" <<'PY'
import json, sys
p, t = int(sys.argv[2]), int(sys.argv[3])
tests = [{"name": "test_outputs.py::check_%d" % i,
          "status": "passed" if i < p else "failed"} for i in range(t)]
json.dump({"results": {"tests": tests}}, open(sys.argv[1], "w"))
PY
  python - "$JOBS/$job/result.json" "$trial" "$reward" <<'PY'
import json, sys
json.dump({"stats": {"evals": {"e": {
    "reward_stats": {"reward": {sys.argv[3]: [sys.argv[2]]}},
    "exception_stats": {}}}}}, open(sys.argv[1], "w"))
PY
}

run_fn() { HERE="$HERE_T" TB_JOBS_DIR="$JOBS" bash -c "HERE='$HERE_T'
$FN
TB_JOBS_DIR='$JOBS' attempt_feedback_text \"\$1\" \"\$2\"" _ "$1" "$2"; }

# ── the narrow-defect shape: 5 of 6 pass, twice ──────────────────────────
mk pytorch-model-cli 0.0 5 6 j001
sleep 1
mk pytorch-model-cli 0.0 5 6 j002
OUT="$(run_fn pytorch-model-cli 3)"

echo "$OUT" | grep -q "passed 5 of 6 checks" \
  && ok "reports the grader-check COUNT for a failed attempt" \
  || no "check count" "expected 'passed 5 of 6 checks' in: $OUT"

echo "$OUT" | grep -q "not measuring what the grader measures" \
  && ok "raises the narrow-defect note when most checks already pass" \
  || no "narrow-defect note" "absent from: $OUT"

# ── THE SCORE LINE NAMES WHICH CHECKS PASSED (owner reversal 2026-08-09) ─
#
# This assertion used to be the opposite: names must NEVER appear. It was
# reversed on measurement. Over one task's 28-attempt chain two different
# approaches each solved a DIFFERENT half — `BeautifulSoup + plain str(soup)`
# passed the fidelity check 3/3 and never the security one — but every attempt
# was told only "passed 1 of 2 checks", so it could not tell which half it held
# and discarded the working one on each architecture switch (14 switches in 27
# transitions, 75% repeat-mistake rate).
#
# What must still hold is tested below: a derived SIGNAL may not invent a name
# of its own, and the answer-key boundary stays.
echo "$OUT" | grep -q "passed 5 of 6 checks (passed: check_0" \
  && ok "score line names which checks passed and failed" \
  || no "decomposition" "score line did not name the checks: $OUT"

# ── the answer-key boundary, added after two integrity incidents ────────
echo "$OUT" | grep -qi "never retrieve this benchmark's own solution" \
  && ok "escalation carries the answer-key boundary" \
  || no "boundary" "escalation clause has no answer-key limit: $OUT"

# ── 0-of-N must NOT claim a narrow defect ───────────────────────────────
JOBS="$WORK/jobs2"
mk dna-insert 0.0 0 1 k001
sleep 1
mk dna-insert 0.0 0 1 k002
OUT2="$(run_fn dna-insert 3)"
echo "$OUT2" | grep -q "not measuring what the grader measures" \
  && no "false signal" "0-of-1 must not claim a narrow defect: $OUT2" \
  || ok "0-of-N raises no narrow-defect claim"
echo "$OUT2" | grep -q "passed 0 of 1 checks" \
  && ok "still reports the count when nothing passed" \
  || no "count at zero" "expected 'passed 0 of 1 checks' in: $OUT2"

# ── no ctrf.json at all -> graceful fallback, never a crash or a lie ────
JOBS="$WORK/jobs3"
mkdir -p "$JOBS/m001/build-x__T1/verifier"
python - "$JOBS/m001/result.json" <<'PY'
import json, sys
json.dump({"stats": {"evals": {"e": {
    "reward_stats": {"reward": {"0.0": ["build-x__T1"]}},
    "exception_stats": {}}}}}, open(sys.argv[1], "w"))
PY
OUT3="$(run_fn build-x 2)"
echo "$OUT3" | grep -q "FAILED (scored 0)" \
  && ok "falls back to the bare verdict when ctrf.json is absent" \
  || no "fallback" "expected 'FAILED (scored 0)' in: $OUT3"

# ── THE STUCK-DIMENSION SIGNAL: three identical scores in a row ──────────
JOBS="$WORK/jobs4"
mk stuck-task 0.0 5 6 s001
sleep 1
mk stuck-task 0.0 5 6 s002
sleep 1
mk stuck-task 0.0 5 6 s003
OUT4="$(run_fn stuck-task 4)"
echo "$OUT4" | grep -q "last three attempts scored EXACTLY the same"   && ok "flags three identical scores as a stuck dimension"   || no "stuck signal" "absent from: $OUT4"
echo "$OUT4" | sed 's/Earlier attempts were scored[^*]*//' | grep -q "check_[0-9]"   && no "purity" "stuck signal invented a test NAME outside the score line: $OUT4"   || ok "stuck signal adds no name of its own"

# ── and must NOT fire when the scores are MOVING ─────────────────────────
JOBS="$WORK/jobs5"
mk moving-task 0.0 3 6 v001
sleep 1
mk moving-task 0.0 4 6 v002
sleep 1
mk moving-task 0.0 5 6 v003
OUT5="$(run_fn moving-task 4)"
echo "$OUT5" | grep -q "last three attempts scored EXACTLY the same"   && no "false stuck" "fired while the score was improving 3->4->5: $OUT5"   || ok "does not cry stuck while the score is moving"

# ── THE REGRESSION SIGNAL: a count that went DOWN ───────────────────────
JOBS="$WORK/jobs6"
mk trade-task 0.0 1 2 w001
sleep 1
mk trade-task 0.0 0 2 w002
OUT6="$(run_fn trade-task 3)"
echo "$OUT6" | grep -q "gone BACKWARDS"   && ok "flags a score that went down"   || no "regression signal" "absent from: $OUT6"
echo "$OUT6" | sed 's/Earlier attempts were scored[^*]*//' | grep -q "check_[0-9]"   && no "purity" "regression signal invented a test NAME outside the score line: $OUT6"   || ok "regression signal adds no name of its own"

# ── and must NOT fire when the score only ever climbs ────────────────────
JOBS="$WORK/jobs7"
mk climb-task 0.0 1 3 x001
sleep 1
mk climb-task 0.0 2 3 x002
OUT7="$(run_fn climb-task 3)"
echo "$OUT7" | grep -q "gone BACKWARDS"   && no "false regression" "fired while the score climbed 1->2: $OUT7"   || ok "does not cry regression while the score climbs"

# ── ESCALATION DETECTION: a tool LISTED is not a tool CALLED ────────────
#
# WHY THESE FAIL ON THE PRE-CHANGE TREE: `searched_web` regex-matched the bare
# strings "WebSearch"/"WebFetch" anywhere in the trajectory. Three things match
# that are not a web call — the feedback prompt itself (it names both tools), a
# ToolSearch schema load (`"query": "select:WebSearch,WebFetch"`), and the
# tool_reference records that load returns. Fixture A contains only a schema
# load, so the old detector says "escalated" and assertion A fails on it.
#
# THE FAILURE IT PINS, measured 2026-08-09 over this cohort: 8 of 479 trials
# ever really called a web tool; the old detector claimed 34. On
# filter-js-from-html the true count across 23 attempts is ZERO, yet 10 of those
# attempts were told "earlier attempt(s) DID consult external sources and still
# failed" — the branch arguing escalation is already exhausted. The runner spent
# that task's entire history suppressing the behaviour it was built to provoke.
traj() {  # $1 = job, $2 = trial glob parent, $3 = "load" | "call"
  local job="$1" mode="$2" trial
  trial="$(basename "$(ls -d "$JOBS/$job"/*__* | head -1)")"
  mkdir -p "$JOBS/$job/$trial/agent"
  python - "$JOBS/$job/$trial/agent/trajectory.json" "$mode" <<'PY'
import json, sys
mode = sys.argv[2]
if mode == "load":
    # A ToolSearch schema load, copied in shape from a real trajectory. The
    # OBSERVATION is the part that matters: the load's own result carries
    # `tool_reference` records and a `matches` array that both spell the tool
    # names in full, which is what the pre-change regex mistook for a call.
    step = {
        "step_id": 1, "source": "agent", "message": "",
        "tool_calls": [{"tool_call_id": "t1", "function_name": "ToolSearch",
                        "arguments": {"query": "select:WebSearch,WebFetch",
                                      "max_results": 10}}],
        "observation": {"results": [{
            "source_call_id": "t1",
            "content": [{"type": "tool_reference", "tool_name": "WebSearch"},
                        {"type": "tool_reference", "tool_name": "WebFetch"}],
            "metadata": {"matches": ["WebSearch", "WebFetch"],
                         "query": "select:WebSearch,WebFetch"}}]},
    }
else:
    step = {
        "step_id": 1, "source": "agent", "message": "",
        "tool_calls": [{"tool_call_id": "t1", "function_name": "WebSearch",
                        "arguments": {"query": "how does this class of thing usually work"}}],
        "observation": {"results": [{"source_call_id": "t1", "content": "…results…"}]},
    }
json.dump({"schema_version": "1", "steps": [step]}, open(sys.argv[1], "w"), indent=2)
PY
}

# A. schema load only -> nobody has escalated
JOBS="$WORK/jobs8"
mk esc-task 0.0 0 2 y001; traj y001 load
sleep 1
mk esc-task 0.0 0 2 y002; traj y002 load
OUT8="$(run_fn esc-task 3)"
echo "$OUT8" | grep -q "No previous attempt has consulted external sources at all" \
  && ok "a ToolSearch schema load does NOT count as escalating" \
  || no "phantom escalation" "loading the tool schema was read as a web call: $OUT8"
echo "$OUT8" | grep -q "DID consult external sources" \
  && no "phantom escalation" "claimed predecessors escalated when none called a web tool: $OUT8" \
  || ok "does not claim escalation that never happened"

# B. a real call -> the other branch, so A is not passing by always-false
JOBS="$WORK/jobs9"
mk esc2-task 0.0 0 2 z001; traj z001 call
sleep 1
mk esc2-task 0.0 0 2 z002; traj z002 call
OUT9="$(run_fn esc2-task 3)"
echo "$OUT9" | grep -q "DID consult external sources" \
  && ok "a real WebSearch tool_call IS counted as escalating" \
  || no "missed escalation" "a genuine web call was not detected: $OUT9"

# ── C. a DISCARDED lookup outranks "nobody has looked" ──────────────────
#
# WHY THIS FAILS ON THE PRE-CHANGE TREE: the clause had two branches only
# (searched / did-not-search), so a trial whose escalation was quarantined was
# reported as a plain escalation — or, when it was the only one, as "nobody has
# looked at all", inviting the next attempt to repeat the move that just scored
# zero. MEASURED 2026-08-09: filter-js-from-html's first real escalation in 26
# attempts went at the benchmark itself and was quarantined.
JOBS="$WORK/jobs10"
mk taint-task 0.0 0 2 q001; traj q001 call
python - "$(ls -d "$JOBS/q001"/*__* | head -1)/agent/trajectory.json" <<'PY'
import json, sys
# A fetch of the benchmark's own repo, in the shape integrity-scan.py matches.
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["steps"][0]["observation"] = {"results": [{"source_call_id": "t1",
    "content": "https://github.com/laude-institute/terminal-bench/blob/main/tasks/x/solution.sh"}]}
json.dump(d, open(sys.argv[1], "w"), indent=2)
PY
sleep 1
mk taint-task 0.0 0 2 q002; traj q002 load
OUT10="$(run_fn taint-task 3)"
echo "$OUT10" | grep -q "DISCARDED for reaching this benchmark's own material" \
  && ok "reports that an earlier lookup was discarded as contaminated" \
  || no "taint signal" "absent from: $OUT10"
echo "$OUT10" | grep -q "No previous attempt has consulted external sources at all" \
  && no "taint signal" "told the agent nobody had looked, after a quarantined lookup: $OUT10" \
  || ok "does not invite a repeat of the quarantined lookup"

# ── THE JOINT-SATISFACTION SIGNAL ───────────────────────────────────────
#
# WHY THESE FAIL ON THE PRE-CHANGE TREE: nothing compared per-check results
# ACROSS attempts, so "every requirement has been met, just never together" was
# unsayable. MEASURED on filter-js-from-html over 28 attempts: byte-identity met
# by 3, filtering met by 1, both at once by 0 — and every attempt saw only its
# own total, reading a partial score as "still broken" rather than "trading".
mk_mask() {  # $1 task  $2 job  $3 mask e.g. "10" = check_0 passed, check_1 not
  local task="$1" job="$2" mask="$3"
  local trial="${task}__T${RANDOM}$$"
  mkdir -p "$JOBS/$job/$trial/verifier"
  python - "$JOBS/$job/$trial/verifier/ctrf.json" "$mask" <<'PY'
import json, sys
mask = sys.argv[2]
tests = [{"name": "test_outputs.py::check_%d" % i,
          "status": "passed" if ch == "1" else "failed"} for i, ch in enumerate(mask)]
json.dump({"results": {"tests": tests}}, open(sys.argv[1], "w"))
PY
  python - "$JOBS/$job/result.json" "$trial" <<'PY'
import json, sys
json.dump({"stats": {"evals": {"e": {
    "reward_stats": {"reward": {"0.0": [sys.argv[2]]}},
    "exception_stats": {}}}}}, open(sys.argv[1], "w"))
PY
}

# D. complementary masks -> each met once, never together
JOBS="$WORK/jobs11"
mk_mask trade2-task r001 "10"
sleep 1
mk_mask trade2-task r002 "01"
OUT11="$(run_fn trade2-task 3)"
echo "$OUT11" | grep -q "satisfied them all at once" \
  && ok "reports every requirement met once but never together" \
  || no "joint signal" "absent from: $OUT11"
echo "$OUT11" | sed 's/Earlier attempts were scored[^*]*//' | grep -q "check_[0-9]" \
  && no "purity" "joint signal invented a test NAME outside the score line: $OUT11" \
  || ok "joint signal adds no name of its own"

# E. one requirement NEVER met -> must stay silent, or it is simply false
JOBS="$WORK/jobs12"
mk_mask never-task s001 "10"
sleep 1
mk_mask never-task s002 "10"
OUT12="$(run_fn never-task 3)"
echo "$OUT12" | grep -q "satisfied them all at once" \
  && no "false joint claim" "claimed every requirement had been met when one never was: $OUT12" \
  || ok "stays silent when a requirement has never been met"

echo ""
echo "  attempt-feedback-counts: $pass passed, $fail failed"
[ "$fail" = "0" ]
