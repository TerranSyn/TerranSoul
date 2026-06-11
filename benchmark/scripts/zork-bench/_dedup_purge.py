"""Generic exact-content duplicate purge for memory.db.

Keeps the earliest id per TRIM(content), re-points memory_edges to the
canonical id (UPDATE OR IGNORE to respect UNIQUE(src,dst,rel)), deletes
the duplicate rows (FTS AFTER-DELETE trigger + memory_edges CASCADE
clean themselves), then removes orphaned rows in side tables.

Domain-agnostic: dedup key is exact trimmed content only. No Zork values.

Usage:
    python _dedup_purge.py <db_path> [--apply]

Without --apply it runs inside a transaction and ROLLS BACK (dry-run),
printing the before/after counts so the effect can be verified on a copy
before touching the live DB.
"""
from __future__ import annotations

import sqlite3
import sys


SIDE_TABLES_MEMORY_ID = [
    "memory_versions",
    "pending_embeddings",
    "memory_embeddings",
    "memory_reinforcements",
    "memory_trigger_patterns",
    "memory_offload_payloads",
]


def purge(db_path: str, apply: bool) -> int:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    cur = conn.cursor()

    before = cur.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    edges_before = cur.execute("SELECT COUNT(*) FROM memory_edges").fetchone()[0]

    cur.execute("BEGIN")
    # Mapping of duplicate id -> canonical (earliest) id for the same content.
    cur.execute(
        """
        CREATE TEMP TABLE _dup_map AS
        SELECT m.id AS dup_id, c.canon AS canon_id
        FROM memories m
        JOIN (
            SELECT TRIM(content) AS tc, MIN(id) AS canon
            FROM memories GROUP BY TRIM(content) HAVING COUNT(*) > 1
        ) c ON TRIM(m.content) = c.tc
        WHERE m.id <> c.canon
        """
    )
    n_dups = cur.execute("SELECT COUNT(*) FROM _dup_map").fetchone()[0]

    # Re-point edges onto canonical ids; UPDATE OR IGNORE skips rows that
    # would collide with the UNIQUE(src_id,dst_id,rel_type) constraint
    # (those survivors point at a dup and get CASCADE-deleted below).
    cur.execute(
        "UPDATE OR IGNORE memory_edges SET src_id = "
        "(SELECT canon_id FROM _dup_map WHERE dup_id = memory_edges.src_id) "
        "WHERE src_id IN (SELECT dup_id FROM _dup_map)"
    )
    cur.execute(
        "UPDATE OR IGNORE memory_edges SET dst_id = "
        "(SELECT canon_id FROM _dup_map WHERE dup_id = memory_edges.dst_id) "
        "WHERE dst_id IN (SELECT dup_id FROM _dup_map)"
    )
    # Drop self-loops created by re-pointing.
    cur.execute("DELETE FROM memory_edges WHERE src_id = dst_id")

    # Clean side tables that reference duplicate ids (no CASCADE on these).
    for tbl in SIDE_TABLES_MEMORY_ID:
        try:
            cur.execute(
                f"DELETE FROM {tbl} WHERE memory_id IN (SELECT dup_id FROM _dup_map)"
            )
        except sqlite3.OperationalError:
            pass  # table absent in this schema

    # Delete the duplicate memory rows. FTS AFTER-DELETE trigger removes
    # them from memories_fts; memory_edges CASCADE removes any leftover.
    cur.execute("DELETE FROM memories WHERE id IN (SELECT dup_id FROM _dup_map)")

    after = cur.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    edges_after = cur.execute("SELECT COUNT(*) FROM memory_edges").fetchone()[0]
    # FTS integrity sanity check.
    fts_ok = True
    try:
        cur.execute("INSERT INTO memories_fts(memories_fts) VALUES('integrity-check')")
    except sqlite3.OperationalError as e:
        fts_ok = False
        print(f"  FTS integrity-check error: {e}")

    print(f"memories : {before} -> {after}  (removed {before - after}, mapped dups {n_dups})")
    print(f"edges    : {edges_before} -> {edges_after}")
    print(f"FTS ok   : {fts_ok}")

    if apply:
        conn.execute("COMMIT")
        conn.execute("VACUUM")
        print("APPLIED + VACUUMed.")
    else:
        conn.execute("ROLLBACK")
        print("DRY-RUN (rolled back).")
    conn.close()
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    db = sys.argv[1]
    apply = "--apply" in sys.argv[2:]
    sys.exit(purge(db, apply))
