import sqlite3
c = sqlite3.connect('mcp-data/memory.db')
cur = c.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
print('tables:', tables)
for t in ('memory_edges', 'memories'):
    if t in tables:
        cur.execute(f'PRAGMA table_info({t})')
        cols = cur.fetchall()
        print(f'{t} cols:')
        for col in cols:
            print(' ', col)
        cnt = cur.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
        print(f'  rows: {cnt}')
# Try common edge column name variants
for src_col, dst_col in [('source_id','target_id'), ('from_id','to_id'), ('src_id','dst_id'), ('memory_a','memory_b'), ('parent_id','child_id')]:
    try:
        cur.execute(f"SELECT COUNT(*) FROM memory_edges WHERE {src_col} NOT IN (SELECT id FROM memories) OR {dst_col} NOT IN (SELECT id FROM memories)")
        orphans = cur.fetchone()[0]
        print(f'orphans by ({src_col},{dst_col}): {orphans}')
    except Exception as e:
        pass
