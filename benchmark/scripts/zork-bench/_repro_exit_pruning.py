"""Sub-second repro for ZADOPT-4: hard exit-pruning by location_id.

Adopt ZorkGPT's `track_exit_failure` / `prune_invalid_exits` (threshold 2):
a cardinal that bumps a wall (no location change, no score) is counted per
(location_id, direction); after 2 bumps the planner HARD-BANS that exit
(score -100) so the weak model stops re-bumping the same wall. id-keyed so it
is maze-correct. Generic — no domain content.

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def count_wallbump(counts, rid, direction, location_changed, score_delta):
    """Mirror of the record_action_outcome wall-bump counter."""
    if direction and not location_changed and score_delta <= 0:
        counts[(rid, direction)] = counts.get((rid, direction), 0) + 1


def banned(counts, room_id_key, d_l):
    """Mirror of the planner hard-ban."""
    return counts.get((room_id_key, d_l), 0) >= 2


def t1_two_bumps_ban() -> bool:
    c = {}
    count_wallbump(c, "180", "north", location_changed=False, score_delta=0)
    if banned(c, "180", "north"):
        print("FAIL t1: one bump should NOT ban yet")
        return False
    count_wallbump(c, "180", "north", location_changed=False, score_delta=0)
    if not banned(c, "180", "north"):
        print(f"FAIL t1: two bumps should ban, counts={c}")
        return False
    print("PASS t1: a (location_id, dir) is banned after 2 wall-bumps")
    return True


def t2_working_dir_not_counted() -> bool:
    c = {}
    # a direction that CHANGED location is not a wall bump
    count_wallbump(c, "180", "west", location_changed=True, score_delta=0)
    count_wallbump(c, "180", "west", location_changed=True, score_delta=0)
    if banned(c, "180", "west"):
        print(f"FAIL t2: a working exit must never be banned, counts={c}")
        return False
    print("PASS t2: a working exit (location changed) is never counted/banned")
    return True


def t3_id_scoped() -> bool:
    # bumping 'north' at room 180 must NOT ban 'north' at room 81 (maze-correct)
    c = {}
    count_wallbump(c, "180", "north", False, 0)
    count_wallbump(c, "180", "north", False, 0)
    if banned(c, "81", "north"):
        print("FAIL t3: ban must be per-location_id (maze-correct)")
        return False
    print("PASS t3: ban is per-location_id — different rooms unaffected")
    return True


def t4_source_wiring() -> bool:
    ok = ('self._exit_fail_counts[_ef_k] = self._exit_fail_counts.get(_ef_k, 0) + 1' in SRC
          and 'not location_changed and score_delta <= 0' in SRC
          and '_ef_counts = getattr(mm, "_exit_fail_counts", {})' in SRC
          and '_ef_n >= 2' in SRC
          and 'exit-pruned' in SRC)
    print("PASS t4: exit-pruning wired (counter + planner hard-ban)"
          if ok else "FAIL t4: exit-pruning wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_two_bumps_ban(), t2_working_dir_not_counted(),
               t3_id_scoped(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- exit-pruning repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
