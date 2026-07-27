# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-24T18:13:25.682Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 25 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_CHAT_MODEL=gemma4:12b-it-qat LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma:latest | effective embed model: embeddinggemma:latest

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| rrf | 96.0% | 100.0% | 100.0% | 93.4% | 91.4% | 585.36ms | 60,291 |
| chat | 96.0% | 100.0% | 100.0% | 89.0% | 85.4% | 205.49ms | 60,277 |
| think | 96.0% | 100.0% | 100.0% | 90.5% | 87.4% | 4297.17ms | 55,536 |
| research | 96.0% | 100.0% | 100.0% | 93.4% | 91.4% | 5598.95ms | 60,277 |
| max | 96.0% | 100.0% | 100.0% | 95.9% | 94.7% | 10693.74ms | 60,277 |

## By Question Type

### rrf

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 25 | 96.0% | 100.0% | 93.4% | 91.4% |

### chat

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 25 | 96.0% | 100.0% | 89.0% | 85.4% |

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 25 | 96.0% | 100.0% | 90.5% | 87.4% |

### research

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 25 | 96.0% | 100.0% | 93.4% | 91.4% |

### max

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 25 | 96.0% | 100.0% | 95.9% | 94.7% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
