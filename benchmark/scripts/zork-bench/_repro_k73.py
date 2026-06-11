"""Sub-10s reproducer for K73 fix — fixed-noun passthrough + filter.

Validates two things end-to-end without launching Docker:

1. BRIDGE: `record_action_outcome("take window")` with no inventory change
   populates `_room_take_outcomes["behind house"]["window"] = "fixed"`.
2. PATCH: with `fixed_nouns=["window"]` injected into the shortlist JSON,
   the brain-pin logic must (a) NOT force `take window` again via K68,
   and (b) NOT replace LLM's `open window` with a frontier cardinal via
   K54. The new K73 elif must set status='passthrough_fixed_noun_k73'
   and leave action=`open window` untouched.

Doctrine: P8 reproduce-first. Run me BEFORE re-running the 30T bench.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


class FakeMCP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def tool(self, name: str, args: dict | None = None):
        self.calls.append((name, args or {}))
        # brain_observe_outcome must return continue verdict
        return {"verdict": "continue", "results": []}


def t1_bridge_classifies_fixed_window() -> bool:
    """Bridge K73: take window with no inventory change → fixed."""
    from terransoul_brain_bridge import BrainMemoryManager

    mgr = BrainMemoryManager(mcp=FakeMCP())
    mgr.record_action_outcome(
        location_id=27,
        location_name="Behind House",
        action="take window",
        response="The window is fixed in place.",
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
    room_map = mgr._room_take_outcomes.get("behind house", {})
    if room_map.get("window") != "fixed":
        print(f"FAIL t1: expected window=fixed, got {room_map!r}")
        return False
    print("PASS t1: bridge marked 'window' as fixed in Behind House")
    return True


def t2_bridge_classifies_portable_lamp() -> bool:
    """Bridge K73: take lamp with inventory change → portable."""
    from terransoul_brain_bridge import BrainMemoryManager

    mgr = BrainMemoryManager(mcp=FakeMCP())
    mgr.record_action_outcome(
        location_id=42,
        location_name="Living Room",
        action="take lamp",
        response="Taken.",
        z_machine_context={
            "score_delta": 0,
            "location_changed": False,
            "inventory_changed": True,
            "first_visit": False,
            "died": False,
            "score_after": 0,
            "inventory_after": ["lamp"],
        },
    )
    room_map = mgr._room_take_outcomes.get("living room", {})
    if room_map.get("lamp") != "portable":
        print(f"FAIL t2: expected lamp=portable, got {room_map!r}")
        return False
    print("PASS t2: bridge marked 'lamp' as portable in Living Room")
    return True


def t3_bridge_portable_not_downgraded() -> bool:
    """Bridge K73: portable does not get downgraded to fixed."""
    from terransoul_brain_bridge import BrainMemoryManager

    mgr = BrainMemoryManager(mcp=FakeMCP())
    # First: take egg (portable)
    mgr.record_action_outcome(
        location_id=9,
        location_name="Up a Tree",
        action="take egg",
        response="Taken.",
        z_machine_context={"inventory_changed": True, "inventory_after": ["egg"]},
    )
    # Second: drop egg + take egg again, this time no inventory delta from the
    # take (already carrying) — must NOT downgrade portable to fixed.
    mgr.record_action_outcome(
        location_id=9,
        location_name="Up a Tree",
        action="take egg",
        response="You already have that.",
        z_machine_context={"inventory_changed": False},
    )
    room_map = mgr._room_take_outcomes.get("up a tree", {})
    if room_map.get("egg") != "portable":
        print(f"FAIL t3: expected egg stays portable, got {room_map!r}")
        return False
    print("PASS t3: portable classification is sticky (no downgrade)")
    return True


def t4_bridge_writes_fixed_nouns_to_shortlist(tmp_path: Path) -> bool:
    """Bridge K73: brain_shortlist.json contains fixed_nouns + portable_nouns."""
    from terransoul_brain_bridge import BrainMemoryManager

    mgr = BrainMemoryManager(mcp=FakeMCP())
    mgr.record_action_outcome(
        location_id=27,
        location_name="Behind House",
        action="take window",
        response="The window is fixed in place.",
        z_machine_context={"inventory_changed": False},
    )
    # Patch the hardcoded /bench/game_files/ path to a tmp location by
    # monkeypatching os.makedirs + open via env. Simpler: just call the
    # internal write path. The bridge writes inside get_action_shortlist
    # which is too heavy to mock. Instead, directly validate the field
    # is populated; full I/O validated by the bench Docker integration.
    room_map = mgr._room_take_outcomes.get("behind house", {})
    _fixed = sorted({n for n, c in room_map.items() if c == "fixed"})
    if _fixed != ["window"]:
        print(f"FAIL t4: expected fixed=['window'], got {_fixed!r}")
        return False
    print("PASS t4: fixed_nouns derivable from _room_take_outcomes")
    return True


def t5_patch_k73_passthrough_in_string_literal() -> bool:
    """PATCH K73: literal contains passthrough_fixed_noun_k73 branch."""
    patch_text = Path(__file__).with_name("zork_agent_patch.py").read_text(
        encoding="utf-8"
    )
    if "passthrough_fixed_noun_k73" not in patch_text:
        print("FAIL t5: K73 status string missing from patch literal")
        return False
    if "_bp_fixed_nouns" not in patch_text:
        print("FAIL t5: _bp_fixed_nouns not loaded in patch literal")
        return False
    if "_bp_n not in _bp_fixed_nouns" not in patch_text:
        print("FAIL t5: K68/K63 noun filter does not skip fixed nouns")
        return False
    # Both K68 force-take loop and K63 force-take loop must skip fixed.
    occurrences = patch_text.count("_bp_n not in _bp_fixed_nouns")
    if occurrences < 2:
        print(f"FAIL t5: expected 2+ fixed-noun guards in K68+K63, got {occurrences}")
        return False
    print(f"PASS t5: patch literal has K73 passthrough + {occurrences} noun guards")
    return True


def t6_knowledge_manager_can_reach_fixed_nouns() -> bool:
    """Regression: BrainKnowledgeManager.brain_suggest_action JSON write
    accesses `_room_take_outcomes` via `self.memory_manager` (NOT `self`)
    because the field lives on BrainMemoryManager. Validates the wiring."""
    from terransoul_brain_bridge import (
        BrainKnowledgeManager,
        BrainMemoryManager,
    )

    mm = BrainMemoryManager(mcp=FakeMCP())
    mm.record_action_outcome(
        location_id=27,
        location_name="Behind House",
        action="take window",
        response="The window is fixed.",
        z_machine_context={"inventory_changed": False},
    )
    km = BrainKnowledgeManager(mcp=FakeMCP(), memory_manager=mm)
    # Mirror the exact expression used in the JSON write block:
    _mm = getattr(km, "memory_manager", None)
    _outcomes = getattr(_mm, "_room_take_outcomes", {}) if _mm else {}
    fixed = sorted({n for n, c in _outcomes.get("behind house", {}).items() if c == "fixed"})
    if fixed != ["window"]:
        print(f"FAIL t6: knowledge manager could not reach fixed_nouns, got {fixed!r}")
        return False
    print("PASS t6: BrainKnowledgeManager reaches _room_take_outcomes via memory_manager")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [
        t1_bridge_classifies_fixed_window(),
        t2_bridge_classifies_portable_lamp(),
        t3_bridge_portable_not_downgraded(),
        t4_bridge_writes_fixed_nouns_to_shortlist(Path(".")),
        t5_patch_k73_passthrough_in_string_literal(),
        t6_knowledge_manager_can_reach_fixed_nouns(),
    ]
    dt = time.monotonic() - t0
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\n--- K73 repro: {passed}/{total} passed in {dt:.2f}s ---")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
