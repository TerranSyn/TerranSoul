# TerranSoul MTEB LoCoMo Retrieval Report

Date: 2026-06-27T18:11:00.098Z
Dataset: mteb/LoCoMo @ 02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac
Systems: search, rrf, rrf_emb
Tasks: single_hop, multi_hop, temporal_reasoning, open_domain, adversarial
Top K requested: 100

This is retrieval-only MTEB qrel scoring over the LoCoMo-derived text-retrieval task. It is not end-to-end LoCoMo QA accuracy.

## Overall

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | search | 1976 | 31.5% | 49.8% | 56.5% | 63.2% | 76.1% | 44.9% | 40.1% | 43.9% | 535.13ms | 7,266 |
| overall | rrf | 1976 | 31.9% | 56.2% | 65.8% | 75.8% | 89.9% | 49.8% | 43.3% | 48.0% | 812.37ms | 7,270 |
| overall | rrf_emb | 1976 | 32.7% | 57.1% | 64.5% | 72.0% | 85.8% | 49.9% | 43.9% | 48.3% | 638.74ms | 7,260 |

## By Task

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| single_hop | search | 840 | 35.9% | 56.9% | 63.4% | 70.1% | 82.1% | 49.9% | 45.2% | 47.0% | 572.93ms | 7,278 |
| single_hop | rrf | 840 | 40.0% | 64.8% | 73.5% | 83.1% | 94.7% | 56.4% | 50.6% | 52.6% | 806.02ms | 7,283 |
| single_hop | rrf_emb | 840 | 41.0% | 65.2% | 71.8% | 79.0% | 90.9% | 56.5% | 51.2% | 53.1% | 636.63ms | 7,273 |
| multi_hop | search | 280 | 7.9% | 20.2% | 28.9% | 36.6% | 55.4% | 22.9% | 16.2% | 30.3% | 483.03ms | 7,321 |
| multi_hop | rrf | 280 | 11.6% | 35.1% | 46.1% | 59.0% | 81.5% | 36.6% | 26.6% | 45.0% | 820.57ms | 7,400 |
| multi_hop | rrf_emb | 280 | 11.3% | 32.5% | 42.6% | 51.2% | 74.3% | 34.6% | 25.5% | 43.0% | 647.37ms | 7,380 |
| temporal_reasoning | search | 321 | 46.2% | 62.4% | 67.4% | 73.6% | 83.4% | 57.3% | 53.3% | 56.1% | 459.22ms | 7,176 |
| temporal_reasoning | rrf | 321 | 44.2% | 66.7% | 74.9% | 82.7% | 92.2% | 60.6% | 55.1% | 58.3% | 732.52ms | 7,108 |
| temporal_reasoning | rrf_emb | 321 | 45.2% | 67.9% | 73.6% | 80.1% | 89.7% | 60.8% | 55.7% | 58.8% | 572.38ms | 7,145 |
| open_domain | search | 89 | 12.2% | 25.1% | 30.1% | 33.6% | 50.1% | 22.3% | 18.0% | 23.2% | 641.79ms | 7,245 |
| open_domain | rrf | 89 | 15.8% | 34.9% | 43.1% | 52.9% | 72.1% | 31.8% | 25.2% | 33.3% | 1017.58ms | 7,341 |
| open_domain | rrf_emb | 89 | 18.0% | 36.0% | 41.8% | 48.7% | 68.1% | 32.0% | 26.0% | 33.4% | 782.04ms | 7,173 |
| adversarial | search | 446 | 31.6% | 51.1% | 58.4% | 65.5% | 77.9% | 44.9% | 40.4% | 41.8% | 529.99ms | 7,278 |
| adversarial | rrf | 446 | 23.5% | 50.0% | 61.4% | 72.0% | 87.9% | 41.5% | 35.0% | 36.8% | 835.68ms | 7,265 |
| adversarial | rrf_emb | 446 | 24.3% | 53.9% | 62.3% | 71.0% | 84.2% | 43.0% | 36.7% | 38.1% | 656.45ms | 7,262 |

## Methodology Notes

- Each task loads the pinned MTEB `*-corpus`, `*-queries`, and `*-qrels` parquet files.
- Corpus rows are inserted into a fresh in-memory TerranSoul `MemoryStore` through the existing Rust JSONL IPC shim.
- `search` uses TerranSoul FTS5 lexical ranking and gated graph boost paths. `rrf` uses `hybrid_search_rrf(query, None, top_k)`.
- Metrics are computed from qrels: recall@K is relevant-doc coverage, hit@K is any-relevant-hit, NDCG@10 uses qrel scores, MAP@10 is truncated average precision, and MRR@100 is first relevant rank.
