"""K59 repro: 3-letter NOUN extraction (e.g. 'egg').

K58 trace showed at "Up a Tree" the planner objects=
['branch','reach','bird','nest','jewels','songbird'] — but 'egg'
appears in observation ("In the bird's nest is a large egg encrusted
with jewels..."). The spacy NOUN fallback in
`_extract_objects_from_obs` had `len(t) < 4` which rejects 'egg'.
The regex path uses `len(head) < 3` (allows 3-letter nouns).

K59 lowers the spacy filter to `< 3` to match. This is generic — any
text-grounded environment where 3-letter object words exist (egg,
cat, dog, gem, pot, box, mug, bag, log, mat, key, oar, axe, ...)
benefits.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from terransoul_brain_bridge import _extract_objects_from_obs  # type: ignore


UP_A_TREE_OBS = """Up a Tree
You are about 10 feet above the ground nestled among some large branches.
The nearest branch above you is above your reach. Beside you on the branch
is a small bird's nest. In the bird's nest is a large egg encrusted with
precious jewels, apparently scavenged by a childish songbird. The egg is
covered with fine gold inlay, and ornamented in lapis lazuli and
mother-of-pearl. Unlike most eggs, this one is hinged and closed with a
delicate looking clasp. The egg appears extremely fragile."""


def _case(label: str, obs: str, must_contain: list[str]) -> None:
    objs = _extract_objects_from_obs(obs)
    missing = [n for n in must_contain if n not in objs]
    ok = not missing
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: objs={objs} missing={missing}")
    assert ok, label


_case("Up a Tree extracts 'egg'", UP_A_TREE_OBS, ["egg", "branch", "nest", "jewels"])


# Generic check — 3-letter nouns shouldn't be filtered out as a class.
_GENERIC_OBS = "You see a small cat. There is a brass key here. A wooden box rests on the floor."
objs = _extract_objects_from_obs(_GENERIC_OBS)
print(f"[INFO] generic 3-letter test: objs={objs}")
# 'cat'/'key'/'box' may come from regex path (already accepts 3-letter).
# This is just informational — the K59 fix is for the spacy fallback.


print("\nAll K59 cases passed.")
