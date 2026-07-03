# TerranSoul LongMemEval-S Retrieval Report

Date: 2026-07-03T00:37:56.652Z
Dataset: D:\Git\ts-timeanchor-wt\target-copilot-bench\longmemeval\longmemeval_s_cleaned.json
Questions: 500 (0 abstention rows excluded)
Methodology: retrieval-only recall_any@K, matching agentmemory benchmark/longmemeval-bench.ts

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Avg latency | Avg retrieved tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| search | 98.4% | 99.8% | 100.0% | 88.8% | 89.0% | 447.48ms | 62,355 |
| rrf | 99.4% | 99.8% | 100.0% | 95.1% | 95.9% | 776.45ms | 62,932 |
| rrf_emb | 99.4% | 100.0% | 100.0% | 94.5% | 95.3% | 703.65ms | 62,080 |

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
| single-session-user | 70 | 97.1% | 98.6% | 93.9% | 92.5% |
| multi-session | 133 | 100.0% | 100.0% | 94.6% | 96.9% |
| single-session-preference | 30 | 96.7% | 100.0% | 92.4% | 89.9% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 93.1% | 94.9% |
| knowledge-update | 78 | 100.0% | 100.0% | 98.5% | 98.7% |
| single-session-assistant | 56 | 100.0% | 100.0% | 99.3% | 99.1% |

### rrf_emb

| Type | Count | R@5 | R@10 | NDCG@10 | MRR |
|---|---:|---:|---:|---:|---:|
| single-session-user | 70 | 97.1% | 100.0% | 94.8% | 93.2% |
| multi-session | 133 | 100.0% | 100.0% | 94.0% | 97.1% |
| single-session-preference | 30 | 96.7% | 100.0% | 89.6% | 86.1% |
| temporal-reasoning | 133 | 100.0% | 100.0% | 92.2% | 93.8% |
| knowledge-update | 78 | 100.0% | 100.0% | 98.3% | 99.0% |
| single-session-assistant | 56 | 100.0% | 100.0% | 98.0% | 97.3% |

## Methodology Notes

- This is not official LongMemEval QA accuracy. It is retrieval-only recall on the LongMemEval-S haystack.
- Each question builds a fresh in-memory TerranSoul `MemoryStore` from that question's haystack sessions, searches with the raw question text, and checks whether any gold answer session appears in the retrieved top-K.
- The optional Ollama judge is a local diagnostic for evidence support and is not comparable to agentmemory's published retrieval-only number.

## 2026-07-03 resolution — the "rrf regression" was an embedder-config mismatch, not code

The suspected NDCG@10 95.1→90.5 / MRR 96.0→90.9 regression (tracked since
2026-07-02) is **closed as configuration archaeology**. The table above is a
full 500-question re-run with `LONGMEM_EMBED=1` and
`LONGMEM_EMBED_MODEL=embeddinggemma` — the same embedder the 2026-06-28
baseline used (BENCH-AM-6.3) — on the anchored harness. It reproduces the
baseline to the decimal: `rrf` NDCG@10 **95.1 = 95.1**, R@5 **99.4 = 99.4**,
MRR 95.9 (−0.1, within the anchored run-to-run band); `rrf_emb`
**equal-or-higher** on every metric (94.5/95.3 vs 94.4/95.2).

Timeline of the false alarm: (1) the 06-28 baseline ran with EmbeddingGemma;
(2) later re-runs omitted `LONGMEM_EMBED=1` entirely (dense channel silently
off — rrf ≈ lexical); (3) re-runs that did set it fell back to the harness
default `mxbai-embed-large`, which lands in the documented "prior mxbai
canonical" band (NDCG@10 ~91) — read as a regression against the
EmbeddingGemma baseline. A same-night iter-1 with mxbai measured rrf_emb
91.1/91.7, matching BENCH-AM-6.1's 91.3/92.6 almost exactly, which broke the
case. Code paths positively exonerated along the way: sharded write engine +
schema collapse (bisect: byte-identical lexical `search` across all 500
questions), RAG categorization (A/B: identical retrieved-ID lists), and the
time-anchor (two anchored runs reproduce to 4 decimals).

Ops guardrails from this episode: reports must record the full `LONGMEM_*`
env + embed model (the harness now stamps them — see the header of future
runs); before any embed-heavy run, `/api/ps` must show the embed model with
`size_vram == size` (Ollama silently placed EmbeddingGemma CPU-side when
VRAM was occupied at load — identical vectors, ~40× slower, and first-call
spikes can exceed the 8s embed timeout).
