"""K50 sub-10s repro — proves revisit-escalation logic.

Doesn't import the full bridge (heavy spaCy/uv deps); just replays the
escalation algorithm against synthetic `scored` lists so we can verify:

  - escalation fires at visits >= 4
  - escalation does NOT fire at visits < 4
  - escalation does NOT fire when top[0] is already non-cardinal
  - escalation does NOT fire when no state-changing non-cardinal in scored
  - info-only verbs (examine/read) are NOT promoted
  - state-changing verbs (open/climb/take) ARE promoted
"""

from __future__ import annotations

FRONTIER_BONUS = 6

_STATE_VERBS = {
    "open", "take", "climb", "push", "pull", "light", "move",
    "enter", "drop", "put", "wear", "eat", "drink", "throw",
    "tie", "attack", "cut", "break", "wave", "burn", "turn",
    "unlock", "kill", "fight",
}
_COMPASS = {
    "n", "s", "e", "w", "u", "d", "ne", "nw", "se", "sw",
    "north", "south", "east", "west", "up", "down",
    "northeast", "northwest", "southeast", "southwest",
}


def k50_escalate(top: list[tuple[str, int, str]],
                 scored: list[tuple[str, int, str]],
                 visits: int) -> tuple[list[tuple[str, int, str]], str | None]:
    """Returns (new_top, promoted_action_or_None)."""
    if visits < 4 or not top:
        return top, None
    pick = None
    for act, sc, rsn in scored:
        toks = act.strip().lower().split()
        if not toks:
            continue
        verb = toks[0]
        if verb in _COMPASS or verb not in _STATE_VERBS:
            continue
        if len(toks) < 2:
            continue
        pick = (act, sc, rsn)
        break
    top0_verb = top[0][0].strip().lower().split()[:1]
    top0_is_compass = bool(top0_verb and top0_verb[0] in _COMPASS)
    if pick is None or not top0_is_compass:
        return top, None
    if pick[0].strip().lower() == top[0][0].strip().lower():
        return top, None
    new_top = [(pick[0], FRONTIER_BONUS + 1, f"[REVISIT-ESCALATE-K50 visits={visits}] {pick[2]}")]
    pick_key = pick[0].strip().lower()
    for t in top:
        if t[0].strip().lower() == pick_key:
            continue
        new_top.append(t)
        if len(new_top) >= 12:
            break
    return new_top, pick[0]


def _case(label, top, scored, visits, expect_promoted):
    new_top, promoted = k50_escalate(top, scored, visits)
    ok = promoted == expect_promoted
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: visits={visits} "
          f"promoted={promoted!r} (expected {expect_promoted!r}) -> top0={new_top[0][0]!r}")
    assert ok, label


# Case 1 — Forest re-visit 4x, state-changing `climb trees` in scored,
# top0 is cardinal. Expect promotion.
_top_forest = [("north", 6, "unvisited"), ("south", 6, "unvisited"),
               ("climb trees", 5, "speculative")]
_scored_forest = list(_top_forest) + [("examine trees", 4, "info")]
_case("Forest 4 visits", _top_forest, _scored_forest, 4, "climb trees")

# Case 2 — same room, only 3 visits. Don't escalate yet.
_case("Forest 3 visits (below threshold)", _top_forest, _scored_forest, 3, None)

# Case 3 — Behind House revisit, `open window` should be promoted, not
# `examine window`.
_top_bh = [("west", 6, ""), ("east", 6, "")]
_scored_bh = list(_top_bh) + [
    ("examine window", 4, "info"),
    ("open window", 5, "state-change"),
    ("take window", 5, "state-change"),
]
_case("Behind House open-vs-examine", _top_bh, _scored_bh, 5, "open window")

# Case 4 — top0 already non-cardinal. Don't override LLM-friendly top.
_top_already = [("open mailbox", 5, ""), ("west", 6, "")]
_scored_already = list(_top_already) + [("climb tree", 5, "")]
_case("Top0 already non-cardinal", _top_already, _scored_already, 5, None)

# Case 5 — no state-changing in scored, only info verbs. Don't promote.
_top_noinfo = [("north", 6, "")]
_scored_noinfo = list(_top_noinfo) + [("examine sign", 4, ""), ("read sign", 4, "")]
_case("Only info verbs available", _top_noinfo, _scored_noinfo, 5, None)

# Case 6 — bare verb (no noun) shouldn't be picked.
_top_bare = [("south", 6, "")]
_scored_bare = list(_top_bare) + [("climb", 5, "bare"), ("climb tree", 5, "")]
_case("Bare verb skipped, picks climb tree", _top_bare, _scored_bare, 4, "climb tree")

print("\nAll K50 escalation cases passed.")
