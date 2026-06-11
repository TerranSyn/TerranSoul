"""List tables + relevant FK columns in memory.db (read-only)."""
import sqlite3

c = sqlite3.connect("file:mcp-data/memory.db?mode=ro", uri=True)
cur = c.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
print("TABLES:", tables)
print()

# For any table referencing memories.id, dump its schema.
for t in tables:
    cur.execute(f"PRAGMA table_info({t})")
    cols = cur.fetchall()
    refs = [c[1] for c in cols if c[1].endswith("_id") or c[1] == "memory_id"]
    if refs:
        print(f"{t}: cols with *_id = {refs}")
