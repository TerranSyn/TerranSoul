#!/usr/bin/env bash
# run-parallel.sh composed the worker environment TWICE — once as a literal list
# written into `.tb-parN.launch`, and once as a SHORTER literal list for the live
# `nohup env`. adaptive-workers.sh relaunches a worker by replaying `.launch`, so
# the two lists have to agree or a relaunched worker runs under a different
# configuration than the one the sweep started with.
#
# They did not agree, and the gap had a name: TB_TOKEN_STATIC=1 was in NEITHER.
#
# RESUME.md instructs the operator to `export TB_TOKEN_STATIC=1` so the sweep
# trusts the long-lived `claude setup-token` credential instead of the 8-hour
# OAuth access token that the host CLI had stopped rotating. Shell inheritance
# carried it into the FIRST launch, which is why it looked like it worked — but
# `.launch` is an explicit enumeration, so every supervisor relaunch dropped it
# and the worker silently reverted to reading ~/.claude/.credentials.json. That
# is how the 2026-08-07 run died at 35/89 with "credential EXPIRED and not
# rotated after 10 min" while `claude -p` on the same host worked fine.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md). Case 1 extracts
# the `worker_env=(` array — which does not EXIST on the pre-change tree, so it
# goes red immediately. Cases 2-4 evaluate that array in a sandbox and assert
# TB_TOKEN_STATIC / TB_TOKEN_FILE survive into the rendered `.launch` line and
# that replaying it reproduces them; pre-change there is nothing to extract, so
# they cannot pass either. Case 5 is the anti-regression that stops the fix from
# being "just add the variable to both lists again": it asserts the launch record
# and the live launch come from the SAME array, which is what removes the drift
# by construction. Verified red by `git stash`-ing the change and re-running.
#
# It touches NO live sweep state: run-parallel.sh itself is never executed (it
# rewrites .tb-completed-derived.txt and every worker's state file), only the
# environment-composition block is lifted out and evaluated in a temp dir.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/run-parallel.sh"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "worker-env-passthrough:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── case 1: the single source of truth exists ───────────────────────────────
# Lift the block from `worker_env=(` through the launch-file render. Pre-change
# there is no such array and this extraction is empty.
awk '/^  worker_env=\(/,/^  \} > "\$launch_file"/' "$SRC" > "$TMP/block.sh"
if [ -s "$TMP/block.sh" ] && grep -q 'worker_env=(' "$TMP/block.sh"; then
  ok "run-parallel.sh builds the worker environment as ONE array"
else
  bad "no single worker_env array — the launch record and the live launch are composed separately"
fi

# ── case 2: TB_TOKEN_STATIC and TB_TOKEN_FILE are carried at all ────────────
if grep -q 'TB_TOKEN_STATIC=' "$TMP/block.sh"; then
  ok "TB_TOKEN_STATIC is part of the worker environment"
else
  bad "TB_TOKEN_STATIC absent — a relaunched worker reverts to the rotating OAuth credential"
fi
if grep -q 'TB_TOKEN_FILE=' "$TMP/block.sh"; then
  ok "TB_TOKEN_FILE is part of the worker environment"
else
  bad "TB_TOKEN_FILE absent — the worker cannot be pointed at a per-campaign token file"
fi

# ── case 3: the rendered .launch really carries the operator's setting ──────
# Evaluate the extracted block with the variables run-parallel.sh would have
# bound, and TB_TOKEN_STATIC exported the way RESUME.md tells the operator to.
(
  cd "$TMP" || exit 1
  w=0; STAMP="08071537"; wstate="$TMP/state.txt"
  REPO="$TMP/repo"; HERE="$TMP/here"
  mkdir -p "$REPO/mcp-data" "$HERE"
  export TB_TOKEN_STATIC=1
  export TB_ATTEMPTS=5 TB_JOBS_DIR="$TMP/jobs" TB_AGENT="terransoul:TerranSoul"
  export TB_TARGET_ATTEMPTS=5 TB_DATASET="ds@sha256:deadbeef" TB_RATE_LIMIT_PAUSE_S=900
  # shellcheck disable=SC1091
  . "$TMP/block.sh"
) >/dev/null 2>&1

LAUNCH="$TMP/repo/mcp-data/.tb-par0.launch"
if [ -s "$LAUNCH" ] && grep -q 'TB_TOKEN_STATIC=1' "$LAUNCH"; then
  ok "the recorded .launch line carries TB_TOKEN_STATIC=1"
else
  bad "TB_TOKEN_STATIC=1 did not reach .launch — adaptive-workers.sh would replay without it"
fi

# ── case 4: replaying .launch reproduces the setting ────────────────────────
# This is the mechanism adaptive-workers.sh uses. Swap the trailing script for an
# env-dumping stub so the replay is observable without running a sweep.
if [ -s "$LAUNCH" ]; then
  STUB="$TMP/dump-env.sh"
  printf '#!/usr/bin/env bash\nenv | grep "^TB_" | sort\n' > "$STUB"
  chmod +x "$STUB"
  # Replace the final `bash <path>` with the stub, preserving the env prefix.
  REPLAY="$(sed -E "s#bash [^ ]+run-sweep\.par\.sh#bash '$STUB'#" "$LAUNCH")"
  OUT="$(eval "$REPLAY" 2>/dev/null)"
  if grep -q '^TB_TOKEN_STATIC=1$' <<<"$OUT" && grep -q '^TB_TOKEN_FILE=' <<<"$OUT"; then
    ok "replaying .launch reproduces TB_TOKEN_STATIC=1 and TB_TOKEN_FILE"
  else
    bad "replay lost the token settings — got: $(grep '^TB_TOKEN' <<<"$OUT" | tr '\n' ' ')"
  fi
  # The campaign identity must survive the replay too, or a relaunched worker
  # writes into the wrong jobs dir under the wrong agent name.
  if grep -q '^TB_AGENT=terransoul:TerranSoul$' <<<"$OUT" \
     && grep -q '^TB_DATASET=ds@sha256:deadbeef$' <<<"$OUT" \
     && grep -q '^TB_TARGET_ATTEMPTS=5$' <<<"$OUT"; then
    ok "replay preserves the campaign identity (agent, dataset, target attempts)"
  else
    bad "replay lost campaign identity: $(grep -E '^TB_(AGENT|DATASET|TARGET)' <<<"$OUT" | tr '\n' ' ')"
  fi
else
  bad "no .launch rendered — cannot test the replay path"
  bad "no .launch rendered — cannot test campaign identity"
fi

# ── case 5: anti-regression — ONE array, used twice ────────────────────────
# Stops the fix degrading back into "two lists that happen to match today".
uses="$(grep -c '"\${worker_env\[@\]}"' "$SRC")"
if [ "${uses:-0}" -ge 2 ] && [ "$(grep -c '^  worker_env=(' "$SRC")" -eq 1 ]; then
  ok "one worker_env definition, used by both the record and the live launch"
else
  bad "worker_env defined $(grep -c '^  worker_env=(' "$SRC") time(s), referenced $uses time(s) — drift is possible again"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
