# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-27T02:01:50.069Z
Dataset: target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma:latest | effective embed model: embeddinggemma:latest

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| think | 98.6% | 99.6% | 99.8% | 93.3% | 94.2% | 4765.40ms | 62,435 |

## By Question Type

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 95.7% | 98.6% | 91.3% | 88.9% |
| multi-session | 133 | 99.2% | 99.2% | 93.0% | 95.7% |
| single-session-preference | 30 | 96.7% | 100.0% | 90.0% | 86.8% |
| temporal-reasoning | 133 | 99.2% | 100.0% | 92.0% | 94.8% |
| knowledge-update | 78 | 100.0% | 100.0% | 97.0% | 97.9% |
| single-session-assistant | 56 | 98.2% | 100.0% | 95.9% | 94.6% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
