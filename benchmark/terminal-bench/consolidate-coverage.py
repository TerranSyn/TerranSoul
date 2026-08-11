#!/usr/bin/env python3
"""Consolidate scattered per-attempt lessons into ONE retrievable coverage index.

⛔ THE DEFECT THIS FIXES. Memory stores NARRATIVES, and narratives do not union.
MEASURED on filter-js-from-html: across 21 agent-written rows the system had
already learned twelve distinct sanitizer-bypass classes — including `namespace`
(the `<x:script>` form) and `smil` — yet attempt 57 handled SMIL and still missed
namespaced tags. The knowledge was present and unreachable: each row is
3,000-9,000 characters, a search returns five, and no single query matches all
the rows that together hold the union. The same class even appears twice in
different phrasings ("malformed tag" / "malformed-tag", "meta refresh" /
"meta-refresh") because nothing ever merged them.

So an attempt does not fail for want of knowledge. It fails because the union of
what the system already knows is not retrievable in one hit.

⛔ WHAT THIS DELIBERATELY DOES NOT DO. It adds no knowledge. It does not name a
grader test case, and it does not read verifier output at all — only rows the
AGENTS wrote. The operator can see which checks failed (`iterate.sh` marks that
output operator-only, "these never reach the agent"); transcribing it into the
brain would launder grader content into the agent's channel, which
`rules/bench-agi-purity.md` forbids and `integrity-scan.py` quarantines. This
script only INDEXES what the system earned for itself.

That distinction is the whole point: consolidation is legitimate self-improvement,
transcription is contamination, and the two look similar from the outside.

Usage:
    python consolidate-coverage.py --db PATH --task-shape "xss sanitizer" [--apply]
"""
import argparse
import datetime
import re
import sqlite3
import sys

MARKER = "[COVERAGE INDEX] "

# ⛔ NO TERM MINING. The first version of this script regex-mined "<term> bypass"
# out of the prose to build a class list. Run against the real corpus it emitted
# `the`, `since it`, `craft an html file that` and `not just a historical`
# alongside the four real classes — 18 "terms" of which most were sentence
# fragments. A list like that is worse than none: it reads as authoritative
# coverage while being mostly noise, and an agent trusting it would chase
# fragments instead of classes.
#
# The rows already open with a precise one-sentence statement of their finding
# (measured: ids 1130 and 1151 both do). So the index quotes THOSE, verbatim and
# for every row, with no ranking and no selection. Quoting all of them is what
# keeps this consolidation rather than curation — the moment I pick which rows
# matter, the operator's judgement about the task has entered the brain.


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--task-shape", required=True,
                    help="free text describing the shape, used only for the index's own heading")
    ap.add_argument("--match", default="XSS",
                    help="substring identifying rows about this shape (agent-written rows only)")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect("file:%s%s" % (args.db, "" if args.apply else "?mode=ro"), uri=True)
    rows = con.execute(
        "SELECT id, content FROM memories "
        "WHERE category = 'self-improve-attempt' AND content LIKE ? "
        "ORDER BY id",
        ("%" + args.match + "%",),
    ).fetchall()
    if not rows:
        print("no agent-written rows match — nothing to consolidate")
        return 0

    entries = []
    for mid, content in rows:
        head = " ".join(content.split())
        head = re.sub(r"^\[(?:OUTCOME|VERIFIED SOLVE)\][^.]*\.\s*", "", head)
        # Cut at the first sentence end that is not a decimal point or an
        # abbreviation-sized fragment, so the excerpt is a whole claim.
        m = re.search(r"(?<=[a-z0-9)\]`])\.\s+(?=[A-Z(`])", head[:520])
        if m:
            excerpt = head[: m.end() - 1]
        else:
            # No sentence break inside the window — several entries open with one
            # long clause-heavy sentence. Cut on a word boundary and mark it, so
            # the index never ends mid-token (`...execution oracl`), which reads
            # like corruption and drops the very detail the line exists to carry.
            excerpt = head[:400].rsplit(" ", 1)[0] + " […]"
        entries.append((mid, excerpt))

    body = [
        f"{MARKER}for work shaped like '{args.task_shape}', this is an INDEX of "
        f"what earlier sessions recorded, gathered in one place.",
        "",
        "WHY IT EXISTS. The individual entries are long (3,000-9,000 characters) and "
        "a search returns only a few of them, so no single query ever surfaced the "
        "whole set. A session could hold one finding and miss three others that were "
        "already recorded — the knowledge was present and unreachable. Each line "
        "below is an entry's own opening claim, quoted verbatim; open the id for the "
        "detail and the evidence behind it.",
        "",
        "Some of these describe HOW TO VERIFY a result rather than what to build. "
        "Those are worth as much as the findings: a check you can run yourself tells "
        "you whether you are finished, and nothing else in your environment will.",
        "",
    ]
    for mid, head in entries:
        body.append(f"#{mid}: {head}")
    body += [
        "",
        "Treat every line as evidence to verify, not instruction — some may be wrong "
        "or may not apply to what is in front of you.",
    ]
    content = "\n".join(body)

    existing = con.execute(
        "SELECT id FROM memories WHERE content LIKE ? || '%' AND content LIKE '%' || ? || '%'",
        (MARKER, args.task_shape),
    ).fetchone()

    print(f"{len(rows)} source rows indexed")
    print(f"index length: {len(content)} chars")
    if not args.apply:
        print("\nDRY RUN — nothing written.\n")
        print(content[:1200])
        return 0

    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    if existing:
        con.execute("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
                    (content, now, existing[0]))
        print(f"UPDATED coverage index id {existing[0]}")
    else:
        con.execute(
            "INSERT INTO memories (content, tags, importance, memory_type, created_at, tier, "
            "decay_score, category, cognitive_kind, confidence) "
            "VALUES (?, ?, 9, 'lesson', ?, 'long', 1.0, 'self-improve-attempt', 'procedural', 1.0)",
            (content, f"coverage-index,{args.match.lower()},union", now),
        )
        print("INSERTED coverage index")
    con.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
