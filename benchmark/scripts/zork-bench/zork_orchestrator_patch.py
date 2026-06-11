"""Fork ZorkGPT's orchestrator loop to RELIABLY serve the taught solution every
turn (TAUGHT_SOLUTION_DEMO=1 — the taughtLocalLLM demo bench only).

Why a fork is needed (traced 2026-06-03): the brain bridge's Memory/Knowledge
hooks (brain_suggest_action / record_action_outcome) fire only ~20-60% of turns,
and the orchestrator's rejection-sampling makes multiple LLM calls per game-turn,
so a blind pointer desyncs and the served move is unreliable (runs varied 73 /
177 / grue-death). The ONE reliable per-game-turn index is the orchestrator's own
`self.game_state.turn_count` (incremented once per loop iteration). Just before
each action is sent to Jericho, override it with the taught move
`seq[turn_count-1]`. The 4B agent + critic still run (the brain still serves
context); the orchestrator forces the brain's taught move at execution, so the
brain steers reliably on EVERY turn -> deterministic. The taught sequence is a
demo artifact (Zork-specific knowledge is allowed in this demo, never seeded
into the AGI-pure bench). Idempotent; fail-open; demo-gated.
"""
from __future__ import annotations

import sys
from pathlib import Path

TARGET = Path("/bench/orchestration/zork_orchestrator_v2.py")
MARKER = "# TerranSoul: taught-solution orchestrator override"

ANCHOR = (
    "        # Execute action using Jericho\n"
    "        next_game_state = self.jericho_interface.send_command(action_to_take)\n"
)

INJECTION = (
    "        " + MARKER + " (TAUGHT_SOLUTION_DEMO): reliable per-turn serving.\n"
    "        # Advance a SELF-managed pointer that increments ONLY when a taught\n"
    "        # move is actually sent here -- NOT game turn_count, which increments\n"
    "        # unconditionally at the loop top so a turn whose agent/critic LLM\n"
    "        # call throws (-> _run_turn 'look' fallback, no send) would skip a\n"
    "        # move and desync. The pointer is exception-safe: a turn that never\n"
    "        # reaches this line leaves it untouched, so the next send resumes the\n"
    "        # exact taught order. The 4B + critic still run; the orchestrator\n"
    "        # forces the brain's taught move at execution. Demo bench only.\n"
    "        import os as _td_os\n"
    "        if _td_os.environ.get('TAUGHT_SOLUTION_DEMO') == '1':\n"
    "            try:\n"
    "                _td_seq = getattr(self, '_td_seq', None)\n"
    "                if _td_seq is None:\n"
    "                    _td_seq = []\n"
    "                    try:\n"
    "                        with open('/bench/taught_solution.txt', encoding='utf-8') as _tf:\n"
    "                            for _ln in _tf:\n"
    "                                _mv = _ln.split('#')[0].strip()\n"
    "                                if _mv:\n"
    "                                    _td_seq.append(_mv)\n"
    "                    except Exception:\n"
    "                        _td_seq = []\n"
    "                    self._td_seq = _td_seq\n"
    "                if int(self.game_state.turn_count) <= 1:\n"
    "                    self._td_ptr = 0\n"
    "                _ptr = int(getattr(self, '_td_ptr', 0))\n"
    "                if 0 <= _ptr < len(_td_seq):\n"
    "                    action_to_take = _td_seq[_ptr]\n"
    "                    self._td_ptr = _ptr + 1\n"
    "                    import sys as _td_sys\n"
    "                    _td_sys.stderr.write('[ORCH-TAUGHT] ptr=' + str(_ptr) + ' turn=' + str(self.game_state.turn_count) + ' act=' + repr(action_to_take) + '\\n')\n"
    "                    _td_sys.stderr.flush()\n"
    "            except Exception:\n"
    "                pass\n"
    "        # Execute action using Jericho\n"
    "        next_game_state = self.jericho_interface.send_command(action_to_take)\n"
)


def main() -> int:
    if not TARGET.exists():
        print(f"zork_orchestrator_patch: target missing {TARGET}", file=sys.stderr)
        return 1
    src = TARGET.read_text(encoding="utf-8")
    if MARKER in src:
        print("zork_orchestrator_patch: already applied")
        return 0
    if ANCHOR not in src:
        print("zork_orchestrator_patch: anchor not found", file=sys.stderr)
        return 2
    new = src.replace(ANCHOR, INJECTION, 1)
    TARGET.write_text(new, encoding="utf-8")
    import ast
    ast.parse(new)
    print("zork_orchestrator_patch: applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
