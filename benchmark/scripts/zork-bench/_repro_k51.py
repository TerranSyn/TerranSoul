"""K51 sub-10s repro — proves frontier-aware escalation gate.

K50b bench showed K50 was clobbering UNTRIED FRONTIER cardinals (e.g.
`up: 6 (unvisited exit, untried in this room)` at Forest Path) with
phantom-noun garbage like `take path`, `open word`, `take chirping` for
17 consecutive turns, blocking the agent from ever reaching Up a Tree.

K51 fix: only escalate when `top[0][1] < FRONTIER_BONUS` (i.e. no
untried frontier cardinal exists at the top — the agent is genuinely
cycling stale exits).
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


def k51_escalate(top, scored, visits):
    """Returns (new_top, promoted_action_or_None)."""
    if visits < 4 or not top:
        return top, None
    # K51: skip if top[0] is an untried frontier cardinal.
    top0_score = int(top[0][1]) if len(top[0]) >= 2 else 0
    if top0_score >= FRONTIER_BONUS:
        return top, None
    # Find first state-changing non-cardinal noun phrase in scored.
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
    new_top = [(pick[0], FRONTIER_BONUS + 1, f"[K51 visits={visits}]")]
    pick_key = pick[0].strip().lower()
    for t in top:
        if t[0].strip().lower() == pick_key:
            continue
        new_top.append(t)
        if len(new_top) >= 12:
            break
    return new_top, pick[0]


def _case(label, top, scored, visits, expect_promoted):
    new_top, promoted = k51_escalate(top, scored, visits)
    ok = promoted == expect_promoted
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: visits={visits} "
          f"promoted={promoted!r} (expected {expect_promoted!r}) "
          f"-> top0={new_top[0][0]!r}")
    assert ok, label


# Case A — REGRESSION: top0='up' is untried frontier (score=6). Even
# with visits=17 + state-changers in scored, must NOT clobber.
_top_fp_frontier = [("up", 6, "unvisited exit (untried in this room)"),
                    ("west", 6, "unvisited exit (untried in this room)")]
_scored_fp_frontier = list(_top_fp_frontier) + [
    ("take path", 5, "speculative"),
    ("open word", 5, "speculative"),
    ("take chirping", 5, "speculative"),
]
_case("FrontierUntried up — must NOT clobber",
      _top_fp_frontier, _scored_fp_frontier, 17, None)

# Case B — All cardinals re-traversed (visited, score 0–4). NOW K51
# may escalate to a state-changing verb.
_top_revisit = [("north", 4, "visited exit→Clearing"),
                ("east", 3, "unlisted-direction probe")]
_scored_revisit = list(_top_revisit) + [
    ("climb tree", 5, "speculative"),
    ("open mailbox", 5, "speculative"),
]
_case("All cardinals re-traversed, escalate",
      _top_revisit, _scored_revisit, 5, "climb tree")

# Case C — Below visit threshold, even with stale top0.
_case("Below threshold (visits=3) — no escalate",
      _top_revisit, _scored_revisit, 3, None)

# Case D — Top0 already non-cardinal — pass-through, no clobber.
_top_already = [("open mailbox", 5, ""), ("west", 6, "")]
_case("Top0 already non-cardinal — pass-through",
      _top_already, list(_top_already) + [("climb tree", 5, "")], 5, None)

# Case E — Stale top0 (score 0 visited exit) but no state-changer in
# scored — return None (info verbs only).
_top_stale = [("south", 0, "visited exit→North House")]
_scored_stale = list(_top_stale) + [
    ("examine path", 4, "info"),
    ("read leaflet", 4, "info"),
]
_case("Stale top0 + only info verbs — no escalate",
      _top_stale, _scored_stale, 5, None)

# Case F — Stale top0 + state-changer with bare verb — must skip bare
# and pick the noun-phrase one.
_top_bare_revisit = [("north", 4, "visited exit→Clearing")]
_scored_bare_revisit = list(_top_bare_revisit) + [
    ("climb", 5, "bare"),
    ("climb tree", 5, "speculative"),
]
_case("Stale top0 + bare-verb skipped",
      _top_bare_revisit, _scored_bare_revisit, 5, "climb tree")

# Case G — REGRESSION (Forest from K50b prior trace). top0='north' was
# `unvisited exit untried` at score 6 → must NOT clobber.
_top_forest = [("north", 6, "unvisited exit (untried in this room)"),
               ("south", 6, "unvisited exit (untried in this room)")]
_scored_forest = list(_top_forest) + [("climb trees", 5, "speculative")]
_case("Forest north frontier — must NOT clobber",
      _top_forest, _scored_forest, 9, None)

print("\nAll K51 cases passed.")
