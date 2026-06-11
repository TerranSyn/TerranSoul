"""K54 sub-10s repro — block info-only verbs ONLY on revisits.

K53 bench (gemma4:e4b 30T) regressed: K52 always blocked 'examine X'
at frontier, so turn 1 'examine mailbox' \u2192 replaced with 'west' \u2192
agent skipped West House entirely \u2192 stuck wandering Forest, never
reached Up a Tree (K51 had reached it by turn 20).

K51 waste was REVISITS:
  Turn 11/19: 'examine tree' at Forest Path (visited 2nd/3rd time)
  Turn 7/17:  'examine leaves' at Clearing  (visited 2nd time)

Universal rule: first-encounter examination is genuinely informative
(reveals containers, openables, scoring objects). Re-examining the
same room is repeat waste when frontier exits are still untried.

K54: block info-only verbs at frontier only when room_visits >= 2.
"""

from __future__ import annotations

FRONTIER_BONUS = 6

_COMPASS = {"north","south","east","west","up","down","n","s","e","w","u","d"}
_INFO_ONLY = {"examine","x","look","l","read","inventory","i","smell","listen","touch","feel","search"}
_ALLOWED = {"examine","look","read","inventory","smell","listen","take","open","climb","push","pull","light","move","enter","drop","put","wear"}


def k54_pin(orig: str, top: str, top_score: int, visible_nouns, room_visits: int):
    orig_n = orig.strip().lower()
    top_n = top.strip().lower()
    if orig_n == top_n:
        return top, "passthrough"
    toks = orig_n.split()
    if not toks:
        return top, "replaced"
    verb = toks[0]
    nouns = toks[1:]
    at_frontier = top_score <= FRONTIER_BONUS

    if at_frontier and orig_n in _COMPASS and top_n in _COMPASS:
        return orig, "allow_llm_cardinal_tie"
    if (
        at_frontier
        and verb in _ALLOWED
        and (verb not in _INFO_ONLY or room_visits <= 1)
        and nouns
        and any(n in visible_nouns for n in nouns)
    ):
        return orig, "allow_llm_visible_noun"
    return top, "replaced_frontier_k54"


def _case(label, orig, top, top_score, vis, visits, exp_act, exp_status):
    act, status = k54_pin(orig, top, top_score, vis, visits)
    ok = act == exp_act and status == exp_status
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: visits={visits} -> "
          f"action={act!r} status={status} (exp {exp_act!r}/{exp_status})")
    assert ok, label


# Case A — first visit to West House: 'examine mailbox' must ALLOW.
_case("West House first visit examine mailbox",
      "examine mailbox", "west", 6, {"mailbox", "leaflet"}, 1,
      "examine mailbox", "allow_llm_visible_noun")

# Case B — second visit to Forest Path: 'examine tree' must REPLACE.
_case("Forest Path 2nd visit examine tree",
      "examine tree", "up", 6, {"tree"}, 2,
      "up", "replaced_frontier_k54")

# Case C — third visit to Clearing: 'examine leaves' must REPLACE.
_case("Clearing 3rd visit examine leaves",
      "examine leaves", "north", 6, {"leaves", "pile"}, 3,
      "north", "replaced_frontier_k54")

# Case D — first visit, state-changing verb: ALLOW.
_case("First visit take egg",
      "take egg", "east", 6, {"egg"}, 1,
      "take egg", "allow_llm_visible_noun")

# Case E — second visit, state-changing verb: still ALLOW (only info-only blocked).
_case("Second visit take egg",
      "take egg", "east", 6, {"egg"}, 2,
      "take egg", "allow_llm_visible_noun")

# Case F — first visit, info-only no noun: REPLACE (no noun to examine).
_case("First visit 'look' (no noun)",
      "look", "up", 6, set(), 1,
      "up", "replaced_frontier_k54")

# Case G — first visit, 'read leaflet' (info-only WITH noun): ALLOW.
_case("First visit read leaflet",
      "read leaflet", "west", 6, {"leaflet"}, 1,
      "read leaflet", "allow_llm_visible_noun")

# Case H — second visit, 'read leaflet': REPLACE.
_case("Second visit read leaflet",
      "read leaflet", "west", 6, {"leaflet"}, 2,
      "west", "replaced_frontier_k54")

# Case I — passthrough.
_case("passthrough",
      "up", "up", 6, {"tree"}, 5,
      "up", "passthrough")

# Case J — cardinal tie still works any visit.
_case("Cardinal tie revisit",
      "south", "north", 6, {"path"}, 7,
      "south", "allow_llm_cardinal_tie")

print("\nAll K54 cases passed.")
