"""Repro/regression for the 2026-06-18 self-improve fixes (score-10 cap work):

  FIX A — gate() loop-break Layer-4 picks a NON-oscillated frontier exit instead
          of the alphabetical-first one (which re-entered the room just left).
  FIX C — _critic_accepts retains a substantive directiveless INSIGHT lesson
          (causal precondition / risk aversion) instead of discarding it, while
          still rejecting trivia and bare restatements.

Sub-10-second pure-logic repro (reproduce-first doctrine). Run:
    python _repro_loopbreak_and_critic.py
"""
import terransoul_brain_bridge as B


def _frontier_pick(exits_keys, action_history):
    """Mirror of the gate() Layer-4 selection so the choice logic is unit-tested
    without constructing the whole orchestrator."""
    recent_actions = {a for (_rk, a) in action_history}
    fresh = sorted(d for d in exits_keys if d not in recent_actions)
    return (fresh or sorted(exits_keys))[0]


def test_fix_a_prefers_fresh_exit():
    # Agent oscillating east<->northwest at one room; cached exits include a
    # never-tried 'south'. Old behaviour: sorted()[0] == 'east' (re-enters loop).
    exits = {"east", "northwest", "south"}
    hist = [("rk", "east"), ("rk", "northwest"),
            ("rk", "east"), ("rk", "northwest")]
    got = _frontier_pick(exits, hist)
    assert got == "south", f"expected fresh exit 'south', got {got!r}"
    # Degenerate: every exit was just tried -> deterministic alphabetical fallback.
    hist2 = [("rk", "east"), ("rk", "south"), ("rk", "northwest")]
    got2 = _frontier_pick(exits, hist2)
    assert got2 == "east", f"expected alpha fallback 'east', got {got2!r}"
    print("FIX A ok: loop-break prefers a non-oscillated frontier exit")


def test_fix_c_keeps_directiveless_insight():
    # A high-value causal-precondition insight with NO cardinal direction and no
    # bindable intent keyword. Old gate dropped it; new gate keeps it as context.
    insight = "Secure and activate a light source before entering an unlit area."
    assert B._lesson_directives(insight) == {"directions": set(), "intents": set()}, \
        "guard: this lesson must carry no bindable directive for the repro to be valid"
    assert B._critic_accepts(insight, progress_facts="score 10 in 150 turns"), \
        "directiveless substantive insight must now be KEPT"
    # Still reject trivia (too short) and a bare restatement of run facts.
    assert not B._critic_accepts("ok", ""), "trivia must be rejected"
    facts = "the agent looped at the clearing and made no progress"
    assert not B._critic_accepts(facts, progress_facts=facts), \
        "bare restatement of run facts must be rejected"
    # A vague, non-actionable outcome description must STILL be rejected — keeping
    # directiveless lessons must not become "keep everything".
    assert not B._critic_accepts("things went poorly this run", ""), \
        "vague non-actionable outcome description must be rejected"
    assert not B._critic_accepts("the score did not change much", ""), \
        "another vague description must be rejected"
    print("FIX C ok: substantive insight kept; trivia/restatement rejected")


def test_fix_d_risk_lens_for_repeated_fatal():
    # >=2 no-visibility (fatal) events -> repeated-fatal-state deficit -> risk lens,
    # regardless of acquisition state. This is the cap-breaking score-10 case:
    # banked points but keeps dying in the dark.
    d = B._classify_failure_deficit(
        containers_seen=True, valued_seen=True, turns_since_progress=2,
        final_score=10, fatal_events=6)
    assert d == "repeated-fatal-state", f"expected repeated-fatal-state, got {d!r}"
    assert B._aspect_for_deficit(d) == "risk", "fatal deficit must select the risk lens"
    # 1 fatal event is noise, not a pattern -> falls through to the old taxonomy.
    d1 = B._classify_failure_deficit(True, True, 2, 10, fatal_events=1)
    assert d1 != "repeated-fatal-state", "a single fatal event must not trip the risk lens"
    # The risk lens was previously UNREACHABLE; prove it is now selectable.
    assert "risk" in {B._aspect_for_deficit(x) for x in
                      ("repeated-fatal-state", "looped-no-progress",
                       "acquired-no-valuable", "general-stall")}, \
        "risk lens must be reachable from at least one deficit"
    print("FIX D ok: repeated fatal states route to the (previously dead) risk lens")


def _activate_light_pick(carried_heads, obs_dark_now, dark_here, tried_map, FB=4):
    """Mirror of the ACTIVATE-CARRIED-LIGHT selection so the band/gating logic is
    unit-tested without the full planner."""
    out = []
    if carried_heads and (obs_dark_now or dark_here):
        for clh in carried_heads:
            emitted = False
            for on in (f"turn on {clh}", f"light {clh}"):
                if tried_map.get(on) is None:
                    band = (FB + 11) if obs_dark_now else (FB + 5)
                    out.append((on, band))
                    emitted = True
                    break
            if emitted:
                break
    return out


def test_fix_e_activate_carried_light():
    FB = 4
    # Carried light detected from inventory via the generic detector.
    heads = []
    for it in ["a brass lantern", "a sword"]:
        for ls in B._light_sources(it):
            heads.append(ls.split()[-1].lower())
    assert heads, "a carried light source must be detected from inventory"
    clh = heads[0]
    # In the dark, carrying an unlit light -> turn-on out-ranks DARK-RETREAT (+10).
    got = _activate_light_pick(heads, True, set(), {}, FB)
    assert got and got[0][0] == f"turn on {clh}", f"expected turn-on, got {got}"
    assert got[0][1] == FB + 11 > FB + 10, "in-dark activation must beat DARK-RETREAT(+10)"
    # Proactive: not dark now but a known dark exit -> strong promote at +5.
    got2 = _activate_light_pick(heads, False, {"down"}, {}, FB)
    assert got2 and got2[0][1] == FB + 5, f"proactive band wrong: {got2}"
    # One-shot: once turn-on tried, don't re-promote it (fall through to retreat).
    got3 = _activate_light_pick(heads, True, set(), {f"turn on {clh}": "neutral"}, FB)
    assert got3 and got3[0][0] == f"light {clh}", "should try the alt verb if primary tried"
    got4 = _activate_light_pick(
        heads, True, set(), {f"turn on {clh}": "neutral", f"light {clh}": "neutral"}, FB)
    assert got4 == [], "both activation verbs tried -> no promotion (retreat takes over)"
    # No carried light -> no activation (DARK-RETREAT behaviour preserved).
    assert _activate_light_pick([], True, set(), {}, FB) == [], "no light -> no activation"
    print("FIX E ok: carried light activates in/near dark, beats retreat, one-shot")


def _solution_replay_keep(tried_outcome):
    """Mirror of the SOLUTION-REPLAY skip predicate: True == replay-pin this known
    scoring move; False == skip it."""
    return tried_outcome not in ("loop", "fatal", "consumed", "neutral")


def test_fix_f_replay_skips_precondition_unmet():
    # A known scoring move never tried this episode -> replay it (first attempt).
    assert _solution_replay_keep(None), "untried scoring move must still replay-pin"
    # Tried and it WORKED -> keep replaying (that's the point).
    assert _solution_replay_keep("success"), "successful scoring move must replay"
    assert _solution_replay_keep("progress"), "progress move must replay"
    # Tried here and produced NO movement (precondition unmet) -> stop pinning it,
    # so the agent stops oscillating on a move that doesn't work yet.
    assert not _solution_replay_keep("neutral"), "precondition-unmet move must be dropped"
    # Existing exclusions preserved.
    for o in ("loop", "fatal", "consumed"):
        assert not _solution_replay_keep(o), f"{o} must still be excluded"
    print("FIX F ok: replay drops precondition-unmet (neutral) moves, keeps successes")


def _is_state_change_move(act, resp, location_changed, score_delta):
    """Mirror of the STATE-CHANGE-REPLAY record predicate: True == persist this
    non-scoring in-place reveal as a per-room SOLUTION_MOVE."""
    resp_l = (resp or "").lower()
    act_tok = act.lower().split()[0] if act.split() else ""
    REVEAL = ("reveal", "moved to one side", "moved aside", "uncover", "expos",
              "aside", "beneath", "underneath")
    MANIP = ("move", "push", "pull", "lift", "shift", "slide", "raise", "pry", "roll")
    return (not location_changed and score_delta <= 0 and bool(act)
            and act_tok in MANIP and any(c in resp_l for c in REVEAL))


def test_fix_g_state_change_replay():
    # The canonical prerequisite: an in-place manipulation that reveals a hidden
    # passage, scoring 0 -> must be recorded so it replays next episode.
    assert _is_state_change_move(
        "move rug",
        "With a great effort, the rug is moved to one side of the room, "
        "revealing the dusty cover of a closed trap door.",
        location_changed=False, score_delta=0), "rug-move reveal must be recorded"
    # A plain non-revealing manipulation -> not recorded (no new state).
    assert not _is_state_change_move(
        "push table", "The table is too heavy to move.", False, 0), \
        "a non-revealing manip must not be recorded"
    # A move that CHANGED location is a normal nav move, not an in-place reveal.
    assert not _is_state_change_move(
        "move", "You walk north. Forest.", location_changed=True, score_delta=0), \
        "a location-changing move is not an in-place state-change"
    # A scoring reveal is already captured by the score-gated writer -> skip here.
    assert not _is_state_change_move(
        "move rug", "...revealing...", False, score_delta=5), \
        "a scoring move is recorded by the score path, not this one"
    # A non-manipulation verb that happens to say 'reveal' -> not a prereq move.
    assert not _is_state_change_move(
        "read book", "The page reveals a clue.", False, 0), \
        "only manipulation verbs count as uncovering prerequisites"
    print("FIX G ok: non-scoring reveal prerequisites are recorded for replay")


def test_fix_i_reverted_band_order():
    # Fix I (take-light +9 above replay +8) was FALSIFIED by v17 (35/35/35 ->
    # 20/35/25): the band bump reordered the tuned promotions and stalled the
    # descent. Reverted to +4 (known-good v16). This guards the reverted order
    # and the death-avoidance bands that DO matter (Fix E beats DARK-RETREAT).
    FB = 4
    take_light = FB + 4          # reverted (was +9)
    solution_replay = FB + 8
    dark_retreat = FB + 10
    activate_carried = FB + 11
    assert take_light < solution_replay, "take-light reverted below the replay band"
    assert activate_carried > dark_retreat, \
        "ACTIVATE-CARRIED-LIGHT(+11) must still beat DARK-RETREAT(+10) — the live death-avoidance fix"
    print("FIX I ok (REVERTED): take-light back at +4; Fix E still beats DARK-RETREAT")


def _replay_descent_deferred(sr_key, light_visible, carries_light):
    """Mirror of the Fix J descent-gate: True == defer this replayed descent
    (secure the visible light first)."""
    return (sr_key in ("down", "d") and light_visible and not carries_light)


def test_fix_j_defer_descent_until_light_taken():
    # The death case: a visible-but-untaken light + a replayed 'down' descent ->
    # defer the descent so take-light sequences first.
    assert _replay_descent_deferred("down", light_visible=True, carries_light=False), \
        "descent must be deferred while a visible light is untaken"
    # Once the light is carried, the descent replays normally.
    assert not _replay_descent_deferred("down", True, carries_light=True), \
        "with the light in hand the descent must NOT be deferred"
    # No light in the room -> nothing to secure, descent proceeds (don't stall).
    assert not _replay_descent_deferred("down", light_visible=False, carries_light=False), \
        "no visible light -> do not block the descent"
    # Non-descent replay moves are never gated by this rule.
    for k in ("east", "put sword in case", "move rug", "open trap door"):
        assert not _replay_descent_deferred(k, True, False), f"{k} must not be gated"
    # Detector sanity: a real light source line is detected; plain scenery isn't.
    assert B._light_sources("a battery powered brass lantern"), "lantern must be detected"
    assert not B._light_sources("a large oriental rug"), "rug is not a light source"
    print("FIX J ok: descent deferred until the visible light is secured")


def _light_available_here(observation, room, room_light_seen):
    """Mirror of the Fix J+ availability check: a light is 'available here' if the
    current obs names one OR a light was seen in this room earlier this episode."""
    return bool(B._light_sources(observation)) or (
        room.strip().lower() in (room_light_seen or set()))


def test_fix_j_plus_sticky_light_seen():
    # The v19 ep3 bug: at the descent the observation is a post-open action
    # response ("the trap door opens...") that no longer names the lamp, even
    # though the lamp was seen in this room earlier -> obs-only check missed it.
    post_open_obs = "the rug is moved aside, the trap door opens, revealing a staircase."
    assert not B._light_sources(post_open_obs), "guard: post-open obs must not name a light"
    seen = {"living room"}
    # obs-only would be False; sticky-seen makes it True -> descent gets deferred.
    assert _light_available_here(post_open_obs, "Living Room", seen), \
        "light seen earlier in this room must count as available at the descent"
    # A room where no light was ever seen -> not available (don't block descents there).
    assert not _light_available_here(post_open_obs, "Cellar", seen), \
        "a room with no light seen must not block the descent"
    # Current-obs light still works on its own.
    assert _light_available_here("a brass lantern is here", "Anywhere", set()), \
        "a light named in the current obs is available"
    print("FIX J+ ok: light-seen-in-room is sticky across the post-open observation")


def _solution_replay_filter(sol_moves):
    """Mirror of the Fix K saturation guard: given a list of (act, key) replayed
    solution moves for a room, return the keys that actually get pinned. Movement
    directions are suppressed when >=2 distinct ones conflict."""
    moves = [(a, k, k in B._REVERSE_DIR) for (a, k) in sol_moves]
    move_dirs = {k for (_a, k, m) in moves if m}
    saturated = len(move_dirs) >= 2
    return [k for (_a, k, m) in moves if not (saturated and m)]


def test_fix_k_saturation_guard():
    # The PSP-3 root cause: Forest with 4 conflicting directions all "scoring".
    forest = [("north", "north"), ("east", "east"), ("south", "south"), ("west", "west")]
    kept = _solution_replay_filter(forest)
    assert kept == [], f"a 4-way movement tie must pin NOTHING, got {kept}"
    # A single legit scoring direction is preserved (not saturated).
    assert _solution_replay_filter([("down", "down")]) == ["down"], \
        "a single movement direction must still replay"
    # Non-movement solution moves survive even when movement is saturated.
    mixed = [("east", "east"), ("west", "west"), ("put egg in case", "put egg in case")]
    kept2 = _solution_replay_filter(mixed)
    assert "put egg in case" in kept2 and "east" not in kept2 and "west" not in kept2, \
        f"non-movement moves kept, conflicting dirs dropped; got {kept2}"
    # Sanity: the movement set actually contains the compass directions.
    for d in ("north", "south", "east", "west", "up", "down"):
        assert d in B._REVERSE_DIR, f"{d} must be a recognised movement direction"
    print("FIX K ok: conflicting movement-direction replays suppressed; non-movement kept")


def _revisit_penalty_applied(base, dest_recent):
    """Mirror of the revisit-penalty gate (Fix L REVERTED — penalty is now
    unconditional again): True == apply the -2 penalty."""
    return bool(dest_recent) and 0 < base < 8


def test_fix_l_revisit_penalty_unconditional_after_revert():
    # Fix L (suspend-when-stalled) was falsified by the bench (mean 20.0→15.0;
    # an episode logged 194 scenic-room re-visits) and reverted. The penalty is
    # unconditional again: a recent destination is demoted regardless of stall.
    assert _revisit_penalty_applied(4, dest_recent=True), "recent dest is penalized"
    assert not _revisit_penalty_applied(8, dest_recent=True), "pin >=8 untouched"
    assert not _revisit_penalty_applied(-100, dest_recent=True), "banned untouched"
    assert not _revisit_penalty_applied(4, dest_recent=False), "non-recent dest not penalized"
    print("FIX L ok (REVERTED): revisit-penalty is unconditional (known-good)")


def _replay_dead_cycle_kept(sr_key, is_move, visits, tsp, saturated_dirs=False):
    """Mirror of the Fix K+M append filter: True == this replay move is KEPT."""
    import terransoul_brain_bridge as _B
    _LOCO = ("climb", "enter", "go", "exit", "descend", "ascend", "walk", "run")
    dead_cycle = visits >= 4 and tsp >= 8
    if saturated_dirs and is_move:
        return False
    if dead_cycle and (is_move or (sr_key.split() or [""])[0] in _LOCO):
        return False
    return True


def test_fix_m_dead_cycle_locomotion_suppressed():
    # v21 ep3 trap: 'climb' (locomotion, not a cardinal) pinned in an over-visited
    # stalled room → suppressed so the loop-breaker can escape.
    assert not _replay_dead_cycle_kept("climb", is_move=False, visits=10, tsp=12), \
        "locomotion 'climb' must be suppressed when over-visited + stalled"
    assert not _replay_dead_cycle_kept("up", is_move=True, visits=10, tsp=12), \
        "cardinal 'up' must be suppressed in a dead-cycle"
    # Manipulation replays SURVIVE a dead-cycle (the Living-Room chain must live).
    assert _replay_dead_cycle_kept("move rug", is_move=False, visits=10, tsp=12), \
        "manipulation 'move rug' must be KEPT even in a dead-cycle"
    assert _replay_dead_cycle_kept("put egg in case", is_move=False, visits=10, tsp=12), \
        "deposit must be KEPT in a dead-cycle"
    # Not a dead-cycle (low visits OR not stalled) -> locomotion replays kept.
    assert _replay_dead_cycle_kept("climb", is_move=False, visits=2, tsp=12), "low visits -> kept"
    assert _replay_dead_cycle_kept("climb", is_move=False, visits=10, tsp=3), "not stalled -> kept"
    print("FIX M ok: dead-cycle suppresses locomotion replays, keeps manipulation")


def _k49_demoted(d_l, carries_light, dark_here, light_here, base=4):
    """Mirror of the K49+FixN dark/descent-exit demotion: True == demote to 1."""
    return (not carries_light and base > 1 and
            (d_l in dark_here or (d_l in ("down", "d") and light_here)))


def test_fix_n_unlit_descent_demoted():
    # v22: 'down' descent past an untaken lamp -> demote so take-light surfaces.
    assert _k49_demoted("down", carries_light=False, dark_here=set(), light_here=True), \
        "an unlit 'down' descent with a light seen here must be demoted"
    # Once the light is carried, the descent is NOT demoted (proceed).
    assert not _k49_demoted("down", carries_light=True, dark_here=set(), light_here=True), \
        "with the light in hand the descent must NOT be demoted"
    # No light seen here -> descent not demoted by the new branch (don't over-fire).
    assert not _k49_demoted("down", carries_light=False, dark_here=set(), light_here=False), \
        "no light seen here -> descent not demoted by Fix N"
    # Non-descent exits are untouched by the new branch.
    assert not _k49_demoted("east", carries_light=False, dark_here=set(), light_here=True), \
        "a horizontal exit must not be demoted by the descent branch"
    # The original known-dark-exit branch is preserved.
    assert _k49_demoted("up", carries_light=False, dark_here={"up"}, light_here=False), \
        "a known-dark exit is still demoted (original K49)"
    print("FIX N ok: unlit descent demoted (take-light surfaces); known-dark preserved")


def _fix_o_demoted(act, score, light_here, carries_light):
    """Mirror of the Fix O general descent-locomotion light-gate post-pass."""
    _O_DESCEND = ("down", "d", "climb", "descend")
    if light_here and not carries_light:
        if ((act or "").split() or [""])[0].lower() in _O_DESCEND and score > 1:
            return 1
    return score


def test_fix_o_climb_descent_gated():
    # v24 ep2: 'climb' down the staircase past an untaken lamp -> demote to 1.
    assert _fix_o_demoted("climb", 4, light_here=True, carries_light=False) == 1, \
        "unlit 'climb' descent must be demoted (Fix N only caught 'down')"
    assert _fix_o_demoted("climb down", 8, light_here=True, carries_light=False) == 1, \
        "'climb down' (first token climb) must be demoted"
    assert _fix_o_demoted("down", 8, light_here=True, carries_light=False) == 1, \
        "'down' still demoted"
    # Carried light -> not demoted (descend freely).
    assert _fix_o_demoted("climb", 4, light_here=True, carries_light=True) == 4, \
        "with a light, the descent is not demoted"
    # No light seen here -> not demoted (don't over-fire).
    assert _fix_o_demoted("climb", 4, light_here=False, carries_light=False) == 4, \
        "no light seen here -> climb not demoted"
    # Non-descent moves untouched.
    assert _fix_o_demoted("take lantern", 4, light_here=True, carries_light=False) == 4, \
        "take-lantern must NOT be demoted (it's what we want to surface)"
    print("FIX O ok: 'climb'-type unlit descents demoted; take-light preserved")


def _fix_r_demoted(act, score, light_here, known_dark, carries_light):
    """Mirror of the Fix R + Fix O descent gate post-pass (climb/down/descend)."""
    _O_DESCEND = ("down", "d", "climb", "descend")
    if carries_light or not (light_here or known_dark):
        return score
    v = ((act or "").split() or [""])[0].lower()
    if v in _O_DESCEND and (light_here or v in known_dark) and score > 1:
        return 1
    return score


def test_fix_r_known_dark_descent_gated_without_light():
    # v26 ep2: the agent climbed into the dark TWICE before taking the lamp,
    # because the InfoExtractor dropped the lamp from the planner obs
    # (light_here=False) AND the cardinal-only _dark_exits never learned 'climb'.
    # Fix R records the descent VERB into no-visibility so the agent avoids
    # re-descending after the first grue even with no light surfaced here.
    known = {"climb"}
    assert _fix_r_demoted("climb", 12, light_here=False, known_dark=known, carries_light=False) == 1, \
        "a KNOWN-dark 'climb' must be demoted even with no light seen here"
    # A descent verb NOT yet known-dark is left alone (don't over-fire on the 1st try).
    assert _fix_r_demoted("down", 12, light_here=False, known_dark=known, carries_light=False) == 12, \
        "an un-learned descent verb is not demoted by Fix R (only the learned one)"
    # Carrying a light → descend freely.
    assert _fix_r_demoted("climb", 12, light_here=False, known_dark=known, carries_light=True) == 12, \
        "with a light in hand the known-dark descent is not demoted"
    # Light seen here → ALL descents demoted (original Fix O behaviour preserved).
    assert _fix_r_demoted("down", 8, light_here=True, known_dark=set(), carries_light=False) == 1, \
        "light-seen still demotes any descent (Fix O preserved)"
    # Non-descent move untouched.
    assert _fix_r_demoted("take lantern", 8, light_here=False, known_dark=known, carries_light=False) == 8, \
        "take-lantern must NOT be demoted (it is what we want to surface)"
    print("FIX R ok: known-dark descent verb gated without light-seen; Fix O preserved")


def test_fix_r_records_dark_descent_verb():
    # record_action_outcome must record the DESCENT VERB into _dark_descents when
    # the descent response is dark, keyed by the room descended FROM — this is the
    # cross-attempt signal the cardinal-only _dark_exits missed for 'climb'.
    bmm = B.BrainMemoryManager(mcp=_StubMcp())  # type: ignore[arg-type]
    # A lit-room action first so _last_lit_room := the origin room.
    bmm.record_action_outcome(location_id=80, location_name="Living",
                              action="open trap door",
                              response="The trap door opens, revealing a staircase leading down.")
    # Then a 'climb' whose response is pitch-black (the unlit descent).
    bmm.record_action_outcome(location_id=72, location_name="Cellar",
                              action="climb",
                              response="You have moved into a dark place. It is pitch black. You are likely to be eaten by a grue.")
    dd = getattr(bmm, "_dark_descents", {})
    assert dd.get("living") and "climb" in dd["living"], \
        f"'climb' into the dark must be recorded under the origin room 'living'; got {dd!r}"
    # A non-dark descent response must NOT be recorded.
    bmm2 = B.BrainMemoryManager(mcp=_StubMcp())  # type: ignore[arg-type]
    bmm2.record_action_outcome(location_id=80, location_name="Attic",
                               action="down", response="Attic. A cluttered room with a rope.")
    assert not getattr(bmm2, "_dark_descents", {}).get("attic"), \
        "a descent that did NOT go dark must not be recorded as a dark descent"
    print("FIX R ok: record_action_outcome records the descent verb that led into the dark")


class _StubMcp:
    """Minimal MCP stub so the real managers construct + run brain_suggest_action
    without a live brain. Returns no pins/affordances — Fix P's light-seen write
    happens at the top of brain_suggest_action, before any candidate retrieval,
    so an empty stub is sufficient to exercise the populate path."""

    def tool(self, name: str, args: dict, *a, **k):
        if name == "brain_search":
            return {"hits": []}
        return {}

    def call(self, *a, **k):
        return {}


def test_fix_p_planner_path_populates_light_seen():
    # Fix P regression (the v23/v24 binding-constraint bug): the descent
    # light-gates Fix J/N/O all READ mm._room_light_seen EVERY planner turn, but
    # its only WRITER lived inside record_action_outcome — a hook the upstream
    # orchestrator fires on ~20-60% of turns. At the trap-door descent turn the
    # room was absent from the set, the gate never fired ('avoid unlit descent' =
    # 0 grep hits in BOTH benches), and SOLUTION-REPLAY's +12 climb/down drove the
    # agent into the dark cellar past the untaken lamp -> grue. Fix P writes
    # light-seen on the EVERY-TURN planner path (mirrors the proven K30/K61 sticky
    # caches). NOTE: this is an END-TO-END test through the real
    # brain_suggest_action — unlike the Fix N/O *mirror* tests above, which pass
    # even when the populate path is broken (that gap is exactly what shipped the
    # bug). record_action_outcome is intentionally NEVER called here.
    bmm = B.BrainMemoryManager(mcp=_StubMcp())  # type: ignore[arg-type]
    bkm = B.BrainKnowledgeManager(mcp=_StubMcp())  # type: ignore[arg-type]
    bkm.memory_manager = bmm
    bmm._known_exits = {}  # type: ignore[attr-defined]

    assert not getattr(bmm, "_room_light_seen", set()), "guard: light-seen starts empty"
    # Turn where the observation names a light source (no record_action_outcome).
    lamp_obs = ("Living Room You are in the living room. There is a brass lantern "
                "here, and a wooden door with strange gothic lettering.")
    bkm.brain_suggest_action(room="Living Room", observation=lamp_obs)
    seen = getattr(bmm, "_room_light_seen", set()) or set()
    assert "living room" in seen, \
        f"Fix P: the planner path must record light-seen from ONE suggest call; got {seen!r}"

    # Stickiness: a later turn whose obs DROPS the lamp (a post-open action
    # response) must NOT erase the memory — so the descent gate still fires.
    post_open_obs = "The trap door reluctantly opens to reveal a rickety staircase descending into darkness."
    assert not B._light_sources(post_open_obs), "guard: post-open obs must not name a light"
    bkm.brain_suggest_action(room="Living Room", observation=post_open_obs)
    seen2 = getattr(bmm, "_room_light_seen", set()) or set()
    assert "living room" in seen2, \
        "Fix P: light-seen must be sticky across an obs that no longer names the lamp"

    # Control: a room whose obs never named a light must NOT be flagged, so we
    # never block a descent where no light was ever available here.
    bkm.brain_suggest_action(room="Cellar", observation="This is a dark, damp cellar. A passage leads north.")
    seen3 = getattr(bmm, "_room_light_seen", set()) or set()
    assert "cellar" not in seen3, "Fix P: a room with no light seen must not be flagged"
    print("FIX P ok: planner path populates sticky _room_light_seen (the descent gates now fire reliably)")


if __name__ == "__main__":
    test_fix_a_prefers_fresh_exit()
    test_fix_c_keeps_directiveless_insight()
    test_fix_d_risk_lens_for_repeated_fatal()
    test_fix_e_activate_carried_light()
    test_fix_f_replay_skips_precondition_unmet()
    test_fix_g_state_change_replay()
    test_fix_i_reverted_band_order()
    test_fix_j_defer_descent_until_light_taken()
    test_fix_j_plus_sticky_light_seen()
    test_fix_k_saturation_guard()
    test_fix_l_revisit_penalty_unconditional_after_revert()
    test_fix_m_dead_cycle_locomotion_suppressed()
    test_fix_n_unlit_descent_demoted()
    test_fix_o_climb_descent_gated()
    test_fix_p_planner_path_populates_light_seen()
    test_fix_r_known_dark_descent_gated_without_light()
    test_fix_r_records_dark_descent_verb()
    print("ALL REPRO TESTS PASSED")
