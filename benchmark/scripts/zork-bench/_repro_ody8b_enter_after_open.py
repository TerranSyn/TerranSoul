"""Sub-second repro for ODY-8b ENTER-AFTER-OPEN.

In text IF, `open X` only OPENS a blocker; a follow-up `enter X`/`in` is
needed to go THROUGH it (open window -> enter -> Kitchen). Proves the
memory manager flags the just-opened noun on success and clears it on
location change. Generic open-success cues, no domain nouns.
"""
from __future__ import annotations
import sys, time
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


class MockMcp:
    def __init__(self): self.calls = []
    def tool(self, name, args):
        if name == "brain_observe_outcome":
            return {"verdict": "continue"}
        return {"content": [{"type": "text", "text": "[]"}]}


def _ctx(loc_changed=False):
    return {"score_delta": 0, "location_changed": loc_changed, "first_visit": False,
            "inventory_changed": False, "died": False, "score_after": 0, "inventory_after": []}


def t1_open_success_sets_noun() -> bool:
    from terransoul_brain_bridge import BrainMemoryManager
    mm = BrainMemoryManager(mcp=MockMcp())
    mm.record_action_outcome(location_name="Behind House", action="open window",
                             response="With great effort, you open the window far enough to allow entry.",
                             z_machine_context=_ctx(loc_changed=False))
    if mm._just_opened_noun != "window":
        print(f"FAIL t1: open-success should set _just_opened_noun='window', got {mm._just_opened_noun!r}")
        return False
    print("PASS t1: successful open sets _just_opened_noun='window'")
    return True


def t2_cleared_on_location_change() -> bool:
    from terransoul_brain_bridge import BrainMemoryManager
    mm = BrainMemoryManager(mcp=MockMcp())
    mm._just_opened_noun = "window"
    mm.record_action_outcome(location_name="Kitchen", action="enter window",
                             response="Kitchen. You are in the kitchen.",
                             z_machine_context=_ctx(loc_changed=True))
    if mm._just_opened_noun != "":
        print(f"FAIL t2: location change should clear _just_opened_noun, got {mm._just_opened_noun!r}")
        return False
    print("PASS t2: _just_opened_noun cleared after going through (location change)")
    return True


def t3_failed_open_does_not_set() -> bool:
    from terransoul_brain_bridge import BrainMemoryManager
    mm = BrainMemoryManager(mcp=MockMcp())
    mm.record_action_outcome(location_name="Behind House", action="open house",
                             response="You can't open that.",
                             z_machine_context=_ctx(loc_changed=False))
    if mm._just_opened_noun:
        print(f"FAIL t3: failed open must NOT set the noun, got {mm._just_opened_noun!r}")
        return False
    print("PASS t3: failed open ('can't open that') does not set the noun")
    return True


def t4_planner_wiring() -> bool:
    src = (Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8"))
    ok = ("_just_opened_noun" in src and "ENTER-AFTER-OPEN" in src
          and "f\"enter {_ody8b_noun}\"" in src.replace("'", '"')
          and "FRONTIER_BONUS + 3" in src)
    print("PASS t4: ENTER-AFTER-OPEN wired into planner" if ok else "FAIL t4: wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_open_success_sets_noun(), t2_cleared_on_location_change(),
               t3_failed_open_does_not_set(), t4_planner_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- ODY-8b enter-after-open repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
