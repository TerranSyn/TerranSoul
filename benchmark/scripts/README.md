# benchmark/scripts/ — pointers to the runner scripts

> The actual runner scripts live in [scripts/](../../scripts/) at the repo root.
> This file is the index so contributors can find the right runner for each bench task.

## Runner inventory

| Bench task | Runner | Output | Notes |
|---|---|---|---|
| LongMemEval-S retrieval | [`scripts/longmemeval-s.mjs`](../../scripts/longmemeval-s.mjs) (via `npm run brain:longmem:*`) | `benchmark/results/longmemeval_s_terransoul.{json,md}` | `prepare` downloads, `run` executes, `sample` runs 2-q smoke |
| agentmemory concept-tagged quality | [`scripts/build-memory-quality-fixture.mjs`](../../scripts/build-memory-quality-fixture.mjs) + `cargo bench memory_quality` | `benchmark/results/memory_quality.{json,md}` | Pinned commit `ae8f061c` |
| LoCoMo MTEB | [`scripts/locomo-mteb.mjs`](../../scripts/locomo-mteb.mjs) | `benchmark/results/locomo_mteb_terransoul_<Nq>.{json,md}` | Flags: `--systems=`, `--query-count=`, `--task=` |
| LoCoMo at scale | [`scripts/locomo-at-scale.mjs`](../../scripts/locomo-at-scale.mjs) | `benchmark/results/locomo_scale_<N>_<task>_<Q>q_<mode>.{json,md}` | Flags: `--scale=`, `--query-count=`, `--task=`, `--systems=`, `--shard-mode=` |
| Million-memory latency | `cargo bench million_memory --features bench-million` | criterion output under `target-copilot-bench/criterion/` | HNSW p50/p95/p99 + CRUD throughput |
| Yearly token savings | [`scripts/brain-token-calculator.mjs`](../../scripts/brain-token-calculator.mjs) (via `npm run brain:tokens`) | stdout | Configurable queries/day |
| Parity personal-AI | [`benchmark/parity-personal-ai/run.mjs`](../parity-personal-ai/run.mjs) | `benchmark/results/parity_personal_ai.{json,md}` | 7 archetypes, 22 prompts, MCP-based, LLM-judge |

## Common flags (locomo-mteb.mjs, locomo-at-scale.mjs)

| Flag | Default | Description |
|---|---|---|
| `--task=<name>` | `all` (mteb), `adversarial` (scale) | LoCoMo task slice |
| `--query-count=<N>` | full | Cap queries for smoke runs |
| `--systems=<csv>` | canonical | Which retrieval modes to bench |
| `--shard-mode=<routed\|all>` | `routed` | BENCH-SCALE-2 toggle — `all` is the single-index baseline |
| `--scale=<N>` | n/a | locomo-at-scale only — corpus size to ingest |

## Bench bin

The Rust IPC bench bin is [src-tauri/src/bin/longmemeval_ipc.rs](../../src-tauri/src/bin/longmemeval_ipc.rs). Build with:

```pwsh
cd src-tauri
cargo build --bin longmemeval-ipc --features bench-million --target-dir ../target-copilot-bench
```

It reads NDJSON commands on stdin and emits NDJSON results on stdout, called by every JS bench harness above. Honored env vars:

- `LONGMEM_KG_EDGES=1` — enable ingest-time `shares_entities` edges for `rrf_kg` / `rrf_kg_rerank` modes.
- `LONGMEM_SHARD_MODE=routed|all|router|default|allshards|all_shards|single` — BENCH-SCALE-2 shard-mode toggle.

## Smoke-slice rule

Always run a **100-query smoke first**. After the 100-q smoke shows the expected directional change on the target task **AND no >5 pp regression on any non-target task**, promote to 250-q or full. See the smoke-slice caveat in [rules/milestones.md](../../rules/milestones.md) (BENCH-LCM-7 lesson).

## Audit-before-invent rule

Before adding a new retrieval heuristic to fix a bench regression, audit [docs/brain-advanced-design.md](../../docs/brain-advanced-design.md) and [src-tauri/src/memory/](../../src-tauri/src/memory/) to confirm an existing pipeline stage isn't being skipped. BENCH-LCM-8 closed the rerank gap; CHAT-PARITY-2 closed the HyDE gap; BENCH-KG-1/-2 closed the cascade gap; BENCH-PARITY-3 closed the temporal-filter gap. Future regressions should follow the same audit-first pattern.
