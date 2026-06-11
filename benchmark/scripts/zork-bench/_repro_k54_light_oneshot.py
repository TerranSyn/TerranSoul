"""Sub-second repro for K54 — ACQUIRE-LIGHT one-shot activation.

Bug (live in K53, Behind House turns ~): once the brass lantern was carried
and lit, ACQUIRE-LIGHT re-pinned `turn on lantern`=10 fifteen-plus times and
the agent never advanced. Root cause — re-`turn on` of an already-lit lamp
returns "It is already on.", which the bench classifies as a NEUTRAL outcome.
The activation gate skipped only ("loop","fatal","consumed","success"), so a
NEUTRAL `turn on lantern` was re-offered EVERY turn at FRONTIER_BONUS+4 (=10);
the K33 absolute-pin (>=8) then force-selected it forever -> infinite loop.

Fix: turning a lamp on is a one-shot. Gate the activation on `tried_map.get(_on)
is None` (tried AT ALL), not on the success/loop tuple. After `turn on` is
attempted once, it is never re-offered; `light` is tried once as a fallback,
then ACQUIRE-LIGHT goes silent and the frontier (a real exit) wins.

Asserts (logic mirror of the activate branch + source wiring; <10s, rule 8):
1. never tried -> `turn on lantern` offered
2. `turn on lantern`=NEUTRAL -> NOT re-offered; one-shot falls back to `light`
3. both attempted -> activation silent (no infinite re-pin)
4. OLD gate (contrast) DID re-offer `turn on` on neutral -> proves the loop bug
5. source wiring: activate branch gates on `is None`; take branch keeps tuple
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def offer_activation(al: str, tried_map: dict) -> str | None:
    """Mirror of the K54 (fixed) one-shot ACQUIRE-LIGHT activation branch."""
    for on in (f"turn on {al}", f"light {al}"):
        if tried_map.get(on) is None:
            return on
    return None


def offer_activation_old(al: str, tried_map: dict) -> str | None:
    """Mirror of the PRE-K54 (buggy) gate — neutral leaks through."""
    for on in (f"turn on {al}", f"light {al}"):
        if tried_map.get(on) not in ("loop", "fatal", "consumed", "success"):
            return on
    return None


def t1_never_tried_offers_turn_on() -> bool:
    out = offer_activation("lantern", {})
    if out != "turn on lantern":
        print(f"FAIL t1: fresh lantern should offer 'turn on lantern', got {out!r}")
        return False
    print("PASS t1: never-tried light source offers `turn on lantern`")
    return True


def t2_neutral_not_reoffered() -> bool:
    # The lamp is lit; re-`turn on` returned "It is already on." -> NEUTRAL.
    out = offer_activation("lantern", {"turn on lantern": "neutral"})
    if out == "turn on lantern":
        print("FAIL t2: a NEUTRAL `turn on lantern` was re-offered (loop!)")
        return False
    if out != "light lantern":
        print(f"FAIL t2: one-shot should fall back to `light lantern`, got {out!r}")
        return False
    print("PASS t2: NEUTRAL `turn on` is one-shot -> falls back to `light` (no re-pin)")
    return True


def t3_both_attempted_goes_silent() -> bool:
    out = offer_activation("lantern",
                           {"turn on lantern": "neutral", "light lantern": "neutral"})
    if out is not None:
        print(f"FAIL t3: after both attempts ACQUIRE-LIGHT must be silent, got {out!r}")
        return False
    print("PASS t3: both activations attempted -> silent (frontier exit wins)")
    return True


def t4_old_gate_proves_the_bug() -> bool:
    # Contrast: the PRE-K54 gate re-offered `turn on lantern` on a NEUTRAL
    # outcome — exactly the infinite re-pin observed at Behind House (K53).
    out = offer_activation_old("lantern", {"turn on lantern": "neutral"})
    if out != "turn on lantern":
        print(f"FAIL t4: old gate should reproduce the loop (got {out!r}); "
              "the repro no longer demonstrates the bug")
        return False
    print("PASS t4: old gate re-offered `turn on` on neutral -> confirms the K53 loop")
    return True


def t5_source_wiring() -> bool:
    # The activate branch must gate on `is None` (one-shot); the take branch
    # keeps the broader success/loop tuple gate (don't re-take a held lamp).
    activate_ok = "if tried_map.get(_on) is None:" in SRC
    take_ok = ('if tried_map.get(f"take {_al}") not in '
               '("loop", "fatal", "consumed", "success"):' in SRC)
    # The old buggy activate gate must be gone from the `_on` loop.
    bad = 'if tried_map.get(_on) not in ("loop", "fatal", "consumed", "success"):'
    ok = activate_ok and take_ok and bad not in SRC
    if not ok:
        print(f"FAIL t5: wiring — activate_is_none={activate_ok} "
              f"take_tuple={take_ok} old_gate_gone={bad not in SRC}")
        return False
    print("PASS t5: activate branch one-shot (`is None`); take branch keeps tuple gate")
    return True


def t6_physical_light_detection() -> bool:
    sys.path.insert(0, str(Path(__file__).parent))
    from terransoul_brain_bridge import _is_physical_light
    # head-noun match on a multi-word object
    if not _is_physical_light("brass lantern"):
        print("FAIL t6: 'brass lantern' should be a physical light"); return False
    if not _is_physical_light("lamp"):
        print("FAIL t6: 'lamp' should be a physical light"); return False
    # bare scenery 'light' / compounds must NOT match (you can't `open sunlight`)
    if _is_physical_light("sunlight") or _is_physical_light("light"):
        print("FAIL t6: scenery 'light'/'sunlight' must NOT be a physical light"); return False
    print("PASS t6: physical light = lamp/lantern/torch/... (not bare 'light')")
    return True


def t7_open_light_suppressed() -> bool:
    # The K54b gate hard-demotes open/search/look-in on a light source so the
    # `open lantern` x46 loop can never out-score a real exit frontier.
    gate = ("if _is_physical_light(noun_l) and any(" in SRC
            and "act_l.startswith(p) for p in _LIGHT_NONSENSE_PREFIXES" in SRC
            and '"open ", "close ", "shut ", "search ", "look in "' in SRC)
    if not gate:
        print("FAIL t7: K54b open-light suppression gate not wired"); return False
    print("PASS t7: open/search/look-in on a light source hard-demoted (no `open lantern` loop)")
    return True


def t8_manipulation_verbs_suppressed_on_light() -> bool:
    # K55 — after the open/turn-on loops were closed (K54) the 4B fixated on
    # `move brass lantern` x22; manipulation verbs (move/push/pull) are equally
    # nonsense on a lamp, but `move rug` (the productive Living-Room move) and
    # `turn on lantern` (activation) must survive.
    sys.path.insert(0, str(Path(__file__).parent))
    from terransoul_brain_bridge import _is_physical_light, _LIGHT_NONSENSE_PREFIXES

    def suppressed(act: str, noun: str) -> bool:
        al = act.lower()
        return _is_physical_light(noun) and any(al.startswith(p) for p in _LIGHT_NONSENSE_PREFIXES)

    if not suppressed("move brass lantern", "brass lantern"):
        print("FAIL t8: `move brass lantern` must be suppressed (the K54→K55 loop)"); return False
    if not (suppressed("push lantern", "lantern") and suppressed("pull lamp", "lamp")):
        print("FAIL t8: push/pull on a light source must be suppressed"); return False
    if suppressed("move rug", "rug"):
        print("FAIL t8: `move rug` (non-light, reveals the trap door) must NOT be suppressed"); return False
    if suppressed("turn on lantern", "lantern"):
        print("FAIL t8: `turn on lantern` (activation) must NOT be suppressed"); return False
    print("PASS t8: move/push/pull suppressed on a lamp; `move rug` + `turn on lantern` survive")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [t1_never_tried_offers_turn_on(),
               t2_neutral_not_reoffered(),
               t3_both_attempted_goes_silent(),
               t4_old_gate_proves_the_bug(),
               t5_source_wiring(),
               t6_physical_light_detection(),
               t7_open_light_suppressed(),
               t8_manipulation_verbs_suppressed_on_light()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- K54 light-oneshot repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
