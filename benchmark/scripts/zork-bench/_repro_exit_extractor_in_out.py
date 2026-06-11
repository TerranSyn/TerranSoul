"""Sub-10-second reproduce snippet: the K21 cycling bug.

Hypothesis (Principle 8 of agent-self-learning-doctrine):
  In K21 the agent cycled 'in'x4 in the Forest. The hard-pin (K19) only
  picks shortlist[0], so shortlist[0] in Forest = 'in'. Forest in Zork
  has NO 'in' exit. So `_extract_exits_from_obs` must be returning 'in'
  even though the game never offered it. The likely culprit is the
  bare-word fallback regex `\bin\b` matching English prose like
  "You are *in* a forest" -- same for "out".

Run:
    python benchmark/scripts/zork-bench/_repro_exit_extractor_in_out.py

Pass criteria:
  - The Forest-style observation MUST NOT yield 'in' or 'out' as exits.
  - An explicit `Exits: in, north` line MUST still yield 'in'.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark/scripts/zork-bench"))

from terransoul_brain_bridge import _extract_exits_from_obs  # noqa: E402


# Real Zork-1 Forest observation (paraphrased from a public transcript).
FOREST_OBS = (
    "Forest\n"
    "This is a forest, with trees in all directions. To the east, there\n"
    "appears to be sunlight.\n"
)

# Real Zork-1 West-of-House obs (the opening room). Has no 'in' exit
# in the game, but the prose contains "in" as a preposition.
WEST_HOUSE_OBS = (
    "West of House\n"
    "You are standing in an open field west of a white house, with a\n"
    "boarded front door.\n"
    "There is a small mailbox here.\n"
)

# Synthetic obs with an EXPLICIT 'in' exit. This must still parse.
EXPLICIT_IN_OBS = (
    "Behind House\n"
    "You are behind the white house. A path leads into the forest to the\n"
    "east. In one corner of the house there is a small window which is\n"
    "slightly ajar.\n"
    "Exits: in, north, south\n"
)


def main() -> int:
    failures: list[str] = []

    # 1. Forest must NOT contain 'in' or 'out' just because the prose
    #    uses those words as prepositions.
    forest = _extract_exits_from_obs(FOREST_OBS)
    print(f"[forest] exits = {forest}")
    if "in" in forest:
        failures.append("Forest obs leaked 'in' exit (false positive on \"trees in all directions\")")
    if "out" in forest:
        failures.append("Forest obs leaked 'out' exit")

    # 2. West-of-House must NOT contain 'in' just because of "standing in".
    woh = _extract_exits_from_obs(WEST_HOUSE_OBS)
    print(f"[west_house] exits = {woh}")
    if "in" in woh:
        failures.append("West-of-House leaked 'in' (false positive on \"standing in an open field\")")

    # 3. Behind-House WITH an explicit `Exits: in, ...` line MUST yield 'in'.
    bh = _extract_exits_from_obs(EXPLICIT_IN_OBS)
    print(f"[behind_house] exits = {bh}")
    if "in" not in bh:
        failures.append("Behind-House dropped explicit 'in' from `Exits:` line (regression)")
    if "north" not in bh:
        failures.append("Behind-House dropped explicit 'north' from `Exits:` line")

    if failures:
        print("\n[FAIL]")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\n[PASS] exit extractor rejects prose 'in'/'out' but keeps explicit ones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
