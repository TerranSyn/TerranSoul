# TerranSoul LoCoMo-at-Scale Report (BENCH-SCALE-1)

Date: 2026-06-07T12:03:00.264Z
Task: adversarial
Scale: 100,000 chunks
Systems: ivfpq
Shard mode: routed
Ingest time: 474.4s (100000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ivfpq | 100 | 15.0% | 21.0% | 28.5% | 31.5% | 42.5% | 20.7% | 18.3% | 18.8% | 317.12ms | 331.13ms | 535.43ms | 1978.24ms | 1978.24ms |

## Methodology

- Loads MTEB LoCoMo `<task>-corpus`, `<task>-queries`, `<task>-qrels` parquet files from the cached download.
- Augments with cross-task LoCoMo prose as natural distractors, then deterministic entity-swap paraphrases of gold chunks, then synthetic template prose to reach `--scale`.
- Ingests in batches of 500 through `longmemeval-ipc` with `LONGMEM_EMBED=1` (mxbai-embed-large via Ollama, HNSW ANN).
- Runs each `--systems` mode against the buried corpus, records per-query latency.
- Acceptance (BENCH-SCALE-1): R@10 within 10pp of LCM-8 5k baseline AND p99 <= 200ms.
