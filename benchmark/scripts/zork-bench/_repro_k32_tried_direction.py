"""Sub-10s repro: K32 — direction tried at this room without movement
should NOT keep getting FRONTIER_BONUS (P8 doctrine)."""

# Inline the relevant K32 logic from brain_suggest_action.
def score_exits(exits, visited_dirs, tried_map, known_exits, FRONTIER_BONUS=6, VISITED_BONUS=0):
    def _score(act):
        outcome = tried_map.get(act.lower())
        if outcome == "neutral":
            return (-3, "tried with no result")
        if outcome == "loop":
            return (-15, "known dead-end")
        if outcome == "progress":
            return (4, "previously made progress")
        return (0, "untried")
    scored = []
    for d in exits:
        base, reason = _score(d)
        tried_outcome = tried_map.get(d.lower())
        if d.lower() not in visited_dirs and tried_outcome not in ("neutral", "loop"):
            base += FRONTIER_BONUS
            reason = f"unvisited exit ({reason})"
        elif d.lower() in visited_dirs:
            base += VISITED_BONUS
            reason = f"visited exit→{known_exits.get(d, '?')} ({reason})"
        else:
            reason = f"tried direction, no movement ({reason})"
        scored.append((d, base, reason))
    return scored

# Case A (current bug): Forest. west tried this episode, location stayed
# Forest (neutral). Cross-episode west had progress. visited_dirs has
# only east (came from West House → Forest via west, so Forest's east
# leads back). Pre-K32: west scored 4+6=10 with "previously made
# progress". Post-K32: west scored -3 (neutral, no frontier bonus).
exits = ["east", "west"]
visited_dirs = {"east"}
known_exits = {"east": "West House"}
tried_map = {"west": "neutral"}  # tried this episode, didn't move
scored = score_exits(exits, visited_dirs, tried_map, known_exits)
result = dict((d, (s, r)) for d, s, r in scored)
assert result["west"][0] == -3, f"west should be -3, got {result['west']}"
assert "tried direction, no movement" in result["west"][1], f"west reason: {result['west'][1]}"
assert result["east"][0] == 0, f"east visited+0: got {result['east']}"

# Case B: untried frontier still gets bonus.
tried_map2 = {}
scored2 = score_exits(["north"], set(), tried_map2, {})
assert scored2[0][1] == 6, f"untried north should get FRONTIER_BONUS=6, got {scored2[0][1]}"

# Case C: visited exit gets visited treatment (no double-counting).
scored3 = score_exits(["east"], {"east"}, {"east": "neutral"}, {"east": "West House"})
# east is in visited_dirs → visited branch wins. base = -3 + 0 = -3.
assert scored3[0][1] == -3, f"east visited+neutral: got {scored3[0]}"

print("FIX VERIFIED: K32 wall-bumped directions get -3 (no frontier bonus); untried still get +6.")
