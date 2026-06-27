# agentmemory quality bench

**Task:** Pinned `bench:quality` case set from [rohitg00/agentmemory commit `ae8f061c`](https://github.com/rohitg00/agentmemory/blob/ae8f061cd66093d7be1539c24da6d3e595531dd2/benchmark/COMPARISON.md). Concept-tagged corpus: 240 observations, 20 queries.

**Canonical TerranSoul result:** BENCH-AM-3 (2026-05-12) — **rank 1 on every measured metric vs the published agentmemory v0.6 numbers**. BENCH-AM-7 (2026-05-11) raised the no-vector RRF variant further.

> **Regenerated 2026-06-25 (RRF regression fixed, commit `c560514e`).** A regression had collapsed `hybrid_search_rrf` no-vector to **R@10 22.9 % / NDCG@10 53.1 %** (well below keyword's 67.1 %): the P6 echo-collapse penalty was a 0.5× / 50 % attenuation that dominated the ~2 % RRF rank gaps. Bounding it to a ~2.5 % tiebreaker (`EchoCollapseConfig.tiebreaker_compression`) restored RRF to **R@10 66.8 % / NDCG@10 95.0 % / MRR 95.0 %**; the gateway path (`AppStateGateway::search` rrf) recovered **22.3 % → 63.9 %**. Keyword-only `search` is unchanged at 67.1 %. The committed `memory_quality.{json,md}` were regenerated and are the source of truth below.

> **MCP Gateway Parity: ✅ PASS** — Direct-store R@10 59.9 % vs Gateway R@10 59.9 %, ±0.0 pp drift (BENCH-MCP-PARITY-2). See [parity-enforcement-rules.md](../../parity-enforcement-rules.md).

## Headline (BENCH-AM-3 / AM-7)

> Regenerated 2026-06-25 values (post RRF-fix). The keyword-only `search` row is the raw-quality leader; the no-vector RRF row is the production default at a fraction of the token budget.

| Metric | TerranSoul keyword `search` | TerranSoul no-vector RRF (restored) | agentmemory v0.6 (published) | Δ vs agentmemory |
|---|---|---|---|---|
| R@10 | **67.1 %** | **66.8 %** | 58.6 % | **+8.5 / +8.2 pp** |
| NDCG@10 | **98.2 %** | **95.0 %** | 84.7 % | **+13.5 / +10.3 pp** |
| MRR | **100.0 %** | **95.0 %** | 95.4 % (BM25-only ≈ 95.5 %) | **+4.6 / -0.4 pp** |

## Round table

| Round | Date | Config | R@10 / NDCG@10 / MRR | Notes |
|---|---|---|---|---|
| BENCH-AM-1 | 2026-05-11 | First parity run, default `search` | — | Plumbing verification |
| BENCH-AM-2 | 2026-05-11 | + lexical rerank | — | Promotion to leadership |
| **BENCH-AM-3** | **2026-05-12** | **`search` + lexical rerank + gated KG boost** | **64.1 / 94.7 / 95.8** | **Leadership on all 3 metrics** |
| BENCH-AM-4 | 2026-05-12 | + token-efficiency accounting | unchanged | 91.4 % savings vs full-context paste |
| BENCH-AM-5 | 2026-05-12 | LongMemEval-S adapter | (separate task) | See [longmemeval-s/](../longmemeval-s/README.md) |
| BENCH-AM-6/6.1 | 2026-05-11 | LongMemEval-S retrieval verification | (separate task) | See [longmemeval-s/](../longmemeval-s/README.md) |
| **BENCH-AM-7** | **2026-05-11** | **broad-term cap fix + no-vector RRF** | **66.4 / 96.5 / 100.0** (search) / **67.1 / 98.2 / 100.0** (rrf, pre-regression) | **Feature-matrix parity + regression guard** |
| **RRF-fix (regenerated)** | **2026-06-25** | **bound P6 echo-collapse penalty to a ~2.5 % tiebreaker (commit `c560514e`)** | **67.1 / 98.2 / 100.0** (keyword `search`) / **66.8 / 95.0 / 95.0** (rrf no-vec, restored from a regressed 22.9 / 53.1) | RRF had regressed to R@10 22.9 % because the echo-collapse 0.5× attenuation dominated the ~2 % RRF rank gaps; gateway rrf recovered 22.3 → 63.9 % |

## Token efficiency (BENCH-AM-4, 2026-05-12)

| Approach | Tokens/query (retrieved memory) | R@10 |
|---|---|---|
| Full-context paste baseline | 32,660 | n/a |
| 200-line MEMORY.md baseline | 7,960 | n/a |
| TerranSoul no-vector RRF (regenerated 2026-06-25) | **2,748** | 66.8 % |

Savings: **91.6 %** vs full paste, **65.5 %** vs 200-line MEMORY.md, while holding R@10 66.8 %, NDCG@10 95.0 %, MRR 95.0 % (post RRF-fix, commit `c560514e`).

Yearly token accounting: `npm run brain:tokens` (default 50 queries/day, configurable).

## Artefacts

- [memory_quality.json](../../../benchmark/results/memory_quality.json), [.md](../../../benchmark/results/memory_quality.md) — canonical artefact written by `cargo bench --bench memory_quality`. Each run overwrites this file; round-specific snapshots live in `rules/completion-log.md` (see BENCH-AM-1 through BENCH-AM-7 entries).
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

> **Note — RESOLVED 2026-06-25 (commit `ebf94bc5`):** the apparent 2.9 pp gateway-vs-direct gap (gateway rrf 63.9 % vs direct rrf 66.8 %) was a **bench-harness store-state artifact, not a gateway regression**. The direct row (System 4) ran on the *warmed* shared store that Systems 1–3.5 had already queried; `hybrid_search_rrf` bumps `last_accessed`/`access_count` on returned rows, and the post-RRF activation multiplier is access-count-dependent, so the warmed store ranks ~2.9 pp higher than a cold one. A control row — direct `hybrid_search_rrf` on a *cold fresh* store (System 6a) — scores **63.9 %, identical to the gateway (System 6b) on all three metrics**, proving the gateway is a **faithful 0.0 pp pass-through**. The bench parity check now compares gateway-vs-direct on identical cold state (6a vs 6b), so it can never re-trip on this confound. The ±1.0 pp acceptance bar above stands for *true* gateway-layer drift measured on identical store state.

## Loop rule

After each `BENCH-AM-N` chunk, re-run this bench, diff against the prior round, and open the next fix chunk or regression guard. Stop only when TerranSoul holds rank 1 on every measured metric. As of BENCH-AM-7 (2026-05-11), all three metrics are rank 1 — the loop is in regression-guard mode.
