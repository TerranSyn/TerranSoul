#!/usr/bin/env python
"""Delivery-reliability ablation: replay the taught Zork I solution under
injected delivery drops, with two pointer disciplines, repeated trials.

Grounds the paper's S4.4 claim quantitatively (S08 "reliable delivery with
injected drops" control + repeated-trial statistics for the delivery arms):

  blind  - the pre-fix orchestrator bug: a dropped turn still ADVANCES the
           sequence pointer, so the move is skipped and the lamp-sensitive
           ordering desyncs.
  safe   - the shipped fix: a dropped turn leaves the pointer untouched and
           the move is retried on the next turn (delivery delayed, never
           skipped).

No LLM anywhere: the variable under test is delivery, the action source is
the fixed taught solution. Runs inside the zork-bench image (jericho + ROM).

Usage (inside container):
  python replay_delivery_ablation.py --out /out/delivery_ablation.json \
      [--rom PATH] [--solution PATH] [--trials 30] [--max-turns 1200] \
      [--drop-rates 0,0.01,0.02,0.05,0.1,0.2,0.3,0.4]
"""

import argparse
import json
import os
import random
import statistics

from jericho import FrotzEnv

ROM_CANDIDATES = [
    "/bench/jericho-game-suite/zork1.z5",
    "/bench/infrastructure/zork.z5",
]
SOLUTION_CANDIDATES = [
    "/bench/taught_solution.txt",
]


def find_first(paths, label):
    for p in paths:
        if os.path.exists(p):
            return p
    raise SystemExit(f"no {label} found in {paths}")


def load_solution(path):
    moves = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            cmd = line.split("#", 1)[0].strip()
            if cmd:
                moves.append(cmd)
    return moves


def run_trial(rom, moves, mode, drop_rate, seed, max_turns):
    env = FrotzEnv(rom)
    env.reset()
    rng = random.Random(seed)
    ptr = 0
    turns = 0
    delivered = 0
    dropped = 0
    score = 0
    done = False
    died = False
    while turns < max_turns and ptr < len(moves) and not done:
        turns += 1
        if drop_rate > 0 and rng.random() < drop_rate:
            dropped += 1
            if mode == "blind":
                ptr += 1  # the bug: pointer advances, move never delivered
            # safe: pointer untouched; retry next turn
            continue
        _, _, done, info = env.step(moves[ptr])
        ptr += 1
        delivered += 1
        score = info.get("score", score)
        if done and not env.victory():
            died = True
    env.close()
    return {
        "score": score,
        "turns": turns,
        "delivered": delivered,
        "dropped": dropped,
        "completed": score >= 350,
        "died": died,
        "moves_consumed": ptr,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", default=None)
    ap.add_argument("--solution", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--trials", type=int, default=30)
    ap.add_argument("--max-turns", type=int, default=1200)
    ap.add_argument(
        "--drop-rates", default="0,0.01,0.02,0.05,0.1,0.2,0.3,0.4"
    )
    args = ap.parse_args()

    rom = args.rom or find_first(ROM_CANDIDATES, "ROM")
    solution = args.solution or find_first(SOLUTION_CANDIDATES, "solution")
    moves = load_solution(solution)
    rates = [float(r) for r in args.drop_rates.split(",")]

    print(f"rom={rom} solution={solution} moves={len(moves)} "
          f"trials={args.trials} max_turns={args.max_turns}", flush=True)

    cells = []
    for mode in ("blind", "safe"):
        for rate in rates:
            trials = []
            for t in range(args.trials):
                seed = hash((mode, round(rate * 1000), t)) & 0x7FFFFFFF
                trials.append(
                    run_trial(rom, moves, mode, rate, seed, args.max_turns)
                )
                if rate == 0:
                    break  # deterministic: one trial suffices
            scores = [tr["score"] for tr in trials]
            cell = {
                "mode": mode,
                "drop_rate": rate,
                "trials": len(trials),
                "score_mean": round(statistics.mean(scores), 1),
                "score_std": round(
                    statistics.pstdev(scores) if len(scores) > 1 else 0.0, 1
                ),
                "score_min": min(scores),
                "score_max": max(scores),
                "completion_rate": round(
                    sum(tr["completed"] for tr in trials) / len(trials), 3
                ),
                "death_rate": round(
                    sum(tr["died"] for tr in trials) / len(trials), 3
                ),
                "turns_mean": round(
                    statistics.mean(tr["turns"] for tr in trials), 1
                ),
                "raw_scores": scores,
            }
            cells.append(cell)
            print(
                f"{mode:5s} p={rate:<5} n={cell['trials']:<3}"
                f" score {cell['score_mean']:>6}±{cell['score_std']:<6}"
                f" [{cell['score_min']},{cell['score_max']}]"
                f" complete={cell['completion_rate']:<6}"
                f" death={cell['death_rate']:<6}"
                f" turns={cell['turns_mean']}",
                flush=True,
            )

    result = {
        "rom": rom,
        "solution": solution,
        "solution_moves": len(moves),
        "trials_per_cell": args.trials,
        "max_turns": args.max_turns,
        "cells": cells,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print(f"wrote {args.out}", flush=True)


if __name__ == "__main__":
    main()
