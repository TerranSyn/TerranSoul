"""Sub-second repro: the LLM object-extraction fallback gate must be
domain-agnostic (rules/bench-agi-purity.md Rule 1).

Before: gate keyed on Zork's "grue" monster token (domain leak).
After: gate keys on generic no-visibility markers (darkness/occlusion),
which generalise to any text environment and still suppress extraction
on a Zork grue line (every grue line also says "pitch black"/"dark").
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "benchmark" / "scripts" / "zork-bench"))


def t1_dark_suppresses() -> bool:
    from terransoul_brain_bridge import _has_no_visibility
    cases = [
        "It is pitch black. You are likely to be eaten by a grue.",
        "It is too dark to see.",
        "You can't see anything in the darkness.",
    ]
    for c in cases:
        if not _has_no_visibility(c.lower()):
            print(f"FAIL t1: should be no-visibility: {c!r}")
            return False
    print("PASS t1: generic darkness/occlusion lines flagged no-visibility")
    return True


def t2_lit_scene_not_suppressed() -> bool:
    from terransoul_brain_bridge import _has_no_visibility
    cases = [
        "You can see a brass lantern here.",
        "There is a small mailbox here.",
        "On the table is a leaflet.",
        # K35 regression: a LIT room that merely MENTIONS dark exits must NOT
        # be flagged no-visibility (the bare word 'dark' false-fired retreat).
        "Kitchen. A passage leads to the west and a dark staircase can be seen "
        + "leading upward. A dark chimney leads down. On the table is a brown sack.",
    ]
    for c in cases:
        if _has_no_visibility(c.lower()):
            print(f"FAIL t2: lit scene wrongly flagged: {c!r}")
            return False
    print("PASS t2: lit scenes pass the gate (extraction allowed)")
    return True


def t3_no_domain_token() -> bool:
    """The marker set must contain NO domain-specific monster/object token."""
    from terransoul_brain_bridge import _NO_VISIBILITY_MARKERS
    banned = {"grue", "troll", "thief", "cyclops", "mailbox", "leaflet"}
    hit = banned.intersection({m.lower() for m in _NO_VISIBILITY_MARKERS})
    if hit:
        print(f"FAIL t3: domain tokens in marker set: {hit}")
        return False
    print("PASS t3: no-visibility markers are domain-agnostic")
    return True


def t4_grue_token_gone_from_code() -> bool:
    src = (Path(__file__).with_name("terransoul_brain_bridge.py")
           .read_text(encoding="utf-8"))
    # Allow the word in comments only; fail if it appears in an executable
    # `"grue"` string literal used as a condition.
    bad = [ln for ln in src.splitlines()
           if '"grue"' in ln and not ln.lstrip().startswith("#")]
    if bad:
        print(f"FAIL t4: live 'grue' literal still present: {bad[:2]}")
        return False
    print("PASS t4: no executable 'grue' literal in bridge")
    return True


def main() -> int:
    t0 = time.monotonic()
    results = [
        t1_dark_suppresses(),
        t2_lit_scene_not_suppressed(),
        t3_no_domain_token(),
        t4_grue_token_gone_from_code(),
    ]
    dt = time.monotonic() - t0
    p = sum(1 for r in results if r)
    print(f"\n--- no-visibility-gate repro: {p}/{len(results)} passed in {dt:.2f}s ---")
    return 0 if p == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
