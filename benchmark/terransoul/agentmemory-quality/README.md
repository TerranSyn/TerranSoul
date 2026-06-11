# agentmemory quality bench

**Task:** Pinned `bench:quality` case set from [rohitg00/agentmemory commit `ae8f061c`](https://github.com/rohitg00/agentmemory/blob/ae8f061cd66093d7be1539c24da6d3e595531dd2/benchmark/COMPARISON.md). Concept-tagged corpus: 240 observations, 20 queries.

**Canonical TerranSoul result:** BENCH-AM-3 (2026-05-12) — **rank 1 on every measured metric vs the published agentmemory v0.6 numbers**. BENCH-AM-7 (2026-05-11) raised the no-vector RRF variant further.

> **MCP Gateway Parity: ✅ PASS** — Direct-store R@10 59.9 % vs Gateway R@10 59.9 %, ±0.0 pp drift (BENCH-MCP-PARITY-2). See [parity-enforcement-rules.md](../../parity-enforcement-rules.md).

## Headline (BENCH-AM-3 / AM-7)

| Metric | TerranSoul `search` (AM-3) | TerranSoul no-vector RRF (AM-7) | agentmemory v0.6 (published) | Δ vs agentmemory |
|---|---|---|---|---|
| R@10 | 64.1 % | **67.1 %** | 58.6 % | **+5.5 / +8.5 pp** |
| NDCG@10 | 94.7 % | **98.2 %** | 84.7 % | **+10.0 / +13.5 pp** |
| MRR | 95.8 % | **100.0 %** | 95.4 % (BM25-only ≈ 95.5 %) | **+0.4 / +4.6 pp** |

## Round table

| Round | Date | Config | R@10 / NDCG@10 / MRR | Notes |
|---|---|---|---|---|
| BENCH-AM-1 | 2026-05-11 | First parity run, default `search` | — | Plumbing verification |
| BENCH-AM-2 | 2026-05-11 | + lexical rerank | — | Promotion to leadership |
| **BENCH-AM-3** | **2026-05-12** | **`search` + lexical rerank + gated KG boost** | **64.1 / 94.7 / 95.8** | **Leadership on all 3 metrics** |
| BENCH-AM-4 | 2026-05-12 | + token-efficiency accounting | unchanged | 91.4 % savings vs full-context paste |
| BENCH-AM-5 | 2026-05-12 | LongMemEval-S adapter | (separate task) | See [longmemeval-s/](../longmemeval-s/README.md) |
| BENCH-AM-6/6.1 | 2026-05-11 | LongMemEval-S retrieval verification | (separate task) | See [longmemeval-s/](../longmemeval-s/README.md) |
| **BENCH-AM-7** | **2026-05-11** | **broad-term cap fix + no-vector RRF** | **66.4 / 96.5 / 100.0** (search) / **67.1 / 98.2 / 100.0** (rrf) | **Feature-matrix parity + regression guard** |

## Token efficiency (BENCH-AM-4, 2026-05-12)

| Approach | Tokens/query (retrieved memory) | R@10 |
|---|---|---|
| Full-context paste baseline | 32,660 | n/a |
| 200-line MEMORY.md baseline | 7,960 | n/a |
| TerranSoul no-vector RRF | **2,798** | 63.6 % |

Savings: **91.4 %** vs full paste, **64.8 %** vs 200-line MEMORY.md, while holding R@10 63.6 %, NDCG@10 94.3 %, MRR 95.8 %.

Yearly token accounting: `npm run brain:tokens` (default 50 queries/day, configurable).

## Artefacts

- [memory_quality.json](../../../target-copilot-bench/bench-results/memory_quality.json), [.md](../../../target-copilot-bench/bench-results/memory_quality.md) — canonical artefact written by `cargo bench --bench memory_quality`. Each run overwrites this file; round-specific snapshots live in `rules/completion-log.md` (see BENCH-AM-1 through BENCH-AM-7 entries).
- Long-form analysis: [docs/agentmemory-comparison.md](../../../docs/agentmemory-comparison.md)

## How to reproduce

```pwsh
node scripts/build-memory-quality-fixture.mjs
cd src-tauri
cargo bench --bench memory_quality --target-dir ../target-copilot-bench
cd ..
npm run brain:tokens   # yearly token-savings calculator
```

The concept-tagged fixture is the canonical `dataset.ts` corpus from rohitg00/agentmemory commit `ae8f061c`, transpiled with esbuild and serialised to JSON with timestamps anchored to `2026-01-01T00:00:00Z`. Re-running the fetcher against the pinned commit produces a byte-identical fixture. Attribution: [CREDITS.md](../../../CREDITS.md).

## Direct-store vs MCP gateway path (BENCH-MCP-PARITY-1)

The bench reports two `rrf` rows that drive the identical query set through different access paths:

| System | Access path | Purpose |
|---|---|---|
| `TerranSoul hybrid_search_rrf (no vectors)` | `MemoryStore::hybrid_search_rrf` direct | Lower-bound / hot-path baseline |
| `TerranSoul AppStateGateway::search (rrf, no vectors)` | `AppStateGateway::search` via `AppState::for_bench(store)` | Same surface the MCP `brain_search` JSON-RPC tool wraps (production clients: workspace `terransoul-brain-mcp` proxy, Zork bench bridge) |

**Acceptance bar:** the gateway row must stay within ±1.0 pp of the direct row on R@10 / NDCG@10 / MRR. Latency overhead is informational. Three consecutive runs (2026-05-26) measured **0.0 pp** drift on all three quality metrics and 0.1–1.5 ms overhead on the 240-obs / 20-query fixture — see `mcp-data/shared/memory-seed.sql` lesson `seed:lesson-bench-mcp-parity-1-foundation-2026-05-26`. Any future delta > ±1.0 pp on the gateway row is a real gateway-layer regression (cap checks, telemetry, future contextualizer middleware) and must be diagnosed before merge.

## Loop rule

After each `BENCH-AM-N` chunk, re-run this bench, diff against the prior round, and open the next fix chunk or regression guard. Stop only when TerranSoul holds rank 1 on every measured metric. As of BENCH-AM-7 (2026-05-11), all three metrics are rank 1 — the loop is in regression-guard mode.
