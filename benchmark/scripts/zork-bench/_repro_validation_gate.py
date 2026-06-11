"""Sub-second repro for ZADOPT-2: object-tree / valid-action validation gate.

ZorkGPT rejects impossible actions deterministically (take an absent item /
walk into a non-exit) via Jericho's object tree + valid exits. We achieve the
same FUNCTION by composition (adapted so we never pay a per-turn Jericho
brute-force):

  (L1) ZorkGPT's own critic object-tree validation is PRESERVED — our
       zork_critic_patch.py injects the brain-gate ABOVE the
       `# Validate against object tree` block (the inject re-includes the
       anchor), so impossible take/open/etc. are still hard-rejected by the
       engine's object tree when the critic evaluates an action.
  (L2) The brain planner can only propose actions on VISIBLE nouns — its
       candidate_nouns come solely from the room observation (`objects`) +
       carried `inventory_items`. You cannot act on what is not described/held.
  (L3) Exit validity is learned empirically by ZADOPT-4 exit-pruning (ban a
       (location_id, dir) after 2 wall-bumps) instead of a costly per-turn
       brute-force of every direction.
  (L4) Hallucinated/one-off NLP nouns are gated by noun-stability (promotable
       gate: only stable seen>=2 / openable / carried nouns get promoted).

Asserts the four layers are wired (source inspection; <10s, rule 8).
"""
from __future__ import annotations
import sys, time
from pathlib import Path

HERE = Path(__file__).parent
BRIDGE = (HERE / "terransoul_brain_bridge.py").read_text(encoding="utf-8")
CRITIC_PATCH = (HERE / "zork_critic_patch.py").read_text(encoding="utf-8")


def t1_critic_preserves_object_tree() -> bool:
    # The patch must INJECT above + KEEP the object-tree validation, not delete
    # it: the anchor text must reappear inside the `inject` string.
    anchor_line = "# Validate against object tree if Jericho interface is available"
    # appears in the `anchor` var AND in the `inject` var (>=2 occurrences)
    if CRITIC_PATCH.count(anchor_line) < 2:
        print("FAIL t1: critic patch does not re-include the object-tree anchor (would delete validation)")
        return False
    if "src.replace(anchor, inject, 1)" not in CRITIC_PATCH:
        print("FAIL t1: critic patch does not do an injecting replace")
        return False
    print("PASS t1: critic patch PRESERVES ZorkGPT object-tree validation (injects brain-gate above it)")
    return True


def t2_planner_candidates_visible_only() -> bool:
    ok = ("for obj in objects:" in BRIDGE
          and "candidate_nouns.append((obj," in BRIDGE
          and "for inv in inventory_items:" in BRIDGE
          and "candidate_nouns.append((inv, True))" in BRIDGE)
    print("PASS t2: planner proposes only on VISIBLE nouns (observation objects + carried inventory)"
          if ok else "FAIL t2: planner candidate source not visible-only")
    return ok


def t3_exit_validity_via_pruning() -> bool:
    ok = ("_exit_fail_counts" in BRIDGE and "_ef_n >= 2" in BRIDGE and "exit-pruned" in BRIDGE)
    print("PASS t3: exit validity learned empirically (ZADOPT-4 hard exit-pruning)"
          if ok else "FAIL t3: exit-pruning missing")
    return ok


def t4_noun_stability_gate() -> bool:
    ok = ("_noun_promotable" in BRIDGE and "_promotable_nouns" in BRIDGE
          and "seen_counts.get(obj, 0) >= 2" in BRIDGE)
    print("PASS t4: hallucinated/one-off nouns gated by stability (promotable gate)"
          if ok else "FAIL t4: noun-stability gate missing")
    return ok


def main() -> int:
    t0 = time.monotonic()
    results = [t1_critic_preserves_object_tree(), t2_planner_candidates_visible_only(),
               t3_exit_validity_via_pruning(), t4_noun_stability_gate()]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- validation-gate (ZADOPT-2) repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
