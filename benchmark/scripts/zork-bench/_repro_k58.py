"""K58 sub-10s repro — per-(room,verb,noun) info-only allowance.

K57 bench reached Up a Tree at T16. T17 'examine egg' allowed (visits=1).
T18 LLM proposed 'examine nest' (NEW noun, never tried) but was replaced
with 'east' because info-only-on-revisit gate blocks any examine when
visits > 1. Agent never learned the egg was IN the nest, never took it.

K58: track per-(room, verb, noun-tuple) tried set instead of per-room
visit count. An info-only verb on a noun never tried at this room is
informative regardless of how many times the room has been visited.
"""
from __future__ import annotations

FRONTIER_BONUS = 6
_COMPASS = {"north","south","east","west","up","down","n","s","e","w","u","d"}
_INFO_ONLY = {"examine","x","look","l","read","inventory","i","smell","listen","touch","feel","search"}
_ALLOWED = {"examine","look","read","inventory","smell","listen","take","open","climb","push","pull","light","move","enter","drop","put","wear","north","south","east","west","up","down"}
_MOVEMENT = {"north","south","east","west","up","down","northeast","northwest","southeast","southwest","n","s","e","w","u","d","ne","nw","se","sw","go","enter","exit","in","out","climb"}


STATE = {
    "_bp_failed_exits": {},
    "_bp_tried_examines": {},   # {room: set((verb, noun_tuple))}
    "_bp_last_room": None,
    "_bp_last_action": None,
}


def k58_gate(orig: str, top: str, top_score: int, visible_nouns, room: str, acts):
    room_key = (room or "").strip().lower()
    failed_exits = STATE["_bp_failed_exits"]
    tried_examines = STATE["_bp_tried_examines"]

    last_room = STATE.get("_bp_last_room")
    last_act = STATE.get("_bp_last_action")
    if last_room and last_act and room_key and last_room == room_key:
        last_verb = last_act.split()[0].lower() if last_act else ""
        if last_verb in _MOVEMENT:
            failed_exits.setdefault(room_key, set()).add(last_verb)

    failed_set = failed_exits.get(room_key, set()) if room_key else set()
    tried_set = tried_examines.get(room_key, set()) if room_key else set()

    safe_top = top
    for alt in acts:
        an = alt.strip().lower()
        av = an.split()[0] if an else ""
        if av and av not in failed_set:
            safe_top = alt
            break

    orig_n = orig.strip().lower()
    top_n = top.strip().lower()
    toks = orig_n.split()
    verb = toks[0] if toks else ""
    nouns = toks[1:]
    orig_tuple = (verb, tuple(nouns)) if nouns else None
    at_frontier = top_score <= FRONTIER_BONUS

    if verb in _MOVEMENT and verb in failed_set:
        status, action = "replaced_failed_exit_k55", safe_top
    elif orig_n == top_n:
        status, action = "passthrough", top
    elif at_frontier and orig_n in _COMPASS and top_n in _COMPASS:
        status, action = "allow_llm_cardinal_tie", orig
    elif (
        at_frontier
        and verb in _ALLOWED
        and (verb not in _INFO_ONLY or orig_tuple is None or orig_tuple not in tried_set)
        and nouns
        and any(n in visible_nouns for n in nouns)
    ):
        status, action = "allow_llm_visible_noun", orig
    elif verb in _INFO_ONLY and orig_tuple is not None and orig_tuple in tried_set:
        status, action = "replaced_repeat_examine_k58", safe_top
    elif verb in _ALLOWED:
        status, action = "allow_llm", orig
    else:
        status, action = "replaced_frontier_k54", safe_top

    if room_key:
        STATE["_bp_last_room"] = room_key
        STATE["_bp_last_action"] = action
        act_toks = action.strip().lower().split() if action else []
        if len(act_toks) >= 2 and act_toks[0] in _INFO_ONLY:
            tried_examines.setdefault(room_key, set()).add((act_toks[0], tuple(act_toks[1:])))

    return action, status


def _reset():
    STATE["_bp_failed_exits"] = {}
    STATE["_bp_tried_examines"] = {}
    STATE["_bp_last_room"] = None
    STATE["_bp_last_action"] = None


def _case(label, orig, top, top_score, vis, room, acts, exp_act, exp_status):
    act, status = k58_gate(orig, top, top_score, vis, room, acts)
    ok = act == exp_act and status == exp_status
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: -> action={act!r} status={status} (exp {exp_act!r}/{exp_status})")
    assert ok, label


# === Scenario A: Up a Tree, multiple distinct examines on revisit ===
_reset()
# T16 first visit: 'examine egg' allowed
_case("A1 examine egg first visit",
      "examine egg", "east", 6, {"egg", "nest", "branch"}, "Up a Tree",
      ["east", "north", "south", "up", "west"],
      "examine egg", "allow_llm_visible_noun")
# T17 revisit (failure of east → still Up a Tree): 'examine nest' NEW noun → ALLOWED
_case("A2 examine nest revisit, NEW noun (K58)",
      "examine nest", "east", 6, {"egg", "nest", "branch"}, "Up a Tree",
      ["east", "north", "south", "up", "west"],
      "examine nest", "allow_llm_visible_noun")
# T18 revisit again: 'examine nest' SAME tuple → REPLACED (repeat waste)
_case("A3 examine nest repeat → replaced",
      "examine nest", "east", 6, {"egg", "nest", "branch"}, "Up a Tree",
      ["east", "north", "south", "up", "west"],
      "east", "replaced_repeat_examine_k58")
# T19 revisit: 'examine egg' SAME tuple as T16 → REPLACED
_case("A4 examine egg repeat → replaced",
      "examine egg", "east", 6, {"egg", "nest", "branch"}, "Up a Tree",
      ["east", "north", "south", "up", "west"],
      "north", "replaced_repeat_examine_k58")
# T20: 'examine branch' NEW noun → ALLOWED
_case("A5 examine branch new noun → allowed",
      "examine branch", "east", 6, {"egg", "nest", "branch"}, "Up a Tree",
      ["east", "north", "south", "up", "west"],
      "examine branch", "allow_llm_visible_noun")

# === Scenario B: state-changing verb (take/open) never blocked by info-only gate ===
_reset()
_case("B1 first take egg",
      "take egg", "east", 6, {"egg"}, "Up a Tree",
      ["east", "take egg"],
      "take egg", "allow_llm_visible_noun")
# Repeat 'take egg' — still allowed because 'take' is not info_only
_case("B2 repeat take egg (state-changing) still allowed",
      "take egg", "east", 6, {"egg"}, "Up a Tree",
      ["east", "take egg"],
      "take egg", "allow_llm_visible_noun")

# === Scenario C: K57 regression — passthrough+failed-exit still replaced ===
_reset()
_case("C1 first 'north' at Forest passthrough",
      "north", "north", 6, set(), "Forest", ["north", "east"],
      "north", "passthrough")
_case("C2 'north' at Forest after failure → REPLACED (K57)",
      "north", "north", 6, set(), "Forest", ["north", "east"],
      "east", "replaced_failed_exit_k55")

print("\nAll K58 cases passed.")
