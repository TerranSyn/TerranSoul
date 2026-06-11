# Parity Personal-AI Benchmark — TerranSoul

> **Phase:** PARITY-OJ-14
> **Date:** 2026-05-26

> **MCP Gateway Parity: ✅ LIVE** — All 22 prompts route through live MCP server (ports 7421/7423/7422). This benchmark *is* the gateway validation — 100 % success rate on all archetypes. See [parity-enforcement-rules.md](../parity-enforcement-rules.md).

## Overview

This benchmark runs **7 canonical task archetypes** through TerranSoul
(via MCP on `:7421`/`:7423`) using a fixed prompt set. It records:

- **Latency** (seconds per call)
- **Quality** (LLM-judge score 0–10)
- **Success rate** (MCP call success/failure)

## Task Archetypes

| # | Archetype | TerranSoul MCP Tool |
|---|---|---|
| 1 | `daily-digest` | `brain_search` (temporal, top_k=10) |
| 2 | `deep-research` | `brain_search` (semantic, top_k=20) |
| 3 | `code-assistant` | `code_query` |
| 4 | `scheduled-monitor` | `brain_search` + `brain_ingest_url` |
| 5 | `chat-simple` | `brain_search` (conversational, top_k=8) |
| 6 | `voice-companion` | `brain_search` (TTS-optimized, top_k=5) |
| 7 | `vrm-overlay` | `brain_search` (emotion, top_k=3) |

## Directory Structure

```
benchmark/parity-personal-ai/
├── README.md              ← this file
├── fixtures/              ← 7 prompt fixture JSONs
├── runners/
│   └── terransoul.mjs     ← MCP-based runner
├── run.mjs                ← orchestrator
├── judge.mjs              ← LLM-judge scoring (Ollama)
└── results/               ← output
    └── .gitkeep
```

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Runner scripts |
| TerranSoul MCP server | Running on `:7421` or `:7423` |
| Ollama | With a judge model pulled (default: `gemma3:1b`) |

## Usage

```bash
# Full run (all 7 archetypes, with LLM-judge scoring)
node benchmark/parity-personal-ai/run.mjs

# Specific archetype only
node benchmark/parity-personal-ai/run.mjs --task=daily-digest

# Skip judge scoring (latency-only)
node benchmark/parity-personal-ai/run.mjs --no-judge

# Dry run (prints tasks without executing)
node benchmark/parity-personal-ai/run.mjs --dry

# Custom judge model
node benchmark/parity-personal-ai/run.mjs --judge-model=gemma4:e4b
```

## Output

Results are written to `target-copilot-bench/bench-results/parity_personal_ai.json`
and a Markdown summary to `target-copilot-bench/bench-results/parity_personal_ai.md`.

## Scoring

Quality scoring uses an LLM-as-judge approach via Ollama:
- Each MCP response is scored 0–10 on relevance, accuracy, and completeness
- The judge prompt and rubric are in `judge.mjs`
- Scores are averaged per task archetype
- The judge is given the prompt's `context_seed` as **memory context**, so facts
  the assistant correctly recalled from memory are scored as legitimate recall,
  not hallucination. (Without this, any memory-augmented system is unfairly
  penalised — see the cs-3/cs-4 zero-score artifact fixed 2026-06-08.)

## Head-to-Head: TerranSoul vs OpenJarvis

`run-headtohead.mjs` runs a **real apples-to-apples comparison** against
[OpenJarvis](https://github.com/open-jarvis/OpenJarvis) (Stanford, Apache-2.0),
a local personal-AI stack with the same task archetypes.

```bash
# Both stacks, same 22 prompts, same model + judge
node benchmark/parity-personal-ai/run-headtohead.mjs --judge-model=gemma4:12b-it-qat
# One side only
node benchmark/parity-personal-ai/run-headtohead.mjs --system=openjarvis
```

**Protocol (controlled for fairness):**
- Both answer the **same 22 prompts** with the **same model** (`gemma4:12b-it-qat`)
  on the **same hardware**, each given the fixture's `context_seed` so neither is
  blind. Single generation pass.
- **TerranSoul** (`runners/terransoul-gen.mjs`): live `brain_search` (hybrid RAG)
  → Ollama generation (`think:false`).
- **OpenJarvis** (`runners/openjarvis.mjs`): `jarvis ask` direct-to-engine via
  `uv run`, parsing its `--json --profile` telemetry.
- **Latency** = inference time (excludes the OpenJarvis CLI cold-start, an
  artifact of per-call `uv` invocation; a deployed OpenJarvis runs as a resident
  server).
- **USD** = $0 — both fully local.
- **Energy** = `n/a*` — the test GPU (RTX 3080 Ti) does not expose `power.draw`
  via NVML/`nvidia-smi`, so energy is reported as n/a rather than fabricated.

Output: `target-copilot-bench/bench-results/parity_headtohead.json`, surfaced on
the [leaderboard](../../docs/leaderboard/) under **OpenJarvis-Parity**.

**Setup:** OpenJarvis installs to `%LOCALAPPDATA%\OpenJarvis` via `git clone` +
`uv sync --extra server`, pointed at the existing Ollama (`localhost:11434`) — no
new model download (reuses `gemma4:12b-it-qat`). Override paths with
`OPENJARVIS_HOME` / `UV_BIN`.
