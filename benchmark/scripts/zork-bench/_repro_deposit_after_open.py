"""Sub-second repro for K50 deposit-after-open (the 15->20 blocker).

Bug (live in K49, Living Room): the agent reached the Living Room WITH the egg,
took the lantern, and issued `open case` -> "Opened." — then `open case` x4
more ("It is already open."). The open-success was never marked, so DELIVER's
`open case` (FRONTIER_BONUS+3 = 9) re-pinned every turn (>=8 hard-pin) and
`put egg in case` (FRONTIER_BONUS+2 = 8) NEVER fired. The deposit (+5 ->
score 20) never happened; score stuck at 15.

Fix: a sticky `_opened_containers` set — when `open <deposit-container>`
succeeds / is already open, record it; DELIVER then STOPS offering `open
<case>` so `put <egg> in <case>` becomes the top DELIVER move. Generic
(deposit-container cues + open-success cues, no Zork object names).

Asserts (logic mirror + source wiring; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))
SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def mark_opened(opened, act, resp):
    """Mirror of the record_action_outcome opened-container detection."""
    from terransoul_brain_bridge import _DEPOSIT_CONTAINER_CUES
    a = act.lower()
    if a.split()[:1] and a.split()[0] in ("open", "unlock"):
        r = resp.lower()
        if "opened" in r or "already open" in r or "swings open" in r or "is now open" in r:
            obj = a.split(None, 1)[1] if len(a.split(None, 1)) > 1 else ""
            if obj and any(c in obj for c in _DEPOSIT_CONTAINER_CUES):
                opened.add(obj.split()[-1])


def deliver_offers_open(cont_head, opened, tried_map):
    """Mirror of the DELIVER `open <cont>` gate."""
    return (cont_head not in opened
            and tried_map.get(f"open {cont_head}") not in ("loop", "fatal", "success", "consumed"))


def t1_open_success_marks_case() -> bool:
    opened = set()
    mark_opened(opened, "open case", "Opened.")
    if "case" not in opened:
        print(f"FAIL t1: `open case`->Opened. should mark 'case', got {opened}")
        return False
    # 'already open' also marks it (idempotent)
    opened2 = set()
    mark_opened(opened2, "open trophy case", "It is already open.")
    if "case" not in opened2:
        print(f"FAIL t1: 'already open' should mark the container, got {opened2}")
        return False
    print("PASS t1: open-success / already-open marks the container opened")
    return True


def t2_non_container_not_marked() -> bool:
    opened = set()
    mark_opened(opened, "open window", "With great effort, you open the window.")
    if opened:
        print(f"FAIL t2: a non-deposit-container (window) must not be marked, got {opened}")
        return False
    print("PASS t2: a non-container open (window) is not tracked as a deposit container")
    return True


def t3_deliver_advances_open_to_put() -> bool:
    # Before opening: DELIVER offers `open case`.
    if not deliver_offers_open("case", opened=set(), tried_map={}):
        print("FAIL t3: DELIVER should offer `open case` before it is opened")
        return False
    # After opening: DELIVER no longer offers `open case` -> `put egg in case` (8) wins.
    if deliver_offers_open("case", opened={"case"}, tried_map={}):
        print("FAIL t3: DELIVER must STOP offering `open case` once opened (so put fires)")
        return False
    print("PASS t3: once opened, DELIVER drops `open case` so `put egg in case` wins")
    return True


def t4_source_wiring() -> bool:
    ok = ("self._opened_containers" in SRC
          and "_opened_conts = getattr(self.memory_manager, \"_opened_containers\"" in SRC
          and "_cont_head not in _opened_conts" in SRC)
    print("PASS t4: opened-container tracking + DELIVER skip wired"
          if ok else "FAIL t4: deposit-after-open wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_open_success_marks_case(), t2_non_container_not_marked(),
               t3_deliver_advances_open_to_put(), t4_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- deposit-after-open repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
