# ADR 002 — Hybrid RAG pipeline (6-signal, RRF, intent gating)

**Status:** Accepted  
**Date:** 2025–2026  
**Design doc:** [`docs/brain-advanced-design.md`](../brain-advanced-design.md) §§ 3–5

---

## Context

Retrieval-Augmented Generation is only useful if the retrieved memories are
relevant, fresh, and non-contradictory. Vector-only RAG consistently fails on:

1. **Multi-hop relational questions** — cosine distance doesn't encode `reports_to` edges.
2. **Schema-bound entity questions** — 16.7 % GPT-4 accuracy on structured SQL vs 54.2 % with a knowledge graph (2023 benchmark).
3. **Stale-truth conflicts** — old embeddings rank next to new facts without a temporal layer.
4. **Exact-identifier queries** — `error:E0308` or `file://src/lib.rs` round-trips poorly through embeddings.

## Decision

Run **four parallel retrievers**, fuse with **Reciprocal Rank Fusion (RRF, k=60)**,
apply **6-signal post-fusion scoring**, optionally expand via **HyDE and cascade**,
rerank with an **LLM-as-judge**, and enforce a **relevance threshold cutoff**.
Gate the whole pipeline on **query intent** to skip expensive stages for trivial turns.

---

## Pipeline

```
User query
  │
  ├── GATE: trivial query? → skip RAG entirely
  │
  ├── [INTENT] classify: factoid / procedural / relational / temporal
  │
  ├── embed_text()           → vector HNSW candidates
  ├── FTS5 + BM25 weighting  → lexical candidates
  ├── entity → graph seed    → 1-hop KG neighbours
  └── freshness retriever    → recency × decay-weighted candidates
              │
       Reciprocal Rank Fusion (k = 60)
              │
       6-signal post-fusion scoring (weighted sum)
              │
       session diversification (cap noisy session clusters)
              │
       HyDE? (cold/abstract query — LLM writes hypothetical answer → embed that)
              │
       cascade expand? (1-hop KG neighbours of RRF seeds)
              │
       cross-encoder rerank (LLM-as-judge 0–10 per (query, doc))
              │
       relevance threshold cutoff (configurable, default 0.30)
              │
       [LONG-TERM MEMORY] block → system prompt → LLM
```

## The 6 scoring signals

After RRF, each candidate is scored by a tunable weighted sum:

| Signal | Default weight | Captures |
|--------|---------------|---------|
| `vector_similarity` | 0.40 | Semantic proximity to query embedding |
| `keyword_match` | 0.20 | BM25-style exact-term overlap |
| `recency` | 0.15 | Time since last access (freshness) |
| `importance` | 0.10 | User-assigned or auto-assigned importance score |
| `confidence_decay` | 0.10 | Per-cognitive-kind exponential decay (see ADR 001) |
| `tier_priority` | 0.05 | `long` > `working` > `short` tier bonus |

All weights are `AppSettings` fields — zero recompile for tuning. The defaults
were calibrated on LongMemEval-S to maximize R@10 while keeping prompt token cost
below 3 000 tokens/query.

## Why RRF over 4 retrievers?

RRF's robustness property: if one retriever returns garbage on a query, the
worst case is that retriever contributes nothing — it cannot actively poison
the top-k. This is critical because:
- The KG may have sparse edges on a fresh install (few auto-extracted edges).
- The freshness retriever degenerates to a no-op when all memories are old.
- The FTS5 lexical retriever fails on semantic paraphrases.

The vector retriever alone fails on all four failure modes listed above.
The combination degrades gracefully.

## Why query-intent gating?

Blindly running all four retrievers + HyDE on every turn wastes:
- ~1 LLM call per turn for HyDE (a hypothetical-answer expansion)
- ~150 ms for KG traversal on "hi" / "ok" turns

A fast classifier (< 5 ms) routes:
- **Trivial turns** (greeting, acknowledgement, very short) → skip RAG entirely
- **Factoid queries** → skip HyDE, run fast FTS5 + vector
- **Relational queries** → emphasise KG traversal, skip freshness
- **Cold/abstract queries** → enable HyDE

This keeps median first-token latency under 500 ms on `gemma3:4b`.

## Optional pipeline stages

| Stage | `AppSettings` flag | Cost | Benefit |
|-------|-------------------|------|---------|
| Contextual retrieval | `contextual_retrieval` | +1 LLM call/chunk at ingest | ~49 % fewer failed retrievals (Anthropic 2024) |
| Late chunking | `late_chunking` | Requires long-context embed model | Better cross-sentence context for large documents |
| HyDE | `hyde_enabled` | +1 LLM call/cold query | Lifts recall on abstract queries |
| KG cascade | `enable_kg_boost` | +1 BFS hop per seed | Answers multi-hop questions without LLM prompting |
| Web search fallback | `web_search_enabled` | HTTP to DuckDuckGo | CRAG: supplements context when local retrieval is rated "Incorrect" |
| Cross-encoder rerank | automatic | +1 LLM call/top-30 | NDCG@10 lifts ~3 points; configurable threshold |

## Measured results

LongMemEval-S (500 questions): R@5 **99.2 %**, R@10 **99.6 %**, NDCG@10 **91.3 %**, MRR **92.6 %**.  
Token cost: **2 798 tokens/query** vs 32 660 for full-context — **91.4 % cheaper**.

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — the memory store this pipeline queries
- [ADR 003](003-mcp-single-source-of-truth.md) — MCP as the access gateway
- [ADR 010](010-tiered-vector-index.md) — ANN index used for vector retrieval
