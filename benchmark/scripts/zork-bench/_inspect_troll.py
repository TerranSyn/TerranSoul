import sqlite3
con = sqlite3.connect("mcp-data/memory.db")
cur = con.cursor()
rows = cur.execute(
    "SELECT id, cognitive_kind, substr(tags,1,80), substr(content,1,250) "
    "FROM memories WHERE content LIKE '%troll%' OR tags LIKE '%troll%' LIMIT 30"
).fetchall()
for r in rows:
    print(f"id={r[0]} kind={r[1]} tags={r[2]!r}")
    print(f"  content: {r[3]!r}")
    print()
print(f"total={len(rows)}")
