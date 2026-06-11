"""Sub-second repro for ZADOPT-3: id-based revisit penalty (loop-break 1B).

Adopt ZorkGPT's Phase-1B location-revisit penalty: demote an exit whose KNOWN
destination (from the id-keyed _adjacency) is a recently-visited room, to break
room-to-room oscillation (Kitchen<->Behind House, forest bouncing). Only nudges
ordinary exits (0<base<8); never touches a wall-banned exit (-100) or a
high-value pin (>=8: deposit/replay/retreat). id-keyed → maze-correct.

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def apply_penalty(base, dest, recent):
    """Mirror of the planner revisit penalty."""
    if dest and dest in recent and 0 < base < 8:
        return base - 2
    return base


def t1_recent_dest_demoted() -> bool:
    # exit -> dest "11" which is in recent -> frontier 6 demoted to 4
    if apply_penalty(6, "11", ["11", "12"]) != 4:
        print("FAIL t1: exit to a recently-visited room should be demoted by 2")
        return False
    print("PASS t1: exit to a recently-visited room demoted (6->4)")
    return True


def t2_new_dest_not_demoted() -> bool:
    if apply_penalty(6, "99", ["11", "12"]) != 6:
        print("FAIL t2: exit to an unvisited room must keep its score")
        return False
    if apply_penalty(6, None, ["11", "12"]) != 6:
        print("FAIL t2: unknown destination must keep its score")
        return False
    print("PASS t2: exit to a NEW (or unknown) destination is not penalised")
    return True


def t3_high_pin_and_ban_untouched() -> bool:
    # a deposit/replay/retreat pin (>=8) is never penalised even if dest recent
    if apply_penalty(9, "11", ["11"]) != 9:
        print("FAIL t3: a high-value pin (>=8) must not be penalised")
        return False
    # a wall-banned exit (-100) is never touched
    if apply_penalty(-100, "11", ["11"]) != -100:
        print("FAIL t3: a wall-banned exit (-100) must not be touched")
        return False
    print("PASS t3: high-value pins (>=8) and wall-bans (-100) untouched")
    return True


def t4_source_wiring() -> bool:
    ok = ('self._recent_loc_ids.append(_rid)' in SRC
          and 'self._recent_loc_ids = self._recent_loc_ids[-5:]' in SRC
          and '_zd_dest in (getattr(mm, "_recent_loc_ids", [])' in SRC
          and '0 < base < 8' in SRC
          and 'revisit-penalty' in SRC)
    print("PASS t4: revisit-penalty wired (recent-id ring + planner demotion)"
          if ok else "FAIL t4: revisit-penalty wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_recent_dest_demoted(), t2_new_dest_not_demoted(),
               t3_high_pin_and_ban_untouched(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- revisit-penalty repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
