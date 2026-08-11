#!/usr/bin/env bash
# ONE tool call = one full loop tick. Prints everything the /loop supervisor
# needs and nothing it does not.
#
# WHY THIS EXISTS — IT IS A COST FIX, NOT A CONVENIENCE.
# A supervising agent is billed cache-read tokens equal to its WHOLE context on
# every request, so cost scales with NUMBER OF TOOL CALLS x CONTEXT SIZE, not
# with how much work each call does. Measured on this campaign's session:
# 657M cache-read tokens = $985 of $1161 total (84.9%), against $117 of output.
# A 12-call tick on an ~800K context therefore costs ~$14 in cache reads before
# a single byte of real work; the same tick as ONE call costs ~$1.20.
#
# So: add checks to this script freely, but do NOT split a tick back into
# separate calls. Reading more per call is nearly free. Calling more is not.
#
#   usage: tick.sh [jobs-dir]        (default jobs-sonnet5)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
JOBS="${1:-jobs-sonnet5}"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
cd "$HERE" || exit 2

echo "════ TICK $(date '+%Y-%m-%d %H:%M:%S') ════ jobs=$JOBS"

# 1. workers, containers, disk
bash sweep-status.sh 2>&1 | grep -vE '^\s*$'

# 2. brains — memory_total is the honest probe; /health returns 200 either way
for p in 7423 7424; do
  t="$(curl -s -m 5 "http://127.0.0.1:$p/health" 2>/dev/null \
       | python -c "import sys,json;print(json.load(sys.stdin).get('memory_total'))" 2>/dev/null)"
  printf '  brain :%s memory_total=%s\n' "$p" "${t:-UNREACHABLE}"
done

# 2b. CREDENTIAL HEADROOM. A worker refuses to START a task with under ~40 min of
# token life, so it parks until the credential expires and can be re-minted. That
# is designed and self-healing, but it is invisible in the progress counters — a
# worker sitting on "waiting Ns for the credential to reach expiry" looks exactly
# like a worker on a slow task. Surface it so a genuine stall (6/6 pokes failed,
# needs an interactive `claude setup-token` only the owner can run) is
# distinguishable from a routine rotation.
for f in "$REPO"/mcp-data/logs/tbench-par[0-9].log; do
  [ -f "$f" ] || continue
  w="$(basename "$f" .log | sed 's/tbench-par//')"
  start="$(grep -n '\[sweep\] job prefix:' "$f" | tail -1 | cut -d: -f1)"
  [ -n "$start" ] || continue
  last="$(tail -n +"$start" "$f" | grep -iE 'token refreshed|token has .* left|poking the host CLI|waiting [0-9]+s for the credential' | tail -1)"
  [ -n "$last" ] && printf '  cred w%s : %s\n' "$w" "$(echo "$last" | sed 's/^\[sweep\] //')"
  if tail -n +"$start" "$f" | grep -q 'attempt 6/6'; then
    echo "  ⚑ WORKER $w EXHAUSTED ITS CREDENTIAL POKES — owner must run: claude setup-token"
  fi
done

# 3. integrity — exit code is the signal; anything above the known baseline is new
python integrity-scan.py "$JOBS" --brain "$REPO/mcp-data-tbench/memory.db" \
  > /tmp/tick-integrity.txt 2>&1
irc=$?
printf '  integrity: exit=%s  %s\n' "$irc" \
  "$(grep -E 'reaching the|brain rows' /tmp/tick-integrity.txt | tr '\n' ' ' | tr -s ' ')"
grep -E '^\s+QUARANTINE|^\s+ROW ' /tmp/tick-integrity.txt | sed 's/^/    /'

# 4. scoreboard + what still needs trials, straight off disk
python - "$JOBS" <<'PY'
import json, glob, os, sys, collections
jobs = sys.argv[1]
per = collections.defaultdict(list)
# ERRORED TRIALS ARE SCORED 0 AND NEVER DROPPED (leaderboard/SUBMIT.md), so they
# belong on the scoreboard, not only in the per-worker log line. This campaign
# ran 231 trials at zero errors and then took an AgentTimeoutError on
# make-doom-for-mips; finding that took a separate investigation because the tick
# did not show it. "0 errored" is a claim that has to be re-earned every tick.
errored = 0
exc_names = []
for rj in glob.glob(os.path.join(jobs, "*", "result.json")):
    try:
        s = json.load(open(rj, encoding="utf-8"))["stats"]
    except Exception:
        continue
    errored += s.get("n_errored_trials") or 0
    for ev in (s.get("evals") or {}).values():
        # AN ERRORED TRIAL CAN STILL REPORT reward 1.0. The verifier runs even
        # when the AGENT died, so a trial that blew up with UnknownApiError has
        # been recorded as a pass before (merge-sweep.sh's header cites job
        # dg-20260804-161447). merge-sweep excludes errored trials from the pass
        # check; this scoreboard did not, so it could have shown a pass the
        # official number correctly withholds. Both errored trials in this
        # campaign happened to report 0.0, so nothing was ever overstated -- the
        # divergence is closed because it COULD be, not because it bit.
        bad = set()
        for e, ids in (ev.get("exception_stats") or {}).items():
            exc_names += ["%s:%s" % (e, i.split("__")[0]) for i in ids]
            bad |= set(ids)
        for rew, names in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
            for n in names:
                # Errored trials stay in the denominator as trials, scored 0.
                per[n.split("__")[0]].append(n not in bad and float(rew) >= 1.0)
five = [k for k, v in per.items() if sum(v) >= 5]
solved = [k for k, v in per.items() if any(v)]
# FAILED-ALL means a FINISHED task that never passed. A task with one failed
# trial is IN PROGRESS and has four attempts left -- calling it failed raises an
# alarm on every task whose first attempt happens to fail, which is 13% of them.
dead = [(k, len(v)) for k, v in per.items() if not any(v) and len(v) >= 5]
pending0 = [(k, len(v)) for k, v in per.items() if not any(v) and len(v) < 5]
short = sorted((k, sum(v), len(v)) for k, v in per.items() if sum(v) < 5)
print("  tasks %d/89  trials %d  5-of-5 %d  solved %d  per-task %.4f  ERRORED %d"
      % (len(per), sum(len(v) for v in per.values()), len(five), len(solved),
         len(solved) / len(per) if per else 0, errored))
if exc_names:
    print("  errored trials (scored 0.0, kept in the denominator): %s"
          % ", ".join(sorted(set(exc_names))))
print("  FAILED-ALL (>=5 trials, never passed): %s"
      % (", ".join("%s(%d)" % x for x in dead) or "none"))
if pending0:
    print("  no pass YET (in progress, attempts remain): %s"
          % ", ".join("%s %d/5" % (k, n) for k, n in sorted(pending0)))
print("  short of 5: %s" % (", ".join("%s %d/%d" % x for x in short) or "none"))
PY

# 5. has a worker finished its shard? that is the RELAUNCH trigger
for f in "$REPO"/mcp-data/logs/tbench-par[0-9].log; do
  [ -f "$f" ] || continue
  w="$(basename "$f" .log | sed 's/tbench-par//')"
  start="$(grep -n '\[sweep\] job prefix:' "$f" | tail -1 | cut -d: -f1)"
  [ -n "$start" ] || continue
  if tail -n +"$start" "$f" | grep -qiE 'sweep (complete|finished)|all tasks done|shard exhausted'; then
    echo "  ⚑ WORKER $w HAS EXHAUSTED ITS SHARD — relaunch owed: bash run-parallel.sh 2"
  fi
done

echo "════ end tick ════"
