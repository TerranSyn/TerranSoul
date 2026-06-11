"""Sub-second repro for ODY-8 RESOLVE-BLOCKER openable detection.

Distinguishes a CONFIRMED openable (observation state cue: 'ajar'/'closed'/
'locked') from speculative scenery — generic state-language only, no domain
noun list. This is what lets `open window` reach frontier priority while
`open forest` stays capped.
"""
from __future__ import annotations
import sys, time
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


def t1_ajar_window_is_openable() -> bool:
    from terransoul_brain_bridge import _openable_nouns
    obs = ("Behind House You are behind the white house. In one corner of the "
           "house there is a small window which is slightly ajar.")
    out = _openable_nouns(obs, ["forest", "house", "path", "window"])
    if "window" not in out:
        print(f"FAIL t1: window (ajar) should be openable, got {out}")
        return False
    # K30 fix: 'house' is far from the cue 'ajar' (which modifies 'window'),
    # so proximity must NOT flag it — else `open house` steals the top slot.
    if {"forest", "path", "house"} & out:
        print(f"FAIL t1: only the noun the cue FOLLOWS should be openable, got {out}")
        return False
    print(f"PASS t1: proximity flags only 'window' (cue-following); house/scenery excluded ({out})")
    return True


def t2_closed_locked_cues() -> bool:
    from terransoul_brain_bridge import _openable_nouns
    if "door" not in _openable_nouns("A heavy oak door, firmly closed.", ["door"]):
        print("FAIL t2: 'closed' door should be openable"); return False
    if "chest" not in _openable_nouns("A wooden chest here, locked.", ["chest"]):
        print("FAIL t2: 'locked' chest should be openable"); return False
    print("PASS t2: closed/locked cues detected")
    return True


def t3_no_cue_no_promotion() -> bool:
    from terransoul_brain_bridge import _openable_nouns
    out = _openable_nouns("A forest with trees and a winding path.", ["forest", "path", "trees"])
    if out:
        print(f"FAIL t3: no closable cue should yield empty set, got {out}")
        return False
    print("PASS t3: nouns with no closable cue are NOT promoted (no scenery trap)")
    return True


def t4_same_sentence_only() -> bool:
    from terransoul_brain_bridge import _openable_nouns
    # cue and noun in DIFFERENT sentences -> not confirmed (avoid false promote)
    obs = "There is a window here. The gate to the north is closed."
    out = _openable_nouns(obs, ["window", "gate"])
    if "window" in out:
        print(f"FAIL t4: window (no same-sentence cue) should not be openable, got {out}")
        return False
    if "gate" not in out:
        print(f"FAIL t4: gate (closed, same sentence) should be openable, got {out}")
        return False
    print("PASS t4: cue must co-occur in the SAME sentence as the noun")
    return True


def t5_wiring_present() -> bool:
    src = (Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8"))
    ok = ("_ody8_openable = _openable_nouns(" in src
          and "_ody8_blocker_verbs" in src
          and "effective_bonus = FRONTIER_BONUS" in src
          and "confirmed openable" in src)
    print("PASS t5: ODY-8 wiring present in planner" if ok else "FAIL t5: wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_ajar_window_is_openable(), t2_closed_locked_cues(),
               t3_no_cue_no_promotion(), t4_same_sentence_only(), t5_wiring_present()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- ODY-8 openable repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
