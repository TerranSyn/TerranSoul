#!/usr/bin/env bash
# ONE attempt at ONE task, followed immediately by the diagnosis.
#
#   usage: iterate.sh <task> [proxy-port]
#
# WHY THIS SHAPE. Batch-then-audit hides which change caused what: a 10-attempt
# run that fails 10 times tells you the same thing once. Running a single attempt
# and reading its grader output before deciding the next move is how a root cause
# actually gets isolated — and it is one tool call, so it stays affordable.
#
# WHAT IT PRINTS, and why each part earns its place:
#   * reward + per-check counts        -- is the defect broad or narrow?
#   * the FAILING check names          -- for the OPERATOR only. These never
#                                         reach the agent: attempt_feedback_text
#                                         passes COUNTS ONLY (owner decision),
#                                         and a name would tell it what is graded.
#   * the grader's own assertion text  -- the ground truth about what went wrong
#   * the agent's closing claim         -- what it BELIEVED, so a belief that is
#                                         confidently wrong is visible next to
#                                         the evidence that it is wrong
#   * brain call counts                 -- did self-improve actually engage?
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TASK="${1:?usage: iterate.sh <task> [proxy-port]}"
PORT="${2:-7425}"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
cd "$HERE" || exit 2

BEFORE="$(ls -1d jobs-sonnet5/*/"$TASK"__*/ 2>/dev/null | wc -l)"
echo "══ ITERATE $TASK  (trials on disk before: $BEFORE) ══"

# ⛔ COMPUTE THE PRIOR-ATTEMPT FEEDBACK HERE. redo-task.sh only PASSES
# TB_PRIOR_OUTCOMES through; nothing populates it — that is run-sweep.par.sh's
# job, and this path does not go through run-sweep. Measured 2026-08-09: the
# first iteration ran with the rendered instruction reading "This is your first
# attempt at this task. No earlier attempt has been scored" while SIX scored
# failures sat on disk. So the agent got no counts, no escalation clause and no
# awareness it had ever failed — the run measured the OLD behaviour and would
# have been read as "the fix did not work".
#
# The attempt number is derived from trials already on disk, so an iteration is
# always numbered as what it actually is.
FEEDBACK="$(
  HERE="$HERE"
  # shellcheck disable=SC1090
  eval "$(awk '/^attempt_feedback_text\(\) \{/,/^\}/' "$HERE/run-sweep.par.sh")"
  TB_JOBS_DIR="$HERE/jobs-sonnet5" attempt_feedback_text "$TASK" "$((BEFORE + 1))"
)"
echo "  attempt   : $((BEFORE + 1))"
echo "  FEEDBACK IN: $(printf '%s' "$FEEDBACK" | cut -c1-150)..."
case "$FEEDBACK" in
  *"first attempt"*)
    [ "$BEFORE" -eq 0 ] || {
      echo "  ⚑ REFUSING: $BEFORE prior trials exist but the feedback says 'first attempt'." >&2
      echo "    Running now would measure the pre-fix behaviour and read as a failed fix." >&2
      exit 3
    } ;;
esac

TB_PROXY_PORT="$PORT" TB_JOBS_DIR="$HERE/jobs-sonnet5" TB_PRIOR_OUTCOMES="$FEEDBACK" \
  bash "$HERE/redo-task.sh" "$TASK" 1 > /tmp/iterate-$TASK.log 2>&1
rc=$?
echo "  redo exit=$rc  (harbor exits 0 on a FAILED trial — read the reward)"

python - "$TASK" <<'PY'
import glob, json, os, sys
task = sys.argv[1]
tds = sorted(glob.glob("jobs-sonnet5/*/%s__*/" % task), key=os.path.getmtime)
if not tds:
    print("  NO TRIAL DIR — the run did not start; read /tmp/iterate-%s.log" % task)
    raise SystemExit
td = tds[-1]
job = os.path.basename(os.path.dirname(td.rstrip("/\\")))
try:
    rew = open(os.path.join(td, "verifier", "reward.txt")).read().strip()
except Exception:
    rew = "?"
print("  job    : %s" % job)
print("  REWARD : %s" % rew)

cp = os.path.join(td, "verifier", "ctrf.json")
if os.path.exists(cp):
    tests = (json.load(open(cp, encoding="utf-8", errors="replace"))
             .get("results", {}).get("tests", []) or [])
    p = sum(1 for t in tests if t.get("status") == "passed")
    print("  CHECKS : %d of %d passed" % (p, len(tests)))
    bad = [t.get("name", "?").split("::")[-1] for t in tests if t.get("status") != "passed"]
    if bad:
        print("  FAILING (operator-only, never shown to the agent): %s" % ", ".join(bad))

so = os.path.join(td, "verifier", "test-stdout.txt")
if os.path.exists(so):
    keep = []
    for ln in open(so, encoding="utf-8", errors="replace"):
        s = ln.rstrip()
        if any(k in s for k in ("assert", "Assertion", "Error", "expected", "Expected", "FAILED")):
            if not any(s.startswith(x) for x in ("Hit:", "Get:", "Reading", "Building", "Setting up")):
                keep.append(s[:160])
    if keep:
        print("  GRADER SAID:")
        for s in keep[-6:]:
            print("     %s" % s.encode("ascii", "replace").decode())

tj = os.path.join(td, "agent", "trajectory.json")
if os.path.exists(tj):
    j = json.load(open(tj, encoding="utf-8", errors="replace"))
    msgs = [s.get("message", "") for s in j.get("steps", [])
            if s.get("source") == "agent" and isinstance(s.get("message"), str)]
    if msgs:
        print("  AGENT BELIEVED: %s" % msgs[-1][:400].replace("\n", " ")
              .encode("ascii", "replace").decode())

pc = os.path.join(os.path.dirname(td.rstrip("/\\")), "terransoul-proxy-calls.jsonl")
if os.path.exists(pc):
    import collections
    c = collections.Counter()
    for line in open(pc, encoding="utf-8", errors="replace"):
        try:
            r = json.loads(line)
        except Exception:
            continue
        t = r.get("tool") or r.get("name")
        if t and str(t).startswith("brain_"):
            c[t] += 1
    print("  BRAIN  : %s" % (dict((k, v // 2) for k, v in c.items()) or "NONE — self-improve did not engage"))
PY
echo "══ end iterate ══"
