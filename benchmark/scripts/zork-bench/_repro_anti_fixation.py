"""K25 — anti-fixation rotation repro.

Validates that when the same shortlist[0] is forced for 3 turns at
the same room, the planner rotates it to the bottom on call 4 so
the agent gets a fresh top action. Domain-agnostic: uses a stub
MCP that always returns the same memories.
"""
from __future__ import annotations

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from terransoul_brain_bridge import (  # noqa: E402
    BrainMemoryManager,
    BrainKnowledgeManager,
    NullKnowledgeManager,
)


class _StubMcp:
    def tool(self, name: str, args: dict):
        # Return empty for everything except affordances.
        if name == "brain_search":
            q = (args or {}).get("query", "")
            tags = (args or {}).get("tags", "")
            if "universal-text-affordance" in q or "affordance" in tags:
                return {
                    "hits": [
                        {
                            "content": (
                                "Universal text-environment affordance — take: "
                                "applying 'take <noun>' (synonyms: get, pick up, grab) "
                                "PRIORITY=10"
                            )
                        },
                        {
                            "content": (
                                "Universal text-environment affordance — open: "
                                "applying 'open <noun>' (synonyms: unlock) "
                                "PRIORITY=9"
                            )
                        },
                        {
                            "content": (
                                "Universal text-environment affordance — read: "
                                "applying 'read <noun>' to any signed text. "
                                "PRIORITY=7"
                            )
                        },
                    ]
                }
            if "universal-planner-bonus" in q or "planner-bonus" in tags:
                return {
                    "hits": [
                        {
                            "content": (
                                "Universal planner bonus — frontier=6 visited=0 meta=2"
                            )
                        }
                    ]
                }
            return {"hits": []}
        return {}


def main() -> int:
    mcp = _StubMcp()
    bmm = BrainMemoryManager(mcp=mcp)  # type: ignore[arg-type]
    bkm = BrainKnowledgeManager(mcp=mcp)  # type: ignore[arg-type]
    bkm.memory_manager = bmm
    # The planner pulls _known_exits off the memory manager — provide
    # an empty dict to keep it as "unvisited" frontier.
    bmm._known_exits = {}  # type: ignore[attr-defined]

    # Same observation 4 calls in a row at "West of House"
    obs = (
        "West of House You are standing in an open field west of a "
        "white house. There is a small mailbox here."
    )
    room = "West of House"

    tops = []
    for i in range(4):
        bkm.brain_suggest_action(room=room, observation=obs)
        tops.append(list(bkm._recent_top_picks))

    print(f"[INFO] _recent_top_picks history per call: {tops}")
    print(f"[INFO] final state: {bkm._recent_top_picks}")
    # On call 4, rotation should have fired between call 3 and 4 and
    # cleared history. So _recent_top_picks ends with just [(room, call4_top)].
    if len(bkm._recent_top_picks) <= 1:
        print("[PASS] anti-fixation cleared history after 3-repeat rotation.")
        return 0
    print("[FAIL] anti-fixation did NOT rotate.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
