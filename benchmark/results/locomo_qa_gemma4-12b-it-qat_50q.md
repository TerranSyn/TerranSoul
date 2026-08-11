# TerranSoul LoCoMo End-to-End QA Report (TOP1-2)

Date: 2026-08-02T11:18:53.618Z
Dataset: mteb/LoCoMo @ 02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac
Retrieval system: chat
Generator: gemma4:12b-it-qat
Judge: gemma4:12b-it-qat
QA eval mode: mem0-paper
Top K: 100

## J-Score Results (0-100 scale)

| Task | Queries | J-score | R@10 | NDCG@10 | Judge failures |
|---|---:|---:|---:|---:|---:|
| single_hop | 10 | 71.0 | 50.0% | 37.6% | 0 |
| multi_hop | 10 | 68.0 | 83.3% | 59.2% | 0 |
| temporal_reasoning | 10 | 89.0 | 90.0% | 75.6% | 0 |
| open_domain | 10 | 56.0 | 75.0% | 52.0% | 0 |
| adversarial | 10 | 80.0 | 60.0% | 54.3% | 0 |
| **overall** | 50 | **72.8** | 71.7% | 55.8% | 0 |

## Mem0-paper baselines (gpt-4o-mini judge, Chhikara et al. 2025)

| System | single_hop | multi_hop | open_domain | temporal |
|---|---:|---:|---:|---:|
| Mem0 | 67.13 | 51.15 | 72.93 | 55.51 |
| Mem0_g | 65.71 | 47.19 | 75.71 | 58.13 |
| Zep | 61.70 | 41.35 | 76.60 | 49.31 |
| LangMem | 62.23 | 47.92 | 71.12 | 23.43 |
| OpenAI memory | 63.79 | 42.92 | 62.29 | 21.71 |
| full-context | ~72.90 | — | — | — |

## Methodology

Per query: (1) retrieve top-K from TerranSoul MemoryStore, (2) prompt the generator
for a concise answer using retrieved context, (3) prompt the judge to rate the
generated answer 0-10 against the qrel-mapped reference context, (4) J-score =
mean(judge_scores) × 10 → 0-100 scale.

This mirrors the Mem0 paper's LLM-as-Judge methodology (Chhikara et al. 2025,
arXiv:2504.19413, Appendix A). When judge=gpt-4o-mini, scores are directly
comparable to the Mem0-paper baselines. Local-judge scores (e.g. gemma3:4b) are
directionally comparable but not strictly equivalent.
