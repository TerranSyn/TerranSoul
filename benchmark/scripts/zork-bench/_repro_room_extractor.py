"""K23 reproduce-first — verify _extract_room_from_obs heuristic.

Generic room-heading extractor; no Zork-specific tokens. Validates
realistic Zork observations (West of House, Forest, Forest Path,
Behind House, North of House, Clearing, Kitchen, etc.) plus
non-room observations that should return "".
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BRIDGE = ROOT / "terransoul_brain_bridge.py"
spec = importlib.util.spec_from_file_location("ts_bridge", BRIDGE)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules["ts_bridge"] = mod
spec.loader.exec_module(mod)
extract = mod._extract_room_from_obs


CASES: list[tuple[str, str]] = [
    # (observation, expected_room)
    ("West of House You are standing in an open field west of a white house, with a boarded front door. There is a small mailbox here.", "West of House"),
    ("Forest This is a forest, with trees in all directions. To the east, there appears to be sunlight.", "Forest"),
    ("Forest Path This is a path winding through a dimly lit forest.", "Forest Path"),
    ("Behind House You are behind the white house. A path leads into the forest to the east.", "Behind House"),
    ("North of House You are facing the north side of a white house.", "North of House"),
    ("Clearing You are in a clearing, with a forest surrounding you on all sides.", "Clearing"),
    ("Kitchen You are in the kitchen of the white house. A table seems to have been used recently.", "Kitchen"),
    ("Living Room You are in the living room. There is a doorway to the east.", "Living Room"),
    # Newline-preserved variant
    ("Forest\nThis is a forest, with trees in all directions.", "Forest"),
    # Non-room — pure response text
    ("You are empty handed.", ""),
    ("Maximum verbosity.", ""),
    ("It is already open.", ""),
    ("", ""),
]


def main() -> int:
    fails: list[str] = []
    for obs, expected in CASES:
        got = extract(obs)
        ok = got == expected
        marker = "PASS" if ok else "FAIL"
        if not ok:
            fails.append(f"  obs={obs[:60]!r} expected={expected!r} got={got!r}")
        print(f"[{marker}] {expected!r:32}  ←  {obs[:55]!r}")
    if fails:
        print("\n=== FAILURES ===")
        for f in fails:
            print(f)
        return 1
    print(f"\nAll {len(CASES)}/{len(CASES)} cases PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
