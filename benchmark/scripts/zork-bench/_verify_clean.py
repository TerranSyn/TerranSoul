"""Verify the live MCP brain DB has zero pre-trained Zork content.

Uses word-boundary regex to avoid false positives (e.g. 'controlled'
contains the substring 'troll').
"""
import re
import sqlite3
import sys

DB = "mcp-data/memory.db"

WORD_PATTERNS = [
    r"\btroll\b",
    r"\bleaflet\b",
    r"\bmailbox\b",
    r"\bgrue\b",
    r"\bwhite house\b",
    r"\bwest of house\b",
    r"\btrophy case\b",
    r"\bfrobozz\b",
    r"\bkobold\b",
    r"\bcyclops\b",
    r"\bcoal mine\b",
    r"\bpile of leaves\b",
    r"\btrapdoor\b",
    r"\blantern\b",
    r"\bzorkgpt\b",
    r"\bjericho\b",
    r"\bz-machine\b",
    r"\bzork1\b",
    r"\bwest_house\b",
    r"\bliving_room\b",
]

compiled = [(p, re.compile(p, re.IGNORECASE)) for p in WORD_PATTERNS]

con = sqlite3.connect(DB)
cur = con.cursor()
all_rows = cur.execute("SELECT id, cognitive_kind, tags, content FROM memories").fetchall()
total = 0
per_pattern = {p: 0 for p, _ in compiled}
hits = []
for mid, kind, tags, content in all_rows:
    blob = f"{tags or ''}\n{content or ''}"
    matched = False
    for p, rx in compiled:
        if rx.search(blob):
            per_pattern[p] += 1
            if not matched:
                total += 1
                matched = True
            if len(hits) < 25:
                hits.append((mid, kind, p, (content or '')[:200]))

for p, n in per_pattern.items():
    if n:
        print(f"  HIT  {p!r:25} -> {n} rows")
if hits:
    print("\nFirst hits:")
    for mid, kind, p, snippet in hits:
        print(f"  id={mid} kind={kind} pattern={p!r}")
        print(f"    {snippet!r}")
print(f"\nTOTAL rows with game-content: {total}")
print(f"memories total: {len(all_rows)}")
sys.exit(0 if total == 0 else 1)
