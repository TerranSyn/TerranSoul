"""One-shot: remove duplicate INSERT-into-memories blocks from
mcp-data/shared/memory-seed.sql (audit 2026-06-02).

Guard-anchored: for each `WHERE source_hash = 'X'` guard, the block is the
text from the preceding `INSERT INTO memories` to the guard's `;`. Group by
source_hash; when 2+ blocks share a hash AND are byte-identical, keep the
first and delete the rest (+ a single preceding `-- ...` comment + blank
lines). A same-hash/different-content pair is a CONFLICT (the 2nd never loads
at runtime due to the guard) — reported, never auto-removed.
"""
from __future__ import annotations
import re, sys, shutil, datetime, collections
from pathlib import Path

SEED = Path("mcp-data/shared/memory-seed.sql")
text = SEED.read_text(encoding="utf-8")

# All memories-guard positions, in file order.
guard_re = re.compile(r"WHERE NOT EXISTS \(SELECT 1 FROM memories WHERE source_hash = '([^']+)'\);")
blocks: list[tuple[str, int, int]] = []  # (source_hash, start, end)
for m in guard_re.finditer(text):
    ins = text.rfind("INSERT INTO memories", 0, m.start())
    if ins < 0:
        continue
    blocks.append((m.group(1), ins, m.end()))

by_hash: dict[str, list[tuple[int, int]]] = collections.defaultdict(list)
for sh, s, e in blocks:
    by_hash[sh].append((s, e))

remove_spans: list[tuple[int, int]] = []
conflicts: list[str] = []
for sh, spans in by_hash.items():
    if len(spans) < 2:
        continue
    first_txt = text[spans[0][0]:spans[0][1]]
    for (s, e) in spans[1:]:
        if text[s:e] != first_txt:
            conflicts.append(sh)
            continue
        # extend start back over blank lines + one preceding comment line
        ls = s
        while ls - 1 > 0 and text[ls - 2] == "\n":
            ls -= 1
        pnl = text.rfind("\n", 0, ls - 1)
        prev = text[pnl + 1:ls - 1] if pnl >= 0 else ""
        if prev.strip().startswith("--"):
            ls = pnl + 1
            while ls - 1 > 0 and text[ls - 2] == "\n":
                ls -= 1
        remove_spans.append((ls, e))

print(f"memories blocks={len(blocks)} distinct={len(by_hash)} "
      f"identical-dups-to-remove={len(remove_spans)} conflicts={sorted(set(conflicts))}")
for sh in sorted(set(conflicts)):
    a, b = by_hash[sh][0], by_hash[sh][1]
    print(f"\nCONFLICT {sh}:")
    print("  [1]", text[a[0]:a[1]][:140].replace("\n", " "))
    print("  [2]", text[b[0]:b[1]][:140].replace("\n", " "))

if "--apply" not in sys.argv:
    print("\n(dry-run; pass --apply to write)")
    sys.exit(0)

ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
backup = SEED.with_name(SEED.name + f".predupe-{ts}")
shutil.copy2(SEED, backup)
out = text
for s, e in sorted(remove_spans, reverse=True):
    end = e
    while end < len(out) and out[end] == "\n":
        end += 1
    out = out[:s] + out[end:]
out = re.sub(r"\n{4,}", "\n\n\n", out)

# Re-scan: identical dups gone (conflicts may remain at 2).
post = collections.Counter(guard_re.findall(out))
still = {k: v for k, v in post.items() if v > 1 and k not in conflicts}
assert not still, f"unexpected dups remain: {still}"

# Structural integrity: `out` must be `text` with EXACTLY the removed spans
# deleted (+ blank-run normalisation) — never a partial-statement cut.
removed_text = "".join(text[s:e] for s, e in sorted(remove_spans))
assert all(text[s:e].rstrip().endswith(");") for s, e in remove_spans), \
    "a removal span did not end at a complete statement"
assert all("INSERT INTO memories" in text[s:e] for s, e in remove_spans), \
    "a removal span is not a memories INSERT block"
# Every memories INSERT in `out` is still a complete `INSERT ... );` statement.
for m in guard_re.finditer(out):
    ins = out.rfind("INSERT INTO memories", 0, m.start())
    assert ins >= 0 and out[ins:m.end()].count("INSERT INTO memories") == 1, \
        "block boundary corrupted"
print(f"structural check OK (removed {len(removed_text)} bytes across "
      f"{len(remove_spans)} blocks)")
SEED.write_text(out, encoding="utf-8")
print(f"removed {len(remove_spans)} identical duplicate block(s); backup -> {backup.name}")
