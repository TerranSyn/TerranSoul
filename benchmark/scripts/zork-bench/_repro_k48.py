"""K48 reproducer (P8 — sub-10s repro).

Validates that the new container-reveal pattern extracts items revealed
by container actions (reveals/contains/holds) WITHOUT introducing the
K47/K47b scenery traps (forest/trees/pile of leaves).

Positive cases — must extract the named object:
  A. "Opening the small mailbox reveals a leaflet."  -> leaflet
  B. "The chest contains a brass lantern."            -> brass lantern
  C. "The bag holds a small rope."                    -> rope (or small rope)

Negative cases — must NOT extract scenery:
  D. "This is a forest, with trees in all directions." -> no extraction
  E. "On the ground is a pile of leaves."              -> no leaves/pile
  F. "There are mountains all around."                 -> no mountains
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from terransoul_brain_bridge import BrainMemoryManager  # type: ignore  # noqa: E402


def main() -> int:
    # _extract_objects only uses self._OBJ_PATTERNS / self._STRUCTURAL_STOPWORDS,
    # so an unconstructed instance via __new__ is sufficient and dodges __init__
    # side effects (MCP probing, etc.).
    km = BrainMemoryManager.__new__(BrainMemoryManager)
    cases: list[tuple[str, str, str]] = [
        ("A", "Opening the small mailbox reveals a leaflet.", "leaflet"),
        ("B", "The chest contains a brass lantern.", "lantern"),
        ("C", "The bag holds a small rope.", "rope"),
        ("D", "This is a forest, with trees in all directions.", ""),
        ("E", "On the ground is a pile of leaves.", ""),
        ("F", "There are mountains all around.", ""),
    ]
    failures: list[str] = []
    for cid, text, expect in cases:
        objs = km._extract_objects(text)
        joined = " | ".join(objs)
        if expect:
            ok = any(expect in o for o in objs)
            print(f"[{cid}] {'OK' if ok else 'FAIL'} expect~{expect!r} got={objs}")
            if not ok:
                failures.append(f"{cid}: expected substring {expect!r}, got {objs}")
        else:
            ok = not objs or all(
                not re.search(r"forest|trees|pile|leaves|mountains", o)
                for o in objs
            )
            print(f"[{cid}] {'OK' if ok else 'FAIL'} expect_no_scenery got={objs}")
            if not ok:
                failures.append(f"{cid}: scenery leaked, got {objs}")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nALL OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
