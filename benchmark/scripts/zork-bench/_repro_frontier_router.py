"""Sub-second repro for the generic frontier-router (reasoning decomposition).

Proves the harness can turn "explore the world / escape this dead-end and
go back to an unexplored exit" — multi-step reasoning a weak model cannot
hold — into a SINGLE next step. Domain-agnostic graph search (no Zork).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


def t1_current_room_is_frontier() -> bool:
    from terransoul_brain_bridge import _frontier_route
    # West-House-like: only 'west' tried; north/south/east still open.
    out = _frontier_route(
        adjacency={"WestHouse": {"west": "Forest"}},
        current="WestHouse",
        tried_by_room={"WestHouse": {"west"}},
    )
    if out is None or out[2] != 0 or out[0] not in {"north", "south", "east"}:
        print(f"FAIL t1: current frontier should return dist-0 untried cardinal, got {out}")
        return False
    print(f"PASS t1: current-room frontier returns untried cardinal {out[0]!r} (dist 0)")
    return True


def t2_route_back_from_dead_end() -> bool:
    """Agent stuck in a dead-end region (RockyLedge) must be routed back to
    the nearest room with an unexplored exit (WestHouse north/east)."""
    from terransoul_brain_bridge import _frontier_route
    adjacency = {
        "WestHouse": {"west": "Forest"},
        "Forest": {"east": "ForestPath", "west": "WestHouse"},
        "ForestPath": {"west": "Forest", "east": "Canyon"},
        "Canyon": {"west": "ForestPath", "down": "RockyLedge"},
        "RockyLedge": {"up": "Canyon"},
    }
    tried_by_room = {
        # every cardinal exhausted everywhere EXCEPT WestHouse (n/s/e open)
        "WestHouse": {"west"},
        "Forest": {"north", "south", "east", "west"},
        "ForestPath": {"north", "south", "east", "west"},
        "Canyon": {"north", "south", "east", "west"},
        "RockyLedge": {"north", "south", "east", "west"},
    }
    out = _frontier_route(adjacency, current="RockyLedge", tried_by_room=tried_by_room)
    if out is None:
        print("FAIL t2: should route back to WestHouse frontier")
        return False
    step, target, dist = out
    if target != "WestHouse":
        print(f"FAIL t2: nearest frontier should be WestHouse, got {target}")
        return False
    if step != "up":
        print(f"FAIL t2: first step from RockyLedge toward WestHouse must be 'up', got {step!r}")
        return False
    print(f"PASS t2: dead-end escape routes first-step {step!r} toward {target} (dist {dist})")
    return True


def t3_no_frontier_returns_none() -> bool:
    from terransoul_brain_bridge import _frontier_route
    adjacency = {"A": {"east": "B"}, "B": {"west": "A"}}
    full = {"north", "south", "east", "west"}
    out = _frontier_route(adjacency, "A", {"A": full, "B": full})
    if out is not None:
        print(f"FAIL t3: fully-explored map should return None, got {out}")
        return False
    print("PASS t3: fully-explored map returns None (nothing to route to)")
    return True


def t4_nearest_frontier_wins() -> bool:
    from terransoul_brain_bridge import _frontier_route
    # Two frontiers: B (dist 1) and D (dist 2). Must pick B.
    adjacency = {
        "A": {"east": "B", "south": "C"},
        "B": {"west": "A"},
        "C": {"north": "A", "south": "D"},
        "D": {"north": "C"},
    }
    full = {"north", "south", "east", "west"}
    tried = {"A": full, "B": {"west"}, "C": full, "D": {"north"}}
    out = _frontier_route(adjacency, "A", tried)
    if out is None or out[0] != "east" or out[1] != "B":
        print(f"FAIL t4: nearest frontier B via 'east' expected, got {out}")
        return False
    print("PASS t4: BFS picks the NEAREST frontier (B) over a farther one (D)")
    return True


def t5_domain_agnostic() -> bool:
    from terransoul_brain_bridge import _frontier_route
    # Non-Zork graph (filesystem dirs) — same algorithm, no task vocabulary.
    adjacency = {"/root": {"east": "/etc"}, "/etc": {"west": "/root"}}
    out = _frontier_route(adjacency, "/etc", {"/root": {"west"}, "/etc": {"north", "south", "east", "west"}})
    if out is None or out[1] != "/root":
        print(f"FAIL t5: must work for arbitrary domains, got {out}")
        return False
    print("PASS t5: frontier-router is domain-agnostic")
    return True


def t6_least_visited_frontier_wins() -> bool:
    """With visit_counts, the router prefers the LEAST-visited reachable
    frontier (robust to phantom exits) over the merely-nearest one."""
    from terransoul_brain_bridge import _frontier_route
    # B is nearest (dist 1) but heavily visited; D is farther (dist 2) but
    # barely visited — the agent should be driven to D.
    adjacency = {
        "A": {"east": "B", "south": "C"},
        "B": {"west": "A"},
        "C": {"north": "A", "south": "D"},
        "D": {"north": "C"},
    }
    full = {"north", "south", "east", "west"}
    tried = {"A": full, "B": {"west"}, "C": full, "D": {"north"}}
    visits = {"A": 5, "B": 9, "C": 4, "D": 1}
    out = _frontier_route(adjacency, "A", tried, visit_counts=visits, leave_current=True)
    if out is None or out[1] != "D":
        print(f"FAIL t6: least-visited frontier D expected, got {out}")
        return False
    print("PASS t6: least-visited frontier (D) chosen over nearest heavily-visited (B)")
    return True


def t7_overvisited_room_tries_its_own_untried_exit() -> bool:
    """K28 ground-truth fix: an over-visited room with an UNTRIED cardinal
    must route the agent to TRY that cardinal (the unexplored exit IS the
    escape from re-walking explored exits) — NOT skip it. Only when all
    the current room's cardinals are tried does the router BFS elsewhere."""
    from terransoul_brain_bridge import _frontier_route
    adjacency = {"Stuck": {"up": "Hub"}, "Hub": {"down": "Stuck", "east": "Fresh"}}
    # Stuck is over-visited but still has untried south/east/west.
    tried = {"Stuck": {"north"}, "Hub": {"north", "south", "east", "west"}, "Fresh": {"north"}}
    visits = {"Stuck": 7, "Hub": 2, "Fresh": 0}
    out = _frontier_route(adjacency, "Stuck", tried, visit_counts=visits, leave_current=True)
    if out is None or out[1] != "Stuck" or out[2] != 0 or out[0] not in {"south", "east", "west"}:
        print(f"FAIL t7: over-visited room must try its own untried exit (dist 0), got {out}")
        return False
    print(f"PASS t7: over-visited room routes to its OWN untried exit {out[0]!r} (escapes re-walk)")
    return True


def t7b_all_tried_then_routes_elsewhere() -> bool:
    """When the current room's cardinals are ALL tried, the router BFSes to a
    reachable frontier elsewhere (the leave-current case)."""
    from terransoul_brain_bridge import _frontier_route
    adjacency = {"Stuck": {"up": "Hub"}, "Hub": {"down": "Stuck", "east": "Fresh"}}
    full = {"north", "south", "east", "west"}
    tried = {"Stuck": full, "Hub": full, "Fresh": {"north"}}  # Fresh has untried s/e/w
    visits = {"Stuck": 7, "Hub": 2, "Fresh": 0}
    out = _frontier_route(adjacency, "Stuck", tried, visit_counts=visits, leave_current=True)
    if out is None or out[0] != "up":
        print(f"FAIL t7b: all-tried current room must route OUT via 'up' toward Fresh, got {out}")
        return False
    print(f"PASS t7b: fully-explored current room routes elsewhere (step={out[0]!r})")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [
        t1_current_room_is_frontier(),
        t2_route_back_from_dead_end(),
        t3_no_frontier_returns_none(),
        t4_nearest_frontier_wins(),
        t5_domain_agnostic(),
        t6_least_visited_frontier_wins(),
        t7_overvisited_room_tries_its_own_untried_exit(),
        t7b_all_tried_then_routes_elsewhere(),
    ]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- frontier-router repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
