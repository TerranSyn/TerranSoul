# Tencent TencentDB Agent Memory — Research and TerranSoul Adoption Plan

> Reverse-engineering reference: [Tencent/TencentDB-Agent-Memory](https://github.com/Tencent/TencentDB-Agent-Memory)
> ([DeepWiki](https://deepwiki.com/Tencent/TencentDB-Agent-Memory) — indexed 2026-05-14, commit `285896f8`).
> License: MIT. Studied: DeepWiki overview + upstream `README.md` only.
> No source code, prompts, asset names, branded identity, schema column names, or UI copied.
> Date: 2026-05-17. Credit recorded in [CREDITS.md](../CREDITS.md).

## 1. What it is

TencentDB Agent Memory is a layered/symbolic memory framework for LLM agents
designed to **reject flat vector storage in favour of a hierarchical pyramid**.
It is shipped as an OpenClaw plugin and a Hermes Gateway adapter, runs fully
local out of the box (SQLite + sqlite-vec), and reports notable downstream
agent gains on long-horizon tasks:

| Benchmark | Baseline | With TencentDB | Delta |
|---|---|---|---|
| WideSearch (pass rate) | 33 % | 50 % | **+51.52 %** relative |
| WideSearch (tokens) | 221.31 M | 85.64 M | **−61.38 %** |
| SWE-bench (pass rate) | 58.4 % | 64.2 % | +9.93 % |
| AA-LCR (pass rate) | 44.0 % | 47.5 % | +7.95 % |
| PersonaMem accuracy | 48 % | 76 % | **+59 %** |

Numbers belong to the upstream evaluation; TerranSoul has not reproduced them.

## 2. Core ideas worth importing

### 2.1 Long-term memory pyramid (L0 → L3)

| Tier | Content | Storage in their system | TerranSoul today |
|---|---|---|---|
| **L0 Conversation** | Raw, unedited dialogue | `l0_conversations` table | Conversation history in `src/stores/conversation.ts` + `commands::chat` SQLite, but no canonical "raw archive" tier — turns are turned into `MemoryType::Context` rows immediately. |
| **L1 Atom** | Extracted atomic facts | `l1_records` table | `MemoryStore` long-tier `semantic` + `procedural` rows. |
| **L2 Scenario** | Aggregated task scenes | `Scenario` class → Markdown blocks | No explicit per-task aggregation tier. Closest analogue is `memory/context_pack.rs` *retrieval-time* packs (transient). |
| **L3 Persona** | User profile / long-term preferences | `Persona` class → `persona.md` | `persona/traits.rs` + drift/pack — already structured but does not point back at the source atoms that produced each trait. |

The novelty is not the layering itself (TerranSoul already has short / working
/ long tiers and five `cognitive_kind` classes), it is the **explicit
derivation chain**: every L3 Persona points back at the L2 Scenarios that
synthesized it; every Scenario points back at L1 Atoms; every Atom points back
at L0 turns. Recall always returns the highest-density tier first and only
drills down on demand via stable IDs (`result_ref`, `node_id`).

### 2.2 Symbolic short-term memory (context offload + Mermaid canvas)

For active long-horizon tasks the system **offloads verbose tool outputs** to
`refs/*.md` files on disk and replaces them in-context with a **lightweight
Mermaid diagram** that encodes task-state transitions. The agent reasons over
the symbol graph; when it needs a specific detail it greps for a `node_id` and
fetches the raw payload back from the side file.

This is the source of the 61 % token reduction on WideSearch — the LLM never
sees the verbose tool output unless it deliberately drills into a node.

### 2.3 White-box debuggability

L2 Scenario blocks live as plain Markdown. L3 Persona lives in a readable
`persona.md`. Short-term canvases are Mermaid. Raw payloads and summaries are
linked by `result_ref` / `node_id`. When recall is wrong, debugging is a
**deterministic walk** along Persona → Scenario → Atom → Conversation rather
than a forensic inspection of vector scores.

## 3. Where TerranSoul already overlaps

- **Hybrid retrieval (BM25 + vector + RRF)** — TerranSoul's six-signal hybrid +
  RRF retrieval is the same shape (`memory/store.rs::hybrid_search_rrf`,
  `memory/fusion.rs`).
- **Local-first SQLite** — `memory/store.rs` uses bundled SQLite with FTS5 +
  HNSW; TencentDB uses SQLite + sqlite-vec. Equivalent.
- **Hybrid `search` + `recall`-style tools over MCP** — TerranSoul already
  exposes `brain_search`, `brain_list_recent`, `brain_append`,
  `brain_suggest_context` (`ai_integrations/mcp/tools.rs`).
- **Cross-source provenance** — TerranSoul stores `source_url` + `source_hash`
  per memory; the bones of the drill-down chain are already there.

## 4. What is genuinely new for TerranSoul

| Idea | Why it is novel here | Adoption stance |
|---|---|---|
| **`derived_from` edge kind** linking summary memories to their source memories | TerranSoul has `memory_edges` (`shares_entities` etc.) but no provenance edge. Without it, every summary is a forensic dead-end. | **Adopt** — new chunk in backlog (`MEM-DRILLDOWN-1`). |
| **L2 Scenario tier** (per-task aggregation block) | TerranSoul's context packs are transient retrieval-time artefacts; a persistent per-task aggregation block does not exist. | **Adopt as `MemoryType::Scenario` or `cognitive_kind::scenario`** — defer to design review. |
| **Symbolic context offload** for verbose tool output | Coding workflow currently writes whole tool transcripts into chat history and re-injects everything; tokens cost goes up linearly with session length. | **Adopt** — fits the existing coding harness. New backlog chunk (`CTX-OFFLOAD-1`). |
| **Mermaid task canvas** as the in-context compressed state | TerranSoul `coding/workflow.rs` has phase trackers but no agent-readable canvas. | **Adopt as the rendered side-effect of `CTX-OFFLOAD-1`** — graph spec is just Markdown + node IDs, no new runtime. |
| **Persona Markdown projection** with reverse-links to source atoms | `persona/traits.rs` writes a `PersonaPack` JSON; not human-readable; no source-trait links. | **Adopt later** — depends on `derived_from`. |

## 5. Explicitly **not** importing

- The `tdai_*` tool names and the exact OpenClaw / Hermes plugin shapes —
  TerranSoul already has its own MCP tool surface (`brain_*`, `code_*`).
- The `refs/*.md` filename convention — TerranSoul will store offloaded
  payloads in SQLite (`memory_sources` table) so it stays the single
  source of truth (see `rules/coding-standards.md` "do not treat Markdown as
  MCP memory").
- The DeepSeek-V3.2 / Tencent LKE LLM defaults — TerranSoul is provider-neutral
  (Ollama / OpenAI-compatible / Free-tier).
- The `persona.md` / `scenario.md` raw Markdown-on-disk projection as the
  source of truth — for the same reason as `refs/*.md`. We may add a
  read-only Markdown projection later (matches Obsidian export), but the
  authoritative store remains SQLite + KG edges.

## 6. Adoption chunks (proposed)

These will be filed in `rules/backlog.md` and promoted to
`rules/milestones.md` when scheduled. They are **scoped, additive, and
non-breaking**.

### MEM-DRILLDOWN-1 — `derived_from` edge kind + reverse-traversal helper

- Add `derived_from` as a recognized `rel_type` in `memory_edges` (no schema
  migration needed — column is already free-form TEXT).
- Plumb a `MemoryStore::source_chain(id)` helper that walks
  `derived_from` edges in reverse to return ordered ancestors.
- Add a Tauri command `brain_drilldown(memory_id)` returning
  `{summary, ancestors: [{id, content, kind}]}` so the UI can render the
  provenance ladder.
- Update `memory/brain_memory.rs::summarize` / `extract` callers to emit a
  `derived_from` edge from each new summary memory to every input memory.
- Add `MemoryView` UI affordance: "Show source memories" on any memory with
  outgoing `derived_from` edges.
- Tests: SQL round-trip, `source_chain` ordering, UI smoke.

### CTX-OFFLOAD-1 — Verbose tool-output offload for coding sessions

- New table column `memory_sources.offloaded_payload BLOB` (or sidecar row
  in a new `memory_offload_payloads` table keyed by `memory_id`).
- `coding/runtime_hooks` (already planned in OpenAgentd audit) gains an
  `offload_threshold_chars` setting; tool outputs above the threshold are
  written to the side table and replaced in-context with
  `{kind: tool_output_ref, id, summary, byte_count}`.
- New `brain_drilldown_payload(memory_id)` returns the raw bytes for a given
  ref, so the agent can re-inflate when needed.
- Quest unlock: surfaces as "Context Compression" in the skill tree.
- Tests: offload round-trip, summary fidelity, agent-side re-inflation.

### MEM-SCENARIO-1 — Optional per-task scenario aggregation tier

- Defer. Requires design review of whether to extend `MemoryType` (which
  ripples into every `add_many` call-site) or introduce a `scenario_id`
  column. Re-evaluate after MEM-DRILLDOWN-1 lands.

## 7. Verification & evidence trail

1. DeepWiki overview page fetched 2026-05-17, last indexed 2026-05-14
   (commit `285896f8`).
2. Upstream README fetched 2026-05-17 — confirmed L0–L3 mapping, hybrid
   retrieval (BM25 + vector + RRF), Mermaid context-offload pattern,
   plain-Markdown persona projection.
3. License confirmed MIT (`LICENSE`).
4. No source / prompts / asset names / branded identity copied.

When MCP is available, this research is also synced into
`mcp-data/shared/memory-seed.sql` (lesson
`seed:lesson-tencentdb-agent-memory-drilldown-2026-05-17`) so future
self-improve sessions can recall it without re-fetching the upstream.
