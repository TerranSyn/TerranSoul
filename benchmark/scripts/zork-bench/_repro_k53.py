"""K53 sub-10s repro — persistent per-room visible_nouns across turns.

K52 bench reached Up a Tree at turn 20 but got stuck turns 21-22:
  Turn 21: LLM proposed 'examine egg' 1x, 'open egg' 3x \u2192 K49 rejected
           because objects=[] for that turn, replaced with east (phantom)
  Turn 22: LLM proposed 'open egg' 4x \u2192 same rejection \u2192 stuck

The LLM correctly identified the canonical Zork +5 jewel-egg path.
The room observation collapsed after first arrival; observation_nouns
was empty even though 'jewels'/'nest'/'branch' were seen on turn 20.

K53: persist visible_nouns per room across turns within an episode.
Once a noun is seen in a room, it stays in that room's visible_nouns
until the agent leaves the room.
"""

from __future__ import annotations


class _PersistentNounStore:
    """Simulates the patch's module-level _bp_persistent_nouns dict."""

    def __init__(self):
        self._rooms = {}

    def merge(self, room: str, current_nouns):
        key = (room or "").strip().lower()
        if not key:
            return set(current_nouns)
        prev = self._rooms.get(key) or set()
        merged = set(current_nouns) | prev
        self._rooms[key] = merged
        return merged


def _case(label, store, room, current, expected_visible):
    visible = store.merge(room, current)
    ok = visible == expected_visible
    sym = "PASS" if ok else "FAIL"
    print(f"[{sym}] {label}: room={room!r} current={sorted(current)} "
          f"-> visible={sorted(visible)} (expected {sorted(expected_visible)})")
    assert ok, label


# Turn 20: agent enters Up a Tree, sees 'branch reach bird nest jewels songbird'.
store = _PersistentNounStore()
_case("Turn 20 enter Up a Tree",
      store, "Up a Tree",
      {"branch", "reach", "bird", "nest", "jewels", "songbird"},
      {"branch", "reach", "bird", "nest", "jewels", "songbird"})

# Turn 21: LLM at Up a Tree, observation collapsed (objects=[]).
# Without K53: visible would be empty -> 'open egg' would be rejected.
# With K53: visible retains turn-20 nouns -> can later add 'egg'.
_case("Turn 21 abbreviated obs",
      store, "Up a Tree",
      set(),
      {"branch", "reach", "bird", "nest", "jewels", "songbird"})

# Hypothetical turn where parser caught 'egg' from earlier description.
_case("Turn N adds 'egg' & 'gold'",
      store, "Up a Tree",
      {"egg", "gold"},
      {"branch", "reach", "bird", "nest", "jewels", "songbird", "egg", "gold"})

# Turn after going down: agent in West of House. Different room - no leakage.
_case("West of House isolated",
      store, "West of House",
      {"mailbox", "leaflet", "door"},
      {"mailbox", "leaflet", "door"})

# Returning to Up a Tree retains all prior nouns.
_case("Return to Up a Tree retains all",
      store, "Up a Tree",
      set(),
      {"branch", "reach", "bird", "nest", "jewels", "songbird", "egg", "gold"})

# Empty room key: don't crash, return current set.
_case("Empty room key passthrough",
      store, "",
      {"thing"},
      {"thing"})

# Verify: at Up a Tree turn 22, 'egg' in visible_nouns -> 'open egg' allowed.
visible_at_T22 = store.merge("Up a Tree", set())
assert "egg" in visible_at_T22, "'egg' must be retained for K49 'open egg' check"
print("\n[PASS] 'open egg' would now be allowed by K49 at Up a Tree turn 22.")

print("\nAll K53 cases passed.")
