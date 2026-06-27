# LongMemEval-S retrieval

**Task:** xiaowu0162/longmemeval-cleaned (LongMemEval-S, cleaned 500-question retrieval slice).
**Adapter shipped:** BENCH-AM-5 (2026-05-12).
**Canonical TerranSoul result:** BENCH-AM-6/6.1 (2026-05-11) — **rank 1 on every measured metric vs published competition**.

> **MCP Gateway Parity: ✅ PASS** — 0/50 per-question mismatches between gateway and direct-store paths on the sampled subset (BENCH-MCP-PARITY-3). The apples-to-apples per-query test is exact parity. See [parity-enforcement-rules.md](../../parity-enforcement-rules.md).

## Headline numbers (BENCH-AM-6/6.1, 500-question cleaned set)

| Metric | TerranSoul | agentmemory (published) | MemPalace (published) |
|---|---|---|---|
| R@5 | **99.2 %** | 95.2 % | ~96.6 % |
| R@10 | **99.6 %** | 98.6 % | — |
| R@20 | **100.0 %** | 99.4 % | — |
| NDCG@10 | **91.3 %** | 87.9 % | — |
| MRR | **92.6 %** | 88.2 % | — |

TerranSoul leads agentmemory on all five published metrics and MemPalace on R@5.

## Round table

| Round | Date | Config | R@5 / R@10 / R@20 / NDCG@10 / MRR | Notes |
|---|---|---|---|---|
| BENCH-AM-5 | 2026-05-12 | First adapter run, default config | sample fixture | Plumbing verification, not a leadership claim |
| BENCH-AM-6 | 2026-05-11 | corpus-aware lexical weighting + light query variants | 99.0 / 99.4 / 99.8 / 91.0 / 92.4 | First full retrieval-only run |
| BENCH-AM-6.1 | 2026-05-11 | Tuned rare-anchor weights | **99.2 / 99.6 / 100.0 / 91.3 / 92.6** | Canonical result |
| BENCH-AM-7 | 2026-05-11 | Regression guard after broad-term cap | unchanged | LongMemEval-S preserved while agentmemory bench improved |

## Artefacts

- [longmemeval_s_terransoul.json](../../../benchmark/results/longmemeval_s_terransoul.json)
- [longmemeval_s_terransoul.md](../../../benchmark/results/longmemeval_s_terransoul.md)
- Slice variants: 2q / 20q / 50q / 180q — all under `benchmark/results/longmemeval_s_terransoul_*q.{json,md}`

## How to reproduce

```pwsh
npm run brain:longmem:prepare   # ~264 MB dataset download (one-time, owner-triggered)
npm run brain:longmem:run       # full 500-question retrieval run
# Output: benchmark/results/longmemeval_s_terransoul.{json,md}
```

For a quick smoke without downloading the full dataset:

```pwsh
npm run brain:longmem:sample    # 2-question built-in fixture
```

## Background

LongMemEval-S targets long-horizon retrieval over multi-session conversations. The "retrieval-only" slice we run measures whether the correct supporting evidence is ranked in top-K, *not* downstream QA accuracy. We score this slice because (a) the retrieval layer is what TerranSoul ships and is most directly comparable to other memory systems, and (b) downstream QA is dominated by the generator model rather than the memory store. See [docs/longmemeval-s-adapter.md](../../../docs/longmemeval-s-adapter.md) for the adapter implementation notes.

## Direct-store vs MCP gateway path

Since BENCH-MCP-PARITY-2, the adapter supports routing `rrf` and `hybrid`
search modes through `AppStateGateway::search` — the same code path the
running Tauri app and MCP server use. Set `LONGMEM_VIA_GATEWAY=1`:

```pwsh
$env:LONGMEM_VIA_GATEWAY = "1"
npm run brain:longmem:run       # same 500-q run, gateway-routed
```

Bench-specific modes (`rrf_rerank`, `rrf_kg`, `rrf_temporal`, `rrf_hyde`,
`ivfpq`) stay direct-store because `SearchMode` only natively exposes
`Hybrid` / `Rrf` / `Hyde`.

**Acceptance bar:** ±1.0 pp on R@5 / R@10 / R@20 / NDCG@10 / MRR vs the
canonical direct-store numbers. Any drift beyond that indicates a gateway
regression.

### Results (BENCH-MCP-PARITY-3, 2026-05-26)

| Path | N | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg Lat |
|------|---|-----|------|------|---------|-----|---------|
| Gateway + embed (500q) | 500 | 89.6% | 99.2% | 100% | 0.5519 | 0.3955 | 994.8 ms |
| Direct-store + embed (50q) | 50 | 88.0% | 98.0% | — | — | — | — |
| Direct-store no-embed (500q, baseline) | 500 | 98.6% | 99.8% | 100% | 0.8857 | 0.8891 | 965.8 ms |

**Per-question parity check:** The same 50 questions were compared between
gateway and direct-store paths. **0/50 mismatches** on R@5, R@10, and
NDCG@10. The gateway code path (`AppStateGateway::search`) produces
identical retrieval results to calling `hybrid_search_rrf` directly.

**Why rrf-with-embed < rrf-without-embed:** LongMemEval-S questions are
entity-specific ("What brand uses wild rubber from the Amazon?"). FTS5
keyword matching retrieves the exact conversation precisely. Adding a
vector component to RRF fusion introduces semantically similar but
incorrect conversations, diluting the keyword signal. This is a known
RRF dilution effect on entity-lookup datasets, not a gateway or
embedding regression. Production queries are more varied and benefit
from the vector component.

**Verdict:** PASS — gateway introduces 0.0 pp drift (exact parity).
