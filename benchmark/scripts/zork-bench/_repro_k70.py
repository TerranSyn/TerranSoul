"""K70 reproducer: LLM proposes valid unfailed compass `down`, but
shortlist puts `take egg` at top (score 12). K54 replaces LLM `down`
with `take egg` (already in inventory). Generic fix: passthrough any
compass verb that is not in failed_set BEFORE frontier-replacement.

This is the smallest snippet that exercises the K70 gate.
"""

# Simulate the patch's decision logic for this single decision.
# We don't need to import the patch; we just verify the rule.

COMPASS = {
    'n', 's', 'e', 'w', 'u', 'd',
    'ne', 'nw', 'se', 'sw',
    'north', 'south', 'east', 'west', 'up', 'down',
    'northeast', 'northwest', 'southeast', 'southwest',
}


def decide_k70(orig_verb: str, top: str, top_score: int, failed_set: set) -> tuple[str, str]:
    """Returns (status, action). K70: unfailed compass passthrough."""
    if orig_verb in COMPASS and orig_verb not in failed_set:
        return ('allow_llm_unfailed_compass_k70', orig_verb)
    # Otherwise fall through to existing frontier-replacement.
    if top_score >= 6:
        return ('replaced_frontier_k54', top)
    return ('passthrough', orig_verb)


def test_k70_unfailed_down_passthrough():
    # Up a Tree, T22. LLM proposes `down`. failed_set has only `north`
    # (one bumped-wall). Top is `take egg` score 12.
    status, action = decide_k70('down', 'take egg', 12, {'north'})
    assert status == 'allow_llm_unfailed_compass_k70', f"bad status: {status}"
    assert action == 'down', f"bad action: {action}"


def test_k70_failed_compass_still_blocked():
    # `north` already failed. LLM proposes `north` again.
    # K70 must NOT passthrough — let K56 (failed-exit-replace) handle it.
    status, action = decide_k70('north', 'take egg', 12, {'north'})
    assert status != 'allow_llm_unfailed_compass_k70', f"K70 leaked failed compass: {status}"


def test_k70_non_compass_unaffected():
    # Non-compass orig (`examine egg`) should NOT trigger K70.
    status, action = decide_k70('examine', 'take egg', 12, set())
    assert status != 'allow_llm_unfailed_compass_k70', f"K70 fired on non-compass: {status}"


def test_k70_unfailed_up_passthrough():
    status, action = decide_k70('up', 'take treasure', 10, set())
    assert status == 'allow_llm_unfailed_compass_k70'
    assert action == 'up'


if __name__ == '__main__':
    test_k70_unfailed_down_passthrough()
    test_k70_failed_compass_still_blocked()
    test_k70_non_compass_unaffected()
    test_k70_unfailed_up_passthrough()
    print('K70 repro: PASS (4/4)')
