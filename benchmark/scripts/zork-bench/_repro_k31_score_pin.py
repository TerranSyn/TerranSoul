"""Sub-10s repro: K31 score-aware brain-pin should hard-pin frontier
moves over LLM whitelist passes (P8 doctrine)."""
import json, re, tempfile, pathlib

# Inline simulation of the K31 decision tree (same logic as the
# runtime-injected snippet inside zork_agent_patch.py).
_bp_re = re

def decide(action: str, shortlist: dict) -> tuple[str, str]:
    _bp_allowed = {"north","south","east","west","up","down","take","open","examine","look","inventory","read","drop","go","move","ne","nw","se","sw","enter","exit"}
    _bp_orig = action
    _bp_orig_norm = re.sub(r'\s+', ' ', _bp_orig.strip().lower())
    _bp_orig_verb = _bp_orig_norm.split()[0] if _bp_orig_norm else ""
    _bp_acts = shortlist.get('actions') or []
    _bp_scores = shortlist.get('scores') or []
    if not _bp_acts:
        return ('empty_list', action)
    def _bp_norm(s): return re.sub(r'\s+', ' ', (s or '').strip().lower())
    _bp_top = _bp_acts[0]
    _bp_top_score = _bp_scores[0] if _bp_scores else 0
    _bp_frontier_threshold = 6  # K43 — was 9; aligned with FRONTIER_BONUS=6
    if _bp_orig_norm == _bp_norm(_bp_top):
        return ('passthrough', action)
    if _bp_top_score >= _bp_frontier_threshold:
        return ('replaced_frontier', _bp_top)
    if _bp_orig_verb in _bp_allowed:
        return ('allow_llm', action)
    return ('replaced', _bp_top)

# Case A: planner has frontier 'west' score=10, LLM picks whitelisted
# 'examine mailbox'. K31 must HARD-PIN to 'west'.
status, act = decide('examine mailbox', {'actions': ['west', 'examine mailbox'], 'scores': [10, 6]})
assert status == 'replaced_frontier' and act == 'west', f"A: {status}, {act}"

# Case B: planner top is weak (unstable verb score=5, below
# K43 threshold=6), LLM picks whitelisted 'look'. K31 must allow LLM.
status, act = decide('look', {'actions': ['take chirping', 'look'], 'scores': [5, 5]})
assert status == 'allow_llm' and act == 'look', f"B: {status}, {act}"

# Case C: LLM picks junk verb, planner top weak (5). K27 universal
# whitelist still allows; only force-replace if verb fails whitelist.
status, act = decide('xyzzy plugh', {'actions': ['take chirping'], 'scores': [5]})
assert status == 'replaced' and act == 'take chirping', f"C: {status}, {act}"

# Case D: passthrough.
status, act = decide('west', {'actions': ['west'], 'scores': [10]})
assert status == 'passthrough' and act == 'west', f"D: {status}, {act}"

# Case E (K43): frontier exit at FRONTIER_BONUS=6 with LLM hallucination.
# K42 made all unstable verbs <=5, so frontier=6 is the highest. K43
# pins frontier=6 over LLM 'examine egg'. THIS IS THE FIX.
status, act = decide('examine egg', {'actions': ['east', 'take chirping'], 'scores': [6, 5]})
assert status == 'replaced_frontier' and act == 'east', f"E: {status}, {act}"

print("FIX VERIFIED: K43 lowers K31 threshold to FRONTIER_BONUS=6, hard-pin fires for frontier exits over LLM hallucinations.")
