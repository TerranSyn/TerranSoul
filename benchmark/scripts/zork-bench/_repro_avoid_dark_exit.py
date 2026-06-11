"""Sub-second repro for K49 avoid-dark-exit-without-light.

Bug (live in K48): the agent reached the Kitchen (+10) then wasted the whole
episode oscillating Kitchen→`up`→Attic(pitch black)→retreat→`up`… and never
went `west` to the Living Room (the lamp + trap-door → the underground). It
also wandered into the forest maze. Root cause: the planner had no memory that
`up` from the Kitchen leads into darkness, so it kept re-scoring `up` as an
untried frontier (6) equal to the lit `west`.

Fix: record per-room which exit led into a no-visibility room
(mm._dark_exits, keyed by the lit source room); in the planner, when carrying
NO light source, demote those exits below FRONTIER_BONUS so the lit route
(west → Living Room → lamp) wins. Once a light is carried, dark exits keep
their score (the underground needs them). Generic; mirrors ACQUIRE-LIGHT.

Asserts (logic mirror + real detectors + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))
SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def record_dark_exit(dark_exits, last_lit_room, move_dir, new_obs):
    """Mirror of the record_action_outcome dark-exit recording."""
    from terransoul_brain_bridge import _has_no_visibility
    if _has_no_visibility(new_obs.lower()) and move_dir and last_lit_room:
        dark_exits.setdefault(last_lit_room.strip().lower(), set()).add(move_dir)


def demote_score(base, direction, carries_light, dark_here):
    """Mirror of the planner K49 exit demotion."""
    if not carries_light and direction.lower() in dark_here and base > 1:
        return 1
    return base


def t1_records_dark_exit() -> bool:
    de = {}
    record_dark_exit(de, "Kitchen", "up",
                     "It is pitch black. You are likely to be eaten by a grue.")
    if de.get("kitchen") != {"up"}:
        print(f"FAIL t1: Kitchen `up`→dark should be recorded, got {de}")
        return False
    # a lit destination is NOT recorded
    record_dark_exit(de, "Kitchen", "west",
                     "Living Room You are in the living room. A trophy case...")
    if "west" in de.get("kitchen", set()):
        print("FAIL t1: a lit exit must not be recorded as dark")
        return False
    print("PASS t1: dark exit recorded (Kitchen up), lit exit not recorded")
    return True


def t2_demote_without_light() -> bool:
    dark_here = {"up"}
    # no light: `up` (dark) demoted below frontier 6 → 1; `west` (lit) unchanged
    if demote_score(6, "up", carries_light=False, dark_here=dark_here) != 1:
        print("FAIL t2: dark `up` must be demoted with no light")
        return False
    if demote_score(6, "west", carries_light=False, dark_here=dark_here) != 6:
        print("FAIL t2: lit `west` must keep its frontier score")
        return False
    print("PASS t2: no light -> dark `up` demoted to 1, lit `west`=6 wins")
    return True


def t3_with_light_not_demoted() -> bool:
    # carrying a light → dark exits keep their score (underground needs them)
    if demote_score(6, "up", carries_light=True, dark_here={"up"}) != 6:
        print("FAIL t3: with a light, dark exits must NOT be demoted")
        return False
    print("PASS t3: with a light, dark exits keep their score (descend OK)")
    return True


def t4_real_light_detector() -> bool:
    from terransoul_brain_bridge import _light_sources
    if not _light_sources("a battery-powered brass lantern"):
        print("FAIL t4: lantern must count as a light source")
        return False
    if _light_sources("a jewel-encrusted egg"):
        print("FAIL t4: egg is not a light source")
        return False
    print("PASS t4: real _light_sources detector identifies the lamp")
    return True


def t5_source_wiring() -> bool:
    ok = ("self._dark_exits.setdefault(" in SRC
          and "_carries_light = any(" in SRC
          and "d_l in _dark_here and base > 1" in SRC
          and "self._last_lit_room = loc_name" in SRC)
    print("PASS t5: dark-exit memory + demotion wired"
          if ok else "FAIL t5: avoid-dark-exit wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_records_dark_exit(), t2_demote_without_light(),
               t3_with_light_not_demoted(), t4_real_light_detector(),
               t5_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- avoid-dark-exit repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
