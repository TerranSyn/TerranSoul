# TerranSoul MTEB LoCoMo Retrieval Report

Date: 2026-06-09T01:54:14.693Z
Dataset: mteb/LoCoMo @ 02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac
Systems: search, rrf
Tasks: single_hop, multi_hop, temporal_reasoning, open_domain, adversarial
Top K requested: 100

This is retrieval-only MTEB qrel scoring over the LoCoMo-derived text-retrieval task. It is not end-to-end LoCoMo QA accuracy.

## Overall

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | search | 1976 | 31.5% | 49.8% | 56.5% | 63.2% | 76.1% | 44.9% | 40.1% | 43.9% | 763.57ms | 7,266 |
| overall | rrf | 1976 | 31.1% | 50.0% | 57.2% | 63.5% | 76.9% | 45.0% | 40.1% | 43.7% | 588.86ms | 7,263 |

## By Task

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| single_hop | search | 840 | 35.9% | 56.9% | 63.4% | 70.1% | 82.1% | 49.9% | 45.2% | 47.0% | 1016.38ms | 7,278 |
| single_hop | rrf | 840 | 35.4% | 58.0% | 64.5% | 70.6% | 82.9% | 50.2% | 45.3% | 46.9% | 608.96ms | 7,274 |
| multi_hop | search | 280 | 7.9% | 20.2% | 28.9% | 36.6% | 55.4% | 22.9% | 16.2% | 30.3% | 709.22ms | 7,321 |
| multi_hop | rrf | 280 | 7.8% | 21.6% | 30.8% | 38.0% | 56.8% | 24.2% | 17.2% | 31.4% | 580.08ms | 7,323 |
| temporal_reasoning | search | 321 | 46.2% | 62.4% | 67.4% | 73.6% | 83.4% | 57.3% | 53.3% | 56.1% | 478.57ms | 7,176 |
| temporal_reasoning | rrf | 321 | 46.1% | 62.3% | 68.1% | 73.5% | 84.3% | 57.7% | 53.6% | 56.3% | 506.20ms | 7,173 |
| open_domain | search | 89 | 12.2% | 25.1% | 30.1% | 33.6% | 50.1% | 22.3% | 18.0% | 23.2% | 655.77ms | 7,245 |
| open_domain | rrf | 89 | 10.8% | 23.6% | 29.2% | 35.6% | 51.3% | 21.2% | 16.8% | 22.3% | 726.71ms | 7,263 |
| adversarial | search | 446 | 31.6% | 51.1% | 58.4% | 65.5% | 77.9% | 44.9% | 40.4% | 41.8% | 548.17ms | 7,278 |
| adversarial | rrf | 446 | 30.9% | 49.2% | 57.8% | 64.7% | 78.3% | 44.0% | 39.5% | 40.7% | 588.53ms | 7,273 |

## Methodology Notes

- Each task loads the pinned MTEB `*-corpus`, `*-queries`, and `*-qrels` parquet files.
- Corpus rows are inserted into a fresh in-memory TerranSoul `MemoryStore` through the existing Rust JSONL IPC shim.
- `search` uses TerranSoul FTS5 lexical ranking and gated graph boost paths. `rrf` uses `hybrid_search_rrf(query, None, top_k)`.
- Metrics are computed from qrels: recall@K is relevant-doc coverage, hit@K is any-relevant-hit, NDCG@10 uses qrel scores, MAP@10 is truncated average precision, and MRR@100 is first relevant rank.
