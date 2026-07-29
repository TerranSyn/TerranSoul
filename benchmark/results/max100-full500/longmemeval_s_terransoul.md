# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-25T13:25:12.018Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 | effective embed model: mxbai-embed-large (harness default)

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| chat | 98.0% | 99.2% | 99.6% | 87.4% | 87.7% | 639.21ms | 62,559 |

## By Question Type

### chat

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 98.6% | 100.0% | 89.9% | 86.4% |
| multi-session | 133 | 98.5% | 99.2% | 84.2% | 88.1% |
| single-session-preference | 30 | 96.7% | 100.0% | 82.5% | 76.7% |
| temporal-reasoning | 133 | 98.5% | 100.0% | 86.0% | 87.3% |
| knowledge-update | 78 | 98.7% | 98.7% | 92.4% | 91.5% |
| single-session-assistant | 56 | 94.6% | 96.4% | 91.2% | 89.7% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
