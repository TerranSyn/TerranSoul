# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-06-07T09:47:57.253Z
Dataset: D:\Git\TerranSoul\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 150 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| search | 99.3% | 100.0% | 100.0% | 86.4% | 87.3% | 353.96ms | 59,490 |
| rrf | 99.3% | 100.0% | 100.0% | 86.7% | 88.0% | 448.53ms | 60,651 |

## By Question Type

### search

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 98.6% | 100.0% | 91.2% | 88.2% |
| multi-session | 62 | 100.0% | 100.0% | 82.3% | 89.4% |
| single-session-preference | 18 | 100.0% | 100.0% | 82.4% | 76.4% |

### rrf

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 98.6% | 100.0% | 91.4% | 88.6% |
| multi-session | 62 | 100.0% | 100.0% | 82.8% | 90.9% |
| single-session-preference | 18 | 100.0% | 100.0% | 82.1% | 76.1% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
