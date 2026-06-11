"""Sub-second repro for ZK-DELIVER — deposit treasures, not junk.

From the zorkgpt.com ep120 (115/350) audit: ep120's biggest gains were banking
TREASURES (+27 for coffin+sceptre+torch). Value realizes only on delivery to the
sink, and only treasures are worth delivering. In K53 our 4B reached the Living
Room with the +5 egg but DELIVER ranked every carried item equally, so the LLM
banked worthless "leaves" instead of the egg — the +5 deposit never happened.

Fix: a treasure announces itself — in Zork (and IF generally) picking up a
treasure SCORES (egg +5, torch +14), junk scores 0. Capture that per-episode
(`_valued_items`, populated when an acquisition has score_delta>0); DELIVER then
banks a scored-on-pickup item at FRONTIER_BONUS+2 and demotes never-scored items
to FRONTIER_BONUS-2 (below the exploration frontier). If NOTHING has scored yet,
keep the old equal ranking so a legitimate first deposit is never suppressed.
Learned from the score signal — no hardcoded treasure list (AGI-pure).

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))

_ACQUIRE_VERBS = ("take", "get", "grab", "pick")


def mark_valued(valued: set, act: str, score_delta: int, inventory_changed: bool) -> None:
    """Mirror of the ZK-DELIVER Part-A capture in record_action_outcome."""
    if inventory_changed and score_delta > 0:
        toks = act.lower().split()
        if len(toks) >= 2 and toks[0] in _ACQUIRE_VERBS:
            valued.add(toks[-1])


def deliver_bonus(dep_head: str, valued: set, any_valued: bool) -> int:
    """Mirror of the ZK-DELIVER Part-B deposit ranking (offset vs FRONTIER_BONUS)."""
    is_valued = dep_head.lower() in valued
    if any_valued and not is_valued:
        return -2            # never scored on pickup -> below the frontier
    return +2                # treasure, or nothing-scored-yet equal ranking


def t1_scored_pickup_marks_valued() -> bool:
    valued: set = set()
    mark_valued(valued, "take egg", score_delta=5, inventory_changed=True)
    mark_valued(valued, "take pile", score_delta=0, inventory_changed=True)   # leaves: no score
    if "egg" not in valued:
        print(f"FAIL t1: a +5 `take egg` should mark 'egg' valued, got {valued}"); return False
    if "pile" in valued or "leaves" in valued:
        print(f"FAIL t1: a 0-score pickup must NOT be valued, got {valued}"); return False
    print("PASS t1: an acquisition that SCORED is marked a treasure; a 0-score one is not")
    return True


def t2_treasure_outranks_junk() -> bool:
    valued = {"egg"}
    any_valued = True   # egg is carried + valued
    if not deliver_bonus("egg", valued, any_valued) > deliver_bonus("leaves", valued, any_valued):
        print("FAIL t2: the treasure must outrank junk in DELIVER"); return False
    if deliver_bonus("leaves", valued, any_valued) >= 0:
        print("FAIL t2: never-scored junk must drop BELOW the frontier (negative offset)"); return False
    print(f"PASS t2: egg(+{deliver_bonus('egg',valued,any_valued)}) outranks "
          f"leaves({deliver_bonus('leaves',valued,any_valued)}) — no more banking junk")
    return True


def t3_no_valued_keeps_old_equal_ranking() -> bool:
    # Nothing has scored yet (e.g. first deposit before any treasure pickup):
    # DON'T suppress — both items keep the old +2 so a legit deposit can fire.
    valued: set = set()
    any_valued = False
    if deliver_bonus("egg", valued, any_valued) != 2 or deliver_bonus("leaves", valued, any_valued) != 2:
        print("FAIL t3: with nothing valued, ranking must stay equal (+2), not suppress"); return False
    print("PASS t3: nothing scored yet -> old equal ranking preserved (no false suppression)")
    return True


def t4_source_wiring() -> bool:
    part_a = ("if inventory_changed and score_delta > 0:" in SRC
              and "self._valued_items.add(_vt.split()[-1].lower())" in SRC)
    part_b = ("_any_valued = any(" in SRC
              and "_is_valued = _dep_head.lower() in _valued" in SRC
              and "if _any_valued and not _is_valued:" in SRC
              and "FRONTIER_BONUS - 2" in SRC)
    if not (part_a and part_b):
        print(f"FAIL t4: wiring — capture={part_a} ranking={part_b}"); return False
    print("PASS t4: valued-on-pickup capture + treasure-preferring DELIVER ranking wired")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [t1_scored_pickup_marks_valued(),
               t2_treasure_outranks_junk(),
               t3_no_valued_keeps_old_equal_ranking(),
               t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- ZK-DELIVER treasure repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
