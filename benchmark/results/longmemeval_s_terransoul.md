# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-01T21:04:54.007Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| search | 98.4% | 99.8% | 100.0% | 88.8% | 89.0% | 399.65ms | 62,355 |
| rrf | 97.2% | 98.8% | 100.0% | 90.5% | 90.9% | 585.38ms | 63,460 |
| rrf_emb | 98.4% | 99.6% | 100.0% | 91.1% | 91.7% | 542.99ms | 62,656 |

## By Question Type

### search

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 100.0% | 92.7% | 90.3% |
| multi-session | 133 | 98.5% | 100.0% | 84.8% | 88.4% |
| single-session-preference | 30 | 96.7% | 100.0% | 82.6% | 76.9% |
| temporal-reasoning | 133 | 98.5% | 100.0% | 86.4% | 87.4% |
| knowledge-update | 78 | 98.7% | 98.7% | 93.1% | 92.2% |
| single-session-assistant | 56 | 100.0% | 100.0% | 96.2% | 94.9% |

### rrf

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 91.4% | 98.6% | 85.4% | 81.3% |
| multi-session | 133 | 100.0% | 100.0% | 93.6% | 96.7% |
| single-session-preference | 30 | 93.3% | 96.7% | 80.6% | 75.5% |
| temporal-reasoning | 133 | 95.5% | 97.0% | 86.6% | 87.3% |
| knowledge-update | 78 | 100.0% | 100.0% | 94.5% | 96.5% |
| single-session-assistant | 56 | 100.0% | 100.0% | 98.7% | 98.2% |

### rrf_emb

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 95.7% | 100.0% | 88.6% | 85.0% |
| multi-session | 133 | 100.0% | 100.0% | 93.3% | 97.1% |
| single-session-preference | 30 | 96.7% | 96.7% | 79.7% | 74.3% |
| temporal-reasoning | 133 | 97.0% | 99.2% | 87.1% | 87.6% |
| knowledge-update | 78 | 100.0% | 100.0% | 95.1% | 96.8% |
| single-session-assistant | 56 | 100.0% | 100.0% | 99.3% | 99.1% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.

## 2026-07-02 update — `rrf`/`rrf_emb` numbers moved off the 2026-06-28 baseline

The prior committed baseline (2026-06-28) recorded `rrf` R@5 99.4% / NDCG@10
95.1% / MRR 96.0% and `rrf_emb` R@5 99.4% / R@10 100.0% / NDCG@10 94.4% / MRR
95.2%. This run reproduces `rrf` R@5 97.2% / NDCG@10 90.5% / MRR 90.9% and
`rrf_emb` R@5 98.4% / R@10 99.6% / NDCG@10 91.1% / MRR 91.7% — reproduced
**three times independently** at full 500-question scale, so this is a real,
stable shift, not run-to-run noise. `search` (pure lexical FTS5,
embedder-independent) is byte-identical to the 06-28 baseline down to the
decimal on every metric, which isolates the shift to the RRF fusion path
specifically (both `rrf` and `rrf_emb` use `reciprocal_rank_fuse`; `search`
does not).

Investigated and **positively exonerated**: the same-day RAG-categorization
commit (`0b7beaac`, the `origin:*` tag-prefix convention) — proven via (1) a
code-path trace showing the LongMemEval-S harness inserts bench data through
`MemoryStore::add_many_bench`, never through the `origin:*`-stamping
`commands/ingest.rs::store_ingest_row`, and (2) an empirical A/B diff of all
163 single-session-preference + temporal-reasoning questions (the two
worst-hit categories) between this commit and its parent, which produced
byte-identical retrieved-ID lists. See the regression tests added in
`612fcd08` and the synced lesson `seed:longmemeval-rrf-regression-investigation-2026-07-02`
in `mcp-data/shared/memory-seed.sql`.

**Leading suspect (not yet confirmed): `ad263f19`/`50b0e9f6`**, the sharded
high-throughput CRUD write path ("db-redesign-1m v1", 2026-06-28) and its
re-application ("collapse v1..v59 migration ladder to canonical schema +
sharded write engine for ~1M CRUD/s", 2026-06-30) — both land *after* the
06-28 baseline capture and *before* this session's work began, so this is
not part of any commit from this session. This matches a standing project
memory note flagging the sharded write engine as a primary suspect for
memory-store behavior changes. Plausible mechanism: the schema collapse may
have retired the pre-sharding code path entirely, so even a fresh
per-question in-memory `MemoryStore` (as this harness constructs) now
executes through the sharded engine's aggregation/ranking code instead of
the prior unsharded path, and that path's top-K fusion behaves slightly
differently. **This has not been confirmed with a bisect against these
commits** — flagged as a follow-up investigation ("re-audit sharding, don't
just patch" per standing guidance) rather than rushed at the end of a long
session. The numbers in the table above are the honest current measurement,
not the 06-28 historical baseline.
