#!/usr/bin/env bash
# Full Terminal-Bench 2.1 sweep, run in BATCHES that each fit inside the OAuth
# token's lifetime.
#
# WHY BATCHED — measured 2026-08-04, not a precaution.
#   * 5-task probe: 27 min wall clock at concurrency 2, $11.03, 5/5 pass.
#   * Extrapolated: 445 trials (89 tasks x 5 attempts) ~= 20 h at concurrency 4
#     and ~$982.
#   * A subscription OAuth access token lives ~7 h and the CONTAINER gets a
#     STATIC copy — nothing inside can refresh it. A single 20 h harbor job
#     would therefore have its credential die partway through.
#   * That failure is not loud. An errored trial STILL CONTRIBUTES its reward to
#     the headline mean (job dg-20260804-161447: UnknownApiError + mean 1.0), so
#     a token expiry mid-sweep would silently corrupt the published number
#     rather than stopping the run.
#
# So: refresh the credential from the host's own Claude Code credentials before
# every batch, keep each batch far inside the token window, and merge at the end
# while reporting errored trials separately instead of averaging them in.
#
# Usage:
#   ./run-sweep.sh                 # all 89 tasks, 5 attempts, batches of 10
#   TB_BATCH=5 ./run-sweep.sh      # smaller batches
#   TB_ATTEMPTS=1 ./run-sweep.sh   # one attempt per task (cheap dry sweep)
#   TB_RESUME=1 ./run-sweep.sh     # skip tasks already completed in this sweep
set -uo pipefail

# Python here writes report text containing non-ASCII glyphs (arrows, +/-).
# Windows Python defaults stdout to cp1252, so an un-guarded run either CRASHES
# mid-report (self-improve-rate.sh died with UnicodeEncodeError after printing
# only its first line) or emits mojibake (attempt-uplift.sh printed a literal
# replacement char). merge-sweep.sh produces the HEADLINE NUMBER, so a crash
# there truncates the very result the campaign exists to report. The sweep
# drivers inherit this from run-parallel.sh, but not when run standalone.
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TB21_DIR="${TB21_DIR:-/d/Git/terminal-bench-2-1}"
BATCH="${TB_BATCH:-10}"
export TB_ATTEMPTS="${TB_ATTEMPTS:-5}"
export TB_CONCURRENCY="${TB_CONCURRENCY:-4}"
export TB_PROXY_MODE="${TB_PROXY_MODE:-learn}"
# Deferral is what makes k>1 submittable: without it a lesson written during
# attempt 1 of task X is immediately retrievable by attempts 2..5 of the SAME
# task, which is precisely the cross-attempt leakage that inflates pass@k (the
# leaky config cost ~$982/~20 h and bought only a bigger number). The machinery
# existed but was opt-in, while TB_ATTEMPTS defaults to 5 here — so the unsafe
# combination was the DEFAULT. It selects the one-job-per-task branch below.
export TB_DEFER_WRITES="${TB_DEFER_WRITES:-1}"
# THE RETRIEVAL RUNG THIS SWEEP RUNS AT — owner decision 2026-08-04, made on a
# measurement rather than a preference: `max` costs 374 s per brain_search on
# the local 12B versus 0.5 s at `think`, so a full sweep at max blows the
# playbook's own >12 h STOP guardrail, and a Terminal-Bench task that runs out
# of wall-clock scores 0 no matter how good its retrieval was. `think` still
# carries the reason-then-rank judge (the rung above plain recall); `max` is
# measured SEPARATELY on a task subset so the claim exists without gating the
# headline. The proxy's own default is `max` — this line is what makes the
# sweep's rung explicit in its config instead of implied, and
# check-terransoul-used.sh reports the rung actually observed on the wire so a
# think run can never be published as a max one.
export TB_THINKING_MODE="${TB_THINKING_MODE:-think}"

# REFUSE TO RUN TWICE. On 2026-08-04 a `pkill -f run-sweep.sh` silently failed
# under Git Bash, a second sweep was launched on top of the first, and the two
# fought over the proxy port — `EADDRINUSE 0.0.0.0:7425`, then 10/10 trials
# errored with AgentSetupTimeoutError / NonZeroAgentExitCodeError. The run
# looked like a capability failure and was pure self-collision. Also enforces
# rules/bench-resource-discipline.md: ONE bench at a time.
# A PID LOCKFILE, not command-line matching. The first attempt at this guard
# grepped process command lines for "run-sweep.sh" and immediately false-
# positived on its OWN launching shell — the wrapper that starts the sweep
# necessarily contains the script's name, as does any editor or agent shell
# that typed it. A lockfile tests the only thing that matters: is a previous
# sweep's process still alive?
LOCK="$REPO/mcp-data/.tb-sweep.lock"
if [ -z "${TB_FORCE:-}" ] && [ -f "$LOCK" ]; then
  oldpid="$(tr -dc '0-9' < "$LOCK")"
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    echo "sweep already running as pid $oldpid (lock: $LOCK)." >&2
    echo "stop it first, or set TB_FORCE=1 if you are certain it is dead." >&2
    exit 4
  fi
  echo "[sweep] clearing stale lock from dead pid ${oldpid:-?}"
fi
echo "$$" > "$LOCK"
cleanup_lock() { rm -f "$LOCK"; }
trap cleanup_lock EXIT INT TERM
# A stale listener on the proxy port is the other half of the same failure.
if netstat -ano 2>/dev/null | grep -q ":${TB_PROXY_PORT:-7425}.*LISTENING"; then
  echo "port ${TB_PROXY_PORT:-7425} is already in use — a previous proxy is still alive. Stop it first." >&2
  exit 4
fi

STATE="$REPO/mcp-data/.tb-sweep-state.txt"   # gitignored; one completed task id per line
# One line per ERRORED attempt, so a task that keeps erroring is bounded rather
# than retried forever across resumes. Deliberately NOT truncated with $STATE:
# the attempt history has to survive the resume that consults it.
RETRIES="$REPO/mcp-data/.tb-sweep-retries.txt"
# The report's "accepted failures" list. merge-sweep.sh READS this file and
# checkpoint.sh archives it, but until 2026-08-05 NOTHING WROTE IT — the three
# entries it held had been added by hand, so the report's provenance line was
# only as good as somebody's memory. It is informational, not arithmetic: the
# merge counts an errored trial as 0.0 from result.json whether or not the task
# is named here, so a stale file understated the list without ever moving the
# number. Writing it here makes the report self-maintaining.
ACCEPTED="$REPO/mcp-data/.tb-sweep-accepted-failures.txt"
touch "$RETRIES" 2>/dev/null || true
touch "$STATE"
# A fresh run truncates BOTH ledgers. Previously only $STATE was cleared, so a new
# campaign inherited the old retry counts and previously-flaky tasks started with
# their retry budget already spent.
[ "${TB_RESUME:-0}" = "1" ] || : > "$STATE"
[ "${TB_RESUME:-0}" = "1" ] || : > "$RETRIES"

# Task list: directories under tasks/, excluding non-task entries.
mapfile -t ALL < <(find "$TB21_DIR/tasks" -maxdepth 1 -mindepth 1 -type d -printf '%f\n' | sort)
[ "${#ALL[@]}" -gt 0 ] || { echo "no tasks found under $TB21_DIR/tasks" >&2; exit 2; }

TODO=()
for t in "${ALL[@]}"; do
  grep -qxF "$t" "$STATE" 2>/dev/null || TODO+=("$t")
done

export TB_JOB_PREFIX="${TB_JOB_PREFIX:-sweep$(date +%m%d%H%M)}"
echo "[sweep] job prefix: $TB_JOB_PREFIX"
# Every restart mints a new prefix and the merge reads a prefix LIST. Appending
# here is what stops a resumed campaign publishing a number computed from one
# restart out of six.
echo "$TB_JOB_PREFIX" >> "$REPO/mcp-data/.tb-sweep-prefixes.txt"
sort -u -o "$REPO/mcp-data/.tb-sweep-prefixes.txt" "$REPO/mcp-data/.tb-sweep-prefixes.txt"
echo "[sweep] merge this run with: bash merge-sweep.sh jobs $TB_JOB_PREFIX"
echo "[sweep] $(( ${#ALL[@]} )) tasks total, ${#TODO[@]} to run, batch=$BATCH, attempts=$TB_ATTEMPTS, concurrency=$TB_CONCURRENCY"
echo "[sweep] mode=$TB_PROXY_MODE  (learn = isolated brain :7424, writes limited to lesson ingest)"

# Refresh CLAUDE_CODE_OAUTH_TOKEN from the host's live Claude Code credentials.
# The host CLI refreshes these on its own; we simply snapshot the current access
# token before each batch so no batch ever starts near expiry.
# RETRY, because this now runs once per TASK rather than once per batch.
#
# Measured 2026-08-05: the sweep died at 38/89 with "no usable credential" while
# the host credential had 479.8 MINUTES of headroom, a live refreshToken and a
# max subscription — i.e. nothing was wrong with the credential at all. The
# read simply failed once (the Claude CLI rewrites ~/.claude/.credentials.json
# under itself, so a read can catch it mid-write and JSON.parse throws).
#
# Per-batch that was a 9-in-a-run gamble; per-task it is ~89, and a single
# transient loss aborted the WHOLE sweep. Three attempts with a pause turns a
# file-write race back into what it is — a retryable blip — while a genuinely
# expired credential still stops the run after the third try.
refresh_token() {
  local attempt
  for attempt in 1 2 3; do
    if _refresh_token_once; then return 0; fi
    [ "$attempt" -lt 3 ] && { echo "[sweep] credential read failed (attempt $attempt/3) — retrying in 5s" >&2; sleep 5; }
  done
  return 1
}

_refresh_token_once() {
  node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const p=path.join(os.homedir(),".claude",".credentials.json");
const o=JSON.parse(fs.readFileSync(p,"utf8")).claudeAiOauth;
const mins=(o.expiresAt-Date.now())/60000;
if(mins<10){console.error("token has "+mins.toFixed(0)+" min left — refusing to start a batch");process.exit(1)}
fs.writeFileSync(process.argv[1],"CLAUDE_CODE_OAUTH_TOKEN="+o.accessToken+"\n");
console.log("[sweep] token refreshed, "+mins.toFixed(0)+" min of headroom");
' "$REPO/mcp-data/.tb-token.env"
}

# Did the most recently written job error? `run-dg.sh` exits 0 for a FAILED
# trial (a failed trial is a valid result), so its exit code cannot distinguish
# "the agent could not solve it" from "the run broke". Only result.json can.
last_job_errored() {
  local newest
  newest="$(ls -1dt "$HERE/jobs"/*/ 2>/dev/null | head -1)"
  [ -n "$newest" ] && [ -f "$newest/result.json" ] || return 1
  python -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)          # unreadable -> do not claim it errored
s=d.get('stats',{})
n=s.get('n_errored_trials') or 0
for ev in (s.get('evals') or {}).values():
    n += ev.get('n_errors') or 0
sys.exit(0 if n else 1)
" "$newest/result.json" 2>/dev/null
}

# Is the newest job's error TERMINAL — i.e. will retrying reproduce it?
#
# MEASURED, not assumed about a vendor's taxonomy (which is why the first
# version of the retry bound deliberately refused to classify by name):
#   extract-moves-from-video  AgentTimeoutError 31m43s -> retry 31m48s
#   caffe-cifar-10            42m -> 1h06 -> 1h02, never once succeeding
# A timeout retry costs another FULL timeout and returns the same answer. Over
# the 7 timeout tasks seen so far that is hours of budget bought nothing.
#
# `AgentTimeoutError` is the agent running out of time: a legitimate 0.0 that
# reproduces. `UnknownApiError` / `AgentSetupTimeoutError` are the run breaking
# around the agent, and those DO recover on a retry — one of them already did.
# So terminal errors are accepted immediately; everything else keeps the bound.
TERMINAL_ERRORS="${TB_TERMINAL_ERRORS:-AgentTimeoutError}"

# Did the newest job hit a rate limit? Appeared 2026-08-05 as `ApiRateLimitError`
# on two consecutive jobs — the sweep is competing with the owner's own usage on
# one Max subscription, and hammering straight into a 429 wastes a whole task
# slot. Retrying it is correct (it is transient, unlike a timeout), but retrying
# it IMMEDIATELY just re-hits the limit, so the retry gets a cooldown first.
last_job_hit_rate_limit() {
  local newest
  newest="$(ls -1dt "$HERE/jobs"/*/ 2>/dev/null | head -1)"
  [ -n "$newest" ] && [ -f "$newest/result.json" ] || return 1
  grep -q "RateLimit" "$newest/result.json" 2>/dev/null
}
# Does the newest job dir actually belong to THIS task? Every `last_job_*`
# helper resolves "newest job dir", which is only the current task's job while
# the current task produced one. When run-dg.sh dies in preflight it creates no
# job at all, so "newest" silently becomes the PREVIOUS task's job — and
# classifying task B from task A's result.json is how an infrastructure outage
# gets published as a capability failure. Trial dirs are named `<task>__<suffix>`,
# so the task id is recoverable from disk without trusting the job name.
last_job_is_for_task() {
  local newest
  newest="$(ls -1dt "$HERE/jobs"/*/ 2>/dev/null | head -1)"
  [ -n "$newest" ] || return 1
  ls -1d "$newest/$1"__* >/dev/null 2>&1
}
last_job_error_is_terminal() {
  local newest
  newest="$(ls -1dt "$HERE/jobs"/*/ 2>/dev/null | head -1)"
  [ -n "$newest" ] && [ -f "$newest/result.json" ] || return 1
  TB_TERMINAL="$TERMINAL_ERRORS" python -c "
import json,os,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
terminal=set(os.environ.get('TB_TERMINAL','').split())
names=set()
for ev in ((d.get('stats') or {}).get('evals') or {}).values():
    names.update((ev.get('exception_stats') or {}).keys())
# Terminal only when we saw exceptions AND every one of them is terminal —
# a mixed job still deserves its retry.
sys.exit(0 if names and names <= terminal else 1)
" "$newest/result.json" 2>/dev/null
}

# Classify a task whose job produced an ERRORED result.json, and record it in
# every ledger. Assigns `batch_ok` in the caller's scope (bash is dynamically
# scoped) when the task still deserves a retry.
#
# Factored out because it now has TWO call sites: run-dg.sh exiting 0 with an
# errored trial inside, and run-dg.sh exiting non-zero. Those had drifted into
# very different behaviour — see the non-zero branch below for what that cost.
classify_errored_task() {
  local t="$1" attempts
  attempts="$(grep -c "^$t\$" "$RETRIES" 2>/dev/null | head -1 | tr -dc '0-9')"
  attempts="${attempts:-0}"
  echo "$t" >> "$RETRIES"
  attempts=$((attempts + 1))
  if last_job_error_is_terminal; then
    echo "$t" >> "$STATE"; echo "$t" >> "$ACCEPTED"
    echo "[sweep]   task $t ERRORED terminally (${TERMINAL_ERRORS}) — accepting as a failed trial (0.0); a retry reproduces it" >&2
  elif [ "$attempts" -ge "${TB_MAX_ATTEMPTS_PER_TASK:-2}" ]; then
    echo "$t" >> "$STATE"; echo "$t" >> "$ACCEPTED"
    echo "[sweep]   task $t ERRORED ${attempts}x — accepting it as a failed trial (0.0), not retrying again" >&2
  else
    batch_ok=0
    echo "[sweep]   task $t ERRORED (attempt ${attempts}; TB_RESUME=1 will retry it once more)" >&2
  fi
}

batch_no=0
failed_batches=0
for ((i=0; i<${#TODO[@]}; i+=BATCH)); do
  batch_no=$((batch_no+1))
  chunk=("${TODO[@]:i:BATCH}")
  echo
  echo "[sweep] ── batch $batch_no : ${#chunk[@]} task(s) ──────────────────────────"
  echo "[sweep]   ${chunk[*]}"

  if ! refresh_token; then
    echo "[sweep] STOPPING: no usable credential. Re-run with TB_RESUME=1 after refreshing." >&2
    exit 3
  fi

  # In deferred mode every task gets its OWN harbor job, because the deferral
  # boundary is the proxy's lifetime: lessons written while task X runs are
  # flushed when X's job ends, so X's own attempts never see them but every
  # later task does. Batching tasks into one job would let tasks in the same
  # batch feed each other's attempts — the leakage this exists to prevent.
  batch_ok=1
  # ONE JOB PER TASK is a separate concern from deferral, and conflating them
  # would silently void the attribution run: with TB_DEFER_WRITES=0 the old code
  # fell through to the BATCH branch (10 tasks x k attempts in ONE harbor job at
  # concurrency 4), where a task's attempts can overlap and attempt 1's lesson
  # does not exist when attempt 2 starts. The experiment would report "no uplift"
  # -- reading as "memory does not help" rather than "the harness never let it".
  if [ "${TB_ONE_JOB_PER_TASK:-${TB_DEFER_WRITES:-0}}" = "1" ]; then
    for t in "${chunk[@]}"; do
      # REFRESH PER TASK, not per batch. Measured 2026-08-05: the batch-level
      # refresh reported "88 min of headroom" and then ran TEN sequential jobs
      # of 4-42 min each. caffe-cifar-10 started at +52 min, ran 42 min, and
      # crossed the expiry mid-task — `UnknownApiError`, reward 0.0, $1.96 spent,
      # and every later task in the batch would have failed the same way. The
      # old comment ("so no batch ever starts near expiry") was true and beside
      # the point: what matters is where the batch ENDS. The host CLI keeps its
      # own credentials fresh, so this just re-snapshots the current access
      # token, and run-dg.sh re-reads the file per task.
      if ! refresh_token; then
        echo "[sweep] STOPPING mid-batch: no usable credential. Re-run with TB_RESUME=1." >&2
        exit 3
      fi
      echo "[sweep]   task $t (own job, deferred writes)"
      if TB_TASKS="$t" bash "$HERE/run-dg.sh" ""; then
        # An ERRORED trial is not a completed one. Marking it complete would
        # hide it from TB_RESUME=1 and leave its reward in the published mean —
        # the inflation the playbook already documents (an UnknownApiError trial
        # reporting mean 1.0). Re-check the job's own result.json.
        if last_job_errored; then
          # BOUNDED retry. d3d8e9e7 stopped errored trials being marked
          # complete, which was right — an errored trial marked complete is
          # hidden from the resume AND leaves its 0.0 in the mean. But it made
          # every error retryable forever, and the two error classes are not the
          # same thing: `UnknownApiError` means the run broke (retry), while
          # `AgentTimeoutError` means the AGENT ran out of time, which is a
          # legitimate 0.0 that will reproduce on every attempt.
          #
          # Measured: caffe-cifar-10 errored twice for two different reasons and
          # was starting a THIRD attempt at ~1 h and ~$1.50 each. Classifying by
          # exception NAME is guesswork about a vendor's error taxonomy, so this
          # bounds attempts instead: transient infrastructure recovers on the
          # retry, a genuinely-too-hard task stops burning the budget, and the
          # count is recorded so the report can say which tasks were accepted
          # as failures rather than solved.
          classify_errored_task "$t"
        else
          echo "$t" >> "$STATE"
        fi
        # Back off after a 429 regardless of how the task was classified, so the
        # NEXT task does not walk straight into the same limit.
        if last_job_hit_rate_limit; then
          pause="${TB_RATE_LIMIT_PAUSE_S:-600}"
          echo "[sweep]   rate limit hit — pausing ${pause}s before the next task" >&2
          sleep "$pause"
        fi
      else
        # run-dg.sh itself exited NON-ZERO. Before 2026-08-05 this branch did
        # only `batch_ok=0`, so the task landed in NO ledger at all: not $STATE,
        # not $RETRIES, not $ACCEPTED. Every piece of the errored-trial policy
        # above — bounded retries, terminal-error acceptance, the report list —
        # applied only when run-dg.sh happened to exit 0.
        #
        # MEASURED on train-fasttext: it burned its full 3600 s ceiling,
        # returned AgentTimeoutError (a TERMINAL class that reproduces on every
        # attempt), and left no trace. TB_RESUME=1 would have re-run it for
        # another hour and ~$2 to fail identically — and, because $RETRIES was
        # never written, its attempt counter still read 0, so the bound that
        # exists precisely to stop that could never engage.
        #
        # THE PUBLISHED NUMBER WAS NEVER AT RISK, and it matters to say so:
        # merge-sweep.sh globs result.json and scores an errored trial 0.0 in
        # the denominator regardless of any ledger (it read 84/89 with
        # train-fasttext correctly included). This is a cost and convergence
        # bug. Do not "fix" the merge.
        #
        # A non-zero exit has TWO causes and conflating them is the trap:
        #   * the job RAN and errored     -> result.json exists -> classify it
        #   * preflight died (no brain, no credential, docker down)
        #                                 -> no result.json     -> must retry
        # Scoring the second as 0.0 would publish an infrastructure outage as a
        # capability failure. `last_job_is_for_task` is what separates them:
        # without it, "newest job dir" is the PREVIOUS task's job whenever this
        # task never created one, and we would classify task B from task A.
        if last_job_is_for_task "$t" && last_job_errored; then
          classify_errored_task "$t"
        else
          batch_ok=0
          echo "[sweep]   task $t FAILED before producing a result (preflight/infra) — not scored; TB_RESUME=1 will retry it" >&2
        fi
      fi
    done
  elif TB_TASKS="${chunk[*]}" bash "$HERE/run-dg.sh" ""; then
    for t in "${chunk[@]}"; do echo "$t" >> "$STATE"; done
  else
    batch_ok=0
  fi

  if [ "$batch_ok" = "1" ]; then
    echo "[sweep]   batch $batch_no done"
  else
    failed_batches=$((failed_batches+1))
    echo "[sweep]   batch $batch_no FAILED — not marked complete; TB_RESUME=1 will retry it" >&2
  fi
done

echo
echo "[sweep] ══ merging ═══════════════════════════════════════════════════════"
bash "$HERE/merge-sweep.sh" "$HERE/jobs" "$TB_JOB_PREFIX"
echo "[sweep] batches failed: $failed_batches"
[ "$failed_batches" -eq 0 ]
