# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-08-11T08:46:39.022Z
Dataset: D:\Git\TerranSoulApp\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts
Env: LONGMEM_EMBED=1 LONGMEM_EMBED_MODEL=embeddinggemma:latest LONGMEM_IPC_CMD=["target-copilot-bench/release/longmemeval-ipc.exe"] OLLAMA_EMBED_NUM_GPU=99 | effective embed model: embeddinggemma:latest

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR@20 | MRR@20 | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chat | 99.2% | 99.8% | 100.0% | 93.9% | 94.4% | 94.4% | 223.31ms | 62,718 |

## By Question Type

### chat

| Type | Count | R@5 | R@10 | NDCG@10 | MRR@20 | MRR@20 |
|---|---:|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 98.6% | 91.8% | 89.7% | 89.7% |
| multi-session | 133 | 100.0% | 100.0% | 94.1% | 96.1% | 96.1% |
| single-session-preference | 30 | 96.7% | 100.0% | 89.5% | 86.0% | 86.0% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 92.4% | 94.1% | 94.1% |
| knowledge-update | 78 | 100.0% | 100.0% | 98.2% | 98.7% | 98.7% |
| single-session-assistant | 56 | 98.2% | 100.0% | 96.2% | 94.9% | 94.9% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.
