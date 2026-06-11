"""ZorkGPT × TerranSoul brain bench — Python entry point.

Invoked from benchmark/scripts/zork-bench/run.mjs via:
    uv run python run_bench.py --arm <arm> --episodes <n> ...

Imports ZorkGPT's ZorkOrchestratorV2 from the cloned source, swaps its
Memory + Knowledge managers according to --arm, then runs N episodes
and writes per-turn JSONL transcripts + per-arm summary JSON.

See benchmark/terransoul/zorkgpt/README.md for the full design.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

# This file is copied into the ZorkGPT clone by setup.mjs, so sibling imports work.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from terransoul_brain_bridge import (  # noqa: E402
    BrainKnowledgeManager,
    BrainMemoryManager,
    McpClient,
    NullKnowledgeManager,
    NullMemoryManager,
    ZorkHarness,
)

# Resolve TerranSoul repo root (4 levels up: zorkgpt-src → target-copilot-bench → repo)
TS_REPO_ROOT = HERE.parent.parent  # target-copilot-bench/zorkgpt-src → target-copilot-bench → REPO


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--arm", required=True, choices=["none", "zorkgpt-default", "terransoul-brain"])
    p.add_argument("--episodes", type=int, default=3)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--mcp-port", type=int, default=7423)
    p.add_argument("--mcp-host", default="127.0.0.1", help="MCP host (use host.docker.internal in Docker)")
    p.add_argument("--clear-brain-each-episode", action="store_true")
    p.add_argument("--rom", default=None, help="Path to a Z-machine ROM (.z5/.z8)")
    p.add_argument("--max-turns", type=int, default=300, help="Per-episode turn cap")
    p.add_argument("--resume", action="store_true", help="Skip episodes that already have a completed JSONL with episode_end")
    return p.parse_args()


def count_completed_episodes(out_dir: Path, arm: str) -> int:
    """Count how many episodes for this arm already have a completed JSONL.

    An episode is complete if its JSONL file contains a line with
    '"type": "episode_end"'. Returns the count of completed episodes.
    """
    completed = 0
    for jsonl in sorted(out_dir.glob(f"zork_bench_{arm}_ep*_*.jsonl")):
        try:
            text = jsonl.read_text(encoding="utf-8")
            if '"type": "episode_end"' in text:
                completed += 1
        except Exception:
            pass
    return completed


def install_managers(orchestrator, arm: str, mcp_port: int, mcp_host: str = "127.0.0.1", session_id: str = "") -> dict:
    """Swap orchestrator's memory/knowledge managers per --arm.

    Returns a dict of bridge call accumulators so the runner can attribute
    MCP calls to specific turns.
    """
    if arm == "none":
        mem = NullMemoryManager()
        know = NullKnowledgeManager()
        orchestrator.simple_memory = mem
        orchestrator.knowledge_manager = know
        return {"memory": mem, "knowledge": know}
    if arm == "zorkgpt-default":
        # Upstream managers already wired by ZorkOrchestratorV2.__init__ — leave them alone.
        return {"memory": None, "knowledge": None}
    if arm == "terransoul-brain":
        mcp = McpClient(port=mcp_port, repo_root=TS_REPO_ROOT, host=mcp_host)
        mem = BrainMemoryManager(mcp=mcp, _session_id=session_id or "zork-bench-default")
        know = BrainKnowledgeManager(mcp=mcp)
        # Back-reference so memory manager can push high-signal events
        # into the on-disk knowledge file the agent's prompt reads.
        mem.knowledge_manager = know
        know.memory_manager = mem
        # Spec 004 SC1 — give the bridge a handle on the upstream agent
        # so high-signal rewrites can call agent.reload_knowledge_base()
        # and the LLM picks up wayfinding / object backlog / room
        # reflections mid-episode instead of only at episode start.
        if hasattr(orchestrator, "agent"):
            know._agent = orchestrator.agent
        orchestrator.simple_memory = mem
        orchestrator.knowledge_manager = know
        return {"memory": mem, "knowledge": know, "mcp": mcp}
    raise SystemExit(f"unknown arm: {arm}")


def attach_transcript(
    orchestrator,
    transcript_path: Path,
    knowledge_bridge=None,
    max_turns: int | None = None,
) -> None:
    """Wrap orchestrator.jericho_interface.start/send_command so every
    game observation is written verbatim to a plain-text transcript.

    Also feeds the latest observation into the knowledge bridge so
    `get_knowledge_for_context()` can retrieve relevant principles for
    the agent's *current* room — without this the brain's strategic
    knowledge is silently disabled.

    T12: clamp ``turn_box["n"]`` to ``max_turns`` once upstream emits an
    episode-end marker (``Episode completed`` / death / win banner). The
    progress watcher previously surfaced ``turns=N+1/N`` whenever the
    upstream loop sent one final command after hitting the cap.
    """
    iface = getattr(orchestrator, "jericho_interface", None)
    if iface is None:
        return
    orig_start = iface.start
    orig_send = iface.send_command
    turn_box = {"n": 0}
    # Spec 007 — tool-use / reasoning-gates harness sits between the
    # upstream agent's emitted command and Jericho. Sanitises markdown
    # blobs, rejects off-vocab verbs, breaks 2-cycle loops, and pipes
    # typed [HARNESS] notes back into the agent's reasoning history via
    # the on-disk knowledge file. Disabled cleanly when there is no
    # knowledge bridge (arm=none).
    harness = ZorkHarness()
    harness.knowledge_bridge = knowledge_bridge
    _END_MARKERS = (
        "Episode completed",
        "*** You have died ***",
        "*** You have won ***",
        "*** The game is over ***",
    )

    def write(line: str) -> None:
        try:
            with transcript_path.open("a", encoding="utf-8") as f:
                f.write(line)
        except Exception:
            pass

    def feed_observation(obs: str) -> None:
        if knowledge_bridge is not None and hasattr(knowledge_bridge, "set_current_observation"):
            try:
                knowledge_bridge.set_current_observation(obs)
            except Exception:
                pass

    def wrapped_start():
        if knowledge_bridge is not None and hasattr(knowledge_bridge, "reset_episode"):
            try:
                knowledge_bridge.reset_episode()
            except Exception:
                pass
        intro = orig_start()
        write(f"=== Episode start ===\n{intro}\n\n")
        feed_observation(intro)
        return intro

    def wrapped_send(cmd: str):
        turn_box["n"] += 1
        # Spec 007 — gate the command before Jericho sees it. The
        # harness uses the prior observation (set by feed_observation
        # below on the previous turn) to detect 2-cycle loops at the
        # same room.
        gated = harness.gate(cmd)
        observation = orig_send(gated)
        # T12: clamp once upstream emits an episode-end marker so the
        # progress watcher doesn't show turns=N+1/N at the very end.
        if max_turns is not None and observation and any(
            m in observation for m in _END_MARKERS
        ):
            turn_box["n"] = min(turn_box["n"], max_turns)
        n = turn_box["n"]
        # Transcript records BOTH the agent's raw output (for forensic
        # analysis of the LLM's discipline) and the gated command that
        # Jericho actually executed.
        if gated != (cmd or "").strip():
            write(f"--- Turn {n} ---\n> {gated}  ⟵ [HARNESS gated from: {cmd[:80].strip()}…]\n{observation}\n\n")
        else:
            write(f"--- Turn {n} ---\n> {cmd}\n{observation}\n\n")
        feed_observation(observation)
        # Update the harness's observation for the NEXT turn's room-key
        # derivation (its loop detector keys on prior room).
        harness.feed_observation(observation)
        return observation

    iface.start = wrapped_start
    iface.send_command = wrapped_send
    # Expose for run_one_episode so harness JSONL entries surface in
    # per-episode summary aggregations.
    orchestrator._ts_harness = harness  # type: ignore[attr-defined]


def run_one_episode(orchestrator, episode_id: str, arm: str, bridges: dict, out_path: Path, max_turns: int | None = None) -> dict:
    """Run a single ZorkGPT episode and stream per-turn JSONL.

    We rely on orchestrator.play_episode() being the unmodified upstream
    loop. We attach a turn callback by monkey-wrapping the orchestrator's
    after-turn hook if one exists; otherwise we just summarise at the end.
    """
    transcript_path = out_path.with_suffix(".transcript.txt")
    transcript_path.write_text(
        f"# ZorkGPT × TerranSoul bench transcript\n"
        f"# arm={arm}  episode={episode_id}\n\n",
        encoding="utf-8",
    )
    attach_transcript(
        orchestrator,
        transcript_path,
        knowledge_bridge=bridges.get("knowledge"),
        max_turns=max_turns,
    )

    start = time.monotonic()
    final_score = orchestrator.play_episode()
    elapsed = time.monotonic() - start

    state = getattr(orchestrator, "game_state", None)
    turns = getattr(state, "turn_count", 0) if state else 0

    # ---- Cross-episode self-improvement hook ----
    # The brain bridge reads the transcript we just wrote and ingests an
    # LLM-extracted reflection as a principle memory. Next episode's
    # brain_search retrieves it; this is the genuine self-improvement
    # signal (replaces the removed hardcoded waypoint curve).
    #
    # T1 / T2: reflect_on_episode now returns a dict with the trajectory
    # reflection flag, the room-scoped reflection count, the verification
    # probe hit count (SC2 hard gate), and per-room event counts (T6).
    reflection_diag: dict = {}
    kbridge = bridges.get("knowledge")
    if kbridge is not None and hasattr(kbridge, "reflect_on_episode"):
        try:
            transcript_text = transcript_path.read_text(encoding="utf-8")
        except Exception:
            transcript_text = ""
        try:
            ret = kbridge.reflect_on_episode(transcript_text, int(final_score or 0), int(turns or 0))
            # Backwards-compat: older bridge returned 0/1.
            if isinstance(ret, dict):
                reflection_diag = ret
            else:
                reflection_diag = {"top_reflection_ingested": int(ret or 0)}
        except Exception as e:
            print(f"⚠  reflect_on_episode failed: {e}")

    # Collect memory-call totals from bridges so we can report tokens/perf.
    mem_calls = []
    if isinstance(bridges.get("memory"), (BrainMemoryManager, NullMemoryManager)):
        mem_calls.extend(getattr(bridges["memory"], "calls", []))
    if isinstance(bridges.get("knowledge"), (BrainKnowledgeManager, NullKnowledgeManager)):
        mem_calls.extend(getattr(bridges["knowledge"], "calls", []))
    # Spec 007 — fold harness JSONL entries into the per-episode call log.
    harness = getattr(orchestrator, "_ts_harness", None)
    if harness is not None:
        mem_calls.extend(getattr(harness, "calls", []))

    # Aggregate operational diagnostics from the call log.
    kb_writes = sum(1 for c in mem_calls if c.get("tool") == "kb_write")
    kb_write_skips = sum(1 for c in mem_calls if c.get("tool") == "kb_write_skip")
    obj_llm_fallback_calls = sum(1 for c in mem_calls if c.get("tool") == "obj_llm_fallback")
    acquire_recipes = sum(1 for c in mem_calls if c.get("tool") == "acquire_recipe" and "obj" in c)
    room_search_hits = sum(
        c.get("hits", 0) for c in mem_calls
        if c.get("tool") == "brain_search" and c.get("kind") in ("judgment", "procedural") and "room" in c
    )
    # Spec 007 harness counters.
    harness_sanitise = sum(1 for c in mem_calls if c.get("tool") == "harness_sanitise")
    harness_verb_reject = sum(1 for c in mem_calls if c.get("tool") == "harness_verb_reject")
    harness_loop_break = sum(1 for c in mem_calls if c.get("tool") == "harness_loop_break")

    summary = {
        "arm": arm,
        "episode_id": episode_id,
        "final_score": final_score,
        "turns": turns,
        "elapsed_sec": round(elapsed, 1),
        "memory_calls_total": len(mem_calls),
        "memory_calls_with_errors": sum(1 for c in mem_calls if "error" in c),
        # T1/T2/T6: reflection + verification probe + per-room counts
        "reflections_ingested": int(reflection_diag.get("top_reflection_ingested", 0)),
        "room_reflections_ingested": int(reflection_diag.get("room_reflections_ingested", 0)),
        "reflections_retrievable": int(reflection_diag.get("reflections_retrievable", 0)),
        "room_event_counts": reflection_diag.get("room_event_counts", {}),
        # T5/T7/T8: operational diagnostics
        "kb_writes": kb_writes,
        "kb_write_skips": kb_write_skips,
        "obj_llm_fallback_calls": obj_llm_fallback_calls,
        "acquire_recipes_ingested": acquire_recipes,
        "room_scoped_search_hits": room_search_hits,
        # Spec 007 — harness diagnostics
        "harness_sanitise": harness_sanitise,
        "harness_verb_reject": harness_verb_reject,
        "harness_loop_break": harness_loop_break,
    }
    try:
        with transcript_path.open("a", encoding="utf-8") as f:
            f.write(
                f"\n=== Episode end ===\n"
                f"final_score={final_score}  turns={turns}  elapsed_sec={round(elapsed, 1)}\n"
            )
    except Exception:
        pass
    with out_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"type": "episode_end", **summary}) + "\n")
        for c in mem_calls:
            f.write(json.dumps({"type": "memory_call", **c}) + "\n")
    return summary


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Import ZorkGPT lazily so an `--arm none` smoke can fail fast on missing deps.
    try:
        from orchestration import ZorkOrchestratorV2  # type: ignore
    except Exception as e:  # pragma: no cover — env-dependent
        print(f"✗ cannot import ZorkOrchestratorV2 from cloned ZorkGPT: {e}")
        return 2

    # --resume: skip already-completed episodes so the bench can survive
    # container restarts and be resumed from where it left off.
    already_done = 0
    if args.resume:
        already_done = count_completed_episodes(out_dir, args.arm)
        if already_done >= args.episodes:
            print(f"✓ all {args.episodes} episodes already complete for arm={args.arm}, nothing to do.")
            return 0
        if already_done > 0:
            print(f"↻ resuming: {already_done}/{args.episodes} episodes already complete, starting at ep {already_done + 1}")

    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    arm_summary = {"arm": args.arm, "episodes": [], "started_at": timestamp}

    for ep_idx in range(already_done + 1, args.episodes + 1):
        ep_id = f"bench-{args.arm}-{timestamp}-ep{ep_idx}"
        out_path = out_dir / f"zork_bench_{args.arm}_ep{ep_idx}_{timestamp}.jsonl"
        print(f"\n--- {args.arm} episode {ep_idx}/{args.episodes} → {out_path.name} ---")

        # Construct orchestrator. ROM selection follows the config in .env.
        kwargs = {"episode_id": ep_id, "max_turns_per_episode": args.max_turns}
        try:
            orchestrator = ZorkOrchestratorV2(**kwargs)
        except Exception as e:
            print(f"✗ ZorkOrchestratorV2 init failed: {e}")
            return 3

        bridges = install_managers(orchestrator, args.arm, args.mcp_port, args.mcp_host, session_id=ep_id)

        try:
            ep_summary = run_one_episode(
                orchestrator,
                ep_id,
                args.arm,
                bridges,
                out_path,
                max_turns=args.max_turns,
            )
        except KeyboardInterrupt:
            print("\n🛑 Interrupted")
            return 130
        except Exception as e:
            print(f"✗ episode {ep_idx} failed: {e}")
            ep_summary = {"arm": args.arm, "episode_id": ep_id, "error": str(e)}

        # SC2 hard gate (T2): the reflection-retrieval probe must find
        # at least one hit for terransoul-brain runs. Print a loud
        # warning if it didn't — silent ingest is not enough.
        if args.arm == "terransoul-brain" and isinstance(ep_summary, dict):
            retr = ep_summary.get("reflections_retrievable", 0)
            if retr == 0 and not ep_summary.get("error"):
                print(
                    f"⚠  SC2 GATE: reflections_retrievable=0 for {ep_id} — "
                    "ingest may be silently failing, or tag/kind mismatch in probe."
                )

        arm_summary["episodes"].append(ep_summary)
        print(json.dumps(ep_summary, indent=2))

        if args.clear_brain_each_episode and args.arm == "terransoul-brain":
            # The brain is the data dir which is wiped between *arms* by run.mjs;
            # here we additionally request the brain to forget bench-tagged entries.
            mcp = bridges.get("mcp")
            if mcp is not None:
                try:
                    mcp.tool("brain_forget", {"tags": ["zork"]})
                    print("✓ cleared brain (zork-tagged) between episodes")
                except Exception as e:
                    print(f"⚠ could not clear brain between episodes: {e}")

    summary_path = out_dir / f"zork_bench_{args.arm}_summary_{timestamp}.json"
    summary_path.write_text(json.dumps(arm_summary, indent=2), encoding="utf-8")
    print(f"\n✓ wrote {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
