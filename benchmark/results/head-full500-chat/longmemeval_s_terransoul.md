# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-26T17:47:47.595Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma:latest | effective embed model: embeddinggemma:latest

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| chat | 99.0% | 99.6% | 99.8% | 93.8% | 94.4% | 675.01ms | 62,435 |

## By Question Type

### chat

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 98.6% | 91.3% | 89.0% |
| multi-session | 133 | 99.2% | 99.2% | 93.5% | 95.7% |
| single-session-preference | 30 | 96.7% | 100.0% | 92.4% | 89.9% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 92.3% | 94.5% |
| knowledge-update | 78 | 100.0% | 100.0% | 98.0% | 98.1% |
| single-session-assistant | 56 | 98.2% | 100.0% | 96.0% | 94.6% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
