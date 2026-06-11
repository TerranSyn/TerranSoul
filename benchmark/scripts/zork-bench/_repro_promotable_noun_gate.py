"""Sub-second repro for the K46 promotable-noun gate.

Bug (live in K45, Rocky Ledge turns 133-140+): the agent re-issued `open feat`
8+ turns and never left. Root cause — when a room is over-visited with no
untried cardinal frontier, BLOCKER-EXPAND (and REVISIT-ESCALATE-K50) force a
state-verb above FRONTIER_BONUS to break the stall, but they selected the
FIRST open/enter/unlock/move action in `scored` with NO stability check — so
they promoted `open feat` (a one-off NLP-hallucinated noun) to 8, which the
K33 absolute-pin then re-pinned every turn over the real cardinal exits (=6).
ANTI-FIXATION rotates by POSITION but the pin selects by SCORE, so it never
escaped (fired 35x in vain).

Fix: a promotable-noun gate — the escalators only promote a verb whose object
is a STABLE room noun (seen >=2), a CONFIRMED-openable (state cue), or a
carried item. A hallucinated/scenery noun is never promoted, so the cardinals
win and the agent leaves. Generic stability signal, no domain content.

Asserts (logic mirror + source wiring, <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

SRC = (Path(__file__).with_name("terransoul_brain_bridge.py")
       .read_text(encoding="utf-8"))


def make_gate(stable_nouns, openable, inventory):
    promotable = ({n.lower() for n in stable_nouns}
                  | {n.lower() for n in openable}
                  | {n.lower() for n in inventory})
    heads = {n.split()[-1] for n in promotable if n.split()}

    def gate(act_l: str) -> bool:
        t = act_l.split()
        if len(t) < 2:
            return False
        noun = " ".join(t[1:]).strip()
        head = noun.split()[-1] if noun.split() else noun
        return noun in promotable or head in heads or head in promotable
    return gate


def t1_hallucinated_noun_blocked() -> bool:
    # Rocky Ledge: only scenery/hallucinated nouns, nothing stable/openable.
    gate = make_gate(stable_nouns=set(), openable=set(), inventory=set())
    if gate("open feat"):
        print("FAIL t1: `open feat` (hallucinated) must NOT be promotable")
        return False
    print("PASS t1: a hallucinated noun is not promotable (Rocky Ledge unsticks)")
    return True


def t2_confirmed_openable_allowed() -> bool:
    gate = make_gate(stable_nouns={"window"}, openable={"window"}, inventory=set())
    if not gate("open window"):
        print("FAIL t2: a confirmed-openable `open window` must be promotable")
        return False
    print("PASS t2: a confirmed-openable is still promotable (Behind House works)")
    return True


def t3_head_noun_and_inventory() -> bool:
    gate = make_gate(stable_nouns=set(), openable=set(), inventory={"brass lantern"})
    if not gate("turn lantern"):  # head-noun match against carried 'brass lantern'
        print("FAIL t3: head-noun match against a carried item failed")
        return False
    gate2 = make_gate(stable_nouns={"trophy case"}, openable=set(), inventory=set())
    if not gate2("open case"):
        print("FAIL t3: head-noun 'case' of stable 'trophy case' should be promotable")
        return False
    print("PASS t3: head-noun + inventory matching works")
    return True


def t4_unstable_scenery_blocked() -> bool:
    # 'canyon'/'cliff' appear once (unstable) -> not in stable set -> blocked.
    gate = make_gate(stable_nouns=set(), openable=set(), inventory=set())
    if gate("open canyon") or gate("take cliff"):
        print("FAIL t4: unstable scenery nouns must be blocked")
        return False
    print("PASS t4: unstable scenery verbs are not promoted")
    return True


def t5_source_wiring() -> bool:
    ok = ("def _noun_promotable(_act_l: str) -> bool:" in SRC
          and SRC.count("_noun_promotable(") >= 3  # def + BLOCKER-EXPAND + K50
          and "if not _noun_promotable(_be_act_l):" in SRC
          and "if not _noun_promotable(_k50_act_l):" in SRC)
    print("PASS t5: promotable-noun gate wired into BLOCKER-EXPAND + K50"
          if ok else "FAIL t5: gate wiring missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_hallucinated_noun_blocked(), t2_confirmed_openable_allowed(),
               t3_head_noun_and_inventory(), t4_unstable_scenery_blocked(),
               t5_source_wiring()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- promotable-noun-gate repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
