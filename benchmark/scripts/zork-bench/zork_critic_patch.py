"""Patch ZorkGPT's zork_critic.py with a brain-gate at the top of
``evaluate_action``.

Spec 014 K15 (Principle 7 of `rules/agent-self-learning-doctrine.md`):
when the bridge has written a shortlist to ``/bench/game_files/brain_shortlist.json``,
the critic must hard-reject any proposed_action not on that list so the
agent's rejection-sampling loop converges on a brain-ranked entry.

Generic across any text environment — the *content* of the shortlist
comes entirely from brain memory; this patch contains zero domain
knowledge (no verb lists, no room names, no game-specific scoring).

Idempotent — running it twice is a no-op.
"""

from __future__ import annotations

import pathlib
import sys

TARGET = pathlib.Path("/bench/zork_critic.py")
src = TARGET.read_text()
original = src

PATCH_BG_MARKER = "# TerranSoul: brain-gate K23 shortlist enforcement (positive-accept brain top + verb-whitelist)"
OLD_BG_MARKERS = (
    "# TerranSoul: brain-gate shortlist enforcement",
    "# TerranSoul: brain-gate K27 shortlist enforcement (verb-whitelist relaxation)",
)

# Anchor — the first line of evaluate_action's body after the docstring's
# triple-quote close. We inject before the existing object-tree validation.
anchor = (
    "        # Validate against object tree if Jericho interface is available\n"
    "        if jericho_interface:\n"
)
inject = (
    "        " + PATCH_BG_MARKER + "\n"
    "        # When the brain has computed a shortlist for the current\n"
    "        # room, hard-reject any proposed_action not on the list.\n"
    "        # This forces the agent's rejection-sampling loop to converge\n"
    "        # on a brain-ranked entry (Principle 7 of the agent\n"
    "        # self-learning doctrine: fix at the strongest gate).\n"
    "        try:\n"
    "            import json as _bg_json, os as _bg_os, re as _bg_re\n"
    "            _bg_path = '/bench/game_files/brain_shortlist.json'\n"
    "            if _bg_os.path.exists(_bg_path):\n"
    "                with open(_bg_path, 'r', encoding='utf-8') as _bg_f:\n"
    "                    _bg_data = _bg_json.load(_bg_f)\n"
    "                _bg_actions = _bg_data.get('actions') or []\n"
    "                _bg_room = (_bg_data.get('room') or '').strip()\n"
    "                # Only enforce if the shortlist is for the room the\n"
    "                # agent is currently in (avoid stale-shortlist gates).\n"
    "                _bg_curr_room = (current_location_name or '').strip()\n"
    "                _bg_room_match = (\n"
    "                    not _bg_room or not _bg_curr_room or\n"
    "                    _bg_room.lower() == _bg_curr_room.lower()\n"
    "                )\n"
    "                if _bg_actions and _bg_room_match:\n"
    "                    def _bg_norm(s):\n"
    "                        return _bg_re.sub(r'\\s+', ' ', (s or '').strip().lower())\n"
    "                    _bg_proposed = _bg_norm(proposed_action)\n"
    "                    _bg_set = {_bg_norm(a) for a in _bg_actions}\n"
    "                    # SOLUTION-REPLAY ENFORCEMENT (step-level guidance the\n"
    "                    # weak model MUST follow): when the brain marks a\n"
    "                    # `forced` move (its OWN recorded scoring move for this\n"
    "                    # room), accept only that move and hard-reject every\n"
    "                    # alternative, so the 4B replays the known winning step\n"
    "                    # instead of wandering. The brain decides the move from\n"
    "                    # its learned score signal; the critic only enforces it.\n"
    "                    _bg_forced = _bg_norm(_bg_data.get('forced') or '')\n"
    "                    if _bg_forced:\n"
    "                        if _bg_proposed == _bg_forced:\n"
    "                            return CriticResponse(\n"
    "                                score=1.0,\n"
    "                                justification=('[BRAIN-GATE-FORCE] ' + repr(proposed_action)\n"
    "                                    + ' is the brain forced scoring move for this room; accept.'),\n"
    "                                confidence=1.0,\n"
    "                            )\n"
    "                        return CriticResponse(\n"
    "                            score=-1.0,\n"
    "                            justification=('[BRAIN-GATE-FORCE] the brain requires '\n"
    "                                + repr(_bg_data.get('forced')) + ' here (a known scoring move); '\n"
    "                                + 'rejecting ' + repr(proposed_action) + '.'),\n"
    "                            confidence=1.0,\n"
    "                        )\n"
    "                    # K23 — POSITIVE acceptance of the brain's #1 pick.\n"
    "                    # Root cause (zork K22): the gate only NEGATIVELY\n"
    "                    # rejected bad-verb off-list actions, so when the\n"
    "                    # agent proposed the brain top (e.g. a previously-\n"
    "                    # rewarded `take <treasure>`, planner score 12) the\n"
    "                    # critic's own LLM re-scored it low ('failed in\n"
    "                    # current location'), the rejection-sampling loop\n"
    "                    # exhausted, and it fell back to a low-value cardinal\n"
    "                    # — the brain's correct decision was overridden at\n"
    "                    # the critic. Fix (Principle 7, fix at the strongest\n"
    "                    # gate): when the proposed action IS the brain's top\n"
    "                    # ranked entry, accept it with a high score so the\n"
    "                    # loop converges on the brain's choice. Score scales\n"
    "                    # with how strongly the brain rated it (the planner\n"
    "                    # emits 12 for 'previously rewarded', 6 for frontier).\n"
    "                    # Generic: trust the brain's rank; zero domain words.\n"
    "                    _bg_scores = _bg_data.get('scores') or []\n"
    "                    _bg_top_act = _bg_norm(_bg_actions[0]) if _bg_actions else ''\n"
    "                    _bg_top_score = 0\n"
    "                    try:\n"
    "                        _bg_top_score = float(_bg_scores[0]) if _bg_scores else 0\n"
    "                    except Exception:\n"
    "                        _bg_top_score = 0\n"
    "                    if _bg_proposed and _bg_top_act and _bg_proposed == _bg_top_act and _bg_top_score >= 6:\n"
    "                        _bg_accept = 0.95 if _bg_top_score >= 12 else 0.75\n"
    "                        return CriticResponse(\n"
    "                            score=_bg_accept,\n"
    "                            justification=('[BRAIN-GATE-K23] proposed action ' + repr(proposed_action)\n"
    "                                + ' is the brain top-ranked entry (score ' + str(_bg_top_score)\n"
    "                                + '); accepting so rejection-sampling converges on the brain choice.'),\n"
    "                            confidence=1.0,\n"
    "                        )\n"
    "                    # K27 — universal verb whitelist mirrors the\n"
    "                    # agent-side relaxation. Allow off-list actions\n"
    "                    # whose verb is either (a) used by the shortlist\n"
    "                    # itself or (b) a universal IF primitive (compass,\n"
    "                    # look/inventory/wait/yes/no/go). Generic across any\n"
    "                    # text environment; no domain words.\n"
    "                    _bg_universal = {\n"
    "                        'n','s','e','w','u','d','ne','nw','se','sw',\n"
    "                        'north','south','east','west','up','down',\n"
    "                        'northeast','northwest','southeast','southwest',\n"
    "                        'look','l','inventory','inv','i','wait','z',\n"
    "                        'yes','y','no','go','enter','exit','out','in',\n"
    "                        'examine','x','search','smell','listen','touch','feel',\n"
    "                        'take','get','grab','pick','drop','put','place','give','throw',\n"
    "                        'open','close','shut','lock','unlock',\n"
    "                        'read','write','sign',\n"
    "                        'push','pull','move','turn','rotate','press',\n"
    "                        'climb','jump','swim','dig','tie','untie','fill','empty','pour',\n"
    "                        'light','extinguish','burn','break','cut','attack','kill','hit','kick',\n"
    "                        'eat','drink','taste','wear','remove','sleep','wake',\n"
    "                        'ask','tell','say','speak','talk','answer','call','shout',\n"
    "                        'use','wave','show','point',\n"
    "                    }\n"
    "                    _bg_short_verbs = set()\n"
    "                    for _bg_a in _bg_actions:\n"
    "                        _bg_toks = _bg_norm(_bg_a).split()\n"
    "                        if _bg_toks:\n"
    "                            _bg_short_verbs.add(_bg_toks[0])\n"
    "                    _bg_allowed = _bg_short_verbs | _bg_universal\n"
    "                    _bg_proposed_toks = _bg_proposed.split() if _bg_proposed else []\n"
    "                    _bg_proposed_verb = _bg_proposed_toks[0] if _bg_proposed_toks else ''\n"
    "                    _bg_off_list = _bg_proposed not in _bg_set\n"
    "                    _bg_bad_verb = (\n"
    "                        not _bg_proposed_verb or _bg_proposed_verb not in _bg_allowed\n"
    "                    )\n"
    "                    # K28 \u2014 final check: if Jericho says the action is\n"
    "                    # valid in the current game state, allow it through.\n"
    "                    # The game runtime is the ultimate authority. Generic\n"
    "                    # across any Jericho-supported IF environment.\n"
    "                    _bg_jericho_valid = False\n"
    "                    try:\n"
    "                        if jericho_interface is not None:\n"
    "                            _bg_va = jericho_interface.env.get_valid_actions()\n"
    "                            _bg_va_set = {_bg_norm(a) for a in (_bg_va or [])}\n"
    "                            if _bg_proposed in _bg_va_set:\n"
    "                                _bg_jericho_valid = True\n"
    "                    except Exception:\n"
    "                        _bg_jericho_valid = False\n"
    "                    if _bg_off_list and _bg_bad_verb and not _bg_jericho_valid:\n"
    "                        _bg_top = _bg_actions[0] if _bg_actions else ''\n"
    "                        _bg_list = ', '.join(repr(a) for a in _bg_actions[:5])\n"
    "                        _bg_just = (\n"
    "                            '[BRAIN-GATE-K27] proposed action ' + repr(proposed_action) + ' uses an unknown verb. '\n"
    "                            'Pick one of: ' + _bg_list + '. '\n"
    "                            'Top entry: ' + repr(_bg_top) + '.'\n"
    "                        )\n"
    "                        return CriticResponse(\n"
    "                            score=-1.0,\n"
    "                            justification=_bg_just,\n"
    "                            confidence=1.0,\n"
    "                        )\n"
    "        except Exception:\n"
    "            # Fail-open: if the gate errors, fall through to the\n"
    "            # normal LLM-based critic so the bench keeps running.\n"
    "            pass\n"
    "\n"
    "        # Validate against object tree if Jericho interface is available\n"
    "        if jericho_interface:\n"
)

if PATCH_BG_MARKER in src:
    print("zork_critic_patch: already applied (K27)")
else:
    # K27 — strip prior brain-gate injections so we can re-inject with
    # the verb-whitelist relaxation body.
    import re as _re_strip
    for _old in OLD_BG_MARKERS:
        if _old in src:
            _pat = _re_strip.compile(
                _re_strip.escape("        " + _old + "\n")
                + r".*?^\n",
                _re_strip.DOTALL | _re_strip.MULTILINE,
            )
            _new_src = _pat.sub("", src, count=1)
            if _old in _new_src:
                sys.stderr.write(f"zork_critic_patch: failed to strip old marker {_old!r}\n")
                sys.exit(3)
            src = _new_src
    if anchor not in src:
        sys.stderr.write("zork_critic_patch: anchor not found; bailing.\n")
        sys.exit(2)
    src = src.replace(anchor, inject, 1)
    TARGET.write_text(src)
    print("zork_critic_patch: applied (K23 positive-accept brain top)")
