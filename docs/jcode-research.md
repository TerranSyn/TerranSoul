# jcode reverse-engineering research (2026-05-07)

> **Source:** [1jehuang/jcode](https://github.com/1jehuang/jcode) (MIT) — a
> Rust-native AI coding-agent harness. Reviewed via DeepWiki
> ([deepwiki.com/1jehuang/jcode](https://deepwiki.com/1jehuang/jcode))
> and the upstream `README.md`, `docs/MEMORY_ARCHITECTURE.md`,
> `docs/AMBIENT_MODE.md`, `docs/SAFETY_SYSTEM.md`,
> `docs/SWARM_ARCHITECTURE.md`, `docs/SERVER_ARCHITECTURE.md`.
>
> **License posture:** MIT. We may study patterns and architecture freely;
> we still implement everything natively under neutral TerranSoul names
> (per `rules/coding-standards.md`). No source, prompts, branding, asset,
> or identity copy. Credit recorded in `CREDITS.md`.
>
> **MCP receipt for this analysis.** `brain_health` healthy (ollama
> provider, 1052 memories). `brain_search "coding workflow self-improve
> DAG runner multi-agent"` returned eight relevant baseline facts
> covering `coding/multi_agent.rs`, `coding/dag_runner.rs`,
> `coding/task_queue.rs`, `workflows/engine.rs`, `workflows/resilience.rs`,
> the multi-agent backend adoption plan, the prompt-context rule, the
> standard self-improve flow, and the every-session MCP rule.

## 1. What jcode is, in one paragraph

jcode is a single-binary Rust *coding agent harness* (TUI, not a 3D
companion) optimised for raw performance and unattended operation.
A persistent server-process owns provider auth, sessions, swarm state,
memory, and an MCP pool; many lightweight clients attach over a Unix
socket. Sessions are named (`adjective + animal` like `blazing fox`),
hot-reloadable via `exec()`, resumable across harnesses (Claude Code /
Codex / OpenCode / pi). The system has four design pillars worth
borrowing:

1. **Server-session persistence.** One long-lived server holds all state;
   clients reconnect transparently after disconnects, server reloads, or
   binary upgrades.
2. **Ambient mode.** A self-scheduled background agent that gardens the
   memory graph, scouts recent sessions/git history, and does proactive
   work — bounded by an adaptive rate-limit-aware budget.
3. **Graph-first memory.** Cascade retrieval (BFS through tag/cluster/
   semantic edges after the initial embedding hit), per-category
   confidence decay, negative memories with trigger patterns,
   reinforcement provenance, and gap detection.
4. **Swarm coordination.** Multiple agents in the same repo coordinate
   via DM/channel/broadcast messaging, file-touch notifications, plan
   updates, and explicit lifecycle states — without locks.

The rest of jcode is performance plumbing (sub-millisecond TTFI, custom
mermaid renderer, custom terminal) we can mostly ignore. TerranSoul is
a 3D companion in a Tauri WebView, not a TUI; raw RAM/TTFI numbers do
not apply.

## 2. Side-by-side: what jcode has vs what TerranSoul already has

| Concern | jcode | TerranSoul today | Gap |
|---|---|---|---|
| Long-running brain process | `jcode serve` daemon, idle-timeout 5 min, hot-reload via `exec()` | `npm run mcp` headless runner on `127.0.0.1:7423`, dev/release MCP on `7421/7422` | We already have the headless runner; missing memorable session resume, idle timeout, in-place reload |
| Session resume | `jcode --resume fox` (memorable name), cross-harness import (Codex/Claude Code/OpenCode/pi) | Numeric session ids, no cross-harness import | Adopt naming + transcript importer |
| Multi-client attach | Many TUIs share one server | One Tauri shell per device; MCP supports many tool clients | Acceptable mismatch — our shell is heavier by design |
| Memory model | Graph (Memory/Tag/Cluster nodes; HasTag/InCluster/RelatesTo/Supersedes/Contradicts/DerivedFrom edges) | `memories` + `memory_edges` (typed/directional, V19), HNSW via usearch, RRF k=60, HyDE, LLM-as-judge reranker, Contextual Retrieval | Our **storage** is stronger; our **retrieval** lacks graph cascade + reinforcement provenance + gap detection + negative memories |
| Memory sidecar | Inline per-turn dedup/contradiction/reinforcement on already-retrieved memories | `conflicts.rs` (LLM contradiction resolution at write), `consolidation.rs`, `maintenance_scheduler.rs` | We do most of this at write time, but not as a *post-retrieval* pass on the verified set |
| Background maintenance | "Ambient mode" — agentic loop with `end_ambient_cycle`/`schedule_ambient` tools, adaptive rate-limit budget, proactive work, decision-history feedback | `maintenance_scheduler.rs` runs decay/GC/consolidation/edge-extraction on a fixed cadence | Major design lift: turn the scheduler into an agentic ambient loop |
| Multi-agent | "Swarm" — coordinator/worktree-manager/agents, file-touch notifications, DM/channel/broadcast, lifecycle states (spawned/ready/running/blocked/completed/failed/stopped/crashed), no locks | `coding/multi_agent.rs` + `coding/dag_runner.rs` + multi-agent backend adoption plan (mem id 110) | Our DAG runs sequentially with capability gates; jcode's free-form messaging + lifecycle event model is richer. Our existing plan (mem id 110) already aligns; jcode adds the messaging primitives we lack |
| Self-development | Edits its own source, builds, tests, hot-reloads the running binary mid-session | Self-improve creates worktree + opens PR (chunks 28.x); no in-place reload | Worth borrowing the in-place reload step for headless MCP runner |
| Safety | Two tiers (auto / requires permission), notification channels (email/SMS/desktop/webhook), `request_permission` tool, decision history → pattern-promotion | `request_permission` plumbing exists; capability gates per agent role | Our policy is in code, not a structured tier table with persistent decision history |
| Skills | Skills are embedding-indexed prompt fragments auto-injected on relevance hit | RPG quest skill tree (gameplay layer); `rules/*.md`, `instructions/*.md`, `docs/*.md` all bulk-loaded into every coding-workflow prompt (per `PROMPT CONTEXT RULE`) | We already have a stronger product surface; we *under-perform* on prompt economy — should switch to embedding-injected slices |
| Provider rotation | `/account` slash to swap subscription accounts mid-session, OAuth subscription priority over API keys | `provider_rotator.rs` rotates by health and budget | Already covered; minor UX polish only |
| Search tool | "Agent grep" — grep results carry function lists + per-file structure; adaptive truncation hides what the agent already saw | `code_query` / `code_context` with our symbol index | Add structural decoration + per-session "already seen" truncation |
| Browser tool | First-class `browser` tool with status/setup/open/snapshot/click/type/etc. and Firefox Agent Bridge | Browser via plugins, not a first-class agent tool | Possible plugin hardening; not required for redesign |

## 3. What we should adopt (12 proposals, deeply considered)

Each proposal maps to a TerranSoul module we already have, and identifies
the smallest change that captures the value. The proposals are
sequenced as Phase 43 chunks in `rules/milestones.md`.

### 3.1 Memorable session resume + persistent server polish (small, foundational)

**Problem.** `npm run mcp` and the dev/release MCP each open opaque
sessions. Users and agents cannot say "resume `fox`".

**Adopt.** A two-word session naming scheme (adjective + animal),
a per-`data_dir` registry under `mcp-data/sessions.json`, idle-timeout
config (default 5 min for headless coding sessions), and an MCP slash
command / Tauri command to list/resume by name. Reuse our existing
`coding/coding_sessions.rs` storage; add the naming on top.

**Map to:** `commands/mcp.rs`, `coding/coding_sessions.rs`, MCP server
session listing endpoint. Pure UX win, no architectural risk.

### 3.2 Ambient mode (agentic background loop)

**Problem.** Our `maintenance_scheduler.rs` runs decay/GC/consolidation
on a fixed cadence with no LLM in the loop. It cannot reason about
what's worth doing.

**Adopt.** Wrap (don't replace) the scheduler in an agentic loop with:

- a tool surface for the agent: `garden`, `extract_from_session`,
  `verify_fact`, `scout_recent_sessions`, `request_permission`,
  `schedule_next`, `end_cycle` (mandatory final tool).
- adaptive rate-limit-aware interval (read provider response headers
  for `x-ratelimit-*`; reserve 20% headroom for the user; back off
  exponentially on 429).
- persistent scheduled queue of `(scheduled_for, context, priority)`
  rows on disk, surviving restarts.
- single-instance guard (only one ambient agent ever runs).
- subscription-first provider priority (OAuth before pay-per-token).
- crash safety: atomic temp-file rename, last-processed checkpoints,
  interrupted transcripts marked as such.
- proactive work always goes through `request_permission` and lands on
  a `coding/` worktree branch.
- user feedback is captured as memories ("user rejected ambient PR
  modifying tests") so future cycles naturally avoid the pattern.

**Map to:** new `coding/ambient.rs` and `coding/ambient_scheduler.rs`,
extends `memory/maintenance_runtime.rs`, `memory/maintenance_scheduler.rs`,
reuses `coding/github.rs` for PR creation, `commands/coding.rs` for
status, `tasks/manager.rs` for the queue.

**Why this is the biggest lift.** It is genuinely new behaviour —
TerranSoul has all the substrate (memory store, scheduler, self-improve
loop, capability gates, PR flow) but no *autonomous agentic* layer
above it. This is the single change most likely to feel like jcode.

### 3.3 Cascade retrieval through the knowledge graph

**Problem.** `hybrid_search_rrf` already returns top-K by score, then
RRF-fuses the three retrievers. It does **not** traverse `memory_edges`
to expand the result set with related memories.

**Adopt.** After RRF returns the top-K seeds, BFS the KG to depth ≤ 2
with edge-weighted, depth-decayed scoring (`weight * 0.7^depth`).
Edge-type priors (mirroring jcode's): `Supersedes` 0.9, `HasTag` 0.8,
`RelatesTo` uses stored confidence, `InCluster` 0.6, `Contradicts`/
`DerivedFrom` 0.3. Final pool merges seed scores + cascade scores,
deduped, top-K again. Off by default behind a `cascade=true` query
flag; on by default for `brain_suggest_context` (the read-mostly
agent path).

**Map to:** new function in `memory/store.rs` (or `memory/graph_rag.rs`
which already exists). Tests cover graph-walk decay, dedup, and
ensure flat search is unaffected when off.

**Why this matters.** This is the single largest retrieval-quality
upgrade we can ship without changing our storage. Our edges are
already populated by the maintenance scheduler; we are just not
*walking* them at query time.

### 3.4 Per-category confidence decay half-lives

**Problem.** We have `decay_score` but it is one curve for everything.
A user correction should outlive an inferred fact by ~50×.

**Adopt.** Add a `confidence` REAL NOT NULL column (V20 schema bump,
default 1.0) and per-`cognitive_kind` half-lives:

| Kind | Half-life | Rationale |
|---|---|---|
| Correction | 365 d | User corrections are most valuable |
| Preference | 90 d | Preferences may evolve |
| Procedure | 60 d | Steps change less often |
| Fact | 30 d | Codebase facts go stale |
| Inferred | 7 d | Low trust by default |

`confidence = initial * exp(-age_days / half_life) * (1 + 0.1 * log(access_count + 1)) * trust_weight`.
Decay runs in `maintenance_scheduler.rs`; `brain_search` and
`hybrid_search_rrf` multiply final score by `confidence`.

**Map to:** `memory/schema.rs` (V20 migration), `memory/store.rs`,
`memory/maintenance_runtime.rs`. Backfill rule: existing rows take the
default `confidence=1.0` and decay normally on the next maintenance pass.

### 3.5 Reinforcement provenance

**Problem.** When a memory is re-verified relevant, we silently bump
`access_count`. We cannot answer "why is this memory's strength 15?".

**Adopt.** New `memory_reinforcements(memory_id, session_id, message_index, ts)`
table with composite PK and an FK to `memories(id)`. Every relevance
verification (sidecar pass, LLM-as-judge rerank above threshold,
explicit user thumbs-up) inserts one row. `brain_get_entry` returns
the last N reinforcements; ambient mode uses the table to decide which
strong memories deserve broader edge-discovery.

**Map to:** V20 migration includes the new table. Hooks at the
relevance-verification call sites in `memory/reranker.rs` and
`commands/streaming.rs`.

### 3.6 Negative memories with trigger patterns

**Problem.** "Never use `unwrap()` in library code" is a real rule we
hold in `rules/coding-standards.md` but it has no retrieval-time
surface. The agent must remember to look at the rules file every turn.

**Adopt.** A `cognitive_kind = 'negative'` value plus a sibling
`memory_trigger_patterns(memory_id, pattern, kind)` table where
`kind ∈ { regex, substring, file_glob, language }`. On every chat
turn, the brain scans new context (added file content, last user
message, current diff) against active negative-memory triggers and
prepends matching ones into the context pack with a
`[NEGATIVE — DO NOT DO THIS]` marker.

**Map to:** new `memory/negative.rs`, V20 migration, hook in
`memory/context_pack.rs`. Existing rule sentences in
`rules/coding-standards.md` get backfilled as negative memories with
sensible patterns (one-shot `code_extract_negatives` command).

**Why this matters.** This decouples enforcement from "did the agent
re-read the rules file" and makes the rules retrieval-time guards.
Strictly stronger than our current `PROMPT CONTEXT RULE` of bulk-injecting
all rule docs.

### 3.7 Gap detection

**Problem.** When the user asks something we *should* have a memory
about but don't, retrieval just returns weak matches and the agent
blunders on.

**Adopt.** When `hybrid_search_rrf` finds nothing above a relevance
threshold for an embedded query (i.e. `top_score < 0.3` but
`embedding_norm > 0.7`), persist a `memory_gaps(query_embedding,
context_snippet, session_id, ts)` row. Ambient mode reviews gaps each
cycle and either extracts a memory from the same session's transcript
or files a "memory missing" hint as a negative-memory candidate.

**Map to:** V20 migration, `memory/store.rs` after RRF, ambient agent
tool `review_gaps`.

### 3.8 Post-retrieval maintenance

**Problem.** We have great write-time consolidation (`conflicts.rs`,
`consolidation.rs`) but **no read-time** maintenance. After a chat turn
where the LLM-as-judge verifies five memories were relevant, we do not
strengthen the edges between them or boost their confidence.

**Adopt.** A `tokio::spawn`'d background task triggered after each
chat turn that:

1. For pairs of co-relevant memories without an existing
   `RelatesTo` edge, create one with `confidence = 0.6 + 0.1 * pair_count`.
2. Increment `access_count` and bump `confidence` (+0.05 cap 1.0) on
   verified relevant memories.
3. Decay `confidence` (-0.02) on retrieved-but-rejected memories.
4. If `verified.is_empty() && initial_hits > 0`, log a gap (3.7).
5. Every N retrievals (config), refresh tag inference and cluster
   centroids.

**Map to:** new `memory/post_retrieval.rs`, called from
`memory/context_pack.rs::build_context_pack` once retrieval finishes
and the LLM-as-judge verdict is known.

### 3.9 Tier 1 / Tier 2 safety classifier with decision history

**Problem.** `request_permission` exists but the policy of which actions
need permission is scattered across capability gates and orchestrator
hardcoding. The system has no memory of "the user has approved
`create_pull_request` 14 times in a row — promote it".

**Adopt.** A small `coding/safety.rs` module with:

- `Action` enum (read, write, run-tests, create-branch, push-remote,
  open-pr, merge-pr, run-shell, send-email, install-package, etc.).
- `Tier` enum (`AutoAllowed`, `RequiresPermission`).
- A static classification table + per-project override config in
  `coding/config.toml` (`allow_without_permission = [...]` /
  `require_permission = [...]`).
- A persistent `safety_decisions(action, decision, decided_at, decided_via)`
  table; ambient mode mines this and surfaces "promote `X` to Tier 1?"
  proposals.
- A unified `request_permission(action, description, rationale, urgency, wait)`
  entry point used by both ambient and the foreground self-improve loop.

**Map to:** new `coding/safety.rs` and `commands/safety.rs`, V20
migration for `safety_decisions`. Refactors existing gate sites to call
through the central classifier.

### 3.10 Cross-harness session import

**Problem.** Users come to TerranSoul with weeks of Claude Code or
Codex sessions on disk; today, that history is wasted.

**Adopt.** A `code_import_session` Tauri command (and matching MCP
tool) that reads transcripts from common locations:

- `~/.claude/sessions/`, `~/.codex/sessions/`, `~/.opencode/sessions/`,
  `~/.cursor/transcripts/`, `~/.config/github-copilot/cli/`.
- Detects format (JSON / JSONL / SQLite), extracts user/assistant turns
  and tool calls, runs them through our existing memory-extraction
  pipeline (`memory/brain_memory.rs::extract_memories`), and tags each
  with `imported_from = <harness>`.
- Optional follow-up: replay a session in TerranSoul as if the prior
  agent's turns were ours, so `/reflect` works end-to-end.

**Map to:** new `coding/session_import.rs`, registered in
`commands/coding.rs`. UI surface in `SelfImproveSessionsPanel.vue`.

**Why this matters.** First-time TerranSoul users with existing AI
coding history get their brain pre-populated; the brain feels useful
on day 0 instead of day 30.

### 3.11 Structural agent-grep + adaptive truncation

**Problem.** `code_query` returns raw matches. The agent often has to
follow up with `read_file` just to figure out what `fn foo` belongs to.

**Adopt.** Extend `code_query` results so each match includes:

- enclosing symbol path (`module::struct::method`).
- the symbol's signature (one line).
- the file's symbol outline (function/struct list with byte ranges)
  if the agent has not seen this file in the current session yet.
- per-session "already seen" tracking that suppresses repeated outlines.

**Map to:** `coding/symbol_index.rs` + `commands/code_query.rs` +
`coding/session_chat.rs` (already tracks per-session state).

### 3.12 Embedding-indexed instruction slices

**Problem.** `PROMPT CONTEXT RULE` (mem id 93) bulk-loads every
`rules/*.md`, `instructions/*.md`, `docs/*.md` into the coding-workflow
prompt as XML blocks. At ~20+ files that is an enormous context tax,
and the agent misses items that don't fit.

**Adopt.** Switch to per-section embedding-indexed retrieval:

1. On startup or on `rules/instructions/docs` change, chunk those files
   by markdown heading (we already have `memory/chunking.rs`).
2. Index each chunk as a memory with `category=rule`,
   `cognitive_kind=instruction`.
3. At prompt-build time, embed the current task description and pull
   only the top-K matching chunks (default K = 10).
4. Always include a tiny "table of contents" pointer line per file
   (one sentence) so the agent can request specific files explicitly
   if K=10 misses something.

**Map to:** new `coding/instruction_index.rs`, hooked into
`coding/prompting.rs` to replace the bulk XML doc-block path. Honour
the existing `PROMPT CONTEXT RULE` by *guaranteeing* a hit on rules
that match the task topic. Update the rule's text in
`rules/prompting-rules.md` once the new path is the default.

**Why this matters.** Today every coding turn pays the rules-bulk tax.
After this change, only the relevant rule slices ride along, freeing
~5–10k tokens per turn for actual code.

## 4. What we deliberately reject

| jcode feature | Why we skip |
|---|---|
| Custom 1800× mermaid renderer (`mermaid-rs-renderer`) | We render in a Tauri WebView with `marked` / `mermaid.js`; no TUI bottleneck |
| Custom terminal (`handterm`) | Not relevant — TerranSoul has no terminal UI |
| TTFI/RAM micro-benchmarks | Apples to oranges; we ship a 3D companion + WebView |
| Skill auto-injection by embedding hit on chat turn | Our skill tree is a *gameplay* layer; do not conflate with coding-workflow rules. The same mechanism (embedding-injected slices) is adopted in §3.12 *for instructions*, not for skill-tree quests |
| `/account` multi-account switching | Minor UX polish; covered by `provider_rotator.rs` improvements when needed, not Phase 43 work |
| Native Firefox Agent Bridge | Browser tooling already lives in plugins; rebuilding it natively does not pay back |

## 5. Migration & risk notes

- **Schema bumps.** Proposals 3.4 (`confidence`), 3.5
  (`memory_reinforcements`), 3.6 (`memory_trigger_patterns`),
  3.7 (`memory_gaps`), 3.9 (`safety_decisions`) all need a single
  V20 migration. Numbered seed migration under
  `mcp-data/shared/memory-seed.sql` so existing dev DBs upgrade.
- **Ambient mode rollout** must default to `enabled = false` on first
  release with `proactive_work = false` (garden only) until the
  decision-history feedback loop has at least 20 cycles of data.
- **Cascade retrieval** must ship behind a query flag and an A/B
  recall benchmark — extending `benches/million_memory.rs`. Promote
  to default for `brain_suggest_context` only after recall@10 holds
  ±1% versus flat RRF on the existing test corpus.
- **Cross-harness import** must redact secrets the same way as
  in-app memory extraction (`memory/brain_memory.rs` already does
  this; reuse the helper).
- **Instruction slicing (§3.12)** must keep a `--bulk-rules` escape
  hatch in `coding/prompting.rs` so a regression can be backed out
  without a release.

## 6. Sequencing — Phase 43 chunks

The 12 chunks below are ordered foundations-first so each lands behind
a green Full CI Gate without forcing the next. See
`rules/milestones.md` for the live status table.

1. **43.1** — Memorable session names + idle timeout for headless MCP.
2. **43.2** — V20 schema migration: `confidence`, `memory_reinforcements`,
   `memory_trigger_patterns`, `memory_gaps`, `safety_decisions`.
3. **43.3** — Per-category confidence decay (uses 43.2).
4. **43.4** — Reinforcement provenance (uses 43.2 + 43.3).
5. **43.5** — Cascade retrieval through `memory_edges`.
6. **43.6** — Post-retrieval maintenance background task.
7. **43.7** — Negative memories + trigger patterns (uses 43.2).
8. **43.8** — Gap detection (uses 43.2 + 43.6).
9. **43.9** — Embedding-indexed instruction slices (replaces bulk XML).
10. **43.10** — Tier 1/2 safety classifier with decision history (uses 43.2).
11. **43.11** — Ambient mode skeleton (single-instance guard, scheduled
    queue, adaptive rate-limit, garden-only default).
12. **43.12** — Cross-harness session import (Claude Code / Codex /
    OpenCode / Cursor / Copilot CLI).

Out of scope for Phase 43 but deserve their own future phase:

- Swarm same-repo multi-agent messaging (extend the existing
  multi-agent backend adoption plan, mem id 110).
- Hot-reload for the headless MCP runner (`exec()` into rebuilt
  binary while clients reconnect).
- Structural agent-grep refactor of `code_query` (§3.11) — small
  enough to slot in either next to 43.5 or in a later code-intel phase.

## 7. Sources verified

- jcode README — features, claims, install, OAuth surface.
- `docs/MEMORY_ARCHITECTURE.md` — graph schema, cascade, post-retrieval
  maintenance, sidecar consolidation phases.
- `docs/AMBIENT_MODE.md` — agent tool surface, adaptive scheduler,
  crash safety, cold start, per-project config.
- `docs/SAFETY_SYSTEM.md` — Tier classification, request_permission,
  decision history, notification channels.
- `docs/SWARM_ARCHITECTURE.md` — coordinator/worktree-manager/agent
  roles, lifecycle, communication topology, completion-report policy.
- `docs/SERVER_ARCHITECTURE.md` — single-server multi-client model,
  hot-reload via `exec()`, adjective+animal naming.
- DeepWiki overview (Last indexed 3 May 2026 @ `f071bc2a`) — workspace
  crate map, request-lifecycle and provider/auth diagrams used to
  cross-check terminology against upstream source paths.

End of research.
