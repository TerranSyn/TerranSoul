"""K44 — cardinal-tie allow_llm exception inside K31 hard-pin.

Hypothesis: K43 over-pinned by force-replacing every cardinal LLM choice
with planner top whenever top_score>=6. Trace showed agent stuck 28/30
turns in Forest because LLM `north` got force-replaced with `east`
on every turn. K44 adds: when both top AND orig are cardinals and
top_score==FRONTIER_BONUS (no stable-noun action), allow LLM through.
Pin still fires for: noun-actions OR cardinals when top has stable noun.
"""
import re

_FRONTIER = 6
_COMPASS = {
    'n', 's', 'e', 'w', 'u', 'd',
    'ne', 'nw', 'se', 'sw',
    'north', 'south', 'east', 'west', 'up', 'down',
    'northeast', 'northwest', 'southeast', 'southwest',
}
_UNIVERSAL = _COMPASS | {
    'look', 'l', 'inventory', 'inv', 'i', 'wait', 'z',
    'examine', 'x', 'take', 'open', 'read', 'drop', 'go',
}


def decide(action, shortlist):
    threshold = _FRONTIER
    acts = shortlist.get('actions') or []
    scores = shortlist.get('scores') or []

    def _norm(s):
        return re.sub(r'\s+', ' ', (s or '').strip().lower())

    if not acts:
        return ('empty_list', action)
    top = acts[0]
    top_score = scores[0] if scores else 0
    orig_norm = _norm(action)
    top_norm = _norm(top)
    orig_verb = orig_norm.split()[0] if orig_norm else ''

    if orig_norm == top_norm:
        return ('passthrough', action)
    if top_score >= threshold:
        # K44 cardinal-tie exception
        if (
            top_score <= threshold
            and orig_norm in _COMPASS
            and top_norm in _COMPASS
        ):
            return ('allow_llm_cardinal_tie', action)
        return ('replaced_frontier', top)
    if orig_verb in _UNIVERSAL:
        return ('allow_llm', action)
    return ('replaced', top)


# A. K43 regression scenario: planner top=east(6), LLM=north(cardinal).
# K43 force-replaced. K44 must allow LLM through.
status, act = decide('north', {'actions': ['east', 'south', 'west'], 'scores': [6, 6, 6]})
assert status == 'allow_llm_cardinal_tie' and act == 'north', f"A: {status}, {act}"

# B. LLM hallucination: planner top=east(6), LLM='examine egg' (noun).
# K44 must still pin to east (noun is not cardinal).
status, act = decide('examine egg', {'actions': ['east'], 'scores': [6]})
assert status == 'replaced_frontier' and act == 'east', f"B: {status}, {act}"

# C. Stable-noun action: planner top='take leaflet'(10), LLM='north'.
# K44 must pin to take leaflet (top above frontier-tier).
status, act = decide('north', {'actions': ['take leaflet', 'east'], 'scores': [10, 6]})
assert status == 'replaced_frontier' and act == 'take leaflet', f"C: {status}, {act}"

# D. Noun-top vs cardinal-orig at frontier: planner top='take chirping'(5),
# below threshold, LLM='north'. Falls through to allow_llm.
status, act = decide('north', {'actions': ['take chirping'], 'scores': [5]})
assert status == 'allow_llm' and act == 'north', f"D: {status}, {act}"

# E. Passthrough.
status, act = decide('east', {'actions': ['east'], 'scores': [6]})
assert status == 'passthrough' and act == 'east', f"E: {status}, {act}"

# F. K43 fix preserved: LLM='examine mountarange' (junk), top='east'(6).
# K44 must pin (orig not cardinal).
status, act = decide('examine mountarange', {'actions': ['east', 'south', 'west'], 'scores': [6, 6, 6]})
assert status == 'replaced_frontier' and act == 'east', f"F: {status}, {act}"

# G. K44 cardinal-tie, multi-cardinal frontier: LLM 'up' when top 'east'.
status, act = decide('up', {'actions': ['east', 'south', 'west'], 'scores': [6, 6, 6]})
assert status == 'allow_llm_cardinal_tie' and act == 'up', f"G: {status}, {act}"

# H. Stable noun + cardinal LLM: stable beats cardinal.
status, act = decide('east', {'actions': ['open mailbox', 'east'], 'scores': [9, 6]})
assert status == 'replaced_frontier' and act == 'open mailbox', f"H: {status}, {act}"

print("FIX VERIFIED: K44 cardinal-tie exception lets LLM steer cardinals when planner has no stable-noun information advantage.")
