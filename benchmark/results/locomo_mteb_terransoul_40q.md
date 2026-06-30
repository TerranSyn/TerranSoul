# TerranSoul MTEB LoCoMo Retrieval Report

Date: 2026-06-30T00:25:24.433Z
Dataset: mteb/LoCoMo @ 02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac
Systems: rrf, rrf_multihop_llm
Tasks: multi_hop
Top K requested: 100

This is retrieval-only MTEB qrel scoring over the LoCoMo-derived text-retrieval task. It is not end-to-end LoCoMo QA accuracy.

## Overall

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | rrf | 40 | 10.4% | 40.2% | 47.3% | 61.1% | 87.0% | 35.0% | 25.4% | 39.3% | 984.88ms | 7,458 |
| overall | rrf_multihop_llm | 40 | 0.8% | 19.9% | 30.1% | 48.9% | 83.8% | 18.1% | 10.6% | 20.1% | 9145.03ms | 7,326 |

## By Task

| Task | System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 | Avg latency | Avg tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| multi_hop | rrf | 40 | 10.4% | 40.2% | 47.3% | 61.1% | 87.0% | 35.0% | 25.4% | 39.3% | 984.88ms | 7,458 |
| multi_hop | rrf_multihop_llm | 40 | 0.8% | 19.9% | 30.1% | 48.9% | 83.8% | 18.1% | 10.6% | 20.1% | 9145.03ms | 7,326 |

## Methodology Notes

- Each task loads the pinned MTEB `*-corpus`, `*-queries`, and `*-qrels` parquet files.
- Corpus rows are inserted into a fresh in-memory TerranSoul `MemoryStore` through the existing Rust JSONL IPC shim.
- `search` uses TerranSoul FTS5 lexical ranking and gated graph boost paths. `rrf` uses `hybrid_search_rrf(query, None, top_k)`.
- Metrics are computed from qrels: recall@K is relevant-doc coverage, hit@K is any-relevant-hit, NDCG@10 uses qrel scores, MAP@10 is truncated average precision, and MRR@100 is first relevant rank.
