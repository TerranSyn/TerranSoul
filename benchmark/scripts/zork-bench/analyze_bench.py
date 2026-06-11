"""ZADOPT-TEST — offline bench transcript scorer (host-runnable, no Jericho/LLM).

Adopt ZorkGPT's `analyze_critic.py` pattern: re-score a SAVED bench run in
seconds instead of re-running the 80-min Docker bench. Reads the per-turn
`Turn N: 'action' -> Score: S, Location: L` lines our runner already emits and
computes the metrics we keep grepping by hand:

  - max / final score and the turns where score changed (the scoring chain)
  - unique rooms reached
  - per-room visit counts + the single most-visited room (maze-collapse signal:
    with ID-keyed map this should NOT explode like the old 145x "Forest")
  - wasted-action rate (consecutive identical action at the same location)
  - the longest single-action stall (garbage-pin signal)
  - grue deaths / game-over

Usage:
    python analyze_bench.py <log-or-transcript> [<another> ...]
    python analyze_bench.py --compare <runA> <runB>     # regression diff

Pure stdlib; runs on Windows. The Jericho golden-replay fixture (the other
half of ZADOPT-TEST) is Docker-only — see test_jericho_walkthrough.py.
"""
from __future__ import annotations
import re, sys
from pathlib import Path

TURN_RE = re.compile(
    r"Turn (\d+): '([^']*)'\s*(?:→|->)\s*Score: (-?\d+), Location: ([^,\n]+)"
)
DEATH_RE = re.compile(r"You have died|game_over|slavering fangs of a lurking grue")


def analyze(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    turns = [(int(t), a.strip(), int(s), loc.strip())
             for t, a, s, loc in TURN_RE.findall(text)]
    out: dict = {"file": path.name, "turns": len(turns)}
    if not turns:
        out["note"] = "no Turn lines parsed"
        return out
    scores = [s for _, _, s, _ in turns]
    out["max_score"] = max(scores)
    out["final_score"] = scores[-1]
    # score-change events (the scoring chain)
    chain, last = [], None
    for t, a, s, loc in turns:
        if s != last:
            chain.append((t, s, a, loc))
            last = s
    out["score_chain"] = [(t, s) for t, s, _, _ in chain][:12]
    # rooms
    rooms: dict[str, int] = {}
    for _, _, _, loc in turns:
        rooms[loc] = rooms.get(loc, 0) + 1
    out["unique_rooms"] = len(rooms)
    out["most_visited_room"] = max(rooms.items(), key=lambda kv: kv[1])
    # wasted actions: same (loc, action) as the immediately prior turn
    wasted = sum(1 for i in range(1, len(turns))
                 if (turns[i][1], turns[i][3]) == (turns[i - 1][1], turns[i - 1][3]))
    out["wasted_action_rate"] = round(wasted / max(1, len(turns)), 3)
    # longest run of an identical action (garbage-pin / stall signal)
    longest, cur, cur_a = 1, 1, None
    for _, a, _, _ in turns:
        cur = cur + 1 if a == cur_a else 1
        cur_a = a
        longest = max(longest, cur)
    out["longest_same_action_run"] = longest
    out["deaths"] = len(DEATH_RE.findall(text))
    return out


def fmt(d: dict) -> str:
    if d.get("note"):
        return f"{d['file']}: {d['note']}"
    return (
        f"{d['file']}: turns={d['turns']} max_score={d['max_score']} "
        f"final={d['final_score']} rooms={d['unique_rooms']} "
        f"most_visited={d['most_visited_room']} "
        f"wasted={d['wasted_action_rate']} "
        f"longest_same_action={d['longest_same_action_run']} "
        f"deaths={d['deaths']}\n  score_chain={d['score_chain']}"
    )


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "--compare" and len(argv) == 3:
        a, b = analyze(Path(argv[1])), analyze(Path(argv[2]))
        print(fmt(a)); print(fmt(b))
        da = (b.get("max_score", 0) - a.get("max_score", 0))
        print(f"\nDELTA max_score {a['file']}->{b['file']}: {da:+d} "
              f"| rooms {b.get('unique_rooms',0)-a.get('unique_rooms',0):+d} "
              f"| longest_same_action {b.get('longest_same_action_run',0)-a.get('longest_same_action_run',0):+d}")
        return 0
    for p in argv:
        print(fmt(analyze(Path(p))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
