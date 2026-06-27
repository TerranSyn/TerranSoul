# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-05-26T05:25:20.031Z
Dataset: D:\Git\TerranSoul\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| search | 98.6% | 99.8% | 100.0% | 88.8% | 89.1% | 812.46ms | 62,492 |
| rrf | 98.6% | 99.8% | 100.0% | 88.6% | 88.9% | 965.83ms | 62,949 |

## By Question Type

### search

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 98.6% | 100.0% | 91.2% | 88.2% |
| multi-session | 133 | 98.5% | 100.0% | 85.1% | 88.9% |
| single-session-preference | 30 | 96.7% | 100.0% | 82.6% | 76.9% |
| temporal-reasoning | 133 | 98.5% | 100.0% | 86.7% | 87.6% |
| knowledge-update | 78 | 98.7% | 98.7% | 93.5% | 93.3% |
| single-session-assistant | 56 | 100.0% | 100.0% | 96.0% | 94.6% |

### rrf

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 98.6% | 100.0% | 91.4% | 88.6% |
| multi-session | 133 | 98.5% | 100.0% | 85.1% | 89.3% |
| single-session-preference | 30 | 96.7% | 100.0% | 82.5% | 76.7% |
| temporal-reasoning | 133 | 98.5% | 100.0% | 86.0% | 86.5% |
| knowledge-update | 78 | 98.7% | 98.7% | 93.4% | 93.3% |
| single-session-assistant | 56 | 100.0% | 100.0% | 96.0% | 94.6% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
