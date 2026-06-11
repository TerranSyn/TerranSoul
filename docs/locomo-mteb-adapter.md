# MTEB LoCoMo Retrieval Adapter

TerranSoul's LoCoMo adapter runs the MTEB `mteb/LoCoMo` text-retrieval dataset through the real Rust `MemoryStore` path. It supports two evaluation modes:

1. **Retrieval-only** (default) — MTEB qrel scoring over corpus/query/qrels parquet configs.
2. **End-to-end QA** (`--qa-eval=mem0-paper`) — LLM-as-Judge `J`-score evaluation that mirrors the Mem0 paper methodology (Chhikara et al. 2025, arXiv:2504.19413).

## Source

- Dataset: `mteb/LoCoMo`
- Revision: `02e2c3dea15d9fdfd1cd7a0f65f5f8ae2ed4c1ac`
- Configs: `single_hop`, `multi_hop`, `temporal_reasoning`, `open_domain`, `adversarial`
- Files used per config: `*-corpus`, `*-queries`, `*-qrels`

The Hugging Face datasets-server row endpoint returned HTTP 501 for at least `single_hop-queries`, so the adapter reads the raw parquet files directly with `hyparquet`.

## Commands

```pwsh
# Download/cache the pinned parquet files.
npm run brain:locomo:prepare

# Fast smoke pass over 10 single-hop queries.
npm run brain:locomo:sample

# Broader slice: 50 queries per task, both MemoryStore modes.
npm run brain:locomo:run -- --limit=50 --systems=search,rrf

# Full retrieval-only run.
npm run brain:locomo:run -- --systems=search,rrf

# End-to-end QA eval with local judge (gemma3:4b, directionally comparable).
npm run brain:locomo:run -- --qa-eval=mem0-paper --systems=rrf_rerank --limit=100

# End-to-end QA eval with Mem0-paper-parity judge (gpt-4o-mini, strictly comparable).
npm run brain:locomo:run -- --qa-eval=mem0-paper --systems=rrf_rerank --judge=gpt-4o-mini --openai-key=sk-...
```

Dataset files are cached under `target-copilot-bench/locomo-mteb/`, and reports are written to `target-copilot-bench/bench-results/`.

## Systems

| System | MemoryStore path |
|---|---|
| `search` | FTS5 lexical search plus TerranSoul lexical rerank and gated graph boost when edges exist |
| `rrf` | `hybrid_search_rrf(query, None, top_k)` over the fresh in-memory store |

## Metrics

The adapter computes qrel-based IR metrics per query and averages them by task and overall:

- `R@K`: relevant-document coverage at K.
- `Hit@K`: whether any relevant document appears in top K.
- `NDCG@10`: graded ranking quality using qrel scores.
- `MAP@10`: truncated average precision.
- `MRR@100`: reciprocal rank of the first relevant hit.

## Current Verified Slice

The first broad slice used `npm run brain:locomo:run -- --limit=50 --systems=search,rrf`, covering 250 queries total.

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `search` | 250 | 28.9% | 46.6% | 51.3% | 57.5% | 65.9% | 40.9% | 36.3% | 40.5% |
| `rrf` | 250 | 29.4% | 46.8% | 51.6% | 57.3% | 65.9% | 41.5% | 36.9% | 41.4% |

Strongest task: `temporal_reasoning` at R@10 90.0% / NDCG@10 78.4% for both modes. Weakest tasks: `multi_hop` and `open_domain`, which need query decomposition or stronger semantic retrieval before TerranSoul can claim a leading LoCoMo retrieval score.

## Notes

LoCoMo/LMEB published QA scores from systems such as Mem0, Letta/MemGPT, and MemPalace are not directly comparable to the retrieval-only table above. The `--qa-eval=mem0-paper` mode bridges this gap by producing end-to-end `J`-scores using LLM-as-Judge evaluation. When run with `--judge=gpt-4o-mini`, scores are directly comparable to the Mem0-paper baselines. Local-judge scores (e.g. `gemma3:4b`) are directionally comparable but not strictly equivalent due to different judge calibration.

## QA Eval Methodology (TOP1-2)

The `--qa-eval=mem0-paper` mode mirrors the Mem0 paper's LLM-as-Judge methodology:

1. **Retrieve** top-K from TerranSoul MemoryStore (using the specified retrieval system).
2. **Generate** a concise answer using the generator model (default: `gemma3:4b`) with retrieved context.
3. **Judge** the generated answer against the qrel-mapped reference context using the judge model. The judge rates correctness on a 0-10 scale.
4. **J-score** = mean(judge_scores) × 10 → 0-100 scale, reported per task and overall.

### QA Eval Options

| Option | Default | Description |
|---|---|---|
| `--qa-eval=mem0-paper` | off | Enable end-to-end QA evaluation |
| `--generator=<model>` | `gemma3:4b` | Generator LLM (Ollama or OpenAI) |
| `--judge=<model>` | same as generator | Judge LLM; use `gpt-4o-mini` for Mem0-paper parity |
| `--openai-key=<key>` | `$OPENAI_API_KEY` | Required when judge or generator is an OpenAI model |

### Acceptance bar

TerranSoul `J` strictly ≥ every Mem0-paper baseline on at least 3 of 4 task categories (single_hop, multi_hop, open_domain, temporal_reasoning).
