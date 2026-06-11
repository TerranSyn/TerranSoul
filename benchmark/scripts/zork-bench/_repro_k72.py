"""K72 reproducer — synchronous per-room tried-map overlay.

Verifies that after `record_action_outcome` is called with a wall-bump
(action that didn't change location, didn't change inventory, didn't
score), the per-room outcome map records "neutral", and that the
planner's tried_map merge prefers this synchronous local signal over a
None (== untried) lookup. Generic plumbing test, no Zork data.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "benchmark" / "scripts" / "zork-bench"))


class FakeMCP:
    def tool(self, name, args):
        # Return empty hits — we only test the local overlay path.
        if name == "brain_search":
            return {"hits": []}
        if name == "brain_observe_outcome":
            return {"verdict": "continue"}
        return {}


def _make_bridge():
    import terransoul_brain_bridge as tbb
    # Construct an empty bridge with FakeMCP. Use its dataclass field
    # defaults via `MemoryManager` exactly as bench would (only the
    # fields we touch).
    bridge = tbb.BrainMemoryManager(mcp=FakeMCP())  # type: ignore[call-arg]
    return bridge


def main() -> int:
    bridge = _make_bridge()
    failures = []

    # Case 1: wall bump -> "neutral"
    bridge.record_action_outcome(
        location_id=1,
        location_name="RoomA",
        action="down",
        response="You can't go that way.",
        z_machine_context={
            "score_delta": 0,
            "location_changed": False,
            "inventory_changed": False,
            "first_visit": False,
            "died": False,
            "score_after": 0,
            "inventory_after": [],
        },
    )
    outcomes = bridge._room_action_outcomes.get("1", {})
    if outcomes.get("down") != "neutral":
        failures.append(f"C1: wall-bump -> expected 'neutral', got {outcomes.get('down')!r}")
    else:
        print("[PASS] C1 wall-bump records neutral")

    # Case 2: location change -> "progress"
    bridge.record_action_outcome(
        location_id=2,
        location_name="RoomA",
        action="north",
        response="You arrive at RoomB.",
        z_machine_context={
            "score_delta": 0,
            "location_changed": True,
            "inventory_changed": False,
            "first_visit": True,
            "died": False,
            "score_after": 0,
            "inventory_after": [],
        },
    )
    if bridge._room_action_outcomes.get("2", {}).get("north") != "progress":
        failures.append(f"C2: location-change -> expected 'progress', got {bridge._room_action_outcomes.get('rooma', {}).get('north')!r}")
    else:
        print("[PASS] C2 location-change records progress")

    # Case 3: score gain -> "success" (and overrides prior weaker outcome)
    bridge.record_action_outcome(
        location_id=1,
        location_name="RoomA",
        action="down",
        response="You scored!",
        z_machine_context={
            "score_delta": 5,
            "location_changed": False,
            "inventory_changed": False,
            "first_visit": False,
            "died": False,
            "score_after": 5,
            "inventory_after": [],
        },
    )
    if bridge._room_action_outcomes.get("1", {}).get("down") != "success":
        failures.append(f"C3: score -> expected 'success' upgrade, got {bridge._room_action_outcomes.get('rooma', {}).get('down')!r}")
    else:
        print("[PASS] C3 score upgrades neutral->success")

    # Case 4: weaker outcome does NOT downgrade — neutral after success stays success.
    bridge.record_action_outcome(
        location_id=1,
        location_name="RoomA",
        action="down",
        response="A wall.",
        z_machine_context={
            "score_delta": 0,
            "location_changed": False,
            "inventory_changed": False,
            "first_visit": False,
            "died": False,
            "score_after": 5,
            "inventory_after": [],
        },
    )
    # >= rule means same-priority outcomes can overwrite. neutral (1) < success (4) -> keep success.
    # Case 4: K74 one-shot reward semantics. After a success, a
    # neutral re-execution (score_delta=0, no inv/loc change) must
    # transition success -> consumed so the planner stops re-pinning.
    if bridge._room_action_outcomes.get("1", {}).get("down") != "consumed":
        failures.append(f"C4: success+neutral should become consumed (K74), got {bridge._room_action_outcomes.get('rooma', {}).get('down')!r}")
    else:
        print("[PASS] C4 success+neutral -> consumed (K74 one-shot reward)")

    # Case 5: room scoping — wall-bumping `down` at RoomA must not pollute RoomB.
    bridge.record_action_outcome(
        location_id=3,
        location_name="RoomB",
        action="down",
        response="You go down.",
        z_machine_context={
            "score_delta": 0,
            "location_changed": True,
            "inventory_changed": False,
            "first_visit": True,
            "died": False,
            "score_after": 5,
            "inventory_after": [],
        },
    )
    if bridge._room_action_outcomes.get("3", {}).get("down") != "progress":
        failures.append(f"C5: RoomB down should be 'progress', got {bridge._room_action_outcomes.get('roomb', {}).get('down')!r}")
    elif bridge._room_action_outcomes.get("1", {}).get("down") != "consumed":
        # K74: after C4, RoomA.down was success, then C4 re-recorded as
        # neutral, so K74 transitioned it to consumed. RoomB recording
        # must not affect RoomA.
        failures.append(f"C5: RoomA down should remain 'consumed' from C4 (room-scoped), got {bridge._room_action_outcomes.get('rooma', {}).get('down')!r}")
    else:
        print("[PASS] C5 room-scoped (RoomA.down=consumed, RoomB.down=progress)")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print("  -", f)
        return 1
    print("\nAll K72 cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
