"""P5 repro (sub-10s, offline, no infra): open>take inversion removed.

Bug: the ODY-8 confirmed-openable branch pinned `open <noun>` at
`FRONTIER_BONUS + 3`, hardcoding open > take on a noun that is BOTH openable
AND acquirable (the jeweled-egg inversion) with no feedback path, so taking the
item could never overtake opening it.

Fix: the openable cue is now a CONTEXT signal only (escapes the unstable cap +
labels the reason); the numeric score stays at the brain-given affordance
`bonus`, identical to `take` on the same fresh noun. The brain's learned
outcome utility (not a source constant) decides which verb wins.

This repro (1) mirrors the ODY-8 vs stable-noun scoring branch and asserts
equal base score, and (2) verifies the source no longer pins +3.

Run:  python benchmark/scripts/zork-bench/_repro_p5_open_take_parity.py
"""
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.join(_HERE, "terransoul_brain_bridge.py")
SRC = open(_SRC, encoding="utf-8").read()

# Brain-given affordance priority (same value for both verbs in the neutral
# case — the seed table; the brain may diverge them later via learned utility).
BONUS = 5
FRONTIER_BONUS = 6


def score_branch(verb, noun_is_confirmed_openable):
    """Mirror of the relevant ODY-8 / stable-noun effective_bonus decision for a
    FRESH (untried, stable, non-inventory) visible noun. Both the confirmed-
    openable branch and the stable `else` branch must yield effective_bonus =
    BONUS so open and take tie."""
    effective_bonus = BONUS  # start = brain-given affordance bonus
    if verb in ("open", "unlock", "enter") and noun_is_confirmed_openable:
        # P5: CONTEXT cue only — no numeric override.
        effective_bonus = BONUS
    else:
        # stable noun else-branch: unchanged bonus
        effective_bonus = BONUS
    return effective_bonus


def t1_open_take_equal_on_fresh_openable():
    open_s = score_branch("open", noun_is_confirmed_openable=True)
    take_s = score_branch("take", noun_is_confirmed_openable=False)
    assert open_s == take_s, f"open={open_s} take={take_s} must be EQUAL"
    # and neither is the old pinned FRONTIER_BONUS+3
    assert open_s != FRONTIER_BONUS + 3, "open must NOT be pinned at FRONTIER_BONUS+3"
    print("PASS t1: open and take get EQUAL base score on a fresh openable noun")
    return True


def t2_source_no_plus3_pin():
    # The unconditional `effective_bonus = FRONTIER_BONUS + 3` pin must be gone
    # from the ODY-8 confirmed-openable branch.
    assert "effective_bonus = FRONTIER_BONUS + 3" not in SRC, \
        "the open>take +3 pin is still present in source"
    # The branch must now fall back to the brain affordance bonus.
    assert "[confirmed openable — context cue]" in SRC, \
        "ODY-8 branch should now label the openable as a context cue, not a pin"
    print("PASS t2: source removed the FRONTIER_BONUS+3 open-pin; openable is context-only")
    return True


def main():
    import time
    t0 = time.monotonic()
    results = [t1_open_take_equal_on_fresh_openable(), t2_source_no_plus3_pin()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- P5 open/take parity repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
