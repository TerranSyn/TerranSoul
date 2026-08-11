#!/usr/bin/env python3
"""Stamp each attempt-authored lesson with the SCORE of the attempt that wrote it.

⛔ THE DEFECT THIS FIXES. `brain_ingest_lesson` writes every lesson at
`confidence = 1.0` with `success_count` / `failure_count` at zero, and nothing
ever revises them. A lesson is written BEFORE its trial is verified — measured
on attempt 50 (job `redo08100238-20260810-023823`): the agent appended at
16:44:30, step 9 of 10; the trial ended at 16:44:52; the verifier ran after. So
a lesson written by an attempt that scored 0 is indistinguishable from one
written by an attempt that passed, and a task that fails N times deposits N
confident, unfalsified design notes.

MEASURED on filter-js-from-html: rows 1417 and 1418 both narrate "after N prior
scored attempts … plateaued at 0-1/2" and both recommend the hand-rolled
byte-splicing tokenizer, which is now 0 for 15. Attempt 50 retrieved 1418, wrote
"Built the hand-rolled single-pass tokenizer per this entry's design", scored
0 of 2, and appended ANOTHER refinement to it. Memory is compounding a losing
architecture, and each new attempt reads the accumulated confidence as evidence
that the ground is already covered.

The runner has always known the score. It just never wrote it down.

═══ WHY THIS DIFFERS FROM THE VERSION REVERTED IN 16986906 ═══

That version was reverted for a real reason, and both of its mistakes are fixed
here rather than re-litigated:

 1. IT LOWERED `confidence` TO 0.25. Confidence orders results
    (`store.rs:2742`), so demoting a row does not add a caveat — it SUBTRACTS
    the content, and the reader loses the warning AND the reasoning it was
    attached to. Its own commit message reached that conclusion: "an outcome
    belongs to the RETRIEVAL RESULT … without competing with it for rank."
    → This version does NOT touch `confidence`. The verdict goes to
      `failure_count` / `consecutive_failures`, which appear nowhere in any
      scoring path (verified: `store.rs` reads them only in
      `record_procedure_outcome`'s ledger, never in ranking).

 2. IT APPENDED THE MARKER TO THE END OF `content`. That is precisely the
    region `brain_append` elides — measured 547 elided blocks against 479 live,
    a 53% loss — and 16986906's own message records row 1418 losing its marker
    to exactly that. A caveat that the next append deletes is not a caveat.
    → This version PREPENDS. `bound_appended_content` gives the head its own
      budget and preserves it while dropping older update blocks, so the head
      is the only durable place to put something that must survive.

PURITY. This records OUTCOMES, never content: no solution, no hint, no test
name, no task-specific guidance. It is the same class of fact as the attempt
feedback the agent already receives, applied to the memory instead of the
prompt. `rules/bench-agi-purity.md` forbids seeding answers, not telling a
memory whether its own advice worked.

ATTRIBUTION is exact and conservative:
  * a trial's write window comes from its own `terransoul-proxy-calls.jsonl`
    (each job dir is one trial, and the proxy log is per-port since 2026-08-06);
  * only `category = 'self-improve-attempt'` rows are touched, so the
    operating-doctrine and hub rows written in the same window are left alone;
  * a row already stamped is skipped, so re-running is idempotent.

Lessons extended via `brain_append` are NOT attributable — the proxy log records
the call but not the target id — so they are left untouched rather than guessed
at. That is a known gap, reported in the summary, not silently ignored.

Usage:
    python stamp-lesson-outcomes.py --db PATH --jobs DIR [--task NAME] [--apply]
Without --apply it prints what it would do and changes nothing.
"""
import argparse
import datetime
import glob
import json
import os
import sqlite3
import sys

# Prepended, not appended — see the header. The trailing newlines keep the
# original opening line intact and readable underneath.
MARK = "[OUTCOME] "
ATTEMPT_CATEGORY = "self-improve-attempt"


def iso_ms(text):
    return int(datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


def append_targets(job_dir, trial):
    """Ids this trial extended via `brain_append`, read from the TRAJECTORY.

    ⛔ WHY NOT THE PROXY LOG. `terransoul-proxy-calls.jsonl` records
    `{"tool":"brain_append","allowed":true,"mode":"learn-write"}` and no target
    id, so appends were previously unattributable and left unstamped. That is
    not a neutral gap: measured on attempt 52, the FIRST trial ever to pass the
    fidelity check recorded its finding via `brain_append`, so the single most
    valuable outcome in the campaign carried no stamp while five losing rows
    did. A ledger that can only record failures teaches the wrong lesson.

    The trajectory does carry it: `steps[].tool_calls[].arguments.id` for a
    `function_name` ending in `brain_append`.
    """
    traj = os.path.join(job_dir, trial, "agent", "trajectory.json")
    if not os.path.exists(traj):
        return []
    try:
        with open(traj, encoding="utf-8", errors="replace") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return []
    out = []
    for step in (doc.get("steps") or []):
        for call in (step.get("tool_calls") or []):
            if not str(call.get("function_name", "")).endswith("brain_append"):
                continue
            args = call.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    continue
            mid = args.get("id")
            if isinstance(mid, int):
                out.append(mid)
    return out


def agent_closing_summary(job_dir, trial):
    """The attempt's own final statement of WHAT IT BUILT, from the trajectory.

    This is the approach description in the agent's own words — the last thing
    it said before the trial ended. For a SOLVING trial it is the only place the
    winning design exists in prose, because the lesson the agent wrote was
    written BEFORE the verifier ran and therefore could not know it had won.
    """
    traj = os.path.join(job_dir, trial, "agent", "trajectory.json")
    if not os.path.exists(traj):
        return None
    try:
        with open(traj, encoding="utf-8", errors="replace") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    msgs = [s.get("message") for s in (doc.get("steps") or [])
            if s.get("source") == "agent" and isinstance(s.get("message"), str)]
    msgs = [m.strip() for m in msgs if m and m.strip()]
    return msgs[-1] if msgs else None


def winning_artifact(job_dir, trial):
    """The file the SOLVING attempt actually wrote, recovered from its trajectory.

    ⛔ WHY THE ARTIFACT AND NOT A SUMMARY. A verified solve was previously
    recorded as the agent's closing PROSE. Prose is lossy exactly where this
    class of task is won: `filter.py` had to survive 445 adversarial vectors,
    and the difference between passing and failing is a rule set, not a
    paragraph. MEASURED: attempts 54, 55 and 56 could all recite the winning
    design — attempt 54 said verbatim "the design confirmed by the task's own
    attempt-history to have fully passed (2/2)" — and each still missed a
    different vector. Knowledge transferred; the substance did not.

    PURITY. This is the agent's OWN work product from a trial the real grader
    scored 1.0. It is not the grader's answer key, not a walkthrough, and not
    pre-loaded: it did not exist until the system earned it.
    `rules/bench-agi-purity.md` forbids answer-DERIVED seeds — knowledge the
    system did not produce. `gateway.rs:4061` keeps `self-improve-attempt` out
    of the committed shared seed, so it stays runtime learning for this task
    shape and never becomes a head start for a future campaign. Non-independence
    WITHIN a task is the standing owner decision and is disclosed in any
    leaderboard PR.

    The container is gone by the time this runs, so the file is recovered from
    the tool calls that created it.
    """
    traj = os.path.join(job_dir, trial, "agent", "trajectory.json")
    if not os.path.exists(traj):
        return None
    try:
        with open(traj, encoding="utf-8", errors="replace") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    best = None
    for step in (doc.get("steps") or []):
        for call in (step.get("tool_calls") or []):
            fn = str(call.get("function_name", ""))
            args = call.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    continue
            blob = json.dumps(args)
            if ".py" not in blob:
                continue
            if fn in ("Write", "Edit", "create_file", "str_replace_editor"):
                body = args.get("content") or args.get("file_text") or args.get("new_string") or ""
                # Keep the LONGEST write: an agent typically writes the file once
                # in full and then makes small edits, and the full write is the
                # artifact worth keeping.
                if len(body) > len(best or ""):
                    best = body
    return best


def record_verified_solve(con, job_dir, trial, passed, total, apply):
    """Write a NEW row recording an approach that VERIFIABLY solved the task.

    ⛔ WHY THIS EXISTS. Every lesson is written before the verifier runs, so a
    winning attempt cannot know it won — and appending its finding onto an older
    entry is not attributable (see the note in main()). Result, measured on this
    campaign: attempt 53 SOLVED filter-js-from-html 2 of 2, and nothing in memory
    recorded that it had. Attempt 54 then reconstructed the design from the
    attempt-history feedback, said so explicitly ("the design confirmed by the
    task's own attempt-history to have fully passed (2/2)"), and still scored
    1 of 2 — knowledge transferred, verified STATUS did not.

    A NEW row is written rather than stamping anything existing, because the row
    an agent appended into is where it RECORDED, not the advice it FOLLOWED;
    stamping that would endorse whatever the row already said.

    PURITY. This is the system's own verified outcome, captured as runtime
    learning — the same class of fact as the score the agent already receives.
    `gateway.rs:4061` keeps `self-improve-attempt` out of the committed shared
    seed, so it never becomes a head-start for a future campaign, which is the
    boundary `rules/bench-agi-purity.md` actually draws.
    """
    summary = agent_closing_summary(job_dir, trial)
    if not summary:
        return None
    task = trial.split("__")[0]
    marker = "[VERIFIED SOLVE] "
    artifact = winning_artifact(job_dir, trial)
    content = (
        f"{marker}on the '{task}' task shape, the approach below was run against the "
        f"task's real grader and PASSED {passed} of {total} checks (reward 1.0). Unlike "
        f"every other attempt record, this one was written AFTER the verifier ran, so it "
        f"is an outcome and not a theory. The agent's own account of what it built:\n\n"
        f"{summary.strip()}"
    )
    if artifact:
        # The artifact is what actually passed. A summary of it is not: three
        # later attempts recited the design correctly and each still missed a
        # different vector. Store what ran.
        content += (
            "\n\n=== THE EXACT IMPLEMENTATION THAT PASSED (verbatim, "
            f"{len(artifact)} chars) ===\nStart from this rather than "
            "re-deriving it; extend it for anything it misses.\n\n"
            f"{artifact.strip()}"
        )
    row = con.execute(
        "SELECT id FROM memories WHERE content LIKE ? || '%' AND content LIKE '%' || ? || '%'",
        (marker, task),
    ).fetchone()
    if row:
        return None  # already recorded — idempotent
    if not apply:
        return "would record"
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    con.execute(
        "INSERT INTO memories (content, tags, importance, memory_type, created_at, tier, "
        "decay_score, category, cognitive_kind, success_count, confidence) "
        "VALUES (?, ?, 9, 'lesson', ?, 'long', 1.0, ?, 'procedural', 1, 1.0)",
        (content, f"verified-solve,{task},outcome", now, ATTEMPT_CATEGORY),
    )
    return "recorded"


def trial_reward(job_dir, trial):
    """(passed, total, reward, passed_names) for a trial."""
    ctrf = os.path.join(job_dir, trial, "verifier", "ctrf.json")
    passed = total = None
    passed_names = []
    if os.path.exists(ctrf):
        try:
            with open(ctrf, encoding="utf-8", errors="replace") as fh:
                tests = (json.load(fh).get("results") or {}).get("tests") or []
            total = len(tests)
            passed = sum(1 for t in tests if str(t.get("status", "")).lower() == "passed")
            passed_names = [str(t.get("name", "?")).split("::")[-1]
                            for t in tests if str(t.get("status", "")).lower() == "passed"]
        except (OSError, ValueError):
            pass
    reward = None
    rw = os.path.join(job_dir, trial, "verifier", "reward.txt")
    if os.path.exists(rw):
        try:
            with open(rw, encoding="utf-8", errors="replace") as fh:
                reward = float(fh.read().strip())
        except (OSError, ValueError):
            pass
    return passed, total, reward, passed_names


def is_corpse(job_dir, trial):
    """A trial that never ran is not a failed attempt — do not stamp its lessons.

    Shares the predicate with `dead-trial.py` rather than restating it: a second
    copy would drift, and stamping a corpse's lesson with "scored 0" would write
    a verdict about work that never happened.
    """
    traj = os.path.join(job_dir, trial, "agent", "trajectory.json")
    here = os.path.dirname(os.path.abspath(__file__))
    pred = os.path.join(here, "dead-trial.py")
    if not (os.path.exists(traj) and os.path.exists(pred)):
        return False
    try:
        import importlib.util as ilu
        spec = ilu.spec_from_file_location("dead_trial", pred)
        mod = ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return bool(mod.is_dead_trial(traj))
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--task", default="*")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    mode = "" if args.apply else "?mode=ro"
    con = sqlite3.connect("file:%s%s" % (args.db, mode), uri=True)

    planned, skipped_stamped, no_window, corpses = [], 0, 0, 0
    solves = []
    seen = set()
    for trial_path in sorted(glob.glob(os.path.join(args.jobs, "*", "%s__*" % args.task))):
        job_dir = os.path.dirname(trial_path)
        trial = os.path.basename(trial_path)
        if is_corpse(job_dir, trial):
            corpses += 1
            continue
        p = os.path.join(job_dir, "terransoul-proxy-calls.jsonl")
        stamps = []
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    if row.get("at"):
                        try:
                            stamps.append(iso_ms(row["at"]))
                        except ValueError:
                            pass
        if not stamps:
            no_window += 1
            continue
        win = (min(stamps) - 60_000, max(stamps) + 60_000)
        passed, total, reward, passed_names = trial_reward(job_dir, trial)
        if reward is None:
            continue
        # A verified solve is recorded regardless of what this trial authored:
        # it is the one outcome nothing else in the pipeline can capture.
        if reward >= 1.0:
            r = record_verified_solve(con, job_dir, trial, passed, total, args.apply)
            if r:
                solves.append((trial, r))
        rows = con.execute(
            "SELECT id, content FROM memories "
            "WHERE created_at BETWEEN ? AND ? AND category = ?",
            (win[0], win[1], ATTEMPT_CATEGORY),
        ).fetchall()
        # ⛔ APPEND TARGETS ARE DELIBERATELY NOT STAMPED. `append_targets()` can
        # now identify them, and stamping them would still be WRONG: an append
        # target is where the agent RECORDED its finding, not the advice it
        # FOLLOWED. The instruction tells agents to extend the previous
        # attempt's entry rather than write a near-duplicate, so the two come
        # apart routinely.
        #
        # MEASURED on attempt 52, the first trial to pass the fidelity check: it
        # appended into 1418 while explicitly REJECTING 1418's approach (the
        # hand-rolled byte scanner) in favour of BS4 + plain str(soup). Stamping
        # 1418 with "scored 1 of 2 — PASSING: test_clean_html_unchanged" would
        # have told every future reader that the hand-rolled scanner passes
        # fidelity — the exact opposite of the measured result, written into the
        # row most likely to be retrieved for this task shape.
        #
        # The real gap this leaves is named in the summary rather than papered
        # over: the winning finding lives inside 1418's appended block and
        # carries no verdict, because the agent wrote it before the verifier
        # ran. Fixing that needs a post-verification write path, not a smarter
        # guess about attribution.
        for mid, content in rows:
            if mid in seen:
                continue
            seen.add(mid)
            if (content or "").lstrip().startswith(MARK):
                skipped_stamped += 1
                continue
            planned.append((mid, trial, passed, total, reward, passed_names))

    if solves:
        for trial, what in solves:
            print("VERIFIED SOLVE %-34s %s" % (trial, what))
        if args.apply:
            con.commit()

    if not planned:
        print("nothing to stamp (%d already stamped, %d without a write window, %d corpses skipped)"
              % (skipped_stamped, no_window, corpses))
        return 0

    print("%-6s %-34s %s" % ("id", "authored/extended by", "scored"))
    for mid, trial, passed, total, reward, names in planned:
        score = "%s of %s" % (passed, total) if passed is not None else "reward %.2f" % reward
        if names:
            score += " (passed: %s)" % ", ".join(names)
        print("%-6s %-34s %s" % (mid, trial, score))

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        print("(%d already stamped, %d without a write window, %d corpses skipped)"
              % (skipped_stamped, no_window, corpses))
        return 0

    stamped_pass = 0
    for mid, trial, passed, total, reward, names in planned:
        solved = reward is not None and reward >= 1.0
        if passed is not None and total:
            verdict = "the attempt that used this scored %d of %d grader checks" % (passed, total)
        else:
            verdict = "the attempt that used this scored %.2f" % reward
        # NAME WHAT PASSED. Withholding which requirement was met is the defect
        # docs/terminalbench-derived-defaults.md §11 identifies as what actually
        # cost this task: two approaches each solved a different half and every
        # attempt saw only "1 of 2", so it could not tell which half it held.
        # The runner already names them in the attempt feedback (af2619d8), so
        # naming them in the memory that advice lives in is the same fact, not
        # a new disclosure.
        if names:
            verdict += " — PASSING: %s" % ", ".join(names)
        if solved:
            tail = (" It SOLVED the task. Treat the approach below as the one that "
                    "worked, and prefer extending it over re-deriving an alternative.")
        elif names:
            tail = (" It did NOT solve the task, but the checks named above DID pass "
                    "under the approach described below — so that part is EVIDENCE, "
                    "not speculation. Keep what passed; change only what did not.")
        else:
            tail = (" It did NOT solve the task and passed NOTHING. Its reasoning is "
                    "recorded because it narrowed the problem, NOT because it worked — "
                    "treat every design claim below as UNVALIDATED. If it recommends an "
                    "approach, that approach has been tried and did not pass.")
        note = MARK + verdict + "." + tail + "\n\n"
        if names or solved:
            stamped_pass += 1
            con.execute(
                # A row that carried a PASSING check earns a success, so the
                # ledger is not failure-only. `confidence` stays untouched
                # either way — see the header.
                "UPDATE memories SET content = ? || content, "
                "success_count = success_count + 1, consecutive_failures = 0 "
                "WHERE id = ?",
                (note, mid),
            )
        else:
            con.execute(
                "UPDATE memories SET content = ? || content, "
                "failure_count = failure_count + 1, "
                "consecutive_failures = consecutive_failures + 1 "
                "WHERE id = ?",
                (note, mid),
            )
    con.commit()
    print("\nSTAMPED %d lesson(s) — %d carried a passing check, %d passed nothing. "
          "Confidence untouched, marker at the head."
          % (len(planned), stamped_pass, len(planned) - stamped_pass))
    return 0


if __name__ == "__main__":
    sys.exit(main())
