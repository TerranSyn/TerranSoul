"""Sub-second repro for the egg-reloop fix (bench iter K44): head-noun-aware
carried-item guard.

Bug (observed live in the K43 run, Up a Tree turns 21-34): the agent
re-issued `take egg` ~13 times and never climbed `down`. Root cause — the
candidate noun is the HEAD noun "egg" while the inventory stores the FULL
name "jewel-encrusted egg", so the exact-match carried guard
(`noun in inventory_lower`) missed. `take egg` then fell through to its stale
"success" outcome (scored 12, "previously rewarded"), and the K33 absolute
pin (force shortlist[0] when score>=8) re-took the already-held egg every
turn.

Fix: also match the acquisition target by HEAD noun against an
`inventory_heads` index, so `take egg` is demoted to -3 ("already carried")
once any "* egg" is held — letting the real exit (down) win.

Asserts (logic + source wiring, <10s, rule 8):
1. head-noun match: inv "jewel-encrusted egg" blocks `take egg`
2. exact match still works (backward compat: inv "leaflet" blocks `take leaflet`)
3. a NOT-carried item is not blocked (`take sword` with no sword held)
4. non-acquisition verbs are unaffected by the head index (`open egg` not -3 here)
5. source wiring present (inventory_heads + head-aware condition)
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))

ACQUIRE_PREFIXES = ("take ", "get ", "grab ", "pick up ")


def carried_block(noun: str, verb: str, inventory: list[str]) -> bool:
    """Re-implementation of the K38+K44 carried-acquisition guard under test:
    block an acquisition verb when the target is held by full name OR head."""
    inventory_lower = {x.strip().lower() for x in inventory}
    inventory_heads = {n.split()[-1] for n in inventory_lower if n.split()}
    noun_l = noun.strip().lower()
    act_l = f"{verb} {noun}".strip().lower()
    is_inventory_item = noun_l in inventory_lower
    noun_head = noun_l.split()[-1] if noun_l.split() else noun_l
    is_acq = any(act_l.startswith(p) for p in ACQUIRE_PREFIXES)
    return (is_inventory_item or noun_head in inventory_heads) and is_acq


def t1_head_noun_match() -> bool:
    if not carried_block("egg", "take", ["jewel-encrusted egg"]):
        print("FAIL t1: `take egg` must be blocked when holding 'jewel-encrusted egg'")
        return False
    if not carried_block("egg", "get", ["a large jewel-encrusted egg"]):
        print("FAIL t1: `get egg` head-noun match failed")
        return False
    print("PASS t1: head-noun match blocks `take egg` when holding 'jewel-encrusted egg'")
    return True


def t2_exact_match_backcompat() -> bool:
    if not carried_block("leaflet", "take", ["leaflet"]):
        print("FAIL t2: exact-name carried match regressed")
        return False
    print("PASS t2: exact-name carried match still works (backward compat)")
    return True


def t3_not_carried_not_blocked() -> bool:
    if carried_block("sword", "take", ["jewel-encrusted egg", "brass lantern"]):
        print("FAIL t3: `take sword` must NOT be blocked when no sword is held")
        return False
    print("PASS t3: a not-carried item is not blocked")
    return True


def t4_non_acquisition_unaffected() -> bool:
    # `open egg` / `read egg` are not acquisition verbs → the head index does
    # not force the -3 acquisition block (they go through the K39 path).
    if carried_block("egg", "open", ["jewel-encrusted egg"]):
        print("FAIL t4: non-acquisition verb wrongly hit the acquisition block")
        return False
    print("PASS t4: non-acquisition verbs are unaffected by the head index")
    return True


def t5_source_wiring() -> bool:
    ok = ("inventory_heads = {n.split()[-1] for n in inventory_lower" in SRC
          and "_noun_head = noun_l.split()[-1]" in SRC
          and "is_inventory_item or _noun_head in inventory_heads" in SRC)
    print("PASS t5: head-noun carried-guard wired into planner"
          if ok else "FAIL t5: head-noun wiring missing in bridge")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_head_noun_match(), t2_exact_match_backcompat(),
               t3_not_carried_not_blocked(), t4_non_acquisition_unaffected(),
               t5_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- carried head-noun repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
