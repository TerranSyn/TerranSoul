# GraphRAG comparison — TerranSoul brain ↔ microsoft/graphrag

> **Source review note.** Research synthesised from
> [`https://deepwiki.com/microsoft/graphrag`](https://deepwiki.com/microsoft/graphrag)
> (last indexed 15 April 2026, commit `0da2a4dd`) per workspace rule, then
> cross-checked against the upstream [`microsoft/graphrag`](https://github.com/microsoft/graphrag)
> README, `docs/index.md`, and `docs/index/methods.md`. DeepWiki was reachable
> on the second attempt at the canonical host (`deepwiki.com`); the
> `deepwiki.org` mirror returned a redirect. No source, prompts, asset
> names, or branded identity were copied — only the public design ideas
> below were used, mapped onto TerranSoul's existing Rust/SQLite/Vue
> stack under neutral names. Attribution lives in
> [`CREDITS.md`](../CREDITS.md).

This document maps Microsoft's GraphRAG pipeline against TerranSoul's
existing brain pipeline, then picks three concrete, license-compatible
adoptions for the `GRAPHRAG-1a/1b/1c` sub-chunks. The intent is the same
shape as the existing
[`docs/repo-rag-systems-research-2026-05-16.md`](repo-rag-systems-research-2026-05-16.md)
and
[`docs/openagentd-audit.md`](openagentd-audit.md) audits: study the
public design, write the comparison, and propose neutral native
adoptions.

## 1. Pipeline at a glance

### microsoft/graphrag (Python, MIT)

1. **Indexing pipeline.** `load_input_documents` → `create_base_text_units`
   (chunking) → `extract_graph` (LLM entity + relationship extraction *or*
   FastGraphRAG NLTK/spaCy co-occurrence) → `summarize_descriptions`
   (LLM merges duplicate entity descriptions) → `cluster_graph` (Leiden
   hierarchical clustering) → `create_community_reports` (LLM produces
   per-community summary + rating) → `generate_text_embeddings` (vector
   embeddings for text units + entities + community reports).
2. **Storage layout.** Parquet tables under `output/`:
   `entities.parquet`, `relationships.parquet`, `communities.parquet`,
   `community_reports.parquet`, `text_units.parquet`. Optional GraphML
   snapshot for inspection.
3. **Query system.** Four strategies:
   - **Global search** — answers holistic dataset-level questions by
     map-reducing over `community_reports.parquet`.
   - **Local search** — answers entity-specific questions by walking
     entities + relationships + their associated text units.
   - **DRIFT search** — iterative refinement that combines global and
     local with a follow-up question loop.
   - **Basic search** — standard top-k vector RAG over `text_units`.
4. **Integration layers.** `graphrag-llm` (LiteLLM wrapper),
   `graphrag-storage` (file / blob / cosmos), `graphrag-vectors`
   (LanceDB / Azure AI Search / Cosmos DB).
5. **Methods.** "Standard" (LLM-everywhere, high fidelity, higher cost)
   vs "FastGraphRAG" (NLP-based extraction, co-occurrence relationships,
   cheaper).

### TerranSoul (Rust, MIT)

1. **Ingest.** `memory::chunking` (semantic chunking via the
   `text-splitter` crate) → `memory::contextualize` (Anthropic-style
   contextual retrieval prefix when configured) → optional
   `OllamaAgent::embed_text` (mxbai-embed-large 1024d default,
   nomic-embed-text 768d fallback, voyage / OpenAI / SiliconFlow cloud)
   → `memory::store` (SQLite `memories` row with `cognitive_kind`
   classification, decay, tier, importance, optional `parent_id`).
   Edges are written into `memory_edges` (cf. existing seed migrations +
   chat-time inference).
2. **Storage layout.** Single SQLite database
   (`mcp-data/memory.db`) sharded into 15 logical shards (3 tiers ×
   5 cognitive_kinds) with optional `usearch` HNSW ANN sidecars per
   shard, plus `memory_communities` (Chunk 16.6) for community summaries,
   `memory_sources` (BRAIN-REPO-RAG-1a) for per-repo provenance, and
   per-repo `repo_chunks` SQLite files under `mcp-data/repos/<id>/`.
3. **Query.** Hybrid 6-signal search (`vector_similarity` 40% +
   `keyword_match` 20% + `recency_bias` 15% + `importance` 10% +
   `decay_score` 10% + `tier_priority` 5%) → Reciprocal Rank Fusion
   (k=60) over three retrievers (vector / keyword / freshness) →
   optional HyDE → optional LLM-as-judge cross-encoder rerank →
   relevance-threshold gate → top-k injected as `[LONG-TERM MEMORY]`
   block. The dual-level `graph_rag_search` (Chunk 16.6) fuses
   entity-level hits with community-summary hits through the same RRF.
4. **Integration layers.** `brain::providers` (OpenAI / Ollama /
   free-tier OpenAI-compat / Pollinations / LM Studio),
   `memory::store::StorageBackend` (SQLite + Postgres + MSSQL +
   Cassandra), `usearch` for HNSW ANN.
5. **Methods.** Always semantic + LLM-judge; no separate FastGraphRAG
   mode yet.

## 2. Concept map

| GraphRAG concept | TerranSoul today | Gap |
|---|---|---|
| `text_units.parquet` | `memories` rows (chunked) | None — same content unit; SQLite row vs Parquet row. |
| `entities.parquet` | `memories.cognitive_kind` (`'episodic' | 'semantic' | 'procedural' | 'principle' | 'analytical'`) + chat-time entity extraction → `memory_edges` | TerranSoul does **not** materialise a separate `entities` table. Entities live implicitly as memories tagged `semantic`. |
| `relationships.parquet` | `memory_edges (src_id, dst_id, rel_type, confidence, source, created_at, edge_source, origin_device, hlc_counter)` | Strong parity, including confidence + provenance. |
| `communities.parquet` | `memory_communities (level, member_ids, summary, embedding, updated_at)` | Single-level today (`level=0` only). Multi-level hierarchy column exists but is unused. |
| `community_reports.parquet` | `memory_communities.summary` | Auto-generation deferred in Chunk 16.6; summaries today come from manual `brain_summarize` calls or stay null. |
| Global search | `graph_rag_search` always fuses entity + community via RRF | No dedicated global-search route; we always do dual-level fusion. |
| Local search | `MemoryStore::hybrid_search_rrf` + `expand_seeds_via_kg` (`commands::chat`) two-hop edge walk | Strong parity for entity-specific queries; this is the default chat path. |
| DRIFT search | None | Iterative refinement loop not implemented. |
| Basic search | `MemoryStore::keyword_search` keyword-only fallback when Ollama is offline | Parity. |
| Leiden hierarchical clustering | `memory::graph_rag::detect_communities` (Louvain/modularity-greedy single pass) | Single level only; no recursive sub-community detection. |
| Standard vs FastGraphRAG methods | Always uses the configured chat brain | No NLP-based co-occurrence fallback for low-cost extraction. |
| LiteLLM provider abstraction | `brain::providers` rotator | Parity. |
| Parquet / LanceDB / Azure / Cosmos vectors | SQLite shards + `usearch` HNSW + cloud `/v1/embeddings` | Different storage shape; same retrieval capability. |
| `settings.yaml` config | Tauri commands + per-mode JSON in `mcp-data/` | Different shape, same role. |

## 3. Where TerranSoul is already ahead

- **Hybrid 6-signal search.** TerranSoul fuses vector + keyword +
  recency + importance + decay + tier in one rank, while GraphRAG's
  basic search is plain top-k vector. The RRF fusion + HyDE +
  cross-encoder rerank stack is also more sophisticated than GraphRAG's
  default retrievers.
- **Confidence + decay on edges.** TerranSoul's `memory_edges` carries
  `confidence`, `decay_score`, and HLC-versioned CRDT metadata (Soul
  Link sync). GraphRAG's relationships have weights but no built-in
  temporal decay or CRDT story.
- **Cognitive-kind retrieval intent (Chunks 16.6a / 16.6b / 16.6c).**
  Every memory is classified at insert time (`episodic` / `semantic` /
  `procedural` / `principle` / `analytical`), and a query intent
  classifier boosts matching kinds by ×1.15 before rerank. GraphRAG
  does not have a comparable retrieval-time intent gate.
- **Per-repo source isolation.** `memory_sources` (BRAIN-REPO-RAG-1a)
  + per-repo `repo_chunks` SQLite (BRAIN-REPO-RAG-1b) + `terransoul`
  repo source (KNOWLEDGE-SPLIT-1) gives TerranSoul a cross-source
  retrieval model with version pinning per `repo_ref`. GraphRAG
  treats one corpus per output directory.
- **Local-first, offline-capable.** TerranSoul runs the full pipeline
  on Ollama with no cloud dependency. GraphRAG can use Ollama via
  LiteLLM, but the canonical examples assume cloud APIs.

## 4. Where microsoft/graphrag is ahead

1. **Hierarchical community summaries.** GraphRAG recurses Leiden so
   communities-of-communities yield a multi-level summary tree
   (level 0 = leaf clusters, higher levels = broader topics). At query
   time, "global search" map-reduces over the top-level community
   reports for a corpus-wide answer. TerranSoul stores `level` but only
   populates `level=0`.
2. **Structured entity/relationship extraction at ingest.** GraphRAG's
   `extract_graph` prompt produces typed entities + relationships with
   descriptions in one LLM call, then `summarize_descriptions` merges
   duplicates. TerranSoul writes most edges either through seed SQL or
   via chat-time KG inference; there is no dedicated ingest-time
   extraction step producing `(entity, relationship, target_entity,
   description)` quads.
3. **Global vs Local query routing.** GraphRAG dispatches by question
   shape: "what themes appear in the corpus?" → global; "what is X
   related to?" → local. TerranSoul always runs the same dual-level
   fusion, which under-uses community summaries when the question is
   inherently global and over-uses them when the question is narrow.
4. **DRIFT search.** Iterative follow-up loop that lets the model ask
   for more context after the first synthesis. Useful for compound
   questions, currently absent.
5. **FastGraphRAG method.** Optional NLTK/spaCy co-occurrence fallback
   for entity extraction when LLM cost is prohibitive. TerranSoul does
   not have a "no-LLM" extraction path for ingest.

## 5. Adoption decisions

Per [`rules/milestones.md`](../rules/milestones.md) `GRAPHRAG-1`
acceptance criteria, we adopt **three** concrete improvements as
follow-up sub-chunks. DRIFT (item 4) is deferred — the iterative
refinement loop is research-grade and conflicts with TerranSoul's
single-stream chat UX. FastGraphRAG (item 5) is deferred — TerranSoul
already runs against a local Ollama brain where extraction cost is
near-zero, so the cost incentive is weak.

| Sub-chunk | Adoption | Maps to |
|---|---|---|
| **GRAPHRAG-1a** | **Hierarchical community summaries** — recurse the existing Leiden pass so `memory_communities.level` carries levels 0..N (N capped at 4 for SQLite scan cost), then generate per-level LLM summaries through the active brain provider. New Tauri command `graph_rag_build_hierarchy` + extended `graph_rag_search` that can fetch a target level. | Item 1 above. |
| **GRAPHRAG-1b** | **Structured entity/relationship extraction at ingest.** New `memory::extraction::extract_entities_relationships(text, kind)` step in the ingest pipeline that calls the brain with a typed JSON-schema prompt, then materialises results as new `memories` rows (cognitive_kind=`semantic`) + `memory_edges` rows. Behind a `BrainConfig.graph_extract_enabled` toggle (default off for offline-only sessions). | Item 2 above. |
| **GRAPHRAG-1c** | **Global vs Local query routing.** Extend the existing query-intent classifier (Chunk 16.6b) with a third axis: `scope ∈ {global, local, mixed}`. Route `global` queries to the new hierarchical-community top-level summaries, `local` queries to the existing entity-walk path, and `mixed` queries to the current dual-level RRF fusion. | Item 3 above. |

Each sub-chunk lands as its own PR with isolated tests; the audit doc
stays the single source of truth for the design rationale.

## 6. Anti-patterns we will NOT copy

- **Parquet output format.** Adding Parquet as a second storage shape
  would fork the durable-knowledge surface; SQLite + per-repo SQLite
  is already the source of truth and `memory_edges` already exposes
  everything Parquet would.
- **Hard cloud-API assumptions.** GraphRAG examples lean on Azure /
  OpenAI; TerranSoul stays local-first by default.
- **DRIFT iterative refinement** — see §5.
- **Settings.yaml configuration surface.** TerranSoul's Tauri commands
  + Pinia store already cover provider configuration; introducing YAML
  would fragment the config UX.
- **LanceDB / Azure AI Search / Cosmos DB.** The `usearch` HNSW path
  plus the optional Postgres / MSSQL / Cassandra `StorageBackend` trait
  already covers TerranSoul's scale path (BENCH-SCALE-3 targets 10M
  docs).

## 7. References

- DeepWiki — [`microsoft/graphrag` overview](https://deepwiki.com/microsoft/graphrag),
  [Indexing Pipeline](https://deepwiki.com/microsoft/graphrag/4-indexing-pipeline),
  [Query System](https://deepwiki.com/microsoft/graphrag/5-query-system),
  [Knowledge Graph Schema](https://deepwiki.com/microsoft/graphrag/10.1-knowledge-graph-schema).
- Upstream — [`microsoft/graphrag` repo](https://github.com/microsoft/graphrag)
  (commit `0da2a4dd`), `docs/index.md` (24-51), `docs/index/methods.md`
  (5-29), `README.md` (22-30), `packages/graphrag/pyproject.toml`,
  `breaking-changes.md`.
- TerranSoul — `src-tauri/src/memory/graph_rag.rs` (Chunk 16.6),
  `src-tauri/src/memory/cognitive_kind.rs` (Chunks 16.6a/b/c),
  `src-tauri/src/memory/repo_ingest.rs` (BRAIN-REPO-RAG-1b),
  `mcp-data/shared/memory-seed.sql` (KNOWLEDGE-SPLIT-1).
