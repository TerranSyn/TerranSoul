# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-08-01T12:33:06.583Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 50 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_CHAT_MODEL=gemma4:12b-it-qat LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma OLLAMA_EMBED_NUM_GPU=99 | effective embed model: embeddinggemma

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR@20 | MRR@20 | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| max | 98.0% | 100.0% | 100.0% | 97.7% | 97.0% | 97.0% | 66071.04ms | 60,575 |

## By Question Type

### max

| Type | Count | R@5 | R@10 | NDCG@10 | MRR@20 | MRR@20 |
|---|---:|---:|---:|---:|---:|---:|
| single-session-user | 50 | 98.0% | 100.0% | 97.7% | 97.0% | 97.0% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
