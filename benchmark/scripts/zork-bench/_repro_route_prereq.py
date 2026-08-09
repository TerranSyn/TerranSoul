"""Reproduce-first regression test — ROUTE-REPLAY chain bootstrap (2026-06-17).

Origin (audit BUG#1): SOLUTION_MOVE / ROUTE-REPLAY recording fires only inside
`if score_delta > 0`, and the route recorder (`_route_nav_moves`) keeps only
location-CHANGING moves. A multi-step scoring subgoal whose final step scores
but whose PREREQUISITE is a 0-scoring in-place action in the same room (e.g. an
`open`/`unlock` right before a `put`) therefore never had its precondition
persisted. A later episode replayed the final scoring move WITHOUT its
precondition and failed — the bootstrap deadlock that pinned the floor.

The fix adds `_recent_inplace_prereq`: from the agent's OWN prior trajectory it
returns the most-recent in-place (non-location-changing) action(s) issued in the
scoring room, recorded as per-room SOLUTION_MOVEs through the EXISTING replay
path. This test proves, in <0.1s with NO bench / NO MCP, the pure helper:

  1. returns the in-place precondition issued in the scoring room;
  2. ignores location-changing moves and in-place actions in OTHER rooms;
  3. is bounded by k and oldest-first;
  4. round-trips through `_format_route_move` into the planner's parse shape;
  5. AGI-purity: the helper carries no game-specific tokens.
"""
import re
import sys

sys.path.insert(0, r"benchmark\scripts\zork-bench")
from terransoul_brain_bridge import (  # noqa: E402
    _recent_inplace_prereq,
    _format_route_move,
)

fails: list[str] = []

# --- 1. returns the in-place precondition in the scoring room -----------------
# Trajectory tail (prior turns, excluding the current scoring move):
#   enter Living Room (nav), open container (in-place, 0 score), ...
traj = [
    ("Kitchen", "west", True),              # nav into the scoring room
    ("Living Room", "examine container", False),  # in-place, older
    ("Living Room", "open container", False),     # in-place, the precondition
]
prereq = _recent_inplace_prereq(traj, "Living Room", 1)
if prereq != [("Living Room", "open container")]:
    fails.append(f"prereq extraction wrong: {prereq}")

# --- 2. ignores nav moves and in-place actions in OTHER rooms ----------------
if any(a == "west" for _, a in prereq):
    fails.append("prereq kept a location-changing (nav) move")
other = _recent_inplace_prereq(
    [("Kitchen", "open window", False)], "Living Room", 1)
if other != []:
    fails.append(f"prereq leaked an in-place action from another room: {other}")

# --- 3. bounded by k, oldest-first -------------------------------------------
multi = [
    ("Living Room", "a1", False),
    ("Living Room", "a2", False),
    ("Living Room", "a3", False),
]
two = _recent_inplace_prereq(multi, "Living Room", 2)
if two != [("Living Room", "a2"), ("Living Room", "a3")]:
    fails.append(f"prereq k-bound/order wrong: {two}")
if _recent_inplace_prereq([], "Living Room", 1) != []:
    fails.append("empty trajectory should yield no prereq")

# --- 4. round-trips into the planner's SOLUTION-REPLAY parse shape ------------
content = _format_route_move(*prereq[0])
if "SOLUTION_MOVE" not in content or "at 'Living Room'" not in content:
    fails.append("prereq route move missing SOLUTION_MOVE/room key the planner matches")
m = re.search(r"do '([^']+)'", content)
if not m or m.group(1) != "open container":
    fails.append(f"prereq route move action not parseable: {content!r}")

# --- 5. AGI-purity: the helper source carries no game-specific tokens ---------
import inspect  # noqa: E402
src = inspect.getsource(_recent_inplace_prereq).lower()
for tok in ("trophy", "egg", "mailbox", "leaflet", "kitchen", "living room",
            "west of house", "grating", "troll", "thief"):
    if tok in src:
        fails.append(f"AGI-PURITY VIOLATION: game token '{tok}' in helper source")

if fails:
    print("FAIL")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("PASS — _recent_inplace_prereq records the in-place precondition, room/k bounded, AGI-pure")
