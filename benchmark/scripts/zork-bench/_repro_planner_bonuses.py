"""K17 reproduce-first snippet — verify planner-bonus rebalance.

Principle 8: build a sub-10s validator BEFORE the 6-minute docker rebuild.

Confirms three things in <10 s, no docker, no LLM:

1. The bridge module imports under our patch.
2. ``_get_planner_bonuses`` returns {frontier:6, visited:0, meta:2}
   when stub-MCP returns the same tag shape MCP actually does.
3. Given a "West of House" obs with a visible mailbox, the resulting
   shortlist[0] is an object-verb on the mailbox (`take mailbox`,
   `open mailbox`, …) and *not* a bare direction. This was the
   K15/K16 wandering bug.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BRIDGE = ROOT / "terransoul_brain_bridge.py"

spec = importlib.util.spec_from_file_location("ts_bridge", BRIDGE)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules["ts_bridge"] = mod
spec.loader.exec_module(mod)


class StubMcp:
    """Just enough surface to satisfy the planner."""

    def __init__(self):
        self.affordances = [
            {"content": "open container", "tags": "universal-text-affordance,verb_open,priority_9"},
            {"content": "examine noun", "tags": "universal-text-affordance,verb_examine,priority_6"},
            {"content": "read text", "tags": "universal-text-affordance,verb_read,priority_7"},
            {"content": "take portable", "tags": "universal-text-affordance,verb_take,priority_10"},
            {"content": "look in container", "tags": "universal-text-affordance,verb_look_in,priority_5"},
        ]
        self.bonuses = [
            {"content": "frontier", "tags": "universal-planner-bonus,kind_frontier,priority_6"},
            {"content": "visited", "tags": "universal-planner-bonus,kind_visited,priority_0"},
            {"content": "meta", "tags": "universal-planner-bonus,kind_meta,priority_2"},
        ]

    def tool(self, name, args):
        tags = args.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        if "universal-text-affordance" in tags:
            return {"hits": self.affordances}
        if "universal-planner-bonus" in tags:
            return {"hits": self.bonuses}
        return {"hits": []}


def _make_planner():
    bk = mod.BrainKnowledgeManager.__new__(mod.BrainKnowledgeManager)
    bk.mcp = StubMcp()
    bk.calls = []
    bk.memory_manager = None
    bk._affordances_cache = None
    bk._planner_bonuses_cache = None
    bk._known_exits = {}
    return bk


def main() -> int:
    bk = _make_planner()

    bonuses = bk._get_planner_bonuses()
    expected = {"frontier": 6, "visited": 0, "meta": 2}
    assert bonuses == expected, f"[FAIL] planner bonuses {bonuses} != {expected}"
    print(f"[PASS] planner bonuses: {bonuses}")

    obs = (
        "West of House\n"
        "You are standing in an open field west of a white house, with a boarded "
        "front door.\n"
        "There is a small mailbox here.\n"
    )
    out = bk.brain_suggest_action("West of House", obs)
    assert out, "[FAIL] planner returned empty shortlist"

    import json
    data = json.loads(Path("/bench/game_files/brain_shortlist.json").read_text(encoding="utf-8")) \
        if Path("/bench/game_files/brain_shortlist.json").exists() else None
    if data is None:
        # Outside docker — fall back to parsing the markdown block.
        # First line containing a backtick action is shortlist[0].
        import re as _re
        first = None
        for line in out.splitlines():
            m = _re.search(r"`([^`]+)`", line)
            if m:
                first = m.group(1).strip().lower()
                break
        actions = [first] if first else []
    else:
        actions = [a.lower() for a in data["actions"]]

    assert actions, "[FAIL] empty actions list"
    top = actions[0]
    print(f"[INFO] shortlist top-3: {actions[:3]}")
    forbidden_tops = {"north", "south", "east", "west", "up", "down", "in", "out"}
    assert top not in forbidden_tops, (
        f"[FAIL] shortlist[0]={top!r} is a bare direction; "
        f"object-verb should outrank exploration"
    )
    assert "mailbox" in top, (
        f"[FAIL] shortlist[0]={top!r} does not act on the mailbox; "
        f"expected take/open/examine mailbox"
    )
    print(f"[PASS] shortlist[0] = {top!r} (object-verb on visible noun)")

    print("\nAll checks PASS — safe to launch K17 docker build.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
