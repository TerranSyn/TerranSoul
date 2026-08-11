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
LOCK="${TB_LOCK:-$REPO/mcp-data/.tb-sweep.lock}"
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

STATE="${TB_STATE:-$REPO/mcp-data/.tb-sweep-state.txt}"   # gitignored; one completed task id per line
# One line per ERRORED attempt, so a task that keeps erroring is bounded rather
# than retried forever across resumes. Deliberately NOT truncated with $STATE:
# the attempt history has to survive the resume that consults it.
RETRIES="${TB_RETRIES:-$REPO/mcp-data/.tb-sweep-retries.txt}"
# The report's "accepted failures" list. merge-sweep.sh READS this file and
# checkpoint.sh archives it, but until 2026-08-05 NOTHING WROTE IT — the three
# entries it held had been added by hand, so the report's provenance line was
# only as good as somebody's memory. It is informational, not arithmetic: the
# merge counts an errored trial as 0.0 from result.json whether or not the task
# is named here, so a stale file understated the list without ever moving the
# number. Writing it here makes the report self-maintaining.
ACCEPTED="${TB_ACCEPTED:-$REPO/mcp-data/.tb-sweep-accepted-failures.txt}"
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
# Minutes of life left on the host credential, or the literal "unreadable".
_token_mins_left() {
  node -e '
const fs=require("fs"),os=require("os"),path=require("path");
try{
  const o=JSON.parse(fs.readFileSync(path.join(os.homedir(),".claude",".credentials.json"),"utf8")).claudeAiOauth;
  if(!o||!o.expiresAt) throw new Error("incomplete");
  console.log(((o.expiresAt-Date.now())/60000).toFixed(1));
}catch(e){ console.log("unreadable"); }
' 2>/dev/null || echo unreadable
}

# ⛔ THE ROTATION IS LAZY AND CLI-TRIGGERED. THE SWEEP MUST CAUSE IT.
#
# The host CLI does NOT refresh ~/.claude/.credentials.json on a timer. It
# refreshes when it is INVOKED and finds the token it holds has expired.
# Measured 2026-08-07 on this host, decisively:
#
#   at T-19min : `claude -p` succeeded, file mtime UNCHANGED, still 18 min left
#   at T+90s   : `claude -p` succeeded, file mtime CHANGED, 473 min left
#
# So a sweep that merely SLEEPS waiting for a rotation is waiting for something
# only it can trigger, and nothing will happen however long it waits.
#
# That turned the headroom gate into a deadlock. The gate wants 40 minutes of
# life; the old loop declared EXPIRED at T-40min and waited 120s x 5 = 10 min,
# reaching T-30min and giving up — never approaching the expiry at which a poke
# would have worked, and never poking. The run died at 35/89 reporting
# "credential EXPIRED and not rotated after 10 min" while `claude -p` on the
# same host worked perfectly, which sent the previous session chasing a
# non-existent auth failure and writing "do not chase the 7-hour OAuth token"
# into RESUME.md. The token was never the problem; the waiting was.
_poke_host_cli() {
  # Cheapest possible call: it exists to make the CLI notice an expired token
  # and exchange its refresh token, not to produce output.
  timeout 120 claude -p "ok" >/dev/null 2>&1 || true
}

refresh_token() {
  local attempt rc mins secs waited max_wait
  max_wait="${TB_TOKEN_WAIT_MAX_S:-3000}"     # 50 min: one expiry cycle, bounded
  waited=0
  # A TRANSIENT failure gets a long, patient retry budget: the host CLI rewrites
  # this file periodically and the unreadable window is short, so waiting is
  # strictly better than abandoning a run that may be hours in.
  for attempt in 1 2 3 4 5 6; do
    _refresh_token_once
    rc=$?
    [ "$rc" -eq 0 ] && return 0
    if [ "$rc" -eq 1 ]; then
      # BELOW THE HEADROOM GATE. Not necessarily expired — just too close to
      # expiry to safely start a task that may run 40 minutes.
      mins="$(_token_mins_left)"
      # 1. Poke first. If the token is ALREADY past expiry this rotates it now
      #    and costs one trivial API call.
      echo "[sweep] credential at ${mins} min — poking the host CLI to force a refresh (attempt $attempt/6)" >&2
      _poke_host_cli
      _refresh_token_once && return 0
      # 2. Still short, and the token is still alive: the CLI will not rotate
      #    until it actually expires, so wait for that moment and poke again.
      #    Bounded by the token's own remaining life, never open-ended.
      if [ "$mins" != "unreadable" ]; then
        secs="$(awk -v m="$mins" 'BEGIN{ s=(m*60)+45; if (s<45) s=45; printf "%d", s }')"
        if [ "$((waited + secs))" -le "$max_wait" ]; then
          echo "[sweep] waiting ${secs}s for the credential to reach expiry, then re-poking" >&2
          sleep "$secs"
          waited=$((waited + secs))
          _poke_host_cli
          _refresh_token_once && return 0
        fi
      fi
      if [ "$attempt" -lt 6 ]; then
        sleep 30
        continue
      fi
      echo "[sweep] credential still below the headroom gate after poking and waiting ${waited}s." >&2
      echo "[sweep] The host CLI refreshes only when INVOKED and only once the token has expired," >&2
      echo "[sweep] so if this persists the refresh token itself is dead: run 'claude setup-token'," >&2
      echo "[sweep] write it to mcp-data/.tb-token.env, and relaunch with TB_TOKEN_STATIC=1." >&2
      return 1
    fi
    [ "$attempt" -lt 6 ] && {
      echo "[sweep] credential unreadable (attempt $attempt/6) — retrying in 10s" >&2
      sleep 10
    }
  done
  echo "[sweep] credentials stayed unreadable for 60s — giving up this batch" >&2
  return 1
}

# Exit 1 = EXPIRED (a human must re-authenticate; retrying is pointless).
# Exit 2 = TRANSIENT (unreadable or half-written file; retrying is the fix).
#
# WHY THE DISTINCTION EXISTS: on 2026-08-06 the sweep halted a multi-hour run
# with "no usable credential" while the token had 479 MINUTES left. The
# credentials file was momentarily unreadable — almost certainly caught
# mid-write while the host CLI rotated it — and all three retries landed inside
# that window. Collapsing "expired" and "could not read just now" into one
# failure turned a blip into a stop, and the message sent the operator looking
# for an auth problem that did not exist.
_refresh_token_once() {
  # A LONG-LIVED TOKEN OPTS OUT OF REFRESHING. `claude setup-token` mints a
  # token that lasts ~a year, which is what this bench actually wants: the
  # 7-hour OAuth access token forces a stop every few hours, and on 2026-08-07
  # the host CLI stopped rotating it at all — `claude -p` kept working while
  # ~/.claude/.credentials.json sat unchanged for hours, so the sweep starved
  # on a file nothing was updating.
  #
  # With TB_TOKEN_STATIC=1 the sweep trusts $TOKEN_FILE and never overwrites it
  # from .credentials.json. Without this guard the refresh CLOBBERS the
  # long-lived token with a short-lived one on the very next cycle.
  if [ "${TB_TOKEN_STATIC:-0}" = "1" ]; then
    if [ -s "${TB_TOKEN_FILE:-$REPO/mcp-data/.tb-token.env}" ]; then
      return 0
    fi
    echo "[sweep] TB_TOKEN_STATIC=1 but the token file is empty — refusing to guess" >&2
    return 1
  fi
  node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const p=path.join(os.homedir(),".claude",".credentials.json");
let o;
try{
  o=JSON.parse(fs.readFileSync(p,"utf8")).claudeAiOauth;
  if(!o||!o.accessToken||!o.expiresAt) throw new Error("credentials present but incomplete");
}catch(e){
  // TRANSIENT: unreadable, mid-write, or momentarily malformed.
  console.error("[sweep] credentials unreadable ("+e.message+") — transient, will retry");
  process.exit(2);
}
const mins=(o.expiresAt-Date.now())/60000;
if(mins<40){
  console.error("[sweep] token has "+mins.toFixed(0)+" min left — EXPIRED, re-authenticate with: claude setup-token");
  process.exit(1);
}
// Write via a temp file + rename so a reader can never observe a half-written
// token — the same failure this function just suffered, one layer down.
const tmp=process.argv[1]+".tmp";
fs.writeFileSync(tmp,"CLAUDE_CODE_OAUTH_TOKEN="+o.accessToken+"\n");
fs.renameSync(tmp,process.argv[1]);
console.log("[sweep] token refreshed, "+mins.toFixed(0)+" min of headroom");
' "$REPO/mcp-data/.tb-token.env"
}

# Did the most recently written job error? `run-dg.sh` exits 0 for a FAILED
# trial (a failed trial is a valid result), so its exit code cannot distinguish
# "the agent could not solve it" from "the run broke". Only result.json can.
last_job_errored() {
  local newest
  newest="$(newest_job_dir)"
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
# Newest job dir BELONGING TO THIS WORKER.
#
# WHY THE PREFIX SCOPE IS LOAD-BEARING: every `last_job_*` helper used to take
# the globally-newest job dir. That is correct only while exactly one task runs
# at a time. With parallel workers the newest dir is very often ANOTHER
# worker's job, so a task would be classified from a different task's
# result.json -- silently, and in a way that looks like a flaky benchmark
# rather than a bug. Each worker sets a distinct TB_JOB_PREFIX, so scoping the
# glob to it makes these helpers race-free without a lock.
# ⛔ THIS MUST HONOUR TB_JOBS_DIR. It did not, and the consequence was silent
# and expensive.
#
# `run-dg.sh` writes to `${TB_JOBS_DIR:-$HERE/jobs}` (run-dg.sh:555, and its own
# comment at :675 records this exact defect being fixed there once already).
# This helper hardcoded `$HERE/jobs`. The submittable campaign sets
# TB_JOBS_DIR=jobs-submit, so EVERY `last_job_*` classifier built on this —
# rate-limit detection, errored-trial classification, and the "is this job even
# for the task I just ran" guard — was reading a DIFFERENT, older corpus
# (`jobs/`, left over from the k=1 and k=2 campaigns) instead of the job that
# had just finished.
#
# Measured on the 2026-08-07 campaign: `last_job_hit_rate_limit` never fired
# once across the entire run, so TB_RATE_LIMIT_PAUSE_S=900 was configured, paid
# for, and never applied — while 15 trials died of ApiRateLimitError. The
# backoff that exists to stop exactly that was reading a corpus that could not
# contain the evidence.
#
# The prefix filter is what makes this per-WORKER; without it a worker reads
# another worker's job. Both parts are load-bearing.
newest_job_dir() {
  ls -1dt "${TB_JOBS_DIR:-$HERE/jobs}/${TB_JOB_PREFIX:-}"*/ 2>/dev/null | head -1
}

# Build the outcome-feedback text handed to attempt N of $1, from the verifier
# scores of attempts 1..N-1 already on disk for this task and job prefix.
#
# This is the ONLY channel through which an agent can learn its own result: the
# verifier runs after the trial ends, so without this every attempt finishes
# believing it succeeded. See the OUTCOME FEEDBACK note at the call site.
#
# It reports SCORES, never content — no task name beyond the one the agent is
# already working on, no hint, no walkthrough. `rules/bench-agi-purity.md`
# forbids seeding answers, not telling an agent whether its work was accepted.
attempt_feedback_text() {  # $1 = task, $2 = attempt number about to run
  local task="$1" n="$2" dir
  dir="${TB_JOBS_DIR:-$HERE/jobs}"
  TASK="$task" ATTEMPT="$n" JOBS="$dir" PREFIX="${TB_JOB_PREFIX:-}" python - <<'PY'
import json, os, glob
task = os.environ["TASK"]; n = int(os.environ["ATTEMPT"])
jobs = os.environ["JOBS"]; pref = os.environ.get("PREFIX", "")


def searched_web(job_dir, tid):
    """Did this trial actually CALL WebSearch/WebFetch? Used to tell an attempt
    whether ANYONE has really escalated yet — see the escalation clause below.

    ⛔ MEASURED BUG, FIXED 2026-08-09. This used to regex the trajectory for the
    bare strings "WebSearch"/"WebFetch". Three things match that are NOT a web
    call: this very feedback text, which names both tools; a ToolSearch schema
    load (`"query": "select:WebSearch,WebFetch"`); and the `tool_reference`
    records that load returns. Cohort-wide it reported 34 escalating trials
    where only 8 had really called a web tool.

    The damage was DIRECTIONAL, not merely noisy. On filter-js-from-html the
    true count across 23 attempts is ZERO, yet 10 of those attempts were told
    "earlier attempt(s) DID consult external sources and still failed" — the
    branch that argues escalation is already exhausted. The runner spent that
    task's entire history suppressing the one behaviour it was built to
    provoke, which is why the escalation clause has never cleanly fired.

    Counts structured calls only: steps[].tool_calls[].function_name.
    """
    p = os.path.join(job_dir, tid, "agent", "trajectory.json")
    if not os.path.exists(p):
        hits = glob.glob(os.path.join(job_dir, "*", "agent", "trajectory.json"))
        p = next((h for h in hits
                  if os.path.basename(os.path.dirname(os.path.dirname(h))).lower()
                  == tid.lower()), "")
        if not p:
            return False
    try:
        with open(p, encoding="utf-8", errors="replace") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return False
    for step in (doc.get("steps") or []):
        for call in (step.get("tool_calls") or []):
            if isinstance(call, dict) and call.get("function_name") in ("WebSearch", "WebFetch"):
                return True
    return False


def reached_bench_material(job_dir, tid):
    """Did this trial's escalation land on the benchmark's OWN material?

    ⛔ WHY THE AGENT NEEDS THIS. Measured 2026-08-09 on filter-js-from-html: the
    escalation clause finally fired on attempt 26 — the first genuine web call
    in the task's history — and the query went straight at the benchmark itself
    (it quoted the task prompt's own distinctive wording and added the word
    "benchmark"). The trial was quarantined and scored 0.0.

    The boundary was already in the prompt and was ignored, which is what a
    purely advisory rule does under pressure. But the runner KNOWS a previous
    lookup was thrown out and never said so, so each attempt rediscovers the
    same shortcut and burns itself on it. Stating it converts a rule the agent
    can rationalise past into a reported consequence it has already paid.

    Shares one regex with integrity-scan.py rather than restating it — a second
    copy would drift, and the two disagreeing is how a contaminated trial gets
    scored as clean.
    """
    import importlib.util as _ilu
    scanner = os.path.join(os.environ.get("HERE", "."), "integrity-scan.py")
    if not os.path.exists(scanner):
        return False
    try:
        spec = _ilu.spec_from_file_location("integrity_scan", scanner)
        mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:
        return False
    p = os.path.join(job_dir, tid, "agent", "trajectory.json")
    if not os.path.exists(p):
        hits = glob.glob(os.path.join(job_dir, "*", "agent", "trajectory.json"))
        p = next((h for h in hits
                  if os.path.basename(os.path.dirname(os.path.dirname(h))).lower()
                  == tid.lower()), "")
        if not p:
            return False
    try:
        with open(p, encoding="utf-8", errors="replace") as fh:
            return bool(mod.BENCH_URL.search(fh.read()))
    except OSError:
        return False


def check_counts(job_dir, tid):
    """(passed, total) from the trial's own ctrf.json, or (None, None).

    ⛔ THIS IS THE FIX FOR THE CAMPAIGN'S DOMINANT FAILURE MODE. The runner knew
    only 'scored 0' and said only that, while every trial dir has carried
    verifier/ctrf.json with per-check results the whole time. Measured:
    `pytorch-model-cli` failed the SAME single check (test_cli_tool_output) on
    all SIX attempts while passing the other five every time, and 11 of 20
    failing trials across the cohort passed SOME checks invisibly. So each
    attempt re-derived deliverables that were already correct.

    COUNTS ONLY, NEVER TEST NAMES (owner decision 2026-08-08). A count is the
    runner's own verdict as a number -- the same class of fact as the score
    already passed. Names would encode WHAT is graded, which standard
    Terminal-Bench agents do not receive.
    """
    p = os.path.join(job_dir, tid, "verifier", "ctrf.json")
    if not os.path.exists(p):
        # harbor's trial dir name may differ in case from the id in result.json
        hits = glob.glob(os.path.join(job_dir, "*", "verifier", "ctrf.json"))
        p = next((h for h in hits
                  if os.path.basename(os.path.dirname(os.path.dirname(h))).lower()
                  == tid.lower()), "")
        if not p:
            return None, None
    try:
        tests = (json.load(open(p, encoding="utf-8", errors="replace"))
                 .get("results", {}).get("tests", []) or [])
    except Exception:
        return None, None
    if not tests:
        return None, None
    return sum(1 for t in tests if t.get("status") == "passed"), len(tests)


def check_status_map(job_dir, tid):
    """{check_id: passed?} for one trial — INTERNAL ONLY, never printed.

    Feeds the joint-satisfaction signal below. The check ids stay inside this
    process: what reaches the agent is whether every requirement has been met
    by SOME attempt, which is a fact about its own attempt history and names
    nothing. Same standard as check_counts — counts out, names never.
    """
    p = os.path.join(job_dir, tid, "verifier", "ctrf.json")
    if not os.path.exists(p):
        hits = glob.glob(os.path.join(job_dir, "*", "verifier", "ctrf.json"))
        p = next((h for h in hits
                  if os.path.basename(os.path.dirname(os.path.dirname(h))).lower()
                  == tid.lower()), "")
        if not p:
            return {}
    try:
        tests = (json.load(open(p, encoding="utf-8", errors="replace"))
                 .get("results", {}).get("tests", []) or [])
    except Exception:
        return {}
    return {t.get("name", "?"): t.get("status") == "passed" for t in tests}


scores = []
status_maps = []
for rj in sorted(glob.glob(os.path.join(jobs, pref + "*", "result.json")),
                 key=lambda p: os.path.getmtime(p)):
    try:
        d = json.load(open(rj, encoding="utf-8", errors="replace"))
    except Exception:
        continue
    job_dir = os.path.dirname(rj)
    for ev in ((d.get("stats") or {}).get("evals") or {}).values():
        bad = set()
        for _e, ids in (ev.get("exception_stats") or {}).items():
            bad.update(ids)
        for s, ids in ((ev.get("reward_stats") or {}).get("reward") or {}).items():
            for tid in ids:
                # Trial ids are `<task>__<suffix>`; harbor also writes a
                # `terminal-bench/<task>` form in some records.
                base = tid.rsplit("__", 1)[0].split("/")[-1]
                if base == task and tid not in bad:
                    try:
                        scores.append((float(s),) + check_counts(job_dir, tid)
                                      + (searched_web(job_dir, tid),
                                         reached_bench_material(job_dir, tid)))
                        status_maps.append(check_status_map(job_dir, tid))
                    except Exception:
                        pass
# Only attempts 1..n-1 precede this one. Without the cap a resumed or re-run
# task reports every trial ever recorded for it, so attempt 2 would claim five
# predecessors — wrong on its face and it would make the escalation fire on an
# attempt that has had no failures yet.
scores = scores[: max(0, n - 1)]
status_maps = status_maps[: max(0, n - 1)]
if not scores:
    print("This is your **first attempt** at this task. No earlier attempt has been scored.")
else:
    fails = sum(1 for s, _p, _t, _w, _q in scores if s < 1.0)
    searched_before = sum(1 for _s, _p, _t, w, _q in scores if w)
    tainted_before = sum(1 for _s, _p, _t, _w, q in scores if q)

    # ⛔ NAMES ARE NOW INCLUDED — owner decision 2026-08-09, reversing the
    # counts-only rule of 2026-08-08, on this measurement:
    #
    # Over one task's 28-attempt chain, two DIFFERENT approaches each solved a
    # DIFFERENT half. `BeautifulSoup + plain str(soup)` passed the fidelity
    # check 3 times out of 3 and never the security one; a custom-formatter
    # variant failed fidelity 7 of 7; a hand-rolled scanner scored 0 of 2 across
    # 14 attempts. Every attempt was told only "passed 1 of 2 checks", so it
    # could not tell WHICH half it already held — and threw the working half
    # away when it switched architecture. 14 architecture switches across 27
    # transitions; 75% of attempts re-chose a bucket an earlier attempt had
    # already scored 0 with.
    #
    # The lossiness ran all the way through: across 2.24 MB of brain_search
    # results returned to those 28 attempts, neither check name appears ONCE.
    # Memory recorded the aggregate "0-1/2" and nothing else, so the loop could
    # not have learned the decomposition even in principle.
    #
    # Why this is not answer-seeding: the task prompt already states both
    # requirements. Naming which one passed DECOMPOSES a score the agent
    # already receives; it reveals no threshold, no expected output and no
    # solution. Contrast the answer-key boundary further down, which stays.
    def render(rec, smap):
        s, p, t, _w, _q = rec
        if s >= 1.0:
            return "PASSED"
        if p is None:
            return "FAILED (scored 0)"
        base = f"FAILED — passed {p} of {t} checks"
        if not smap:
            return base
        ok = sorted(k.split("::")[-1] for k, v in smap.items() if v)
        bad = sorted(k.split("::")[-1] for k, v in smap.items() if not v)
        parts = []
        if ok:
            parts.append("passed: " + ", ".join(ok))
        if bad:
            parts.append("failed: " + ", ".join(bad))
        return base + " (" + "; ".join(parts) + ")" if parts else base

    shown = ", ".join(
        render(r, status_maps[i] if i < len(status_maps) else {})
        for i, r in enumerate(scores)
    )
    line = (f"You are on **attempt {n}** of this task. Earlier attempts were scored by the "
            f"task's own verifier: {shown}.")

    # The narrow-defect signal. When a failing attempt passed MOST checks, the
    # deliverables are already right and the agent's own verification is the
    # thing that is wrong -- which is exactly what it cannot discover from
    # inside the container. Measured across three tasks (pytorch-model-cli,
    # dna-insert, filter-js-from-html): memory, escalation and outcome feedback
    # all fired correctly and the task still failed, because nothing said WHICH
    # belief was false. Derived purely from the counts; names no test.
    partial = [(p, t) for s, p, t, _w, _q in scores if s < 1.0 and p is not None and t and p > 0]
    if partial:
        best_p, best_t = max(partial, key=lambda x: x[0] / x[1])
        if best_p >= best_t - 1 and best_t > 1:
            line += (f" **Note that {best_p} of {best_t} checks already PASS.** The defect is "
                     "narrow, and it is not where you have been looking: re-running your own "
                     "verification will keep agreeing with you. Your verification is not "
                     "measuring what the grader measures.")

    # THE JOINT-SATISFACTION SIGNAL. When every requirement has been met by SOME
    # attempt but never by ONE attempt, the task is provably achievable and the
    # remaining work is holding them together — a different problem from solving
    # either. Without this an attempt cannot tell "this requirement may be
    # impossible" from "you have already done this one, just not at the same
    # time", and it keeps re-litigating a settled half.
    #
    # MEASURED on filter-js-from-html across 28 attempts: the byte-identity
    # requirement was met by 3 attempts, the filtering requirement by 1, and
    # BOTH TOGETHER by none. Every attempt in that history was told only its own
    # total, so it read a partial score as "still broken" rather than "trading".
    #
    # Counts and quantifiers only: how many requirements exist, that each has
    # been met at least once, and that none met them all. No check is ever
    # named — the ids live in status_maps and never reach the text.
    if len(status_maps) >= 2:
        names = sorted({k for m in status_maps for k in m})
        if len(names) >= 2:
            ever = {k: any(m.get(k) for m in status_maps) for k in names}
            all_at_once = any(all(m.get(k) for k in names) for m in status_maps if m)
            if all(ever.values()) and not all_at_once:
                line += (f" **Each of the {len(names)} requirements has been satisfied by SOME "
                         "earlier attempt, but NO attempt has satisfied them all at once.** "
                         "Each is individually reachable; the open problem is holding them "
                         "together.")
                # ⛔ NO CAUSAL MODEL, AND BEWARE THE VACUOUS PASS. This used to
                # add "they pull against each other, and every attempt so far
                # has traded one away to buy another". MEASURED FALSE on the
                # task it was written for: the two checks are POSITIVELY
                # correlated on the grader's continuous metrics.
                #
                # Worse, the premise itself was an artefact. The single pass
                # this clause keyed on was VACUOUS — the grader printed "Total
                # batches to test: 0" and then "blocked all 439 XSS attack
                # vectors", so an empty loop satisfied the assertion. ctrf
                # records status only, so a check that exercised NOTHING is
                # indistinguishable here from one that genuinely passed, and
                # this clause promoted that phantom into "individually
                # reachable" for 17 attempts.
                #
                # Kept because "each has been met once" is still the runner's
                # own record, but the theory is gone and the caveat is stated.
                # A vacuity detector would have to read grader stdout, which is
                # task-specific — out of scope for a counts-only signal.

    # THE STUCK-DIMENSION SIGNAL. Consecutive attempts scoring the IDENTICAL
    # check counts means the changes being made are not touching what is graded.
    # Without this the agent cannot tell a substantive rewrite from a no-op: each
    # attempt looks fresh from inside, so it keeps varying the same irrelevant
    # dimension. MEASURED on pytorch-model-cli attempts 6-8, which rewrote the
    # tool each time (added resizing, a polarity guard, MNIST normalisation,
    # static linking) and produced BYTE-IDENTICAL grader output every time.
    #
    # Still counts-only: it reports that the numbers did not move, never which
    # check moved them. It is the runner's own record of its own scores.
    # THE REGRESSION SIGNAL. A count that went DOWN means the last change traded
    # one requirement away for another — the single most actionable fact
    # available, and it is invisible when it is merely one entry in a list.
    # MEASURED on filter-js-from-html, whose grader tests two properties in
    # tension (strip dangerous markup AND leave benign input byte-identical):
    # it reached 1 of 2 for the first time in the task's history, then dropped
    # back to 0 of 2 and stayed there, with nothing telling it that it had lost
    # ground it already held.
    #
    # Counts only: it says the number fell and what the best was, never which
    # check moved.
    graded = [(p, t) for s, p, t, _w, _q in scores if s < 1.0 and p is not None and t]
    if len(graded) >= 2:
        best_p, best_t = max(graded, key=lambda x: x[0] / x[1])
        last_p, last_t = graded[-1]
        if last_t == best_t and last_p < best_p:
            line += (f" **You have gone BACKWARDS: an earlier attempt passed {best_p} of {best_t}, "
                     f"your last passed {last_p}.** Recover the ground you held before trying "
                     "anything new.")
            # ⛔ NO CAUSAL MODEL. This used to continue: "Something you changed to
            # fix one requirement broke another you had already satisfied ...
            # assume the two pull against each other". That is a THEORY, not a
            # count, and on the task it was written for it was FALSE — measured
            # on the grader's own continuous metrics, the two checks are
            # POSITIVELY correlated, so worse on one means worse on the other.
            # The theory was injected into 13 attempts as if it were a finding.
            #
            # A score can fall for many reasons — a rewrite, a crash, a timeout,
            # or a grader that never ran. Report the fall; let the agent
            # diagnose it. Everything else here is counts-only for exactly this
            # reason, and this line had drifted out of that discipline.

    tail = [(p, t) for s, p, t, _w, _q in scores if s < 1.0 and p is not None]
    if len(tail) >= 3 and len(set(tail[-3:])) == 1:
        line += (" **Your last three attempts scored EXACTLY the same checks.** Whatever you "
                 "changed between them is not what is being graded — a fourth variation of the "
                 "same idea will score the same. Change the part you have been treating as "
                 "already correct.")

    if fails >= 2:
        line += (" **Two or more attempts have now failed** — your own knowledge and the "
                 "memory have both proved insufficient here, so consult external sources "
                 "before writing another solution. Read about the SHAPE of the problem; "
                 "never retrieve this benchmark's own solution, tests, thresholds or "
                 "reference outputs — a result obtained that way is discarded.")
        # WHETHER ANYONE ACTUALLY WENT AND LOOKED. An attempt cannot see what
        # its predecessors did, so "consult external sources" reads as new
        # advice every time and gets dropped once it fails once. The runner CAN
        # see it, from the trajectories it already stores.
        #
        # RE-MEASURED 2026-08-09 with the corrected detector above; the earlier
        # figures in this comment (dna-insert "6 and 8 calls") were that
        # detector's false positives and are withdrawn. Cohort truth: 8 of 479
        # trials ever called a web tool, 25 calls in total. dna-insert really
        # escalated on three trials (1, 2 and 2 calls). Escalation is rare
        # rather than unsustained — and on filter-js-from-html, the task this
        # clause was written for, it has never happened at all.
        # A DISCARDED lookup is not the same as no lookup, and it is the single
        # fact most likely to stop the next attempt repeating it. MEASURED
        # 2026-08-09: filter-js-from-html's first real escalation in 26 attempts
        # went at the benchmark itself and was quarantined to 0.0. Saying so
        # turns a rule the agent can rationalise past into a cost it has paid.
        if tainted_before:
            line += (f" **{tainted_before} earlier attempt(s) DID look outside and had the "
                     "result DISCARDED for reaching this benchmark's own material** — that "
                     "trial scored zero no matter what it wrote. Searching for this task, its "
                     "prompt wording, or its expected output is a dead end that has already "
                     "been paid for. Look up the general TECHNIQUE instead: the problem domain, "
                     "the format, the standard approaches — never this task's own instance.")
        elif searched_before == 0:
            line += (" **No previous attempt has consulted external sources at all** — that "
                     "advice has been given and not taken. Take it this time.")
        else:
            line += (f" **{searched_before} earlier attempt(s) DID consult external sources and "
                     "still failed**, so the answer is not sitting in the obvious external "
                     "material. Either search for something you have not thought to ask, or "
                     "turn the scrutiny on an assumption you have never questioned.")
    elif fails == 1:
        line += (" The previous attempt was WRONG. Whatever it concluded, some part of it "
                 "does not hold — find which part before repeating its approach.")
    print(line)
PY
}

last_job_hit_rate_limit() {
  local newest
  newest="$(newest_job_dir)"
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
  newest="$(newest_job_dir)"
  [ -n "$newest" ] || return 1
  ls -1d "$newest/$1"__* >/dev/null 2>&1
}
last_job_error_is_terminal() {
  local newest
  newest="$(newest_job_dir)"
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
      # ── OUTCOME FEEDBACK: run attempts ONE AT A TIME so the harness can tell
      #    each one how the previous one scored.
      #
      # WHY. `harbor run -k 5` runs all five attempts INSIDE one job, so nothing
      # can intervene between them and the agent never learns its own verdict —
      # the verifier runs after each trial ends. Measured on `dna-insert`: five
      # attempts, five near-duplicate lessons all about environment setup, none
      # recording that the attempt FAILED, and web use declining (1,1,1,0,0)
      # instead of escalating. Attempt 5 knew exactly as much as attempt 1.
      #
      # Splitting into k single-attempt jobs costs one extra harbor startup per
      # attempt (~2 s of environment build, already measured as the cheapest
      # phase at a 2 s median) and buys the only feedback channel that exists.
      # TB_ATTEMPT_FEEDBACK=0 restores the single-job behaviour.
      if [ "${TB_ATTEMPT_FEEDBACK:-1}" = "1" ] && [ "${TB_ATTEMPTS:-1}" -gt 1 ] 2>/dev/null; then
        _want="$TB_ATTEMPTS"; _ok=0; _prior=""
        for _a in $(seq 1 "$_want"); do
          if [ "$_a" -gt 1 ]; then
            _prior="$(attempt_feedback_text "$t" "$_a")"
            echo "[sweep]     attempt $_a/$_want — feeding back: $(echo "$_prior" | head -c 90)..."
          fi
          if TB_TASKS="$t" TB_ATTEMPTS=1 TB_PRIOR_OUTCOMES="$_prior" \
             bash "$HERE/run-dg.sh" ""; then _ok=1; else _ok=0; fi
          # Stop early only on a HARD driver failure; a scored 0.0 is exactly the
          # case the remaining attempts exist to improve on.
          [ "$_ok" = "1" ] || break
        done
        [ "$_ok" = "1" ]
      else
        TB_TASKS="$t" bash "$HERE/run-dg.sh" ""
      fi
      if [ "$?" -eq 0 ]; then
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
bash "$HERE/merge-sweep.sh" "${TB_JOBS_DIR:-$HERE/jobs}" "$TB_JOB_PREFIX"
echo "[sweep] batches failed: $failed_batches"
[ "$failed_batches" -eq 0 ]
