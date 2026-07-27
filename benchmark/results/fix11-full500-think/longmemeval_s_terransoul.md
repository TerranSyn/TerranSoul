# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-26T21:36:42.059Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma:latest | effective embed model: embeddinggemma:latest

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| think | 98.6% | 99.0% | 99.2% | 87.6% | 94.4% | 4710.05ms | 48,733 |

## By Question Type

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 97.1% | 90.8% | 88.7% |
| multi-session | 133 | 99.2% | 99.2% | 79.0% | 96.1% |
| single-session-preference | 30 | 93.3% | 96.7% | 89.1% | 86.6% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 89.6% | 95.3% |
| knowledge-update | 78 | 98.7% | 98.7% | 88.9% | 97.4% |
| single-session-assistant | 56 | 98.2% | 100.0% | 96.6% | 95.5% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
