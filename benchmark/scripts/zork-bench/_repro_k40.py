"""K40 sub-10s repro — cross-room "progress" pollution does NOT
transfer to a different room.

Scenario: in a previous episode the agent went `south` from Forest Path
and reached Clearing — that memory writes `Location: Clearing | Action:
south` and tried_map["south"] in Clearing's room-scoped query is
"progress". That memory ALSO ends up tagged `loc_North_House` somehow
(or another bench run wrote `Location: North House | Action: south`
falsely). Now in North House, where south is a wall, the planner
returns south=10 (frontier 6 + progress 4) and the agent loops.

K40 fix: when a direction is NOT in visited_dirs (no known
destination from THIS room), ignore "progress"/"success" outcomes
because they leaked across rooms via persistent MCP memory.
Positive cross-room signals do not transfer. Negative ones (neutral/
loop) still apply for in-room wall-bumps (K32).

Asserts:
  * `south` from North House WITH cross-room "progress" pollution →
    score should be FRONTIER_BONUS only, NOT FRONTIER_BONUS + 4.
  * `east` from North House (untried, no pollution) → FRONTIER_BONUS.
  * `south` and `east` should TIE — pollution must not bias choice.
  * In-room wall-bump signal still works: if south's tried_map outcome
    is "neutral" (bumped here), south scores -3 (neutral base).
"""
from __future__ import annotations

# Replicate the relevant exit-scoring branch from
# terransoul_brain_bridge.py (post-K40) without spinning up MCP.

FRONTIER_BONUS = 6
VISITED_BONUS = 0


def _score(act: str, tried_map: dict[str, str]) -> tuple[int, str]:
    outcome = tried_map.get(act.strip().lower())
    if outcome == "fatal":
        return (-100, "previously fatal — skip")
    if outcome == "loop":
        return (-15, "known dead-end")
    if outcome == "advisory":
        return (-2, "prior-episode 3-repeat warning")
    if outcome == "success":
        return (12, "previously rewarded — repeat for score")
    if outcome == "progress":
        return (4, "previously made progress")
    if outcome == "neutral":
        return (-3, "tried with no result")
    return (0, "untried")


def score_exit(d: str, visited_dirs: set[str], known_exits: dict[str, str], tried_map: dict[str, str]) -> tuple[int, str]:
    """Replicates K40 post-fix exit-scoring branch."""
    d_l = d.lower()
    if d_l in visited_dirs:
        base, reason = _score(d, tried_map)
        base += VISITED_BONUS
        reason = f"visited exit→{known_exits.get(d, '?')} ({reason})"
    else:
        outcome = tried_map.get(d_l)
        if outcome in ("neutral", "loop", "fatal", "advisory"):
            base, reason = _score(d, tried_map)
            reason = f"tried direction, no movement ({reason})"
        else:
            base = FRONTIER_BONUS
            reason = "unvisited exit (untried in this room)"
    return (base, reason)


def main() -> None:
    # Setup: in North House, no exits visited yet. tried_map (room-scoped
    # to North House by K32 filter) erroneously contains south=progress
    # because MCP persistent memory leaked the signal across bench runs.
    visited_dirs: set[str] = set()
    known_exits: dict[str, str] = {}
    tried_map_polluted = {"south": "progress"}

    south_score, south_reason = score_exit("south", visited_dirs, known_exits, tried_map_polluted)
    east_score, east_reason = score_exit("east", visited_dirs, known_exits, tried_map_polluted)

    print(f"K40 polluted: south={south_score} ({south_reason})")
    print(f"K40 polluted: east={east_score} ({east_reason})")

    assert south_score == FRONTIER_BONUS, (
        f"K40 fail: cross-room 'progress' leaked into south score "
        f"(got {south_score}, expected {FRONTIER_BONUS})"
    )
    assert east_score == FRONTIER_BONUS, f"east={east_score}"
    assert south_score == east_score, "K40: pollution must not bias frontier choice"

    # Local wall-bump still penalises (K32 preserved).
    tried_map_wallbump = {"south": "neutral"}
    south_wall, south_wall_reason = score_exit("south", visited_dirs, known_exits, tried_map_wallbump)
    print(f"K40 wallbump: south={south_wall} ({south_wall_reason})")
    assert south_wall == -3, f"K32 regression: wall-bump south={south_wall}, expected -3"
    assert south_wall < east_score, "wall-bump must be worse than fresh frontier"

    # Visited exit (known dest) — progress signal is local + valid.
    visited_dirs2 = {"north"}
    known_exits2 = {"north": "Forest Path"}
    tried_map_visited = {"north": "progress"}
    north_score, north_reason = score_exit("north", visited_dirs2, known_exits2, tried_map_visited)
    print(f"K40 visited: north={north_score} ({north_reason})")
    assert north_score == 4, f"local progress should still apply: got {north_score}"

    print("\nK40 OK — cross-room progress pollution rejected, K32 wall-bump preserved.")


if __name__ == "__main__":
    main()
