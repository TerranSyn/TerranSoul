"""Sub-second repro for ODY-1: generic loop-breaker + force-answer.

Reimplements the Odysseus src/agent_loop.py anti-flail pattern as a
domain-agnostic primitive. Proves:
  t1  same (ctx, action) with no progress N times -> force_break at N
  t2  a progress signal resets the streak
  t3  distinct actions/contexts are tracked independently
  t4  is_broken() keeps suppressing until progress resets
  t5  the primitive is domain-agnostic (no task vocabulary in signature)
  t6  integration: a force-broken neutral repeat escalates to "loop"
      (the planner's hard -15 filter) so the looped action is dropped
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


def t1_force_break_at_threshold() -> bool:
    from terransoul_brain_bridge import LoopBreaker
    lb = LoopBreaker(stuck_threshold=3)
    r1 = lb.observe("RoomA", "north", made_progress=False)
    r2 = lb.observe("RoomA", "north", made_progress=False)
    r3 = lb.observe("RoomA", "north", made_progress=False)
    if r1["force_break"] or r2["force_break"]:
        print(f"FAIL t1: broke too early {r1} {r2}")
        return False
    if not r3["force_break"] or r3["repeats"] != 3:
        print(f"FAIL t1: should break at 3, got {r3}")
        return False
    print("PASS t1: force_break fires exactly at stuck_threshold")
    return True


def t2_progress_resets() -> bool:
    from terransoul_brain_bridge import LoopBreaker
    lb = LoopBreaker(stuck_threshold=3)
    lb.observe("RoomA", "north", False)
    lb.observe("RoomA", "north", False)
    reset = lb.observe("RoomA", "north", made_progress=True)
    after = lb.observe("RoomA", "north", made_progress=False)
    if reset["repeats"] != 0 or reset["force_break"]:
        print(f"FAIL t2: progress did not reset: {reset}")
        return False
    if after["repeats"] != 1:
        print(f"FAIL t2: streak should restart at 1, got {after}")
        return False
    print("PASS t2: a progress signal resets the streak")
    return True


def t3_independent_signatures() -> bool:
    from terransoul_brain_bridge import LoopBreaker
    lb = LoopBreaker(stuck_threshold=2)
    lb.observe("RoomA", "north", False)
    other = lb.observe("RoomA", "south", False)   # different action
    other_ctx = lb.observe("RoomB", "north", False)  # different room
    if other["force_break"] or other_ctx["force_break"]:
        print(f"FAIL t3: distinct sigs should not break: {other} {other_ctx}")
        return False
    print("PASS t3: signatures (room, action) tracked independently")
    return True


def t4_is_broken_persists() -> bool:
    from terransoul_brain_bridge import LoopBreaker
    lb = LoopBreaker(stuck_threshold=2)
    lb.observe("RoomA", "north", False)
    lb.observe("RoomA", "north", False)
    if not lb.is_broken("RoomA", "north"):
        print("FAIL t4: is_broken should be True after threshold")
        return False
    lb.observe("RoomA", "north", made_progress=True)
    if lb.is_broken("RoomA", "north"):
        print("FAIL t4: is_broken should clear after progress")
        return False
    print("PASS t4: is_broken persists until a progress reset")
    return True


def t5_domain_agnostic_signature() -> bool:
    from terransoul_brain_bridge import LoopBreaker
    # The signature must be derivable for ANY context/action with no
    # task-specific vocabulary — proven by using non-Zork tokens.
    lb = LoopBreaker(stuck_threshold=2)
    lb.observe("kubernetes-cluster", "kubectl get pods", False)
    r = lb.observe("kubernetes-cluster", "kubectl get pods", False)
    if not r["force_break"]:
        print("FAIL t5: primitive must work for arbitrary domains")
        return False
    print("PASS t5: loop-breaker is domain-agnostic")
    return True


def t6_integration_escalates_to_loop() -> bool:
    """The wired path must turn a force-broken neutral repeat into the
    'loop' outcome the planner hard-filters at -15."""
    src = (Path(__file__).with_name("terransoul_brain_bridge.py")
           .read_text(encoding="utf-8"))
    checks = [
        "_loop_breaker" in src,
        "self._loop_breaker.observe(" in src,
        # ODY-1d: a force-broken action is forced to "loop" in the per-room
        # outcome map, past the priority guard.
        '_ody1_fb' in src,
        '_k72_room_map[_k72_act_key] = "loop"' in src,
    ]
    if not all(checks):
        print(f"FAIL t6: integration wiring missing: {checks}")
        return False
    print("PASS t6: force-broken action forced to planner 'loop' (past priority guard)")
    return True


def t7_two_room_oscillation_breaks() -> bool:
    """ODY-1b: A->B->A->B oscillation between KNOWN rooms must force-break.
    Each hop is a re-entry into an already-visited room (made_progress=False
    under the first_visit definition), so the repeated (room, action) pair
    accrues a streak and breaks — even though the agent's location changes
    every step."""
    from terransoul_brain_bridge import LoopBreaker
    lb = LoopBreaker(stuck_threshold=3)
    broke = False
    # (RoomA, east)->B, (RoomB, up)->A, repeated. Re-entries => no progress.
    for _ in range(3):
        lb.observe("RoomA", "east", made_progress=False)   # A -> known B
        r = lb.observe("RoomB", "up", made_progress=False)  # B -> known A
        if r["force_break"]:
            broke = True
    if not broke:
        print("FAIL t7: oscillation between known rooms should force-break")
        return False
    print("PASS t7: two-room oscillation force-breaks (re-entry != progress)")
    return True


def t8_wiring_uses_first_visit() -> bool:
    src = (Path(__file__).with_name("terransoul_brain_bridge.py")
           .read_text(encoding="utf-8"))
    if "_ody1_progress = (score_delta > 0) or inventory_changed or first_visit" not in src:
        print("FAIL t8: ODY-1 progress signal must use first_visit, not location_changed")
        return False
    print("PASS t8: loop-break progress signal keys on discovery (first_visit)")
    return True


def t9_guard_covers_progress_outcome() -> bool:
    """ODY-1c: the escalation guard must fire for a force-broken move whose
    raw outcome is "progress" (location_changed into a KNOWN room — the
    oscillation case), not just "neutral". K16 regression: a neutral-only
    guard let the Canyon View↔Rocky Ledge bounce slip past (loop_break=0)."""
    src = (Path(__file__).with_name("terransoul_brain_bridge.py")
           .read_text(encoding="utf-8"))
    # ODY-1d: force-break now forces "loop" unconditionally (past the
    # priority guard), so it covers neutral, progress AND a stale
    # success/consumed attractor — strictly stronger than the old
    # neutral/progress-only escalation.
    if 'if _ody1_fb:' not in src or '_k72_room_map[_k72_act_key] = "loop"' not in src:
        print("FAIL t9: force-break must force 'loop' past the priority guard")
        return False
    print("PASS t9: force-break forces 'loop' for neutral/progress/stale-success alike")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [
        t1_force_break_at_threshold(),
        t2_progress_resets(),
        t3_independent_signatures(),
        t4_is_broken_persists(),
        t5_domain_agnostic_signature(),
        t6_integration_escalates_to_loop(),
        t7_two_room_oscillation_breaks(),
        t8_wiring_uses_first_visit(),
        t9_guard_covers_progress_outcome(),
    ]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- ODY-1 loop-breaker repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
