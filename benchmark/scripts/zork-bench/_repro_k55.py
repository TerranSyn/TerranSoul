"""K55 sub-10s repro — failed-exit memory.

K54 bench reached T24 stuck cycling Forest. T18/T22/T24 all proposed
'down' at Forest, but Forest has no 'down' exit. The frontier-pin had
no memory of exits already proven impossible, so the LLM kept proposing
them and the planner had nothing to fall back on.

Universal AGI rule (no domain content): if a movement verb was attempted
in a room and the room did NOT change after the action, that exit
doesn't exist there. Never propose it again.

K55 adds:
  - per-room set of failed movement verbs
  - safe_top: first planner candidate whose verb is not failed
  - early gate replacing LLM action when verb is in failed set
"""
from __future__ import annotations

FRONTIER_BONUS = 6
_COMPASS = {"north","south","east","west","up","down","n","s","e","w","u","d"}
_INFO_ONLY = {"examine","x","look","l","read","inventory","i","smell","listen","touch","feel","search"}
_ALLOWED = {"examine","look","read","inventory","smell","listen","take","open","climb","push","pull","light","move","enter","drop","put","wear","north","south","east","west","up","down"}
_MOVEMENT = {"north","south","east","west","up","down","northeast","northwest","southeast","southwest","n","s","e","w","u","d","ne","nw","se","sw","go","enter","exit","in","out","climb"}


# Module-level state mirroring _bp_mod.__dict__
STATE = {
    "_bp_failed_exits": {},   # {room: set(verb)}
    "_bp_last_room": None,
    "_bp_last_action": None,
}


def k55_gate(orig: str, top: str, top_score: int, visible_nouns, room_visits: int, room: str, acts: list):
    """Returns (action, status) and updates STATE for the next call."""
    room_key = (room or "").strip().lower()
    failed_exits = STATE.setdefault("_bp_failed_exits", {})

    # Detect failure of last action (no movement = same room).
    last_room = STATE.get("_bp_last_room")
    last_act = STATE.get("_bp_last_action")
    if last_room and last_act and room_key and last_room == room_key:
        last_verb = last_act.split()[0].lower() if last_act else ""
        if last_verb in _MOVEMENT:
            failed_exits.setdefault(room_key, set()).add(last_verb)

    failed_set = failed_exits.get(room_key, set()) if room_key else set()

    # Compute safe_top: first planner candidate whose verb is not failed.
    safe_top = top
    for alt in acts:
        an = alt.strip().lower()
        av = an.split()[0] if an else ""
        if av and av not in failed_set:
            safe_top = alt
            break

    # Gate logic.
    orig_n = orig.strip().lower()
    top_n = top.strip().lower()
    toks = orig_n.split()
    verb = toks[0] if toks else ""
    nouns = toks[1:]
    at_frontier = top_score <= FRONTIER_BONUS

    if verb in _MOVEMENT and verb in failed_set:
        # K56: hoisted before passthrough/cardinal-tie. A known-failed
        # movement verb is ALWAYS replaced, even if the planner top is
        # the same failed verb.
        status, action = "replaced_failed_exit_k55", safe_top
    elif orig_n == top_n:
        status, action = "passthrough", top
    elif at_frontier and orig_n in _COMPASS and top_n in _COMPASS:
        status, action = "allow_llm_cardinal_tie", orig
    elif (
        at_frontier
        and verb in _ALLOWED
        and (verb not in _INFO_ONLY or room_visits <= 1)
        and nouns
        and any(n in visible_nouns for n in nouns)
    ):
        status, action = "allow_llm_visible_noun", orig
    elif verb in _ALLOWED:
        status, action = "allow_llm", orig
    else:
        status, action = "replaced_frontier_k54", safe_top

    # Record for next-call failure detection.
    if room_key:
        STATE["_bp_last_room"] = room_key
        STATE["_bp_last_action"] = action

    return action, status


def _reset():
    STATE["_bp_failed_exits"] = {}
    STATE["_bp_last_room"] = None
    STATE["_bp_last_action"] = None


def _case(label, orig, top, top_score, vis, visits, room, acts, exp_act, exp_status):
    act, status = k55_gate(orig, top, top_score, vis, visits, room, acts)
    ok = act == exp_act and status == exp_status
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: room={room!r} -> "
          f"action={act!r} status={status} (exp {exp_act!r}/{exp_status})")
    assert ok, label


# === Scenario 1: tried 'down' at Forest, no movement, then tried 'down' again ===
_reset()
# T18 first time: 'down' at Forest. Cardinal tie (top='north'), allowed.
_case("T18 first 'down' at Forest (allowed cardinal-tie)",
      "down", "north", 6, set(), 5, "Forest", ["north", "south", "east", "west"],
      "down", "allow_llm_cardinal_tie")

# T19 next call: room is STILL Forest (no movement) — K55 records (Forest, 'down') as failed.
# LLM proposes 'down' again — must REPLACE.
_case("T19 'down' at Forest after failure (REPLACED)",
      "down", "north", 6, set(), 5, "Forest", ["north", "south", "east", "west"],
      "north", "replaced_failed_exit_k55")

# T20 LLM proposes 'down' a third time — still failed, still replaced.
_case("T20 'down' at Forest 3rd attempt (REPLACED)",
      "down", "south", 6, set(), 5, "Forest", ["south", "east", "west"],
      "south", "replaced_failed_exit_k55")

# === Scenario 2: 'down' fails at Forest but works at Clearing ===
_reset()
_case("S2 step1 'down' at Forest (allowed)",
      "down", "north", 6, set(), 1, "Forest", ["north", "south"],
      "down", "allow_llm_cardinal_tie")
# Still Forest — failure recorded.
_case("S2 step2 'down' at Forest blocked",
      "down", "north", 6, set(), 1, "Forest", ["north", "south"],
      "north", "replaced_failed_exit_k55")
# Now move: room changes to Clearing. 'down' should be ALLOWED at Clearing (different room).
_case("S2 step3 'down' at Clearing (different room, allowed)",
      "down", "east", 6, set(), 1, "Clearing", ["east", "south"],
      "down", "allow_llm_cardinal_tie")

# === Scenario 3: planner top is itself failed → safe_top picks alternate ===
_reset()
# Step 1: 'up' at Tree-room, allowed.
_case("S3 step1 'up' at TreeRoom",
      "up", "down", 6, set(), 1, "TreeRoom", ["down", "up"],
      "up", "allow_llm_cardinal_tie")
# Step 2: still TreeRoom (didn't move). LLM picks 'open egg' (visible noun).
# Planner top is 'up' which is now failed. safe_top must skip 'up' to next non-failed.
_case("S3 step2 'open egg' valid; safe_top skips failed planner top",
      "open egg", "up", 6, {"egg"}, 1, "TreeRoom", ["up", "open egg", "examine egg"],
      "open egg", "allow_llm_visible_noun")

# === Scenario 4: state-changing verb (take) at room never auto-blacklisted ===
# 'take' is not in _MOVEMENT, so failure-recording must skip it.
_reset()
_case("S4 step1 'take egg' at Tree (allowed)",
      "take egg", "up", 6, {"egg"}, 1, "Tree", ["up", "take egg"],
      "take egg", "allow_llm_visible_noun")
# Still Tree (egg didn't move room) — but 'take' is not movement, so NOT recorded as failed.
_case("S4 step2 'take egg' STILL allowed (take not movement)",
      "take egg", "up", 6, {"egg"}, 2, "Tree", ["up", "take egg"],
      "take egg", "allow_llm_visible_noun")
# Verify: 'down' is not blacklisted at Tree (since 'take' wasn't recorded).
_case("S4 step3 fresh 'down' at Tree (no false blacklist)",
      "down", "up", 6, set(), 2, "Tree", ["up", "down"],
      "down", "allow_llm_cardinal_tie")

# === Scenario 5 (K56): passthrough collision — LLM top == planner top == failed verb ===
# K55-bench bug: at Forest with failed_set={north}, LLM proposed 'north' AND
# planner top was 'north' → passthrough fired BEFORE K55 elif → no replacement.
# K56 hoists K55 above passthrough: any failed movement verb is replaced even
# when it matches planner top.
_reset()
_case("S5 step1 'north' at Forest (allowed, planner top=north)",
      "north", "north", 6, set(), 1, "Forest", ["north", "east"],
      "north", "passthrough")
# Still Forest — failure recorded. LLM AND planner top still 'north'.
_case("S5 step2 'north' at Forest passthrough+failed → REPLACED (K56)",
      "north", "north", 6, set(), 1, "Forest", ["north", "east"],
      "east", "replaced_failed_exit_k55")

print("\nAll K55 cases passed.")
