"""Score curve of the known Zork I optimal solution (Jericho's get_walkthrough).

A frontier model (Claude Opus 4.8, ZorkGPT's deepseek/gpt) possesses the Zork I
solution from training. This plays that canonical optimal line on the real
Jericho engine and reports the score curve + the move where it crosses 94 (the
ZorkGPT public bar) and beyond. It is the achievable-with-game-knowledge
reference for a frontier agent — the fair comparison to ZorkGPT's frontier
models (which leverage the same knowledge). NOT the brain arm (a weak 4B with
no solution knowledge).

Run inside the bench image:
    docker run --rm --entrypoint python -v <dir>:/zb zork-bench:latest /zb/score_walkthrough.py [max_steps]
"""
from __future__ import annotations
import os, sys


def _rom() -> str:
    for p in (os.environ.get("ZORK_ROM_PATH", ""),
              "/bench/jericho-game-suite/zork1.z5", "infrastructure/zork.z5"):
        if p and os.path.exists(p):
            return p
    raise SystemExit("no zork ROM found")


def main() -> int:
    from jericho import FrotzEnv
    max_steps = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    env = FrotzEnv(_rom())
    env.reset()
    wt = env.get_walkthrough()
    score = 0
    cross94 = cross150 = None
    print(f"walkthrough length = {len(wt)} commands")
    print("score increases at:")
    for i, cmd in enumerate(wt[:max_steps], 1):
        _o, _r, done, info = env.step(cmd)
        s = info.get("score", env.get_score())
        if s != score:
            print(f"  move {i:3d}: +{s - score:<3d} -> {s:3d}/350   ({cmd})")
            score = s
        if cross94 is None and score >= 94:
            cross94 = i
        if cross150 is None and score >= 150:
            cross150 = i
        if done:
            break
    print(f"\n=== reaches 94/350 at move {cross94}; 150 at move {cross150}; "
          f"final after {min(max_steps,len(wt))} moves = {score}/350 ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
