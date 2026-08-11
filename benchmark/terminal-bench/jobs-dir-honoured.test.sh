#!/usr/bin/env bash
# run-dg.sh writes trials to `${TB_JOBS_DIR:-$HERE/jobs}`. run-sweep.par.sh's
# `newest_job_dir` — the helper every `last_job_*` classifier is built on —
# hardcoded `$HERE/jobs`.
#
# So on the submittable campaign, which sets TB_JOBS_DIR=jobs-submit, all three
# classifiers read a DIFFERENT corpus from the one the run was writing: `jobs/`,
# left over from the earlier k=1 and k=2 campaigns.
#
# WHAT IT COST, measured on the 2026-08-07 run: `last_job_hit_rate_limit` never
# fired once. TB_RATE_LIMIT_PAUSE_S=900 was configured and never applied, while
# 15 trials died of ApiRateLimitError — the backoff that exists to prevent that
# was grepping a corpus that could not contain the evidence. `last_job_errored`
# and `last_job_is_for_task` were reading the same wrong place, so retry-versus-
# accept decisions were made against a stale job.
#
# run-dg.sh:675 carries a comment recording this exact defect being found and
# fixed THERE. It was never propagated to the sweep driver.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md). The fixture puts
# a DECOY job under `$HERE/jobs` whose result.json contains "RateLimit", and the
# real job under a separate TB_JOBS_DIR with a clean result.json. Pre-change
# `newest_job_dir` returns the decoy, so case 1 reports the wrong directory and
# case 2 reports a rate limit that did not happen. Case 3 is the inverse — a
# real rate limit in the CONFIGURED dir must be seen — so a "fix" that just
# stops looking cannot pass. Verified red against
# `git show HEAD:...run-sweep.par.sh`.
#
# Nothing real is read: both corpora are synthetic and live in a temp dir.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${TB_SWEEP_SCRIPT:-$HERE/run-sweep.par.sh}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "jobs-dir-honoured:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Lift newest_job_dir + last_job_hit_rate_limit out of the driver; sourcing the
# whole script would launch a sweep.
start="$(grep -n '^newest_job_dir() {' "$SRC" | head -1 | cut -d: -f1)"
end="$(grep -n '^last_job_is_for_task() {' "$SRC" | head -1 | cut -d: -f1)"
if [ -z "$start" ] || [ -z "$end" ]; then
  bad "could not locate newest_job_dir / last_job_is_for_task in $SRC"
  echo "  ${pass} passed, ${fail} failed"; exit 1
fi
sed -n "${start},$((end-1))p" "$SRC" > "$TMP/funcs.sh"

FAKE_HERE="$TMP/tb"
mkdir -p "$FAKE_HERE/jobs/par0stamp-decoy"      # the WRONG corpus
mkdir -p "$TMP/submit/par0stamp-real"           # the CONFIGURED corpus

# The decoy carries a rate limit; the real job does not.
printf '{"stats":{"note":"ApiRateLimitError happened here"}}\n' \
  > "$FAKE_HERE/jobs/par0stamp-decoy/result.json"
printf '{"stats":{"note":"clean run"}}\n' \
  > "$TMP/submit/par0stamp-real/result.json"

run_helpers() {  # $1 = script to eval after sourcing
  HERE="$FAKE_HERE" TB_JOBS_DIR="$TMP/submit" TB_JOB_PREFIX="par0stamp" \
    bash -c 'set -uo pipefail; HERE="$HERE"; . "$1"; shift; eval "$@"' _ "$TMP/funcs.sh" "$1" 2>&1
}

# ── case 1: newest_job_dir points at the configured corpus ────────────────
GOT="$(run_helpers 'newest_job_dir')"
if grep -q "submit/par0stamp-real" <<<"$GOT"; then
  ok "newest_job_dir honours TB_JOBS_DIR"
else
  bad "newest_job_dir returned '$(tr -d '\n' <<<"$GOT")' — not the configured jobs dir"
fi

# ── case 2: no false rate limit from the stale corpus ─────────────────────
run_helpers 'last_job_hit_rate_limit && echo HIT || echo MISS' > "$TMP/o2" 2>&1
if grep -q "MISS" "$TMP/o2"; then
  ok "a rate limit in the STALE corpus is not attributed to this run"
else
  bad "read a rate limit out of the wrong jobs dir — the backoff fires on stale evidence"
fi

# ── case 3: a real rate limit IS still detected ───────────────────────────
printf '{"stats":{"note":"ApiRateLimitError"}}\n' > "$TMP/submit/par0stamp-real/result.json"
run_helpers 'last_job_hit_rate_limit && echo HIT || echo MISS' > "$TMP/o3" 2>&1
if grep -q "HIT" "$TMP/o3"; then
  ok "a rate limit in the CONFIGURED corpus is detected"
else
  bad "the backoff no longer detects a real rate limit — worse than the bug"
fi

# ── case 4: the per-worker merge reports the configured corpus ────────────
if grep -q 'merge-sweep.sh" "${TB_JOBS_DIR:-\$HERE/jobs}"' "$SRC"; then
  ok "the end-of-run merge reads the configured jobs dir"
else
  bad "the end-of-run merge still hardcodes \$HERE/jobs — it reports another campaign"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
