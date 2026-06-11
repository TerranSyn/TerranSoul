"""Sub-second repro for ZK-LOOPCAP — the generic fixation-loop killer.

The 4B fixates on the salient carried lantern and burns whole episodes cycling
WHATEVER verb is not individually suppressed: K53 `open lantern`x46 + `turn on
lantern`x45, K54 `move brass lantern`x22, K55 `enter brass lantern`x97. Per-verb
blacklists are whack-a-mole. ZK-LOOPCAP is the root fix: track CONSECUTIVE
no-progress repeats of the same action and, once a multi-token action is emitted
>=3 times in a row without progress (no score, no new room), ban it for the rest
of the episode. The planner then hard-excludes it, overriding every bonus rule.

EXEMPT: bare directions (a direction is a wall in one room but a corridor in
another — owned by the frontier/visited_dirs logic) and deposits (put/drop/give —
banking is the goal; ZK-DELIVER already demotes junk).

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


_EXEMPT = ("put ", "drop ", "give ",
           "kill ", "attack ", "fight ", "hit ", "strike ", "slay ")


class LoopCap:
    """Mirror of the record_action_outcome consecutive + cumulative tracker."""
    def __init__(self) -> None:
        self.looped: set = set()
        self.last = ""
        self.consec = 0
        self.noprog: dict = {}

    def observe(self, act: str, progress: bool) -> None:
        a = act.strip().lower()
        # (1) consecutive streak
        if progress:
            self.consec = 0
        elif a and a == self.last:
            self.consec += 1
        else:
            self.consec = 1
        self.last = a
        # (2) cumulative no-progress count (catches alternating fixations)
        if progress:
            self.noprog[a] = 0
        elif a:
            self.noprog[a] = self.noprog.get(a, 0) + 1
        if (" " in a and not a.startswith(_EXEMPT)
                and (self.consec >= 3 or self.noprog.get(a, 0) >= 4)):
            self.looped.add(a)


def t1_consecutive_nonsense_banned() -> bool:
    lc = LoopCap()
    for _ in range(3):
        lc.observe("enter brass lantern", progress=False)
    if "enter brass lantern" not in lc.looped:
        print(f"FAIL t1: 3x consecutive `enter brass lantern` must ban it, got {lc.looped}")
        return False
    print("PASS t1: 3x consecutive no-progress `enter brass lantern` -> banned (the K55 loop)")
    return True


def t2_bare_direction_exempt() -> bool:
    lc = LoopCap()
    for _ in range(6):
        lc.observe("north", progress=False)
    if lc.looped:
        print(f"FAIL t2: a bare direction must be EXEMPT (frontier logic owns it), got {lc.looped}")
        return False
    print("PASS t2: bare directions are exempt from the cap")
    return True


def t3_deposit_exempt() -> bool:
    lc = LoopCap()
    for _ in range(6):
        lc.observe("put egg in case", progress=False)   # e.g. case closed, fails
    if "put egg in case" in lc.looped:
        print("FAIL t3: deposits must be EXEMPT so banking the egg is never banned")
        return False
    print("PASS t3: put/drop/give deposits are exempt (protect the egg deposit)")
    return True


def t4_progress_resets_counter() -> bool:
    lc = LoopCap()
    lc.observe("enter cave", progress=False)
    lc.observe("enter cave", progress=True)    # it worked once -> reset
    lc.observe("enter cave", progress=False)
    lc.observe("enter cave", progress=False)
    if "enter cave" in lc.looped:
        print(f"FAIL t4: a progressing action must reset the consec counter, got {lc.looped}")
        return False
    print("PASS t4: progress resets the streak (productive repeats never banned)")
    return True


def t5_alternating_fixation_banned_cumulative() -> bool:
    # The K56 egg fixation: `open egg` / `up` / `move egg` interspersed — no
    # action hits 3 IN A ROW, but `open egg` accrues >=4 no-progress emits, so
    # the CUMULATIVE cap bans it (the consecutive-only cap missed this).
    lc = LoopCap()
    for a in ["open egg", "up", "move egg", "open egg", "up",
              "open egg", "move egg", "open egg"]:   # `open egg` x4 interspersed
        lc.observe(a, progress=False)
    if "open egg" not in lc.looped:
        print(f"FAIL t5: alternating `open egg` (>=4 cumulative) must be banned, got {lc.looped}")
        return False
    print("PASS t5: cumulative cap bans an ALTERNATING fixation (the K56 egg loop)")
    return True


def t6_combat_exempt() -> bool:
    # A fight legitimately takes several no-progress rounds before the enemy
    # dies — capping `kill troll with sword` would strand the agent.
    for verb in ("kill troll with sword", "attack thief with knife"):
        lc = LoopCap()
        for _ in range(6):
            lc.observe(verb, progress=False)
        if verb in lc.looped:
            print(f"FAIL t6: combat must be EXEMPT, but {verb!r} was banned")
            return False
    print("PASS t6: combat verbs (kill/attack/...) are exempt (multi-round fights)")
    return True


def t7_source_wiring() -> bool:
    tracker = ("self._looped_actions = set()" in SRC
               and "self._loopcap_consec += 1" in SRC
               and "self._action_noprogress" in SRC
               and "_LOOPCAP_EXEMPT_PREFIXES" in SRC
               and '"kill ", "attack ", "fight ", "hit ", "strike ", "slay "' in SRC)
    planner = ('_looped = getattr(mm, "_looped_actions", set())' in SRC
               and "[LOOPCAP] banned" in SRC)
    if not (tracker and planner):
        print(f"FAIL t7: wiring — tracker={tracker} planner={planner}")
        return False
    print("PASS t7: consecutive+cumulative tracker, combat/deposit exemption, planner exclusion wired")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [t1_consecutive_nonsense_banned(),
               t2_bare_direction_exempt(),
               t3_deposit_exempt(),
               t4_progress_resets_counter(),
               t5_alternating_fixation_banned_cumulative(),
               t6_combat_exempt(),
               t7_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- ZK-LOOPCAP repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
