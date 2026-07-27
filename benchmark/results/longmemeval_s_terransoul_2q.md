# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-24T14:33:22.606Z
Dataset: built-in sample
Questions: 2 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: (no LONGMEM_* vars set) | effective embed model: none (LONGMEM_EMBED unset — dense channel OFF)

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| chat | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 638.07ms | 41 |
| think | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 158.73ms | 41 |
| research | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 106.60ms | 41 |
| max | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 109.27ms | 0 |

## By Question Type

### chat

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 1 | 100.0% | 100.0% | 100.0% | 100.0% |
| multi-session | 1 | 100.0% | 100.0% | 100.0% | 100.0% |

### think

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 1 | 100.0% | 100.0% | 100.0% | 100.0% |
| multi-session | 1 | 100.0% | 100.0% | 100.0% | 100.0% |

### research

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 1 | 100.0% | 100.0% | 100.0% | 100.0% |
| multi-session | 1 | 100.0% | 100.0% | 100.0% | 100.0% |

### max

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 1 | 0.0% | 0.0% | 0.0% | 0.0% |
| multi-session | 1 | 0.0% | 0.0% | 0.0% | 0.0% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
