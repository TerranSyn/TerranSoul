#!/usr/bin/env bash
# run-parallel.sh dealt tasks to workers round-robin out of $TODO, and $TODO is
# ALPHABETICAL (run-sweep.par.sh walks the filesystem with `find | sort`). Task
# cost is wildly uneven — measured medians in this corpus run from ~2 min to
# over 20 min PER ATTEMPT, and each task runs k of them — so an alphabetical
# deal is effectively a random one.
#
# A sweep finishes at max(worker), so one worker drawing the heavy tail decides
# the entire wall-clock. Observed live on 2026-08-07: 83 minutes into a run,
# worker 0 had completed 3 tasks and worker 1 exactly 1, because
# `install-windows-3.11` alone was taking ~20 min per attempt (~100 min for its
# five). Neither worker was unhealthy — the split was.
#
# The fix orders $TODO by DESCENDING measured cost before dealing it, which is
# the standard cheap approximation of longest-processing-time-first and needs no
# change to the deal itself (the deal is what `.shard` and the shard-verify
# guard both depend on).
#
# WHY THIS TEST CAN FAIL (rules/tests-must-be-able-to-fail.md): it extracts the
# ranker and feeds it a fixture where `slowtask`'s trials span 30 minutes and
# `fasttask`'s span 30 seconds, with `newtask` having no history at all. On the
# pre-change tree there is no ranker to extract, so case 1 goes red immediately
# and the rest cannot run. Case 4 pins the ordering RULE rather than one
# outcome, so a ranker that merely reverses the list cannot pass.
#
# run-parallel.sh is never executed here: invoking it rewrites every worker's
# live state and shard file, which would corrupt a running sweep. Only the
# embedded ranker is lifted out and run against a temp fixture.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${TB_PARALLEL_SCRIPT:-$HERE/run-parallel.sh}"
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1" >&2; fail=$((fail+1)); }

echo "cost-aware-shard:"
command -v python >/dev/null 2>&1 || { echo "  SKIP - python not available"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── case 1: the ranker exists and is extractable ───────────────────────────
# Lift the python heredoc that orders $TODO by cost.
awk '/^import json, os, glob, statistics, collections$/,/^print\("\\n"\.join\(ranked\)\)$/' "$SRC" > "$TMP/rank.py"
if [ -s "$TMP/rank.py" ] && grep -q "ranked = sorted" "$TMP/rank.py"; then
  ok "run-parallel.sh carries a cost ranker"
else
  bad "no cost ranker — shards are dealt alphabetically and wall-clock is luck of the draw"
  echo "  ${pass} passed, ${fail} failed"; exit 1
fi

# ── fixture: one slow task, one fast task, one with no history ────────────
JOBS="$TMP/jobs"; mkdir -p "$JOBS/j1"
printf '{"stats":{}}\n' > "$JOBS/j1/result.json"
mk() {  # $1 trial id, $2 first-file stamp, $3 last-file stamp
  mkdir -p "$JOBS/j1/$1"
  echo a > "$JOBS/j1/$1/start.txt"; echo b > "$JOBS/j1/$1/end.txt"
  touch -t "$2" "$JOBS/j1/$1/start.txt"
  touch -t "$3" "$JOBS/j1/$1/end.txt"
}
mk slowtask__x1 202608071000.00 202608071030.00   # 30 minutes
mk slowtask__x2 202608071100.00 202608071130.00   # 30 minutes
mk fasttask__y1 202608071200.00 202608071200.30   # 30 seconds
mk fasttask__y2 202608071300.00 202608071300.30   # 30 seconds

rank() {  # stdin = TODO list
  JOBS_A="$JOBS" JOBS_B="$JOBS" TODO_LIST="$1" python "$TMP/rank.py"
}

OUT="$(rank "$(printf 'fasttask\nslowtask\n')")"
FIRST="$(head -1 <<<"$OUT")"

# ── case 2: the heavier task is scheduled first ───────────────────────────
if [ "$FIRST" = "slowtask" ]; then
  ok "the heavier task is dealt first (60x cost difference respected)"
else
  bad "cost ignored — got '$FIRST' first, expected slowtask. Order was: $(tr '\n' ' ' <<<"$OUT")"
fi

# ── case 3: alphabetical input does not decide the order ──────────────────
# 'fasttask' < 'slowtask' alphabetically, so a pass here cannot be luck.
OUT_REV="$(rank "$(printf 'slowtask\nfasttask\n')")"
if [ "$(head -1 <<<"$OUT_REV")" = "slowtask" ]; then
  ok "the order is stable regardless of input order — cost decides, not position"
else
  bad "order depends on input order, so it is not ranking by cost"
fi

# ── case 4: a task with NO history sorts FIRST ────────────────────────────
# An unknown task is more likely to be one of the heavy ones nobody has
# finished than a trivial one, and starting it early is the safe error.
OUT_NEW="$(rank "$(printf 'fasttask\nslowtask\nnewtask\n')")"
if [ "$(head -1 <<<"$OUT_NEW")" = "newtask" ]; then
  ok "an unmeasured task is scheduled first, not last"
else
  bad "unmeasured task not prioritised: $(tr '\n' ' ' <<<"$OUT_NEW")"
fi

# ── case 5: deterministic across runs ─────────────────────────────────────
# Two launches over the same corpus must shard identically, or a resume
# reshuffles work that is already half done.
if [ "$(rank "$(printf 'fasttask\nslowtask\nnewtask\n')")" = "$OUT_NEW" ]; then
  ok "ranking is deterministic over an unchanged corpus"
else
  bad "ranking is not deterministic — a resume would reshuffle shards"
fi

# ── case 6: the behaviour is switchable ───────────────────────────────────
if grep -q 'TB_COST_SHARD:-1' "$SRC"; then
  ok "TB_COST_SHARD=0 restores the alphabetical deal"
else
  bad "no escape hatch — a bad cost model could not be turned off mid-campaign"
fi

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
