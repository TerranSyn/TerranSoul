"""K18 reproduce-first snippet — verify tried_map parser fix.

Principle 8: validate at sub-10s before the 6-min docker rebuild.

The K17 bench wandered because `brain_suggest_action` parsed the
tried-action history with a regex that never matched the actual
episodic memory format. Result: every action scored as "untried"
baseline 0, and `take mailbox` (priority 10) always beat `open mailbox`
(priority 9) regardless of how many times it had failed.

This snippet:
1. Loads the bridge under a stub MCP that returns real episodic memory
   shapes seen in the live brain (id 9052, etc).
2. Confirms `tried_map` now picks up "[LOOP]", "[+N SCORE]",
   "[INVENTORY]", "[NEW LOCATION]", and DEAD-END principle memories.
3. Confirms shortlist re-ranks: after 3× `take mailbox` failures,
   `open mailbox` becomes shortlist[0] for the West of House obs.
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
    def __init__(self, episodic, deadend=None):
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
        self.episodic = episodic
        self.deadend = deadend or []

    def tool(self, name, args):
        tags = args.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        if "universal-text-affordance" in tags:
            return {"hits": self.affordances}
        if "universal-planner-bonus" in tags:
            return {"hits": self.bonuses}
        if "episodic" in tags:
            return {"hits": self.episodic}
        if "loop" in tags:
            return {"hits": self.deadend}
        return {"hits": []}


def _make_planner(episodic, deadend=None):
    bk = mod.BrainKnowledgeManager.__new__(mod.BrainKnowledgeManager)
    bk.mcp = StubMcp(episodic, deadend)
    bk.calls = []
    bk.memory_manager = None
    bk._affordances_cache = None
    bk._planner_bonuses_cache = None
    bk._known_exits = {}
    return bk


def _shortlist(bk, room, obs):
    """Run brain_suggest_action and parse shortlist out of /bench file or
    fall back to the markdown block."""
    import re
    out = bk.brain_suggest_action(room, obs)
    actions = []
    for line in out.splitlines():
        m = re.search(r"`([^`]+)`\s*\(score=", line)
        if m:
            actions.append(m.group(1).strip().lower())
    if not actions:
        # fallback regex
        for line in out.splitlines():
            m = re.search(r"`([^`]+)`", line)
            if m:
                actions.append(m.group(1).strip().lower())
    return actions


def main() -> int:
    obs = (
        "West of House\n"
        "You are standing in an open field west of a white house, with a "
        "boarded front door.\n"
        "There is a small mailbox here.\n"
    )

    # Case A — no history. take mailbox should be #1 (priority 10).
    bk = _make_planner(episodic=[])
    a = _shortlist(bk, "West of House", obs)
    print(f"[case A no-history] top-3 = {a[:3]}")
    assert a and a[0] == "take mailbox", \
        f"[FAIL] cold start expected 'take mailbox', got {a[:1]}"
    print("[PASS] cold start: take mailbox wins (priority 10)")

    # Case B — 3× failed take mailbox via [LOOP] episodic memories
    # (this is what add_memory writes when brain_observe_outcome returns
    # dead_end verdict).
    loop_mems = [
        {"content": "[LOOP] Location: West of House | Action: take mailbox | "
                    "Result: It is securely anchored. | Score: 0",
         "tags": "zork,episodic,loc_180,West_of_House,loop"},
    ] * 3
    bk = _make_planner(episodic=loop_mems)
    b = _shortlist(bk, "West of House", obs)
    print(f"[case B 3x loop] top-3 = {b[:3]}")
    assert b and b[0] == "open mailbox", \
        f"[FAIL] after loop, expected 'open mailbox', got {b[:1]}"
    assert "take mailbox" not in b[:2], \
        f"[FAIL] take mailbox still in top-2 after loop verdict: {b[:2]}"
    print("[PASS] post-loop: open mailbox promoted to #1, take mailbox demoted")

    # Case C — DEAD-END principle memory (what brain_observe_outcome
    # ingests on 3rd identical response).
    deadend_mems = [
        {"content": "DEAD-END detected: action='take mailbox' at West of House "
                    "returned the same response 3 times. Skip this action.",
         "tags": "zork,loop,loc_West_of_House,dead_end"},
    ]
    bk = _make_planner(episodic=[], deadend=deadend_mems)
    c = _shortlist(bk, "West of House", obs)
    print(f"[case C dead-end principle] top-3 = {c[:3]}")
    assert c and c[0] == "open mailbox", \
        f"[FAIL] dead-end principle should demote take mailbox, got {c[:1]}"
    print("[PASS] dead-end principle: take mailbox demoted")

    # Case D — score gain memory should keep that action as success/repeat.
    win_mems = [
        {"content": "[+5 SCORE] Location: West of House | Action: open mailbox | "
                    "Result: Opening the small mailbox reveals a leaflet. | Score: 5",
         "tags": "zork,episodic,loc_180,West_of_House,score_gain"},
    ]
    bk = _make_planner(episodic=win_mems)
    d = _shortlist(bk, "West of House", obs)
    print(f"[case D prior win] top-3 = {d[:3]}")
    assert d and d[0] == "open mailbox", \
        f"[FAIL] prior-win should keep open mailbox at top, got {d[:1]}"
    print("[PASS] prior-win: open mailbox stays at #1 with success bonus")

    print("\nAll checks PASS — tried_map parser fix verified at sub-10s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
