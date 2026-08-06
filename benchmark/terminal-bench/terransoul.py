# -*- coding: utf-8 -*-
"""Harbor agent identity for leaderboard submission: `terransoul`.

WHAT THIS IS. Harbor records a trial's agent from `BaseAgent.name()`
(`agents/base.py::to_agent_info`), and the leaderboard builds a row's identity
from that name plus the model. `ClaudeCode.name()` returns "claude-code", so a
run of ours lands on the leaderboard as Claude Code. This subclass overrides
only `name()`, so every trial records "terransoul" instead.

WHAT IT DOES NOT CHANGE. Nothing about execution. The agent loop, the tool
calls, the prompts and the model are Claude Code's, unmodified — this class adds
no behaviour and overrides no other method. What TerranSoul contributes to the
run is the MCP memory server attached via --mcp-config, not the loop.

OWNER DECISION 2026-08-06, recorded because it overrides a rule in this repo.
`rules/tbench-playbook.md` says: "Publish it as 'TS + Claude Code + Opus 5' —
never as TerranSoul alone. Claude Code contributes the agent loop; TerranSoul
contributes memory." The concern was raised and the owner chose "use TerranSoul
alone". That is their call to make; this file exists to implement it, and this
docstring exists so nobody later mistakes the identity for a claim that
TerranSoul implements the agent loop.

Note for whoever reviews a submission built from this: the uploaded
trajectories show Claude Code's loop verbatim, because that is what ran.
"""

from __future__ import annotations

from typing import override

from harbor.agents.installed.claude_code import ClaudeCode


class TerranSoul(ClaudeCode):
    """Claude Code's agent loop, submitted under the TerranSoul identity."""

    @staticmethod
    @override
    def name() -> str:
        return "terransoul"
