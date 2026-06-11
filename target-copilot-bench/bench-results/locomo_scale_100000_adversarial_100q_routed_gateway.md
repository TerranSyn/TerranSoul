# TerranSoul LoCoMo-at-Scale Report (BENCH-SCALE-1)

Date: 2026-05-26T18:31:45.340Z
Task: adversarial
Scale: 100,000 chunks
Systems: rrf
Shard mode: routed
Ingest time: 1997.3s (100000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| rrf | 100 | 30.5% | 52.0% | 63.0% | 68.5% | 80.0% | 45.3% | 39.6% | 40.9% | 2692.92ms | 1190.41ms | 4153.31ms | 114329.13ms | 114329.13ms |

## Methodology

- Loads MTEB LoCoMo `<task>-corpus`, `<task>-queries`, `<task>-qrels` parquet files from the cached download.
- Augments with cross-task LoCoMo prose as natural distractors, then deterministic entity-swap paraphrases of gold chunks, then synthetic template prose to reach `--scale`.
- Ingests in batches of 500 through `longmemeval-ipc` with `LONGMEM_EMBED=1` (mxbai-embed-large via Ollama, HNSW ANN).
- Runs each `--systems` mode against the buried corpus, records per-query latency.
- Acceptance (BENCH-SCALE-1): R@10 within 10pp of LCM-8 5k baseline AND p99 <= 200ms.
