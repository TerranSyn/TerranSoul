"""P4 repro (sub-10s, offline, no infra): lesson-directive de-noise.

A narration sentence that merely *mentions* many cardinal tokens carries zero
recommendation signal and must NOT promote a tie of directions (which causes
arbitrary tie-break oscillation). Only a direction that is the grammatical
object of a recommendation/imperative cue should bind, capped at 1-2; >=3 ->
NONE (narration).

Run:  python benchmark/scripts/zork-bench/_repro_p4_lesson_directives.py
"""
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.join(_HERE, "terransoul_brain_bridge.py")
_spec = importlib.util.spec_from_file_location("_tsb_p4", _SRC)
_m = importlib.util.module_from_spec(_spec)
sys.modules["_tsb_p4"] = _m  # dataclass resolution needs the module registered
_spec.loader.exec_module(_m)

_lesson_directives = _m._lesson_directives


def _dirs(t):
    return _lesson_directives(t).get("directions", set())


# 1) Pure narration listing many directions -> NO directives (was: 5 tied dirs).
narration = (
    "To the north is a forest, to the south a clearing, to the east a river, "
    "and to the west a hill; passages lead up and down."
)
d = _dirs(narration)
assert len(d) == 0, f"narration must yield 0 directions, got {sorted(d)}"

# 2) A single recommendation/imperative -> exactly ONE direction.
for rec, want in [
    ("You should go north to make progress.", "north"),
    ("Try heading east next time.", "east"),
    ("Move west to escape the loop.", "west"),
    ("There is an unexplored exit to the south.", "south"),
    ("Explore the northwest passage.", "northwest"),
]:
    d = _dirs(rec)
    assert d == {want}, f"{rec!r} -> expected {{{want}}}, got {sorted(d)}"

# 3) Two recommendations -> at most 2 (cap), no NONE collapse.
two = "Go north, then try east."
d = _dirs(two)
assert d == {"north", "east"}, f"two-rec -> expected north+east, got {sorted(d)}"

# 4) >=3 recommended dirs collapses to NONE (treat as narration / no signal).
three = "Go north, go south, and go east."
d = _dirs(three)
assert len(d) == 0, f">=3 recommendations must collapse to 0, got {sorted(d)}"

# 5) A direction mentioned only as narration alongside one recommendation:
#    only the recommended one binds.
mixed = "The north wall is cold. You should head down the stairs."
d = _dirs(mixed)
assert d == {"down"}, f"mixed -> expected {{down}}, got {sorted(d)}"

print("P4 OK: narration de-noised; recommendation cues bind 1-2 dirs; >=3 -> NONE")
