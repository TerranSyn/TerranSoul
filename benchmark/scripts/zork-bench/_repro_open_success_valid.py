"""Sub-second repro for the open-success false-positive fix (bench iter K45).

Bug (live in K44, Kitchen turns 28-36): the agent re-issued `open concept` /
`enter concept` / `in` ~28 turns and never went `west` to the Living Room.
Root cause — the Kitchen description contains "a small window which is open";
the open-success detector's passive cue "is open" matched that scenery text,
and the just-opened noun was set to the HALLUCINATED object of `open concept`.
ENTER-AFTER-OPEN then promoted `enter concept`/`in`/`go concept` to
FRONTIER+3 (=9), and the K33 absolute-pin forced it over the real `west`
exit (=6).

Fix (two guards): (1) open-success cues are ACTIVE open-EVENTS only
("with great effort"/" opens"/"swings open"/"creaks open"/"springs open"/
"reveals") — drop passive STATE cues ("is open"/"now open") that match a room
description merely mentioning an already-open object; (2) the opened noun's
head must actually appear in the response (the game names what you really
opened), rejecting LLM-invented objects the parser never saw.

Asserts (logic mirror + source wiring, <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))

# Mirror of the record_action_outcome open-success detection under test.
_OPEN_CUES = ("with great effort", " opens", "swings open",
              "creaks open", "springs open", "reveals")


def detect_just_opened(act: str, resp: str, location_changed: bool) -> str:
    if location_changed:
        return ""
    toks = act.lower().split()
    if len(toks) < 2 or toks[0] not in ("open", "unlock", "unseal", "unlatch"):
        return ""
    rl = resp.lower()
    if not any(c in rl for c in _OPEN_CUES):
        return ""
    on = " ".join(toks[1:]).strip()
    for a in ("the ", "a ", "an "):
        if on.startswith(a):
            on = on[len(a):]
    on = on.strip()
    head = on.split()[-1] if on.split() else on
    return on if (on and head and head in rl) else ""


def t1_real_window_open_flags() -> bool:
    out = detect_just_opened(
        "open window",
        "With great effort, you open the window far enough to allow entry.",
        False)
    if out != "window":
        print(f"FAIL t1: real `open window` should flag 'window', got {out!r}")
        return False
    print("PASS t1: a genuine open (active cue + named noun) flags the noun")
    return True


def t2_kitchen_scenery_does_not_flag_concept() -> bool:
    # The Kitchen desc mentions an already-open window; `open concept` must NOT
    # flag anything (no active cue + 'concept' not named).
    kitchen = ("Kitchen You are in the kitchen of the white house. A passage "
               "leads to the west and a dark staircase can be seen leading "
               "upward. To the east is a small window which is open.")
    out = detect_just_opened("open concept", kitchen, False)
    if out:
        print(f"FAIL t2: scenery 'is open' must NOT flag hallucinated noun, got {out!r}")
        return False
    print("PASS t2: passive 'is open' scenery no longer flags a hallucinated noun")
    return True


def t3_active_cue_but_unnamed_noun_rejected() -> bool:
    # Active cue present, but the opened noun is not named in the response →
    # reject (defends against any other invented-object coincidence).
    out = detect_just_opened("open concept", "The door swings open.", False)
    if out:
        print(f"FAIL t3: noun not named in response must be rejected, got {out!r}")
        return False
    # ...whereas the door that IS named flags correctly.
    if detect_just_opened("open door", "The door swings open.", False) != "door":
        print("FAIL t3: a named door should flag")
        return False
    print("PASS t3: opened noun must be named in the response")
    return True


def t4_location_change_clears() -> bool:
    if detect_just_opened("open window", "With great effort, you open the window.", True):
        print("FAIL t4: a location change must clear the just-opened noun")
        return False
    print("PASS t4: location change clears the flag")
    return True


def t5_source_wiring() -> bool:
    ok = ('"with great effort", " opens", "swings open"' in SRC
          and '"is open"' not in SRC.split("_open_cues =", 1)[1].split(")", 1)[0]
          and "_on_head in _resp_l" in SRC)
    print("PASS t5: tightened cues + noun-in-response guard wired"
          if ok else "FAIL t5: open-success wiring missing/incorrect")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_real_window_open_flags(),
               t2_kitchen_scenery_does_not_flag_concept(),
               t3_active_cue_but_unnamed_noun_rejected(),
               t4_location_change_clears(),
               t5_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- open-success-valid repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
