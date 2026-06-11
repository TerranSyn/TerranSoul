"""Sub-second repro for the DELIVER light-source exclusion (bench iter K47).

Bug (live in K46, Living Room turn 29): the agent took the brass lantern
(ACQUIRE-LIGHT working) then DELIVER deposited it — `put lantern in case` —
into the trophy case. Wrong: a light source is a survival TOOL (needed so dark
areas aren't pitch-black → grue), not loot; depositing it scores nothing AND
leaves the agent with no light for the underground.

Fix: exclude carried light sources from the DELIVER deposit set, and only fire
DELIVER (open container + put) when a genuine depositable (non-light) item is
held. Generic: keep your lamp, store your treasure.

Asserts (logic mirror + source wiring, <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))
SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def depositable(inventory):
    from terransoul_brain_bridge import _light_sources
    return [it for it in inventory[:6] if not _light_sources(it)]


def t1_lantern_only_no_deposit() -> bool:
    # Carrying only the lantern → nothing depositable → DELIVER must not fire.
    if depositable(["brass lantern"]):
        print("FAIL t1: lantern alone must NOT be depositable")
        return False
    print("PASS t1: a lone light source yields no depositable (DELIVER won't fire)")
    return True


def t2_egg_is_depositable_lantern_kept() -> bool:
    dep = depositable(["brass lantern", "jewel-encrusted egg"])
    if any("lantern" in d for d in dep):
        print(f"FAIL t2: the lantern must be excluded, got {dep}")
        return False
    if not any("egg" in d for d in dep):
        print(f"FAIL t2: the egg must remain depositable, got {dep}")
        return False
    print(f"PASS t2: egg depositable, lantern kept ({dep})")
    return True


def t3_other_light_words() -> bool:
    # torch / lamp / candle are also kept.
    for tool in ("torch", "brass lamp", "candle"):
        if depositable([tool]):
            print(f"FAIL t3: light source {tool!r} must be excluded")
            return False
    print("PASS t3: torch/lamp/candle all excluded from deposit")
    return True


def t4_source_wiring() -> bool:
    ok = ("_depositable = [it for it in inventory_items[:6] if not _light_sources(it)]" in SRC
          and "if _ody8c_containers and _depositable:" in SRC
          and "for _dep_it in _depositable[:4]:" in SRC)
    print("PASS t4: DELIVER light-source exclusion wired"
          if ok else "FAIL t4: DELIVER exclusion wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_lantern_only_no_deposit(), t2_egg_is_depositable_lantern_kept(),
               t3_other_light_words(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- DELIVER keep-light repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
