"""K52 sub-10s repro — info-only verbs never score, must NOT override frontier.

K51 bench (gemma4:e4b 30T) wasted 4 turns at frontier rooms on:
  Turn 7  examine leaves (Clearing,    top='north' score=6)
  Turn 11 examine tree   (Forest Path, top='east'  score=6)
  Turn 17 examine leaves (Clearing,    top='north' score=6)
  Turn 19 examine tree   (Forest Path, top='up'    score=6)

Each `allow_llm_visible_noun` because `examine` had a visible noun. But
examine/look/read/inventory/smell/listen/touch/feel/search are pure
info-gathering verbs in interactive fiction — they never score points.

K52: at frontier (top_score <= FRONTIER_BONUS), block info-only verbs
from `allow_llm_visible_noun`. Replace with frontier cardinal. State-
changing verbs (open/take/climb/push/pull/light/...) still allowed.
"""

from __future__ import annotations

FRONTIER_BONUS = 6

_COMPASS = {
    "n", "s", "e", "w", "u", "d", "ne", "nw", "se", "sw",
    "north", "south", "east", "west", "up", "down",
    "northeast", "northwest", "southeast", "southwest",
}
_INFO_ONLY = {
    "examine", "x", "look", "l", "read",
    "inventory", "i", "smell", "listen", "touch", "feel", "search",
}
_ALLOWED = {  # representative subset — bench uses dynamic union
    "examine", "look", "read", "inventory", "smell", "listen",
    "take", "open", "climb", "push", "pull", "light", "move",
    "enter", "drop", "put", "wear", "eat", "drink", "throw",
    "tie", "attack", "cut", "break", "wave", "burn", "turn",
}


def k52_pin(orig: str, top: str, top_score: int, visible_nouns):
    """Returns final action string (after pin)."""
    orig_n = orig.strip().lower()
    top_n = top.strip().lower()
    if orig_n == top_n:
        return top, "passthrough"
    orig_toks = orig_n.split()
    if not orig_toks:
        return top, "replaced"
    orig_verb = orig_toks[0]
    orig_nouns = orig_toks[1:]
    at_frontier = top_score <= FRONTIER_BONUS

    if at_frontier and orig_n in _COMPASS and top_n in _COMPASS:
        return orig, "allow_llm_cardinal_tie"
    if (
        at_frontier
        and orig_verb in _ALLOWED
        and orig_verb not in _INFO_ONLY
        and orig_nouns
        and any(n in visible_nouns for n in orig_nouns)
    ):
        return orig, "allow_llm_visible_noun"
    return top, "replaced_frontier_k52"


def _case(label, orig, top, top_score, visible, expect_action, expect_status):
    act, status = k52_pin(orig, top, top_score, visible)
    ok = act == expect_action and status == expect_status
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: orig={orig!r} top={top!r} "
          f"-> action={act!r} status={status} "
          f"(expected {expect_action!r}/{expect_status})")
    assert ok, label


# Case A — REGRESSION: examine tree at frontier — must REPLACE.
_case("Forest Path: examine tree at frontier",
      "examine tree", "up", 6, {"path", "tree", "branches"},
      "up", "replaced_frontier_k52")

# Case B — REGRESSION: examine leaves at Clearing — must REPLACE.
_case("Clearing: examine leaves at frontier",
      "examine leaves", "north", 6, {"pile", "leaves"},
      "north", "replaced_frontier_k52")

# Case C — `look` at frontier — must REPLACE (info-only, no noun anyway).
_case("look at frontier — replace",
      "look", "up", 6, {"tree"},
      "up", "replaced_frontier_k52")

# Case D — `take egg` at frontier — must ALLOW (state-changing).
_case("take egg at frontier — allow",
      "take egg", "east", 6, {"egg", "nest"},
      "take egg", "allow_llm_visible_noun")

# Case E — `open mailbox` at frontier — must ALLOW.
_case("open mailbox at frontier — allow",
      "open mailbox", "west", 6, {"mailbox", "leaflet"},
      "open mailbox", "allow_llm_visible_noun")

# Case F — `climb tree` at frontier — must ALLOW (canonical Zork +5 path).
_case("climb tree at frontier — allow",
      "climb tree", "up", 6, {"tree", "branches"},
      "climb tree", "allow_llm_visible_noun")

# Case G — cardinal tie still works — `north` vs top=`east`, both compass.
_case("Cardinal tie still allowed",
      "north", "east", 6, {"path"},
      "north", "allow_llm_cardinal_tie")

# Case H — `read leaflet` (info-only) at frontier — must REPLACE.
_case("read leaflet at frontier — replace",
      "read leaflet", "west", 6, {"leaflet"},
      "west", "replaced_frontier_k52")

# Case I — `inventory` (info-only, no noun) at frontier — must REPLACE.
_case("inventory at frontier — replace",
      "inventory", "north", 6, {"pile"},
      "north", "replaced_frontier_k52")

# Case J — passthrough when LLM matches top.
_case("passthrough match",
      "up", "up", 6, {"tree"},
      "up", "passthrough")

print("\nAll K52 cases passed.")
