"""Reproduce-first regression test — Reflexion failure-mode reflection.

Origin: hermes-agent (MIT) / Reflexion / ExpeL / SkillOpt audit, 2026-06-14.

Proves, in <0.1s with NO bench run and NO MCP call, that the rewritten
episode-end reflection (terransoul_brain_bridge.reflect_on_episode):

  1. asks Reflexion's "did the run COMPLETE its objective, and what was the
     single MISSING STEP?" question (not just the old generic "which verbs
     worked / wasted turns"), and
  2. injects the agent's OWN runtime progress facts — storage-container-seen,
     valuable-acquired, stalled-N-turns — which is the signal the old prompt
     threw away. That gap is exactly why a reached-the-treasures-but-never-
     deposited episode (zork1 ep1=10 -> ep2=10) emitted no actionable lesson.

AGI-purity is asserted: the prompt + facts contain NO game verbs, room names,
or walkthrough tokens — only generic long-horizon vocabulary. memory-seed.sql
is untouched; the learning is distilled at runtime from the agent's own play.
"""
import sys

sys.path.insert(0, r"D:\Git\TerranSoulApp\benchmark\scripts\zork-bench")
from terransoul_brain_bridge import (  # noqa: E402
    _build_progress_facts,
    _build_failure_mode_reflection_prompt,
    _build_contrastive_heuristic_prompt,
    _classify_failure_deficit,
    _lesson_directives,
    _lesson_promotions,
    _build_conjecturer_prompt,
    _build_guide_prompt,
    _parse_guide_score,
    _guide_score_subgoal,
    _extract_subgoal,
    _lesson_key,
    _utility_boost,
    _credit_from_outcome,
    _apply_credit,
    _parse_utility_ledger,
    _format_utility_ledger,
    _newest_utility_ledger,
    _aspect_for_deficit,
    _build_aspect_reflection_prompt,
    _critic_accepts,
    _parse_critic_verdict,
    _format_frontier,
    _parse_frontier,
    _newest_frontier,
    _frontier_target_prefix,
    _sgs_fallback_target,
    _guide_score_subgoal as _gss2,
    _extract_subgoal as _xsg2,
)

fails: list[str] = []

# --- 1. progress facts: the PLATEAU case (container + valuable + stalled) ----
pf_plateau = _build_progress_facts(
    containers_seen=True, valued_seen=True, turns_since_progress=14
)
if "store/deposit action actually completed" not in pf_plateau:
    fails.append("plateau facts missing the deposit-completion check")
if "stalled for 14 turns" not in pf_plateau:
    fails.append("plateau facts missing the stall count")

# --- 1b. progress facts: the 905-style NULL case (no container, no valuable) -
pf_null = _build_progress_facts(
    containers_seen=False, valued_seen=False, turns_since_progress=0
)
if "no storage container" not in pf_null or "no valuable was acquired" not in pf_null:
    fails.append("null facts missing the no-container / no-valuable signal")
if "deposit action actually completed" in pf_null:
    fails.append("null case wrongly emitted the deposit-completion check")

# --- 2. the prompt asks the Reflexion question + injects the facts ----------
prompt = _build_failure_mode_reflection_prompt(
    final_score=10,
    turns=100,
    progress_facts=pf_plateau,
    tail="... reached a room with a storage container, carried a valuable, the episode ended ...",
)
required = [
    "primary objective",                 # Q1 — did it reach the objective
    "missing step",                      # Q2 — Reflexion's missing-step question
    "store/deposit action completed",    # the deposit-completion failure mode
    "imperative voice",                  # Q3 — what to do differently
]
plow = prompt.lower()
for needle in required:
    if needle not in plow:
        fails.append(f"prompt missing Reflexion element: {needle!r}")
if pf_plateau not in prompt:
    fails.append("prompt did not inject the runtime progress_facts")

# --- 3. AGI-purity: no zork verbs / room names / walkthrough --------------
banned = [
    "trophy case", "mailbox", "west of house", "kitchen", "jewel", "egg",
    "lantern", "lamp", "underground", "grue", "living room", "attic",
    "open window", "climb tree",
]
hay = (prompt.lower() + " " + pf_plateau.lower())
leak = [b for b in banned if b in hay]
if leak:
    fails.append(f"AGI-PURITY LEAK — game-specific tokens present: {leak}")

# --- 4. contrastive distiller pairs success vs stall + asks for ONE rule ----
chp = _build_contrastive_heuristic_prompt(
    success_blob="SOLUTION_MOVE at room X: do 'open <container>' (scored +5).",
    failure_blob="looped between two rooms; re-issued the same direction 6x; no progress.",
    final_score=10, turns=100,
)
chlow = chp.lower()
for needle in ["made progress", "stalled", "one", "imperative", "generic", "transfers"]:
    if needle not in chlow:
        fails.append(f"contrastive prompt missing element: {needle!r}")
# The TEMPLATE itself must carry no game-specific tokens.
tmpl_only = _build_contrastive_heuristic_prompt("S", "F", 0, 0).lower()
tmpl_leak = [b for b in banned if b in tmpl_only]
if tmpl_leak:
    fails.append(f"contrastive TEMPLATE leaks game tokens: {tmpl_leak}")

# --- 5. deficit taxonomy maps own-counters -> the active failure class ------
cases = {
    (True, True, 14, 10): "reached-container-never-deposited",   # the zork1 plateau
    (False, False, 0, 0): "acquired-no-valuable",                # the 905 null
    (True, False, 12, 0): "acquired-no-valuable",                # container but nothing of value
    (False, True, 10, 5): "looped-no-progress",                  # valuable, no container, stalled
    (False, True, 2, 5): "general-stall",
}
for (cs, vs, tsp, fs), expect in cases.items():
    got = _classify_failure_deficit(cs, vs, tsp, fs)
    if got != expect:
        fails.append(f"deficit class for (cont={cs},val={vs},tsp={tsp}) = {got!r}, expected {expect!r}")

# --- 6. BIND: a prose lesson parses into STRUCTURED planner directives -------
d1 = _lesson_directives("explore the forest path east; find a storage container to deposit items")
if "east" not in d1["directions"]:
    fails.append(f"binder missed direction 'east' in {d1}")
if "deposit" not in d1["intents"] or "explore" not in d1["intents"]:
    fails.append(f"binder missed deposit/explore intent in {d1}")
d2 = _lesson_directives("Always perform a store/deposit action on a valuable when near a storage container")
if "deposit" not in d2["intents"]:
    fails.append(f"binder missed deposit intent in {d2}")
d3 = _lesson_directives("go north, then open the door and take the egg")
if "north" not in d3["directions"] or "open" not in d3["intents"] or "acquire" not in d3["intents"]:
    fails.append(f"binder missed north/open/acquire in {d3}")
# a directive-free lesson yields nothing (no false promotions)
d4 = _lesson_directives("the episode ended with a low score")
if d4["directions"] or d4["intents"]:
    fails.append(f"binder hallucinated directives from a neutral lesson: {d4}")

# --- 7. BIND promotion: the lesson now STEERS the planner (the iter-1 fix) --
FB = 4  # frontier bonus (untried exits score FB)
dirs = _lesson_directives("explore the forest path east")
# baseline: 'east' is an available, untried exit; the loop action is 'enter window'
proms = _lesson_promotions(dirs, ["north", "east", "west"], tried_map={}, frontier_bonus=FB)
if not proms or proms[0][0] != "east":
    fails.append(f"lesson did not promote 'east': {proms}")
elif proms[0][1] <= FB:
    fails.append(f"lesson promotion score {proms[0][1]} does not beat a plain untried exit (FB={FB})")
# escalation when looping: score must rise
prom_loop = _lesson_promotions(dirs, ["north", "east", "west"], tried_map={}, frontier_bonus=FB, looping=True)
if not prom_loop or prom_loop[0][1] <= proms[0][1]:
    fails.append(f"looping did not escalate the promotion: {prom_loop} vs {proms}")
# do NOT re-promote a direction already resolved (loop/fatal/success)
if _lesson_promotions(dirs, ["east"], tried_map={"east": "loop"}, frontier_bonus=FB):
    fails.append("promoted a direction already marked 'loop'")
# do NOT promote the DIRECTION 'east' when east isn't an available exit
# (the explore intent may still promote the other untried exits — that's fine)
if any(a == "east" for a, s, r in _lesson_promotions(dirs, ["north", "west"], tried_map={}, frontier_bonus=FB)):
    fails.append("promoted direction 'east' when it is not an available exit")
# K76 — a brain-recommended direction already tried-NEUTRAL here is a wall: the
# direction-binding must NOT re-promote it (must match the explore branch).
if any(a == "east" for a, s, r in _lesson_promotions(
        dirs, ["north", "east", "west"], tried_map={"east": "neutral"}, frontier_bonus=FB)):
    fails.append("K76: re-promoted a direction already tried-neutral (wall re-escalation)")
# ...and escalation while looping must ALSO skip a neutral wall (not push it harder)
if any(a == "east" for a, s, r in _lesson_promotions(
        dirs, ["north", "east", "west"], tried_map={"east": "neutral"}, frontier_bonus=FB, looping=True)):
    fails.append("K76: escalated a neutral wall while looping")

# --- 8. INTENT-BIND: a stalled/looped lesson (no direction) still promotes ---
# This is the gap that made LESSON-BIND fire 0x in the bench: real reflections
# are intent-heavy ("stalled, looping, deposit"), not direction-named.
stall_dirs = _lesson_directives(
    "The episode stalled, repeatedly looping between two rooms; find a storage "
    "container to deposit a valuable.")
if "explore" not in stall_dirs["intents"]:
    fails.append(f"stall/loop lesson did not yield 'explore' intent: {stall_dirs}")
# explore intent -> promote EVERY available untried exit (break the loop)
ex = _lesson_promotions(stall_dirs, ["north", "east"], tried_map={"east": "neutral"},
                        frontier_bonus=FB, looping=True)
promoted_dirs = {a for a, s, r in ex}
if "north" not in promoted_dirs:
    fails.append(f"explore intent did not promote untried exit 'north': {ex}")
if "east" in promoted_dirs:
    fails.append("explore intent promoted 'east' which was already tried (neutral)")
if ex and any(s <= FB for a, s, r in ex):
    fails.append(f"explore promotion does not beat a plain untried exit: {ex}")
# a pure deposit lesson (no stall/explore words) must NOT hallucinate exploration
dep_only = _lesson_directives("complete the deposit action while carrying a valuable")
if "explore" in dep_only["intents"]:
    fails.append(f"deposit-only lesson wrongly got 'explore' intent: {dep_only}")

# --- 8. SGS guide rubric: R_guide = max(0, relevance+(2-complexity)+(1-redundancy)) ---
g_cases = {
    "relevance: 5\ncomplexity: 0\nredundancy: 0": 8.0,   # ideal prerequisite
    "relevance: 4\ncomplexity: 1\nredundancy: 0": 6.0,
    "relevance: 2\ncomplexity: 1\nredundancy: 1": 3.0,   # 2+(2-1)+(1-1)=3
    "relevance: 5\ncomplexity: 3\nredundancy: 0": 0.0,   # SGS: complexity>=3 auto-zeroes
    "relevance: 0\ncomplexity: 4\nredundancy: 1": 0.0,
}
for txt, expect in g_cases.items():
    got = _parse_guide_score(txt)
    if abs(got - expect) > 1e-6:
        fails.append(f"guide score for {txt!r} = {got}, expected {expect}")
# a vetted-vs-rejected boundary: an ideal sub-goal clears the keep threshold (4.0),
# a high-complexity degenerate one is rejected.
if _parse_guide_score("relevance: 4\ncomplexity: 1\nredundancy: 0") < 4.0:
    fails.append("a relevant simple sub-goal was wrongly rejected")
if _parse_guide_score("relevance: 5\ncomplexity: 3\nredundancy: 0") >= 4.0:
    fails.append("a degenerate (complexity>=3) sub-goal was wrongly kept")

# --- 9. SGS prompt shapes: conditioned + generic, no game tokens in the template ---
cj = _build_conjecturer_prompt("deposit a valuable to score", "... reached a container, never deposited ...")
for needle in ["target", "sub-goal", "simpler", "prerequisite"]:
    if needle not in cj.lower():
        fails.append(f"conjecturer prompt missing element: {needle!r}")
gp = _build_guide_prompt("deposit a valuable to score", "acquire a valuable item")
for needle in ["relevance", "complexity", "redundancy", "target", "sub-goal"]:
    if needle not in gp.lower():
        fails.append(f"guide prompt missing axis/field: {needle!r}")
# AGI-purity: the TEMPLATES (with neutral target/subgoal) carry no game tokens.
tmpl = (_build_conjecturer_prompt("T", "X") + " " + _build_guide_prompt("T", "S")).lower()
tmpl_leak = [b for b in banned if b in tmpl]
if tmpl_leak:
    fails.append(f"SGS prompt TEMPLATES leak game tokens: {tmpl_leak}")

# --- 10. SGS deterministic Guide: keep relevant/simple, reject off-topic/degenerate ---
TGT = "deposit a valuable to score"
# kept (>=4): bindable + on-topic + simple
if _guide_score_subgoal(TGT, "acquire a valuable item") < 4.0:
    fails.append("guide rejected a relevant simple sub-goal (acquire a valuable)")
if _guide_score_subgoal(TGT, "place the carried item in the nearest container") < 4.0:
    fails.append("guide rejected a relevant deposit sub-goal (place ... in container)")
# rejected (<4): not bindable / off-topic
if _guide_score_subgoal(TGT, "reflect on the meaning of the game") >= 4.0:
    fails.append("guide kept an unbindable off-topic sub-goal")
# rejected (0): degenerate compound (complexity>=3)
if _guide_score_subgoal(TGT, "go north and then open the door and then take the egg and then go south") != 0.0:
    fails.append("guide did not zero a degenerate compound sub-goal")
# empty -> 0
if _guide_score_subgoal(TGT, "") != 0.0:
    fails.append("guide did not zero an empty sub-goal")

# --- 11. SGS sub-goal extraction: pull ONE clause out of the conjecturer's prose --
xg = _extract_subgoal("The agent acquired a valuable but did not deposit it. "
                      "A simpler intermediate step is to place the carried item in the nearest container.")
if "place the carried item in the nearest container" not in xg.lower():
    fails.append(f"extract_subgoal failed to pull the imperative clause: {xg!r}")
# the extracted single clause must now clear the Guide (was 0 as a 3-sentence blob)
if _guide_score_subgoal(TGT, xg) < 4.0:
    fails.append(f"extracted sub-goal still rejected by Guide: score={_guide_score_subgoal(TGT, xg)}")
# a bare imperative passes through unchanged
if _extract_subgoal("Acquire a valuable item.").lower() != "acquire a valuable item":
    fails.append(f"extract_subgoal mangled a bare imperative: {_extract_subgoal('Acquire a valuable item.')!r}")

# --- 12. iter-4 MemRL: learned lesson-utility credit + retrieval weighting -----
# 12a. key is derived from the actionable directives, paraphrase-stable & empty-safe
k_dep = _lesson_key(_lesson_directives("put the egg in the case to store it"))
if k_dep != _lesson_key(_lesson_directives("deposit your valuable into the trophy case")):
    fails.append(f"lesson_key not paraphrase-stable: {k_dep!r}")
if _lesson_key(_lesson_directives("a vague sentence with no directive")) != "":
    fails.append("lesson_key should be empty for a directive-free lesson")
# 12b. utility -> bounded boost: damp, never invert; cap the upside
if _utility_boost(5.0) != 3 or _utility_boost(2.0) != 2 or _utility_boost(0) != 0:
    fails.append("utility_boost positive mapping wrong")
if _utility_boost(-9.0) != -2 or _utility_boost(-1.0) != -1:
    fails.append("utility_boost negative floor wrong")
if _utility_boost("nan-ish") != 0:
    fails.append("utility_boost must be 0 on non-numeric")
# 12c. credit assignment from the episode outcome
if _credit_from_outcome(True) != 1 or _credit_from_outcome(False) != -1:
    fails.append("credit_from_outcome wrong sign")
# 12d. apply_credit folds + clamps; ignores empty keys
um = _apply_credit({"d:|i:deposit": 4.5}, ["d:|i:deposit", ""], 1)
if um["d:|i:deposit"] != 5.0:  # 4.5+1 clamped to hi=5.0
    fails.append(f"apply_credit upper clamp failed: {um}")
um2 = _apply_credit({"d:e|i:explore": -2.5}, ["d:e|i:explore"], -1)
if um2["d:e|i:explore"] != -3.0:  # -2.5-1 clamped to lo=-3.0
    fails.append(f"apply_credit lower clamp failed: {um2}")
# 12e. ledger round-trips through the brain's own text form
led = _format_utility_ledger(7, 12, {"d:e|i:deposit": 3.0, "d:|i:explore": -1.0, "__ep__": 99})
rt = _parse_utility_ledger(led)
if rt.get("__ep__") != 7 or rt.get("__best__") != 12.0:
    fails.append(f"ledger header round-trip failed: {rt}")
if rt.get("d:e|i:deposit") != 3.0 or rt.get("d:|i:explore") != -1.0:
    fails.append(f"ledger entries round-trip failed: {rt}")
# 12f. newest-ledger selection picks the highest ep among relevance-ordered hits
newest = _newest_utility_ledger([
    _format_utility_ledger(3, 5, {"d:e|i:deposit": 1.0}),
    _format_utility_ledger(9, 11, {"d:e|i:deposit": 4.0}),  # newest
    _format_utility_ledger(1, 0, {}),
])
if newest.get("__ep__") != 9 or newest.get("d:e|i:deposit") != 4.0:
    fails.append(f"newest_utility_ledger picked the wrong ledger: {newest}")
# 12g. END-TO-END: a high-utility lesson lifts its promotion above a neutral one
EXITS = ["east", "west"]
TRIED: dict = {}
hi_util = {_lesson_key(_lesson_directives("go east")): 5.0}
p_hi = _lesson_promotions(_lesson_directives("go east"), EXITS, TRIED, 10,
                          utility_map=hi_util)
p_lo = _lesson_promotions(_lesson_directives("go west"), EXITS, TRIED, 10,
                          utility_map={})
score_hi = next((s for a, s, _ in p_hi if a == "east"), None)
score_lo = next((s for a, s, _ in p_lo if a == "west"), None)
if score_hi is None or score_lo is None or score_hi <= score_lo:
    fails.append(f"MemRL utility did not lift the proven lesson: hi={score_hi} lo={score_lo}")
# AGI-purity: the ledger text carries only generic directives, no game tokens
if any(tok in led.lower() for tok in ("egg", "case", "troll", "grue", "lantern", "mailbox")):
    fails.append("utility ledger leaked a game-specific token")

# --- 13. iter-5 MAR: multi-aspect reflection + NL critic + frontier curriculum --
# 13a. deficit -> lens mapping attacks the dimension that failed
if _aspect_for_deficit("reached-container-never-deposited") != "acquisition":
    fails.append("aspect_for_deficit: deposit deficit should map to acquisition lens")
if _aspect_for_deficit("looped-no-progress") != "spatial":
    fails.append("aspect_for_deficit: loop deficit should map to spatial lens")
# 13b. aspect prompt is single-lens, transcript-grounded, and seed-free
ap = _build_aspect_reflection_prompt("acquisition", 10, 80,
                                     "container seen; valuable acquired; stalled 9 turns",
                                     "... carried the item but never used it ...")
if "ONE lens only" not in ap:
    fails.append("aspect prompt is not single-lens")
if "assume any objective the run does not evidence" not in ap:
    fails.append("aspect prompt missing the no-hallucinated-objective guard")
for tok in ("egg", "troll", "grue", "mailbox", "lantern"):
    if tok in ap.lower():
        fails.append(f"aspect prompt leaked game token {tok!r}")
# 13c. deterministic NL critic: keep actionable+bindable, drop vague/restatement
if not _critic_accepts("deposit the carried valuable into the container to score"):
    fails.append("critic wrongly rejected an actionable bindable lesson")
if _critic_accepts("things went poorly this run"):
    fails.append("critic wrongly accepted a vague, directive-free lesson")
if _critic_accepts("ok"):
    fails.append("critic wrongly accepted a too-short lesson")
_facts = "container seen; valuable acquired; stalled 9 turns"
if _critic_accepts(_facts, _facts):
    fails.append("critic wrongly accepted a bare restatement of the run facts")
# 13d. instruction-following critic parser is fail-closed
if _parse_critic_verdict("ACCEPT — actionable and supported") is not True:
    fails.append("critic parser missed an explicit ACCEPT")
if _parse_critic_verdict("REJECT — too vague") is not False:
    fails.append("critic parser missed an explicit REJECT")
if _parse_critic_verdict("") is not False:
    fails.append("critic parser must fail closed on empty")
# 13e. frontier record round-trips and newest-wins selection works
fr = _format_frontier(12, 35, "reached-container-never-deposited")
prt = _parse_frontier(fr)
if prt["__ep__"] != 12 or prt["best"] != 35.0 or prt["deficit"] != "reached-container-never-deposited":
    fails.append(f"frontier round-trip failed: {prt}")
newest_fr = _newest_frontier([
    _format_frontier(2, 10, "looped-no-progress"),
    _format_frontier(8, 35, "reached-container-never-deposited"),  # newest + highest
    _format_frontier(1, 0, "general-stall"),
])
if newest_fr["__ep__"] != 8 or newest_fr["best"] != 35.0:
    fails.append(f"newest_frontier picked the wrong record: {newest_fr}")
# 13f. failure-frontier curriculum anchors the conjecturer to the persistent wall
pref = _frontier_target_prefix({"__ep__": 8, "best": 35.0,
                                "deficit": "reached-container-never-deposited"}, 10)
if "best progress was score 35" not in pref or "reached-container-never-deposited" not in pref:
    fails.append(f"frontier_target_prefix did not anchor to the ceiling: {pref!r}")
# no frontier yet (ep -1 / best 0) -> empty prefix, conjecturer falls back to the run
if _frontier_target_prefix({"__ep__": -1, "best": 0.0, "deficit": "general-stall"}, 0) != "":
    fails.append("frontier_target_prefix should be empty before any positive frontier")

# --- 14. K-DECOUPLE FIX: SGS conjecturer survives an empty trajectory summary -----
# The bench (2026-06-16) showed the summarizer returns empty under heavy load, which
# gated off iter-6. The deterministic fallback target must be non-empty, name the
# deficit, carry the progress facts, and stay seed-free.
fb = _sgs_fallback_target("reached-container-never-deposited", 10,
                          "a storage container was seen; a valuable was acquired; stalled 9 turns")
if "reached-container-never-deposited" not in fb:
    fails.append("sgs_fallback_target dropped the deficit class")
if "stalled 9 turns" not in fb:
    fails.append("sgs_fallback_target dropped the progress facts")
if _sgs_fallback_target("", 0, "no container; no valuable") == "":
    fails.append("sgs_fallback_target must never be empty (that is the whole point)")
for tok in ("egg", "troll", "grue", "mailbox", "lantern", "case"):
    if tok in fb.lower():
        fails.append(f"sgs_fallback_target leaked a game token {tok!r}")
# the fallback target must yield a Guide-acceptable sub-goal (the end-to-end path the
# live :7424 check exercises; here we assert the deterministic Guide end of it)
if _gss2(fb, "deposit the acquired item into the container") < 4.0:
    fails.append("a sensible sub-goal is rejected against the fallback target")

# --- 15. SGS Guide faithfulness to arXiv:2604.20209 §E.2/§E.3 --------------------
from terransoul_brain_bridge import _parse_guide_score as _pgs  # noqa: E402
# the exact paper formula R_guide = max(0, rel + (2-comp) + (1-red))
if _pgs("relevance: 4\ncomplexity: 1\nredundancy: 0") != 4 + (2 - 1) + (1 - 0):
    fails.append("parse_guide_score does not match the paper R_guide formula")
# paper's auto-zero rule: complexity >= 3 -> 0
if _pgs("relevance: 5\ncomplexity: 3\nredundancy: 0") != 0.0:
    fails.append("parse_guide_score did not apply the complexity>=3 auto-zero")
# NEW: a non-judgment (no score lines) must return None so the caller falls back —
# this is the bug that made brain_summarize score everything 3.0
if _pgs("The user wants to evaluate a sub-goal toward depositing an item.") is not None:
    fails.append("parse_guide_score must return None when no scores are emitted")
# deterministic Guide: a 3+ chained-clause compound sub-goal auto-zeroes (degenerate)
if _gss2("acquire a valuable", "go north and take the egg and open the case and read it") != 0.0:
    fails.append("deterministic Guide did not auto-zero a 3+ joiner compound sub-goal")
# and a clean single-clause sub-goal clears the keep threshold
if _gss2("deposit the valuable into the container to score",
         "deposit the valuable into the container") < 4.0:
    fails.append("deterministic Guide rejected a clean relevant single-clause sub-goal")

if fails:
    print("FAIL:")
    for f in fails:
        print("  -", f)
    sys.exit(1)

print(
    "PASS: failure-mode reflection asks Reflexion's missing-step question, "
    "injects runtime progress facts (plateau flags the deposit-completion gap; "
    "null flags no-container/no-valuable), and contains NO game-specific tokens. "
    "Generic + seed-free."
)
sys.exit(0)
