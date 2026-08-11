#!/usr/bin/env bash
# Find tasks that were "accepted as a failed trial (0.0)" because the MODEL was
# unreachable — credits exhausted, usage limit, expired auth — rather than
# because TerranSoul could not solve them.
#
# WHY THIS EXISTS. classify_errored_task() in run-sweep gives each task a small
# retry budget and then writes it to $STATE and $ACCEPTED with a 0.0. That is
# right for a task that is genuinely too hard: retrying burns ~$1.50 and an hour
# to reproduce the same failure. It is WRONG for an outage, because every
# remaining task then errors, gets accepted at 0.0, and is marked done — so a
# later resume SKIPS it and the run reports "complete" while being worthless.
#
# The existing guard, last_job_hit_rate_limit(), greps result.json for the
# literal string "RateLimit" only. A credit or usage-limit error worded any
# other way walks straight past it.
#
# This script REPORTS ONLY. Removing a task from the ledgers is a deliberate
# act and is left to a human, because deleting the wrong line silently drops a
# legitimate result from the run.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
JOBS="${TB_JOBS_DIR:-$HERE/jobs-submit}"

# Error signatures that mean "the model was unreachable", NOT "the agent tried
# and failed". Deliberately broad: a false positive costs one re-run, a false
# negative bakes an unearned zero into a public submission.
OUTAGE_RE='credit|quota|usage limit|usage_limit|rate.?limit|RateLimit|insufficient|billing|401|403|429|Unauthorized|Authentication|UnknownApiError|expired'

echo "── credit/outage audit ─────────────────────────────"
echo "jobs dir: $JOBS"
echo

found=0
for acc in "$REPO"/mcp-data/.tb-par*-accepted.txt; do
  [ -f "$acc" ] || continue
  w="$(basename "$acc" | sed -E 's/^\.tb-par([0-9]+)-accepted\.txt$/\1/')"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    # Newest job dir for this task, whichever worker produced it.
    jd="$(ls -1dt "$JOBS"/*/ 2>/dev/null | while read -r d; do
            [ -d "$d$t" ] || ls -1d "$d"/"$t"__* >/dev/null 2>&1 || continue
            echo "$d"; break
          done)"
    rj="${jd%/}/result.json"
    sig=""
    if [ -f "$rj" ]; then
      sig="$(grep -oiE "$OUTAGE_RE" "$rj" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')"
    fi
    if [ -n "$sig" ]; then
      printf '  ⛔ worker %s  %-38s  OUTAGE SIGNATURE: %s\n' "$w" "$t" "$sig"
      printf '     job: %s\n' "${jd:-<not found>}"
      found=$((found+1))
    fi
  done < "$acc"
done

# ⛔ THE HOLE THIS CLOSES. The loop above only inspects tasks in $ACCEPTED —
# tasks the sweep gave up on and recorded as 0.0. But a credential expiry
# usually kills ONE trial inside a task that otherwise completes normally: the
# task never reaches $ACCEPTED, so the audit above reported "none" while
# configure-git-webserver sat on disk with 1 of 5 trials dead of
# UnknownApiError and a 0.0 it did not earn. Measured 2026-08-07.
#
# That 0.0 matters twice over: the leaderboard requires n_errored_trials == 0,
# and an errored trial still contributes to `mean`, so the headline number is
# wrong in whichever direction the dead trial happened to score.
echo "── errored trials inside otherwise-complete tasks ──"
err=$(python - "$JOBS" <<'PY'
# ⛔ JUDGE ONLY THE LATEST JOB PER TASK. The first version scanned every
# result.json on disk, so a task that FAILED and was then re-run cleanly was
# still reported as broken forever — the corrupted job stays on disk beside its
# replacement. Measured 2026-08-07: it flagged caffe-cifar-10, circuit-fibsqrt
# and configure-git-webserver, all three of which the sweep had already re-run
# to errored=0 / n_trials=5. Acting on that would have burned ~$16 and an hour
# re-running clean work.
#
# The sweep's own derived-completion counts CLEAN trials, so it re-runs these
# without help. This audit only needs to report what is still broken NOW.
import json, glob, os, sys
jobs = sys.argv[1]

latest = {}   # task -> (started_at, n_errored, n_trials, exceptions, jobdir)
for f in sorted(glob.glob(os.path.join(jobs, '*', 'result.json'))):
    try:
        r = json.load(open(f))
    except Exception:
        continue
    s = r.get('stats', {})
    started = r.get('started_at') or ''
    for ev in (s.get('evals') or {}).values():
        names = []
        for score, ns in (ev.get('reward_stats', {}).get('reward', {}) or {}).items():
            names += [x for x in ns]
        if not names:
            continue
        task = names[0].rsplit('__', 1)[0]
        cur = (started, s.get('n_errored_trials') or 0, ev.get('n_trials'),
               list((ev.get('exception_stats') or {}).keys()), os.path.dirname(f))
        if task not in latest or cur[0] > latest[task][0]:
            latest[task] = cur

n = 0
for task, (started, nerr, ntr, ex, jd) in sorted(latest.items()):
    if not nerr and not ex:
        continue
    print('  !! %-38s %s of %s trial(s) errored: %s'
          % (task, nerr, ntr, ','.join(ex) or 'n_errored_trials>0'))
    print('     job: %s  (started %s)' % (os.path.basename(jd), started[:19]))
    print('     re-run with: bash redo-task.sh %s' % task)
    n += 1
print('__COUNT__%d' % n)
PY
)
printf '%s\n' "$err" | grep -v '^__COUNT__'
ecount=$(printf '%s' "$err" | grep -oE '^__COUNT__[0-9]+' | grep -oE '[0-9]+$')
[ -z "$ecount" ] && ecount=0
[ "$ecount" = "0" ] && echo "  none"
found=$((found + ecount))

echo
# The two shapes need DIFFERENT remedies, so they are reported separately.
# Conflating them was the first version's bug: it offered ledger-surgery for a
# task whose ledgers are fine and whose problem is one dead trial.
acc_only=$((found - ecount))

if [ "$found" -eq 0 ]; then
  echo "  none — no outage-attributable zeros, no errored trials."
  echo "  (If an outage happened but produced NO result.json at all, this cannot"
  echo "   see it — cross-check sweep-status.sh and the worker logs by hand.)"
else
  if [ "$ecount" -gt 0 ]; then
    echo "  $ecount task(s) have an ERRORED TRIAL inside an otherwise-complete task."
    echo "  The task is NOT in \$ACCEPTED and its ledgers are correct — the problem"
    echo "  is one dead trial carrying a reward it did not earn. A submission"
    echo "  requires n_errored_trials == 0, so re-run just that task:"
    echo
    echo "    bash redo-task.sh <task-name>"
    echo
  fi
  if [ "$acc_only" -gt 0 ]; then
    echo "  $acc_only task(s) were ACCEPTED AS 0.0 with an outage signature."
    echo "  Those zeros are artifacts. To re-run one, remove it from BOTH ledgers"
    echo "  and relaunch per RESUME.md:"
    echo
    echo "    t=<task-name>; w=<worker>"
    echo "    grep -vx \"\$t\" mcp-data/.tb-par\${w}-state.txt    > /tmp/s; mv /tmp/s mcp-data/.tb-par\${w}-state.txt"
    echo "    grep -vx \"\$t\" mcp-data/.tb-par\${w}-accepted.txt > /tmp/a; mv /tmp/a mcp-data/.tb-par\${w}-accepted.txt"
    echo
    echo "  NOTE: do NOT chain those with && — grep -v exits 1 when it outputs"
    echo "  nothing, which silently skips the file that would become empty."
  fi
fi
echo
[ "$found" -eq 0 ]
