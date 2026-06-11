# Coding Workflow — Design & Comparative Study

> **Audience.** Contributors and integrators who want to understand
> *what* a "coding workflow" is in TerranSoul, *how* it is implemented
> today, and *why* it is shaped the way it is when compared to other
> agentic-coding systems on the market.
>
> **Status.** Living document. Last reviewed **2026-05-05**.
>
> **Related rules.** [`rules/coding-workflow-reliability.md`](../rules/coding-workflow-reliability.md),
> [`rules/prompting-rules.md`](../rules/prompting-rules.md),
> [`rules/architecture-rules.md`](../rules/architecture-rules.md).

---

## 1. What "coding workflow" means in TerranSoul

A **coding workflow** is the deterministic, reusable pipeline that turns
a *coding task* — described in plain English, optionally accompanied by
documents — into a *structured reply* from an LLM, persists every step
to disk, and surfaces the result to either:

- the **self-improve engine** (autonomous loop reading
  [`rules/milestones.md`](../rules/milestones.md), planning the next
  chunk, and recording outcomes), or
- a **caller** (chat path, future agent, MCP client) via the
  `run_coding_task` Tauri command.

The workflow is intentionally **provider-agnostic** (Local Ollama,
Anthropic, OpenAI, any OpenAI-compatible endpoint),
**output-shape-typed** (`NumberedPlan`, `StrictJson`, `BareFileContents`,
`Prose`), and **durable** (atomic JSON writes, append-only JSONL run log,
crash-safe resume).

It is **one entry point** for every "ask an LLM to do something coding-shaped"
operation in the app: [`coding::workflow::run_coding_task`](../src-tauri/src/coding/workflow.rs).

---

## 2. Design at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│                           UI (Vue 3)                             │
│  BrainView · CodingWorkflowConfigPanel · Self-Improve panel      │
└─────────────────────────────┬────────────────────────────────────┘
                              │ Tauri IPC (invoke / emit)
┌─────────────────────────────▼────────────────────────────────────┐
│  commands/coding.rs   ←─ public Tauri command surface            │
│  • get/set/reset coding_workflow_config                          │
│  • preview_coding_workflow_context                               │
│  • list_local_coding_models                                      │
│  • start/stop_self_improve · get_self_improve_metrics            │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│                    coding/  (Rust subsystem)                     │
│                                                                  │
│  workflow.rs      run_coding_task() — single entry point         │
│    │   load_workflow_context() — rules/instructions/docs         │
│    │   build CodingPrompt → OpenAiMessage[]                      │
│    │   client.chat() → raw_reply                                 │
│    │   extract_tag()   → payload + well_formed                   │
│    ▼                                                             │
│  prompting.rs     XML-tag prompt builder (10 Anthropic rules)    │
│  client.rs        OpenAI-compatible HTTP client wrapper          │
│  engine.rs        Self-improve autonomous loop                   │
│  metrics.rs       Append-only JSONL run log + summary            │
│  milestones.rs    Parse rules/milestones.md → ChunkRow[]         │
│  repo.rs          Git repo detection, branch state               │
│  git_ops.rs       pull_main(), branch helpers                    │
│  github.rs        Optional PR creation                           │
│  mod.rs           Configs + atomic_write_json helper             │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 The four core types

| Type | File | Role |
|---|---|---|
| [`CodingTask`](../src-tauri/src/coding/workflow.rs) | `workflow.rs` | Caller-supplied description + output contract + optional repo root |
| [`CodingTaskResult`](../src-tauri/src/coding/workflow.rs) | `workflow.rs` | `raw_reply`, extracted `payload`, `well_formed`, `context_doc_count` |
| [`CodingLlmConfig`](../src-tauri/src/coding/mod.rs) | `mod.rs` | Provider, model, base URL, API key (persisted as JSON) |
| [`CodingWorkflowConfig`](../src-tauri/src/coding/mod.rs) | `mod.rs` | Caps + include/exclude paths for context loading (user-tunable) |

### 2.2 The output-shape contract

Every coding workflow declares its [`OutputShape`](../src-tauri/src/coding/prompting.rs)
*before* calling the model. The prompt builder embeds the contract in a
`<output_contract>` tag, prefills `<analysis>` to skip preamble, and the
extractor pulls the typed payload out of the matching closing tag:

| Shape | Tag | Use case |
|---|---|---|
| `NumberedPlan { max_steps }` | `<plan>` | Planner cycles, refactor blueprints |
| `StrictJson { schema_description }` | `<json>` | Tool calls, structured updates |
| `BareFileContents` | `<file>` | "Write me this file verbatim" |
| `Prose` | _(none)_ | Free-form (smoke tests, ad-hoc) |

When the model fails to close the tag, `well_formed = false` is recorded
on the result so callers can either retry, fall back, or surface the
raw reply for debugging — never silently ship malformed output.

### 2.3 The Anthropic-style XML prompt

[`CodingPrompt::build()`](../src-tauri/src/coding/prompting.rs)
applies ten prompt-engineering rules uniformly:

1. **XML tags for structure** — never markdown headings.
2. **Job-description role** — skills + tools + priorities.
3. **Think before answering** — `<analysis>` precedes the output tag.
4. **Few-shot examples include reasoning**, not just I/O pairs.
5. **Negative constraints** — `<dont>` lines say what not to do.
6. **Assistant prefill** — pre-writes `<analysis>` to skip "I'd be happy to…".
7. **Exact output shape** — declared in `<output_contract>`.
8. **Indexed `<document>` blocks** for every supplied snippet.
9. **`<on_error>` lines** for graceful degradation.
10. **Versioned schema** — `PROMPT_SCHEMA_VERSION = "v1"` is shipped in every prompt.

The single source of truth for these rules is [`rules/prompting-rules.md`](../rules/prompting-rules.md).

### 2.4 Reliability contracts

Every persisted artefact in the workflow obeys
[`rules/coding-workflow-reliability.md`](../rules/coding-workflow-reliability.md):

- **Atomic config writes** via `coding::atomic_write_json` (temp file →
  `flush` → `sync_all` → `rename` → cleanup-on-failure). Guarantees no
  half-written `coding_llm_config.json`, `self_improve.json`, or
  `coding_workflow_config.json`, even on `SIGKILL`.
- **Append-only JSONL run log** (`self_improve_runs.jsonl`) for the
  metrics layer — single `write_all` per row; partial writes lose at
  most the in-flight row, never corrupt history.
- **Cancellation flag** (`AtomicBool`) — flipping `enabled=false` in the
  UI is the *only* way to stop the self-improve loop, by design.
- **Resume on launch** — `enabled=true` causes the engine to auto-spawn
  on next app start; the loop reads `milestones.md` fresh each cycle.
- **Bounded prompt size** — `MAX_CONTEXT_CHARS` and `MAX_FILE_CHARS`
  caps in `CodingWorkflowConfig` prevent runaway token usage on huge
  repos.
- **Path-scoped context** — Markdown rules/docs can declare `applyTo`
   frontmatter, and `CodingTask.target_paths` filters scoped files so large
   repos do not inject unrelated guidance into every prompt.

### 2.5 The self-improve loop lifecycle

```
1. User toggles self-improve on (warning dialog confirms).
2. Engine spawns Tokio task (start() in engine.rs).
3. Each cycle:
     a. Detect repo → RepoState (root, branch, clean?)
     b. Read rules/milestones.md → ChunkRow[]
     c. Pick first not-started chunk → planner_prompt(repo, chunk, cfg)
     d. metrics.record_start(chunk_id, …)
     e. client.chat(messages) → raw_reply
     f. extract <plan> tag → plan_text
     g. metrics.record_outcome(success | failure, plan_chars, error?)
     h. emit ProgressEvent { phase, message, progress, level }
4. On failure: backoff, surface error in metrics, continue to next cycle.
5. On all chunks complete: idle (IDLE_SLEEP_SECS) until milestones.md changes.
6. On disable or app quit: cancel flag set, task joins gracefully.
```

Early versions produced **plans only**. The current guarded path runs a
Planner -> Coder -> Reviewer -> Apply -> Tester -> Stage chain through the
DAG runner, using file snapshots, temporary worktree isolation when needed,
test gates, and explicit staging only after validation succeeds.

### 2.6 Multi-provider abstraction

All providers speak **OpenAI-compatible chat completions** (`/v1/chat/completions`).
This is the single pivot that lets us add Claude, OpenAI,
Ollama, vLLM, LM Studio, Groq, Together, Fireworks, Mistral, etc. by
adding a row to `coding_llm_recommendations()` — no new client code.

`OpenAiClient::completions_url()` is tolerant of `/v1`-suffixed base
URLs (a common foot-gun) and `client_from()` skips bearer auth when
`api_key` is empty (so Local Ollama works with no configuration).

The recommendation catalogue is intentionally small and opinionated:
**Local Ollama is the single top pick** — free, private, offline.
Cloud providers are listed but never auto-selected.

---

## 3. Comparative study

> Last verified **2026-04-29** against public docs and recent posts.

### 3.1 Comparator landscape (what we benchmarked against)

| System | Category | What it is |
|---|---|---|
| **[Temporal.io](https://docs.temporal.io/workflows)** | Durable workflow engine | General-purpose orchestration; deterministic replay; *not* AI-specific |
| **[GitHub Copilot CLI / coding agent](https://github.blog/ai-and-ml/github-copilot/)** | Agentic IDE/CLI assistant | `/fleet` parallel agents, model picker, GitHub-native PR flow |
| **[Claude Code](https://code.claude.com/docs/en/overview)** | Terminal coding agent | Anthropic-first; long-running sessions; tool-use; subagents |
| **Cursor** | Agentic IDE | Project rules, codebase indexing, review/checkpoint flow, context surfacing |
| **Aider** | Terminal pair-programmer | Diff-based edits; git-aware; multi-provider |
| **Cline** (open source) | VS Code extension | Plan-then-act with file/terminal tools; multi-provider |
| **[Roo Code](https://docs.roocode.com/)** | VS Code extension + Cloud | Customisable Modes (Architect/Code), Orchestrator, "trade tokens for quality" — **sunset May 15, 2026** |
| **OpenHands** (formerly OpenDevin) | Autonomous dev agent | Sandboxed execution, planner+executor, multi-provider |
| **GitHub Copilot Workspace** | Cloud-hosted agent | Spec → plan → diff → PR, GitHub-integrated |
| **TerranSoul (this project)** | Embedded desktop companion | Brain + persona + RPG quests; coding workflow is one capability of many |

### 3.2 Architectural philosophy

| Property | Temporal | Copilot CLI / agent | Claude Code | Cursor | Aider / Cline | Roo Code | OpenHands | **TerranSoul** |
|---|---|---|---|---|---|---|---|---|
| **Primary purpose** | Generic durable workflows | Coding assistant | Coding agent | Agentic IDE | Pair-programming | Coding suite | Autonomous SWE | Companion app — coding is *one* capability |
| **Single entry point** | Workflow Definition | Many (chat, fleet, agent) | Many tools | IDE agent + composer | Single CLI | Per-Mode | Multi-agent | **`run_coding_task`** |
| **Runtime substrate** | Temporal cluster (server + workers) | GitHub cloud + CLI | Local terminal | Editor process + cloud/local model routing | Local CLI | VS Code + cloud | Sandboxed Docker | Embedded Tauri/Rust process |
| **Provider model** | N/A (not LLM-specific) | Multi-model picker | Anthropic-first | Multi-model picker | Multi-provider | Multi-provider | Multi-provider | **OpenAI-compat only** (covers all majors via one client) |
| **Local-first** | ❌ requires server | ❌ cloud-bound | ⚠️ requires Anthropic API | ⚠️ depends on model | ✅ | ⚠️ | ✅ | ✅ **Ollama is top-pick by default** |
| **Privacy default** | N/A | Sends to GitHub | Sends to Anthropic | Sends to selected model/provider | Sends to chosen provider | Sends to chosen provider | Configurable | **No data leaves the machine when Ollama is used** |
| **Persistence model** | Event-sourced log | Cloud session | Conversation + memory files | Rules, memories, checkpoints | Git commits | Cloud project | Local state | **Atomic JSON configs + append-only JSONL runs** |
| **Resume after crash** | ✅ deterministic replay | ✅ cloud session | ⚠️ session file | ⚠️ editor/session dependent | ⚠️ partial | ✅ cloud | ⚠️ | ✅ **`enabled=true` → auto-resume on next launch** |
| **Cancellation contract** | `WorkflowCancelled` signal | UI / Ctrl-C | UI | Stop/checkpoint revert | Ctrl-C | UI | UI | **AtomicBool flag, only `enabled=false` stops it** |
| **Output typing** | User-defined | Free text + tool calls | Free text + tools | Tool calls + edits | Diffs | Free text | Free text + tools | **Typed `OutputShape` enum (Plan/JSON/File/Prose)** |
| **Prompt engineering** | N/A | Internal | Anthropic best practices | Project rules + context index | Prompt-light | Mode-based | Internal | **Anthropic 10 rules, codified in `prompting.rs`** |
| **Multi-agent** | Activities + child workflows | `/fleet` parallel agents | Subagents | Background/agent tasks | ❌ | Orchestrator → Modes | Planner+Executor | **Future** (orchestrator already in core, not yet wired to coding) |
| **Open source** | ✅ Apache-2.0 | ❌ proprietary | ❌ proprietary | ❌ proprietary | ✅ Apache-2.0 | ⚠️ partial (sunsetting) | ✅ MIT | ✅ MIT |
| **Cost model** | Self-host or Temporal Cloud | Subscription + tokens | Tokens | Subscription + tokens | Tokens | Tokens (premium) | Tokens | **$0 with local Ollama** |

### 3.3 Durability — Temporal vs. TerranSoul

Temporal is the gold standard for **durable execution**: workflows are
expressed as deterministic code that replays from an event history, so
a worker crash never loses state. We don't aim for that level of
generality — we aim for *enough* durability that an autonomous coding
loop survives a Windows reboot without corrupting its config.

| Property | Temporal | TerranSoul |
|---|---|---|
| Deterministic replay | ✅ | ❌ (LLMs are non-deterministic — replay is meaningless) |
| Crash-safe state | ✅ via event log | ✅ via atomic-write configs + append-only JSONL |
| Resume on restart | ✅ | ✅ (engine respawns when `enabled=true`) |
| Long-running (years) | ✅ | ✅ (the toggle is the only stop signal) |
| Backpressure / queues | ✅ | ⚠️ (single-threaded planner today; queue is roadmap) |
| Distributed workers | ✅ | ❌ (single desktop process, by design) |

**Why we don't use Temporal.** It would force every TerranSoul user to
run a Temporal cluster. Our durability surface is small enough
(three JSON files + one JSONL log) that hand-rolled atomic writes are
the right tradeoff.

### 3.4 Prompt engineering — Claude Code vs. TerranSoul

Both apply Anthropic's prompt-engineering principles, but Claude Code
embeds them inside a closed Anthropic-tuned harness, while we
**externalise** them into versioned, testable Rust code:

```rust
// src-tauri/src/coding/prompting.rs
pub const PROMPT_SCHEMA_VERSION: &str = "v1";

pub struct CodingPrompt {
    pub role: String,                       // rule 2
    pub task: String,
    pub negative_constraints: Vec<String>,  // rule 5  → <dont>
    pub documents: Vec<DocSnippet>,         // rule 8  → <document index="N">
    pub output: OutputShape,                // rule 7  → <output_contract>
    pub example: Option<String>,            // rule 4
    pub assistant_prefill: Option<String>,  // rule 6
    pub error_handling: Vec<String>,        // rule 9  → <on_error>
}
```

This buys us three things Claude Code can't:

1. **Provider-agnostic.** The same prompt works against Claude, GPT-5,
   Gemma, Qwen Coder — the schema is in our code, not the model's
   training.
2. **Unit-testable.** `prompting.rs` ships with tests asserting tag
   structure, schema version, and document indexing.
3. **Versioned.** Bumping `PROMPT_SCHEMA_VERSION` is a code change
   reviewed in PR; we never ship a "silent prompt rev".

### 3.5 Multi-agent — Roo Code / Copilot `/fleet` vs. TerranSoul

Roo Code's "Orchestrator → Modes" and Copilot's `/fleet` both run
multiple agents in parallel and coordinate them. Today TerranSoul runs
**one** agent (the self-improve planner) but the underlying
infrastructure already supports multi-agent:

- `crate::orchestrator::*` exists for chat-side agent routing with
   capability gates.
- The brain gateway (`ai_integrations/gateway.rs`) exposes 8 brain
  operations any future sub-agent can call.
- `coding::workflow::run_coding_task` is reentrant — N parallel
  Tokio tasks calling it will not corrupt each other (no shared state
  beyond the read-only configs).
- `coding::dag_runner` now has both sync and async executors; the
   self-improve engine uses the async path to run its planner, coder,
   reviewer, apply, tester, and staging nodes in dependency order.

Chunk 28.12 wires that orchestration into the coding workflow so cycles
dispatch a **Planner → Coder → Reviewer → Apply → Tester → Stage** chain
similar to Roo's Modes, but running entirely on the user's machine.

### 3.6 Cursor + Claude Code lessons absorbed in 28.11

Cursor's strongest workflow pattern is not a particular model call; it is the
IDE loop around the model: keep project rules close to the code, surface the
relevant indexed context, make edits reviewable, and preserve a checkpoint the
user or agent can roll back to. Claude Code adds a second useful pattern:
specialized workers with restricted capability, especially read-only reviewers,
test runners, and subagents that keep verbose output out of the main context.

Chunk 28.11 turns those lessons into local, provider-agnostic Rust code:

- **Rules and context first:** the planner and coder both load the same
   `rules/`, `instructions/`, and `docs/` context through
   `load_workflow_context`, mirroring Cursor project rules and Claude
   `CLAUDE.md` memory without adopting either proprietary file format.
   Chunk 28.14 adds `applyTo` frontmatter and target-path filtering so scoped
   rules/docs only enter prompts for matching files.
- **Checkpoint before write:** the execution gate snapshots every touched file
   before applying LLM output. If validation, review, or tests fail, the snapshot
   is restored and created files are removed.
- **Specialized gates:** the coder can only emit `<file path="...">` blocks;
   `reviewer` evaluates a preview diff before disk writes; `test_runner` runs the
   local green gate after writes and before staging.
- **No auto-approve drift:** generated changes are staged only after review and
   tests pass. Dirty working trees now run autonomous apply/test in a temporary
   git worktree; the user's checkout stays untouched and a review patch is saved
   under `target/terransoul-self-improve/patches`.

### 3.7 What we deliberately did **not** copy

| Pattern | Where it appears | Why we skipped it |
|---|---|---|
| Cloud-bound execution | Copilot, Roo Cloud, Claude Code | Breaks "your AI lives on your machine" promise |
| Sandbox containers | OpenHands | Tauri desktop app — host OS *is* the sandbox; Docker is overkill |
| Diff-based-only output | Aider | We need plans, JSON, *and* files — `OutputShape` covers all |
| Per-task subscription | Most cloud agents | $0 with Ollama is non-negotiable for the user base |
| Custom workflow language | Temporal DSL, GitHub Agentic Workflows | Plain Rust async functions are enough at our scale |
| "Auto-approve everything" | Roo Auto-Approve | Self-improve is gated behind a confirm dialog + explicit toggle |

### 3.8 Sessions, chat history, and slash commands (Chunk 30.2)

Chunk 30.2 absorbs the session-management UX from
[ultraworkers/claw-code](https://github.com/ultraworkers/claw-code), Anthropic's
Claude Code CLI (`--resume`, `--continue`, `--name`, `--fork-session`,
`/clear`, `/help`), and OpenClaw. The pattern lands as three thin layers on
top of the existing `coding::handoff_store`:

- **`coding::session_chat`** — append-only JSONL transcript per session id,
  stored at `<data_dir>/coding_workflow/sessions/<id>.chat.jsonl`. Pure I/O
  helpers (`append_message`, `load_chat`, `clear_chat`, `chat_summary`,
  `fork_chat`) with a 32 KiB per-message cap and silent skipping of corrupt
  lines. Reuses the same id sanitiser as `handoff_store` so a single
  session id maps deterministically to both files.
- **`commands::coding_sessions`** — Tauri commands (`coding_session_list`,
  `coding_session_append_message`, `coding_session_load_chat`,
  `coding_session_clear_chat`, `coding_session_rename`, `coding_session_fork`,
  `coding_session_purge`) wired through `lib.rs`. The list command joins the
  existing `HandoffSummary` with a cheap `ChatSummary` so the sidebar renders
  in one round trip.
- **`SelfImproveSessionsPanel.vue` + `slash-commands.ts`** — sidebar with
  per-session pick / rename / fork / delete, a transcript scrollback, and an
  input bar that parses `/clear`, `/rename <name>`, `/fork [<name>]`,
  `/resume <id>`, `/list`, `/help` exactly like the Claude Code interactive
  shell. Plain prose falls through as a `user` message appended to the
  active session's transcript.

Chunk 30.6 wires the autonomous loop's `self-improve-progress` event stream
into the active session transcript. Each progress payload is appended as a
`system` message with `kind = "run"`; if no session is selected yet, the store
creates a timestamped `self-improve-*` run session and begins recording there.
The session picker also includes transcript-only sessions, so progress history
from a live run remains resumable even before a handoff snapshot exists.

### 3.9 Multi-agent workflow plans + calendar (Chunk 30.3)

Building on §3.8's session/slash-command surface, **Chunk 30.3** adds
first-class **multi-agent workflow plans** with Microsoft Teams-style
recurrence. The system formalises the orchestrator-workers pattern from
Anthropic's *Building Effective Agents* into editable YAML plans.

**Six built-in agent roles** (`AgentRole` enum in
`src-tauri/src/coding/multi_agent.rs`): `Planner`, `Coder`, `Reviewer`,
`Tester`, `Researcher`, `Orchestrator`. Each role has a curated list of
`AgentRecommendation`s spanning three tiers (`fast` / `balanced` /
`premium`). Recommendations are surfaced through
`workflow_agent_recommendations` so the UI's per-step LLM dropdown shows
live, RAM-aware options grouped by tier.

**Plan = DAG of steps**. `WorkflowPlan` carries an ordered `Vec<WorkflowStep>`,
each with `id`, `agent`, `description`, `depends_on: Vec<String>`,
`output_format` (prose/code/json/plan/test_results/verdict),
`requires_approval`, and per-step `llm_provider`/`llm_model`. The runner
uses **Kahn's topological sort** (`validate_plan`) to detect cycles and
schedule independent leaves in parallel via Tokio. YAML is the
persistence format (`<data_dir>/workflow_plans/<id>.yaml`,
`serde_yaml` 0.9), so every plan is `git diff`-able and shareable via
Persona Pack.

**Recurrence engine.** `WorkflowSchedule` carries a
`RecurrencePattern` (Once / Daily{interval} / Weekly{interval, weekdays} /
Monthly{interval, day_of_month}) plus `start_at`, optional `end_at`,
`duration_minutes`, IANA `timezone`, and `last_fired_at`.
`next_occurrence_after(from_ms)` returns the next firing strictly after
a timestamp; `occurrences_in_range(from_ms, to_ms)` projects up to 100
events per plan into the calendar viewport (cap prevents pathological
recurrences from blocking the UI). The Tauri command
`workflow_calendar_events` aggregates projections across all plans.

**UI tier.** `MultiAgentWorkflowsPanel.vue` exposes three tabs:
*Workflows* (list + editor), *Calendar* (7-day × 24-hour MS Teams-style
grid coloured by `kind`), and *Agents* (recommendation browser).
`WorkflowCalendar.vue` renders events as absolutely-positioned blocks
sized by duration; `ScheduleEditor.vue` is the recurrence picker with
live preview text mirroring the `formatRecurrence()` helper. The Pinia
store `workflow-plans.ts` mirrors all Rust types one-to-one and exposes
helpers (`startOfWeek`, `isoDayKey`, `formatRecurrence`,
`statusBadgeColor`, etc.) covered by 13 vitest cases.

**Self-improve integration.** Chat suggestions can call
`workflow_plan_create_blank` to stub a coding-kind plan; running the
single Planner step through a chosen LLM expands the DAG via
`parse_planner_response()` (strips markdown fences). The
`requires_approval` flag combined with the Reviewer step at the end of
typical plans implements the **evaluator-optimiser loop** — failed
reviews send the plan back to Coder with feedback in the step's `error`
field. Failures land in brain memory as `coding-failures` so future
Planners avoid repeated mistakes via RAG.

**MCP exposure.** All ten `workflow_plan_*` commands are reachable via
the brain MCP server on `127.0.0.1:7421`, so external coding assistants
(Claude Code, Aider) can build and observe workflows programmatically.

See [multi-agent-workflows-tutorial.md](../tutorials/multi-agent-workflows-tutorial.md)
for end-to-end usage including a self-improve worked example.

### 3.10 2026 multi-agent orchestration research

The 2026-05 reverse-engineering pass compared a public self-hosted
multi-agent dashboard with the broader agent workflow ecosystem: stateful graph
runtimes, role-based crews, event-driven agent runtimes, enterprise plugin
kernels, typed agent SDKs, and workflow studios. The conclusion is
**partial-adopt**: TerranSoul should absorb the reliability and observability
patterns while keeping the runtime local-first in Rust/Tauri.

The most important lessons are:

- Treat sub-agents as durable children of a workflow/session, with lineage,
   cancellation, depth limits, model identity, tool-bundle identity, and final
   verdicts.
- Assemble tools per session from capability policy, provider policy, MCP
   transport caps, plan role, and approval requirements.
- Add bounded swarm execution with explicit join policies (`all`, `any`,
   `quorum`, `best`) on top of the existing DAG runner rather than introducing a
   second orchestration engine.
- Extend the SQLite task queue with dead-letter state, stalled-task recovery,
   quality-gate rows, and budget deferral before adding another scheduler.
- Make the UI an operations workbench: active runs, agent lanes, task cards,
   delegation/tool bubbles, run graphs, and repair controls.

See [multi-agent-orchestration-analysis-2026.md](multi-agent-orchestration-analysis-2026.md)
for the full backend, system-design, UI/UX, and QA plan.

---

## 4. Best practices applied (mapped to current code)

| Best practice | Where it lives in TerranSoul |
|---|---|
| **Single entry point per capability** | `workflow::run_coding_task` |
| **Typed output contracts** | `OutputShape` enum + `<output_contract>` tag |
| **XML-structured prompts** | `CodingPrompt::build()` |
| **Versioned prompt schema** | `PROMPT_SCHEMA_VERSION` constant |
| **Atomic config writes** | `coding::atomic_write_json` |
| **Append-only run log** | `MetricsLog` (JSONL) |
| **Bounded context** | `CodingWorkflowConfig.max_context_chars / max_file_chars` |
| **Provider abstraction** | OpenAI-compat client + recommendation catalogue |
| **Local-first default** | Local Ollama is the single `is_top_pick: true` |
| **Cancellation as truth** | `AtomicBool` cancel flag; only `enabled=false` stops it |
| **Auto-resume after crash** | Engine respawns at app launch when `enabled=true` |
| **Observability** | Per-run start/outcome rows; aggregate `MetricsSummary` |
| **Recommendation hygiene** | Test asserts no recommendation has `/v1` suffix in `base_url` |
| **No-key auth path** | `client_from()` skips bearer when `api_key` is empty |
| **Live verification** | `tests/ollama_self_improve_smoke.rs` (gated by `OLLAMA_REAL_TEST=1`) |
| **Checkpointed execution gate** | `engine::execute_chunk_dag` snapshots files, reviews a preview diff, applies, tests, restores on failure, and stages only green changes |
| **DAG-orchestrated coding gate** | `dag_runner::execute_dag_async` plus `engine::execute_chunk_dag` run planner/coder/reviewer/apply/test/stage nodes with capability validation and skip-on-failure semantics |
| **Temporary worktree isolation** | `coding::worktree` plus `engine::prepare_execution_workspace` run dirty-checkout autonomous apply/test in a detached git worktree and save an isolated patch artifact |
| **Path-scoped workflow context** | `workflow::load_workflow_context_for_paths` filters `applyTo`-scoped markdown docs/rules by `CodingTask.target_paths`; self-improve coder prompts derive target hints from the approved plan |

---

## 5. Roadmap & future implementations

The autonomous loop now has a conservative execution path: it plans,
asks the Coding LLM for complete file blocks, reviews a preview diff,
applies from a file snapshot, runs the local test gate, restores on
failure, and stages only green changes. The roadmap, in priority order:

1. **Diff application gate.** ✅ **Chunk 28.11 shipped (2026-05-02):**
   `src-tauri/src/coding/engine.rs` wires the planner output into a coder
   prompt that emits complete `<file path="...">` blocks, reviews a
   synthetic full-file diff with `coding::reviewer`, applies via
   `coding::apply_file`, runs `coding::test_runner`, restores the file
   snapshot on failure, and stages changed files only after a green gate.
2. **Reviewer sub-agent.** ✅ **Chunk 28.1 shipped (2026-04-30):**
   `src-tauri/src/coding/reviewer.rs` — pure types + prompt builders +
   JSON parser + `decide()` verdict logic. 18 tests. Uses
   `OutputShape::StrictJson` with schema `{ ok: bool, issues: [{ severity, file, line, msg }] }`.
   Wiring into the orchestrator (so it actually gates `apply_file`
   commits) is a follow-up (28.2).
3. **Orchestrator wiring.** ✅ **Chunk 28.2 shipped (2026-04-30):**
   `src-tauri/src/orchestrator/coding_router.rs` — intent detection +
   capability-aware routing for chat-driven coding tasks. 18 tests.
4. **Multi-agent fan-out.** ✅ **Chunk 28.3 shipped (2026-04-30):**
   `src-tauri/src/coding/dag_runner.rs` — Kahn's-algorithm topological
   layering, parallel within layers, sequential across layers, cycle
   detection. 21 tests.
   ✅ **Chunk 28.12 shipped (2026-05-02):** added the async DAG executor
   and wired `coding::engine` through a real planner/coder/reviewer/apply/
   tester/stage graph with bounded layer parallelism, capability validation,
   and downstream skip-on-failure behavior.
5. **Sandboxed test runs.** ✅ **Chunk 28.4 shipped (2026-04-30):**
   `src-tauri/src/coding/test_runner.rs` runs `cargo test` and
   `vitest run` (or any `Custom` suite) in isolated `tokio::process`
   children with stripped env (`RUST_LOG`, `CARGO_TARGET_DIR`,
   `NODE_OPTIONS`), per-suite timeout (default 5 min), retry-once for
   flaky-test detection (fail → pass on retry → `Flaky` status, still
   green for the gate), and 4 KiB stdout/stderr tail capture. Returns
   `TestRunResult { suites, all_green, total_duration_ms, flaky_suites }`
   that the orchestrator gates the commit on. 15 unit tests covering
   pass/fail/flaky/timeout/spawn-error/mixed/serde. Wiring into the
   orchestrator (so it actually gates `apply_file` commits) is a
   follow-up.
6. **Temporary worktree isolation.** ✅ **Chunk 28.13 shipped (2026-05-03):**
   `src-tauri/src/coding/worktree.rs` creates detached temporary git
   worktrees for dirty-checkout execution, captures staged binary diffs,
   and cleans up with `git worktree remove --force`. The self-improve
   engine now switches apply/test/stage to that isolated root when the
   active checkout is dirty and writes the review patch under
   `target/terransoul-self-improve/patches`.
7. **GitHub PR flow.** ✅ **Chunk 28.5 shipped (2026-04-30):**
   `src-tauri/src/coding/github.rs` — OAuth device flow
   (`request_device_code`, `poll_for_token`) + per-chunk PR generation
   (`build_chunk_pr_title`, `build_chunk_pr_body`, `chunk_branch_name`).
8. **Cost / token telemetry.** ✅ **Chunk 28.7 shipped (2026-04-30):**
   `RunRecord` now captures real token usage from each provider; the
   metrics panel surfaces cost-per-chunk by provider.
9. **Persistent task queue.** ✅ **Chunk 28.6 shipped (2026-04-30):**
   SQLite-backed queue at `<data>/tasks.sqlite` so external tools
   (MCP, CLI) can enqueue tasks without parsing milestones.md.
10. **Long-session context handoff.** ✅ **Chunks 28.8 + 28.9 + 28.10 +
   27.2 shipped (2026-04-30):** session-handoff codec, persistent
   handoff, context budget manager, and budget-aware document
   assembly bridge `context_budget` ↔ `prompting`. The full pipeline
   for "very long coding will make out of memory or too much context"
   from `promt/devstress.md`.
11. **Path-scoped workflow context.** ✅ **Chunk 28.14 shipped (2026-05-03):**
   markdown files in workflow context can declare YAML-style `applyTo`
   frontmatter such as `src-tauri/**` or `src/**/*.vue`. Reusable coding
   tasks pass `target_paths`, and the self-improve coder derives target path
   hints from the approved plan, so scoped docs/rules are loaded only for
   matching file paths while unscoped files remain global.

Each item lands as one chunk in [`rules/milestones.md`](../rules/milestones.md)
under Phase 25, with the same enforcement contract as every other
chunk: full CI gate, completion-log entry, doc updates, and (if it
touches the brain) `docs/brain-advanced-design.md` sync.

---

## 6. Quick-start: invoking the coding workflow

```rust
use terransoul_lib::coding::{
    workflow::{run_coding_task, CodingTask, TaskOutputKind},
    CodingLlmConfig, CodingLlmProvider,
};

let cfg = CodingLlmConfig {
    provider: CodingLlmProvider::Custom,
    base_url: "http://127.0.0.1:11434".into(), // Local Ollama
    model: "gemma3:4b".into(),
    api_key: String::new(),                    // no key needed
};

let task = CodingTask {
    id: "demo.1".into(),
    description: "Summarise this repo's coding workflow in 3 bullets.".into(),
    repo_root: Some(std::env::current_dir()?),
    include_rules: true,
    include_instructions: true,
    include_docs: true,
    output_kind: TaskOutputKind::NumberedPlan { max_steps: 3 },
    extra_documents: vec![],
   target_paths: vec![],
   prior_handoff: None,
};

let result = run_coding_task(&cfg, &task, None).await?;
assert!(result.well_formed);
println!("{}", result.payload);
```

Same call works against Claude, GPT-5, Groq — change three
fields in `CodingLlmConfig`. **That is the whole point of the design.**
