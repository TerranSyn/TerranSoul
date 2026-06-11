# OpenAgentd Reverse-Engineering Audit (2026-05-10)

> **Source:** [`lthoangg/OpenAgentd`](https://github.com/lthoangg/OpenAgentd) — Apache-2.0
> Python 3.14 + FastAPI backend, React 19 + Vite + Bun frontend.
> Studied via the upstream `documents/docs/` tree (architecture, agent loop,
> hooks, tools, teams, summarization, memory) plus the README. DeepWiki
> (`https://deepwiki.com/lthoangg/OpenAgentd`) was reachable but **not yet indexed**, so
> we used the upstream docs directly and recorded that fallback per the
> DeepWiki-first reverse-engineering rule.
>
> **Clean-room scope:** no source, prompts, asset names, brand identity, or
> wire formats are copied. TerranSoul implements equivalent capabilities
> natively in Rust under neutral names. Apache-2.0 only obligates attribution
> for direct redistribution; we still credit upstream in `CREDITS.md` because
> the patterns below informed our coding/workflow roadmap.

---

## TL;DR — what TerranSoul should adopt

The eight highest-leverage patterns from OpenAgentd's `app/agent/` engine that
are *missing or underbuilt* in TerranSoul today:

| # | Pattern | TerranSoul gap | Priority |
|---|---|---|---|
| 1 | **Tool-result offload to disk** when a tool returns more than ~40 KB; replace with a head/tail preview + workspace path the agent can `read` | Coding loop and chat tool calls splat full results into context | High |
| 2 | **Three-point interrupt check** (mid-stream, pre-dispatch, mid-tool) + `_gather_or_cancel`-style FIRST_COMPLETED race against an interrupt event | `coding::engine` polls `AtomicBool` only between DAG nodes; in-flight tool calls cannot be cancelled | High |
| 3 | **Orphaned tool-call healing** before the next user turn (synthetic `ToolMessage("interrupted")` for assistant rows whose tool calls have no replies; drop tool calls with truncated JSON args on deserialize) | Crashes/SIGKILLs between message-persist and tool-result-persist break the next OpenAI Responses turn with `No tool output found for function call` | High |
| 4 | **Hook chain with `wrap_model_call` / `wrap_tool_call` chain-of-responsibility** + frozen `RunContext` and mutable `AgentState` | TerranSoul has `coding/hooks.rs` for *git* hooks only; no runtime LLM-call hook framework | High |
| 5 | **Rolling-window summarization with three-tier config** (per-agent → file → defaults) + cross-request token seeding from history so turn N+1 summarisation actually fires | TerranSoul memory/context_pack handles RAG, not turn-token-budget compression for long coding sessions | Medium |
| 6 | **Dream/maintenance agent** that reads unprocessed session notes on a cron and synthesises durable topics + updates `USER.md` and an INDEX | TerranSoul has scheduled maintenance (decay/GC/embed backfill) but no LLM-driven "session notes → durable topics" promotion | Medium |
| 7 | **Stream-store commit-after-persist** (drop replay-buffer content as soon as `checkpointer.sync()` writes the row) | TerranSoul streams Tauri events but does not have a documented "subscribe-before-replay" + "commit-after-persist" contract; mid-turn refresh duplication is a real risk | Medium |
| 8 | **Sandbox path/command denylist with `shlex` token scan for shell + glob patterns (`**/.env`, `**/secrets/**`)** | TerranSoul's coding worktree isolates writes by directory but has no shell-token denylist or first-class secret-glob denylist | Medium |

The full pattern catalogue is in §3; chunked TerranSoul work is in §4 and
mirrored as new rows in `rules/milestones.md` (Phase 47).

---

## 1 — System overview

OpenAgentd is a single-user, local-first FastAPI service with a React cockpit.
The agent engine lives entirely under `app/agent/`:

```
app/agent/
  agent_loop.py        ← Agent class, one-turn reasoning loop
  hooks/               ← BaseAgentHook + built-ins (streaming, summarization, …)
  tools/               ← @tool registry + builtin tools (filesystem, shell, web, …)
  mode/team/           ← AgentTeam, TeamLead, TeamMember, mailbox, team_message
  providers/           ← LLMProviderBase + per-vendor implementations
  sandbox.py           ← path/command denylist
  permission.py        ← Rule/Ruleset wildcard, last-match-wins
app/services/
  stream_store.py      ← in-memory turn state + asyncio fan-out queues
  chat_service.py      ← message persistence + heal_orphaned_tool_calls
  wiki.py / dream.py   ← three-tier wiki + cron synthesis
```

Every chat turn writes to a per-session in-memory state blob and N subscriber
queues (one per SSE client). After each `checkpointer.sync()` the just-persisted
content is dropped from the replay blob so a mid-turn refresh does not render
the same assistant text twice (once from DB, once from replay). This is the
contract TerranSoul should match for any future Tauri-event replay surface.

## 1.5 — Deep UI/UX learning (team-role handoff cockpit)

The original audit focused mostly on runtime internals. This addendum captures
the UI/UX layer deeply, because OpenAgentd's team structure is operationalized
through cockpit ergonomics, not only backend protocols.

### A. Core UX model: visible multi-agent operations

OpenAgentd treats agent collaboration as a first-class visual surface:

- `TeamChatView` + `SplitGrid` render N panes (lead + members) simultaneously.
- `usePanelDnD` enables drag-reorder so operators control visual priority.
- `AgentPane` provides compact per-agent state chrome (model, token stats,
  working/error/idle dot, role context).
- `TeamStatusBar` keeps global session state visible (`lead`, `working`, error,
  short session id) without opening diagnostics drawers.

This creates a "control-room" UX where role interaction is inspectable in
real time rather than hidden inside one transcript.

### B. Role handoff is both protocol and UI event stream

Team role passing (`lead` delegates, members execute, members report back,
lead synthesizes) is reinforced by UI primitives:

- `team_message` tool-call cards render conversational headers (e.g. messaging
  researcher/team), so delegation events are human-legible.
- `InboxBubble` and per-agent stream blocks make mailbox arrivals visible.
- Team docs define `TeamInboxHook` draining during loop iterations, then stream
  publication and checkpoint sync.
- Team flow diagrams show parallel member activations and eventual lead
  synthesis before `done` is emitted.

Key learning: role passing must not be "just happens in logs"; operators need
delegation, execution, and return paths visibly represented in the timeline.

### C. Information architecture patterns worth adopting

OpenAgentd cockpit splits concerns into stable surfaces:

- Main chat/work surface (`TeamChatView`)
- Workspace files panel (artifact-centric)
- Todos popover (task progress/status density)
- Scheduler drawer (scheduled jobs with list/detail/create flows)
- Settings hub with dedicated pages for agents, skills, sandbox, dream config

This avoids overloading one chat panel and gives each operational concern a
bounded, discoverable home.

### D. Interaction details that improve operator trust

- Strong accessibility contracts in tests (labeled close buttons, searchable
  task panel, empty/error-state assertions).
- Mobile-aware list/detail pane behavior in scheduler UX.
- Persistent drawer mount + refetch-on-open to avoid stale operational data.
- Dense but consistent visual grammar (uppercase micro-headings, bordered
  sections, muted tokens, explicit icon semantics).

These are not cosmetic; they reduce ambiguity in long-running team sessions.

### E. UX implications for TerranSoul

TerranSoul should adopt these UI/UX principles in its own neutral design
language:

1. Make role handoff explicit in UI.
   Delegation, member execution, and lead synthesis should each have visual
   state markers (not only raw text).
2. Keep per-agent status persistent.
   Show lead/member identity, active state, and error state in a stable bar.
3. Support operator-controlled pane priority.
   Drag-reorder or focus controls should determine which agent stream is
   visually primary.
4. Separate operational panels.
   Files, tasks/todos, schedule, and team roster should be dedicated surfaces,
   not a single monolithic drawer.
5. Enforce verify-before-claim in both prompt protocol and UI cues.
   UI should make the final verification read step visible before a member can
   be treated as "done".

### F. Additional concrete references reviewed

- `web/src/components/TeamChatView/index.tsx`
- `web/src/components/TeamChatView/SplitGrid.tsx`
- `web/src/components/TeamChatView/usePanelDnD.ts`
- `web/src/components/AgentPane.tsx`
- `web/src/components/TeamStatusBar.tsx`
- `web/src/components/ToolCall.tsx` tests (`team_message` display)
- `app/agent/mode/team/team.py`
- `app/agent/mode/team/mailbox.py`
- `app/agent/mode/team/member.py` (lead/member protocol)
- `documents/docs/agent/teams.md` (architecture + flow diagrams)
- `documents/docs/web/workspace-files.md`, `documents/docs/web/todos.md`,
  `documents/docs/web/mobile.md`, `documents/docs/web/chat-input.md`

## 2 — Agent loop in one diagram

```
agent.run(messages, checkpointer):
  RunContext (frozen)               ← session_id, run_id, agent_name, created_at
  AgentState   (mutable)            ← messages, usage, capabilities, metadata
  before_agent  ── once ──┐
                          ▼
  loop while iteration < max_iterations:
    before_model       ← may return new ModelRequest (e.g. SummarizationHook,
                          TeamInboxHook). ModelRequest.messages is a frozen tuple,
                          so any hook that mutates state.messages MUST return
                          request.override(messages=...) or the LLM sees stale data.
    sync()             ← persist any state changes
    wrap_model_call    ← chain-of-responsibility, innermost is the streaming call
       on_model_delta  ← fired per chunk
    after_model        ← AssistantMessage assembled
    sync()             ← persist assistant + token usage
    if no tool_calls: break
    pre-dispatch interrupt check ← if set, ToolMessage("Cancelled") for each call
    _gather_or_cancel(_run_tool, …)
       wrap_tool_call  ← chain-of-responsibility (offload, audit, …) → execute
    sync()             ← persist tool results
  after_agent
  sync()
```

Three primitives matter for TerranSoul's own loop:

1. **The hook chain** is composable and uses `chain-of-responsibility`. Tool
   offload, summarization, OTel, audit logging, and team-protocol injection
   are all hooks — never branches in the loop body.
2. **`ModelRequest.messages` is a frozen tuple snapshot** built before
   `before_model`. Hooks that need to inject messages must return
   `request.override(messages=...)`. Mutating `state.messages` alone is not
   enough.
3. **`sync()` runs at four points** (after `before_model`, after `after_model`,
   after each tool, after `after_agent`), and immediately after each successful
   sync the in-memory replay blob is committed (cleared) for that agent.
   Without this, mid-turn UI refresh duplicates content.

## 3 — Pattern catalogue (full)

### 3.1 Tool-result offload (`hooks/tool_result_offload.py`)

When `wrap_tool_call` sees a result string above
`DEFAULT_CHAR_THRESHOLD = 40000` chars (~10 K tokens), the full content is
written to `{workspace}/{agent_name}/.tool_results/{tool_call_id}.txt` and the
returned `ToolMessage.content` becomes a compact summary with head + tail
preview and the file path. Metadata is stashed in
`state.metadata["_offloaded_tool_results"][tool_call_id]`. Write failure logs
a warning and returns the original string unchanged — tool execution is never
broken by an offload failure.

**TerranSoul mapping:** add an offload step in
`coding::engine::run_tool_with_hooks` and `commands::chat`'s tool-call handler.
Offload to `<worktree>/.terransoul/tool_results/<id>.txt`, replace the value
written into the conversation/messages table with a 1-2 KB preview, and let
the agent call a `read` tool for the full content. Re-use the existing
worktree FS layout so the file is visible to follow-up `code_search`.

### 3.2 Shell large-output spill (`builtin/shell.py`)

`shell` streams output incrementally; once it exceeds
`DEFAULT_MAX_OUTPUT_BYTES = 128 KB` the full content is saved to
`.shell_output/<call_id>.txt` and the inline reply contains only the last 200
lines plus a reference. Subprocesses are started with `start_new_session=True`
and killed via `os.killpg()` on timeout/cancel so child processes (e.g. `node`
under `npm run dev`) actually die. A `<shell_metadata>` advisory block is
appended on timeout suggesting a higher `timeout_seconds` on retry.

**TerranSoul mapping:** `coding::test_runner` and `coding::processes` already
spawn external commands. Add (a) ring-buffer + spill-to-file for output above
~128 KB, (b) process-group kill on cancel/timeout, (c) a structured advisory
returned to the agent on timeout so the next attempt has a hint.

### 3.3 Three-point interrupt + `_gather_or_cancel`

The agent loop monitors an `asyncio.Event` interrupt at three points: during
LLM streaming (break on next chunk), before tool dispatch (skip with
`Cancelled by user.`), and during tool execution
(`asyncio.wait(FIRST_COMPLETED)` racing tool tasks vs the event). Tools that
finish in the same tick keep their real results; still-running tools are
`asyncio.Task.cancel()`'d and returned as `Cancelled by user.`.

**TerranSoul mapping:** `coding::engine` already has `cancel: Arc<AtomicBool>`,
but it is checked only between DAG nodes. We need an interrupt path that
breaks an in-flight `tokio::spawn`'d tool/test task as well. The cheapest
implementation is a `tokio::sync::watch::Sender<bool>` per run, with each
tool wrapped in `tokio::select!{ tool, _ = watch.changed() }`.

### 3.4 Orphaned tool-call healing

`heal_orphaned_tool_calls` runs in the same DB transaction as the new user
message: it inspects the latest assistant row, and inserts a synthetic
`ToolMessage("Tool execution was interrupted before a result could be
recorded.")` for every `tool_call_id` without a matching reply. Stub
timestamps anchor to `last_assistant.created_at + 1µs * (i+1)` so the input
order stays `assistant → tool → … → user`. A second guard in
`_deserialize_messages` drops tool calls whose `arguments` JSON is truncated
(mid-stream interrupt during argument streaming).

**TerranSoul mapping:** TerranSoul's chat / coding session-chat layers are at
risk of the same failure mode whenever the app is force-closed mid-tool.
Add the heal-on-load pattern in `commands::chat::load_session` and
`coding::session_chat::resume`.

### 3.5 Subscribe-before-read SSE attach + commit-after-persist

`stream_store.attach(session_id)` is two-phase: register the subscriber queue
**before** replaying state (closes the gap window), then yield live events
from the queue. After each successful `checkpointer.sync()` for an agent,
`commit_agent_content(session_id, agent_name)` drops the persisted blocks
from the replay blob so a mid-turn refresh does not double-render content.

**TerranSoul mapping:** TerranSoul currently emits Tauri events without a
documented replay buffer; the chat panel reload reads from SQLite. As soon
as we introduce a replay surface (e.g. for the multi-window pet-mode chat
mirror, or the LAN-MCP-shared web UI), we should adopt the
subscribe-before-read + commit-after-persist contract from day one.

### 3.6 Hook chain with frozen RunContext + mutable AgentState

All hooks share two parameters: a frozen `RunContext` (immutable identity:
`session_id`, `run_id`, `agent_name`, `session_created_at`) and a mutable
`AgentState`. `wrap_tool_call` is a chain-of-responsibility, with the actual
executor as the last link. `_safe_invoke_hooks()` catches and logs hook
exceptions — a bad hook never crashes a turn.

**TerranSoul mapping:** TerranSoul's `coding/hooks.rs` is a *git* hook
installer; we have no LLM-call hook framework. A small `AgentHook` trait in
`src-tauri/src/coding/runtime_hooks.rs` with `before_model`, `after_model`,
`wrap_tool_call`, and `on_chunk` would let us layer offload, audit, OTel,
and self-improve lesson capture as composable units instead of branching the
engine body. Use `dyn Hook` boxed in a `Vec<Arc<dyn AgentHook>>` and route
errors through `tracing::warn!` with the hook name.

### 3.7 Three-tier summarization config + cross-request token seeding

Settings resolve `per-agent frontmatter → global file
(.openagentd/config/summarization.md) → module defaults`. The hook is a pure
in-memory state transform: when `state.usage.last_prompt_tokens >= threshold`,
older messages are marked `exclude_from_context=True` and a single
`HumanMessage(is_summary=True)` is inserted. The Checkpointer persists the
flags. Critical gotcha: `state.usage.last_prompt_tokens` resets to 0 on every
`Agent.run()`, so for multi-HTTP-request sessions the checkpointer seeds it
from the last assistant `extra.usage.input` value at load time.

**TerranSoul mapping:** Long coding sessions blow the context window. We
already have `coding::context_budget` and `coding::context_engineering`, but
no in-loop rolling-window compressor. The right move is to build a
`SummarizationHook` for the new hook framework (3.6) and seed
`last_prompt_tokens` from `coding::session_chat`'s persisted usage so the
hook fires correctly on a resumed session.

### 3.8 Three-tier wiki memory + dream agent

`USER.md` (always injected into the system prompt), `topics/{slug}.md`
(BM25-searchable on demand via `wiki_search`), and `notes/{date}.md`
(append-only via `note` tool). A scheduled `dream` agent reads unprocessed
sessions and notes, synthesises new topic files, and updates `USER.md` and
`INDEX.md`. Empty sessions are auto-skipped so they do not consume a batch
slot. Path validation (`validate_wiki_path`) defends against `..` and
symlink escape.

**TerranSoul mapping:** TerranSoul has `memory::wiki` and `memory::brain_memory`
already, plus the `obsidian_export` projection. What is missing is the
*scheduled-promotion* loop — turning ephemeral chat notes (which today land in
`memory.db` and quietly age out via decay) into durable, BM25-searchable wiki
topics. This is a perfect job for a TerranSoul "dream" maintenance agent
that reuses the existing brain LLM provider and the embedding worker.

### 3.9 Sandbox: denylist + glob + `shlex` shell-token scan

Filesystem denylist covers `OPENAGENTD_DATA_DIR`, `OPENAGENTD_STATE_DIR`,
`OPENAGENTD_CACHE_DIR` plus user-defined `**/.env`-style globs from
`sandbox.yaml`. The same denylist also covers `shell` commands via a
best-effort `shlex` token scan (`/`, leading `~`, leading `.` → resolved
against workspace, then matched). Tilde paths and resolved-symlink escapes
are rejected. **Best-effort only** — `$VAR`, `$(...)`, and backticks are not
evaluated, so OS-level user permissions remain the last line of defence.

**TerranSoul mapping:** TerranSoul's coding loop runs in an isolated
`worktree`, so directory-level isolation is solid. What we should add is a
first-class `secrets_denylist` (default `**/.env`, `**/secrets/**`,
`**/*.pem`, `**/id_rsa*`) checked by the file tools, plus a tokenised
shell-command pre-flight that rejects path-like tokens which resolve into a
denied root.

### 3.10 Permission system with rule/ruleset wildcards

`Rule(pattern, decision)` + `Ruleset` with wildcard, last-match-wins. A
single `mcp_*` rule covers every MCP tool. Default
`AutoAllowPermissionService` fires `permission_asked` SSE events and
auto-approves; a blocking `PermissionService` can be wired in once a
frontend approval UI is ready. Permission decisions persist across turns.

**TerranSoul mapping:** TerranSoul has a quest/skill-gating system but no
generic per-tool permission ruleset. Worth keeping as an option for future
Mode-B coding sessions where an end-user wants `read` and `code_search`
auto-approved but `write`, `apply_file`, and `shell` blocked-on-prompt.

### 3.11 Provider schema sanitization (`$ref` inlining + Gemini stripping)

`_resolve_refs()` inlines every `$ref` and drops `$defs` so providers that
reject `$ref` (Gemini, Vertex AI) get flat self-contained schemas.
`GeminiProviderBase._sanitize_schema()` strips `discriminator`, `const`,
`exclusiveMinimum/Maximum`, `additionalProperties`, `$schema`, `$id`,
`contentEncoding`, `contentMediaType` recursively before the request is
sent.

**TerranSoul mapping:** When TerranSoul exposes its MCP tools through the
free-mode Gemini provider, the same sanitization is needed. Add
`brain::providers::sanitize_tool_schema_for_gemini` and call it in the
free-mode tool-call adapter; otherwise some tools will silently fail with
`400 INVALID_ARGUMENT`.

### 3.12 3-phase tool SSE (`tool_call` → `tool_start` → `tool_end`)

`tool_call` fires from the streaming model delta the moment a `name` is seen
(no args yet → frontend shows a spinner card). `tool_start` fires from
`wrap_tool_call` *before* execution with the assembled args. `tool_end` fires
*after* execution with the result. All three carry the same `tool_call_id`
so the frontend can match them even when tools run in parallel. **Critical:**
`tool_end` must use the id registered at `tool_call` time (some providers
mis-index parallel calls; OpenAgentd has a `ToolIdResolver` that handles
that).

**TerranSoul mapping:** TerranSoul's `StreamTagParser` and chat tool-call
events already surface tool calls; verify the three-phase contract holds for
parallel calls and consider adopting the `ToolIdResolver` pattern.

### 3.13 Live config drift detection (no team reload)

Each team member stamps the mtimes of its own `.md`, `mcp.json`, and every
referenced `SKILL.md` in `agent.config_stamp` at build time. End-of-turn the
wrapper checks for drift; on the next activation it re-parses the `.md` and
swaps the underlying agent in place (model, tools, prompt, MCP). Wrapper,
mailbox binding, and `session_id` are preserved. Parse failures keep the
previous agent and re-stamp to avoid looping. External callers
(`GET /team/agents`) can call `refresh_if_dirty()` to pick up frontmatter
changes immediately.

**TerranSoul mapping:** TerranSoul's coding skills/personas live as files
on disk. Add `coding::skills::stamp_and_refresh_if_dirty` so editing a skill
file is reflected on the next ambient-mode wake without restarting the
engine.

### 3.14 Lead-as-translator team protocol (`team_manage`)

Members describe needs in plain language ("I need to write files to disk")
rather than registry names ("grant me `write`"). The lead translates and
calls `team_manage(member, action='add', kind='tool', name='write')`.
Validation runs **before** any disk write. Critical robustness: members must
**verify before claiming** (re-read after write), and the lead must
sanity-check a member's "done" claim (cheap follow-up read).

**TerranSoul mapping:** TerranSoul's `coding::multi_agent` and orchestrator
do not yet codify a verify-before-claim discipline in prompts. Add the rule
to the agent persona prompts and to `rules/prompting-rules.md` so it is
enforced consistently.

---

## 4 — Recommended TerranSoul chunks (Phase 47)

These have been added to `rules/milestones.md`:

- **47.1** — Tool-result offload + shell large-output spill (patterns 3.1, 3.2).
- **47.2** — Three-point interrupt + orphaned-tool-call healing (3.3, 3.4).
- **47.3** — Runtime `AgentHook` trait + `wrap_tool_call` chain skeleton (3.6).
- **47.4** — Rolling-window summarization hook + cross-resume token seeding (3.7).
- **47.5** — Sandbox secrets-denylist + shell tokenised pre-flight (3.9).
- **47.6** — Provider tool-schema sanitization for free-mode Gemini (3.11).
- **47.7** — Verify-before-claim discipline in `coding::multi_agent` prompts (3.14).

Three patterns are **deferred** with rationale recorded:

- **3.5 (subscribe-before-read SSE)** — wait until we actually have a Tauri
  replay surface; today there is nothing to corrupt.
- **3.8 (dream agent for wiki promotion)** — depends on 47.3 (hook framework)
  to stay composable; revisit after Phase 47.4 ships.
- **3.10 (permission ruleset)** — quest-gating already covers the user-trust
  surface for Mode-A; revisit if/when Mode-B (third-party coding
  contractor sessions) lands.

---

## 5 — DeepWiki + license check

- **DeepWiki:** `https://deepwiki.com/lthoangg/OpenAgentd` reachable but
  **not yet indexed** at audit time. Recorded as a blocker for the
  DeepWiki-first rule and substituted with the upstream `documents/docs/`
  tree.
- **License:** Apache-2.0. Permissive; only obligates attribution on
  redistribution. We are studying patterns clean-room; no source, prompts,
  asset names, or wire formats are copied. Attribution is recorded in
  `CREDITS.md`.

## 6 — Provenance

- Researched: 2026-05-10 by the TerranSoul agent session that fixed chat-input
  responsiveness, dropdown contrast, and self-improve gap lessons (see
  commit `1834387` for the prior chunk).
- Sources fetched:
  - `documents/docs/index.md`
  - `documents/docs/architecture.md`
  - `documents/docs/agent/loop.md`
  - `documents/docs/agent/hooks.md`
  - `documents/docs/agent/tools.md`
  - `documents/docs/agent/teams.md`
  - `documents/docs/agent/summarization.md`
  - `documents/docs/agent/memory.md`
  - `documents/docs/web/workspace-files.md`
  - `documents/docs/web/todos.md`
  - `documents/docs/web/mobile.md`
  - `documents/docs/web/chat-input.md`
  - Upstream `README.md`
  - `web/src/components/TeamChatView/index.tsx`
  - `web/src/components/TeamChatView/SplitGrid.tsx`
  - `web/src/components/TeamChatView/usePanelDnD.ts`
  - `web/src/components/AgentPane.tsx`
  - `web/src/components/TeamStatusBar.tsx`
  - `web/src/components/SchedulerPanel.tsx`
- Lessons mirrored to `mcp-data/shared/memory-seed.sql`
  and `mcp-data/shared/lessons-learned.md`.
