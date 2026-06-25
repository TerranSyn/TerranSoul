# Reference system: agentmemory v0.6

**Project:** [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) — MIT-licensed.
**Pinned commit:** `ae8f061cd66093d7be1539c24da6d3e595531dd2`.
**Their benchmark page:** <https://github.com/rohitg00/agentmemory/blob/ae8f061cd66093d7be1539c24da6d3e595531dd2/benchmark/COMPARISON.md>

> This folder records the **published agentmemory numbers** that TerranSoul compares against. We do not re-run agentmemory locally; we pin the commit and reference their published results. Attribution and license details: [CREDITS.md](../../CREDITS.md).

## Concept-tagged corpus (240 obs / 20 queries) — agentmemory's own bench

| Metric | agentmemory v0.6 | TerranSoul keyword `search` | TerranSoul no-vec RRF (restored) |
|---|---|---|---|
| R@10 | 58.6 % | **67.1 %** | **66.8 %** |
| NDCG@10 | 84.7 % | **98.2 %** | **95.0 %** |
| MRR | 95.4 % (BM25-only ≈ 95.5 %) | **100.0 %** | **95.0 %** |

> Regenerated 2026-06-25 (post RRF-fix, commit `c560514e`). The 67.1 / 98.2 / 100.0 column is keyword-only `search` (the raw-quality leader); the no-vec RRF production default was restored from a regressed R@10 22.9 % to **66.8 % / NDCG@10 95.0 % / MRR 95.0 %** after the P6 echo-collapse penalty was bounded to a ~2.5 % tiebreaker.

See [../terransoul/agentmemory-quality/README.md](../terransoul/agentmemory-quality/README.md) for the TerranSoul side and the round-by-round table.

## LongMemEval-S — agentmemory's published numbers

| Metric | agentmemory | TerranSoul (BENCH-AM-6/6.1) |
|---|---|---|
| R@5 | 95.2 % | **99.2 %** |
| R@10 | 98.6 % | **99.6 %** |
| R@20 | 99.4 % | **100.0 %** |
| NDCG@10 | 87.9 % | **91.3 %** |
| MRR | 88.2 % | **92.6 %** |

See [../terransoul/longmemeval-s/README.md](../terransoul/longmemeval-s/README.md) for the TerranSoul run.

## What we learned from agentmemory (credited research)

- **Lexical-RRF baseline strength.** agentmemory's published BM25-only MRR (95.4 %) is competitive on its own concept-tagged corpus. TerranSoul keyword + freshness RRF leads narrowly but the gap is small — TerranSoul's lead on this fixture comes from the corpus-aware lexical weighting and gated KG boost, not from raw vector quality.
- **`bench:quality` reproducibility convention.** The pinned-commit fixture + JSON build approach is the pattern TerranSoul uses for [scripts/build-memory-quality-fixture.mjs](../../scripts/build-memory-quality-fixture.mjs).
- **Per-system COMPARISON.md layout.** This entire `benchmark/` directory structure follows agentmemory's convention so cross-system comparison is fluid.

Attribution and full credit list: [CREDITS.md](../../CREDITS.md).
