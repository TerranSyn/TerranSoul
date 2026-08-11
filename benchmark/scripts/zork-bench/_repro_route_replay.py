"""Reproduce-first regression test — ROUTE-REPLAY (iter-1 fix, 2026-06-16).

Origin: the v3 validation bench (zork-12b-selfimprove-v3) scored 5/5/0. The
evidence dig found the memory was WRITE-ONLY — the bridge ingests ~100 lessons
per episode but the in-loop strategic retrieval returned 0 hits every turn
(summary room_scoped_search_hits:0). EP1 and EP2 both executed + ingested the
winning path (west->east->up->take egg = +5), but only the SCORING move was
recorded as a replayable SOLUTION_MOVE — the ROUTE rooms had none, so EP3 took
'south' at move 3, never reached the tree, and scored 0. The proven path sat
unread ("write-only memory cannot self-improve").

The fix records the agent's OWN navigation route that led to a score as
SOLUTION_MOVEs (one per route room), surfaced by the EXISTING per-room
SOLUTION-REPLAY planner block (which already lands by exact loc_ tag). This
test proves, in <0.1s with NO bench / NO MCP, the pure route helpers:

  1. _route_nav_moves extracts the location-changing moves (the navigation
     path), keeps the last k, drops in-place actions, preserves order.
  2. _format_route_move emits content in the EXACT shape the planner's
     SOLUTION-REPLAY regex parses (`SOLUTION_MOVE at '<room>': do '<act>'`).
  3. End-to-end: a trajectory that reaches a scoring room yields a route whose
     rooms+actions cover the proven path (so a later episode replays it).
  4. AGI-purity: the format TEMPLATE carries no game-specific tokens.
"""
import re
import sys

sys.path.insert(0, r"D:\Git\TerranSoulApp\benchmark\scripts\zork-bench")
from terransoul_brain_bridge import (  # noqa: E402
    _route_nav_moves,
    _format_route_move,
)

fails: list[str] = []

# --- 1. _route_nav_moves: keep navigation (location-changing) moves, last k ---
traj = [
    ("West of House", "west", True),    # nav
    ("Forest", "examine tree", False),  # in-place -> dropped
    ("Forest", "up", True),             # nav
    ("Up a Tree", "take egg", True),    # nav (the scoring move itself)
]
# the caller passes self._traj[:-1] (prior turns, excluding the scoring move)
nav = _route_nav_moves(traj[:-1])
if nav != [("West of House", "west"), ("Forest", "up")]:
    fails.append(f"route nav extraction wrong: {nav}")
if any(a == "examine tree" for _, a in nav):
    fails.append("route nav kept an in-place (non-location-changing) action")

# --- 1b. k cap keeps only the most recent k nav moves, in order ---
long_traj = [(f"room{i}", f"go{i}", True) for i in range(20)]
capped = _route_nav_moves(long_traj, 5)
if len(capped) != 5 or capped[0] != ("room15", "go15") or capped[-1] != ("room19", "go19"):
    fails.append(f"route nav k-cap wrong: {capped}")
if _route_nav_moves([], 10) != []:
    fails.append("empty trajectory should yield no route")
if _route_nav_moves([("R", "look", False)], 10) != []:
    fails.append("a trajectory with no location-changing moves should yield no route")

# --- 2. _format_route_move matches the planner's SOLUTION-REPLAY parser ---
# The planner (terransoul_brain_bridge ~5081) checks:
#   "SOLUTION_MOVE" in c  AND  "at '<room>'" in c   then  re.search(r"do '([^']+)'", c)
content = _format_route_move("West of House", "west")
if "SOLUTION_MOVE" not in content:
    fails.append("route move missing SOLUTION_MOVE marker (planner filter)")
if "at 'West of House'" not in content:
    fails.append("route move missing the room key the planner matches")
m = re.search(r"do '([^']+)'", content)
if not m or m.group(1) != "west":
    fails.append(f"planner regex cannot extract the route action from: {content!r}")
if "route to score" not in content:
    fails.append("route move not distinguishable from a true scoring move")

# --- 3. END-TO-END: the route covers the proven path rooms+actions ---
episode = [
    ("West of House", "west", True),
    ("West of House", "look", False),  # noise
    ("Forest", "up", True),
    ("Up a Tree", "take egg", True),   # SCORES here (the current move)
]
route = dict(_route_nav_moves(episode[:-1], 10))
if route.get("West of House") != "west":
    fails.append("route does not steer 'West of House' -> 'west'")
if route.get("Forest") != "up":
    fails.append("route does not steer 'Forest' -> 'up'")

# --- 4. AGI-purity: the format TEMPLATE carries no game-specific tokens ---
banned = ["trophy case", "mailbox", "kitchen", "grue", "lantern", "jewel",
          "egg", "troll", "west of house", "living room"]
template = _format_route_move("R", "A").lower()
leak = [b for b in banned if b in template]
if leak:
    fails.append(f"route move TEMPLATE leaks game tokens: {leak}")

if fails:
    print("FAIL:")
    for f in fails:
        print("  -", f)
    sys.exit(1)

print(
    "PASS: ROUTE-REPLAY records the agent's own navigation route (location-changing "
    "moves, last-k, order-preserving) as SOLUTION_MOVEs in the exact shape the "
    "planner's per-room SOLUTION-REPLAY already parses; end-to-end the route steers "
    "each path room to its proven action; template is seed-free."
)
sys.exit(0)
