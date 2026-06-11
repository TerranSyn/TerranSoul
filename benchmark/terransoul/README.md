# TerranSoul bench rounds — chronological index

Every TerranSoul retrieval-quality bench run is logged here with status, headline metric, and a link to the raw JSON / markdown artefact under `target-copilot-bench/bench-results/`. Long-form discussion of each round lives in [rules/milestones.md](../../rules/milestones.md) (search the chunk id) and the durable lesson lives in [rules/completion-log.md](../../rules/completion-log.md).

Per-task indexes:
- [longmemeval-s/](longmemeval-s/README.md)
- [locomo-mteb/](locomo-mteb/README.md)
- [locomo-at-scale/](locomo-at-scale/README.md)
- [agentmemory-quality/](agentmemory-quality/README.md)

## Round-by-round timeline

| Round | Task | Date | Status | Headline | Artefact |
|---|---|---|---|---|---|
| BENCH-AM-1 | agentmemory-quality | 2026-05-11 | PASS | First public agentmemory parity run | [memory_quality.json](../../target-copilot-bench/bench-results/memory_quality.json) |
| BENCH-AM-2 | agentmemory-quality | 2026-05-11 | PASS | Lexical rerank | [memory_quality.json](../../target-copilot-bench/bench-results/memory_quality.json) |
| BENCH-AM-3 | agentmemory-quality | 2026-05-12 | **PASS — leadership** | R@10 64.1 %, NDCG@10 94.7 %, MRR 95.8 % (+5.5 / +10.0 / +0.3 pp over agentmemory) | [memory_quality.json](../../target-copilot-bench/bench-results/memory_quality.json) |
| BENCH-AM-4 | agentmemory-quality + tokens | 2026-05-12 | PASS | Token efficiency: 91.4 % savings vs full-context paste | [memory_quality.json](../../target-copilot-bench/bench-results/memory_quality.json) |
| BENCH-AM-5 | longmemeval-s | 2026-05-12 | PASS (adapter) | LongMemEval-S plumbing shipped | [longmemeval_s_terransoul.json](../../target-copilot-bench/bench-results/longmemeval_s_terransoul.json) |
| BENCH-AM-6/6.1 | longmemeval-s | 2026-05-11 | **PASS — leadership** | R@5 99.2 % / R@10 99.6 % / R@20 100.0 % / NDCG@10 91.3 % / MRR 92.6 % | [longmemeval_s_terransoul.json](../../target-copilot-bench/bench-results/longmemeval_s_terransoul.json) |
| BENCH-AM-7 | both | 2026-05-11 | PASS | Feature-matrix parity sweep, regression guard | [memory_quality.json](../../target-copilot-bench/bench-results/memory_quality.json) + [longmemeval_s_terransoul.json](../../target-copilot-bench/bench-results/longmemeval_s_terransoul.json) |
| BENCH-LCM-1 | locomo-mteb | 2026-05-12 | baseline | 250-q slice: search R@10 51.3 %, NDCG@10 40.9 % | [locomo_mteb_terransoul_250q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_250q.json) |
| BENCH-LCM-2 | locomo-mteb | 2026-05-12 | PASS | 250-q: rrf R@10 54.4 % (+2.8 pp); multi_hop 15→33 % | [locomo_mteb_terransoul_250q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_250q.json) |
| BENCH-LCM-3 | locomo-mteb | 2026-05-12 | PASS | Full 1655-q: rrf_emb R@10 59.4 % (+3.7 pp) | [locomo_mteb_terransoul_1089q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_1089q.json) |
| BENCH-LCM-4 | locomo-mteb | 2026-05-12 | PASS | Store-level embed RRF: R@10 59.9 % | [locomo_mteb_terransoul.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul.json) |
| BENCH-LCM-5 | locomo-mteb | 2026-05-12 | **PASS** | mxbai-embed-large 1024-d: R@10 63.6 % (+3.7 pp) | [locomo_mteb_terransoul.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul.json) |
| BENCH-LCM-6 | locomo-mteb | 2026-05-12 | smoke pass | Proper-noun penalty smoke: adversarial 66.5 % | [locomo_mteb_terransoul_100q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_100q.json) |
| BENCH-LCM-7 | locomo-mteb | 2026-05-12 | **NEGATIVE** | Full 1655-q: -2.1 pp overall — penalty reverted | [locomo_mteb_terransoul_1089q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_1089q.json) |
| BENCH-LCM-8 | locomo-mteb | 2026-05-12 | **PASS — canonical** | Full 1976-q: rrf_rerank R@10 **68.3 %** (+4.7 pp); adversarial 67.7 % | [locomo_mteb_terransoul.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul.json) |
| BENCH-LCM-9 | locomo-mteb | 2026-05-13 | NEGATIVE | Wider rerank pool + threshold — bimodal gemma3:4b made threshold inert | [locomo_mteb_terransoul_100q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_100q.json) |
| BENCH-LCM-10 | locomo-mteb | 2026-05-13 | MIXED | rrf_hyde / rrf_hyde_rerank: +0.2 pp tied, per-class win/loss | [locomo_mteb_terransoul.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul.json) |
| BENCH-LCM-11 | locomo-mteb | 2026-05-13 | MIXED | rrf_ctx + rrf_ctx_rerank: 68.5 % R@10 tied, NDCG +1.1 pp | [locomo_mteb_terransoul_100q.json](../../target-copilot-bench/bench-results/locomo_mteb_terransoul_100q.json) |
| BENCH-CHAT-PARITY-1 | chat parity | 2026-05-13 | PASS | Cross-encoder rerank wired into cloud streaming chat | (unit tests; no bench JSON) |
| BENCH-KG-1 | chat parity | 2026-05-13 | PASS | KG cascade wired into chat (opt-in `enable_kg_boost`) | (unit tests; no bench JSON) |
| BENCH-SCALE-1 | locomo-at-scale | 2026-05-13 | MIXED | 100k corpus rrf_rerank: R@10 59.5 %, p99 30.77s (rerank latency) | [locomo_scale_100000_adversarial_100q.json](../../target-copilot-bench/bench-results/locomo_scale_100000_adversarial_100q.json) |
| BENCH-SCALE-1b | locomo-at-scale | 2026-05-13 | **PASS — promoted** | 100k rrf only: R@10 64.0 %, NDCG@10 46.7 %, p50 1.21s | [locomo_scale_100000_adversarial_100q.json](../../target-copilot-bench/bench-results/locomo_scale_100000_adversarial_100q.json) |
| BENCH-CHAT-PARITY-2 | chat parity | 2026-05-13 | PASS | HyDE class-gated in cloud streaming chat — all 5 design-doc stages live | (unit tests; no bench JSON) |
| BENCH-KG-2 | locomo-mteb | 2026-05-13 | NEUTRAL/MARGINAL | rrf_kg + rrf_kg_rerank: 100-q adversarial tied R@10, ~2× latency | [bench-kg-2-smoke.log](../../target-copilot-bench/bench-results/bench-kg-2-smoke.log) |
| BENCH-PARITY-3 | chat parity | 2026-05-13 | PASS | Temporal filter wired into bench harness (`rrf_temporal`, `rrf_temporal_rerank`) | (unit tests + new bench modes; future result rows here) |
| BENCH-SCALE-2 | locomo-at-scale | 2026-05-14 | **harness-shipped, run-pending** | `ShardMode` toggle: router-routed vs all-shards bench arms | (two-arm 1M run scheduled; see [docs/billion-scale-retrieval-design.md](../../docs/billion-scale-retrieval-design.md) § Phase 2) |

## Status legend

- **PASS — leadership:** TerranSoul holds rank-1 on the named metric.
- **PASS:** Improvement vs prior round, no regression past the 2 pp soft bar.
- **PASS — canonical:** Round defines a new canonical bench mode (e.g. LCM-8 promoted `rrf_rerank` to canonical, SCALE-1b promoted `rrf` for at-scale).
- **MIXED:** Some metrics improve, others regress. Often per-query-class (HyDE, contextual retrieval).
- **NEUTRAL/MARGINAL:** Below the promote bar but harness/mode preserved for future re-runs.
- **NEGATIVE:** Net regression; change reverted but lesson captured.
- **harness-shipped, run-pending:** Code/scripts ready; wall-clock-expensive run scheduled separately.

## MCP Gateway Parity

All per-bench READMEs now carry a **Gateway Parity badge** per [parity-enforcement-rules.md](../parity-enforcement-rules.md). The phase validated that `AppStateGateway::search()` is a transparent wrapper with 0/2216 per-query mismatches across agentmemory-quality (20-q), longmemeval-s (500-q), and locomo-mteb (1976-q). See the coverage matrix in [benchmark/README.md](../README.md#mcp-gateway-parity-coverage-matrix).
