"""Sub-10s reproduce snippet for K15 noun-extractor poisoning bug.

Loads the in-tree ``_extract_objects_from_obs`` helper from
``terransoul_brain_bridge`` and asserts that real-world Zork I scene
prose (Forest, West of House, Behind House) produces clean noun
candidates — no ``"this is a"``, ``"to the east"``, or ``"there
appears"`` style fragments leaking through.

Run:
    $env:PYTHONIOENCODING="utf-8"
    python benchmark/scripts/zork-bench/_repro_obs_noun_extractor.py

Background:
    K15 ep1 observed shortlist for room ``Forest`` was
        ["east", "in", "take this is a", "take to the east",
         "open this is a"]
    The first two are clean exits but the latter three are nonsense
    fragments. The brain-gate critic correctly hard-rejects every
    sensible action because none of them are on this poisoned list,
    so the agent_loop spins forever and the bench stalls.

    Root cause: capitalized-noun fallback regex in
    ``_extract_objects_from_obs`` matched sentence starts like
    ``"This is a forest"`` and ``"To the east, ..."``.

This snippet must stay green for any future change to the extractor.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIDGE = HERE / "terransoul_brain_bridge.py"

# Load the bridge module without executing its top-level harness wiring
# (it has heavy imports — but `_extract_objects_from_obs` is a free
# function near the bottom and the module only imports stdlib at the
# top, so a normal import works fine).
spec = importlib.util.spec_from_file_location("ts_bridge", BRIDGE)
mod = importlib.util.module_from_spec(spec)
sys.modules["ts_bridge"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)

extract = mod._extract_objects_from_obs  # type: ignore[attr-defined]

# Real Zork I observations (from the canonical opening rooms).
SCENES = {
    "West of House": (
        "West of House\n"
        "You are standing in an open field west of a white house, with a "
        "boarded front door. There is a small mailbox here."
    ),
    "Forest": (
        "Forest\n"
        "This is a forest, with trees in all directions. To the east, there "
        "appears to be sunlight."
    ),
    "Behind House": (
        "Behind House\n"
        "You are behind the white house. In one corner of the house there is "
        "a small window which is slightly ajar."
    ),
    "Forest Path": (
        "Forest Path\n"
        "This is a path winding through a dimly lit forest. The path heads "
        "north-south here. One particularly large tree with some low branches "
        "stands at the edge of the path."
    ),
}

# Each scene must yield AT LEAST these (real-object recall) and must
# NOT yield ANY of these (junk-fragment precision).
EXPECT_OK = {
    "West of House": ["mailbox"],
    "Forest": [],
    "Behind House": ["window"],
    "Forest Path": [],
}
FORBIDDEN_SUBSTRINGS = [
    "this is", "to the", "there is no", "there appears", "is a",
    "you are", "in one corner", "in all directions",
]
# Article-prefixed junk that should never reach the planner.
FORBIDDEN_EXACT = {"a", "an", "the", "some", "this", "that", "these",
                   "those", "his", "her", "its", "our"}


def main() -> int:
    failed = False
    for scene, obs in SCENES.items():
        nouns = extract(obs)
        nouns_l = [n.lower() for n in nouns]
        print(f"  [{scene}] -> {nouns}")

        for must in EXPECT_OK[scene]:
            if must not in nouns_l:
                print(f"    [FAIL] expected {must!r} in extraction")
                failed = True
        for n in nouns_l:
            for bad in FORBIDDEN_SUBSTRINGS:
                if bad in n:
                    print(f"    [FAIL] junk fragment {n!r} contains {bad!r}")
                    failed = True
            if n in FORBIDDEN_EXACT:
                print(f"    [FAIL] bare-article fragment {n!r} reached planner")
                failed = True

    if failed:
        print("\n[FAIL] noun extractor poisoning regression")
        return 1
    print("\n[PASS] noun extractor returns clean candidates for all scenes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
