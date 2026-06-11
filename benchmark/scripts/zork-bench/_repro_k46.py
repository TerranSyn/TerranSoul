"""K46 — chain-of-thought contamination guard.

K45 bench result: 6 rooms incl. NEW Canyon View. Score still 0/350.
Trace turn 18-19 reveals new bug:

  status=allow_llm_visible_noun orig='i am currently in canyon view.
  the description provides several potential paths: west, south,
  northwest (the path), and climbing down. ... move south' top='down'
  Turn 19: 'i am currently in canyon view... move south' Score: 0

LLM emitted chain-of-thought + action as a single ~80-token blob.
K45's visible-noun check found 'canyon'/'south'/'west' in the COT
bag-of-words and marked allow_llm_visible_noun. The full blob was
sent to Zork verbatim. Zork's parser failed silently. Wasted turn.

K46: real text-adventure actions are <=6 tokens (e.g., 'take small
egg from nest' = 5 tokens) and never contain newlines or quote
marks. Detect COT contamination structurally and force-replace
with planner top. Universal — no domain content. Placed BEFORE
passthrough check so even a passthrough match by accident gets
filtered if it's a COT blob.
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

    # K46 — COT contamination guard
    raw = action or ''
    is_cot = (
        len(orig_toks) > 6
        or '\n' in raw
        or '"' in raw
        or "'" in raw
    )
    if is_cot:
        return ('replaced_cot', top)

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


# A. Critical case: K45 trace turn 19 verbatim — COT blob.
cot_blob = (
    'i am currently in canyon view. the description provides '
    'several potential paths: west, south, northwest (the path), '
    'and climbing down. move south'
)
shortlist_cot = {
    'actions': ['down', 'east', 'north', 'northwest', 'south', 'up', 'west',
                'take canyon', 'open canyon'],
    'scores':  [6, 6, 6, 6, 6, 6, 6, 5, 5],
}
status, act = decide(cot_blob, shortlist_cot)
assert status == 'replaced_cot' and act == 'down', f"A: {status}, {act}"

# B. Newline contamination.
status, act = decide('move\nsouth', shortlist_cot)
assert status == 'replaced_cot' and act == 'down', f"B: {status}, {act}"

# C. Quote contamination.
status, act = decide('move "south"', shortlist_cot)
assert status == 'replaced_cot' and act == 'down', f"C: {status}, {act}"

# D. Apostrophe contamination (LLM uses possessives in reasoning).
status, act = decide("i'll go south now", shortlist_cot)
assert status == 'replaced_cot' and act == 'down', f"D: {status}, {act}"

# E. Real short action — must pass K46 and reach K44 cardinal-tie.
status, act = decide('south', shortlist_cot)
assert status == 'allow_llm_cardinal_tie' and act == 'south', f"E: {status}, {act}"

# F. K45 visible-noun must still work for short noun-action.
shortlist_egg = {
    'actions': ['east', 'north', 'south', 'up', 'west', 'take egg', 'open egg'],
    'scores':  [6, 6, 6, 6, 6, 5, 5],
}
status, act = decide('open egg', shortlist_egg)
assert status == 'allow_llm_visible_noun' and act == 'open egg', f"F: {status}, {act}"

# G. Boundary — exactly 6 tokens passes (real Zork-style multi-word actions).
status, act = decide('take small egg from the nest', shortlist_egg)
assert status != 'replaced_cot', f"G should not be COT: {status}, {act}"

# H. 7 tokens triggers COT guard.
status, act = decide('take the small green egg from the nest', shortlist_egg)
assert status == 'replaced_cot', f"H: {status}, {act}"

# I. Passthrough for top match must still work for short actions.
shortlist_pt = {'actions': ['east'], 'scores': [6]}
status, act = decide('east', shortlist_pt)
assert status == 'passthrough' and act == 'east', f"I: {status}, {act}"

# J. COT blob that would have been a passthrough match still gets filtered.
status, act = decide('east, but actually let me think about this for a moment', shortlist_pt)
assert status == 'replaced_cot' and act == 'east', f"J: {status}, {act}"

print("FIX VERIFIED: K46 COT contamination guard rejects multi-token reasoning blobs and preserves all short-action paths through K27/K44/K45.")
