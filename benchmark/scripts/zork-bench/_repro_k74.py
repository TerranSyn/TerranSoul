"""K74 sub-10s repro: one-shot reward `success -> consumed` transition.

Scenario:
1. take egg in Up a Tree -> score_delta=+5 -> outcome=success
2. take egg again in Up a Tree -> score_delta=0, no inv change -> must
   transition success -> consumed (NOT stay success forever).
3. _score("take egg") in Up a Tree must return 0 (not 12) so the
   planner stops re-promoting an already-consumed action.
4. take egg in Forest (different room) untouched.
5. genuine progress later in same room can upgrade consumed back up.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


class FakeMCP:
    def __init__(self) -> None:
        self.calls: list = []

    def tool(self, name, args=None):
        self.calls.append((name, args))
        return {"verdict": "continue", "results": []}


def _mk():
    from terransoul_brain_bridge import BrainMemoryManager
    return BrainMemoryManager(mcp=FakeMCP())


def t1_success_then_neutral_becomes_consumed() -> bool:
    mm = _mk()
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="Taken.",
        z_machine_context={"score_delta": 5, "inventory_changed": True, "inventory_after": ["egg"]},
    )
    if mm._room_action_outcomes.get("9", {}).get("take egg") != "success":
        print(f"FAIL t1a: expected success, got {mm._room_action_outcomes!r}")
        return False
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="You already have that.",
        z_machine_context={"score_delta": 0, "inventory_changed": False},
    )
    got = mm._room_action_outcomes.get("9", {}).get("take egg")
    if got != "consumed":
        print(f"FAIL t1b: expected consumed, got {got!r}")
        return False
    print("PASS t1: success -> consumed on re-execute with no delta")
    return True


def t2_consumed_does_not_downgrade_to_neutral() -> bool:
    mm = _mk()
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="Taken.",
        z_machine_context={"score_delta": 5, "inventory_changed": True},
    )
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="You already have that.",
        z_machine_context={"score_delta": 0, "inventory_changed": False},
    )
    # third re-execution: still no delta. Must remain consumed (priority 2 >= neutral 1).
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="You already have that.",
        z_machine_context={"score_delta": 0, "inventory_changed": False},
    )
    got = mm._room_action_outcomes.get("9", {}).get("take egg")
    if got != "consumed":
        print(f"FAIL t2: expected consumed sticky, got {got!r}")
        return False
    print("PASS t2: consumed does not downgrade to neutral on further re-exec")
    return True


def t3_progress_can_upgrade_consumed() -> bool:
    """A genuine new score on the same (room, act) lifts consumed back to success."""
    mm = _mk()
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="Taken.",
        z_machine_context={"score_delta": 5, "inventory_changed": True},
    )
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="You already have that.",
        z_machine_context={"score_delta": 0, "inventory_changed": False},
    )
    # Now simulate a hypothetical second-stage reward (rare but possible
    # in some games). Must upgrade consumed -> success.
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="Taken (again, somehow).",
        z_machine_context={"score_delta": 5, "inventory_changed": True},
    )
    got = mm._room_action_outcomes.get("9", {}).get("take egg")
    if got != "success":
        print(f"FAIL t3: expected success upgrade, got {got!r}")
        return False
    print("PASS t3: success can upgrade consumed (priority 4 > 2)")
    return True


def t4_room_scoping() -> bool:
    """take egg in Up a Tree consumed must NOT affect Forest."""
    mm = _mk()
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="Taken.",
        z_machine_context={"score_delta": 5, "inventory_changed": True},
    )
    mm.record_action_outcome(
        location_id=9, location_name="Up a Tree", action="take egg",
        response="You already have that.",
        z_machine_context={"score_delta": 0, "inventory_changed": False},
    )
    if mm._room_action_outcomes.get("forest", {}).get("take egg") is not None:
        print("FAIL t4: Forest should be empty")
        return False
    if mm._room_action_outcomes.get("9", {}).get("take egg") != "consumed":
        print("FAIL t4: Up a Tree should be consumed")
        return False
    print("PASS t4: consumed is room-scoped")
    return True


def t5_planner_score_consumed_keeps_attractor() -> bool:
    """K75 semantics: _score() returns +12 for consumed (sticky attractor).

    K74 used 0 here and regressed 5/350 -> 0/350 because removing the
    success attractor broke the path-back-to-Up-a-Tree behaviour. K75
    keeps observation telemetry (success -> consumed transition still
    recorded) but restores the +12 scoring.
    """
    src = Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8")
    if 'outcome == "consumed"' not in src:
        print("FAIL t5: _score() does not handle consumed")
        return False
    if "previously rewarded path" not in src:
        print("FAIL t5: K75 attractor reason text missing")
        return False
    if "return (12," not in src.split('outcome == "consumed"', 1)[1].split('if outcome == "progress"', 1)[0]:
        print("FAIL t5: consumed branch does not return +12")
        return False
    print("PASS t5: planner _score handles consumed -> +12 (K75 attractor)")
    return True


def t6_priority_dicts_consistent() -> bool:
    """Both priority dicts must include consumed at value 2."""
    src = Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8")
    if src.count('"consumed": 2') < 2:
        n = src.count('"consumed": 2')
        print(f"FAIL t6: expected consumed:2 in both priority dicts, found {n}")
        return False
    print("PASS t6: priority dicts consistent (consumed=2 in both)")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [
        t1_success_then_neutral_becomes_consumed(),
        t2_consumed_does_not_downgrade_to_neutral(),
        t3_progress_can_upgrade_consumed(),
        t4_room_scoping(),
        t5_planner_score_consumed_keeps_attractor(),
        t6_priority_dicts_consistent(),
    ]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    n = len(results)
    print(f"\n--- K74 repro: {p}/{n} passed in {dt:.2f}s ---")
    return 0 if p == n else 1


if __name__ == "__main__":
    sys.exit(main())
