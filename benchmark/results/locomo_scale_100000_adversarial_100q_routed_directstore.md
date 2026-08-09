# TerranSoul LoCoMo-at-Scale Report (an internal work item)

Date: 2026-05-26T17:53:13.731Z
Task: adversarial
Scale: 100,000 chunks
Systems: rrf
Shard mode: routed
Ingest time: 2021.5s (100000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| rrf | 100 | 31.5% | 55.0% | 64.0% | 68.5% | 80.0% | 46.6% | 40.9% | 42.1% | 4684.22ms | 2054.68ms | 6854.10ms | 191064.99ms | 191064.99ms |

## Methodology

- Loads MTEB LoCoMo `<task>-corpus`, `<task>-queries`, `<task>-qrels` parquet files from the cached download.
- Augments with cross-task LoCoMo prose as natural distractors, then deterministic entity-swap paraphrases of gold chunks, then synthetic template prose to reach `--scale`.
- Ingests in batches of 500 through `longmemeval-ipc` with `LONGMEM_EMBED=1` (mxbai-embed-large via Ollama, HNSW ANN).
- Runs each `--systems` mode against the buried corpus, records per-query latency.
- Acceptance (an internal work item): R@10 within 10pp of an internal work item 5k baseline AND p99 <= 200ms.
