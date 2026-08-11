#!/usr/bin/env bash
# The sweep died at 35/89 on 2026-08-07 with:
#
#   [sweep] token has 33 min left — EXPIRED, re-authenticate with: claude setup-token
#   [sweep] credential expired — waiting 120s for the host CLI to rotate it (attempt 2/6)
#   ...
#   [sweep] credential EXPIRED and not rotated after 10 min
#
# while `claude -p` on the same host worked perfectly. The previous session read
# that as "the host CLI has stopped rotating the credential" and wrote
# "Do not chase the 7-hour OAuth token" into RESUME.md, prescribing a long-lived
# `claude setup-token` credential the operator has to mint by hand.
#
# THE DIAGNOSIS WAS WRONG. Measured directly on this host:
#
#   at T-19min : `claude -p` succeeded, credentials mtime UNCHANGED, 18 min left
#   at T+90s   : `claude -p` succeeded, credentials mtime CHANGED, 473 min left
#
# The rotation is LAZY and CLI-TRIGGERED: it happens when the CLI is invoked and
# finds an expired token, not on a timer. So the old loop was waiting for an
# event only it could cause, and it never caused it — and it gave up at T-30min,
# never reaching the expiry where a poke would have worked. A self-inflicted
# deadlock, not an auth failure.
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md). The fixture gives
# refresh_token an ALREADY-EXPIRED credential and a stub `claude` on PATH that
# rotates it when invoked — exactly what the real CLI does. Post-change the poke
# fires within seconds, the stub runs, the credential rotates and refresh_token
# returns 0. Pre-change the very first thing the loop does is `sleep 120`, so
# under a 25-second cap the stub is NEVER invoked, no token is written, and
# refresh_token never returns — cases 1, 2 and 3 all go red. Verified against
# `git show HEAD:...run-sweep.par.sh`.
#
# No network, no real credential, no sweep: HOME and PATH are redirected into a
# temp dir, so the host's own ~/.claude is never read or written.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${TB_SWEEP_SCRIPT:-$HERE/run-sweep.par.sh}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "credential-refresh-poke:"

command -v node >/dev/null 2>&1 || { echo "  SKIP - node not available"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── lift the token functions out of the sweep script ───────────────────────
# The script cannot be sourced whole — sourcing it runs a sweep. Take the block
# from the first token function through the end of `_refresh_token_once`.
start="$(grep -nE '^(_token_mins_left|refresh_token)\(\) \{' "$SRC" | head -1 | cut -d: -f1)"
tokline="$(grep -n 'tb-token\.env"$' "$SRC" | tail -1 | cut -d: -f1)"
if [ -z "$start" ] || [ -z "$tokline" ]; then
  bad "could not locate the token functions in $SRC"
  echo "  ${pass} passed, ${fail} failed"; exit 1
fi
sed -n "${start},$((tokline+1))p" "$SRC" > "$TMP/funcs.sh"

# ── a HOME whose credential is already past expiry ─────────────────────────
FAKE_HOME="$TMP/home"; mkdir -p "$FAKE_HOME/.claude"
node -e '
const fs=require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{
  accessToken:"sk-ant-oat01-STALE", refreshToken:"rt", subscriptionType:"max",
  expiresAt: Date.now() - 60_000        // expired one minute ago
}}));
' "$FAKE_HOME/.claude/.credentials.json"

# ── a stub `claude` that rotates the credential when invoked, as the real
#    CLI does — and records that it was called at all.
BIN="$TMP/bin"; mkdir -p "$BIN"
cat > "$BIN/claude" <<'STUB'
#!/usr/bin/env bash
echo "POKED" >> "$TB_TEST_POKE_LOG"
node -e '
const fs=require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{
  accessToken:"sk-ant-oat01-FRESH", refreshToken:"rt", subscriptionType:"max",
  expiresAt: Date.now() + 8*60*60*1000
}}));
' "${USERPROFILE:-$HOME}/.claude/.credentials.json"
echo ok
STUB
chmod +x "$BIN/claude"

REPO="$TMP/repo"; mkdir -p "$REPO/mcp-data"
POKE_LOG="$TMP/poke.log"; : > "$POKE_LOG"

# 25s cap: post-change the poke path resolves in seconds; pre-change the loop
# opens with `sleep 120` and cannot finish inside it.
set +e
OUT="$(
  HOME="$FAKE_HOME" USERPROFILE="$FAKE_HOME" PATH="$BIN:$PATH" REPO="$REPO" \
  TB_TEST_POKE_LOG="$POKE_LOG" TB_TOKEN_STATIC=0 \
  timeout 25 bash -c '
    set -uo pipefail
    . "$1"
    refresh_token
    echo "REFRESH_RC=$?"
  ' _ "$TMP/funcs.sh" 2>&1
)"
rc=$?
set -e

# ── case 1: the CLI was actually invoked ──────────────────────────────────
if [ -s "$POKE_LOG" ]; then
  ok "the sweep POKES the host CLI when the credential is below the gate"
else
  bad "the CLI was never invoked — the sweep waits for a rotation only it can trigger"
fi

# ── case 2: the refresh then succeeds ─────────────────────────────────────
if grep -q "REFRESH_RC=0" <<<"$OUT"; then
  ok "refresh_token recovers without human re-authentication"
else
  bad "refresh_token did not recover (timeout rc=$rc): $(tail -3 <<<"$OUT" | tr '\n' '|')"
fi

# ── case 3: the rotated token is what gets written out ────────────────────
if [ -s "$REPO/mcp-data/.tb-token.env" ] && grep -q "FRESH" "$REPO/mcp-data/.tb-token.env"; then
  ok "the ROTATED token is snapshotted for the containers"
else
  bad "the token file holds no rotated credential: $(sed -E 's/=(.{0,18}).*/=\1…/' "$REPO/mcp-data/.tb-token.env" 2>/dev/null || echo MISSING)"
fi

# ── case 4: a healthy credential is not poked at all ──────────────────────
# The poke costs a real API call, so it must fire only when the gate trips.
: > "$POKE_LOG"
node -e '
const fs=require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({claudeAiOauth:{
  accessToken:"sk-ant-oat01-HEALTHY", refreshToken:"rt", subscriptionType:"max",
  expiresAt: Date.now() + 8*60*60*1000
}}));
' "$FAKE_HOME/.claude/.credentials.json"
set +e
HOME="$FAKE_HOME" USERPROFILE="$FAKE_HOME" PATH="$BIN:$PATH" REPO="$REPO" \
TB_TEST_POKE_LOG="$POKE_LOG" TB_TOKEN_STATIC=0 \
timeout 25 bash -c 'set -uo pipefail; . "$1"; refresh_token' _ "$TMP/funcs.sh" >/dev/null 2>&1
set -e
if [ ! -s "$POKE_LOG" ]; then
  ok "a credential with headroom is NOT poked (the poke costs a real API call)"
else
  bad "the CLI was poked despite 8h of headroom — wasted quota on every task"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
