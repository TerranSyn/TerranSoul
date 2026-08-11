# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-31T23:05:28.114Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 10 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_CHAT_MODEL=gemma4:12b-it-qat LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma LONGMEM_SET_FLAGS=rerank-pool:rerank.listwise=true | effective embed model: embeddinggemma

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR@20 | MRR@undefined | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| think | 100.0% | 100.0% | 100.0% | 92.6% | 90.0% | 90.0% | 5029.38ms | 59,192 |

## By Question Type

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR@20 | MRR@undefined |
|---|---:|---:|---:|---:|---:|---:|
| single-session-user | 10 | 100.0% | 100.0% | 92.6% | 90.0% | 90.0% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
