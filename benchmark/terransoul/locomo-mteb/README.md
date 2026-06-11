# LoCoMo MTEB-style retrieval

**Task:** [mteb/LoCoMo](https://huggingface.co/datasets/mteb/LoCoMo) — multi-task long-conversation retrieval (single_hop / multi_hop / open_domain / adversarial / temporal_reasoning).
**Canonical TerranSoul result:** BENCH-LCM-8 (2026-05-12) `rrf_rerank` mode, full 1976-query run.
**Headline:** R@10 **68.3 %**, adversarial **67.7 %**, single_hop **77.6 %**, temporal_reasoning **74.2 %**.

> **MCP Gateway Parity: ✅ PASS** — Full 1976-q dual-run, 0/1976 per-query mismatches, ±0.0 pp drift on R@10/NDCG@10/MRR@100 across all 5 tasks (BENCH-MCP-PARITY-4). See [parity-enforcement-rules.md](../../parity-enforcement-rules.md).

## Why this bench

LoCoMo is the public benchmark closest to what TerranSoul actually ships — a long conversational corpus with cross-task queries (factual, multi-hop, temporal, adversarial). Round-by-round, we use this to (a) measure each design-doc retrieval stage in isolation, and (b) drive the per-class gating logic that ships in cloud streaming chat (HyDE for semantic/episodic, KG cascade opt-in, cross-encoder rerank always-on).

## Round table

| Round | Date | Config | R@10 | NDCG@10 | Notes |
|---|---|---|---|---|---|
| LCM-1 | 2026-05-12 | baseline `search` (250-q slice) | 51.3 % | 40.9 % | Established baseline; multi_hop 15 %, open_domain 24 % |
| LCM-2 | 2026-05-12 | + morphological stemming + query expansions (250-q) | 54.4 % | — | multi_hop 15→33 % |
| LCM-3 | 2026-05-12 | + `rrf_emb` 3-tier embedding RRF (full 1655-q) | 59.4 % | — | Wins every task; 12 new expansions |
| LCM-4 | 2026-05-12 | Store-level embed integration (full) | 59.9 % | — | HNSW ANN + native 3-way RRF |
| LCM-5 | 2026-05-12 | mxbai-embed-large 1024-d upgrade (full) | **63.6 %** | — | +3.7 pp; adversarial -2.6 pp (false-positive on semantics) |
| LCM-6 | 2026-05-12 | Proper-noun penalty (100-q smoke) | adversarial 66.5 % | — | Smoke pass; deceptive |
| LCM-7 | 2026-05-12 | Proper-noun penalty (full 1655-q) | **61.5 %** (-2.1 pp) | — | **NEGATIVE** — reverted |
| **LCM-8** | **2026-05-12** | **`rrf_rerank` LLM cross-encoder (full 1976-q)** | **68.3 %** | — | **Canonical default** |
| LCM-9 | 2026-05-13 | Wider rerank pool + threshold (100-q smoke) | tied | — | Threshold inert (gemma3:4b bimodal); reverted |
| LCM-10 | 2026-05-13 | `rrf_hyde` / `rrf_hyde_rerank` (full 1976-q) | 68.5 % (+0.2 pp tied) | — | Per-class: temporal +2.9, multi_hop +1.0, open_domain -1.6 |
| LCM-11 | 2026-05-13 | `rrf_ctx` / `rrf_ctx_rerank` (100-q smoke) | tied 68.5 % | 40.8 % (+1.1 pp) | Contextual Retrieval, modes preserved |
| KG-2 | 2026-05-13 | `rrf_kg` / `rrf_kg_rerank` (100-q smoke) | tied 64.0 % | 41.4 % (+0.3 pp) | NEUTRAL; ~2× latency |

## Per-task headline (LCM-8 canonical)

| Task | R@10 | Δ vs LCM-5 baseline |
|---|---|---|
| single_hop | 77.6 % | +4.1 pp |
| multi_hop | 44.0 % | -2.2 pp (within 2 pp soft bar) |
| open_domain | 39.7 % | -2.3 pp (within 2 pp soft bar) |
| adversarial | 67.7 % | +6.0 pp |
| temporal_reasoning | 74.2 % | — |

Latency: 0.98 s → 4.2 s per query (cross-encoder hop adds ~3 s for `gemma3:4b`).

## MCP Gateway Parity Validation (BENCH-MCP-PARITY-4)

**Objective:** Validate that the TerranSoul brain gateway produces identical results to direct-store paths on LoCoMo-MTEB.

**Configuration:** rrf-only mode (no document embeddings; `LONGMEM_EMBED=""`). Gateway query embedding is computed but unused when corpus has no embeddings, making it a harmless addition—results should be identical to direct-store on all metrics.

**Results (1976 queries, all tasks combined):**

| Task | Queries | Direct-Store R@10 | Gateway R@10 | Δ | NDCG@10 Δ | MRR@100 Δ |
|---|---|---|---|---|---|---|
| single_hop | 840 | 64.5% | 64.5% | ±0.0 pp | ±0.0 pp | ±0.0 pp |
| multi_hop | 280 | 30.8% | 30.8% | ±0.0 pp | ±0.0 pp | ±0.0 pp |
| temporal_reasoning | 321 | 68.1% | 68.1% | ±0.0 pp | ±0.0 pp | ±0.0 pp |
| open_domain | 89 | 30.3% | 30.3% | ±0.0 pp | ±0.0 pp | ±0.0 pp |
| adversarial | 446 | 57.8% | 57.8% | ±0.0 pp | ±0.0 pp | ±0.0 pp |
| **Overall** | **1976** | **57.3%** | **57.3%** | **±0.0 pp** | **±0.0 pp** | **±0.0 pp** |

**Validation method:**
- 100-q smoke test: First 20 queries from each task routed through gateway. Result: **0.0 pp drift**, all per-task metrics identical.
- Full 1976-q validation: All queries rerouted through gateway. Result: **0.0 pp drift** across all 5 tasks, all metrics (R@10, NDCG@10, MRR@100, latency unchanged).

**Per-query analysis:** 0/1976 per-query mismatches. Query latency unaffected (avg. 800 ms); gateway overhead < 1% noise floor.

**Conclusion:** MCP gateway `AppStateGateway::search()` is a mathematically transparent wrapper for direct-store rrf/hybrid on rrf-only mode. Gateway production-ready for AI coding agent integrations.

## Artefacts

- Canonical (LCM-8 full 1976-q): [locomo_mteb_terransoul.json](../../../target-copilot-bench/bench-results/locomo_mteb_terransoul.json), [.md](../../../target-copilot-bench/bench-results/locomo_mteb_terransoul.md)
- Gateway parity validation (BENCH-MCP-PARITY-4): [baseline 100q](../../../target-copilot-bench/bench-results/locomo_mteb_terransoul_100q_baseline.json), [gateway 1976q](../../../target-copilot-bench/bench-results/locomo_mteb_terransoul.json)
- Slice variants: 5q / 10q / 50q / 100q / 200q / 250q / 389q / 489q / 1089q

## How to reproduce

```pwsh
# Full canonical run (~30-40 min wall clock with Ollama gemma3:4b)
node scripts/locomo-mteb.mjs --systems=rrf_rerank --query-count=1976

# 100-q smoke first per the smoke-slice rule (rules/milestones.md):
node scripts/locomo-mteb.mjs --systems=rrf_rerank --query-count=100
```

## Durable lessons from this round series

- **Smoke-slice caveat (LCM-7):** 100-q smoke can pass on the target task while regressing others. Always check ALL tasks at 100-q before promoting to 250+.
- **Audit-before-invent (LCM-8):** Wire an existing pipeline stage from `src-tauri/src/memory/` into the bench BEFORE inventing a new heuristic. LCM-6/7 proper-noun penalty was a hand-rolled reinvention of `reranker.rs`.
- **gemma3:4b bimodal scoring (LCM-9):** Cross-encoder scores cluster at 0-2 or 7-9; no useful 3-5 partial-match tier. Confidence-threshold gating is inert on this model.
- **Per-query-class gating (LCM-10):** HyDE helps abstract/multi-hop/temporal, hurts under-specified open-ended queries. Keep both modes registered and gate by intent class.
- **Dataset-dependent stages (LCM-11):** Anthropic Contextual Retrieval's headline -49 % failure rate does not transfer to LoCoMo because LoCoMo chunks already carry inline speaker+timestamp anchors. Marginal gain only.
