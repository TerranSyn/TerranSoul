"""<1min replica (P8): drive the REAL zork_agent_patch.py INJECTION (the frozen
brain-pin decision chain) against the two observed fixation scenarios, at
frontier=6 (live bug) and frontier=5 (proposed brain-side fix).

No bench code is modified and nothing game-specific is seeded: shortlist
scores are synthesized with the bridge's verified formulas (promotion =
FRONTIER+2, untried exit = FRONTIER, K34 unstable-noun cap = FRONTIER-1) and
fed through the genuine injected decision code extracted from the patch.

Observed bugs this must reproduce at frontier=6:
  A. router-promoted exit (8) absolute-pins over LLM 'take egg' (r2 ep1,
     26-visit oscillation, status=force_high_confidence_pin_k33)
  B. BLOCKER-EXPAND 'open knife' (8) absolute-pins over LLM 'down' (Attic,
     interrupted run T75-82)
Fix criterion at frontier=5: both LLM actions must survive.
"""
import contextlib
import io
import json
import pathlib
import shutil
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import zork_agent_patch as zap

# The injection reads this absolute path (container layout). On Windows it
# resolves against the CWD drive; we create and clean up the fixture dir.
SHORTLIST = pathlib.Path("/bench/game_files/brain_shortlist.json")
CREATED_BENCH_DIR = not pathlib.Path("/bench").exists()

INDENT = " " * 12
DEDENTED = "\n".join(
    line[len(INDENT):] if line.startswith(INDENT) else line
    for line in zap.INJECTION.split("\n")
)
CODE = compile(DEDENTED, "<real-injection>", "exec")

_seq = 0


def run_decision(llm_action: str, shortlist: dict, mod_state: dict | None = None):
    """Execute the real injected decision chain once; return (action, status)."""
    global _seq
    _seq += 1
    SHORTLIST.parent.mkdir(parents=True, exist_ok=True)
    SHORTLIST.write_text(json.dumps(shortlist), encoding="utf-8")
    name = f"_replica_agent_{_seq}"
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    ns = mod.__dict__
    ns["__name__"] = name
    ns["action"] = llm_action
    if mod_state:
        ns.update(mod_state)
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        exec(CODE, ns)
    stderr = err.getvalue()
    if "exception=" in stderr:
        raise RuntimeError(f"injection raised internally: {stderr.strip()}")
    if "[BRAIN-PIN-K49]" not in stderr:
        raise RuntimeError("injection did not reach its decision log — bad harness")
    return ns["action"], ns.get("_bp_status"), stderr.strip()


def shortlists(frontier: int):
    promo = frontier + 2        # router / BLOCKER-EXPAND synthetic promotion
    replay = frontier + 8       # cross-episode SOLUTION-REPLAY pin
    exit_s = frontier           # untried exit
    cap = frontier - 1          # K34 unstable-noun cap
    a = {
        "room": "forest path",
        "forced": "",
        "observation_nouns": ["egg", "tree", "branches", "path"],
        "fixed_nouns": [],
        "actions": ["east", "north", "south", "take egg", "open egg", "examine tree"],
        "scores": [promo, exit_s, exit_s, cap, cap, cap],
    }
    b = {
        "room": "attic",
        "forced": "",
        "observation_nouns": ["knife", "rope", "table", "coil", "stairway"],
        "fixed_nouns": ["table", "stairway"],
        "actions": ["open knife", "down", "east", "south", "open coil", "read coil"],
        "scores": [promo, exit_s, exit_s, exit_s, cap, cap],
    }
    # C — r3 ep2 live loop, Kitchen edge: router promotes the exit back out
    # (toward a visited-but-looks-fresh room) while the LLM proposes the
    # genuinely unexplored 'up'. Observed: replaced_frontier_k54 orig='up'
    # top='east' top_score=7 (frontier=5).
    c = {
        "room": "kitchen",
        "forced": "",
        "observation_nouns": ["table", "passage", "staircase", "chimney", "window", "food"],
        "fixed_nouns": ["table", "passage", "staircase", "chimney"],
        "actions": ["east", "west", "up", "down", "take food", "open food"],
        "scores": [promo, exit_s, exit_s, exit_s, cap, cap],
    }
    # D — r3 ep2 live loop, Behind House edge: cross-episode SOLUTION-REPLAY
    # marks the recorded scoring move `forced`; the patch executes it
    # unconditionally (status=forced_taught). Documents the one-way edge —
    # constants cannot influence it (replay = FRONTIER+8 stays >= 8 for any
    # plausible frontier value and `forced` bypasses scoring entirely).
    d = {
        "room": "behind house",
        "forced": "enter window",
        "observation_nouns": ["house", "path", "window", "corner"],
        "fixed_nouns": ["window"],
        "actions": ["enter window", "down", "east", "north", "up", "west"],
        "scores": [replay, exit_s, exit_s, exit_s, exit_s, exit_s],
    }
    return a, b, c, d


# Expected survival of the LLM's correct action per frontier value.
# C requires promo == K43 threshold (6) so the at-frontier exception band
# (K44 cardinal-vs-cardinal) activates -> frontier must be 4.
# D is an invariant: forced replay always wins (documented, not a failure).
EXPECT = {
    6: {"A": False, "B": False, "C": False},
    5: {"A": True,  "B": True,  "C": False},   # today's live r3 behaviour
    4: {"A": True,  "B": True,  "C": True},    # candidate next tune
}


def main() -> int:
    failures = []
    for frontier in (6, 5, 4):
        sl_a, sl_b, sl_c, sl_d = shortlists(frontier)
        # A: deep-revisit oscillation — prime 25 prior visits + persistent nouns.
        state_a = {
            "_bp_room_visits": {"forest path": 25},
            "_bp_persistent_nouns": {"forest path": {"egg", "tree"}},
        }
        results = {
            "A": ("take egg", *run_decision("take egg", sl_a, state_a)[:2]),
            "B": ("down", *run_decision("down", sl_b)[:2]),
            "C": ("up", *run_decision("up", sl_c)[:2]),
        }
        for label, (llm, act, st) in results.items():
            survived = act == llm
            print(f"frontier={frontier} {label}: llm={llm!r} -> action={act!r} status={st}")
            if survived != EXPECT[frontier][label]:
                failures.append(
                    f"frontier={frontier} {label}: expected survived={EXPECT[frontier][label]}, "
                    f"got action={act!r} status={st}"
                )
        # D invariant: forced replay wins regardless of constants.
        act_d, st_d, _ = run_decision("east", sl_d)
        print(f"frontier={frontier} D: llm='east' -> action={act_d!r} status={st_d}")
        if act_d != "enter window" or st_d != "forced_taught":
            failures.append(f"frontier={frontier} D: forced replay did not win ({act_d!r}/{st_d})")
    if failures:
        print("\nREPLICA RED:")
        for f in failures:
            print(" -", f)
        return 1
    print("\nREPLICA GREEN: 6 reproduces all pins; 5 frees A/B but loses C "
          "(today's live loop); 4 frees A/B/C; forced replay (D) invariant.")
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    finally:
        if CREATED_BENCH_DIR:
            shutil.rmtree("/bench", ignore_errors=True)
    sys.exit(rc)
