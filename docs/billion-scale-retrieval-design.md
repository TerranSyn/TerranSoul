# Billion-Scale Retrieval & Graph — Design

> Status: **Phases 1, 4, 5, and cross-cutting complete.** Honest scoping doc.
> Phases 2 and 3 remain roadmap. Land in priority order; each phase is
> independently shippable.
> Last updated: 2026-05-11

> **TL;DR — how TerranSoul reaches 1 M+/s CRUD on a knowledge-graph RAG store
> on a single workstation:** SQLite WAL (source of truth) is sharded by
> `(tier × cognitive_kind)` into 15 routed shards so writes never serialize on
> one B-tree; each shard owns its own IVF-PQ+HNSW vector index (`usearch`,
> `i8`/`b1`/PQ quantized) sitting next to FTS5 keyword + recency/decay signals,
> and reads fuse those 6 signals per shard then merge via RRF — turning a
> global O(N) search into K parallel O(log N/K) probes that batch-embed
> through Ollama `/api/embed` and pin hot vectors in RAM while cold ones page
> from disk. Net effect: ~1 M+ row-level CRUD/s sustained on a workstation
> with proportionally tiny graph/RAG retrieval latency at billion-scale.

## Why this exists

TerranSoul's brain currently scales comfortably to ~10 million long-term memories
on a single workstation (SQLite + a single `usearch` HNSW index with optional
`i8` / `b1` quantization, plus a 6-signal hybrid search and an RRF fusion path).
Past ~100M the single-index design starts to fall over:

- Build time for one global HNSW becomes hours, and a single corrupt write can
  invalidate the whole index.
- RAM usage of a single index dominates the working set even with `i8` quant
  (≈ 768 B/vec × 100M = 76.8 GB).
- Hybrid search latency degrades because keyword + recency + decay signals all
  scan one large table.
- The 2D graph viewport tries to materialize every node into JS memory, which
  is impossible past ~50k nodes on Canvas2D (and the screen has only ~2M pixels
  anyway).

This doc captures the path to **1B records, single machine** for both
chat/MCP retrieval and the graph viewport.

## Non-goals

- Distributed clusters / multi-host sharding. Local-first is the product.
- Replacing SQLite as the source of truth. We add indexes around it.
- Real-time interactive rendering of a billion nodes simultaneously. That is
  physically impossible at any zoom level — the screen does not have a billion
  pixels. The graph UX is always **viewport + LOD streaming**.

## Honest physical limits

| Resource | 1B vectors @ 768 dim | Notes |
|---|---|---|
| Raw `f32` | 3.07 TB | Disk-only territory. |
| `i8` quant | 768 GB | Still too big for typical RAM. |
| `b1` quant | 96 GB | Fits high-end workstation RAM; recall loss real. |
| PQ (m=96, nbits=8) | 96 GB → ~96 B/vec | Industry standard for >100M. |
| OPQ + IVF + PQ | ~24–48 GB hot working set | DiskANN / FAISS-IVFPQ class. |

Implication: at 1B scale, **the index does not live entirely in RAM**, and
**a single index is not appropriate**. We need sharding + a coarse router.

## Phase plan

### Phase 1 — Foundation (this PR)

Land additive scaffolds and one user-visible win. No breaking changes.

1. **Shard-aware retrieval scaffold** (`memory/sharded_retrieval.rs`)
   - `ShardKey` derived from `(tier, cognitive_kind)` — 3 × 4 = 12 logical
     shards out of the box, all still living in the same SQLite for now.
   - `ShardedHybridSearch::search(query, query_emb, k)`: runs top-K per shard
     via the existing `hybrid_search_rrf`, then merges results across shards
     with RRF (k=60).
   - Cap on rerank pool (default 50) — never rerank thousands of candidates;
     pruning happens before the LLM-as-judge stage.
   - Opt-in via brain config flag. Default off until performance is verified.
2. **Paged graph endpoint** (`commands/memory.rs::memory_graph_page`)
   - Inputs: optional focus id, zoom level (`overview` / `cluster` / `detail`),
     node limit (default 2 000, max 10 000).
   - Returns: nodes ranked by `degree desc, importance desc, recency desc` plus
     edges that touch the returned node set.
   - For overview zoom: aggregates by `cognitive_kind` into supernodes; edges
     between supernodes are aggregated link counts.
   - Backend never returns more than `limit` nodes — the frontend cannot stall
     by asking for "everything".
3. **WebGL graph renderer** in `src/components/MemoryGraph.vue`
   - Sigma.js WebGL backend with the Obsidian-style chrome already in place.
   - Pulls a page from `memory_graph_page` on viewport change / zoom / focus.
   - Falls back to in-memory props when the host doesn't expose the new
     command (preserves Vitest / non-Tauri usage).
4. **Design doc** (this file) + milestone breakdown in `rules/milestones.md`.

### Phase 2 — Sharded HNSW (single-process) (✅ Shipped — Chunk 48.2/48.3/48.8/48.9)

- ✅ One `usearch` index per `ShardKey`, files under
  `<app-data>/vectors/<shard>.usearch`, each with its own quantization sidecar.
- ✅ Coarse router: a tiny IVF-style centroid lookup built from a 1% sample of
  embeddings to predict the top-`p` shards per query.
- ✅ Router persistence + reload: `shard_router.json` now stores centroid
  vectors + shard mapping so `load_shard_router()` can hydrate a queryable
  router across restarts instead of always rebuilding.
- ✅ `ShardedHybridSearch` consults the router → vector top-K per shard →
  RRF merge → keyword/decay/recency reranker on the union.
- ✅ `MemoryStore::rebalance_shards()` is available.
- ✅ Dedicated router refresh policy:
  - time trigger (stale/missing) + volume trigger (mutation delta),
  - cooldown-gated to avoid repeated on-query rebuild bursts,
  - forced scheduled refresh via maintenance `AnnCompact` path.

#### Bench instrumentation — `ShardMode` toggle (BENCH-SCALE-2, 2026-05-14)

To measure the coarse router's actual contribution to retrieval latency
and recall at 1M+ docs (the original Phase 2 design assumption), the
LoCoMo-at-scale bench can now force the production retrieval path
through one of two policies via the new
[`MemoryStore::set_shard_mode`](../src-tauri/src/memory/store.rs)
toggle:

| `ShardMode` | Behavior | Use case |
|---|---|---|
| `RouterRouted` (default) | Cached router → persisted router → throttled rebuild → fall back to all 15 shards. Production-equivalent. | All production calls; bench A-arm. |
| `AllShards` | Bypass the router entirely; every query probes every shard. | Bench B-arm: "single-index-style" baseline that quantifies how much the coarse router saves. |

The `longmemeval-ipc` bench binary reads `LONGMEM_SHARD_MODE` (values:
`routed` / `router` / `default` / unset → `RouterRouted`; `all` /
`allshards` / `all_shards` / `single` → `AllShards`; unknown → warn +
fallback) and calls `set_shard_mode` immediately after constructing the
in-memory store, on both `new()` and `reset()` paths.

The `scripts/locomo-at-scale.mjs` harness exposes the toggle as
`--shard-mode={routed,all}` (default `routed`), plumbs it into the
spawned bench process via `LONGMEM_SHARD_MODE`, records `shard_mode`
in the JSON report, and includes it in both the output filename
(`locomo_scale_<N>_<task>_<Q>q_<mode>.json`) and the markdown report
header — so a back-to-back router-routed vs all-shards comparison run
does not overwrite the earlier report (the overwrite footgun BENCH-
SCALE-1b hit in 2026-05-13).

**Comparison protocol (suggested for the actual 1M run):**

```pwsh
# Arm A — router-routed (production default)
node scripts/locomo-at-scale.mjs run --task=adversarial `
  --systems=rrf --scale=1000000 --limit=100 --shard-mode=routed

# Arm B — all-shards probe (no-router baseline)
node scripts/locomo-at-scale.mjs run --task=adversarial `
  --systems=rrf --scale=1000000 --limit=100 --shard-mode=all
```

Report (deltas A − B): R@10, NDCG@10, MRR, p50 / p95 / p99 retrieval
latency, ingest time, peak RSS. The router is expected to **reduce
latency** (fan-out to ~2–3 shards instead of 15) while keeping recall
flat once 1% of the corpus has been ingested and the router has
rebuilt at least once. Disagreement on recall surfaces a routing bug;
disagreement on latency surfaces a fan-out bug.

### Phase 3 — Disk-backed ANN (PQ / IVF-PQ) (✅ Code shipped — Chunk BENCH-SCALE-3a)

- ✅ Kickoff planner surface (`memory/disk_backed_ann.rs` +
  `MemoryStore::disk_ann_plan`) reports per-shard migration candidates by
  threshold and ANN index-file presence for deterministic rollout sequencing.
- ✅ IVF-PQ full implementation (`memory/ivf_pq.rs`):
  - Proper k-means with Lloyd's algorithm + k-means++ initialization
  - IVF coarse quantizer training (nlist centroids on full corpus)
  - PQ codebook training on residual subspaces (256 centroids × pq_m subquantizers)
  - PQ encoding (residual → pq_m bytes per vector)
  - ADC (Asymmetric Distance Computation) search with nprobe cell probing
  - Custom binary file format for fast load/save
- ✅ Integration: `build_ivf_pq_for_shard()` consumes sidecars → builds indexes;
  `search_ivf_pq()` provides the search path; `build_ivf_pq_indexes` Tauri command.
- ⏳ Remaining: actual 10M+ corpus bench run (~40h wall clock on dedicated hardware).

- For shards > N million entries, build IVF-PQ indexes (target m=96, nbits=8)
  using the pure-Rust IVF-PQ implementation in `memory/ivf_pq.rs`.
- Memory-map shard files; only the active centroid lists are paged into RAM.
- Refresh PQ codebooks during nightly compaction.

### Phase 4 — Keyword + recency scale-out (✅ Shipped — Chunk 48.5)

- ✅ FTS5 external-content virtual table `memories_fts` with unicode61
  tokenizer, auto-sync INSERT/UPDATE/DELETE triggers, and
  `keyword_candidate_ids_fts5()` fast path with INSTR fallback.
- ✅ Schema V21 creates FTS5 table per-shard (via `ensure_v21_fts5()`).
- Store `last_accessed` and `decay_score` in a covering index so recency
  signals never scan the full table.

### Phase 5 — Graph at 1B (✅ Shipped — Chunk 48.6)

- ✅ Composite covering indexes `(src_id, rel_type)` and `(dst_id, rel_type)`
  on `memory_edges` enable O(log n) filtered adjacency queries.
- ✅ `memory_graph_clusters` pre-aggregated table refreshed during
  `AnnCompact` maintenance job.
- ✅ `memory/graph_paging.rs` module with `get_edges_paged()`,
  `get_top_degree_nodes()`, `get_graph_clusters()`, `graph_totals()`.
- ✅ `memory_graph_page` command uses paged adjacency fast path for
  detail zoom + focus_id (loads only neighbourhood, not entire graph).
- Frontend never holds more than ~5 000 nodes simultaneously. Cluster
  supernodes at overview zoom, expand on focus.

## Cross-cutting rules (✅ Shipped — Chunk 48.7)

- **No global locks during search.** Per-shard `RwLock`, parallel queries via
  `rayon` or `tokio::task::spawn_blocking`.
- **Bounded rerank.** LLM-as-judge runs on at most `rerank_cap` (default 50)
  candidates regardless of `limit`.
- **Hot-cache.** ✅ Last N query → top-K results cached for ≤ 60 s to absorb
  duplicate chat-loop calls. (`search_cache.rs`, `DEFAULT_TTL_MS = 60_000`.)
- **Backpressure.** ✅ Ingest jobs that would push a shard past
  `shard_max_entries` (default 2M per logical shard) are rejected with
  `BackpressureError`; callers must split/rebalance.
  (`memory/shard_backpressure.rs`, `DEFAULT_SHARD_MAX_ENTRIES = 2_000_000`.)
- **No silent fallbacks.** ✅ If a shard's index is missing/corrupt, the
  `shard_health_summary()` reports it through `HealthResponse.shard_health`
  in the `brain_health` MCP tool; it does not pretend the result set is
  complete. (`ai_integrations/gateway.rs`.)

## Phase 1 acceptance

- [x] `memory/sharded_retrieval.rs` exists with unit tests covering shard
      key derivation, top-K-per-shard, and RRF merge.
- [x] `commands/memory.rs::memory_graph_page` exists with unit tests for
      limit enforcement and supernode aggregation.
- [x] `MemoryGraph.vue` renders via sigma.js when available, with Canvas2D
      fallback for environments without WebGL (Vitest / jsdom).
- [x] Existing test suites stay green: `npx vitest run`, `cargo test --lib`.
- [x] Design doc + milestone entry committed.

## Latency acceptance — two bars, one pipeline

A single end-to-end p99 number conflates two very different stages and was the
source of the BENCH-SCALE-1 "FAIL by design" reading. Acceptance is split:

| Bar | Pipeline measured | Target | Why |
|-----|-------------------|--------|-----|
| **Retrieval-only p99** | embed → keyword + freshness RRF → HNSW ANN → optional KG cascade. **No LLM in the loop.** | ≤ 200 ms at 100k, ≤ 500 ms at 1M (Phase 2 sharded HNSW) | This is the actual scaling claim: HNSW is `O(log n)`, RRF is linear in top-K. Latency must stay flat as the corpus grows. |
| **End-to-end-with-rerank p99** | Retrieval bar + cross-encoder rerank pool (50 candidates × LLM judgement). | **No fixed bar** — LLM-bound | Reranker cost scales with model size and provider, not corpus size. Local `gemma3:4b` reranker runs ~6 s/query regardless of whether the corpus has 5k or 100M rows. Measure and report, but do not gate Phase progression on it. |

**Rule of thumb:** the 200 ms / 500 ms bars apply to `--systems=rrf` runs
(retrieval-only). When `--systems=rrf_rerank` is used, latency is dominated by
the reranker — track it, but use it as a cost signal (cloud rerank pricing,
local VRAM occupancy) rather than a scaling regression.

BENCH-SCALE-1 (2026-05-13, end-to-end @ 100k, mxbai-embed-large + gemma3:4b
rerank) measured p99 = 30.77 s — the LLM reranker, not the index. BENCH-SCALE-1b
re-runs the same 100k corpus with `--systems=rrf` to validate the retrieval-only
bar separately.

## References (credit in `CREDITS.md` when applicable)

- [brain-advanced-design.md](brain-advanced-design.md) — canonical brain/memory
  architecture (this doc extends its §16 Scaling Roadmap Phase 7).
- [brain-advanced-design-mappings-features.md](brain-advanced-design-mappings-features.md)
  — per-feature chatbox audit that maps billion-scale infra to daily use.
- Cormack et al., "Reciprocal Rank Fusion outperforms Condorcet and individual
  rank learning methods", SIGIR 2009.
- Subramanya et al., "DiskANN: Fast Accurate Billion-point Nearest Neighbor
  Search on a Single Node", NeurIPS 2019.
- Jégou, Douze, Schmid, "Product quantization for nearest neighbor search",
  IEEE TPAMI 2011.
- Anthropic, "Contextual Retrieval", 2024.
- `unum-cloud/usearch` and `facebookresearch/faiss` for the index implementations.
- `jacomyal/sigma.js` for the WebGL graph renderer used in the viewport.
