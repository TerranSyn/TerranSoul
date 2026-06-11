"""K76 sub-10s repro: blind-probe untried cardinals at re-visited rooms.

Scenario (universal text-IF, no Zork specifics):
- RoomA visited multiple times. Description parsed exits = {north}.
- Agent has tried `north` (progress) and `south` (neutral=wall).
- Cardinals {east, west} are NEITHER in parsed exits NOR tried.
- Planner must surface east, west as blind-probe candidates with
  score = FRONTIER_BONUS - 1 (just below true unvisited frontier).

This catches the K75 bug: from "North House", description only said
"north a narrow path winds", so `east` (Behind House) was never
shortlisted. The agent had to wait until T30 for the LLM to randomly
guess east. Generic fix: re-visited rooms get blind-probe of unparsed,
untried cardinals.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


def t1_blind_probe_helper_basic() -> bool:
    """Helper produces (cardinal, FRONTIER_BONUS-1, reason) for missing cardinals."""
    from terransoul_brain_bridge import _k76_blind_cardinal_probes

    parsed_exits = ["north"]
    tried_map = {"north": "progress", "south": "neutral"}
    cardinals = ["north", "south", "east", "west"]
    frontier_bonus = 6

    out = _k76_blind_cardinal_probes(parsed_exits, tried_map, cardinals, frontier_bonus)
    actions = {a for a, _, _ in out}
    if actions != {"east", "west"}:
        print(f"FAIL t1: expected {{east, west}}, got {actions}")
        return False
    for a, score, _reason in out:
        if score != frontier_bonus - 1:
            print(f"FAIL t1: score for {a} expected {frontier_bonus-1}, got {score}")
            return False
    print("PASS t1: blind-probe surfaces untried unparsed cardinals at FRONTIER_BONUS-1")
    return True


def t2_no_probe_when_all_cardinals_parsed_or_tried() -> bool:
    """If every cardinal is either parsed or tried, no blind probe needed."""
    from terransoul_brain_bridge import _k76_blind_cardinal_probes

    parsed_exits = ["north", "south"]
    tried_map = {"east": "neutral", "west": "loop"}
    cardinals = ["north", "south", "east", "west"]
    out = _k76_blind_cardinal_probes(parsed_exits, tried_map, cardinals, 6)
    if out:
        print(f"FAIL t2: expected no probes, got {out}")
        return False
    print("PASS t2: no blind-probe when all cardinals are parsed or tried")
    return True


def t3_skip_fatal() -> bool:
    """A cardinal previously marked fatal must NEVER be probed."""
    from terransoul_brain_bridge import _k76_blind_cardinal_probes

    out = _k76_blind_cardinal_probes(
        parsed_exits=["north"],
        tried_map={"south": "fatal"},
        cardinals=["north", "south", "east"],
        frontier_bonus=6,
    )
    actions = {a for a, _, _ in out}
    if "south" in actions:
        print("FAIL t3: fatal cardinal should be skipped")
        return False
    if "east" not in actions:
        print("FAIL t3: untried east should be probed")
        return False
    print("PASS t3: fatal cardinals excluded from blind-probe")
    return True


def t4_below_true_frontier_bonus() -> bool:
    """Blind-probe score must be strictly below FRONTIER_BONUS so true
    unvisited frontiers always outrank guesses."""
    from terransoul_brain_bridge import _k76_blind_cardinal_probes

    out = _k76_blind_cardinal_probes(
        parsed_exits=[], tried_map={}, cardinals=["east"], frontier_bonus=6,
    )
    if not out:
        print("FAIL t4: expected probe entry")
        return False
    a, score, _ = out[0]
    if score >= 6:
        print(f"FAIL t4: probe score {score} must be < frontier_bonus 6")
        return False
    print("PASS t4: blind-probe score strictly below FRONTIER_BONUS")
    return True


def t5_planner_integrates_probe() -> bool:
    """The planner code path must call _k76_blind_cardinal_probes."""
    src = Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8")
    if "_k76_blind_cardinal_probes" not in src:
        print("FAIL t5: helper function not defined")
        return False
    # Helper must be defined AND called inside the planner _score loop area.
    if src.count("_k76_blind_cardinal_probes(") < 2:
        print("FAIL t5: helper must be called from planner")
        return False
    print("PASS t5: planner integrates blind-cardinal-probe helper")
    return True


def t6_universal_cardinal_set() -> bool:
    """Cardinal set must be the universal text-IF 4-direction set
    (n/s/e/w). up/down stay handled by K67 (vertical-cardinal force)."""
    from terransoul_brain_bridge import _K76_BLIND_PROBE_CARDINALS
    expected = {"north", "south", "east", "west"}
    if set(_K76_BLIND_PROBE_CARDINALS) != expected:
        print(f"FAIL t6: expected {expected}, got {set(_K76_BLIND_PROBE_CARDINALS)}")
        return False
    print("PASS t6: cardinal set is universal text-IF (n/s/e/w)")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [
        t1_blind_probe_helper_basic(),
        t2_no_probe_when_all_cardinals_parsed_or_tried(),
        t3_skip_fatal(),
        t4_below_true_frontier_bonus(),
        t5_planner_integrates_probe(),
        t6_universal_cardinal_set(),
    ]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    n = len(results)
    print(f"\n--- K76 repro: {p}/{n} passed in {dt:.2f}s ---")
    return 0 if p == n else 1


if __name__ == "__main__":
    sys.exit(main())
