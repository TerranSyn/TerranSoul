# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-26T18:44:17.410Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma:latest | effective embed model: embeddinggemma:latest

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| think | 98.2% | 98.8% | 99.0% | 87.2% | 94.0% | 4704.02ms | 48,240 |

## By Question Type

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 98.6% | 91.3% | 89.0% |
| multi-session | 133 | 98.5% | 98.5% | 79.4% | 95.0% |
| single-session-preference | 30 | 90.0% | 93.3% | 87.0% | 84.9% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 89.3% | 94.9% |
| knowledge-update | 78 | 100.0% | 100.0% | 88.2% | 98.7% |
| single-session-assistant | 56 | 96.4% | 98.2% | 94.9% | 93.7% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
