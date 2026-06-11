# Multi-Agent Orchestration Analysis (2026-05)

> Status: research synthesis for TerranSoul backend, system design, and UI/UX
> direction. This is not an adoption of any one external stack.

## Scope

This analysis studies a public self-hosted multi-agent dashboard project plus
the broader agent/workflow ecosystem current through May 2026. The work follows
the reverse-engineering rule: check DeepWiki first when available, cross-check
with upstream public source/docs, compare against TerranSoul's source of truth,
credit every source in `CREDITS.md`, and persist durable lessons into MCP seed
data.

The goal is to improve TerranSoul's own local-first workflow system without
copying code, prompts, branding, database layouts, or UI identity from another
project.

## Executive Verdict

**Verdict: partial-adopt.** TerranSoul should adopt the system patterns that
make multi-agent work observable and reliable, but it should not import a
Next.js/Node dashboard stack, a hosted workflow service, or an always-cloud
agent runtime.

TerranSoul already has the hard local-first substrate: Rust/Tauri command
boundaries, a workflow plan model, a DAG runner, durable event logs, resilience
helpers, a persistent coding task queue, provider policy state, MCP surfaces,
and LAN brain sharing. The missing layer is the live operational model: named
sub-agent lineage, runtime status, cancellation, joins, budget/quality gates,
and a UI that makes delegation understandable at a glance.

## Reference Architecture Findings

The studied dashboard project is useful because it treats multi-agent work as a
product surface, not just an SDK example. The strongest patterns are:

| Area | Observed pattern | TerranSoul takeaway |
|---|---|---|
| Orchestration model | The orchestrator is a regular agent with sub-agent ids, dedicated orchestrated sessions, depth limits, cancellation, cleanup, and lineage. | Model sub-agents as durable children of a workflow/session, not as anonymous async tasks. |
| Tool policy | Tools are assembled per session and gated by capability policy. | Build tool bundles at run start from provider policy, MCP permissions, and plan role. |
| Swarm execution | Parallel sub-agent runtime supports bounded concurrency, snapshots, and join policies. | Add a small native swarm pool on top of `dag_runner`, with explicit `all`, `any`, `quorum`, and `best` joins. |
| Task queue | Tasks have backlog/queued/running/completed/failed/archived states, retries, stalled recovery, dead-letter, quality gates, and budget deferral. | Extend the existing SQLite task queue before adding another scheduler. |
| Memory | Memory combines keyword, vector, graph, scope filters, temporal scoring, and summarization. | Reuse TerranSoul memory/RAG rather than creating a separate agent memory store. |
| UI/UX | Dense dashboard: side rail, boards, chatrooms, delegation bubbles, run graphs, task repair views, and tool-call inspection. | Make the first screen a workbench for active runs and peers, not a marketing page. |

## Framework Survey

The public ecosystem points in a consistent direction:

| Framework family | Strong lesson for TerranSoul |
|---|---|
| Stateful graph runtimes | Durable execution, human-in-the-loop, streaming, checkpoints, and resume/cancel are table stakes for long-running agents. |
| Role-based crews | Separate role prompts and model choices from workflow control flow. TerranSoul's YAML plans already match this direction. |
| Event-driven agent runtimes | Treat agent messages, tool calls, approvals, and state transitions as events that can be replayed or inspected. |
| Enterprise plugin kernels | Function/tool middleware, filters, and telemetry should wrap every tool invocation. |
| Agent SDKs with tracing | Traces, sessions, guardrails, human approval, MCP, and sandbox boundaries should be first-class. |
| Type-safe agent libraries | Use typed inputs/outputs and dependency injection rather than ad-hoc JSON blobs. |
| Workflow studios | Visual graph status, suspend/resume, time travel, and active-run restart are important UI affordances. |

The common lesson is that reliable multi-agent systems are not mainly about
more agents. They are about state, permissions, observability, and bounded
handoffs.

## TerranSoul Baseline

TerranSoul already has enough infrastructure to build this natively:

| Existing module | Current capability |
|---|---|
| `src-tauri/src/coding/multi_agent.rs` | YAML workflow plans, role model, recurrence, validation, and role-specific LLM overrides. |
| `src-tauri/src/coding/dag_runner.rs` | Kahn-style dependency validation/execution and bounded parallel layers. |
| `src-tauri/src/coding/task_queue.rs` | Persistent SQLite priority/retry queue. |
| `src-tauri/src/workflows/engine.rs` | Durable SQLite workflow event log. |
| `src-tauri/src/workflows/resilience.rs` | Retry, timeout, circuit breaker, and heartbeat watchdog primitives. |
| `src-tauri/src/coding/engine.rs` | Self-improve planner/coder/reviewer/apply/test/stage gate with snapshots and validation. |
| `src-tauri/src/coding/gate_telemetry.rs` | Gate telemetry history and metrics. |
| `src/stores/workflow-plans.ts` | Plan CRUD, validation, calendar projection, and recommendations. |
| `src/stores/agent-roster.ts` | Agent profiles, active agent, RAM caps, and one-time handoff context. |
| `src-tauri/src/ai_integrations/mcp/` | Brain MCP exposure for external tools and coding assistants. |
| `src-tauri/src/network/lan_share.rs` | LAN discovery and remote MCP brain query flow. |

This means the next step is an integration pass, not a rewrite.

## Adoption Plan

1. **Run lineage table.** Add a durable workflow-run table that records
   `run_id`, parent run, agent role, model, status, start/end times, tool
   bundle hash, cancellation flag, and final verdict. Link it to existing
   workflow plan ids and self-improve sessions.
2. **Sub-agent event stream.** Emit typed events for spawned, prompt-built,
   tool-called, waiting-for-approval, completed, failed, cancelled, and joined.
   Store them in the existing workflow event log and mirror them to the UI.
3. **Session tool bundles.** Build tools per session from capability policy,
   provider policy, plan role, MCP transport caps, and approval requirements.
   Cache a bundle fingerprint so the UI can show exactly what each agent was
   allowed to do.
4. **Swarm pool.** Layer a small Rust runtime over `dag_runner` for bounded
   parallel jobs with join policies. Keep default concurrency conservative and
   memory-aware.
5. **Queue hardening.** Extend the SQLite task queue with dead-letter state,
   stalled-task recovery, quality-gate records, and budget deferral before
   creating another scheduler.
6. **Trace and eval hooks.** Every LLM call, tool call, approval, retry, and
   gate result should have a trace id that can be inspected from the UI and MCP.
7. **Workbench UI.** Add a dense run board with agent lanes, task cards, a run
   graph, tool/delegation bubbles in transcripts, and repair controls for
   failed or dead-lettered tasks.

## UI/UX Direction

The right TerranSoul UI is a compact operations surface:

- A left rail for active runs, queued tasks, LAN brains, and agent profiles.
- A run graph that shows parent/child sub-agents and status without requiring
  the user to read logs.
- Task boards for backlog, queued, running, blocked, review, failed, and done.
- Transcript bubbles that distinguish normal chat, delegation, tool calls,
  approvals, validation output, and final verdicts.
- A repair view that lets the user retry, reassign, downgrade model, change
  tool permissions, or archive a failed task.
- Peer brain panels for LAN MCP search, with token status and source host shown
  clearly so company sharing stays auditable.

Avoid turning the workflow surface into a landing page. Users opening this area
need to answer: what is running, who is doing it, what can it touch, what is
blocked, and what changed?

## What To Avoid

- Do not adopt a separate Node/Next runtime for core orchestration. Keep the
  runtime in Rust/Tauri and expose it to Vue through Tauri commands/events.
- Do not create a second memory system for agents. Use TerranSoul memory/RAG,
  cognitive kinds, graph edges, and MCP context packs.
- Do not let autonomous agents run unbounded loops. Every run needs depth,
  concurrency, token, time, and capability limits.
- Do not broadcast MCP bearer tokens on LAN. Discovery can advertise presence;
  authentication stays out of band.
- Do not name TerranSoul commands, docs, milestones, or UI after the studied
  projects. Keep references and attribution in research docs and `CREDITS.md`.

## QA Strategy

Multi-agent orchestration is a reliability feature, so test coverage should be
broader than a UI smoke test:

- Pure Rust tests for lineage graph invariants, join policies, cancellation,
  stalled recovery, dead-letter promotion, and tool-bundle hashing.
- SQLite migration tests for new run/task tables and event replay.
- Vitest coverage for run board grouping, agent lanes, repair actions, and LAN
  peer status rendering.
- Integration tests with a fake provider and fake tools that exercise a full
  planner -> worker -> review -> test -> verdict run.
- MCP tests proving remote tools can observe but not silently widen capability
  scopes.
- Windows validation for the manifest/loader path because the MCP/headless
  runner and Rust test harness share native dependencies.
