"""Sub-second repro for SOLUTION-REPLAY forced-move enforcement.

Goal (user 2026-06-02): the brain must give STEP-LEVEL guidance the weak 4B can
follow — strengthen move-level solution-replay + have the (reused ZorkGPT)
critic ENFORCE the brain-stored move. Previously the critic only enforced the
broad shortlist (any shortlist action passed), so a 4B could pick a weaker entry
over a known scoring move and wander (k58: score 10, pure-movement wander).

Fix: when the planner's TOP entry is a brain-recorded scoring move for this room
([SOLUTION-REPLAY]), the bridge writes it as `forced` in brain_shortlist.json;
the critic accepts ONLY that move and hard-rejects every alternative, so the 4B
replays the known winning step. The brain decides the move (its own learned
score signal); the critic only enforces — no hardcoded domain logic.

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

BRIDGE = (Path(__file__).with_name("terransoul_brain_bridge.py")
          .read_text(encoding="utf-8"))
CRITIC = (Path(__file__).with_name("zork_critic_patch.py")
          .read_text(encoding="utf-8"))


def compute_forced(top):
    """Mirror of the bridge shortlist-write `forced` computation."""
    if top and "[SOLUTION-REPLAY]" in str(top[0][2] or ""):
        return str(top[0][0])
    return ""


def critic_decision(proposed, forced):
    """Mirror of the critic forced-move gate: accept iff == forced, else reject."""
    def norm(s):
        return " ".join((s or "").strip().lower().split())
    f = norm(forced)
    if not f:
        return "passthrough"          # no forced move -> normal gate
    return "accept" if norm(proposed) == f else "reject"


def t1_forced_set_for_solution_replay() -> bool:
    top = [("take egg", 14, "[SOLUTION-REPLAY] known scoring move at 'Up a Tree'"),
           ("up", 6, "unvisited exit")]
    if compute_forced(top) != "take egg":
        print(f"FAIL t1: a SOLUTION-REPLAY top must force the move, got {compute_forced(top)!r}")
        return False
    print("PASS t1: a [SOLUTION-REPLAY] top entry is marked `forced`")
    return True


def t2_no_forced_when_top_is_frontier() -> bool:
    top = [("north", 6, "unvisited exit (untried in this room)"),
           ("take egg", 5, "speculative")]
    if compute_forced(top) != "":
        print(f"FAIL t2: a non-solution top must NOT force, got {compute_forced(top)!r}")
        return False
    print("PASS t2: an ordinary frontier top is not forced (free choice preserved)")
    return True


def t3_critic_accepts_forced_rejects_others() -> bool:
    if critic_decision("take egg", "take egg") != "accept":
        print("FAIL t3: the forced move must be accepted"); return False
    if critic_decision("up", "take egg") != "reject":
        print("FAIL t3: a non-forced move must be rejected when a move is forced"); return False
    if critic_decision("up", "") != "passthrough":
        print("FAIL t3: with no forced move, the gate must pass through"); return False
    print("PASS t3: critic accepts the forced move, rejects alternatives, passes through otherwise")
    return True


def t4_source_wiring() -> bool:
    bridge_ok = ('"forced": _forced,' in BRIDGE
                 and '"[SOLUTION-REPLAY]" in str(top[0][2] or "")' in BRIDGE)
    critic_ok = ("_bg_forced = _bg_norm(_bg_data.get('forced') or '')" in CRITIC
                 and "[BRAIN-GATE-FORCE]" in CRITIC
                 and "_bg_proposed == _bg_forced" in CRITIC)
    if not (bridge_ok and critic_ok):
        print(f"FAIL t4: wiring — bridge={bridge_ok} critic={critic_ok}")
        return False
    print("PASS t4: bridge writes `forced`; critic patch enforces it (accept/reject)")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [t1_forced_set_for_solution_replay(),
               t2_no_forced_when_top_is_frontier(),
               t3_critic_accepts_forced_rejects_others(),
               t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- forced-move repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
