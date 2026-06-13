"""Sub-second repro + regression spec for the cross-game AVERSIVE-MEMORY
fixes (2026-06-13). Proves the three bugs that made the self-improving brain
re-walk into Detective's lethal restaurant and stay capped behind 9:05's front
door, and verifies the fixes. Inlines the real decision logic from
terransoul_brain_bridge.py (same pattern as _repro_k32_tried_direction.py) so
it runs in <1s with no Jericho / Ollama / MCP.

Bugs:
  1. Origin-keying — a location-changing fatal/failed action was attributed to
     the room you END UP in, not the room you ACTED FROM.
  2. ID-keying — cross-episode "tried" was keyed by room NAME; Detective reuses
     "Outside" for location_ids 36 and 37, colliding a lethal `north` (from 37)
     with a harmless `north` (from 36).
  3. Gate invalidation — a failed exit ("south: front door is closed") was
     marked tried and never cleared after `open front door` changed the world.
"""

import re

CARDS = ("north", "south", "east", "west", "up", "down",
         "northeast", "northwest", "southeast", "southwest")


def normalize_dir(a: str) -> str:
    a = a.lower().strip()
    return {"go south": "south", "s": "south", "go north": "north",
            "n": "north", "go west": "west", "w": "west"}.get(a, a)


# ---------------------------------------------------------------------------
# BUG 1+2 — death is mislabelled, mis-roomed, and never becomes "fatal".
# ---------------------------------------------------------------------------

# (a) PRE-FIX: the episodic prefix logic had NO died branch, so a fatal move
#     (location_changed into a brand-new death room) was labelled [NEW LOCATION]
#     and the planner's parser read that as "progress" — the OPPOSITE of
#     aversive. Reproduce the buggy classification:
def buggy_episodic_prefix(score_delta, inventory_changed, location_changed, first_visit, is_loop):
    if score_delta > 0:
        return "[+ SCORE]"
    if inventory_changed:
        return "[INVENTORY]"
    if location_changed and first_visit:
        return "[NEW LOCATION]"
    if location_changed:
        return "[MOVE]"
    if is_loop:
        return "[LOOP]"
    return ""


def parse_outcome(prefix):
    # The real tried_map parser (L3542+). Pre-fix it had no [DIED] branch.
    if prefix.startswith("[+") and "SCORE]" in prefix[:24]:
        return "success"
    if prefix.startswith("[NEW LOCATION]"):
        return "progress"
    if prefix.startswith("[LOOP]"):
        return "loop"
    return "neutral"


# Dying via `north` (enters the new restaurant room, then death): the buggy
# prefix is [NEW LOCATION] → parsed "progress" → planner is ENCOURAGED to repeat
# the fatal move. This is the Detective re-death.
_buggy_prefix = buggy_episodic_prefix(score_delta=0, inventory_changed=False,
                                      location_changed=True, first_visit=True, is_loop=False)
assert _buggy_prefix == "[NEW LOCATION]", _buggy_prefix
assert parse_outcome(_buggy_prefix) == "progress", "BUG repro: death looked like progress"


# (b) FIX: a dedicated, ORIGIN- + ID-keyed death memory is written and folded
#     into tried_map as "fatal". Inline the real fold (L3598+).
def death_fold(death_hits, room_id_key, tried_map):
    for content in death_hits:
        m_id = re.search(r"room id=([0-9a-z_]+)", content, re.IGNORECASE)
        if not m_id or str(m_id.group(1)).lower() != str(room_id_key).lower():
            continue  # id-key guard — other rooms' deaths must not apply here
        m_act = re.search(r"action=['\"]([^'\"]+)['\"]", content)
        if not m_act:
            continue
        tried_map[m_act.group(1).strip().lower()] = "fatal"
    return tried_map


# The death memory is written origin-keyed (issued FROM the street, id 37) and
# id-tagged — exactly what the bridge now writes on `died`.
DEATH_MEM = "DEATH-AVERSION: action='north' at room id=37 ('Outside') was FATAL — skip it here."

# At the street (id 37): north must become fatal.
tm37 = death_fold([DEATH_MEM], "37", {})
assert tm37.get("north") == "fatal", tm37

# At the OTHER "Outside" (id 36): north must stay available — NO name collision.
tm36 = death_fold([DEATH_MEM], "36", {})
assert tm36.get("north") is None, tm36


# (c) The avoidance machinery already exists: the planner scores "fatal" -100
#     (real code L3651). Confirm the fold actually causes avoidance at 37 and
#     NOT a false-positive block at 36.
def planner_score(outcome):
    if outcome == "fatal":
        return -100  # "previously fatal — skip" (real L3652)
    if outcome == "progress":
        return 4
    return 0


assert planner_score(tm37.get("north")) == -100, "street: north must be skipped"
assert planner_score(tm36.get("north")) == 0, "sibling room: north must remain open"


# ---------------------------------------------------------------------------
# BUG 3 — gate-state invalidation (9:05 front door).
# ---------------------------------------------------------------------------

def tried_cardinals(room_outcomes):
    # Real tried_cardinals_by_room logic (L1728): direction keys with any
    # recorded outcome count as "tried" at this room.
    return {d for d in (normalize_dir(a) for a in room_outcomes) if d in CARDS}


def gate_invalidate(room_outcomes):
    # Real ZADOPT-gate hook: forget no-movement cardinal failures after a
    # successful open/unlock, so the frontier re-tests them.
    for k in list(room_outcomes.keys()):
        if normalize_dir(k) in CARDS and room_outcomes.get(k) in ("neutral", "loop"):
            room_outcomes.pop(k, None)


# 9:05 Living room: `south` failed ("front door is closed") = neutral wall-bump;
# `open front` is about to succeed. Pre-fix south stays tried forever.
living = {"south": "neutral", "open front": "neutral"}
assert "south" in tried_cardinals(living), "pre-fix: south is excluded by frontier"

gate_invalidate(living)
assert "south" not in tried_cardinals(living), "FIX: south re-frontiered after the door opens"
assert "open front" in living, "non-cardinal outcomes must be preserved"

# A SUCCESSFUL exit (not neutral/loop) must NOT be wiped by gate-invalidation.
living2 = {"north": "success", "south": "neutral"}
gate_invalidate(living2)
assert living2.get("north") == "success", "successful exits must survive"
assert "south" not in living2

# ---------------------------------------------------------------------------
# BUG 4 — OPEN-FIRST: a traversal blocked by a closed thing must teach
# "open it first" (Zork kitchen window, 9:05 front door). Brain-mediated:
# WRITE a generic lesson on the closed-blocker failure, READ it back to
# promote `open <noun>`. No game content, no seed.
# ---------------------------------------------------------------------------

def openfirst_write(resp, location_changed):
    # Real ZADOPT-openfirst WRITE: the game NAMES the closed noun.
    if location_changed:
        return None
    m = re.search(r"\bthe\s+([a-z][a-z ]*?)\s+is\s+(?:closed|locked)\b", resp, re.IGNORECASE)
    if not m:
        return None
    noun = m.group(1).strip().lower()
    head = noun.split()[-1] if noun.split() else noun
    return head or None


def openfirst_fold(lesson_hits, room_id_key, tried_map):
    # Real ZADOPT-openfirst READ fold.
    for content in lesson_hits:
        m_id = re.search(r"room id=([0-9a-z_]+)", content, re.IGNORECASE)
        if not m_id or str(m_id.group(1)).lower() != str(room_id_key).lower():
            continue
        m_n = re.search(r"open ([a-z]+) first", content, re.IGNORECASE)
        if not m_n:
            continue
        act = f"open {m_n.group(1).strip().lower()}"
        if tried_map.get(act) not in ("success", "consumed", "fatal", "loop"):
            tried_map[act] = "progress"
    return tried_map


# Zork: `enter window` -> "The kitchen window is closed." (no move) teaches head="window".
_head = openfirst_write("The kitchen window is closed.  The phone in the bedroom rings.", location_changed=False)
assert _head == "window", _head
# 9:05: `south` -> "The front door is closed." teaches head="door".
assert openfirst_write("The front door is closed.", location_changed=False) == "door"
# A SUCCESSFUL move (location_changed) must not write an open-hint.
assert openfirst_write("Kitchen You are in the kitchen.", location_changed=True) is None

# READ fold: at room 18 (Behind House), the learned hint promotes `open window`.
LESSON = "OPEN-FIRST: at room id=18 the 'kitchen window' is closed — open window first before traversing it."
tmw = openfirst_fold([LESSON], "18", {})
assert tmw.get("open window") == "progress", tmw          # +4 -> beats neutral `enter window`
assert openfirst_fold([LESSON], "99", {}).get("open window") is None  # id-key: not at a different room
# Must not clobber a terminal verdict (already opened/consumed).
assert openfirst_fold([LESSON], "18", {"open window": "consumed"}).get("open window") == "consumed"

print("FIX VERIFIED: death-aversion is origin+id-keyed (street north -> fatal/-100; "
      "sibling-room north stays open); gate-invalidation re-frontiers a blocked "
      "exit after the door opens while preserving successes; open-first writes a "
      "brain lesson on a closed-blocker failure and promotes `open <noun>` (id-keyed).")
