"""Inventory + optionally purge Zork-domain memories from the brain DB.

Usage:
    python purge_zork_pollution.py            # dry-run, just counts
    python purge_zork_pollution.py --execute  # delete + vacuum

Per rules/bench-agi-purity.md Rule 1: bench iters must start TASK-NAÏVE.
Memories ingested by prior bench runs (an internal work item.5/1.6, spec-007..013)
contain literal Zork walkthroughs, room/object names, and trajectory
replays. They violate AGI-1 (task-naïve start) and AGI-7 (bench-independent
harness). This script removes them so the next iter is a fair AGI test.
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[3] / "mcp-data" / "memory.db"

# Tag-based: anything tagged with a domain noun.
# IMPORTANT: SQL LIKE '_' is a single-char wildcard. Use ESCAPE '\' to match
# the literal underscore in tag names like loc_<room>, bench-terransoul-brain.
TAG_PATTERNS = [
    "%zork%",
    "%loc\\_%",          # loc_<room> from prior episode reflections
    "%west\\_house%",
    "%bench-terransoul-brain%",
]

# Content-based: any memory containing Zork-specific entities.
# Use word-boundary-ish patterns (leading/trailing spaces or punctuation) to
# avoid catching unrelated words. SQL LIKE has no \b, so combine multiple
# bounded variants per noun.
CONTENT_PATTERNS = [
    # Multi-word phrases — already specific.
    "%white house%",
    "%west of house%",
    "%trophy case%",
    "%loud room%",
    "%coal mine%",
    "%troll room%",
    "%living room%",            # Zork-specific layout (also catches unrelated; gated by tags)
    # Single nouns — require word boundary (space/punctuation around).
    "% troll %", "% troll.%", "% troll,%", "%a troll%", "%the troll%",
    "% leaflet%", "%a leaflet%", "%the leaflet%",
    "% grue%", "%a grue%", "%the grue%",
    "% mailbox%", "%a mailbox%", "%the mailbox%",
    "%frobozz%",
    "%kobold%",
    "%cyclops%",
    "%zork %", "%zork.%", "%zork,%", "%zork1%", "%zorkgpt%",
    "%jericho%",
    "%z-machine%",
]


def where_clause() -> tuple[str, list[str]]:
    parts: list[str] = []
    params: list[str] = []
    for p in TAG_PATTERNS:
        parts.append(r"LOWER(tags) LIKE ? ESCAPE '\'")
        params.append(p.lower())
    for p in CONTENT_PATTERNS:
        parts.append(r"LOWER(content) LIKE ? ESCAPE '\'")
        params.append(p.lower())
    return " OR ".join(parts), params


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="actually delete (default: dry-run)")
    args = ap.parse_args()

    if not DB.exists():
        raise SystemExit(f"DB not found: {DB}")

    conn = sqlite3.connect(str(DB))
    cur = conn.cursor()

    total = cur.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    where, params = where_clause()

    matched = cur.execute(f"SELECT COUNT(*) FROM memories WHERE {where}", params).fetchone()[0]
    print(f"DB           : {DB}")
    print(f"total rows   : {total}")
    print(f"matched      : {matched}  ({matched/total*100:.1f}%)")

    # Break down by category
    for label, sql, p in [
        ("zork tag       ", "LOWER(tags) LIKE '%zork%'", []),
        ("loc_ tag       ", "LOWER(tags) LIKE '%loc_%'", []),
        ("content: troll ", "LOWER(content) LIKE '%troll%'", []),
        ("content: leaflet", "LOWER(content) LIKE '%leaflet%'", []),
        ("content: mailbox", "LOWER(content) LIKE '%mailbox%'", []),
        ("content: grue  ", "LOWER(content) LIKE '%grue%'", []),
        ("content: ZorkGPT", "LOWER(content) LIKE '%zorkgpt%'", []),
    ]:
        n = cur.execute(f"SELECT COUNT(*) FROM memories WHERE {sql}", p).fetchone()[0]
        print(f"  {label}: {n}")

    # Sample 5 ids that would be deleted, for human spot-check
    print("\nSample matched rows (id, tags, first 100 chars):")
    for row in cur.execute(
        f"SELECT id, tags, SUBSTR(content, 1, 100) FROM memories WHERE {where} ORDER BY id LIMIT 5",
        params,
    ):
        print(f"  id={row[0]} tags={row[1]} content={row[2]!r}")

    if not args.execute:
        print("\nDRY-RUN — re-run with --execute to delete.")
        return

    print("\nDeleting...")
    cur.execute(f"DELETE FROM memories WHERE {where}", params)
    deleted = cur.rowcount
    # Cascade: clean memory_edges referencing deleted ids would be ideal, but
    # foreign keys are typically enabled; safe to also vacuum.
    conn.commit()
    print(f"deleted {deleted} rows")
    # Also clean orphan edges
    try:
        cur.execute(
            "DELETE FROM memory_edges WHERE src_memory_id NOT IN (SELECT id FROM memories) "
            "OR dst_memory_id NOT IN (SELECT id FROM memories)"
        )
        edge_deleted = cur.rowcount
        conn.commit()
        print(f"deleted {edge_deleted} orphan edges")
    except sqlite3.OperationalError as exc:
        print(f"(edge cleanup skipped: {exc})")
    cur.execute("VACUUM")
    conn.commit()
    print("vacuumed")

    after = cur.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    print(f"rows after   : {after}")


if __name__ == "__main__":
    main()
