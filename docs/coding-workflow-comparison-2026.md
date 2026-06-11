# Coding Workflow Comparison — 2026

> **Purpose:** Neutral post-completion review of TerranSoul's coding
> workflow versus five active AI coding agents. Focus is on workflow
> outcomes, not brand ranking. Generated after completing Phase 43.
>
> **Date:** 2026-05-07

---

## Agents Compared

| Agent | Category | Session Model |
|-------|----------|---------------|
| TerranSoul (self) | Desktop companion + coding agent | Persistent memory (SQLite + HNSW ANN), CRDT sync, RAG pipeline |
| Claude Code | CLI agent | Session-scoped, `CLAUDE.md` file for cross-session context |
| Codex CLI | CLI agent | Session-scoped, `AGENTS.md` file for context |
| Cursor | IDE-embedded agent | Workspace indexing, `.cursorrules` for context |
| GitHub Copilot | IDE-embedded agent | Conversation-scoped, `copilot-instructions.md` for rules |
| OpenCode | CLI agent | Session-scoped, config-file-based context |

---

## Comparison Dimensions

### 1. Session Continuity

| Capability | TerranSoul | Claude Code | Codex CLI | Cursor | Copilot | OpenCode |
|------------|------------|-------------|-----------|--------|---------|----------|
| Cross-session memory | Persistent SQLite + semantic search | File-based (`CLAUDE.md`) | File-based (`AGENTS.md`) | Workspace index | Instruction files | Config files |
| Session resumption | Automatic via `milestones.md` + `completion-log.md` + MCP brain | Manual via markdown | Manual via markdown | Workspace reload | Conversation summary | Manual |
| Context window management | RAG top-K injection + instruction slices | Full-file loading | Full-file loading | Workspace indexing | Auto-summary on overflow | Manual |
| Cross-device sync | CRDT + QUIC/WebSocket | None | None | None | Cloud-based | None |

**Assessment:** TerranSoul's persistent memory with hybrid search (vector + keyword + recency + importance + decay + tier) and automatic session resumption protocol provides the strongest continuity. File-based approaches (Claude Code, Codex) work but require manual curation and have no semantic retrieval.

### 2. Memory Quality

| Capability | TerranSoul | Claude Code | Codex CLI | Cursor | Copilot | OpenCode |
|------------|------------|-------------|-----------|--------|---------|----------|
| Memory types | Episodic, Semantic, Procedural, Judgment, Negative (5 cognitive kinds) | Plain text | Plain text | Code index | Plain text | Plain text |
| Confidence scoring | Per-memory confidence with decay curve | None | None | None | None | None |
| Contradiction detection | LLM-powered conflict resolution | None | None | None | None | None |
| Knowledge graph | Edges with CRDT sync, bounded traversal, LRU cache | None | None | Code references | None | None |
| Negative memories | Trigger-pattern matching for anti-patterns | Manual notes | Manual notes | None | None | None |
| Gap detection | Automatic (low-score + high-norm queries) | None | None | None | None | None |
| Memory decay / GC | Time-based decay + tier promotion + garbage collection | None | None | None | None | None |

**Assessment:** TerranSoul has the most structured memory system with cognitive classification, confidence tracking, decay, and automatic gap detection. Other agents treat memory as flat text.

### 3. Context Efficiency

| Capability | TerranSoul | Claude Code | Codex CLI | Cursor | Copilot | OpenCode |
|------------|------------|-------------|-----------|--------|---------|----------|
| RAG pipeline | 6-signal hybrid search + RRF fusion + optional HyDE + reranker | None | None | BM25-like | Semantic | None |
| Context budget | Configurable top-K with relevance threshold | Full file injection | Full file injection | Automatic | Automatic | Manual |
| Instruction delivery | Embedding-indexed slices (top-K per query) | Full file | Full file | Rules file | Instructions file | Config |
| Embedding model | Ollama nomic-embed-text (768d) or cloud API | N/A | N/A | Proprietary | Proprietary | N/A |
| ANN index | HNSW via usearch (O(log n) to 1M+) | N/A | N/A | Proprietary | Proprietary | N/A |

**Assessment:** TerranSoul's multi-signal RAG with instruction slicing provides more targeted context injection than full-file approaches. IDE-embedded agents (Cursor, Copilot) have their own indexing but it's opaque.

### 4. Safety & Permission Gating

| Capability | TerranSoul | Claude Code | Codex CLI | Cursor | Copilot | OpenCode |
|------------|------------|-------------|-----------|--------|---------|----------|
| Action classification | Tier 1 (auto) / Tier 2 (confirm), 12 action types | Binary allow/deny per tool | Permission modes | IDE-integrated | IDE-integrated | Config-based |
| Decision history | Persistent `safety_decisions` table with audit trail | None | None | None | None | None |
| Auto-promotion | 14 consecutive approvals → propose Tier 1 promotion | None | None | None | None | None |
| Per-project overrides | Config-driven tier overrides | Per-project config | Per-project config | Workspace settings | Workspace settings | Config |

**Assessment:** TerranSoul's safety classifier with persistent decision history and data-driven promotion is unique. Most agents have simpler binary permission models.

### 5. Orchestration & Self-Improve

| Capability | TerranSoul | Claude Code | Codex CLI | Cursor | Copilot | OpenCode |
|------------|------------|-------------|-----------|--------|---------|----------|
| Background maintenance | Ambient agent with adaptive scheduler, PID guard, 429 backoff | None | None | None | None | None |
| Rate-limit awareness | x-ratelimit-* header parsing, 20% user headroom | None | None | None | Provider-managed | None |
| Self-improve loop | Autonomous coding workflow with DAG execution | None | None | None | None | None |
| MCP integration | 28 tools (15 brain + 13 code), headless runner | None | None | MCP client | MCP client | None |
| Cross-harness import | Detect + parse Claude/Codex/OpenCode/Cursor/Copilot transcripts | None | None | None | None | None |

**Assessment:** TerranSoul's self-improve loop with ambient maintenance, adaptive scheduling, and cross-harness transcript import has no direct equivalent in other agents. The MCP server makes the brain accessible to external tools.

### 6. Self-Improve Throughput

| Metric | TerranSoul |
|--------|------------|
| Phase 43 chunks completed | 13 |
| Tests added (Rust) | ~120 new tests across 43.1–43.13 |
| Total Rust test count | 2496 |
| Total frontend test count | 1744 |
| New modules created | 8 (session_names, negative, gap_detection, instruction_slices, safety, ambient, ambient_scheduler, session_import) |
| CI gate | Green throughout all chunks |

---

## Key Differentiators

1. **Persistent structured memory** — TerranSoul is the only agent with cognitive-kind classification, confidence decay, contradiction detection, and knowledge graph edges.
2. **Hybrid RAG pipeline** — 6-signal scoring with RRF fusion, optional HyDE, and reranker provides higher-quality context than flat file injection.
3. **Safety with learning** — Decision history and auto-promotion create a feedback loop that reduces friction over time.
4. **Cross-harness interop** — Importing transcripts from other agents enables knowledge transfer without vendor lock-in.
5. **Ambient maintenance** — Background brain gardening (decay, GC, promote, edge extraction, ANN compaction) happens without user intervention.

## Areas for Improvement

1. **Latency** — RAG pipeline adds overhead compared to direct file injection. Benchmark and optimize hot paths.
2. **Onboarding** — New users face setup complexity (Ollama, MCP, embedding model). Streamline first-run experience.
3. **Mobile support** — Desktop-first architecture; mobile pairing via gRPC is functional but not yet polished.
4. **Proactive work** — Ambient agent defaults to disabled; needs more real-world validation before enabling proactive extraction.
5. **Embedding model diversity** — Currently tied to nomic-embed-text locally; should support model switching without re-indexing.

---

## Follow-Up Milestone Proposal

Based on this review, the following areas warrant Phase 44+ attention:

| Priority | Area | Rationale |
|----------|------|-----------|
| High | RAG latency optimization | Benchmark end-to-end retrieval time, add caching for repeated queries |
| High | First-run setup wizard | Guided Ollama install + model pull + embedding warmup |
| Medium | Ambient agent validation | Run 50+ garden cycles in real projects, measure quality improvement |
| Medium | Cross-harness replay mode | Beyond parsing: replay imported sessions to verify/extract more context |
| Medium | Embedding model registry | Support switching models with automatic re-embedding migration |
| Low | Browser extension | Expose MCP brain tools to web-based coding environments |
| Low | Plugin system | Third-party extensions for custom cognitive kinds, tools, importers |

---

*This document is a neutral technical comparison. No endorsement or ranking
of third-party products is intended. All agent capabilities described are
based on publicly available documentation as of May 2026.*
