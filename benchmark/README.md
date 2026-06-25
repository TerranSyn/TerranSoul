# benchmark/

Per-system, per-task benchmark folder for TerranSoul retrieval-quality runs.

Layout mirrors the reference convention at <https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md>:

```
benchmark/
├── README.md                       — this file (table of contents)
├── COMPARISON.md                   — cross-system results matrix + how-to-reproduce
├── agentmemory/                    — agentmemory v0.6 published numbers (reference)
│   └── README.md
├── mempalace/                      — MemPalace published numbers (reference)
│   └── README.md
├── terransoul/                     — every TerranSoul round we have run
│   ├── README.md                   — round index across all tasks
│   ├── longmemeval-s/              — BENCH-AM-5 / -6 / -6.1 / -7
│   ├── locomo-mteb/                — BENCH-LCM-1 … LCM-11
│   ├── locomo-at-scale/            — BENCH-SCALE-1 / SCALE-1b / SCALE-2 (harness)
│   └── agentmemory-quality/        — BENCH-AM-1 … AM-7
├── scripts/
│   └── README.md                   — pointers to runner scripts in scripts/
└── fixtures/
    └── README.md                   — dataset pin list + provenance
```

> **Where the raw JSON artefacts live:** in `target-copilot-bench/bench-results/`.
> That path is **tracked** in git (see `.gitignore` lines 51–52: `/target-copilot-bench/*` ignored except `/target-copilot-bench/bench-results/`). Per-task README files in this tree link to those JSON files directly — we do not duplicate the artefacts because individual files can reach 10+ MB and round counts will keep growing.
>
> **Artefact policy.** Only a subset of result files is committed in the current snapshot — currently the IVF-PQ scale runs (`locomo_ivfpq_*`, `bench-scale-5-timing_*`) and, where regenerated, `memory_quality.{json,md}`. The expensive retrieval runs (`longmemeval_s_terransoul.*`, `locomo_mteb_terransoul.*`, `locomo_scale_100000_adversarial_100q.*`) are wall-clock-expensive — minutes for the smallest slices, hours for the canonical 500/1976/100k runs — and require a local Ollama with `mxbai-embed-large` and `gemma3:4b`. The headline numbers reproduced in the tables above are sourced from `rules/completion-log.md` entries for BENCH-AM-* / BENCH-LCM-* / BENCH-SCALE-*; to regenerate the JSON locally, follow the **How to reproduce** block below. The deterministic `memory_quality` bench has no Ollama dependency and is the cheapest spot-check.

## Quick links by metric

| Benchmark | Best round | Headline | Index |
|---|---|---|---|
| LongMemEval-S retrieval | BENCH-AM-6/6.1 (2026-05-11) | R@5 **99.2 %**, R@10 **99.6 %**, R@20 **100.0 %**, NDCG@10 **91.3 %**, MRR **92.6 %** | [terransoul/longmemeval-s/](terransoul/longmemeval-s/README.md) |
| agentmemory quality bench | regenerated 2026-06-25 (RRF-fix `c560514e`) | keyword `search` R@10 **67.1 %** / NDCG@10 **98.2 %** / MRR **100.0 %**; `hybrid_search_rrf` no-vec R@10 **66.8 %** / NDCG@10 **95.0 %** (restored from a regressed 22.9 %) | [terransoul/agentmemory-quality/](terransoul/agentmemory-quality/README.md) |
| LoCoMo MTEB retrieval | BENCH-LCM-8 (2026-05-12, canonical) | R@10 **68.3 %** (rrf_rerank, full 1976-q) | [terransoul/locomo-mteb/](terransoul/locomo-mteb/README.md) |
| LoCoMo-at-scale | BENCH-SCALE-1b (2026-05-13) | 100k corpus, R@10 **64.0 %**, NDCG@10 **46.7 %** | [terransoul/locomo-at-scale/](terransoul/locomo-at-scale/README.md) |
| Token efficiency | regenerated 2026-06-25 | **91.6 %** savings vs full-context paste at R@10 66.8 % (no-vec RRF, post RRF-fix) | [COMPARISON.md](COMPARISON.md) |

## How to reproduce in one command

```pwsh
# All three retrieval benchmarks (LongMemEval-S, agentmemory quality, LoCoMo MTEB)
npm run brain:longmem:prepare   # one-time: downloads & cleans LongMemEval-S
npm run brain:longmem:run       # writes target-copilot-bench/bench-results/longmemeval_s_terransoul.{json,md}
node scripts/build-memory-quality-fixture.mjs
cd src-tauri; cargo bench --bench memory_quality --target-dir ../target-copilot-bench; cd ..
node scripts/locomo-mteb.mjs --systems=rrf_rerank --query-count=1976  # full LoCoMo
node scripts/locomo-at-scale.mjs --scale=100000 --task=adversarial --query-count=100  # 100k scale
```

Per-script flags (corpus size, system list, shard mode, etc.) live in [scripts/README.md](scripts/README.md).

## MCP Gateway Parity Coverage Matrix

> **Enforcement:** [parity-enforcement-rules.md](parity-enforcement-rules.md)
> — every benchmark must validate that direct-store and gateway-routed
> retrieval produce identical results (±1.0 pp acceptance bar).

| Benchmark | Direct-Store | Gateway | Drift | Status |
|---|---|---|---|---|
| **agentmemory-quality** | ✅ 240-obs, R@10 59.9 % | ✅ Same 240-obs via gateway | ±0.0 pp | ✅ PASS |
| **longmemeval-s** | ✅ 50-q sampled, R@10 98.0 % | ✅ Same 50-q via gateway, R@10 98.0 % | ±0.0 pp (0/50 per-q) | ✅ PASS |
| **locomo-mteb** | ✅ 1976-q, R@10 57.3 % | ✅ Same 1976-q via gateway, R@10 57.3 % | ±0.0 pp | ✅ PASS |
| **locomo-at-scale** | ✅ 100k, R@10 64.0 % | ✅ Dual-parity on same DB, R@10 64.0 % | ±0.0 pp | ✅ PASS |
| **zorkgpt** | ✅ 3 arms, brain-vs-default | ✅ Bridge routes via MCP | N/A (qualitative) | ✅ ROUTED |
| **parity-personal-ai** | ✅ 22 prompts, direct MCP | ✅ Runs live MCP on 7421/7423/7422 | N/A (qualitative) | ✅ LIVE |

**Phase status:** 5/5 quantitative benches validated, 2/2 qualitative benches routed. All gateway parity checks complete. No regressions found in any validated bench.

## Reading order for new contributors

1. [COMPARISON.md](COMPARISON.md) — cross-system numbers and methodology parity table.
2. [terransoul/README.md](terransoul/README.md) — every round chronologically, with status (PASS / MIXED / NEGATIVE) and the durable lesson learned.
3. [fixtures/README.md](fixtures/README.md) — exact commit hashes for every external dataset.
4. The per-task indexes — `terransoul/<task>/README.md` for the round-by-round delta table per metric.
5. [parity-enforcement-rules.md](parity-enforcement-rules.md) — dual-mode enforcement rules + CI/CD gate contract.

## See also

- [docs/agentmemory-comparison.md](../docs/agentmemory-comparison.md) — long-form discussion of the agentmemory bench numbers.
- [docs/billion-scale-retrieval-design.md](../docs/billion-scale-retrieval-design.md) — Phase 1–5 retrieval architecture; § Phase 2 documents the BENCH-SCALE-2 `ShardMode` toggle.
- [docs/brain-advanced-design.md](../docs/brain-advanced-design.md) — full RAG pipeline (6-signal hybrid + RRF + HyDE + cross-encoder + KG cascade + temporal).
- [rules/milestones.md](../rules/milestones.md) and [rules/completion-log.md](../rules/completion-log.md) — round-by-round narrative.
