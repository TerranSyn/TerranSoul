#!/usr/bin/env bash
# Iterate a task until the OUTCOME CHANGES, it passes, or the budget runs out.
#
#   usage: iterate-until-change.sh <task> [max-attempts] [proxy-port]
#
# WHY STOP ON CHANGE RATHER THAN ON A FIXED COUNT. Investigating twenty
# identical results costs twenty investigations and yields one fact. Measured on
# pytorch-model-cli attempts 6-9: four substantial rewrites produced BYTE-IDENTICAL
# grader output every time. The informative moments are exactly the ones where
# the score moves — a pass, or a different set of checks failing — so this runs
# unattended through the flat stretches and stops the moment there is something
# to look at.
#
# It stops on:
#   * reward 1.0                      -- solved
#   * a DIFFERENT passed/total count  -- the agent moved something that is graded
#   * the attempt budget              -- exhausted
#
# Everything it prints per attempt is the same evidence iterate.sh shows, so the
# transcript is auditable after the fact rather than only summarised.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK="${1:?usage: iterate-until-change.sh <task> [max] [port]}"
MAX="${2:-10}"
PORT="${3:-7425}"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
cd "$HERE" || exit 2

# Newest trial dir on disk for this task, or "" when none exists yet. `iterate.sh`
# forces TB_JOBS_DIR="$HERE/jobs-sonnet5" (iterate.sh:61), so this deliberately
# reads that same corpus rather than honouring an inherited TB_JOBS_DIR — the
# guard must look where the runner actually writes, not where a caller wishes.
newest_trial() { ls -dt "$HERE/jobs-sonnet5"/*/"$TASK"__* 2>/dev/null | head -1; }

baseline=""
for i in $(seq 1 "$MAX"); do
  echo "───────────── run $i of $MAX ─────────────"
  # Remember which trial was newest BEFORE this run, so the checks below can
  # tell this run's trial from the previous one's. See the staleness note below.
  before_trial="$(newest_trial)"
  out="$(timeout 1800 bash "$HERE/iterate.sh" "$TASK" "$PORT" 2>&1)"
  echo "$out"

  rew="$(printf '%s' "$out" | grep -m1 'REWARD :' | awk '{print $NF}')"
  chk="$(printf '%s' "$out" | grep -m1 'CHECKS : ' | sed 's/.*CHECKS : //')"

  # ⛔ A TRIAL THAT NEVER RAN IS NOT A FAILED ATTEMPT. Measured 2026-08-09: the
  # OAuth credential was revoked mid-session and the next TWENTY trials each
  # produced `steps: 2`, `total_completion_tokens: 0`, and a trajectory saying
  # "API Error: 401 OAuth access token has been revoked" — while harbor wrote a
  # normal trial with reward 0.0 and the verifier dutifully scored 0 of 2. The
  # batch driver then burned its whole budget on corpses, and every conclusion
  # drawn from that window was void: an intervention "measured" over those runs
  # was never executed once.
  #
  # The runner already treats AgentTimeoutError / UnknownApiError as ERRORED
  # rather than failed; a revoked credential belongs in the same bucket and was
  # the one shape that slipped through. Zero completion tokens is the reliable
  # tell — a real attempt that scores 0 still emits thousands.
  #
  # ⚠ AND IT MUST BE *THIS* RUN'S TRIAL. This picked the newest trial by mtime
  # with nothing tying it to the run just finished. When `iterate.sh` produces no
  # trial at all — its own `timeout 1800` fires, harbor dies during setup — the
  # newest trial on disk is the PREVIOUS iteration's. A live predecessor then
  # silently vouches for a run that did nothing, which is the same class of
  # mistake as scoring a corpse: reading an outcome off work that did not happen.
  newest="$(newest_trial)"
  if [ -n "$newest" ] && [ "$newest" = "$before_trial" ]; then
    echo ""
    echo "⚠ run $i produced NO NEW TRIAL (newest on disk is still $(basename "$newest"))."
    echo "⚠ Not judging the previous run's trial as if it were this one's."
  elif [ -n "$newest" ] && [ -f "$newest/agent/trajectory.json" ]; then
    if reason="$(python "$HERE/dead-trial.py" "$newest/agent/trajectory.json")"
    then
      echo ""
      echo "██ ABORTING: run $i produced NO agent work ($reason)."
      echo "██ trial: $(basename "$newest")"
      echo "██ This is an ERRORED trial, not a failed attempt. Its 'reward 0' is meaningless"
      echo "██ and so is any comparison that includes it."
      echo "██ Most likely the OAuth credential expired or was revoked. It is minted by"
      echo "██ \`claude setup-token\` (interactive browser flow) into mcp-data/.tb-token.env,"
      echo "██ so it CANNOT be refreshed automatically — a human has to re-mint it."
      echo "██ Stopping rather than burning the remaining $((MAX - i)) run(s)."
      exit 3
    fi
  fi

  if [ "$rew" = "1" ]; then
    echo ""
    echo "★★ SOLVED on run $i — reward 1.0. Stopping."
    exit 0
  fi

  if [ -z "$baseline" ]; then
    baseline="$chk"
  elif [ "$chk" != "$baseline" ]; then
    echo ""
    echo "★ OUTCOME MOVED on run $i: '$baseline' -> '$chk'. Stopping for investigation."
    exit 0
  fi
  echo "  (unchanged: $chk — continuing)"
done

echo ""
echo "── budget exhausted after $MAX runs; outcome never moved from: $baseline"
exit 1
