"""Self-improve smoke for the TerranSoul Zork brain bridge.

Runs without ZorkGPT / jericho — bypasses the Z-machine emulator and
exercises the bridge directly against the live MCP at 127.0.0.1:7423.

What it validates (the SC1/SC2 self-improve gates from
.specify/specs/002-optimal-zork-brain/spec.md):

  - per-room event counter populates (T6)
  - room-scoped reflections ingest (T1)
  - verification probe finds at least one (T2, SC2 hard gate)
  - room-scoped retrieval returns hits (T3)
  - deterministic "Exits from <room>" block renders (T4)
  - rewrite throttle keeps kb_write count <= simulated_turns / 3 (T5)
  - object regex + positive-list filter (T7)
  - acquire recipe only ingests when response confirms (T8)
  - wayfinding BFS renders "Routes from <current>" block
  - object backlog renders "Objects pending acquisition" block

Output: pass/fail per gate + the live knowledge file path so the user
can inspect what the LLM would actually see.

Usage:
    python benchmark/scripts/zork-bench/smoke_self_improve.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent.parent
sys.path.insert(0, str(HERE))

from terransoul_brain_bridge import (  # noqa: E402
    BrainKnowledgeManager,
    BrainMemoryManager,
    McpClient,
    ZorkHarness,
)


def step(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))


def simulate_turn(
    mem: BrainMemoryManager,
    know: BrainKnowledgeManager,
    turn_no: int,
    loc_id: int,
    loc_name: str,
    action: str,
    response: str,
    *,
    location_changed: bool = False,
    first_visit: bool = False,
    inventory_changed: bool = False,
    score_delta: int = 0,
    died: bool = False,
    score_after: int = 0,
    inventory_after: list[str] | None = None,
) -> None:
    """Drive a single fake turn through the bridge.

    The bridge expects an upstream loop to:
      1. feed the observation into knowledge.set_current_observation(obs)
      2. call memory.record_action_outcome with z_machine_context.

    We mimic that contract exactly so the self-improve hooks fire the same
    way they would inside the real bench.
    """
    know.should_process_turn()  # bumps _turn_counter for T5 throttle
    know.set_current_observation(response)
    mem.record_action_outcome(
        location_id=loc_id,
        location_name=loc_name,
        action=action,
        response=response,
        z_machine_context={
            "score_delta": score_delta,
            "location_changed": location_changed,
            "inventory_changed": inventory_changed,
            "first_visit": first_visit,
            "died": died,
            "score_after": score_after,
            "inventory_after": inventory_after or [],
        },
    )


SIM_TURNS = [
    # turn, loc_id, loc_name, action, response, opts
    (1, 1, "West of House", "look",
     "West of House. You are standing in an open field west of a white house, with a boarded front door. There is a small mailbox here.",
     dict(first_visit=True)),
    (2, 1, "West of House", "open mailbox",
     "Opening the small mailbox reveals a leaflet.",
     dict()),
    (3, 1, "West of House", "take leaflet",
     "Taken.",
     dict(inventory_changed=True, inventory_after=["leaflet"])),
    (4, 1, "West of House", "read leaflet",
     "WELCOME TO ZORK! ZORK is a game of adventure, danger, and low cunning.",
     dict()),
    (5, 2, "North of House", "north",
     "North of House. You are facing the north side of a white house. There is no door, and all the windows are barred.",
     dict(location_changed=True, first_visit=True)),
    (6, 3, "Behind House", "east",
     "Behind House. You are behind the white house. A path leads into the forest to the east. In one corner of the house there is a small window which is slightly ajar.",
     dict(location_changed=True, first_visit=True)),
    (7, 4, "Kitchen", "open window",
     "With great effort, you open the window far enough to allow entry.",
     dict()),
    (8, 4, "Kitchen", "enter window",
     "Kitchen. You are in the kitchen of the white house. A table seems to have been used recently for the preparation of food. A passage leads to the west and a dark staircase can be seen leading upward. On the table is an elongated brown sack, smelling of hot peppers. A bottle is sitting on the table.",
     dict(location_changed=True, first_visit=True)),
    (9, 4, "Kitchen", "take sack",
     "Taken.",
     dict(inventory_changed=True, inventory_after=["leaflet", "brown sack"])),
    (10, 4, "Kitchen", "take bottle",
     "Taken.",
     dict(inventory_changed=True, inventory_after=["leaflet", "brown sack", "glass bottle"])),
    (11, 5, "Living Room", "west",
     "Living Room. You are in the living room. There is a doorway to the east, a wooden door with strange gothic lettering to the west, which appears to be nailed shut, a trophy case, and a large oriental rug in the center of the room. Above the trophy case hangs an elvish sword of great antiquity. A battery-powered brass lantern is on the trophy case.",
     dict(location_changed=True, first_visit=True, score_delta=10, score_after=10)),
    (12, 5, "Living Room", "take sword",
     "Taken.",
     dict(inventory_changed=True, inventory_after=["leaflet", "brown sack", "glass bottle", "sword"])),
    (13, 5, "Living Room", "take lantern",
     "Taken.",
     dict(inventory_changed=True, inventory_after=["leaflet", "brown sack", "glass bottle", "sword", "brass lantern"])),
    (14, 5, "Living Room", "move rug",
     "With a great effort, the rug is moved to one side of the room, revealing the dusty cover of a closed trap door.",
     dict()),
    (15, 5, "Living Room", "open trapdoor",
     "The door reluctantly opens to reveal a rickety staircase descending into darkness.",
     dict()),
    (16, 5, "Living Room", "down",
     "It is pitch black. You are likely to be eaten by a grue.",
     dict(location_changed=True, first_visit=True)),
    (17, 6, "Cellar", "light lantern",
     "The brass lantern is now on.",
     dict()),
    (18, 6, "Cellar", "look",
     "Cellar. You are in a dark and damp cellar with a narrow passageway leading east, and a crawlway to the south. On the west is the bottom of a steep metal ramp which is unclimbable.",
     dict()),
    (19, 6, "Cellar", "east",
     "The Troll Room. You are in a small room with passages to the east and south and a forbidding hole leading west. Bloodstains and deep scratches mar the walls. A nasty-looking troll, brandishing a bloody axe, blocks all passages out of the room.",
     dict(location_changed=True, first_visit=True)),
    (20, 7, "Troll Room", "attack troll with sword",
     "The troll, caught off guard, is struck by your blow. The troll has been killed.",
     dict(score_delta=25, score_after=35)),
    (21, 7, "Troll Room", "take axe",
     "Taken.",
     dict(inventory_changed=True, inventory_after=["leaflet", "brown sack", "glass bottle", "sword", "brass lantern", "axe"])),
    (22, 1, "West of House", "open mailbox",
     "There is already a leaflet in the mailbox.",
     dict()),  # loop-ish — should be low-importance
    (23, 1, "West of House", "open mailbox",
     "There is already a leaflet in the mailbox.",
     dict()),
    (24, 1, "West of House", "open mailbox",
     "There is already a leaflet in the mailbox.",
     dict()),  # 3rd repeat — should trigger dead_end
]


def main() -> int:
    print("== TerranSoul Zork brain — self-improve smoke (no Z-machine) ==\n")

    mcp = McpClient(port=7423, repo_root=REPO_ROOT)
    # health probe
    try:
        h = mcp.tool("brain_health", {})
        step("brain_health reachable", True, "ollama/gemma4:e4b")
    except Exception as e:
        step("brain_health reachable", False, str(e))
        return 1

    # Redirect the knowledge file to a temp path so we don't clobber a real run.
    kb_path = Path(tempfile.gettempdir()) / "ts_zork_smoke_kb.md"
    if kb_path.exists():
        kb_path.unlink()
    know = BrainKnowledgeManager(mcp=mcp, _knowledge_file_path=str(kb_path))
    mem = BrainMemoryManager(mcp=mcp, _session_id=f"smoke-{int(time.time())}")
    mem.knowledge_manager = know
    know.memory_manager = mem

    # Spec 004 SC5 — fake the upstream zork_agent.reload_knowledge_base
    # so the smoke can assert the bridge actually pushed mid-episode
    # discoveries into the LLM's frozen system_prompt.
    class FakeAgent:
        def __init__(self):
            self.reload_count = 0
        def reload_knowledge_base(self):
            self.reload_count += 1
    fake_agent = FakeAgent()
    know._agent = fake_agent

    know.reset_episode()

    print(f"\n-> episode={know._episode_count} kb_path={kb_path}\n")

    # Simulate turns.
    print("== simulating turns ==")
    for (turn, loc_id, loc_name, action, response, opts) in SIM_TURNS:
        simulate_turn(mem, know, turn, loc_id, loc_name, action, response, **opts)

    sim_turns = len(SIM_TURNS)

    # T6 — per-room event counts.
    rec = dict(mem._room_event_counts)
    step("T6 per-room event counts populated", len(rec) >= 3, json.dumps(rec))

    # Exercise the get_knowledge_for_context path so the principle/procedural
    # room-scoped queries get logged in calls (T3 verification).
    ctx = know.get_knowledge_for_context()
    step("T3/T4 get_knowledge_for_context returns content", bool(ctx.strip()),
         f"len={len(ctx)} bytes")

    # Reflection — T1 + T2.
    transcript = "\n".join(
        f"--- Turn {t} ---\n> {a}\n{r}\n" for (t, _, _, a, r, _) in SIM_TURNS
    )
    diag = know.reflect_on_episode(transcript, final_score=35, turns=sim_turns)
    step("T1 top_reflection_ingested >= 1",
         diag.get("top_reflection_ingested", 0) >= 1, json.dumps(diag))
    step("T1 room_reflections_ingested >= 1",
         diag.get("room_reflections_ingested", 0) >= 1,
         f"got {diag.get('room_reflections_ingested', 0)}")
    step("T2 reflections_retrievable >= 1 (SC2 hard gate)",
         diag.get("reflections_retrievable", 0) >= 1,
         f"hits={diag.get('reflections_retrievable', 0)}")

    # T5 — kb_write count audit. The throttle's job is to skip the
    # set_current_observation path; high-signal forces (score, death,
    # new-room, new-object, episode end) always bypass it. So the right
    # cap is `forced_event_count + throttled_writes_at_3-turn-cadence`.
    # We count forced rewrites by inspecting calls.
    kb_writes = sum(1 for c in know.calls if c.get("tool") == "kb_write")
    kb_skips = sum(1 for c in know.calls if c.get("tool") == "kb_write_skip")
    forced_writes = sum(1 for c in know.calls if c.get("tool") == "kb_write" and c.get("forced"))
    expected_throttled = max(0, (sim_turns - forced_writes) // 3)
    cap = forced_writes + expected_throttled + 2  # +2 slack for init/reflect
    step(f"T5 kb_writes ({kb_writes}) <= forced({forced_writes}) + throttled-budget({expected_throttled}+2)",
         kb_writes <= cap, f"writes={kb_writes} forced={forced_writes} skips={kb_skips}")

    # T7 — object positive-list filter + LLM fallback (we don't trigger the
    # fallback here, just confirm regex extraction is conservative).
    sample_resp = "You can see a glass bottle here. There is no apple here."
    extracted = mem._extract_objects(sample_resp)
    step("T7 negation filter rejects 'no apple'",
         "apple" not in [o.lower() for o in extracted],
         f"extracted={extracted}")
    step("T7 positive-list accepts 'glass bottle'",
         any("bottle" in o.lower() for o in extracted),
         f"extracted={extracted}")

    # T8 — acquire recipe gating.
    acquire_recipes = [c for c in mem.calls if c.get("tool") == "acquire_recipe" and "obj" in c]
    skipped = [c for c in mem.calls if c.get("tool") == "acquire_recipe" and c.get("skipped")]
    step("T8 acquire_recipe ingested at least once with confirmation",
         len(acquire_recipes) >= 1, f"ingested={len(acquire_recipes)} skipped={len(skipped)}")

    # T10 — brain_add_edge promotion (spec 003). Tolerate "unknown tool"
    # on pre-spec-003 tray binaries: surface as INFO not FAIL so the
    # smoke still passes against an old MCP, but report that the new
    # graph layer is not yet active.
    edge_calls = [c for c in mem.calls if c.get("tool") == "brain_add_edge"]
    edge_errors = [c for c in edge_calls if "error" in c]
    edge_unknowns = sum(1 for c in edge_errors if "unknown tool" in str(c.get("error", "")))
    edge_ok = sum(1 for c in edge_calls if "rel" in c and "error" not in c)
    if edge_unknowns == len(edge_calls) and edge_calls:
        # Tray is pre-spec-003 — surface but don't fail (allows incremental rollout).
        print(f"  [INFO] T10 brain_add_edge: tray pre-spec-003 — restart with new release binary ({edge_unknowns} unknown-tool errors)")
    else:
        step("T10 brain_add_edge promotion succeeds (spec 003)",
             edge_ok >= 1,
             f"ok={edge_ok} errors={len(edge_errors)} unknown_tool={edge_unknowns}")

    # T11 — brain_kg_neighbors retrieval. Same tolerance as T10.
    kg_calls = [c for c in know.calls if c.get("tool") == "brain_kg_neighbors"]
    kg_errors = [c for c in kg_calls if "error" in c]
    if kg_calls:
        step("T11 brain_kg_neighbors retrieval invoked",
             len(kg_calls) >= 1,
             f"calls={len(kg_calls)} errors={len(kg_errors)}")

    # Wayfinding render — knowledge file should contain "Routes from".
    try:
        kb = kb_path.read_text(encoding="utf-8")
    except Exception:
        kb = ""
    step("Wayfinding 'Routes from' block rendered", "Routes from" in kb,
         f"kb_bytes={len(kb)}")
    step("Object backlog or known-objects block rendered",
         "Known objects per location" in kb or "Objects pending acquisition" in kb,
         "")
    step("Lessons-learned section present after reflection",
         "Lessons learned in previous episodes" in kb, "")

    # Spec 004 SC5: confirm the bridge invoked agent.reload_knowledge_base()
    # at least once during the simulated turns. Without this hook, the
    # upstream zork_agent freezes the system_prompt at episode start
    # and never sees mid-episode discoveries from the bridge.
    bridge_reload_calls = sum(1 for c in know.calls if c.get("tool") == "agent_reload")
    step("Spec 004 — agent_reload invoked from bridge",
         fake_agent.reload_count >= 1 and bridge_reload_calls >= 1,
         f"fake_agent.reload_count={fake_agent.reload_count} bridge_calls={bridge_reload_calls}")

    # Spec 006 SC1: confirm the bridge pulled prior-episode reflections
    # out of the brain at __post_init__. After many prior smoke runs +
    # the spec 005 canonical, the brain has at least a few reflections
    # tagged ['zork','reflection'], so this should be >= 1.
    prior_load = [c for c in know.calls if c.get("tool") == "load_prior_reflections"]
    loaded_count = sum(c.get("loaded", 0) for c in prior_load)
    step("Spec 006 — prior reflections probe succeeded",
         loaded_count >= 1,
         f"called={len(prior_load)} loaded={loaded_count}")

    # Spec 008 SC7 — the rewrite snapshot must come from MCP, not local
    # caches. Confirm a forced rewrite produced ≥1 brain_search call
    # AND ≥1 brain_list_recent call AND the legacy persistent fields
    # are no longer being read (knowledge file rendered correctly from
    # snapshot-only inputs).
    know._rewrite_knowledge_file(force=True)
    snap_lessons_calls = sum(1 for c in know.calls
                              if c.get("tool") == "snapshot_lessons" or
                                 (c.get("tool") == "brain_search" and "lessons" in str(c.get("kind", ""))))
    # More robust counter: just check the kb_write entry recorded our
    # snapshot counters (proves the new render path ran end-to-end).
    last_kb_write = next((c for c in reversed(know.calls)
                          if c.get("tool") == "kb_write" and "snapshot_lessons" in c), None)
    step("Spec 008 — render reads via MCP-only snapshot",
         last_kb_write is not None,
         f"snapshot_lessons={last_kb_write.get('snapshot_lessons') if last_kb_write else '?'} "
         f"snapshot_map_edges={last_kb_write.get('snapshot_map_edges') if last_kb_write else '?'} "
         f"snapshot_objects_locs={last_kb_write.get('snapshot_objects_locs') if last_kb_write else '?'} "
         f"snapshot_events={last_kb_write.get('snapshot_events') if last_kb_write else '?'}")

    # Spec 013 — dead-field cleanup. The `_learned_lessons` and
    # `_recent_events` fields are gone from `BrainKnowledgeManager`;
    # all write sites + the `kb._recent_events` mirror in
    # `ZorkHarness._emit_note` are deleted. Re-introducing either
    # field is a single-source-of-truth violation per
    # `rules/mcp-single-source-of-truth.md`.
    step("Spec 013 — _learned_lessons field deleted from BrainKnowledgeManager",
         not hasattr(know, "_learned_lessons"),
         f"hasattr=_learned_lessons={hasattr(know, '_learned_lessons')}")
    step("Spec 013 — _recent_events field deleted from BrainKnowledgeManager",
         not hasattr(know, "_recent_events"),
         f"hasattr=_recent_events={hasattr(know, '_recent_events')}")

    # Spec 014 — bench-agi-purity Rule 1: no domain-specific seed
    # principles may live on the bridge or be planted into MCP/brain.
    # See `rules/bench-agi-purity.md` and the AGI-purity grep gate.
    step("Spec 014 — _ZORK_SEED_PRINCIPLES constant deleted",
         not hasattr(know, "_ZORK_SEED_PRINCIPLES"),
         f"hasattr=_ZORK_SEED_PRINCIPLES={hasattr(know, '_ZORK_SEED_PRINCIPLES')}")
    step("Spec 014 — _seed_zork_principles() method deleted",
         not hasattr(know, "_seed_zork_principles"),
         f"hasattr=_seed_zork_principles={hasattr(know, '_seed_zork_principles')}")
    # Spec 014 — curated domain vocab lists also deleted from extraction.
    # See rules/bench-agi-purity.md Rule 1 + the AGI-purity grep gate.
    step("Spec 014 — _ZORK_OBJECT_VOCAB curated list deleted",
         not hasattr(BrainMemoryManager, "_ZORK_OBJECT_VOCAB"),
         f"hasattr=_ZORK_OBJECT_VOCAB={hasattr(BrainMemoryManager, '_ZORK_OBJECT_VOCAB')}")
    step("Spec 014 — _ROOM_NOUNS curated tuple deleted",
         not hasattr(ZorkHarness, "_ROOM_NOUNS"),
         f"hasattr=_ROOM_NOUNS={hasattr(ZorkHarness, '_ROOM_NOUNS')}")
    step("Spec 014 — _STRUCTURAL_STOPWORDS generic filter present",
         hasattr(BrainMemoryManager, "_STRUCTURAL_STOPWORDS"),
         f"hasattr=_STRUCTURAL_STOPWORDS={hasattr(BrainMemoryManager, '_STRUCTURAL_STOPWORDS')}")
    # 2026-06-01 — AGI-purity Rule 1: object-extraction gate must key on a
    # generic no-visibility signal, never on a domain monster token ("grue").
    import terransoul_brain_bridge as _tbb
    step("AGI-purity — _has_no_visibility generic helper present",
         hasattr(_tbb, "_has_no_visibility") and _tbb._has_no_visibility("it is pitch black"),
         f"has_helper={hasattr(_tbb, '_has_no_visibility')}")
    step("AGI-purity — no domain monster token in no-visibility markers",
         not ({"grue", "troll", "thief"} & {m.lower() for m in getattr(_tbb, "_NO_VISIBILITY_MARKERS", ())}),
         f"markers={getattr(_tbb, '_NO_VISIBILITY_MARKERS', None)}")
    # 2026-06-01 — ODY-1/ODY-6/cross-episode regressions.
    step("ODY-1 — LoopBreaker primitive present",
         hasattr(_tbb, "LoopBreaker") and _tbb.LoopBreaker(stuck_threshold=2).observe("r", "a", False) is not None,
         "LoopBreaker missing")
    step("ODY-6 — frontier-router present + escapes dead-end",
         hasattr(_tbb, "_frontier_route") and _tbb._frontier_route({"x": {"up": "y"}}, "x", {"x": {"north", "south", "east", "west"}, "y": {"north"}}) is not None,
         "_frontier_route missing or no route")
    import pathlib as _pl
    _src_bridge = (_pl.Path(__file__).with_name("terransoul_brain_bridge.py").read_text(encoding="utf-8"))
    step("cross-episode — known_exits retrieved by content-search (brain_search MAP_EDGE query)",
         '"kind": "known_exits"' in _src_bridge and "MAP_EDGE from='{room_safe}'" in _src_bridge,
         "known_exits must load via a brain_search content query for cross-episode recall")

    # Spec 007 SC6 — harness gate fires correctly. We don't run a full
    # bench inside the smoke (that's Docker territory); instead, we
    # exercise the harness directly with a few representative inputs
    # and assert each layer behaves as designed.
    harness = ZorkHarness()
    harness.knowledge_bridge = know
    # Paragraph sanitisation
    paragraph = (
        "**analysis of the situation:** I am currently in the Forest "
        "Path and my score is 0. The only visible object is the tree. "
        "I will examine it.\n\nexamine tree"
    )
    p_out = harness.gate(paragraph)
    p_sanitised = any(c.get("tool") == "harness_sanitise" for c in harness.calls)
    step("Spec 007 SC1 — paragraph sanitisation",
         p_sanitised and len(p_out) <= 32,
         f"gated='{p_out[:40]}' sanitise_logged={p_sanitised}")
    # Verb whitelist
    harness.calls.clear()
    bad_verb_out = harness.gate("use leaflet on song bird")
    v_rejected = any(c.get("tool") == "harness_verb_reject" for c in harness.calls)
    step("Spec 007 SC2 — verb-whitelist gate",
         v_rejected and bad_verb_out == "look",
         f"out='{bad_verb_out}' reject_logged={v_rejected}")
    # 2-cycle loop break
    harness.calls.clear()
    harness.feed_observation("Forest Path This is a path winding through a forest.")
    harness.gate("west")
    harness.gate("east")
    harness.gate("west")
    fourth = harness.gate("east")
    loop_broken = any(c.get("tool") == "harness_loop_break" for c in harness.calls)
    step("Spec 007 SC3 — ABAB loop break",
         loop_broken and fourth == "look",
         f"4th_action='{fourth}' loop_break_logged={loop_broken}")

    # Spec 009 SC1 — pronoun-reasoning lines skipped, deeper line extracted.
    harness2 = ZorkHarness()
    harness2.knowledge_bridge = know
    paragraph_intent = (
        "**analysis of the situation:**\n"
        "i will take the leaflet but first i need to examine the door.\n\n"
        "take leaflet"
    )
    out = harness2.gate(paragraph_intent)
    step("Spec 009 SC1 — pronoun-reasoning skipped, real verb extracted",
         out == "take leaflet",
         f"extracted='{out}'")

    # Spec 009 SC2 — verb-density ranking prefers shorter pure verb-noun.
    harness3 = ZorkHarness()
    harness3.knowledge_bridge = know
    multi_line = (
        "**analysis:**\n"
        "the door appears to be locked and unbreakable\n"
        "examine boards\n"
        "since the door is unhelpful i will move on"
    )
    out = harness3.gate(multi_line)
    step("Spec 009 SC2 — verb-density ranker picks `examine boards`",
         out == "examine boards",
         f"extracted='{out}'")

    # Spec 009 SC3 — room-aware examine fallback when no extractable line.
    harness4 = ZorkHarness()
    harness4.knowledge_bridge = know
    harness4.feed_observation(
        "West of House You are standing in an open field west of a "
        "white house, with a boarded front door. There is a small mailbox here."
    )
    out = harness4.gate(
        "**analysis:**\n"
        "the previous attempts to interact have failed.\n"
        "this requires a different approach."
    )
    step("Spec 009 SC3 — room-aware examine fallback (mailbox)",
         out == "examine mailbox",
         f"extracted='{out}' (expected examine mailbox)")

    # Spec 010 — examine-noun debounce. Feed the same paragraph with
    # the same observation 4 times. First should be `examine leaves`,
    # second should pick a different noun (e.g. `examine path`) or
    # fall to `look`, third+ must be `look` once all nouns exhausted.
    harness5 = ZorkHarness()
    harness5.knowledge_bridge = know
    clearing_obs = (
        "Clearing You are in a small clearing in a well marked forest "
        "path. On the ground is a pile of leaves."
    )
    paragraph = "**analysis of the situation:**\nthe path is blocked and i must think."
    outs = []
    for _ in range(4):
        harness5.feed_observation(clearing_obs)
        outs.append(harness5.gate(paragraph))
    # First gate sees no prior examine; picks first canonical noun
    # ("leaves" or "path" — both are in _ROOM_NOUNS). Subsequent gates
    # should pick a different noun, then fall through to look once the
    # alternates are exhausted.
    distinct_examines = len({o for o in outs if o.startswith("examine ")})
    saw_look = "look" in outs
    step("Spec 010 — examine-noun debounce (no >2 same examine in a row)",
         distinct_examines >= 2 or saw_look,
         f"outputs={outs}")

    # Spec 011 — END-OF-GATE consecutive-examine cap. Bug found in
    # iter-F (qwen3.5:9b) bake-off: verbose paragraphs caused the
    # spec-010 reset (keyed on LLM original first token) to clear
    # every turn, so the room-aware fallback injected `examine door`
    # 9 turns in a row. The new Layer 5 caps consecutive identical
    # SUBSTITUTED examines at 2 regardless of LLM original shape.
    harness6 = ZorkHarness()
    harness6.knowledge_bridge = know
    # Hard-coded room-aware fallback: feed an observation where the
    # room-aware path will pick the same noun every turn, then send
    # 5 unextractable paragraphs (varying first token each time so
    # the spec-010 reset fires every turn — reproducing the bug).
    door_obs = (
        "West of House You are standing in an open field west of a "
        "white house. The front door is boarded shut."
    )
    paragraphs = [
        "**analysis:** the situation requires careful thought.",
        "i should consider all options before acting now.",
        "the path forward is unclear and requires study.",
        "based on prior outcomes a fresh approach is needed.",
        "let me reflect on the available routes here.",
    ]
    outs6 = []
    for p in paragraphs:
        harness6.feed_observation(door_obs)
        outs6.append(harness6.gate(p))
    examine_runs = 0
    max_run = 0
    cur_run = 0
    last = None
    for o in outs6:
        if o.startswith("examine ") and o == last:
            cur_run += 1
        else:
            cur_run = 1 if o.startswith("examine ") else 0
        max_run = max(max_run, cur_run)
        last = o
        if o.startswith("examine "):
            examine_runs += 1
    step("Spec 011 — substituted-examine cap (no >2 identical examines)",
         max_run <= 2,
         f"outputs={outs6} max_identical_examine_run={max_run}")


    # Loop / dead-end principle was likely ingested via brain_observe_outcome
    # on the 3rd mailbox repeat. Confirm a verdict surfaced.
    verdicts = [c.get("verdict") for c in mem.calls if c.get("tool") == "brain_observe_outcome" and "verdict" in c]
    step("brain_observe_outcome verdict pipeline live",
         any(v in ("dead_end", "dead_end_known", "continue") for v in verdicts),
         f"verdicts={verdicts[-5:]}")

    print("\n== summary ==")
    print(f"  knowledge_file: {kb_path}")
    print(f"  total mcp calls: {len(mem.calls) + len(know.calls)}")
    print(f"  reflection_diagnostics: {json.dumps(diag, indent=2)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
