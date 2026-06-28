# TerranSoul MTEB LoCoMo Retrieval Report

Date: 2026-06-28T05:25:07.937Z
Dataset: mteb/LoCoMo @ 02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac
Systems: search, rrf, rrf_emb
Tasks: single_hop, multi_hop, temporal_reasoning, open_domain, adversarial
Top K requested: 100

This is retrieval-only MTEB qrel scoring over the LoCoMo-derived text-retrieval task. It is not end-to-end LoCoMo QA accuracy.

## Overall

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | search | 1976 | 31.2% | 49.6% | 55.9% | 62.3% | 75.9% | 44.4% | 39.7% | 43.4% | 711.20ms | 7,271 |
| overall | rrf | 1976 | 37.2% | 61.4% | 69.3% | 78.7% | 91.7% | 54.9% | 48.7% | 53.6% | 1229.43ms | 7,325 |
| overall | rrf_emb | 1976 | 36.9% | 60.4% | 66.6% | 73.8% | 87.1% | 53.5% | 47.8% | 52.5% | 775.74ms | 7,292 |

## By Task

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| single_hop | search | 840 | 35.6% | 56.8% | 62.6% | 69.3% | 81.9% | 49.4% | 44.8% | 46.6% | 934.74ms | 7,280 |
| single_hop | rrf | 840 | 46.7% | 70.2% | 77.8% | 86.6% | 96.0% | 62.4% | 57.1% | 59.0% | 1641.38ms | 7,333 |
| single_hop | rrf_emb | 840 | 45.1% | 68.7% | 74.3% | 81.4% | 91.5% | 60.2% | 55.3% | 57.2% | 810.36ms | 7,288 |
| multi_hop | search | 280 | 7.7% | 19.8% | 28.5% | 35.4% | 54.6% | 22.5% | 16.0% | 29.6% | 558.52ms | 7,330 |
| multi_hop | rrf | 280 | 14.3% | 37.8% | 49.6% | 62.8% | 85.3% | 40.6% | 30.6% | 49.7% | 917.74ms | 7,441 |
| multi_hop | rrf_emb | 280 | 13.4% | 35.3% | 44.3% | 53.5% | 77.4% | 37.4% | 28.3% | 46.9% | 814.75ms | 7,409 |
| temporal_reasoning | search | 321 | 45.7% | 61.2% | 66.5% | 72.7% | 83.4% | 56.6% | 52.8% | 55.5% | 532.21ms | 7,184 |
| temporal_reasoning | rrf | 321 | 48.4% | 73.4% | 78.1% | 85.7% | 94.6% | 65.3% | 60.0% | 63.8% | 833.64ms | 7,222 |
| temporal_reasoning | rrf_emb | 321 | 50.4% | 72.2% | 76.5% | 81.6% | 91.9% | 65.0% | 60.2% | 63.6% | 665.96ms | 7,227 |
| open_domain | search | 89 | 11.0% | 23.9% | 29.6% | 31.9% | 49.0% | 21.4% | 16.9% | 22.1% | 642.27ms | 7,247 |
| open_domain | rrf | 89 | 18.4% | 37.4% | 47.7% | 58.6% | 79.5% | 35.3% | 28.1% | 37.6% | 1403.90ms | 7,415 |
| open_domain | rrf_emb | 89 | 16.7% | 35.2% | 43.4% | 48.7% | 70.7% | 32.3% | 25.8% | 34.5% | 861.99ms | 7,244 |
| adversarial | search | 446 | 31.2% | 51.3% | 58.2% | 64.8% | 77.9% | 44.6% | 40.0% | 41.4% | 528.62ms | 7,285 |
| adversarial | rrf | 446 | 29.5% | 55.7% | 63.5% | 72.8% | 88.2% | 46.1% | 40.4% | 41.8% | 899.27ms | 7,293 |
| adversarial | rrf_emb | 446 | 30.4% | 57.1% | 63.5% | 71.7% | 85.0% | 46.9% | 41.5% | 42.8% | 747.85ms | 7,283 |

## Methodology Notes

- Each task loads the pinned MTEB `*-corpus`, `*-queries`, and `*-qrels` parquet files.
- Corpus rows are inserted into a fresh in-memory TerranSoul `MemoryStore` through the existing Rust JSONL IPC shim.
- `search` uses TerranSoul FTS5 lexical ranking and gated graph boost paths. `rrf` uses `hybrid_search_rrf(query, None, top_k)`.
- Metrics are computed from qrels: recall@K is relevant-doc coverage, hit@K is any-relevant-hit, NDCG@10 uses qrel scores, MAP@10 is truncated average precision, and MRR@100 is first relevant rank.
