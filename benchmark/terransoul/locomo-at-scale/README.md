# LoCoMo at scale

**Task:** Same LoCoMo MTEB fixture as the per-query bench, but ingested into a fresh `MemoryStore` populated to 10k / 100k / 1M total memories with gold + distractor + entity-swap chunks. Measures quality + retrieval latency at scale.

**Harness:** [benchmark/scripts/locomo-at-scale.mjs](../../scripts/locomo-at-scale.mjs).

> **MCP Gateway Parity: ✅ PASS** — Dual-parity validation at 100k scale (BENCH-MCP-PARITY-5). Quality: R@10=64.0% via both paths (±0.0 pp drift). Per-query: 85/100 bit-identical ID lists, 15/100 differ in ordering due to Ollama embedding non-determinism (GPU floats differ across calls). Gateway is architecturally identical — `AppStateGateway::search()` delegates to `store.hybrid_search_rrf()`. Unit test confirms 0 mismatches when embedding is shared. See [parity-enforcement-rules.md](../../parity-enforcement-rules.md).

## Round table

| Round | Date | Scale | Mode | R@10 | NDCG@10 | MRR | p50 lat | p99 lat | Status |
|---|---|---|---|---|---|---|---|---|---|
| SCALE-1 | 2026-05-13 | 100,000 | rrf_rerank | 59.5 % | — | — | — | 30.77 s | MIXED — quality OK, latency dominated by reranker |
| **SCALE-1b** | **2026-05-13** | 100,000 | **rrf only** | **64.0 %** | **46.7 %** | 42.3 % | **1.21 s** | 25.32 s | **PASS — promoted canonical** |
| **PARITY-5** | **2026-05-27** | 100,000 | **rrf dual-parity** | **64.0 %** | **46.6 %** | 42.1 % | **1.16 s** | 2.48 s | **✅ PASS — gateway quality ≡ direct-store** |
| SCALE-2 | 2026-05-14 | (1,000,000 pending) | router-routed vs all-shards | — | — | — | — | — | **harness-shipped, run-pending** |

## SCALE-1b detail (canonical at-scale result)

- Corpus: 100,000 memories (5,882 gold + 23,528 natural cross-task distractors + 70,590 entity-swap/synthetic), mxbai-embed-large 1024-d, HNSW ANN.
- Ingestion: 37 min (one-pass).
- Query slice: 100 adversarial queries, `rrf` system (no reranker).
- Vs LCM-8 5k baseline (R@10 67.7 % adversarial): -3.7 pp at 100k — within the 10 pp acceptance bar from [docs/billion-scale-retrieval-design.md](../../../docs/billion-scale-retrieval-design.md) § acceptance.
- Vs SCALE-1 reranked R@10 59.5 % at the same scale: +4.5 pp **better** without the reranker. The `gemma3:4b` cross-encoder is a measurable quality regression on this corpus.

## SCALE-2 protocol (harness shipped 2026-05-14, run pending)

Two-arm comparison at 1M docs:

```pwsh
# Arm A — production sharded retrieval (router-routed, 15 shards, top-p shard probe)
node benchmark/scripts/locomo-at-scale.mjs --scale=1000000 --task=adversarial --query-count=100 --shard-mode=routed

# Arm B — single-index baseline (all 15 shards probed every query, no router cost)
node benchmark/scripts/locomo-at-scale.mjs --scale=1000000 --task=adversarial --query-count=100 --shard-mode=all
```

Each arm writes a distinct file `locomo_scale_1000000_adversarial_100q_<mode>.{json,md}` — the filename suffix closes the SCALE-1b overwrite footgun. The report JSON and markdown both include a `shard_mode` field so post-hoc diffing is unambiguous.

Implementation: new `MemoryStore::set_shard_mode(ShardMode)` API with `RouterRouted` default. `longmemeval-ipc` bench bin reads `LONGMEM_SHARD_MODE`. See [docs/billion-scale-retrieval-design.md](../../../docs/billion-scale-retrieval-design.md) § Phase 2 "Bench instrumentation — ShardMode toggle" for the toggle table and dispatch table.

## Artefacts

- [locomo_scale_100000_adversarial_100q.json](../../../benchmark/results/locomo_scale_100000_adversarial_100q.json) (SCALE-1 / SCALE-1b — SCALE-1b currently overwrites SCALE-1 in this file; the mode suffix from SCALE-2 prevents future overwrites)
- [locomo_scale_100000_adversarial_100q.md](../../../benchmark/results/locomo_scale_100000_adversarial_100q.md)
- [locomo_scale_10000_adversarial_10q.json](../../../benchmark/results/locomo_scale_10000_adversarial_10q.json) (smoke)
- [scale-1b-run.log](../../../benchmark/results/scale-1b-run.log) (full run log)

## Acceptance bars (from `docs/billion-scale-retrieval-design.md`)

| Bar | Target | SCALE-1b result | Verdict |
|---|---|---|---|
| Quality (R@10 at 100k) | ≥ -10 pp vs 5k baseline | -3.7 pp | PASS |
| Retrieval-only latency p50 | < 200 ms | 1.21 s | FAIL (root cause: per-query Ollama embed hop) |
| End-to-end p99 with rerank | n/a (separate bar) | 25.32 s | tracked separately |

The retrieval-only p50 failing the 200 ms bar is the open follow-up. Root cause is the Ollama embed call long tail under load, not the post-embedding RRF + HNSW lookup. Future work tracked in [docs/billion-scale-retrieval-design.md](../../../docs/billion-scale-retrieval-design.md).
