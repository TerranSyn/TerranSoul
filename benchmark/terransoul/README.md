# TerranSoul bench rounds — chronological index

Every TerranSoul retrieval-quality bench run is logged here with status, headline metric, and a link to the raw JSON / markdown artefact under `benchmark/results/`. Long-form discussion of each round lives in [rules/milestones.md](../../rules/milestones.md) (search the chunk id) and the durable lesson lives in [rules/completion-log.md](../../rules/completion-log.md).

Per-task indexes:
- [longmemeval-s/](longmemeval-s/README.md)
- [locomo-mteb/](locomo-mteb/README.md)
- [locomo-at-scale/](locomo-at-scale/README.md)
- [agentmemory-quality/](agentmemory-quality/README.md)

## Round-by-round timeline

| Round | Task | Date | Status | Headline | Artefact |
|---|---|---|---|---|---|
| an internal work item | agentmemory-quality | 2026-05-11 | PASS | First public agentmemory parity run | [memory_quality.json](../../benchmark/results/memory_quality.json) |
| an internal work item | agentmemory-quality | 2026-05-11 | PASS | Lexical rerank | [memory_quality.json](../../benchmark/results/memory_quality.json) |
| an internal work item | agentmemory-quality | 2026-05-12 | **PASS — leadership** | R@10 64.1 %, NDCG@10 94.7 %, MRR 95.8 % (+5.5 / +10.0 / +0.3 pp over agentmemory) | [memory_quality.json](../../benchmark/results/memory_quality.json) |
| an internal work item | agentmemory-quality + tokens | 2026-05-12 | PASS | Token efficiency: 91.4 % savings vs full-context paste | [memory_quality.json](../../benchmark/results/memory_quality.json) |
| an internal work item | longmemeval-s | 2026-05-12 | PASS (adapter) | LongMemEval-S plumbing shipped | [longmemeval_s_terransoul.json](../../benchmark/results/longmemeval_s_terransoul.json) |
| an internal work item/6.1 | longmemeval-s | 2026-05-11 | **PASS — leadership** | R@5 99.2 % / R@10 99.6 % / R@20 100.0 % / NDCG@10 91.3 % / MRR 92.6 % | [longmemeval_s_terransoul.json](../../benchmark/results/longmemeval_s_terransoul.json) |
| an internal work item | both | 2026-05-11 | PASS | Feature-matrix parity sweep, regression guard | [memory_quality.json](../../benchmark/results/memory_quality.json) + [longmemeval_s_terransoul.json](../../benchmark/results/longmemeval_s_terransoul.json) |
| an internal work item | locomo-mteb | 2026-05-12 | baseline | 250-q slice: search R@10 51.3 %, NDCG@10 40.9 % | [locomo_mteb_terransoul_250q.json](../../benchmark/results/locomo_mteb_terransoul_250q.json) |
| an internal work item | locomo-mteb | 2026-05-12 | PASS | 250-q: rrf R@10 54.4 % (+2.8 pp); multi_hop 15→33 % | [locomo_mteb_terransoul_250q.json](../../benchmark/results/locomo_mteb_terransoul_250q.json) |
| an internal work item | locomo-mteb | 2026-05-12 | PASS | Full 1655-q: rrf_emb R@10 59.4 % (+3.7 pp) | [locomo_mteb_terransoul_1089q.json](../../benchmark/results/locomo_mteb_terransoul_1089q.json) |
| an internal work item | locomo-mteb | 2026-05-12 | PASS | Store-level embed RRF: R@10 59.9 % | [locomo_mteb_terransoul.json](../../benchmark/results/locomo_mteb_terransoul.json) |
| an internal work item | locomo-mteb | 2026-05-12 | **PASS** | mxbai-embed-large 1024-d: R@10 63.6 % (+3.7 pp) | [locomo_mteb_terransoul.json](../../benchmark/results/locomo_mteb_terransoul.json) |
| an internal work item | locomo-mteb | 2026-05-12 | smoke pass | Proper-noun penalty smoke: adversarial 66.5 % | [locomo_mteb_terransoul_100q.json](../../benchmark/results/locomo_mteb_terransoul_100q.json) |
| an internal work item | locomo-mteb | 2026-05-12 | **NEGATIVE** | Full 1655-q: -2.1 pp overall — penalty reverted | [locomo_mteb_terransoul_1089q.json](../../benchmark/results/locomo_mteb_terransoul_1089q.json) |
| an internal work item | locomo-mteb | 2026-05-12 | **PASS — canonical** | Full 1976-q: rrf_rerank R@10 **68.3 %** (+4.7 pp); adversarial 67.7 % | [locomo_mteb_terransoul.json](../../benchmark/results/locomo_mteb_terransoul.json) |
| an internal work item | locomo-mteb | 2026-05-13 | NEGATIVE | Wider rerank pool + threshold — bimodal gemma3:4b made threshold inert | [locomo_mteb_terransoul_100q.json](../../benchmark/results/locomo_mteb_terransoul_100q.json) |
| an internal work item | locomo-mteb | 2026-05-13 | MIXED | rrf_hyde / rrf_hyde_rerank: +0.2 pp tied, per-class win/loss | [locomo_mteb_terransoul.json](../../benchmark/results/locomo_mteb_terransoul.json) |
| an internal work item | locomo-mteb | 2026-05-13 | MIXED | rrf_ctx + rrf_ctx_rerank: 68.5 % R@10 tied, NDCG +1.1 pp | [locomo_mteb_terransoul_100q.json](../../benchmark/results/locomo_mteb_terransoul_100q.json) |
| BENCH-an internal work item | chat parity | 2026-05-13 | PASS | Cross-encoder rerank wired into cloud streaming chat | (unit tests; no bench JSON) |
| an internal work item | chat parity | 2026-05-13 | PASS | KG cascade wired into chat (opt-in `enable_kg_boost`) | (unit tests; no bench JSON) |
| an internal work item | locomo-at-scale | 2026-05-13 | MIXED | 100k corpus rrf_rerank: R@10 59.5 %, p99 30.77s (rerank latency) | [locomo_scale_100000_adversarial_100q.json](../../benchmark/results/locomo_scale_100000_adversarial_100q.json) |
| an internal work item | locomo-at-scale | 2026-05-13 | **PASS — promoted** | 100k rrf only: R@10 64.0 %, NDCG@10 46.7 %, p50 1.21s | [locomo_scale_100000_adversarial_100q.json](../../benchmark/results/locomo_scale_100000_adversarial_100q.json) |
| BENCH-an internal work item | chat parity | 2026-05-13 | PASS | HyDE class-gated in cloud streaming chat — all 5 design-doc stages live | (unit tests; no bench JSON) |
| an internal work item | locomo-mteb | 2026-05-13 | NEUTRAL/MARGINAL | rrf_kg + rrf_kg_rerank: 100-q adversarial tied R@10, ~2× latency | [bench-kg-2-smoke.log](../../benchmark/results/bench-kg-2-smoke.log) |
| an internal work item | chat parity | 2026-05-13 | PASS | Temporal filter wired into bench harness (`rrf_temporal`, `rrf_temporal_rerank`) | (unit tests + new bench modes; future result rows here) |
| an internal work item | locomo-at-scale | 2026-05-14 | **harness-shipped, run-pending** | `ShardMode` toggle: router-routed vs all-shards bench arms | (two-arm 1M run scheduled; see [docs/billion-scale-retrieval-design.md](../../docs/billion-scale-retrieval-design.md) § Phase 2) |
| **BENCH-AM-RRF-FIX** | **agentmemory-quality** | **2026-06-25** | **PASS — regression fixed** | `hybrid_search_rrf` no-vec **22.9 % → 66.8 %** R@10 (NDCG 53.1 → 95.0); gateway rrf 22.3 → 63.9 %; keyword `search` unchanged 67.1 %. Bounded the P6 echo-collapse penalty (0.5× → ~2.5 % tiebreaker, commit `c560514e`) | [memory_quality.json](../../benchmark/results/memory_quality.json) |

## 2026-06-25 generic-machinery improvements (the IR axis)

This round bundled several **generic retrieval-machinery** fixes — no domain seeds, AGI-pure — measured this session:

- **RRF regression FIXED** (commit `c560514e`): the deterministic `memory_quality` bench had regressed (`hybrid_search_rrf` R@10 22.9 % / NDCG@10 53.1 % vs keyword 67.1 %). Root cause: the P6 echo-collapse penalty (0.5×, a 50 % attenuation) dominated the ~2 % RRF rank gaps. Fixed by bounding it to a ~2.5 % tiebreaker (`EchoCollapseConfig.tiebreaker_compression`). After: no-vec RRF R@10 **66.8 %** / NDCG **95.0 %**; keyword unchanged 67.1 %; `AppStateGateway::search` (rrf) 22.3 % → 63.9 %. The committed `memory_quality.{json,md}` were regenerated. (agentmemory v0.6 dual-stream reference R@10 58.6 % for context.)
- **Procedural config seed-loader** (`dccacb82`): procedural-ladder thresholds now load from the brain (Principle-3 purity), no behaviour change at defaults.
- **Tail-aware outcome window + ledger-aware GC** (`f7896fb0`): the outcome classifier now sees a head+tail window (long-session correctness); GC protects proven procedures.
- **Rust GENesis/Hermes self-improve loop** repaired earlier this session (was inert end-to-end): `record_procedure_outcome` wiring (`67c4c7b2`), Fable-5 candidate-count scaling (`5a71fa80`), Hermes synth hydration (`2c4861a6`), per-session primed-procedure set (`d5836f2b`), skill-index primer (`8fcbbcf1`).
- **Gateway-parity flag RESOLVED** (`ebf94bc5` bench fix, `e652598b` doc): the flagged 2.9 pp "gateway rrf 63.9 % vs direct 66.8 %" was a **bench store-state artifact**, not a gateway regression — System 4 (direct) ran on the *warmed* shared store (Systems 1–3.5 had queried it → `access_count` bumps → access-dependent activation lift) while System 6 (gateway) used a *cold* store. A cold-store control of the same direct path scores 63.9 %, identical to the gateway on all three metrics → the gateway is a faithful **0.0 pp pass-through**; the bench now compares gateway-vs-direct on identical cold state.
- **HNSW `ef_search` made explicit + seeded** (`64f7e90b`, lever #4): `ann.hnsw.expansion_search`=128 (clamp 16..512) via an `AnnConfig` loader, replacing the inherited usearch ~64 default that was capping ANN recall at scale. **Empirically measured** (`523e236c`, self-contained synthetic 10k×384-d HNSW recall sweep, no dataset/Ollama): recall@10 rises monotonically with ef — **ef64 0.516 → ef128 0.686 (+33 % relative)** for +138 µs/query (ef256 → 0.847). This is the cleanest isolation of the ANN-recall axis (no embed-model confound).
- **Rerank candidate depth decoupled + seeded** (`6ba93103`, lever #5): `rerank.recall_depth`=50 (clamp 10..100), replacing the `limit*3` clamp(15,30) so the cross-encoder always sees bi-encoder ranks 31–50 (a reranker's recall ceiling = bi-encoder recall@pool_depth). Mechanism unit-tested; the **end-to-end empirical rerank lift is deferred** — it needs the LoCoMo dataset + a cross-encoder, and the canonical models (mxbai-embed-large, gemma3:4b) aren't installed locally (only nomic-embed-text + the gemma4 family), so a run would be model-mismatched vs the published anchors (not faked).

## Status legend

- **PASS — leadership:** TerranSoul holds rank-1 on the named metric.
- **PASS:** Improvement vs prior round, no regression past the 2 pp soft bar.
- **PASS — canonical:** Round defines a new canonical bench mode (e.g. an internal work item promoted `rrf_rerank` to canonical, SCALE-1b promoted `rrf` for at-scale).
- **MIXED:** Some metrics improve, others regress. Often per-query-class (HyDE, contextual retrieval).
- **NEUTRAL/MARGINAL:** Below the promote bar but harness/mode preserved for future re-runs.
- **NEGATIVE:** Net regression; change reverted but lesson captured.
- **harness-shipped, run-pending:** Code/scripts ready; wall-clock-expensive run scheduled separately.

## MCP Gateway Parity

All per-bench READMEs now carry a **Gateway Parity badge** per [parity-enforcement-rules.md](../parity-enforcement-rules.md). The phase validated that `AppStateGateway::search()` is a transparent wrapper with 0/2216 per-query mismatches across agentmemory-quality (20-q), longmemeval-s (500-q), and locomo-mteb (1976-q). See the coverage matrix in [benchmark/README.md](../README.md#mcp-gateway-parity-coverage-matrix).
