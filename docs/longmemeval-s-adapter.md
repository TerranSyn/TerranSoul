# LongMemEval-S Adapter

TerranSoul's LongMemEval-S adapter runs the same retrieval-only evaluation shape used by agentmemory's `benchmark/longmemeval-bench.ts`: for each question, build a fresh index from that question's haystack sessions, search with the raw question text, and score whether any gold answer session appears in the retrieved top-K.

This is not official LongMemEval QA accuracy. It is retrieval recall on the LongMemEval-S haystack, matching the public agentmemory methodology so BENCH-AM-6 can publish a comparable TerranSoul number.

## Sources

- Dataset: `xiaowu0162/longmemeval-cleaned`, file `longmemeval_s_cleaned.json`.
- Methodology cross-check: `rohitg00/agentmemory` `benchmark/LONGMEMEVAL.md` and `benchmark/longmemeval-bench.ts`.
- DeepWiki was checked first for `rohitg00/agentmemory`, then the upstream repository was used for the exact benchmark script details.

## What Ships

- [scripts/longmemeval-s.mjs](../scripts/longmemeval-s.mjs) downloads the dataset, launches the Rust IPC shim, aggregates metrics, and writes JSON/Markdown reports.
- [src-tauri/src/bin/longmemeval_ipc.rs](../src-tauri/src/bin/longmemeval_ipc.rs) exposes an in-memory `MemoryStore` over JSONL with `reset`, `add_sessions`, `search`, and `shutdown` commands.
- NPM aliases:
  - `npm run brain:longmem:prepare`
  - `npm run brain:longmem:run`
  - `npm run brain:longmem:sample`

## Run A Smoke Test

```pwsh
npm run brain:longmem:sample
```

This runs two built-in sample questions through the same Node -> Rust IPC path and writes reports under `target-copilot-bench/bench-results/`.

## Download The Dataset

```pwsh
npm run brain:longmem:prepare
```

The dataset is about 264 MB and lands in `target-copilot-bench/longmemeval/longmemeval_s_cleaned.json`. The directory is ignored by Git.

## Run The Full Retrieval Evaluation

```pwsh
npm run brain:longmem:run
```

Default systems:

| System | MemoryStore path |
|---|---|
| `search` | FTS5 keyword search plus TerranSoul lexical rerank and gated KG boost when edges exist |
| `rrf` | `hybrid_search_rrf(query, None, 20)` using no-vector RRF over the fresh in-memory store |

Reports:

- `target-copilot-bench/bench-results/longmemeval_s_terransoul.json`
- `target-copilot-bench/bench-results/longmemeval_s_terransoul.md`

Use `--limit` for a smaller local pass while iterating:

```pwsh
npm run brain:longmem:run -- --limit=25
```

## Optional Ollama Evidence Judge

The apples-to-apples score is retrieval-only and should be the number published against agentmemory's 95.2% R@5. For a local diagnostic, the runner can ask an Ollama model whether the retrieved top sessions contain enough evidence for the reference answer:

```pwsh
npm run brain:longmem:run -- --limit=25 --with-judge --judge-model=qwen2.5:14b
```

The judge support rate is written as a separate diagnostic field. Do not compare it to agentmemory's published LongMemEval-S retrieval number.

## Metrics

- `recall_any@5/10/20`: `1.0` when at least one `answer_session_id` appears in the retrieved top-K session IDs.
- `NDCG@10`: ranking quality over gold session IDs.
- `MRR`: reciprocal rank of the first gold session.
- Abstention question types are excluded to match upstream: `single-session-user_abs`, `multi-session_abs`, `knowledge-update_abs`, and `temporal-reasoning_abs`.

## BENCH-AM-6 Checklist

1. Run `npm run brain:longmem:run` on the full dataset.
2. Compare `search` and `rrf` against agentmemory's published LongMemEval-S row: R@5 95.2%, R@10 98.6%, R@20 99.4%, NDCG@10 87.9%, MRR 88.2%.
3. Publish the verified result in [agentmemory-comparison.md](agentmemory-comparison.md).
4. Update the README brain section and sync the result into `mcp-data/shared/memory-seed.sql`.
