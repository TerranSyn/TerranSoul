"""ODY-9 — PAC2026 recency-zone brain directive (reverse-engineered from
nidhinjs/prompt-master, 2026-06-01).

LLMs attend most to the START and END of a prompt; the middle is "lost".
Our brain's single recommended action currently lives in the MIDDLE of a
verbose knowledgebase.md (the system prompt), so the weak model proposes
its own (often malformed) action and we lean on the hard-pin + critic to
override it — three layers that fight each other.

This patch puts the brain's #1 ranked action in the RECENCY zone: it
appends a crisp, token-audited directive to the LAST user message
(``user_content``) in BOTH ``get_action`` and ``get_action_with_reasoning``
so the model PROPOSES the brain's choice directly. Combined with the critic
positive-accept gate (BRAIN-GATE-K23), the override machinery then rarely
needs to fire.

Generic: zero domain words — the action text comes entirely from the
brain shortlist. Idempotent. Applied AFTER zork_agent_patch.py.
"""
from __future__ import annotations

import pathlib
import sys

TARGET = pathlib.Path("/bench/zork_agent.py")
src = TARGET.read_text(encoding="utf-8")

MARKER = "# TerranSoul: ODY-9 recency-zone brain directive (PAC2026)"
ANCHOR = '        messages.append({"role": "user", "content": user_content})\n'

INJECT = (
    "        " + MARKER + "\n"
    "        try:\n"
    "            import json as _rz_json, os as _rz_os\n"
    "            _rz_path = '/bench/game_files/brain_shortlist.json'\n"
    "            if _rz_os.path.exists(_rz_path):\n"
    "                with open(_rz_path, 'r', encoding='utf-8') as _rz_f:\n"
    "                    _rz_d = _rz_json.load(_rz_f)\n"
    "                _rz_acts = _rz_d.get('actions') or []\n"
    "                _rz_top = (str(_rz_acts[0]).strip() if _rz_acts else '')\n"
    "                _rz_room = (str(_rz_d.get('room') or '')).strip()\n"
    "                # Room-match guard: only inject when the shortlist is for\n"
    "                # the room described in the current observation (avoid a\n"
    "                # stale directive). Empty room => allow.\n"
    "                _rz_uc = user_content or ''\n"
    "                _rz_match = (not _rz_room) or (_rz_room.lower() in _rz_uc.lower())\n"
    "                if _rz_top and _rz_match:\n"
    "                    user_content = _rz_uc + (\n"
    "                        '\\n\\nNEXT ACTION (from your world-model): ' + _rz_top + '\\n'\n"
    "                        'Reply with EXACTLY this single game command unless you have a '\n"
    "                        'clearly better one. Output one short command only — no prose, '\n"
    "                        'no explanation, no asterisks.'\n"
    "                    )\n"
    "        except Exception:\n"
    "            pass\n"
)

if MARKER in src:
    print("zork_agent_recency_patch: already applied (ODY-9)")
    sys.exit(0)

count = src.count(ANCHOR)
if count == 0:
    sys.stderr.write("zork_agent_recency_patch: anchor not found; bailing.\n")
    sys.exit(2)

src = src.replace(ANCHOR, INJECT + ANCHOR)
TARGET.write_text(src, encoding="utf-8")
print(f"zork_agent_recency_patch: applied (ODY-9) at {count} site(s)")
