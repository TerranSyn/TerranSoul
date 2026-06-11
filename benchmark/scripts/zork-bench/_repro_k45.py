"""K45 — visible-noun-tie allow_llm exception (extends K44).

Bench K44 result: 5 rooms incl. Up a Tree (treasure room with egg).
LLM proposed `open egg` and `examine egg` correctly — egg is in scene
objects=['branch','reach','bird','nest','jewels','songbird'] (egg
visible after climb). K44 force-replaced with arbitrary cardinal `east`
because K44 only allows cardinal-vs-cardinal.

K45: when planner top is at exactly FRONTIER_BONUS (=6), K42 has
explicitly capped ALL unstable-noun actions at 5. So top=6 means the
planner has NO informational advantage over the LLM for noun choices.
If LLM proposes verb-noun where the noun appears in any shortlist
action (planner saw it but couldn't rank), allow LLM through.

Pin still fires for: hallucinated nouns NOT visible, or stable-noun
actions above frontier.
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
    'climb', 'push', 'pull', 'move', 'turn', 'enter',
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
    orig_toks = orig_norm.split() if orig_norm else []
    orig_verb = orig_toks[0] if orig_toks else ''
    orig_nouns = orig_toks[1:] if len(orig_toks) >= 2 else []

    short_verbs = set()
    visible_nouns = set()
    for a in acts:
        toks = _norm(a).split()
        if not toks:
            continue
        short_verbs.add(toks[0])
        for tk in toks[1:]:
            visible_nouns.add(tk)
    allowed = short_verbs | _UNIVERSAL

    if orig_norm == top_norm:
        return ('passthrough', action)
    if top_score >= threshold:
        at_frontier = top_score <= threshold
        if at_frontier and orig_norm in _COMPASS and top_norm in _COMPASS:
            return ('allow_llm_cardinal_tie', action)
        if (at_frontier
            and orig_verb in allowed
            and orig_nouns
            and any(n in visible_nouns for n in orig_nouns)):
            return ('allow_llm_visible_noun', action)
        return ('replaced_frontier', top)
    if orig_verb in allowed:
        return ('allow_llm', action)
    return ('replaced', top)


# A. K45 critical case — Up a Tree with egg visible (via 'take egg', 'open egg' etc capped at 5).
shortlist = {
    'actions': ['east', 'north', 'south', 'up', 'west', 'take egg', 'open egg', 'climb egg'],
    'scores':  [6,      6,       6,       6,    6,      5,          5,          5],
}
status, act = decide('open egg', shortlist)
assert status == 'allow_llm_visible_noun' and act == 'open egg', f"A: {status}, {act}"

# B. K45 — examine egg same scenario.
status, act = decide('examine egg', shortlist)
assert status == 'allow_llm_visible_noun' and act == 'examine egg', f"B: {status}, {act}"

# C. K44 cardinal-tie still works.
status, act = decide('north', shortlist)
assert status == 'allow_llm_cardinal_tie' and act == 'north', f"C: {status}, {act}"

# D. Hallucination: noun NOT visible. Pin must fire.
status, act = decide('open mountrange', shortlist)
assert status == 'replaced_frontier' and act == 'east', f"D: {status}, {act}"

# E. Stable noun supremacy: top at 10 (above frontier) → pin even for visible noun.
shortlist_stable = {
    'actions': ['take leaflet', 'east', 'open mailbox'],
    'scores':  [10,             6,      5],
}
status, act = decide('open mailbox', shortlist_stable)
assert status == 'replaced_frontier' and act == 'take leaflet', f"E: {status}, {act}"

# F. Verb not in allowed: planner has no `frobnicate` and it's not universal. Pin.
status, act = decide('frobnicate egg', shortlist)
assert status == 'replaced_frontier', f"F: {status}, {act}"

# G. K42 acquire-prefix carrying noun (the boring case): take egg when egg is visible.
status, act = decide('take egg', shortlist)
assert status == 'allow_llm_visible_noun' and act == 'take egg', f"G: {status}, {act}"

# H. Multi-word noun: 'open small egg' where 'egg' or 'small' visible.
shortlist_h = {
    'actions': ['east', 'north', 'take egg', 'examine egg'],
    'scores':  [6,      6,       5,          5],
}
status, act = decide('open small egg', shortlist_h)
assert status == 'allow_llm_visible_noun' and act == 'open small egg', f"H: {status}, {act}"

# I. Junk noun-action: noun completely absent.
status, act = decide('open helicopter', shortlist_h)
assert status == 'replaced_frontier' and act == 'east', f"I: {status}, {act}"

print("FIX VERIFIED: K45 visible-noun-tie lets LLM apply universal verbs to visible objects when planner has no stable-noun supremacy.")
