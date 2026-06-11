"""Read-only audit of mcp-data/memory.db for duplicate clusters.

Shows: total rows, exact-content dup groups, redundant rows, and the
top dup clusters by size + by tier/cognitive_kind.
"""
import sqlite3

c = sqlite3.connect("file:mcp-data/memory.db?mode=ro", uri=True)
cur = c.cursor()

cur.execute("SELECT COUNT(*) FROM memories")
total = cur.fetchone()[0]
cur.execute("SELECT COUNT(DISTINCT content) FROM memories")
unique = cur.fetchone()[0]

cur.execute("SELECT COUNT(*), COALESCE(SUM(c-1), 0) FROM (SELECT content, COUNT(*) c FROM memories GROUP BY content HAVING c > 1)")
groups, redundant = cur.fetchone()

print(f"TOTAL rows         : {total}")
print(f"UNIQUE content     : {unique}")
print(f"DUP groups (>=2)   : {groups}")
print(f"REDUNDANT rows     : {redundant}  ({(redundant/total*100):.1f}%)")
print()

print("--- top 10 exact-content duplicate clusters ---")
cur.execute(
    "SELECT COUNT(*) c, MIN(id) min_id, MAX(id) max_id, SUBSTR(content,1,80) preview "
    "FROM memories GROUP BY content HAVING c > 1 ORDER BY c DESC LIMIT 10"
)
for c_count, min_id, max_id, preview in cur.fetchall():
    print(f"  x{c_count:4d}  ids {min_id}..{max_id}  | {preview!r}")
print()

print("--- by cognitive_kind ---")
cur.execute(
    "SELECT cognitive_kind, COUNT(*) "
    "FROM memories GROUP BY cognitive_kind ORDER BY 2 DESC"
)
for k, n in cur.fetchall():
    print(f"  {k!s:20s}  {n}")
print()

print("--- procedural-shard near-duplicates by tag prefix (zork TRIED actions etc.) ---")
cur.execute(
    "SELECT SUBSTR(tags,1,60) tag_prefix, COUNT(*) n "
    "FROM memories WHERE cognitive_kind='procedural' "
    "GROUP BY tag_prefix ORDER BY n DESC LIMIT 10"
)
for tp, n in cur.fetchall():
    print(f"  {n:5d}  {tp!r}")
