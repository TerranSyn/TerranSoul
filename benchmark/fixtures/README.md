# benchmark/fixtures/ — dataset provenance

This file pins every external dataset TerranSoul benchmarks against. Re-running with the same commit/version produces byte-identical inputs.

## Datasets

| Dataset | Source | Pinned version | Used by | License |
|---|---|---|---|---|
| agentmemory `bench:quality` concept-tagged corpus (240 obs / 20 queries) | [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) | commit `ae8f061cd66093d7be1539c24da6d3e595531dd2` | [terransoul/agentmemory-quality/](../terransoul/agentmemory-quality/README.md) | MIT (see [CREDITS.md](../../CREDITS.md)) |
| LongMemEval-S (cleaned, 500-question retrieval slice) | [xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) | latest HF revision at download time; ~264 MB | [terransoul/longmemeval-s/](../terransoul/longmemeval-s/README.md) | per upstream HF dataset card |
| LoCoMo MTEB retrieval task | [mteb/LoCoMo](https://huggingface.co/datasets/mteb/LoCoMo) | latest HF revision at download time | [terransoul/locomo-mteb/](../terransoul/locomo-mteb/README.md), [terransoul/locomo-at-scale/](../terransoul/locomo-at-scale/README.md) | per upstream HF dataset card |
| Synthetic at-scale distractors (entity-swap, cross-task) | generated locally by [scripts/locomo-at-scale.mjs](../../scripts/locomo-at-scale.mjs) | deterministic seed | [terransoul/locomo-at-scale/](../terransoul/locomo-at-scale/README.md) | TerranSoul MIT |

## Fixture build commands

```pwsh
# agentmemory concept-tagged corpus → JSON (timestamps anchored to 2026-01-01T00:00:00Z)
node scripts/build-memory-quality-fixture.mjs

# LongMemEval-S download + clean (one-time, ~264 MB)
npm run brain:longmem:prepare

# LoCoMo MTEB — downloaded on first run of scripts/locomo-mteb.mjs
node scripts/locomo-mteb.mjs --query-count=10   # downloads + runs smoke
```

## Determinism notes

- The agentmemory concept-tagged fixture is **byte-deterministic** at the pinned commit.
- LongMemEval-S and LoCoMo MTEB datasets come from HuggingFace — they are stable across loads but not bit-exact across HF revision bumps. Record the dataset revision hash in any new round you publish.
- The at-scale distractor set is generated with a deterministic seed in [scripts/locomo-at-scale.mjs](../../scripts/locomo-at-scale.mjs); same seed + same gold set → same 100k / 1M corpus.

## Where the actual cached datasets live (gitignored)

- agentmemory fixture: written to a local cache directory referenced by `scripts/build-memory-quality-fixture.mjs`.
- LongMemEval-S: written under `data/longmemeval/` (gitignored).
- LoCoMo MTEB: written under the runner's HF cache.
- At-scale distractors: regenerated on each run (not cached).

We do not check the raw datasets into git — only the result JSON under `target-copilot-bench/bench-results/`.
