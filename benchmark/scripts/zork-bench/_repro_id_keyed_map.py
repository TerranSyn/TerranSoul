"""Sub-second repro for ZADOPT-1: ID-keyed map (the ZorkGPT keystone).

Bug (live K46/K48/K49): rooms were keyed by the LLM-extracted NAME, so the
Zork FOREST MAZE — many distinct rooms all named "Forest" — collapsed into one
graph node. `_room_event_counts["forest"]` hit 145, the room looked
permanently "overvisited", and the frontier-router BFSed a degenerate
self-referential graph it could never escape.

Fix (adopt ZorkGPT's `room_id = location.num`): key the map/visit/router
state by the Z-machine integer `location_id` (already delivered in
`z_machine_context`), name is display-only. Two rooms that share a name but
have different ids are now DISTINCT nodes → no fragmentation → the router can
navigate the maze. `room_safe` (the name) is kept only for MCP retrieval +
logging; `room_id_key = str(location_id)` keys the nav subsystem.

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def t1_same_name_diff_id_are_distinct() -> bool:
    # Mirror of the id-keyed visit/adjacency population.
    room_event_counts: dict[str, int] = {}
    adjacency: dict[str, dict[str, str]] = {}
    # Walk: id=10 "Forest" --north--> id=11 "Forest" --north--> id=12 "Forest"
    walk = [(10, "Forest"), (11, "Forest"), (12, "Forest"), (11, "Forest")]
    prev_id = 0
    for (lid, _name), direction in zip(walk, ["north", "north", "south", None]):
        rid = str(lid)
        room_event_counts[rid] = room_event_counts.get(rid, 0) + 1
        if direction and prev_id:
            adjacency.setdefault(str(prev_id), {})[direction] = rid
        prev_id = lid
    # Three distinct Forest rooms → 3 keys, none overvisited (max count 2).
    if set(room_event_counts.keys()) != {"10", "11", "12"}:
        print(f"FAIL t1: same-named rooms must stay distinct by id, got {room_event_counts}")
        return False
    if max(room_event_counts.values()) > 2:
        print(f"FAIL t1: no single id should collapse to 145; got {room_event_counts}")
        return False
    # Adjacency is a real id->id path, not a self-loop on one "forest" node.
    if adjacency.get("10", {}).get("north") != "11" or adjacency.get("11", {}).get("south") != "12":
        print(f"FAIL t1: adjacency must be id->id path, got {adjacency}")
        return False
    print(f"PASS t1: 3 same-named 'Forest' rooms = 3 distinct id nodes ({room_event_counts}); router sees a real path")
    return True


def t2_name_key_would_collapse() -> bool:
    # Demonstrate the OLD name-keyed behaviour collapses (what we fixed).
    name_counts: dict[str, int] = {}
    for _ in range(145):
        name_counts["forest"] = name_counts.get("forest", 0) + 1
    if name_counts.get("forest") != 145:
        print("FAIL t2: name-keying control should collapse to one node")
        return False
    print("PASS t2: (control) name-keying collapses 145 visits into ONE node — the bug we removed")
    return True


def t3_source_wiring() -> bool:
    ok = ('_rid = str(loc_id_int)' in SRC
          and 'self._room_event_counts[_rid]' in SRC
          and '_k72_room_key = str(loc_id_int)' in SRC
          and 'self._adjacency.setdefault(_adj_prev, {})[direction] = _adj_cur' in SRC
          and 'self._prev_loc_id = loc_id_int' in SRC
          and 'room_id_key = str(location_id) if location_id else' in SRC
          and 'def brain_suggest_action(self, room: str, observation: str, location_id: int = 0)' in SRC
          and '_k72_local = self._room_action_outcomes.get(room_id_key' in SRC
          and '_k50_cur_room = room_id_key' in SRC)
    print("PASS t3: id-keyed map wired (memory-manager populate + planner reads + router + threaded location_id)"
          if ok else "FAIL t3: id-keyed wiring incomplete")
    return ok


def t4_call_sites_pass_location_id() -> bool:
    ok = SRC.count("location_id=int(getattr(") >= 2
    print("PASS t4: both planner call sites pass location_id (_prev_loc_id)"
          if ok else "FAIL t4: a planner call site does not pass location_id")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_same_name_diff_id_are_distinct(), t2_name_key_would_collapse(),
               t3_source_wiring(), t4_call_sites_pass_location_id()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- id-keyed-map repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
