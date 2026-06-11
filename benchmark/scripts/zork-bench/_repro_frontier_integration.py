"""Offline integration repro (rule 8) — frontier-router end-to-end WITHOUT
a 26-min bench. Drives BrainMemoryManager.record_action_outcome through a
mock MCP for a Zork-shaped trajectory, then asserts the router would route
the agent out of a dead-end back to a room with an unexplored exit.

Reproduces the K18 failure (router never fired) at sub-second speed so the
fix can be confirmed before any container run.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


class MockMcp:
    """Benign MCP double — every tool returns a shape the bridge can parse
    without raising. brain_observe_outcome -> continue; searches -> no hits;
    ingests/edges -> empty envelope."""
    def __init__(self):
        self.calls = []

    def tool(self, name, args):
        self.calls.append(name)
        if name == "brain_observe_outcome":
            return {"verdict": "continue"}
        # brain_search / brain_list_recent / brain_ingest_lesson / add_edge:
        # an empty content envelope parses to zero hits / no memory_id.
        return {"content": [{"type": "text", "text": "[]"}]}


def _ctx(score=0, loc_changed=False, first=False, inv=False, died=False, score_after=0):
    return {
        "score_delta": score, "location_changed": loc_changed,
        "first_visit": first, "inventory_changed": inv, "died": died,
        "score_after": score_after, "inventory_after": [],
    }


def t1_dead_end_routes_back() -> bool:
    from terransoul_brain_bridge import BrainMemoryManager, _frontier_route
    mm = BrainMemoryManager(mcp=MockMcp())

    # Trajectory: WestHouse --west--> Forest --east--> Canyon --down--> Rocky.
    # At Rocky Ledge the agent bumps all 4 cardinals (walls, no movement),
    # leaving only the climbable 'up' back to Canyon. WestHouse still has
    # untried north/south/east (only 'west' was used).
    mm._prev_loc_name = "West House"
    mm.record_action_outcome(location_name="Forest", action="west",
                             response="Forest. To the east is sunlight.",
                             z_machine_context=_ctx(loc_changed=True, first=True))
    mm.record_action_outcome(location_name="Canyon View", action="east",
                             response="Canyon View. A path leads northwest.",
                             z_machine_context=_ctx(loc_changed=True, first=True))
    mm.record_action_outcome(location_name="Rocky Ledge", action="down",
                             response="Rocky Ledge. Above is climbable cliff.",
                             z_machine_context=_ctx(loc_changed=True, first=True))
    # Wall bumps at Rocky Ledge (no location change):
    for d in ("north", "south", "east", "west"):
        mm.record_action_outcome(location_name="Rocky Ledge", action=d,
                                 response="You can't go that way.",
                                 z_machine_context=_ctx(loc_changed=False))
    # Agent climbs back up once (records the executable outgoing edge
    # Rocky Ledge --up--> Canyon View), then comes back down — realistic
    # bouncing. Now it is at Rocky Ledge again with all cardinals walled.
    mm._prev_loc_name = "Rocky Ledge"
    mm.record_action_outcome(location_name="Canyon View", action="up",
                             response="Canyon View.",
                             z_machine_context=_ctx(loc_changed=True))
    mm._prev_loc_name = "Canyon View"
    mm.record_action_outcome(location_name="Rocky Ledge", action="down",
                             response="Rocky Ledge.",
                             z_machine_context=_ctx(loc_changed=True))

    tried = mm.tried_cardinals_by_room()
    adj = mm._adjacency

    # West House must show only 'west' tried (north/south/east still open).
    wh = tried.get("west house", set())
    if wh != {"west"}:
        print(f"FAIL t1: West House tried cardinals should be {{west}}, got {wh} | adj={adj}")
        return False
    # Rocky Ledge must show all 4 cardinals attempted (walls) -> not a frontier.
    rl = tried.get("rocky ledge", set())
    if not {"north", "south", "east", "west"}.issubset(rl):
        print(f"FAIL t1: Rocky Ledge should have all 4 cardinals attempted, got {rl}")
        return False

    route = _frontier_route(adj, "rocky ledge", tried)
    if route is None:
        print(f"FAIL t1: router should route OUT of Rocky Ledge. adj={adj} tried={tried}")
        return False
    step, target, dist = route
    # The ONLY executable way out of the Rocky Ledge dead-end is the climb
    # 'up' — the router must emit that as the first step, with dist>0 (the
    # current room is exhausted) toward some room that still has an
    # unexplored cardinal (nearest is Canyon View).
    if step != "up" or dist <= 0:
        print(f"FAIL t1: first routed step must be 'up' with dist>0, got {route}")
        return False
    if not ({"north", "south", "east", "west"} - tried.get(target, set())):
        print(f"FAIL t1: routed target {target!r} must be a real frontier, tried={tried.get(target)}")
        return False
    print(f"PASS t1: dead-end Rocky Ledge routes step={step!r} -> frontier {target!r} (dist {dist})")
    return True


def t2_current_room_still_frontier_no_route() -> bool:
    """If the current room itself still has an untried cardinal, the router
    returns dist==0 (let local exploration handle it) — the planner does NOT
    promote in that case."""
    from terransoul_brain_bridge import BrainMemoryManager, _frontier_route
    mm = BrainMemoryManager(mcp=MockMcp())
    mm._prev_loc_name = "West House"
    mm.record_action_outcome(location_name="Forest", action="west",
                             response="Forest.",
                             z_machine_context=_ctx(loc_changed=True, first=True))
    tried = mm.tried_cardinals_by_room()
    route = _frontier_route(mm._adjacency, "forest", tried)
    # Forest has only 'west' recorded (the arriving edge dest attribution is
    # at Forest? No — 'west' from WestHouse is attributed to Forest's outcome
    # map). Regardless, Forest still has untried cardinals -> dist 0.
    if route is not None and route[2] != 0:
        print(f"FAIL t2: a room with untried cardinals should give dist 0, got {route}")
        return False
    print("PASS t2: room with untried cardinals yields dist-0 (local exploration)")
    return True


def t3_consumed_reward_attractor_breaks() -> bool:
    """ODY-1d: a previously-SUCCESSFUL action that is re-walked with no new
    progress (one-shot reward consumed) must be force-broken to 'loop',
    overriding the success-priority guard — else the agent oscillates back
    to the consumed reward forever (K26: Up a Tree 32x)."""
    from terransoul_brain_bridge import BrainMemoryManager
    mm = BrainMemoryManager(mcp=MockMcp(), _loop_breaker=__import__("terransoul_brain_bridge").LoopBreaker(stuck_threshold=3))
    # 'up' scores once at Forest Path (egg path success).
    mm.record_action_outcome(location_name="Forest Path", action="up",
                             response="Up a Tree. Taken.",
                             z_machine_context=_ctx(score=5, loc_changed=True, first=True, score_after=5))
    rao = mm._room_action_outcomes.get("forest path", {})
    if rao.get("up") != "success":
        print(f"FAIL t3: 'up' should be success first, got {rao.get('up')}")
        return False
    # Now re-walk 'up' (re-entry to a KNOWN room, no score/inv/new-room) 3x.
    for _ in range(3):
        mm.record_action_outcome(location_name="Forest Path", action="up",
                                 response="Up a Tree.",
                                 z_machine_context=_ctx(loc_changed=True))  # known re-entry
    rao = mm._room_action_outcomes.get("forest path", {})
    if rao.get("up") != "loop":
        print(f"FAIL t3: consumed-reward 'up' must force-break to 'loop', got {rao.get('up')}")
        return False
    print("PASS t3: consumed-reward attractor force-broken to 'loop' (past priority guard)")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [t1_dead_end_routes_back(), t2_current_room_still_frontier_no_route(),
               t3_consumed_reward_attractor_breaks()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- frontier integration repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
