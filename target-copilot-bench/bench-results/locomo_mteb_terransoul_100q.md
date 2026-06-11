# TerranSoul MTEB LoCoMo Retrieval Report

Date: 2026-05-27T01:05:25.083Z
Dataset: mteb/LoCoMo @ 02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac
Systems: rrf, rrf_kg, rrf_hyde
Tasks: multi_hop, open_domain
Top K requested: 100

This is retrieval-only MTEB qrel scoring over the LoCoMo-derived text-retrieval task. It is not end-to-end LoCoMo QA accuracy.

## Overall

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | rrf | 100 | 11.0% | 34.7% | 45.3% | 58.9% | 77.0% | 32.6% | 23.5% | 36.8% | 1030.68ms | 7,433 |
| overall | rrf_kg | 100 | 11.0% | 34.7% | 45.3% | 58.9% | 64.3% | 32.6% | 23.5% | 36.6% | 4239.64ms | 2,288 |
| overall | rrf_hyde | 100 | 8.8% | 31.7% | 44.6% | 53.7% | 74.2% | 30.5% | 21.4% | 34.0% | 1678.03ms | 7,481 |

## By Task

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| multi_hop | rrf | 50 | 11.3% | 34.1% | 47.7% | 63.9% | 85.6% | 34.6% | 23.8% | 41.0% | 838.14ms | 7,452 |
| multi_hop | rrf_kg | 50 | 11.3% | 34.1% | 47.7% | 63.9% | 71.5% | 34.6% | 23.8% | 40.9% | 4416.60ms | 2,299 |
| multi_hop | rrf_hyde | 50 | 9.8% | 31.1% | 46.9% | 58.0% | 86.3% | 33.5% | 22.6% | 40.8% | 1481.41ms | 7,485 |
| open_domain | rrf | 50 | 10.7% | 35.3% | 42.8% | 54.0% | 68.3% | 30.6% | 23.2% | 32.5% | 1223.22ms | 7,414 |
| open_domain | rrf_kg | 50 | 10.7% | 35.3% | 42.8% | 54.0% | 57.0% | 30.6% | 23.2% | 32.4% | 4062.68ms | 2,277 |
| open_domain | rrf_hyde | 50 | 7.7% | 32.3% | 42.3% | 49.3% | 62.2% | 27.6% | 20.1% | 27.3% | 1874.64ms | 7,477 |

## Methodology Notes

- Each task loads the pinned MTEB `*-corpus`, `*-queries`, and `*-qrels` parquet files.
- Corpus rows are inserted into a fresh in-memory TerranSoul `MemoryStore` through the existing Rust JSONL IPC shim.
- `search` uses TerranSoul FTS5 lexical ranking and gated graph boost paths. `rrf` uses `hybrid_search_rrf(query, None, top_k)`.
- Metrics are computed from qrels: recall@K is relevant-doc coverage, hit@K is any-relevant-hit, NDCG@10 uses qrel scores, MAP@10 is truncated average precision, and MRR@100 is first relevant rank.
