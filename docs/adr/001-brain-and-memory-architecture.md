# ADR 001 — Brain and memory architecture

**Status:** Accepted  
**Date:** 2025–2026 (ongoing)  
**Design doc:** [`docs/brain-advanced-design.md`](../brain-advanced-design.md)

This is the most foundational decision in TerranSoul.
Everything else — the LLM choice, the vector index, the MCP gateway,
the Tauri runtime — exists to serve this.

---

## Context

A desktop AI companion must remember who the user is across sessions.
The naive approaches fail:

| Approach | Failure mode at scale |
|----------|----------------------|
| Full context window dump | Token cost grows O(n); hours of use fill 32 k context |
| Vector-only RAG | No relations; multi-hop questions fail; stale facts rank next to fresh ones |
| Graph-only (SPARQL/RDF) | Poor fuzzy recall; requires complete entity resolution; sparse coverage |
| Pure FTS5 lexical | Misses paraphrases; no semantic similarity |
| External SaaS memory | Breaks offline/local-first posture; cost at scale; privacy risk |

## Decision

TerranSoul implements a **three-tier persistent memory store with cognitive-kind
classification, confidence decay, and a knowledge graph** — all in Rust, backed
by SQLite + a sidecar ANN index.

---

## The five pillars

### 1. Three-tier memory hierarchy

| Tier | Scope | Persistence | Lifecycle |
|------|-------|------------|-----------|
| `short` | Last ~20 chat turns | In-process ring buffer | Lost on session close |
| `working` | Session-scoped working set | SQLite `memories` table | Promoted or expired |
| `long` | Durable, cross-session | SQLite + embedding index | Decays, GC'd below threshold |

Promotion from `working` → `long` requires importance ≥ 4 or explicit user pin.
`long` memories with decay_score < 0.05 **and** importance ≤ 2 become GC candidates.

### 2. Cognitive kind classification

Every memory is tagged with a **cognitive kind** that controls its decay rate:

| Kind | Half-life | What it stores |
|------|-----------|---------------|
| `episodic` | 7 days | Specific events ("we talked about X last Tuesday") |
| `semantic` | 90 days | General facts ("user works at Acme Corp") |
| `procedural` | 60 days | How-to knowledge ("user prefers dark mode") |
| `judgment` | 365 days | Opinions and assessments ("user finds Y boring") |

Decay runs on a per-kind exponential curve:
`score(t) = 0.5 ^ (t_days / half_life_days)`

Fresh access resets the decay clock. Without access, episodic memories
evaporate in weeks; judgments persist for a year.

### 3. Category-prefix tagging

Memories are tagged with curated prefix vocabulary: `personal:*`, `relations:*`,
`habits:*`, `domain:law:*`, `skills:*`, `emotional:*`, `world:*`, `meta:*`.

These drive:
- Scoped retrieval ("only personal memories")
- Conflict detection (two contradicting `personal:health:*` facts)
- Per-category importance defaults

### 4. Knowledge graph (memory_edges)

The `memory_edges` table stores typed, directional, confidence-weighted edges:
`(source_id, target_id, relation_type, confidence, strength)`.

Uses:
- **Multi-hop retrieval** — "user's daughter's school" follows two edges
- **Cascade expansion** in the RAG pipeline
- **Contradiction detection** — `contradicts` edges flag conflicts for resolution

Edges are created by auto-extraction, entity-resolution passes, or manual assertion.

### 5. Confidence decay + GC + version history

- **Decay** — background maintenance job applies decay curves on a configurable
  schedule (default 24h interval, idle-guard to avoid fighting active chat).
- **GC** — decayed, low-importance memories are pruned to bound database size
  (configurable `max_long_term_entries`).
- **Append-only versioning** — conflicting facts create a new version row rather
  than overwriting, preserving provenance. Source-hash invalidation detects when
  ingested documents have changed.

---

## Why this over alternatives

| Alternative | Why insufficient |
|-------------|-----------------|
| LangChain MemoryBuffer | Stateless between sessions; no decay; no KG; no tier promotion |
| Redis + vector DB | External server; no relational joins; no decay; no conflict resolution |
| Full-context paste | 91.4 % more tokens per query; token budget exhausted for multi-session users |
| OpenAI memory API | No offline; no user control over what is remembered; cloud lock-in |

## Measured payoff (LongMemEval-S, 500 questions, 2026-05)

| Metric | TerranSoul | agentmemory baseline |
|--------|-----------|---------------------|
| R@5 | **99.2 %** | 95.2 % |
| R@10 | **99.6 %** | 98.6 % |
| NDCG@10 | **91.3 %** | 87.9 % |
| MRR | **92.6 %** | 88.2 % |
| Tokens/query | **2,798** | — |
| Full-context baseline | 32,660 tokens/query | — |
| Token savings | **91.4 %** | — |

## Related ADRs

- [ADR 002](002-hybrid-rag-pipeline.md) — the retrieval pipeline that uses this store
- [ADR 003](003-mcp-single-source-of-truth.md) — MCP as the access gateway
- [ADR 009](009-sqlite-for-memory.md) — why SQLite is the storage engine
- [ADR 010](010-tiered-vector-index.md) — ANN index architecture
