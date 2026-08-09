# TerranSoul LoCoMo-at-Scale Report (an internal work item)

Date: 2026-05-26T17:09:28.962Z
Task: adversarial
Scale: 6,000 chunks
Systems: rrf
Shard mode: routed
Ingest time: 122.7s (6000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| rrf | 3 | 0.0% | 33.3% | 66.7% | 100.0% | 100.0% | 27.8% | 15.9% | 18.3% | 1778.79ms | 1239.61ms | 3525.17ms | 3525.17ms | 3525.17ms |

## Methodology

- Loads MTEB LoCoMo `<task>-corpus`, `<task>-queries`, `<task>-qrels` parquet files from the cached download.
- Augments with cross-task LoCoMo prose as natural distractors, then deterministic entity-swap paraphrases of gold chunks, then synthetic template prose to reach `--scale`.
- Ingests in batches of 500 through `longmemeval-ipc` with `LONGMEM_EMBED=1` (mxbai-embed-large via Ollama, HNSW ANN).
- Runs each `--systems` mode against the buried corpus, records per-query latency.
- Acceptance (an internal work item): R@10 within 10pp of an internal work item 5k baseline AND p99 <= 200ms.
