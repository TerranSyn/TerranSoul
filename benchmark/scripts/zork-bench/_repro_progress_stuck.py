"""Sub-second repro for ZADOPT-5: objective/progress stuck-timer (ZorkGPT 1A).

Track turns since the last MEANINGFUL progress (score gain OR a brand-new
room). The frontier-router escalates exploration when this is high (>=8), so a
weak agent that is wandering NEW-but-empty rooms without scoring still gets
pulled toward an unexplored frontier — not only when it re-walks a loop.

(The rest of ZADOPT-5 — an objective stack, a universal-pattern KB, and
location-anchored memory with supersession — is provided by existing
TerranSoul mechanisms: planner-priority objectives (DELIVER / ACQUIRE-LIGHT /
SOLUTION-REPLAY / frontier-router), the ODY-10 `zork-strategy` skill
hot-reloaded into the prompt top (universal KB), `loc_<id>`-tagged memories
(location-anchored), and the in-episode `_room_action_outcomes` priority
transitions success->consumed (supersession) + the server-side dedup gate.)

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def step(tsp, score_delta, first_visit):
    """Mirror of the turns-since-progress tracker."""
    return 0 if (score_delta > 0 or first_visit) else tsp + 1


def escalate(tsp, visits):
    """Mirror of the router escalation trigger."""
    return (visits >= 3) or (tsp >= 8)


def t1_progress_resets() -> bool:
    tsp = 5
    if step(tsp, score_delta=5, first_visit=False) != 0:
        print("FAIL t1: a score gain must reset the stuck-timer"); return False
    if step(tsp, score_delta=0, first_visit=True) != 0:
        print("FAIL t1: a brand-new room must reset the stuck-timer"); return False
    print("PASS t1: stuck-timer resets on score gain or new room")
    return True


def t2_increments_when_stuck() -> bool:
    tsp = 0
    for _ in range(8):
        tsp = step(tsp, score_delta=0, first_visit=False)
    if tsp != 8:
        print(f"FAIL t2: should be 8 after 8 no-progress turns, got {tsp}"); return False
    print("PASS t2: stuck-timer counts no-progress turns")
    return True


def t3_escalation_trigger() -> bool:
    # not over-visited (1) and not yet stuck (7) -> no escalation
    if escalate(7, 1):
        print("FAIL t3: should not escalate before stuck threshold / over-visit"); return False
    # stuck (8) even at a fresh room (visits 1) -> escalate
    if not escalate(8, 1):
        print("FAIL t3: should escalate when stuck >=8 even at a new room"); return False
    # over-visited (3) escalates regardless
    if not escalate(0, 3):
        print("FAIL t3: should escalate when over-visited"); return False
    print("PASS t3: router escalates on stuck>=8 OR over-visited>=3")
    return True


def t4_source_wiring() -> bool:
    ok = ("self._turns_since_progress = 0 if (score_delta > 0 or first_visit)" in SRC
          and '_fr_stuck = int(getattr(_fr_mm, "_turns_since_progress", 0) or 0) >= 8' in SRC
          and "(_fr_visits.get(_fr_cur, 0) >= 3) or _fr_stuck" in SRC)
    print("PASS t4: progress stuck-timer + router escalation wired"
          if ok else "FAIL t4: progress-stuck wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_progress_resets(), t2_increments_when_stuck(),
               t3_escalation_trigger(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- progress-stuck (ZADOPT-5) repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
