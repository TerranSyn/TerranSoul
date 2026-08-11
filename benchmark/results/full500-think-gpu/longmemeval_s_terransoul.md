# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-08-01T09:22:50.079Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_CHAT_MODEL=gemma4:12b-it-qat LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma OLLAMA_EMBED_NUM_GPU=99 | effective embed model: embeddinggemma

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR@20 | MRR@undefined | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| think | 99.4% | 99.8% | 100.0% | 92.6% | 91.7% | 91.7% | 18894.45ms | 62,485 |

## By Question Type

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR@20 | MRR@undefined |
|---|---:|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 98.6% | 85.1% | 80.6% | 80.6% |
| multi-session | 133 | 100.0% | 100.0% | 93.6% | 94.2% | 94.2% |
| single-session-preference | 30 | 100.0% | 100.0% | 91.3% | 88.3% | 88.3% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 92.5% | 92.9% | 92.9% |
| knowledge-update | 78 | 100.0% | 100.0% | 95.6% | 94.7% | 94.7% |
| single-session-assistant | 56 | 98.2% | 100.0% | 96.0% | 94.6% | 94.6% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
