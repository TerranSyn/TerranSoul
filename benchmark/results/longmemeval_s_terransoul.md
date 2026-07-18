# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-18T14:50:35.203Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma | effective embed model: embeddinggemma

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| search | 98.4% | 99.8% | 100.0% | 88.8% | 89.0% | 410.75ms | 62,355 |
| rrf | 99.4% | 100.0% | 100.0% | 95.1% | 95.8% | 677.70ms | 62,966 |
| rrf_emb | 99.6% | 100.0% | 100.0% | 94.4% | 95.3% | 625.90ms | 62,445 |

## By Question Type

### search

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 100.0% | 92.7% | 90.3% |
| multi-session | 133 | 98.5% | 100.0% | 84.8% | 88.4% |
| single-session-preference | 30 | 96.7% | 100.0% | 82.6% | 76.9% |
| temporal-reasoning | 133 | 98.5% | 100.0% | 86.4% | 87.4% |
| knowledge-update | 78 | 98.7% | 98.7% | 93.1% | 92.2% |
| single-session-assistant | 56 | 100.0% | 100.0% | 96.2% | 94.9% |

### rrf

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 100.0% | 94.3% | 92.5% |
| multi-session | 133 | 100.0% | 100.0% | 94.6% | 96.9% |
| single-session-preference | 30 | 96.7% | 100.0% | 92.4% | 89.9% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 93.1% | 94.9% |
| knowledge-update | 78 | 100.0% | 100.0% | 98.5% | 98.7% |
| single-session-assistant | 56 | 100.0% | 100.0% | 98.7% | 98.2% |

### rrf_emb

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 98.6% | 100.0% | 94.9% | 93.3% |
| multi-session | 133 | 100.0% | 100.0% | 93.8% | 97.1% |
| single-session-preference | 30 | 96.7% | 100.0% | 89.6% | 86.1% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 92.2% | 93.8% |
| knowledge-update | 78 | 100.0% | 100.0% | 98.3% | 99.0% |
| single-session-assistant | 56 | 100.0% | 100.0% | 97.4% | 96.4% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
