"""Clean orphaned rows in supporting tables after main purge."""
import sqlite3
c = sqlite3.connect('mcp-data/memory.db')
cur = c.cursor()

def count(sql, params=()):
    return cur.execute(sql, params).fetchone()[0]

print(f"memories rows               : {count('SELECT COUNT(*) FROM memories')}")
print(f"memory_edges rows (before)  : {count('SELECT COUNT(*) FROM memory_edges')}")

# Delete orphan edges
cur.execute(
    "DELETE FROM memory_edges WHERE src_id NOT IN (SELECT id FROM memories) "
    "OR dst_id NOT IN (SELECT id FROM memories)"
)
print(f"orphan edges deleted        : {cur.rowcount}")

# Clean other reference tables
for tbl, col in [
    ('memory_embeddings', 'memory_id'),
    ('memory_versions', 'memory_id'),
    ('memory_reinforcements', 'memory_id'),
    ('memory_conflicts', 'memory_id_a'),
    ('memory_conflicts', 'memory_id_b'),
    ('pending_embeddings', 'memory_id'),
    ('memory_offload_payloads', 'memory_id'),
    ('memory_gaps', 'memory_id'),
]:
    try:
        cur.execute(f'PRAGMA table_info({tbl})')
        cols = [r[1] for r in cur.fetchall()]
        if col not in cols:
            continue
        cur.execute(f"DELETE FROM {tbl} WHERE {col} NOT IN (SELECT id FROM memories)")
        if cur.rowcount > 0:
            print(f"  {tbl}.{col}: deleted {cur.rowcount} orphan rows")
    except sqlite3.OperationalError as e:
        print(f"  {tbl}: {e}")

# Rebuild FTS5 index (it should be trigger-synced but verify)
try:
    cur.execute("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
    print("memories_fts rebuilt")
except sqlite3.OperationalError as e:
    print(f"  fts rebuild: {e}")

c.commit()
cur.execute("VACUUM")
c.commit()

print(f"\nmemory_edges rows (after)   : {count('SELECT COUNT(*) FROM memory_edges')}")
print(f"memories rows (final)       : {count('SELECT COUNT(*) FROM memories')}")
