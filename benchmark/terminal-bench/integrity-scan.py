#!/usr/bin/env python3
"""Detect trials that reached the BENCHMARK'S OWN material instead of solving the task.

WHY THIS EXISTS
---------------
Terminal-Bench 2's tasks live in a PUBLIC repo, together with each task's oracle
`solve.sh`, its grading `test_outputs.py`, and its reference artifacts. Nothing in
the container stops an agent from searching for them.

On 2026-08-08 exactly that happened. `build-pov-ray` had failed twice, so the
extra-instruction's "after two scored failures, consult external sources" clause
fired, and the agent searched for `github.com laude-institute terminal-bench-2
build-pov-ray tests test.sh`, pulled the oracle `solve.sh`, the grading
`test_outputs.py` and `reference_illum1.png`, reproduced the grader's SSIM check
locally, and passed. It then wrote the discovery into the shared bench brain as a
GENERALISED directive:

    "On ANY terminal-bench-shaped task, check for a public task repo and pull its
     solution/tests FIRST, before reverse-engineering from build fingerprints."

That row (id 1348, access_count 23) was retrievable by every later task in the
sweep, which makes this a self-propagating scoring exploit rather than a one-off.
It was purged, but purging is a cure, not a control.

THE CONTROL
-----------
Detection here is deliberately POST-HOC and INVISIBLE TO THE AGENT, so it can be
turned on mid-sweep without breaking cohort uniformity: it changes only how a
trial is SCORED, never what the agent experiences. A trial that reached the
answer key is worth 0 whatever its verifier said, so the exploit stops paying.

WHAT COUNTS AS A HIT
--------------------
URL-shaped references to the benchmark's OWN material only. Matching the bare
string "terminal-bench" would fire on almost every trial, because trajectories
embed `brain_search` results and several legitimate lessons discuss the harness
by name. Legitimate upstream dependencies stay clean by construction: a task that
must clone `github.com/AbsInt/CompCert` or fetch MobileSAM weights from
`raw.githubusercontent.com/ChaoningZhang/...` is untouched, because neither host+path
belongs to the benchmark.

usage:
    integrity-scan.py <jobs-dir> [--brain <memory.db>] [--write <quarantine.txt>]

exit 0 = clean, 1 = contamination found, 2 = usage error.
"""
import glob
import json
import os
import re
import sqlite3
import sys

# Host+path patterns for the benchmark's own material. Anchored on the ORG or the
# benchmark's own domains so unrelated github repos never match.
BENCH_URL = re.compile(
    r"""https?://[^\s"'\\<>]*?(
          (github|githubusercontent|codeload)\.com/(laude-institute|harbor-framework)
        | tbench\.ai
        | deepwiki\.com/[^\s"'\\<>]*terminal-bench
        | huggingface\.co/datasets/[^\s"'\\<>]*terminal-bench
        | agnxi\.com/[^\s"'\\<>]*/skills/
    )[^\s"'\\<>]*""",
    re.I | re.X,
)

# Secondary signal: an agent that never emitted a matching URL but is nonetheless
# discussing the oracle by name. Kept separate because these words also appear in
# honest reasoning ("I should not look for a solve.sh"), so they are REPORTED but
# do not by themselves quarantine a trial.
SOFT = re.compile(r"oracle (solution|solve|script)|answer key|the official solve", re.I)


def scan_jobs(jobs_dir):
    hard, soft = [], []
    for td in sorted(glob.glob(os.path.join(jobs_dir, "*", "*", ""))):
        tj = os.path.join(td, "agent", "trajectory.json")
        if not os.path.exists(tj):
            continue
        try:
            with open(tj, encoding="utf-8", errors="replace") as fh:
                blob = fh.read()
        except OSError:
            continue
        p = td.rstrip("/\\")
        trial = os.path.basename(p)
        job = os.path.basename(os.path.dirname(p))
        urls = sorted({m.group(0)[:160] for m in BENCH_URL.finditer(blob)})
        if urls:
            hard.append((trial, job, urls))
        elif SOFT.search(blob):
            soft.append((trial, job, SOFT.search(blob).group(0)))
    return hard, soft


def scan_brain(db):
    """Rows in a brain store that carry the benchmark's own material forward."""
    if not os.path.exists(db):
        return []
    con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    try:
        cur = con.cursor()
        cur.execute("SELECT id, content, access_count FROM memories")
        out = []
        for rid, content, ac in cur.fetchall():
            hit = BENCH_URL.search(content or "")
            if hit:
                out.append((rid, ac, hit.group(0)[:120], (content or "")[:160].replace("\n", " ")))
        return out
    finally:
        con.close()


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-3], file=sys.stderr)
        return 2
    jobs_dir = argv[1]
    brain = None
    write_to = None
    i = 2
    while i < len(argv):
        if argv[i] == "--brain" and i + 1 < len(argv):
            brain, i = argv[i + 1], i + 2
        elif argv[i] == "--write" and i + 1 < len(argv):
            write_to, i = argv[i + 1], i + 2
        else:
            print("integrity-scan: unknown arg %r" % argv[i], file=sys.stderr)
            return 2

    hard, soft = scan_jobs(jobs_dir)
    rows = scan_brain(brain) if brain else []

    print("── benchmark-integrity scan ────────────────────────────────")
    print("  jobs dir            : %s" % jobs_dir)
    print("  trials reaching the benchmark's own material : %d" % len(hard))
    for trial, job, urls in hard:
        print("    QUARANTINE %-28s %s" % (trial, job))
        for u in urls[:4]:
            print("        %s" % u)
    if soft:
        print("  trials mentioning an oracle without fetching : %d (reported, NOT quarantined)" % len(soft))
        for trial, job, w in soft[:10]:
            print("    note       %-28s %-30s %r" % (trial, job, w))
    if brain:
        print("  brain rows carrying benchmark material       : %d  (%s)" % (len(rows), brain))
        for rid, ac, u, snip in rows:
            print("    ROW id=%-6s access=%-4s %s" % (rid, ac, u))
            print("        %s" % snip)

    if write_to:
        with open(write_to, "w", encoding="utf-8") as fh:
            for trial, _job, _urls in hard:
                fh.write(trial + "\n")
        print("  quarantine list written : %s (%d trial(s))" % (write_to, len(hard)))

    if hard or rows:
        print("\n  RESULT: CONTAMINATED — quarantined trials score 0.0; purge the brain rows")
        print("  (rules/bench-agi-purity.md: never shortcut a bench)")
        return 1
    print("\n  RESULT: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
