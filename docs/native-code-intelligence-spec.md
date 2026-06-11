# Native Code Intelligence — Architecture Specification

> **Chunk 37.1** — Clean-room architecture spec.
> Created: 2026-05-06.

---

## 1. Purpose

This document defines TerranSoul's native code-intelligence boundary,
existing modules, the parity roadmap, and guardrails that prevent
noncommercial dependency creep. All code intelligence is implemented in
Rust (`src-tauri/src/coding/`) and Vue (`src/`) using permissively licensed
libraries only.

---

## 2. Clean-Room Boundary

### What we MAY do

- Study public README, ARCHITECTURE.md, and generated DeepWiki pages of
  noncommercial projects for capability discovery.
- Credit the source in `CREDITS.md` and MCP seed memory.
- Implement equivalent functionality using neutral TerranSoul-native names,
  our own Rust/Vue code, and permissive crates (MIT/Apache-2.0/ISC/BSD/MPL-2.0).

### What we MUST NOT do

| Prohibited practice | Reason |
|---|---|
| Bundle, vendor, or auto-install GitNexus binaries, images, or packages | PolyForm-NC 1.0.0 |
| Copy source code, prompts, generated skills, or UI assets | PolyForm-NC 1.0.0 |
| Use `gitnexus` in code identifiers, Tauri commands, or UI labels | Naming hygiene |
| Default-spawn any noncommercial sidecar process | License + architecture |
| Add noncommercial npm/crate dependencies to package.json or Cargo.toml | License compliance |

### Permitted third-party crates (code intelligence)

| Need | Crate | License |
|---|---|---|
| AST parsing | `tree-sitter`, `tree-sitter-rust`, `tree-sitter-typescript` | MIT |
| Graph algorithms | `petgraph` | MIT/Apache-2.0 |
| ANN / embeddings | `usearch` | Apache-2.0 |
| SQLite | `rusqlite` (bundled) | MIT |
| HTTP client | `reqwest` | MIT/Apache-2.0 |
| Async runtime | `tokio` | MIT |

---

## 3. Existing Modules — Current State

### 3.1 Core Indexing Pipeline

```
src-tauri/src/coding/
├── symbol_index.rs   — Tree-sitter symbol extraction (Rust + TypeScript)
├── resolver.rs       — Cross-file import/call resolution with confidence tiers
├── processes.rs      — Label-propagation clustering + BFS execution traces
└── rename.rs         — Graph-backed symbol rename (dry-run + apply)
```

**SQLite schema** (8 tables in `mcp-data/`):
- `code_repos` — indexed repositories
- `code_symbols` — extracted symbols (name, kind, file, line, parent)
- `code_edges` — import/call relationships (target_file, target_symbol_id, confidence)
- `code_clusters` — community detection groups
- `code_cluster_members` — symbol → cluster mapping
- `code_processes` — entry-point-traced execution flows
- `code_process_steps` — BFS trace steps per process

### 3.2 Self-Improve & Workflow Engine

```
├── engine.rs              — Autonomous coding loop (milestone → plan → code → review → test → stage)
├── dag_runner.rs          — Multi-agent DAG execution with fan-out
├── workflow.rs            — CodingTask orchestrator
├── multi_agent.rs         — Agent roles (Planner/Coder/Reviewer/Tester/Researcher/Orchestrator)
├── prompting.rs           — XML-tag-structured prompt builder (10 Anthropic principles)
├── reviewer.rs            — LLM code review sub-agent
├── test_runner.rs         — Sandboxed cargo test + vitest runner
├── gate_telemetry.rs      — Quality gate observability
├── metrics.rs             — JSONL run logs + MetricsSummary
└── task_queue.rs          — Persistent SQLite task queue
```

### 3.3 Git & GitHub Integration

```
├── git_ops.rs    — Pull + LLM conflict resolution
├── github.rs     — OAuth device flow + PR creation
└── worktree.rs   — Git worktree management
```

### 3.4 MCP Tools (Exposed)

| Tool | Source | Function |
|---|---|---|
| `code_query` | `ai_integrations/mcp/` | Search symbols, files, clusters by query |
| `code_context` | `ai_integrations/mcp/` | Return grounded code context for a topic |
| `code_impact` | `ai_integrations/mcp/` | Map changed files to affected symbols/processes |
| `code_rename` | `ai_integrations/mcp/` | Dry-run + apply rename with graph confidence |

---

## 4. Parity Roadmap — Phase 37

| Chunk | Gap addressed | Key deliverable |
|---|---|---|
| 37.1 | Documentation | This spec + guardrail CI checks |
| 37.2 | Staleness detection | Content-hash per file; skip unchanged parse/embed/edge work |
| 37.3 | Language breadth | Parser registry + fixture tests for Python, Go, Java, C/C++ |
| 37.4 | Resolution depth | Re-exports, class heritage, receiver inference, return-aware bindings |
| 37.5 | Provenance | Confidence scores, source spans, resolver tier, provenance audit |
| 37.6 | Retrieval quality | Functional clusters with entry-point scoring; process-ranked search |
| 37.7 | Semantic search | BM25 + embedding + RRF over code symbols/processes |
| 37.8 | Pre-commit safety | Git diff → symbol mapping → risk buckets overlay |
| 37.9 | Rename confidence | Dry-run review payloads with high/low confidence buckets |
| 37.10 | Editor integration | MCP resources, guided prompts, setup writer |
| 37.11 | Developer UX | Vue workbench: graph canvas, file tree, code refs, chat citations |
| 37.12 | Discoverability | Generated neutral skills + wiki from summarization pipeline |
| 37.13 | Scale | Multi-repo groups, cross-service contracts |

---

## 5. Sidecar Removal — Completed

The following have been removed and must not be reintroduced:

- `src-tauri/src/memory/gitnexus_mirror.rs`
- `src-tauri/src/agent/gitnexus_sidecar.rs`
- `src-tauri/src/commands/gitnexus.rs` (7 Tauri commands)
- All Docker/npm/setup references to GitNexus auto-install

---

## 6. Dependency Creep Prevention

### 6.1 CI check (clippy + grep)

A script (`scripts/check-noncommercial-deps.mjs`) runs in CI to verify:

1. No `gitnexus` substring in `Cargo.toml`, `package.json`, `Dockerfile*`,
   or `docker-compose*.yml`.
2. No new PolyForm/SSPL/BSL/AGPL crate or npm package without explicit
   license-exception in `docs/licensing-audit.md`.
3. No `sidecar` references in Tauri command names or MCP tool names.

### 6.2 Architecture rules

Per `rules/architecture-rules.md`:
- Code intelligence lives entirely in `src-tauri/src/coding/` (Rust) and
  `src/components/coding/` (Vue).
- All parsing is in-process via bundled Tree-sitter grammars.
- No external process spawning for code indexing (generic plugin sidecars
  for ML inference are separate and opt-in).
- MCP tools use neutral names (`code_query`, `code_impact`, etc.).

---

## 7. Naming Conventions

| Layer | Pattern | Example |
|---|---|---|
| Rust module | `coding/{feature}.rs` | `coding/symbol_index.rs` |
| Tauri command | `code_{verb}` or `coding_{noun}_{verb}` | `code_query`, `coding_session_append_message` |
| MCP tool | `code_{verb}` | `code_query`, `code_impact` |
| Vue component | `Coding{Feature}.vue` | `CodingWorkbench.vue` |
| Pinia store | `useCoding{Feature}Store` | `useCodingSessionStore` |
| SQLite table | `code_{plural}` | `code_symbols`, `code_edges` |

---

## 8. Integration with Brain RAG

Native code recall is fused into the memory retrieval pipeline:

```
Stage 1   — RRF recall over SQLite memory (vector + keyword + freshness)
Stage 1.5 — Native code recall over code_symbols/code_edges/code_processes
            → entries with file/line/provenance metadata
            → RRF-fuse with Stage 1 candidates (k=60)
Stage 2   — Optional HyDE for cold/abstract queries
Stage 3   — Optional LLM-as-judge rerank (threshold 0.55)
Stage 4   — Top-k injection as [RETRIEVED CONTEXT] in system prompt
```

Code context entries carry `source: "code_index"` provenance so the chat
UI can render them with file links and line highlights.
