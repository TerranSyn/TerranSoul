# TerranSoul LoCoMo-at-Scale IVF-PQ Report (BENCH-SCALE-3)

Date: 2026-05-17T17:50:15.718Z
Task: adversarial
Scale: 50,000 chunks
Shard mode: routed
IVF-PQ: nlist=256, pq_m=128, pq_nbits=8, nprobe=8
Ingest time: 59.2s (50000 embedded)

## Quality + Latency

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg lat | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ivfpq | 20 | 0.0% | NaN% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 178.99ms | 14.20ms | 3245.30ms | 3245.30ms | 3245.30ms |

## Methodology

- Identical corpus build pipeline to BENCH-SCALE-2 (same mulberry32 seed 0x5ca1e1 → byte-for-byte identical corpora at matching `--scale`).
- Ingests in batches of 5000 through `longmemeval-ipc` with `LONGMEM_DATA_DIR` set so the MemoryStore opens an on-disk SQLite + persists HNSW per shard.
- After ingest, sends `op: build_ivf_pq` which calls `MemoryStore::build_ivf_pq_indexes_with_params` — writes per-shard sidecars with custom `IvfPqParams { nlist, pq_m, pq_nbits }`, then trains coarse k-means + PQ codebooks + writes IVF-PQ binary indexes.
- Query path: `op: search`, `mode: ivfpq` → `MemoryStore::vector_search_ivf_pq` → per-shard ADC search via `IvfPqIndex::search(query, k, nprobe)` → RRF merge across shards → SQLite hydrate.
