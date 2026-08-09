# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-25T13:18:08.168Z
Dataset: target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 3 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 | effective embed model: mxbai-embed-large (harness default)

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| chat | 100.0% | 100.0% | 100.0% | 87.7% | 83.3% | 934.99ms | 46,566 |

## By Question Type

### chat

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 3 | 100.0% | 100.0% | 87.7% | 83.3% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
