# TerranSoul LoCoMo-at-Scale Report (an internal work item)

Date: 2026-06-07T10:54:53.173Z
Task: adversarial
Scale: 6,000 chunks
Systems: ivfpq
Shard mode: routed
Ingest time: 28.8s (6000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ivfpq | 10 | 50.0% | 50.0% | 50.0% | 70.0% | 90.0% | 50.0% | 50.0% | 52.0% | 148.30ms | 79.24ms | 314.72ms | 314.72ms | 314.72ms |

## Methodology

- Loads MTEB LoCoMo `<task>-corpus`, `<task>-queries`, `<task>-qrels` parquet files from the cached download.
- Augments with cross-task LoCoMo prose as natural distractors, then deterministic entity-swap paraphrases of gold chunks, then synthetic template prose to reach `--scale`.
- Ingests in batches of 500 through `longmemeval-ipc` with `LONGMEM_EMBED=1` (mxbai-embed-large via Ollama, HNSW ANN).
- Runs each `--systems` mode against the buried corpus, records per-query latency.
- Acceptance (an internal work item): R@10 within 10pp of an internal work item 5k baseline AND p99 <= 200ms.
