# TerranSoul LoCoMo-at-Scale IVF-PQ Report (an internal work item)

Date: 2026-05-18T06:59:15.282Z
Task: adversarial
Scale: 10,000,000 chunks
Shard mode: routed
IVF-PQ: nlist=4096, pq_m=128, pq_nbits=8, nprobe=32
Ingest time: 5.6s (500000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ivfpq | 446 | 0.0% | NaN% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 19.70ms | 14.96ms | 21.32ms | 34.17ms | 1689.81ms |

## Methodology

- Identical corpus build pipeline to an internal work item (same mulberry32 seed 0x5ca1e1 → byte-for-byte identical corpora at matching `--scale`).
- Ingests in batches of 5000 through `longmemeval-ipc` with `LONGMEM_DATA_DIR` set so the MemoryStore opens an on-disk SQLite + persists HNSW per shard.
- After ingest, sends `op: build_ivf_pq` which calls `MemoryStore::build_ivf_pq_indexes_with_params` — writes per-shard sidecars with custom `IvfPqParams { nlist, pq_m, pq_nbits }`, then trains coarse k-means + PQ codebooks + writes IVF-PQ binary indexes.
- Query path: `op: search`, `mode: ivfpq` → `MemoryStore::vector_search_ivf_pq` → per-shard ADC search via `IvfPqIndex::search(query, k, nprobe)` → RRF merge across shards → SQLite hydrate.
