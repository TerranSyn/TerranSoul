# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-24T14:40:41.091Z
Dataset: target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 5 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_CHAT_MODEL=gemma4:12b-it-qat LONGMEM_RERANK_MODEL=gemma4:12b-it-qat | effective embed model: none (LONGMEM_EMBED unset — dense channel OFF)

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| research | 100.0% | 100.0% | 100.0% | 92.6% | 90.0% | 7963.56ms | 54,684 |
| max | 60.0% | 60.0% | 60.0% | 52.6% | 50.0% | 9827.94ms | 46,778 |

## By Question Type

### research

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 5 | 100.0% | 100.0% | 92.6% | 90.0% |

### max

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 5 | 60.0% | 60.0% | 52.6% | 50.0% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
