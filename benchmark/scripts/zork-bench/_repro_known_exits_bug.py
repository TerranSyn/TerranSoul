"""Repro: _known_exits is never populated, so visited_dirs is always empty.

Run from repo root: python benchmark/scripts/zork-bench/_repro_known_exits_bug.py
"""
import re
from pathlib import Path

src = Path(__file__).parent / "terransoul_brain_bridge.py"
raw = src.read_text(encoding="utf-8")

# Strip Python comments first (anything from `#` to end-of-line that
# isn't inside a string). Cheap heuristic — good enough since we only
# need to distinguish executable writes from doc-comments.
def _strip_comments(s: str) -> str:
    out_lines = []
    for ln in s.splitlines():
        in_str = False
        quote = ""
        i = 0
        while i < len(ln):
            ch = ln[i]
            if in_str:
                if ch == "\\":
                    i += 2; continue
                if ch == quote:
                    in_str = False
            else:
                if ch in ("'", '"'):
                    in_str = True; quote = ch
                elif ch == "#":
                    ln = ln[:i]; break
            i += 1
        out_lines.append(ln)
    return "\n".join(out_lines)

text = _strip_comments(raw)

write_re = re.compile(
    r"(?:self|mm)\._known_exits\s*(?:\[[^\]]*\]\s*=|\.setdefault|\.update|\.pop)"
)
writes = [(m.start(), text[m.start():m.start()+80].splitlines()[0]) for m in write_re.finditer(text)]

# Find all reads.
read_re = re.compile(r"(?:self|mm)\._known_exits\.get\(")
reads = [m.start() for m in read_re.finditer(text)]

print(f"writes_to_known_exits = {len(writes)}")
for off, line in writes:
    print(f"  @{off}: {line}")
print(f"reads_from_known_exits = {len(reads)}")
for off in reads:
    snippet = text[off:off+120].splitlines()[0]
    print(f"  @{off}: {snippet}")

# Verdict
if not writes and reads:
    print("\nBUG CONFIRMED: planner reads _known_exits but nothing ever writes it.")
    print("Effect: visited_dirs always empty -> every exit gets FRONTIER_BONUS forever.")
else:
    print("\nNo bug shape detected.")
