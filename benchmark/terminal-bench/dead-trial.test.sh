#!/usr/bin/env bash
# Guards the corpse detector — the thing that stops a batch driver spending its
# whole budget on trials that never ran.
#
# WHAT IT IS GUARDING. 2026-08-09: the OAuth credential was revoked mid-session,
# the next TWENTY trials produced `total_completion_tokens: 0` and a 401
# trajectory, harbor wrote them as ordinary trials with reward 0.0, and roughly
# ninety minutes of conclusions were drawn over them. `02fc1db9` added the
# detector to `iterate-until-change.sh` and shipped it with NO TEST — one file,
# +41/-1 — which is precisely the shape `rules/tests-must-be-able-to-fail.md`
# exists to stop, on a guard whose entire job is preventing a repeat.
#
# WHY THESE TESTS CAN FAIL (rules/tests-must-be-able-to-fail.md). Two cases are
# red on the pre-change tree, and they fail on LOGIC, not on a missing import:
#
#   case 5  a trajectory with NO `final_metrics` block. Pre-change the predicate
#           read `(d.get("final_metrics") or {}).get("total_completion_tokens")
#           or 0`, which collapses *did not report* into *reported zero* — so a
#           schema change would have aborted every run as a dead credential.
#           Pre-change: DEAD (wrong). Post-change: live.
#   case 6  `iterate.sh` produces no trial at all (its own `timeout 1800` fires,
#           or harbor dies in setup). Pre-change the driver took the newest trial
#           by mtime with nothing tying it to the run just finished, so the
#           PREVIOUS iteration's trial was judged as if it were this one's.
#           Pre-change: exits 3 off a stale corpse. Post-change: says NO NEW
#           TRIAL and continues.
#
# Case 7 is the inverse of 6 — a corpse that really is this run's must STILL
# abort — so a "fix" that merely stops looking cannot pass. Verified red against
# `git show HEAD:benchmark/terminal-bench/iterate-until-change.sh`.
#
# Nothing real is read or run: every trajectory is synthetic, `iterate.sh` is a
# stub, and both live in a temp dir. No container, no API call, no credential.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRED="${TB_DEAD_TRIAL_PY:-$HERE/dead-trial.py}"
DRIVER="${TB_ITERATE_SCRIPT:-$HERE/iterate-until-change.sh}"
PY="${TB_PYTHON:-python}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "dead-trial:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1

# `dead-trial.py <file>` exits 0 when the trial never ran.
verdict() {  # $1 = trajectory file -> prints DEAD or LIVE
  if "$PY" "$PRED" "$1" >/dev/null 2>&1; then echo DEAD; else echo LIVE; fi
}

# ── case 1: the exact 2026-08-09 shape — zero tokens + a revoked 401 ──────
cat > "$TMP/corpse.json" <<'EOF'
{"schema_version":"1","final_metrics":{"total_completion_tokens":0,"total_cost_usd":0.0},
 "steps":[{"error":"API Error: 401 OAuth access token has been revoked"},{"error":"same"}]}
EOF
[ "$(verdict "$TMP/corpse.json")" = "DEAD" ] \
  && ok "a zero-token 401 trial is DEAD" \
  || bad "the exact incident shape was not detected — the guard is inert"

# ── case 2: a real attempt that scored 0 is NOT a corpse ──────────────────
cat > "$TMP/live.json" <<'EOF'
{"schema_version":"1","final_metrics":{"total_completion_tokens":48213,"total_cost_usd":1.23},
 "steps":[{"tool_calls":[{"function_name":"Bash"}]}]}
EOF
[ "$(verdict "$TMP/live.json")" = "LIVE" ] \
  && ok "a real attempt scoring 0 is not mistaken for a corpse" \
  || bad "a genuine failed attempt was discarded as a corpse — worse than the bug"

# ── case 3: a revoked credential that still burned tokens is DEAD ─────────
# Partial work then a revocation still means the trial did not run to completion
# on a valid credential; its reward is not comparable to a real attempt's.
cat > "$TMP/revoked-partial.json" <<'EOF'
{"schema_version":"1","final_metrics":{"total_completion_tokens":91,"total_cost_usd":0.001},
 "steps":[{"error":"API Error: 401 OAuth access token has been revoked"}]}
EOF
[ "$(verdict "$TMP/revoked-partial.json")" = "DEAD" ] \
  && ok "a 401 revocation is DEAD even with non-zero tokens" \
  || bad "the revoked-credential branch was dropped; only the token count remains"

# ── case 4: undecidable input FAILS OPEN ──────────────────────────────────
# Wrongly continuing costs one trial; wrongly aborting strands a sweep until a
# human notices. The real incident produced well-formed JSON, so failing open
# concedes nothing against the failure this guards.
printf 'not json at all {{{\n' > "$TMP/garbage.json"
[ "$(verdict "$TMP/garbage.json")" = "LIVE" ] \
  && ok "an unparseable trajectory fails OPEN rather than aborting the batch" \
  || bad "a parse error aborts the run — a corrupt file now strands the sweep"
[ "$(verdict "$TMP/does-not-exist.json")" = "LIVE" ] \
  && ok "a missing trajectory fails OPEN" \
  || bad "a missing file aborts the run"

# ── case 5 (RED pre-change): absent metrics is UNDECIDABLE, not zero ──────
cat > "$TMP/no-metrics.json" <<'EOF'
{"schema_version":"2","steps":[{"tool_calls":[{"function_name":"Bash"}]}]}
EOF
[ "$(verdict "$TMP/no-metrics.json")" = "LIVE" ] \
  && ok "a trajectory with no final_metrics is undecidable, not dead" \
  || bad "absent metrics read as zero — a schema change aborts every run as a dead credential"

# ── driver-level cases ────────────────────────────────────────────────────
# A fake campaign: $FAKE/jobs-sonnet5/<job>/<task>__<id>/agent/trajectory.json,
# plus a stub iterate.sh so no container or credential is ever touched.
TASK="stub-task"
FAKE="$TMP/tb"
mkdir -p "$FAKE"
cp "$DRIVER" "$FAKE/iterate-until-change.sh"
cp "$PRED"   "$FAKE/dead-trial.py"

put_trial() {  # $1 = trial id, $2 = trajectory JSON file to copy in
  local d="$FAKE/jobs-sonnet5/job1/${TASK}__$1"
  mkdir -p "$d/agent"
  cp "$2" "$d/agent/trajectory.json"
}

# The stub stands in for iterate.sh. TB_STUB_MAKES_TRIAL=1 makes it write a new
# corpse trial; unset, it writes nothing — the "no trial at all" case.
cat > "$FAKE/iterate.sh" <<'EOF'
#!/usr/bin/env bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "${TB_STUB_MAKES_TRIAL:-0}" = "1" ]; then
  d="$HERE/jobs-sonnet5/job1/stub-task__fresh"
  mkdir -p "$d/agent"
  cp "$HERE/corpse-template.json" "$d/agent/trajectory.json"
fi
echo "REWARD : 0.0"
echo "CHECKS : 0 of 2"
EOF
chmod +x "$FAKE/iterate.sh"
cp "$TMP/corpse.json" "$FAKE/corpse-template.json"

# ── case 6 (RED pre-change): no new trial -> do not judge the old one ─────
put_trial old "$TMP/corpse.json"
sleep 1  # keep mtimes distinct so "newest" is unambiguous
out6="$(cd "$FAKE" && TB_STUB_MAKES_TRIAL=0 timeout 120 bash "$FAKE/iterate-until-change.sh" "$TASK" 1 7999 2>&1)"
rc6=$?
if [ "$rc6" != "3" ] && grep -q "NO NEW TRIAL" <<<"$out6"; then
  ok "a run that produced no trial does not inherit the previous run's verdict"
else
  bad "exit $rc6 — judged a stale trial as if this run had produced it"
fi

# ── case 7: a corpse that IS this run's must still abort ──────────────────
# The inverse of case 6, so "just stop looking" cannot pass.
rm -rf "$FAKE/jobs-sonnet5"
put_trial old "$TMP/live.json"
sleep 1
out7="$(cd "$FAKE" && TB_STUB_MAKES_TRIAL=1 timeout 120 bash "$FAKE/iterate-until-change.sh" "$TASK" 1 7999 2>&1)"
rc7=$?
if [ "$rc7" = "3" ] && grep -q "ABORTING" <<<"$out7"; then
  ok "a corpse produced by THIS run still aborts the batch"
else
  bad "exit $rc7 — the guard no longer fires on a fresh corpse"
fi

# ── case 8: the driver uses the shared predicate, not a private copy ──────
# `attempt_feedback_text`'s reached_bench_material shares one regex with
# integrity-scan.py for exactly this reason: two copies drift, and the two
# disagreeing is how a corpse gets scored as a real attempt.
if grep -q 'dead-trial\.py' "$DRIVER"; then
  ok "the driver calls the shared predicate"
else
  bad "the driver has re-inlined the predicate — it will drift from this test"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
