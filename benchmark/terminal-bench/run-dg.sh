#!/usr/bin/env bash
# D-G: Claude Code inside the task container, TerranSoul attached as an MCP
# brain on the host. See rules/tbench-playbook.md — this script IS that
# playbook's "The run" section, with the credential read from a file so the
# token never lands in a shell history, a process listing or a transcript.
#
# Usage:
#   ./run-dg.sh                 # one task (fix-git), the integration proof
#   ./run-dg.sh '' 5            # first 5 tasks, for the cost probe
#   ./run-dg.sh some-task-id    # a specific task
set -euo pipefail

# Harbor renders its tables with U+2713 / U+2717. Without these the Windows
# console codepage raises UnicodeEncodeError and the command dies BEFORE
# running anything — a crash that looks like a harness bug and is purely
# encoding.
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# `${1-fix-git}` NOT `${1:-fix-git}`. The colon form substitutes the default for
# an EMPTY argument too, so the documented `./run-dg.sh '' 5` silently became
# `-i fix-git -l 5` and ran ONE task while reporting itself as a 5-task probe
# (job dg-20260804-174333). Without the colon, an explicitly-empty first arg
# stays empty and means "all tasks".
TASK="${1-fix-git}"
LIMIT="${2:-}"

# The three staged runs the playbook authorises, expressed as env knobs rather
# than three near-duplicate scripts:
#
#   proof   ./run-dg.sh                                  # fix-git, 1 attempt
#   probe   ./run-dg.sh '' 5                              # 5 tasks, 1 attempt
#   sweep   TB_ATTEMPTS=5 TB_CONCURRENCY=4 ./run-dg.sh '' # all 89 x 5
#
# CONCURRENCY is trials in flight inside ONE harbor job — it is not extra bench
# terminals, so it does not conflict with the <=5 concurrent-bench cap in
# rules/bench-resource-discipline.md. Keep it modest anyway: every trial is a
# container, and this machine's D: drive is already the measured bottleneck
# (see scripts/check-cargo-contention.mjs).
ATTEMPTS="${TB_ATTEMPTS:-1}"
CONCURRENCY="${TB_CONCURRENCY:-1}"

TB21_DIR="${TB21_DIR:-/d/Git/terminal-bench-2-1}"
[ -d "$TB21_DIR/tasks" ] || { echo "TB21_DIR=$TB21_DIR has no tasks/ subdir" >&2; exit 2; }

# `harbor` is a `uv` tool and is NOT on PATH in backgrounded shells — this
# silently produced exit 127 twice. Resolve it once, explicitly.
HARBOR="$(command -v harbor || echo "$HOME/.local/bin/harbor")"
"$HARBOR" --version >/dev/null || { echo "harbor did not resolve" >&2; exit 2; }

# TB_PROXY_MODE=learn routes the bench at an ISOLATED brain (default :7424,
# mcp-data-tbench/) rather than the production one on :7423. Cross-trial
# learning means the benchmark WRITES, and a benchmark must never mutate the
# brain the product actually uses — so learn mode changes the UPSTREAM, not
# merely the permission.
BRAIN_PORT="${TB_BRAIN_PORT:-7423}"
BRAIN_DATA="${TB_BRAIN_DATA:-$REPO/mcp-data}"
if [ "${TB_PROXY_MODE:-}" = "learn" ]; then
  BRAIN_PORT="${TB_BRAIN_PORT:-7424}"
  BRAIN_DATA="${TB_BRAIN_DATA:-$REPO/mcp-data-tbench}"
  echo "[run-dg] LEARN MODE — isolated brain :$BRAIN_PORT ($BRAIN_DATA); production brain untouched"
fi

# The brain must answer before the container tries to reach it through the
# proxy, or every brain_* tool call fails inside the trial and the run silently
# measures plain Claude Code.
health_body="$(curl -s -m 5 -w '\n%{http_code}' "http://127.0.0.1:$BRAIN_PORT/health" || true)"
code="$(printf '%s' "$health_body" | tail -n1)"
[ "$code" = "200" ] || { echo "brain not healthy on :$BRAIN_PORT (got '$code'); run: node scripts/copilot-start-mcp.mjs" >&2; exit 2; }

# The body was previously fetched and thrown away. Keep `memory_total` from it:
# it is the cheapest BRAIN-SIDE witness that a learning run actually stored
# something, and it costs nothing extra — this request already happens.
brain_memory_total() {
  curl -s -m 8 "http://127.0.0.1:$BRAIN_PORT/health" 2>/dev/null \
    | python -c "import json,sys
try: print(json.load(sys.stdin).get('memory_total',''))
except Exception: print('')" 2>/dev/null || true
}

brain_pending_embed() {
  curl -s -m 8 "http://127.0.0.1:$BRAIN_PORT/health" 2>/dev/null \
    | python -c "import json,sys
try: print(json.load(sys.stdin).get('rag_quality',{}).get('pending_embedding_count',''))
except Exception: print('')" 2>/dev/null || true
}

# A LESSON THAT IS NOT EMBEDDED YET IS NOT RETRIEVABLE. Measured 2026-08-04 on
# the bench brain, same store and same queries, only time differing:
#
#   15 s after the write (pending>0) : the lesson missed even a query containing
#                                      its OWN literal phrase
#   after the backfill  (pending==0) : rank 1, on both that phrase AND a
#                                      paraphrase
#
# That is the whole cross-task-learning claim. With TB_DEFER_WRITES the lessons
# land at job END and run-sweep starts the next job seconds later, so without
# this wait task N+1 queries a brain that cannot yet see what task N learned —
# and the run would report "N lessons flushed" while the learning was inert.
# Same failure family as the instrumentation bugs: a step that reports success
# before the effect exists.
wait_for_embeddings() {  # $1 = label, $2 = max seconds
  local label="$1" max="${2:-900}" waited=0 pending
  pending="$(brain_pending_embed)"
  [ -z "$pending" ] && { echo "[run-dg] $label: embed backlog unknown (health unreadable) — continuing"; return 0; }
  [ "$pending" = "0" ] && { echo "[run-dg] $label: brain fully embedded (0 pending)"; return 0; }
  echo "[run-dg] $label: waiting for $pending pending embedding(s) — retrieval is degraded until this is 0"
  while [ "${pending:-0}" != "0" ] && [ "$waited" -lt "$max" ]; do
    sleep 10; waited=$((waited + 10))
    pending="$(brain_pending_embed)"
    [ $((waited % 60)) -eq 0 ] && echo "[run-dg]   ${waited}s: $pending still pending"
  done
  if [ "${pending:-0}" = "0" ]; then
    echo "[run-dg] $label: embedded after ${waited}s"
  else
    echo "[run-dg] $label: *** STILL $pending PENDING after ${max}s — retrieval is degraded, say so in the report. ***"
  fi
}
MEM_BEFORE="$(printf '%s' "$health_body" | head -n-1 | python -c "import json,sys
try: print(json.load(sys.stdin).get('memory_total',''))
except Exception: print('')" 2>/dev/null || true)"
echo "[run-dg] brain memory_total before the run: ${MEM_BEFORE:-<unavailable>}"
# A freshly reseeded store starts at rag 0% with every row queued. Starting a
# trial there measures keyword-only retrieval and calls it TerranSoul — the
# same shape as the LONGMEM_EMBED=1 regression, where a "retrieval regression"
# was really the dense channel being switched off.
wait_for_embeddings "preflight" "${TB_EMBED_WAIT_S:-1800}"

# RENDER the agent instruction against the rung ACTUALLY configured.
#
# Measured cost of getting this wrong, 2026-08-04: the file was written while
# `max` was the plan and said "expect a search to take minutes, not
# milliseconds". The sweep then moved to `think` (~0.5 s), and the first task
# wrote two lessons and ran ZERO searches — the instruction was describing a
# 100x cost that did not exist and discouraging the exact behaviour the bench
# exists to measure. A static file describing a configurable setting drifts the
# moment the setting changes, so it is templated and rendered per run instead.
INSTRUCTION_FILE="$(mktemp -t tb-instruction-XXXXXX.md)"
# `think`, matching the proxy default and run-sweep.sh's explicit export.
# Owner 2026-08-05: "use TerranSoul thinking mode set to think, not max" —
# max costs ~374 s per search versus ~1 s, and on a wall-clock-bounded
# benchmark a timeout scores 0 regardless of retrieval quality.
_rung="${TB_THINKING_MODE:-think}"
case "$_rung" in
  chat)     _cost="Searches are fast (sub-second). Consult memory whenever it might help." ;;
  think)    _cost="Searches are fast — well under a second, plus a reasoning pass over the candidates. Consult memory whenever it might help; the cost is not a reason to skip it." ;;
  research) _cost="**A search takes several seconds** — it runs sub-queries and a completeness critic. Worth it when the answer matters; do not poll it." ;;
  max)      _cost="**A search can take minutes, not milliseconds** — it adds claim-level verification on top of deep recall. That is the setting, not a hang. Search when memory would genuinely help; do not poll it." ;;
  *)        _cost="Searches run at the server default. Consult memory when it might help." ;;
esac
# ── WALL-CLOCK BUDGET: the timeout root cause ───────────────────────────────
# Measured across this campaign: 9 of 89 tasks score 0 purely on wall clock,
# and the trajectories show WHY. `train-fasttext` burned five ~600 s blocks —
# ~48 of its 56 minutes — discovering the per-call tool timeout by HITTING it,
# and said so in its own words after the first: "Tool timeout capped at 10min;
# running the sweep detached instead." It then did it four more times.
#
# The agent already knows the PER-CALL cap — Claude Code's Bash tool states
# max 600000 ms in its own schema. What it has never been told is the TASK
# budget, and without that the two facts cannot be combined: a 10-minute
# blocking wait is cheap inside a 3600 s task and catastrophic inside a 900 s
# one, and 48 of 89 tasks here are 900 s. This is `budget as an observable`
# from docs/terminal-bench-submission-plan.md (TB-4a).
#
# PURITY: `timeout_sec` is a property of the RUNNER, not of the problem. It
# carries no task name, no hint, no domain vocabulary and nothing about how to
# solve anything — the same class of fact as the OS or the CPU count. Telling
# an agent how long it has is what any real product does;
# rules/bench-agi-purity.md forbids seeding ANSWERS, not describing the
# environment.
_budget=""
_first_task="$(echo "${TB_TASKS:-${TASK:-}}" | awk '{print $1}')"
if [ -n "$_first_task" ] && [ -f "$TB21_DIR/tasks/$_first_task/task.toml" ]; then
  _sec="$(grep -m1 -oE 'timeout_sec[[:space:]]*=[[:space:]]*[0-9.]+' \
          "$TB21_DIR/tasks/$_first_task/task.toml" 2>/dev/null | grep -oE '[0-9.]+' | head -1)"
  _sec="${_sec%%.*}"
  if [ -n "$_sec" ] && [ "$_sec" -gt 0 ] 2>/dev/null; then
    _budget="You have about **$(( _sec / 60 )) minutes of wall-clock** for this task, after which it is scored as-is. A single blocking tool call can consume up to 10 minutes of that, so before running something that might be slow, decide whether you can afford to sit and wait for it — and if not, start it in the background and poll, rather than discovering the limit by hitting it."
  fi
fi
[ -n "$_budget" ] || _budget="Work efficiently: a task that runs out of wall-clock is scored as-is."

# The deferral note MUST match the actual setting. It was hardcoded to the
# defer=1 wording — "writes are held until the task finishes, so they return no
# id and are not searchable yet" — which is FALSE under defer=0, where writes
# land immediately and DO return ids. Telling an agent it has no id is a
# plausible reason it then calls brain_append without one, and both rejected
# memory calls in this campaign were exactly that error.
if [ "${TB_DEFER_WRITES:-0}" = "1" ]; then
  _defer_note="**One real constraint, so you don't waste a call on it:** writes you make during this task are held until the task finishes, so they return no id and are not searchable yet. You can therefore append to and link entries from *previous* tasks, but not to something you wrote a moment ago in this one. That is deliberate — it stops one attempt at a task from feeding another."
else
  _defer_note="**Writes land immediately:** each one returns the new entry's id and is searchable straight away, so you can append to, link, or re-find something you wrote earlier in this same task."
fi

# ── OUTCOME FEEDBACK: the missing half of the self-improvement loop ─────────
#
# THE DEFECT THIS CLOSES. The agent never learned whether it succeeded. The
# verifier runs AFTER the trial ends, so every attempt finished believing it had
# solved the task, and wrote its lesson in that voice.
#
# Measured on `dna-insert`, 5 attempts, all scoring 0.0:
#   att1..att5  search=1  ingest=1  append=0  — five NEAR-DUPLICATE lessons,
#   every one of them about environment setup ("oligotm is not preinstalled but
#   `apt-get install -y primer3` works"), and NOT ONE recording that the attempt
#   failed or why. Attempt 2 inherited the easy knowledge — which it would have
#   rediscovered in a single command — and repeated the substantive mistake.
#   Five times. Web use DECLINED across the attempts (1,1,1,0,0) instead of
#   escalating, because nothing told the agent it was getting anything wrong.
#
# It also made "consult external sources when you are stuck" unimplementable:
# an agent in a fresh container cannot know it is attempt 3 of a failing task.
#
# So the harness now tells it. `TB_PRIOR_OUTCOMES` carries the previous
# attempts' verifier scores for THIS task, produced by run-sweep.par.sh between
# single-attempt jobs.
#
# PURITY: this reports the RUNNER's own verdict on prior attempts — a score and
# whether one occurred. It carries no task name, no hint, no walkthrough and
# nothing about how to solve anything. It is the same class of fact as the
# wall-clock budget above: describing the environment, not seeding an answer.
# A product that never tells an agent whether its work was accepted is the
# anomaly here; rules/bench-agi-purity.md forbids seeding ANSWERS.
_prior="${TB_PRIOR_OUTCOMES:-}"
if [ -z "$_prior" ]; then
  _prior="This is your **first attempt** at this task. No earlier attempt has been scored."
fi

sed -e "s/{{THINKING_MODE}}/$_rung/g" -e "s|{{THINKING_MODE_COST}}|$_cost|g" \
    -e "s|{{TASK_BUDGET}}|$_budget|g" -e "s|{{DEFERRAL_NOTE}}|$_defer_note|g" \
    -e "s|{{PRIOR_ATTEMPTS}}|$_prior|g" \
  "$HERE/extra-instruction.md" > "$INSTRUCTION_FILE"
# Fail CLOSED: an unrendered placeholder reaching the agent is a silent
# instruction bug, which is how the previous one survived a whole task.
if grep -q '{{' "$INSTRUCTION_FILE"; then
  echo "[run-dg] unrendered placeholder in the agent instruction — refusing to run" >&2
  grep -n '{{' "$INSTRUCTION_FILE" >&2
  exit 2
fi
echo "[run-dg] agent instruction rendered for thinking_mode='$_rung'"

# Credential FIRST, before anything is started or written. OWNER DECISION
# 2026-08-04: subscription OAuth token rather than a metered API key; the
# accepted risk is recorded in the playbook. Minted by the owner with
# `claude setup-token` — an interactive browser flow, so no agent can produce
# it. Checked up here so a missing token cannot leave a listening proxy behind.
TOKEN_FILE="${TB_TOKEN_FILE:-$REPO/mcp-data/.tb-token.env}"
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  :
elif [ -s "$TOKEN_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$TOKEN_FILE"; set +a
else
  echo "no credential: set CLAUDE_CODE_OAUTH_TOKEN or write $TOKEN_FILE" >&2
  exit 2
fi
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "$TOKEN_FILE did not define CLAUDE_CODE_OAUTH_TOKEN" >&2; exit 2; }

# --- MCP auth: the gate that stops a silent zero-brain run --------------------
#
# /health is OPEN but /mcp is NOT. Measured 2026-08-04: an unauthenticated
# POST to /mcp returns
#     {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"unauthorized"}}
# with HTTP 401, while the same POST carrying `Authorization: Bearer <token>`
# returns 200 and the full tools list.
#
# The committed terransoul.mcp.json used to carry NO auth header at all. That
# does not fail the run — Claude Code simply comes up without the brain tools,
# solves the task on its own, and the trial produces a perfectly plausible
# score. It is precisely the failure rules/tbench-playbook.md warns about:
# "A pass with zero MCP calls is Claude Code's score with TerranSoul as
# decoration." Checking /health alone would never have caught it, because
# /health answers 200 for everyone.
#
# So: render the config with the real token (no reliance on the container
# expanding ${...}), and PROVE the token works before spending anything.
MCP_TOKEN_FILE="${TERRANSOUL_MCP_TOKEN_FILE:-$BRAIN_DATA/mcp-token.txt}"
[ -s "$MCP_TOKEN_FILE" ] || { echo "no MCP token at $MCP_TOKEN_FILE; start the brain via node scripts/copilot-start-mcp.mjs" >&2; exit 2; }
TERRANSOUL_MCP_TOKEN="$(tr -d '\r\n' < "$MCP_TOKEN_FILE")"

mcp_code="$(curl -s -m 8 -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:$BRAIN_PORT/mcp" \
  -H "Authorization: Bearer $TERRANSOUL_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' || true)"
[ "$mcp_code" = "200" ] || { echo "MCP tools/list returned $mcp_code with the token from $MCP_TOKEN_FILE — refusing to run, the trial would score plain Claude Code" >&2; exit 2; }

# --- the header-injecting proxy -----------------------------------------------
#
# Harbor CANNOT deliver an auth header to the container: its
# claude_code.py::_build_register_mcp_servers_command emits exactly
# {"type", "url"} for http servers and silently drops `headers` (and carries no
# `env` for stdio). TerranSoul's router accepts ONLY a bearer header. So the
# container talks to this proxy instead, and the proxy adds the header on the
# host side — the real token never enters the container.
#
# The proxy blocks write tools by default (TB-3: "0 brain writes during a
# 5-task run"). TB_PROXY_ALLOW_WRITES=1 lifts that, and then the run is NOT a
# clean measurement.
PROXY_PORT="${TB_PROXY_PORT:-7425}"
# ⛔ PER-WORKER PATH. This was ONE shared file for every worker, TRUNCATED at
# the start of every task (`: > "$PROXY_LOG"`), and it silently corrupted the
# campaign's decisive attribution evidence.
#
# With N parallel workers: worker A truncates the log while worker B is
# mid-task; both proxies then append to the same file; and at task end each
# worker runs check-terransoul-used.sh against it and copies it into ITS OWN
# job dir as terransoul-proxy-calls.jsonl. So witness 3 — the one the playbook
# calls DECISIVE, and the only evidence that the brain was genuinely used —
# counted other workers' calls and lost its own to truncation.
#
# MEASURED 2026-08-06, and it disagreed with the raw logs in BOTH directions:
#   worker 0 witness "6 accepted, 1 refused"  <- its own log had 0 refusals
#   worker 2 witnesses "0 refused" (x3)       <- its own log HAD the refusal
# It also produced a false finding — a task appeared to make ZERO brain calls,
# which reads exactly like "the agent ignored memory" (the failure mode the
# playbook warns about as "TerranSoul as decoration") when it was really
# another worker truncating the file mid-task.
#
# The proxy port is already unique per worker, so it is the natural
# discriminator — same fix as MCP_CONFIG above, same root assumption.
PROXY_LOG="$REPO/mcp-data/.tb-proxy-calls-$PROXY_PORT.jsonl"
: > "$PROXY_LOG"

TERRANSOUL_MCP_TOKEN="$TERRANSOUL_MCP_TOKEN" \
TB_PROXY_PORT="$PROXY_PORT" \
TB_PROXY_LOG="$PROXY_LOG" \
TB_PROXY_MODE="${TB_PROXY_MODE:-}" \
TB_DEFER_WRITES="${TB_DEFER_WRITES:-}" \
TB_PROXY_UPSTREAM_PORT="$BRAIN_PORT" \
  node "$HERE/mcp-auth-proxy.mjs" &
PROXY_PID=$!

# FLUSH BEFORE KILLING THE PROXY, ON EVERY EXIT PATH.
#
# THE BUG THIS FIXES, measured 2026-08-05 over this campaign's own log: 98
# flushes across 119 task runs — 21 runs (18%) never flushed at all, and every
# lesson they had written was lost.
#
# Mechanism: this script runs `set -euo pipefail` (line 11), and the explicit
# flush sits AFTER the harbor invocation. When harbor exits non-zero, `set -e`
# terminates the script before reaching it, and the old trap only killed the
# proxy. Deferred writes live in the proxy until `__flush`, so killing it
# unflushed discards them silently — the run still reports its trial result, so
# nothing looks wrong.
#
# WHY IT IS THE WORST POSSIBLE 18%: harbor exits non-zero on errored and
# timed-out tasks, which are precisely the runs whose lessons are worth most.
# `train-fasttext` burned 5 blocks of ~600s rediscovering that the tool timeout
# is capped at 10 minutes, called brain_ingest_lesson once, and the lesson died
# with the script — so the NEXT task rediscovered the same cap from scratch.
# The self-improvement loop was losing exactly the failures it exists to learn
# from, which is why a headline "100% of tasks wrote a lesson" was measuring
# CALLS ISSUED (intent) rather than WRITES PERSISTED (effect).
#
# The trap is the safety net; the explicit post-harbor flush stays because it
# also waits for embeddings (a lesson that exists but is not embedded is not yet
# retrievable). Flushing twice is harmless — the second returns flushed:0.
_flush_deferred_on_exit() {
  local rc=$?
  # DISARM FIRST. Without this the handler re-enters itself: it ends in
  # `return $rc`, and a non-zero return from an EXIT trap under `set -e`
  # re-triggers EXIT. Caught by flush-on-failure.test.sh, which observed one
  # `rc=1` followed by an unbounded run of `rc=0` rescues — in production that
  # is a log flood and a hang on a curl-per-iteration.
  trap - EXIT INT TERM
  if [ "${TB_DEFER_WRITES:-}" = "1" ] && [ -n "${PROXY_PORT:-}" ]; then
    local out
    out="$(curl -s -m 60 -X POST "http://127.0.0.1:$PROXY_PORT/__flush" 2>/dev/null || true)"
    # Only announce when something was actually rescued, so the success path
    # (already flushed) stays quiet instead of printing a misleading second line.
    case "$out" in
      *'"flushed":0'*|'') : ;;
      *) echo "[run-dg] LATE FLUSH on exit rc=$rc — rescued deferred lessons: $out" >&2 ;;
    esac
  fi
  kill "${PROXY_PID:-0}" 2>/dev/null || true
  # The rendered instruction file is a per-task mktemp and nothing reaped it:
  # 93 `tb-instruction-*.md` were found in /tmp after ~180 trials. Individually
  # ~0.8 MB total, so this is hygiene rather than a disk risk — but it is the
  # kind of leak that is invisible until a long sweep makes it large, and the
  # EXIT trap is the only path that runs on BOTH the success and the harbor-
  # non-zero exit (see the flush rationale above). Deleted last so a failure
  # here can never cost a deferred lesson.
  rm -f "${INSTRUCTION_FILE:-}" 2>/dev/null || true
  return $rc
}
trap _flush_deferred_on_exit EXIT INT TERM

# Do not race the run against a proxy that has not bound yet.
for _ in $(seq 1 20); do
  if curl -s -m 2 -o /dev/null -X POST "http://127.0.0.1:$PROXY_PORT/mcp" \
      -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'; then
    break
  fi
  sleep 0.5
done
proxy_code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PROXY_PORT/mcp" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' || true)"
[ "$proxy_code" = "200" ] || { echo "proxy on :$PROXY_PORT returned $proxy_code — refusing to run" >&2; exit 2; }
echo "[run-dg] MCP auth proxy up on :$PROXY_PORT (pid $PROXY_PID)"

# The template already points at the proxy port and carries no headers, since
# harbor would drop them. Copied rather than rendered — nothing secret in it.
# PER-PORT PATH, NOT A SHARED ONE. This was `$REPO/mcp-data/.tb-mcp.json` for
# every worker, and the file's whole purpose is to carry THIS worker's proxy
# port — so N workers raced to overwrite one file with N different ports. The
# damage is quiet and it corrupts the measurement rather than crashing: a
# container can be handed another worker's port, so its brain calls land in the
# wrong proxy log (mis-attributing the `check-terransoul-used` witnesses), and
# when that other worker's task ends it tears down the proxy the first
# container is still using — brain access disappears mid-task. The proxy port
# is already unique per worker (7425+w), so it is the natural discriminator.
MCP_CONFIG="$REPO/mcp-data/.tb-mcp-$PROXY_PORT.json"
sed "s|host.docker.internal:7425|host.docker.internal:$PROXY_PORT|" "$HERE/terransoul.mcp.json" > "$MCP_CONFIG"


# Reap leftover containers from a previous run — but ONLY for the tasks THIS
# invocation is about to run.
#
# ⛔ THE UNSCOPED VERSION SABOTAGED EVERY PARALLEL SWEEP. It was
#     docker ps -a --format '{{.Names}}' | grep -E 'env-main' | xargs -r docker rm -f
# which is correct for ONE sequential runner and catastrophic for N workers:
# every worker runs this at the start of every task, so worker B force-removed
# worker A's LIVE container. The victim died with SIGKILL, which harbor reports
# as `NonZeroAgentExitCodeError: Command failed (exit 137)` from inside
# _setup_agent — indistinguishable, in the result.json, from the container
# running out of memory.
#
# MEASURED 2026-08-06, and it cost a whole diagnosis before the cause was found:
#   * 40 k=2 trials died this way; errors tracked WORKER COUNT, not any one
#     worker (15/9/8/8 across four) because each worker kills the others;
#   * the victims died 5s, 7s and 38s into setup — far too fast for either a
#     timeout or gradual growth into the 2 GiB cap;
#   * `dmesg` in the docker-desktop distro showed ZERO OOM records, and
#     `docker stats` showed live containers at 40-94 MiB against their 2 GiB
#     limit. Nothing was ever out of memory.
# The 2048 MB cap is declared per task in `task.toml [environment] memory_mb`
# and is part of the benchmark spec — it is NOT ours to raise
# (rules/bench-agi-purity.md), and it was never the problem.
#
# Scoping by task name is safe because a container is named
# `<task>__<trialid>__env-main-1`: a worker only ever reaps the tasks it owns,
# and shards never overlap.
_reap_stale_containers() {
  local wanted="${TB_TASKS:-${TASK:-}}"
  if [ -z "$wanted" ]; then
    # Whole-suite run (no -i): there is by definition no other worker to
    # damage, so the original blanket reap is correct here.
    docker ps -a --format '{{.Names}}' | grep -E 'env-main' \
      | xargs -r docker rm -f >/dev/null 2>&1 || true
    return
  fi
  local pat="" t
  for t in $wanted; do pat="${pat:+$pat|}^${t}__"; done
  docker ps -a --format '{{.Names}}' | grep -E 'env-main' | grep -E "$pat" \
    | xargs -r docker rm -f >/dev/null 2>&1 || true
  _reap_stale_networks "$pat"
}

# ⛔ NETWORKS LEAK TOO, AND THE FAILURE IS A HARD STOP FOR THE WHOLE HOST.
# Every trial creates a bridge network `<task>__<trialid>__env_default` and
# nothing removed them. Docker's DEFAULT pool is base 172.17.0.0/12 at size 16,
# i.e. only ~16 networks, so a sweep exhausts it and then EVERY task dies at
# `docker compose up` with:
#     failed to create network ...: all predefined address pools have been
#     fully subnetted
# Measured 2026-08-06: 28 of the host's 32 networks were orphaned `__env`
# leftovers, and the sweep could not start a single task. This is worse than
# the container leak — a stale container wastes disk, an exhausted address pool
# stops all Docker work on the machine, including other projects.
#
# Two independent guards, because either alone is fragile: this reap (scoped by
# task name, exactly like the container reap above, so parallel workers never
# touch each other's live networks), plus a widened pool in the daemon config
# (~/.docker/daemon.json default-address-pools 172.17.0.0/12 at size 24 = 4096
# networks) so a burst cannot exhaust it between reaps.
_reap_stale_networks() {
  local pat="$1"
  [ -n "$pat" ] || return 0
  # `docker network rm` refuses a network that is still attached to a running
  # container, so this cannot disturb a live trial even if the pattern were
  # ever widened. Failures are ignored for exactly that reason.
  # ⚠️ THE TRAILING `|| true` IS LOAD-BEARING, not defensive noise. `grep` exits
  # 1 when it matches NOTHING, and this script runs `set -euo pipefail`, so on
  # the normal path — no leftover networks — the pipeline returns 1 and takes
  # the whole run down. It fails SILENTLY: run-dg dies between "MCP auth proxy
  # up" and "job=", printing nothing, and the sweep reports the task as
  # "FAILED before producing a result (preflight/infra)". Measured on three
  # tasks in a row before the cause was found. This is the same trap
  # check-terransoul-used.sh already documents for `grep -c`.
  docker network ls --format '{{.Name}}' 2>/dev/null | grep -E '__env' \
    | grep -E "$pat" | while read -r n; do
      docker network rm "$n" >/dev/null 2>&1 || true
    done || true
  # A GLOBAL orphan sweep is deliberately NOT done here. It would race exactly
  # like the container reap did: between `compose up` creating a network and
  # attaching its container there is a window in which the network has zero
  # containers and looks like an orphan to a sibling worker. Scoped reap plus
  # the widened pool is the race-free combination.
  #
  # Make the remaining headroom VISIBLE instead, so exhaustion can never again
  # present as an unexplained wall of task failures (it cost a full diagnosis
  # once). Report only when it actually matters.
  local n_net
  n_net="$(docker network ls --format '{{.Name}}' 2>/dev/null | grep -c '__env' || true)"
  if [ "${n_net:-0}" -gt 200 ]; then
    echo "[run-dg] WARNING: $n_net leftover '__env' networks. Docker's pool is" >&2
    echo "[run-dg]          finite; if 'all predefined address pools have been" >&2
    echo "[run-dg]          fully subnetted' appears, clear them with:" >&2
    echo "[run-dg]            docker network ls --format '{{.Name}}' | grep __env | xargs -r -n1 docker network rm" >&2
  fi
}
_reap_stale_containers

# TB_JOB_PREFIX lets a sweep tag every job it creates so merge-sweep.sh can
# select exactly that run. jobs/ accumulates probes and aborted runs, and a
# Windows file lock made moving the directory aside impossible — filtering by
# name is more robust than relocating files.
JOB="${TB_JOB_PREFIX:-dg}-$(date +%Y%m%d-%H%M%S)"

# -p must point at the tasks/ SUBDIRECTORY. Resolving by dataset name instead
# pulls `terminal-bench-core`, a DIFFERENT and partly contaminated benchmark
# that runs cleanly and scores plausibly.
# -m claude-opus-5 is Opus 5. `claude-opus-4-5` is Opus 4.5 and was passed by
# mistake once; it is a different model.
# ── DATASET PROVENANCE, and why `-p` is not submittable ─────────────────────
# `-p <path>` runs the tasks but stamps each trial with
#     task: { type: "local", source: "tasks", path: "D:\\...\\tasks\\<task>" }
# The leaderboard's CI selects trials with `t["source"] == DATASET`, where
# DATASET is the registry name `terminal-bench/terminal-bench-2-1`
# (leaderboard/src/leaderboard/core/hub.py). A local run therefore contributes
# ZERO trials to a submission — the filter drops every one, and the submission
# is empty rather than wrong, which is the failure mode least likely to be
# noticed.
#
# Verified 2026-08-06 before switching: the pinned ref resolves to exactly the
# same 89 tasks, and all 89 task.toml files are byte-identical to this repo's
# local clone once CRLF is normalised (the clone has CRLF, the registry LF).
# So the measurements taken via `-p` were on the right content; only their
# provenance was untaggable.
#
# The playbook's warning about `-d` stands but is narrower than it reads: a
# BARE dataset name resolves to `terminal-bench-core`, a different and partly
# contaminated benchmark. A pinned `org/name@sha256:...` does not.
#   TB_DATASET unset -> -p <local path>   (fast local iteration, NOT submittable)
#   TB_DATASET set   -> -d <name@ref>     (registry provenance, submittable)
if [ -n "${TB_DATASET:-}" ]; then
  DATASET_ARGS=(-d "$TB_DATASET")
  echo "[run-dg] dataset: REGISTRY $TB_DATASET (submittable provenance)"
else
  DATASET_ARGS=(-p "$TB21_DIR/tasks")
  echo "[run-dg] dataset: local path (fast iteration; NOT submittable)"
fi

# ── AGENT IDENTITY ───────────────────────────────────────────────────────────
# Harbor records the trial's agent from the literal `-a` string (it lands in
# config.agents[].name and lock.json verbatim; overriding BaseAgent.name() does
# NOT change it — verified by probe). The leaderboard builds a row's identity
# from that string, so a run launched as `claude-code` becomes a Claude Code row.
#
# A custom agent is loaded by IMPORT PATH, and harbor runs from its own uv-tool
# venv which has no idea this repo exists. Without $HERE on PYTHONPATH the run
# dies at agent construction with a bare ModuleNotFoundError, which the sweep
# reports only as "FAILED before producing a result (preflight/infra)" — the
# same opaque symptom the namespaced-task-name bug produced.
if [ -n "${TB_AGENT:-}" ] && [ "${TB_AGENT}" != "claude-code" ]; then
  export PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}"
fi
#
# TB_AGENT unset -> claude-code                (local iteration; matches upstream)
# TB_AGENT set   -> a custom import path, e.g. "terransoul:TerranSoul"
#                   (owner decision 2026-08-06 — see terransoul.py, which also
#                    records the playbook rule this overrides). The raw key is
#                    mapped to a readable name via the leaderboard's
#                    display-names.json, which SUBMIT.md is explicit is the
#                    place to do that.
# ⛔ THE MODEL IS THE PROVENANCE OF THE NUMBER. It was hardcoded here, so
# switching models required editing this file — which cannot be done while a
# sweep runs (bash reads scripts lazily), and which leaves no record in the run
# of what was actually used. `TB_MODEL` makes it a launch parameter that the
# `.tb-parN.launch` record carries, so a relaunched worker cannot silently
# change models mid-campaign.
#
# The default stays `claude-opus-5` deliberately: every trial in `jobs-submit/`
# was produced by it, and a default that drifted would make an existing corpus
# ambiguous about its own provenance.
#
# ⚠️ NEVER MIX MODELS IN ONE JOBS DIR. `merge-sweep.sh` takes the best trial per
# task, so a directory holding both models yields a score attributable to
# neither — and one that flatters whichever model happened to win each task.
# Give each model its own TB_JOBS_DIR (e.g. jobs-submit/ for Opus 5,
# jobs-sonnet5/ for Sonnet 5) and publish them as separate entries.
#
# Model ids are exact: `claude-opus-5`, `claude-sonnet-5`. `claude-opus-4-5` is
# Opus 4.5 and was passed by mistake once; it is a different model.
args=(
  run
  -a "${TB_AGENT:-claude-code}"
  -m "${TB_MODEL:-claude-opus-5}"
  "${DATASET_ARGS[@]}"
  --env docker
  --mcp-config "$MCP_CONFIG"
  -o "${TB_JOBS_DIR:-$HERE/jobs}" --job-name "$JOB"
  -k "$ATTEMPTS" -n "$CONCURRENCY" -y
  # ── Harbor Hub upload ──────────────────────────────────────────────────────
  # A submission requires the job AND EVERY TRIAL to be publicly readable on
  # Harbor Hub, so the reward-hacking judge can audit them. That makes upload a
  # hard requirement for the submittable arm — and a PERMANENT, INDEXED action
  # for everything else, which is why the default is OFF and `--public` needs a
  # second, differently-spelled opt-in (R1 in the submission plan: "never
  # --upload --public before TB-11").
  #
  # ATIF is NOT built here and never was: harbor's own claude-code adapter sets
  # SUPPORTS_ATIF = True (agents/installed/claude_code.py:33) and every trial we
  # have already run carries agent/trajectory.json at schema_version ATIF-v1.7
  # (126 files, 0 unparseable, 0 zero-step, verified 2026-08-05). Do not write an
  # emitter; verify the files instead.
  #
  #   TB_UPLOAD unset / 0  -> no upload            (default; local only)
  #   TB_UPLOAD=1          -> --upload --private   (exercise the flow, nothing indexed)
  #   TB_UPLOAD=public     -> --upload --public    (the submission itself)
)
case "${TB_UPLOAD:-0}" in
  0|"")   : ;;
  1)      args+=(--upload --private)
          echo "[run-dg] Harbor Hub: uploading PRIVATE (flow exercise, not indexed)" ;;
  public) args+=(--upload --public)
          echo "[run-dg] ⚠ Harbor Hub: uploading PUBLIC — permanent and indexed, incl. every trajectory" ;;
  *)      echo "[run-dg] TB_UPLOAD='$TB_UPLOAD' is not one of 0|1|public — refusing to guess" >&2
          exit 2 ;;
esac

# ── Claude Code reasoning effort ────────────────────────────────────────────
# UNSET FOR THE ENTIRE k=1 CAMPAIGN (89 tasks, $174.54) — harbor's claude-code
# adapter exposes `reasoning_effort` as `--effort` with choices
# low|medium|high|xhigh|max|ultracode (agents/installed/claude_code.py:49), and
# we passed neither it nor its CLAUDE_CODE_EFFORT_LEVEL fallback, so every trial
# ran at the CLI default. Owner decision 2026-08-05: run the k=2..5 campaign at
# `ultracode`.
#
# ⚠️ EFFORT MUST BE CONSTANT ACROSS ATTEMPTS WITHIN A RUN. The attribution
# design makes attempt 1 the control and attempts 2..k the treatment, with
# MEMORY as the only difference. Setting effort per-attempt would confound the
# two and the run would measure "memory + effort" while reporting it as memory.
# This is a per-RUN setting for exactly that reason.
#
# Consequence to state in any report: the k=1 number (0.8315, default effort) and
# the k>=2 numbers are NOT directly comparable. Within the k>=2 run the paired
# attempt-1-vs-attempt-2+ comparison stays valid, because effort is held fixed.
case "${TB_EFFORT:-}" in
  "")  : ;;   # default: pass nothing, reproducing the k=1 configuration
  low|medium|high|xhigh|max|ultracode)
       args+=(--ak "reasoning_effort=$TB_EFFORT")
       echo "[run-dg] reasoning effort: $TB_EFFORT (k=1 ran at the CLI default — not comparable)" ;;
  *)   echo "[run-dg] TB_EFFORT='$TB_EFFORT' is not one of low|medium|high|xhigh|max|ultracode — refusing to guess" >&2
       exit 2 ;;
esac
args+=(
  # Without this the agent never calls the brain: job dg-20260804-160416 passed
  # fix-git with reward 1.0 and ZERO brain calls, because nothing in a
  # Terminal-Bench instruction points at memory. Task-agnostic by construction —
  # see the design note inside the file and rules/bench-agi-purity.md.
  --extra-instruction-path "$INSTRUCTION_FILE"
  --ae "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN"
  # MEASURED 2026-08-04, and the reason these are not left at their defaults:
  # a `brain_search` at thinking_mode=max took 374 s against the tray
  # (thinking_mode=think took 0.5 s). Claude Code's default MCP tool timeout is
  # well under that, so with max pinned (TB_THINKING_MODE, see the proxy) every
  # brain call would abort client-side and the run would look like a brain
  # failure rather than a latency cost.
  --ae "MCP_TIMEOUT=${TB_MCP_TIMEOUT:-120000}"
  --ae "MCP_TOOL_TIMEOUT=${TB_MCP_TOOL_TIMEOUT:-900000}"
)
# NOTE: the MCP token is deliberately NOT passed into the container. The proxy
# adds it host-side, so the brain credential never enters an environment that
# runs untrusted benchmark code. That is the whole point of the proxy.
# TB_TASKS: space-separated task ids, one -i each. Used by run-sweep.sh to run
# the benchmark in batches that each fit inside the OAuth token's lifetime.
# ⚠️ REGISTRY TASK NAMES ARE NAMESPACED, LOCAL ONES ARE NOT. A local `-p` run
# lists task DIRECTORIES, so the filter is a bare `fix-git`. The registry names
# the same task `terminal-bench/fix-git`, and an unprefixed filter matches
# nothing:
#     ValueError: No tasks matched the filter(s) ['fix-git'].
#                 There are 89 tasks available in this dataset.
# Harbor raises that inside Job.create, which the sweep reports only as
# "FAILED before producing a result (preflight/infra)" — so every task fails
# identically and the real message is buried in a stack trace. Caught on the
# first probe of the submittable arm; without the probe it would have been 445
# trials of nothing.
_task_filter() {
  if [ -n "${TB_DATASET:-}" ]; then
    # org prefix from the dataset spec: "terminal-bench/terminal-bench-2-1@..."
    printf '%s/%s' "${TB_DATASET%%/*}" "$1"
  else
    printf '%s' "$1"
  fi
}
if [ -n "${TB_TASKS:-}" ]; then
  for t in $TB_TASKS; do args+=(-i "$(_task_filter "$t")"); done
elif [ -n "$TASK" ]; then
  args+=(-i "$(_task_filter "$TASK")")
fi
[ -n "$LIMIT" ] && args+=(-l "$LIMIT")

echo "[run-dg] job=$JOB tasks=${TB_TASKS:-${TASK:-<all>}} attempts=$ATTEMPTS concurrency=$CONCURRENCY defer=${TB_DEFER_WRITES:-0}"
echo "[run-dg] credential: CLAUDE_CODE_OAUTH_TOKEN (${#CLAUDE_CODE_OAUTH_TOKEN} chars, not echoed)"
"$HARBOR" "${args[@]}"

# Flush deferred lessons NOW, while the proxy is still up and we can see the
# result. The EXIT trap only kills it, and on Windows that hard-terminates node
# without running any handler — the first version lost every deferred lesson
# that way (deferred-writes.test.sh pins it).
if [ "${TB_DEFER_WRITES:-}" = "1" ]; then
  flushed="$(curl -s -m 120 -X POST "http://127.0.0.1:$PROXY_PORT/__flush" || true)"
  echo "[run-dg] deferred lessons flushed: ${flushed:-<no response>}"
  # The flush only makes the lesson EXIST. It becomes RETRIEVABLE when it is
  # embedded — see wait_for_embeddings. The next task in the sweep starts
  # seconds from here, so this wait is what turns "wrote a lesson" into
  # "the next task can actually find it".
  wait_for_embeddings "post-flush" "${TB_EMBED_WAIT_S:-1800}"
fi

# Must honour TB_JOBS_DIR exactly as the -o flag above does. It did not, and the
# result was a run that SUCCEEDED being reported as "NO result.json — the run did
# not get far enough to produce one": the reporting looked in $HERE/jobs while
# harbor had written to $TB_JOBS_DIR. A false failure report on a passing trial
# is worse than a crash, because the natural next step is to debug the run rather
# than the reporter.
JOB_DIR="${TB_JOBS_DIR:-$HERE/jobs}/$JOB"

echo
echo "[run-dg] ── question 1: did the task pass? ──────────────────────────────"
echo "[run-dg] READ result.json, NEVER THE EXIT CODE. harbor exits 0 on a FAILED"
echo "[run-dg] trial, because a failed trial is a valid result. Reading exit 0 as"
echo "[run-dg] success once reported a 1h48m timeout as a pass."
if [ -f "$JOB_DIR/result.json" ]; then
  # ⚠️ AN ERRORED TRIAL STILL CONTRIBUTES TO `mean`. Measured on job
  # dg-20260804-161447: the agent died with UnknownApiError (expired token)
  # and the SAME trial reported metrics [{'mean': 1.0}] with
  # exception_stats {'UnknownApiError': [...]}. The verifier ran regardless and
  # wrote reward 1. So `mean` alone is NOT the score — across 445 trials a few
  # transient API errors are near-certain, and reading the headline number
  # without n_errors silently inflates it. This is the same family as
  # "harbor exits 0 on a FAILED trial", one level deeper.
  python -c "
import json,sys
d=json.load(open(sys.argv[1])); s=d.get('stats',{})
comp,err = s.get('n_completed_trials'), s.get('n_errored_trials')
print('[run-dg]   trials completed:',comp,' errored:',err)
print('[run-dg]   evals:',json.dumps(s.get('evals',{}),indent=2)[:1200])
print('[run-dg]   cost_usd:',s.get('cost_usd'))
if err:
    print('[run-dg]')
    print('[run-dg]   *** %s TRIAL(S) ERRORED — THE MEAN ABOVE INCLUDES THEM. ***' % err)
    print('[run-dg]   An errored trial still contributes its reward (measured: an')
    print('[run-dg]   UnknownApiError trial reported mean 1.0). Do NOT publish this')
    print('[run-dg]   number until the errored trials are re-run or excluded, and')
    print('[run-dg]   say which you did.')
" "$JOB_DIR/result.json" 2>/dev/null \
    || echo "[run-dg]   (could not parse; read $JOB_DIR/result.json by hand)"
else
  echo "[run-dg]   NO result.json at $JOB_DIR — the run did not get far enough to produce one."
fi

echo
echo "[run-dg] ── question 2: did TerranSoul actually get used? ───────────────"
# Taken AFTER the deferred flush above, so a deferred-write run is measured on
# lessons that actually landed rather than on lessons that were merely buffered.
MEM_AFTER="$(brain_memory_total)"
bash "$HERE/check-terransoul-used.sh" "$JOB_DIR" "$PROXY_LOG" "$MEM_BEFORE" "$MEM_AFTER" || true

cp "$PROXY_LOG" "$JOB_DIR/terransoul-proxy-calls.jsonl" 2>/dev/null || true
