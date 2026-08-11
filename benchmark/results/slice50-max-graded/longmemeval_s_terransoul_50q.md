# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-08-01T14:32:11.893Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 50 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_CHAT_MODEL=gemma4:12b-it-qat LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma LONGMEM_SET_FLAGS=agentic-verify-rank-retrieval:avr.judge_graded=true,agentic-verify-rank-retrieval:avr.fusion_alpha=0.7 OLLAMA_EMBED_NUM_GPU=99 | effective embed model: embeddinggemma

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR@20 | MRR@20 | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| max | 98.0% | 98.0% | 98.0% | 93.9% | 92.5% | 92.5% | 61993.02ms | 58,864 |

## By Question Type

### max

| Type | Count | R@5 | R@10 | NDCG@10 | MRR@20 | MRR@20 |
|---|---:|---:|---:|---:|---:|---:|
| single-session-user | 50 | 98.0% | 98.0% | 93.9% | 92.5% | 92.5% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
