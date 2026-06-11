"""Sub-second repro for K53: ENTER-AFTER-OPEN only for an enterable GATEWAY.

Bug (live K52, Kitchen): the agent `open`ed the brown sack, which was flagged
as "just-opened", so ENTER-AFTER-OPEN looped `enter sack`/`in` 60 turns ("You
can't be serious.") and never went `west` to the Living Room. A sack/box/bottle
is opened to look IN / take from — you do NOT enter it.

Fix: flag a just-opened noun for ENTER only when the open response carries an
ENTRY-affordance cue (the window: "...far enough to allow entry"); a container
open ("reveals a lunch, and a clove of garlic") has none. Generic text-IF entry
language, no domain noun list.

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))

_OPEN_CUES = ("with great effort", " opens", "swings open", "creaks open",
              "springs open", "reveals")
_ENTRY_CUES = ("allow entry", "to allow entry", "allow you to enter",
               "to enter", "you can enter", "you may enter",
               "can now enter", "far enough to")


def flags_enter(act: str, resp: str) -> str:
    """Mirror of the K53 ENTER-AFTER-OPEN trigger."""
    toks = act.lower().split()
    if len(toks) < 2 or toks[0] not in ("open", "unlock", "unseal", "unlatch"):
        return ""
    rl = resp.lower()
    if not (any(c in rl for c in _OPEN_CUES) and any(e in rl for e in _ENTRY_CUES)):
        return ""
    on = " ".join(toks[1:]).strip()
    for a in ("the ", "a ", "an "):
        if on.startswith(a):
            on = on[len(a):]
    head = on.split()[-1] if on.split() else on
    return on if (on and head and head in rl) else ""


def t1_window_gateway_flags() -> bool:
    out = flags_enter("open window",
                      "With great effort, you open the window far enough to allow entry.")
    if out != "window":
        print(f"FAIL t1: a gateway with an entry cue must flag, got {out!r}")
        return False
    print("PASS t1: window (open + 'allow entry') flags for ENTER")
    return True


def t2_sack_container_not_flagged() -> bool:
    out = flags_enter("open sack",
                      "Opening the brown sack reveals a lunch, and a clove of garlic.")
    if out:
        print(f"FAIL t2: a container ('reveals' contents, no entry cue) must NOT flag, got {out!r}")
        return False
    print("PASS t2: sack (reveals contents, no entry cue) does NOT flag — no enter-sack loop")
    return True


def t3_other_containers_not_flagged() -> bool:
    for act, resp in (("open bottle", "Opening the bottle reveals a quantity of water."),
                      ("open box", "The box springs open, revealing some coins.")):
        if flags_enter(act, resp):
            print(f"FAIL t3: {act!r} must not flag for enter")
            return False
    print("PASS t3: bottle/box (open but no entry affordance) do NOT flag")
    return True


def t4_source_wiring() -> bool:
    ok = ("_entry_cues = (" in SRC
          and "any(c in _resp_l for c in _open_cues) and any(ec in _resp_l for ec in _entry_cues)" in SRC)
    print("PASS t4: entry-affordance gate wired into ENTER-AFTER-OPEN"
          if ok else "FAIL t4: entry-cue wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_window_gateway_flags(), t2_sack_container_not_flagged(),
               t3_other_containers_not_flagged(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- enter-gateway (K53) repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
