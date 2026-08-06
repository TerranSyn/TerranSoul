#!/usr/bin/env bash
# Run the remaining sweep tasks across N PARALLEL WORKERS.
#
#   usage: run-parallel.sh [workers]        # default 4
#          DRY=1 run-parallel.sh 4
#
# WHY. Measured 2026-08-06 over the k=2 run: 60 trials, 9.9 h wall-clock, 7.5 h
# of actual trial time -- 75% utilisation of ONE task at a time, on a host with
# 24 cores and 31 GB where a task container uses 1 CPU and ~400 MB. The
# serialisation was entirely self-imposed: TB_CONCURRENCY=1 exists so ATTEMPTS
# within a task stay ordered (attempt 1 is the control), but that says nothing
# about running different TASKS at once. At ~23 min/task the remaining 63 tasks
# were a 24-hour job; four workers make it about six.
#
# HOW EACH WORKER IS ISOLATED, and each of these was a real failure mode:
#   TB_JOB_PREFIX   distinct per worker. This is what makes `newest_job_dir`
#                   race-free: the `last_job_*` helpers scope their glob to the
#                   worker's own prefix, so a task can never be classified from
#                   another worker's result.json. It also prevents job-NAME
#                   collisions, since run-dg builds the name from the prefix
#                   plus a whole-second timestamp -- two workers starting in the
#                   same second would otherwise write to one directory.
#   TB_PROXY_PORT   distinct. Two proxies on 7425 = EADDRINUSE and both runs die
#                   (measured 2026-08-04).
#   TB_STATE etc.   distinct ledgers, so workers do not interleave writes into
#                   one file and lose lines.
#   TB_LOCK         distinct, or the second worker refuses to start.
#
# THE SHARDING TRICK, so no new code is needed in the driver: run-sweep computes
# TODO = ALL - STATE. Seed each worker's STATE with every task EXCEPT its shard
# and its TODO becomes exactly that shard.
#
# SHARED ON PURPOSE:
#   the bench brain (:7424)  — cross-task learning is the point; SQLite WAL
#                              handles concurrent writers.
#   jobs/                    — merge-sweep globs prefixes and takes the BEST
#                              trial per task, so all workers' output merges
#                              with no extra step and nothing already banked can
#                              be lowered.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORKERS="${1:-4}"
DRY="${DRY:-0}"
TASKS_DIR="${TB21_DIR:-/d/Git/terminal-bench-2-1}/tasks"
STATE="$REPO/mcp-data/.tb-sweep-state.txt"

# ── refuse to race the sequential sweep ─────────────────────────────────────
for lk in "$REPO"/mcp-data/.tb-sweep*.lock; do
  [ -f "$lk" ] || continue
  pid="$(cat "$lk" 2>/dev/null)"
  if [ -n "$pid" ] && ps -W 2>/dev/null | awk -v p="$pid" '$1==p{f=1} END{exit !f}'; then
    echo "REFUSING: a sweep is running as pid $pid ($lk). Stop it first." >&2
    exit 2
  fi
done

# DIRECTORIES ONLY, not "names without a dot". The obvious filter for skipping
# README.md and dataset.toml is `grep -v '\.'` -- and it silently drops
# `install-windows-3.11`, a real task whose NAME contains a dot. A task quietly
# missing from the roster is indistinguishable from one that scored 0.
mapfile -t ALL < <(cd "$TASKS_DIR" && ls -1d */ 2>/dev/null | sed 's#/$##' | sort)
[ "${#ALL[@]}" -gt 0 ] || { echo "no tasks under $TASKS_DIR" >&2; exit 2; }

# ── GROUND TRUTH: which tasks already have their full quota of CLEAN trials ──
#
# ⛔ THE STATE FILES CANNOT ANSWER THIS, AND TRUSTING THEM SILENTLY DROPS WORK.
# `$wstate` is written with TWO different meanings mixed together: "not in my
# shard" (a topology fact) and "I finished this" (a progress fact). The moment
# the worker COUNT changes, the shards are recomputed and yesterday's "not
# mine" becomes today's "mine" — while still sitting in the file, where the
# seeding loop reads it as "already done".
#
# MEASURED 2026-08-06, after this campaign ran at 4, then 2, then 3 workers:
# 35 of the 62 remaining tasks were in a worker's shard AND marked done in that
# worker's state, despite having only ONE clean attempt. The launch reported a
# healthy "11 + 11 + 5 to run", every shard check passed, and the sweep would
# have finished having never given those 35 tasks a second attempt — then the
# merge would have published a k=2 number built on 27 tasks while looking
# complete. A silent under-run is far worse than a crash.
#
# So completion is derived from jobs/ on disk, which is the only record that is
# both durable and topology-independent. A task counts as done when it has at
# least TB_ATTEMPTS trials that did NOT error — errored trials are excluded
# deliberately, because a trial killed at setup (see run-dg.sh's reap note)
# never ran the agent and must not be banked as an attempt.
# TWO DIFFERENT NUMBERS, and conflating them costs real money.
#   TB_TARGET_ATTEMPTS  how many clean trials a task needs before it counts as
#                       DONE. This is the campaign's k.
#   TB_ATTEMPTS         how many attempts each job runs when it is launched.
# For a fresh campaign they are equal. For a k=2 -> k=5 continuation they are
# NOT: every task already has 2 clean trials, so the target is 5 but each job
# only needs to add 3. Setting both to 5 re-runs 5 per task on top of the
# existing 2 — 7 per task, ~178 surplus trials, roughly $196 wasted.
ATTEMPTS_WANTED="${TB_TARGET_ATTEMPTS:-${TB_ATTEMPTS:-2}}"
DONE_FILE="$REPO/mcp-data/.tb-completed-derived.txt"
# TB_JOBS_DIR keeps the submittable arm's output separate from the local-
# provenance history. Trials run with `-p <path>` can never contribute to a
# leaderboard submission (see run-dg.sh's dataset note), so mixing the two in
# one directory would make the derived completion count local trials toward a
# registry-provenance target and under-run the arm silently.
JOBS_DIR="${TB_JOBS_DIR:-$HERE/jobs}" ATTEMPTS_WANTED="$ATTEMPTS_WANTED" OUT="$DONE_FILE" python - <<'PY'
import json, glob, os, collections
jobs = os.environ['JOBS_DIR']; want = int(os.environ['ATTEMPTS_WANTED'])
clean = collections.Counter()
for rj in glob.glob(os.path.join(jobs, '*', 'result.json')):
    try:
        d = json.load(open(rj, encoding='utf-8'))
    except Exception:
        continue
    for ev in ((d.get('stats', {}) or {}).get('evals') or {}).values():
        errored = set()
        for lst in (ev.get('exception_stats') or {}).values():
            for t in lst:
                errored.add(str(t))
        for lst in (ev.get('reward_stats', {}) or {}).get('reward', {}).values():
            for t in lst:
                if str(t) not in errored:
                    clean[str(t).split('__')[0]] += 1
done = sorted(t for t, n in clean.items() if n >= want)
# '\n'.join + newline='' so Windows Python does not emit CRLF: these files are
# compared with `grep -qxF` from bash, and a trailing \r makes every line miss.
with open(os.environ['OUT'], 'w', newline='') as fh:
    fh.write('\n'.join(done) + ('\n' if done else ''))
print(f"[par] derived completion: {len(done)} task(s) already have >={want} clean trial(s)")
PY

# ⚠️ ON A k-CONTINUATION THE GLOBAL $STATE MUST NOT GATE. It records "done at
# the k this campaign was running", so after a completed k=2 it holds tasks that
# still need more attempts to reach k=5. Honouring it would silently exclude
# them — measured on the k=2 -> k=5 dry run: 29 tasks reported "already done"
# when only 7 actually had 5 clean trials, i.e. 22 tasks would never have been
# topped up and the k=5 number would have been built on their k=2 evidence.
#
# When TB_TARGET_ATTEMPTS is set we are continuing an existing campaign, so the
# DERIVED completion (counted from jobs/ on disk) is the only authority. The
# per-worker retry ledgers still bound retries within the run, so a genuinely
# hopeless task cannot loop forever.
TODO=()
for t in "${ALL[@]}"; do
  grep -qxF "$t" "$DONE_FILE" 2>/dev/null && continue      # ground truth wins
  if [ -n "${TB_TARGET_ATTEMPTS:-}" ]; then
    TODO+=("$t")                                           # continuation: derived only
  else
    grep -qxF "$t" "$STATE" 2>/dev/null || TODO+=("$t")
  fi
done

echo "[par] tasks total   : ${#ALL[@]}"
echo "[par] already done  : $(( ${#ALL[@]} - ${#TODO[@]} ))"
echo "[par] remaining     : ${#TODO[@]}"
echo "[par] workers       : $WORKERS"
[ "${#TODO[@]}" -eq 0 ] && { echo "[par] nothing to do"; exit 0; }

STAMP="$(date +%m%d%H%M)"
for ((w=0; w<WORKERS; w++)); do
  wstate="$REPO/mcp-data/.tb-par${w}-state.txt"
  shard=()
  : > "$wstate.shard"
  for ((i=w; i<${#TODO[@]}; i+=WORKERS)); do
    shard+=("${TODO[$i]}")
    echo "${TODO[$i]}" >> "$wstate.shard"
  done
  [ "${#shard[@]}" -eq 0 ] && continue

  # STATE = every task NOT in this worker's shard  PLUS  the shard tasks this
  # worker has ALREADY finished -> TODO becomes only its unfinished shard.
  #
  # PRESERVING THE SECOND HALF IS THE WHOLE POINT OF A RESUME. Rebuilding STATE
  # from the shard alone discards the completed-task record, so every relaunch
  # re-runs work that is already banked. This campaign restarted three times
  # (ultracode revert, credential rotation, Docker restart) and each one silently
  # re-ran finished tasks. The RESULTS were never lost — merge-sweep reads
  # jobs/ and takes the best trial per task — but the time and money were.
  # "Already done" comes from $DONE_FILE (derived from jobs/ above), NEVER from
  # the previous contents of $wstate — see the GROUND TRUTH note where
  # DONE_FILE is built. Reading the old $wstate here is what silently skipped
  # 35 tasks when this campaign moved from 4 workers to 2 to 3.
  : > "$wstate"
  expected=0
  for t in "${ALL[@]}"; do
    if ! grep -qxF "$t" "$wstate.shard"; then
      echo "$t" >> "$wstate"                      # not ours: never run it here
    elif grep -qxF "$t" "$DONE_FILE" 2>/dev/null; then
      echo "$t" >> "$wstate"                      # ours, provably done: skip it
    else
      expected=$((expected+1))                    # ours and still to do
    fi
  done
  # RECORD THE TRUE TODO COUNT FOR THE GUARD BELOW. It cannot be `wc -l` on the
  # shard: the loop above deliberately drops shard tasks this worker already
  # finished, so on any resume the real TODO is SMALLER than the shard. The
  # guard compared against the full shard size and therefore fired on exactly
  # the case this sharding scheme exists to support — a resume. Measured
  # 2026-08-06: worker 0 had already completed `financial-document-processor`
  # from its own shard, reported a correct "30 to run" against a 31-task shard,
  # and the guard killed BOTH healthy workers with exit 4.
  #
  # That is the SECOND time this guard has destroyed a correct run (see the
  # `tail -1` note below, same guard, same shape: comparing against a stale or
  # wrong baseline). A guard whose false-positive costs more than the failure it
  # detects has to be exact, so the expected count is now computed by the code
  # that does the seeding rather than re-derived from a file that cannot express
  # "already done".
  echo "$expected" > "$wstate.expected"

  echo "[par] worker $w: ${#shard[@]} task(s), port $((7425+w)), prefix par${w}${STAMP}"
  if [ "$DRY" = "1" ]; then
    echo "       first few: ${shard[*]:0:4}"
    continue
  fi

  # TB_RESUME=1 IS MANDATORY, NOT AN OPTION. run-sweep truncates $STATE unless
  # resuming (`[ "$TB_RESUME" = 1 ] || : > "$STATE"`), which wipes the
  # shard-exclusion seeded a second earlier -- every worker then computes
  # TODO = all 89 tasks, and four workers run the ENTIRE suite in parallel.
  # Observed on the first launch: three workers on build-cython-ext at once.
  nohup env \
    TB_RESUME=1 \
    TB_ATTEMPTS="${TB_ATTEMPTS:-2}" TB_DEFER_WRITES=0 TB_ONE_JOB_PER_TASK=1 TB_CONCURRENCY=1 \
    TB_PROXY_MODE=learn PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
    TB_JOB_PREFIX="par${w}${STAMP}" \
    TB_PROXY_PORT="$((7425+w))" \
    TB_STATE="$wstate" \
    TB_RETRIES="$REPO/mcp-data/.tb-par${w}-retries.txt" \
    TB_ACCEPTED="$REPO/mcp-data/.tb-par${w}-accepted.txt" \
    TB_LOCK="$REPO/mcp-data/.tb-par${w}.lock" \
    bash "$HERE/run-sweep.par.sh" \
    >> "$REPO/mcp-data/logs/tbench-par${w}.log" 2>&1 &
  disown 2>/dev/null || true
  sleep 3   # stagger, so proxies bind and job-name seconds differ
done

# VERIFY THE SHARDING TOOK. The failure mode is silent and expensive: each
# worker logs "N to run", and if N is the full roster the shard was ignored and
# every worker will grind through all 89 tasks. Catching it 12 seconds in costs
# nothing; catching it an hour in costs four hours of duplicated compute.
if [ "$DRY" != "1" ]; then
  echo
  echo "[par] verifying shards (each worker must run ONLY its own share)..."
  sleep 12
  bad=0
  for ((w=0; w<WORKERS; w++)); do
    L="$REPO/mcp-data/logs/tbench-par${w}.log"
    # The count the SEEDING loop actually computed (shard minus already-done),
    # never `wc -l` on the shard file — see the note where .expected is written.
    want=$(cat "$REPO/mcp-data/.tb-par${w}-state.txt.expected" 2>/dev/null || echo 0)
    # `tail -1`, NOT `grep -m1`. These logs are APPENDED across launches, so the
    # first "N to run" is whatever the OLDEST run reported. Reading it made the
    # check fail against a correctly-sharded relaunch and kill four healthy
    # workers — the guard doing exactly the damage it was written to prevent.
    got=$(grep -oE '[0-9]+ to run' "$L" 2>/dev/null | tail -1 | grep -oE '^[0-9]+' || echo '?')
    if [ "$got" = "$want" ]; then
      echo "  worker $w: $got to run  OK"
    else
      echo "  worker $w: '$got' to run, expected $want  -- SHARD IGNORED" >&2
      bad=1
    fi
  done
  if [ "$bad" = "1" ]; then
    echo "[par] STOPPING the workers — they would duplicate each other's tasks." >&2
    for ((w=0; w<WORKERS; w++)); do
      pid="$(cat "$REPO/mcp-data/.tb-par${w}.lock" 2>/dev/null)"
      [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
    done
    exit 4
  fi
fi

echo
echo "[par] launched. watch:  tail -f $REPO/mcp-data/logs/tbench-par*.log"
echo "[par] merge (covers every worker, best trial per task):"
echo "        bash $HERE/merge-sweep.sh $HERE/jobs"
echo "[par] a worker's shard is independent — one dying costs only its own tasks."
