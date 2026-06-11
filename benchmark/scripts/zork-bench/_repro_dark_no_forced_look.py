"""Sub-second repro for the K48 dark-state harness exemption (fatal bug fix).

Bug (live in K47 ep1, turn 13 — grue DEATH): in the pitch-black Attic the
agent oscillated `up`/`down` (enter dark / retreat). The harness loop-break
(Layer 3) saw the A-B-A-B / A-A-A pattern and FORCED `look` — overriding the
planner's life-saving DARK-RETREAT `down`. `look` does not escape darkness, so
the next move walked the agent into a grue: "You have died".

Fix: when the current observation is a no-visibility state, the harness must
NOT force `look` (Layer 3) — repeated movement in the dark is ESCAPE, not a
loop. The agent's retreat command passes through untouched. Generic survival
rule keyed on the existing domain-agnostic `_has_no_visibility` detector.

Asserts (logic mirror + source wiring + the real detector; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))
SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def forced_look(history, dark_state) -> bool:
    """Mirror of the Layer-3 loop-break with the K48 dark exemption."""
    fl = False
    if not dark_state and len(history) >= 4:
        l4 = history[-4:]
        if l4[0] == l4[2] and l4[1] == l4[3] and l4[0] != l4[1]:
            fl = True
    if not dark_state and not fl and len(history) >= 3:
        if all(p == history[-3:][0] for p in history[-3:]):
            fl = True
    return fl


def t1_real_detector_flags_pitch_black() -> bool:
    from terransoul_brain_bridge import _has_no_visibility
    if not _has_no_visibility("it is pitch black. you are likely to be eaten by a grue."):
        print("FAIL t1: 'pitch black' must be a no-visibility state")
        return False
    if _has_no_visibility("kitchen you are in the kitchen of the white house."):
        print("FAIL t1: a lit room must NOT be no-visibility")
        return False
    print("PASS t1: real _has_no_visibility detector distinguishes dark vs lit")
    return True


def t2_abab_in_dark_not_forced() -> bool:
    # Kitchen↔Attic oscillation: (Attic,down),(Kitchen,up) ABAB. In the dark,
    # forcing look = death → must NOT force.
    hist = [("attic", "down"), ("kitchen", "up"), ("attic", "down"), ("kitchen", "up")]
    if forced_look(hist, dark_state=True):
        print("FAIL t2: must NOT force look in the dark (would override retreat → grue)")
        return False
    print("PASS t2: ABAB oscillation in the dark does NOT force look (retreat survives)")
    return True


def t3_abab_in_light_still_forced() -> bool:
    # In a LIT room the loop-break still fires (no regression).
    hist = [("forest", "down"), ("forest2", "up"), ("forest", "down"), ("forest2", "up")]
    if not forced_look(hist, dark_state=False):
        print("FAIL t3: in the light, ABAB must still force look (loop-break intact)")
        return False
    aaa = [("r", "x"), ("r", "x"), ("r", "x")]
    if not forced_look(aaa, dark_state=False):
        print("FAIL t3: in the light, AAA must still force look")
        return False
    print("PASS t3: in the light the loop-break is unchanged (AAA + ABAB fire)")
    return True


def t4_source_wiring() -> bool:
    ok = ("dark_state = _has_no_visibility((self._last_observation or \"\").lower())" in SRC
          and "if not dark_state and len(self._action_history) >= 4:" in SRC
          and "if not dark_state and not forced_look and len(self._action_history) >= 3:" in SRC)
    print("PASS t4: dark-state exemption wired into the harness gate"
          if ok else "FAIL t4: dark-state gate wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_real_detector_flags_pitch_black(), t2_abab_in_dark_not_forced(),
               t3_abab_in_light_still_forced(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- dark-no-forced-look repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
