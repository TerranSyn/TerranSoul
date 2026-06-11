"""Drive Zork I via Jericho from a command list — for a human/LLM to PLAY.

Reads newline-separated commands from a file (arg 1), replays them through the
real Z-machine, and prints `> cmd` + the verbatim response + running score, then
the final score/moves. Deterministic replay (Jericho RNG is seeded), so the
agent (here: Claude Opus 4.8) extends the command file each turn and re-runs to
see the result. No LLM in-process, no Ollama — pure Jericho.

Run inside the bench image (Jericho is Linux-only):
    docker run --rm --entrypoint python -v <dir>:/zb zork-bench:latest /zb/play_zork.py /zb/<cmds>.txt
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
    cmds_path = sys.argv[1] if len(sys.argv) > 1 else ""
    cmds = []
    if cmds_path:
        with open(cmds_path, encoding="utf-8") as f:
            cmds = [c.strip() for c in f.read().splitlines()
                    if c.strip() and not c.strip().startswith("#")]
    env = FrotzEnv(_rom())
    obs, info = env.reset()
    print("=== START ===")
    print(obs.strip()[:600])
    score = 0
    for i, cmd in enumerate(cmds, 1):
        obs, rew, done, info = env.step(cmd)
        score = info.get("score", env.get_score())
        print(f"\n--- {i} > {cmd}")
        print(obs.strip()[:500])
        print(f"[score={score} moves={info.get('moves','?')}{' DONE' if done else ''}]")
        if done:
            break
    print(f"\n=== FINAL: score={score} / 350  moves={env.get_moves()}  turns_played={len(cmds)} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
