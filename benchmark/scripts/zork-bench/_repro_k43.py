"""Sub-second repro for K43 ACQUIRE-LIGHT.

After K42 deposited the egg (score 20) the agent walked into the dark
underground WITHOUT a light and was eaten by a grue (final dropped). K43
makes the planner take + activate a visible light source so dark areas stop
being "pitch black" (no grue) and the underground — the bulk of the 350 —
becomes explorable.

Generic (no Zork object names): `_light_sources()` matches a small set of
universal light-source CUES (lantern/lamp/torch/candle/flashlight) by word
boundary; the planner takes one if visible-and-not-carried, else turns it on.
Priority sits BELOW death-avoidance (DARK-RETREAT +10) and SOLUTION-REPLAY
(+8) but ABOVE DELIVER (+3/+2): survive first, replay known wins, then equip
light, then deposit.

Asserts (real function + wiring; <10s, rule 8):
1. 'lantern'/'lamp' detected by word boundary
2. bare 'light' dropped when a specific source is present
3. no false match inside other words ('delight'/'lightly'/'slightly')
4. empty when no light source named
5. ACQUIRE-LIGHT wired into the planner (take + turn-on, FRONTIER_BONUS+4)
6. priority ordering: DARK-RETREAT(+10) > SOLUTION-REPLAY(+8) > ACQUIRE(+4) > DELIVER(+3/+2)
"""
from __future__ import annotations
import sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))
SRC = Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8")


def t1_specific_sources_detected() -> bool:
    from terransoul_brain_bridge import _light_sources
    obs = "A battery-powered brass lantern is on the trophy case."
    out = _light_sources(obs)
    if "lantern" not in out:
        print(f"FAIL t1: 'lantern' should be detected, got {out}"); return False
    if "lamp" not in _light_sources("There is a brass lamp here."):
        print("FAIL t1: 'lamp' should be detected"); return False
    if "torch" not in _light_sources("A burning torch sits in a bracket."):
        print("FAIL t1: 'torch' should be detected"); return False
    print(f"PASS t1: specific light sources detected ({out})")
    return True


def t2_bare_light_dropped_when_specific_present() -> bool:
    from terransoul_brain_bridge import _light_sources
    # "light" + "lantern" both present -> bare "light" dropped (prefer specific)
    out = _light_sources("The lantern casts a warm light around the room.")
    if "light" in out:
        print(f"FAIL t2: bare 'light' should be dropped when 'lantern' present, got {out}"); return False
    if "lantern" not in out:
        print(f"FAIL t2: 'lantern' should remain, got {out}"); return False
    # When ONLY "light" is named, it is kept (it's the only candidate).
    if "light" not in _light_sources("A soft light glows here."):
        print("FAIL t2: bare 'light' should be kept when it's the only source"); return False
    print(f"PASS t2: bare 'light' dropped iff a specific source co-occurs ({out})")
    return True


def t3_word_boundary_no_substring_false_match() -> bool:
    from terransoul_brain_bridge import _light_sources
    # 'delight'/'lightly'/'slightly' must NOT match 'light'
    for trap in ("It is a place of pure delight.",
                 "The window is slightly ajar.",
                 "She stepped lightly across the room."):
        out = _light_sources(trap)
        if out:
            print(f"FAIL t3: substring false-match on {trap!r} -> {out}"); return False
    print("PASS t3: word-boundary match — no substring false positives")
    return True


def t4_empty_when_no_source() -> bool:
    from terransoul_brain_bridge import _light_sources
    out = _light_sources("You are in a forest with trees and a winding path.")
    if out:
        print(f"FAIL t4: no light source should yield [], got {out}"); return False
    if _light_sources(""):
        print("FAIL t4: empty observation should yield []"); return False
    print("PASS t4: empty when no light source named")
    return True


def t5_acquire_light_wired() -> bool:
    ok = ("ACQUIRE-LIGHT" in SRC
          and "_al_sources = _light_sources(observation)" in SRC
          and "FRONTIER_BONUS + 4" in SRC
          and "take {_al}" in SRC
          and "turn on {_al}" in SRC
          and "light {_al}" in SRC)
    print("PASS t5: ACQUIRE-LIGHT wired (take + activate at FRONTIER_BONUS+4)"
          if ok else "FAIL t5: ACQUIRE-LIGHT wiring missing")
    return ok


def t6_priority_ordering() -> bool:
    # Survive (DARK-RETREAT) > replay known wins (SOLUTION-REPLAY) > equip
    # light (ACQUIRE) > deposit (DELIVER). Verify the literal bonuses present
    # in source encode this ordering.
    import re
    def bonus_for(label: str) -> int | None:
        # In each `scored.append((act, FRONTIER_BONUS + N, f"[LABEL]..."))`
        # the bonus precedes the label, so search the window BEFORE it and
        # take the nearest (last) match.
        idx = SRC.find(label)
        if idx < 0:
            return None
        ms = re.findall(r"FRONTIER_BONUS \+ (\d+)", SRC[max(0, idx - 200):idx])
        return int(ms[-1]) if ms else None
    dark = bonus_for("[DARK-RETREAT]")
    replay = bonus_for("[SOLUTION-REPLAY]")
    acquire = bonus_for("[ACQUIRE-LIGHT]")
    deliver = bonus_for("[DELIVER] open")
    vals = {"DARK-RETREAT": dark, "SOLUTION-REPLAY": replay,
            "ACQUIRE-LIGHT": acquire, "DELIVER-open": deliver}
    if any(v is None for v in vals.values()):
        print(f"FAIL t6: could not parse a bonus: {vals}"); return False
    if not (dark > replay > acquire > deliver):
        print(f"FAIL t6: priority order broken: {vals}"); return False
    print(f"PASS t6: priority {dark}>{replay}>{acquire}>{deliver} "
          f"(survive>replay>equip-light>deposit)")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [t1_specific_sources_detected(),
               t2_bare_light_dropped_when_specific_present(),
               t3_word_boundary_no_substring_false_match(),
               t4_empty_when_no_source(),
               t5_acquire_light_wired(),
               t6_priority_ordering()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- K43 ACQUIRE-LIGHT repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
