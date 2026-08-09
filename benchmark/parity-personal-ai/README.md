# Parity Personal-AI Benchmark — TerranSoul

> **Phase:** an internal work item
> **Date:** 2026-05-26

> **MCP Gateway Parity:** all 22 prompts route through the live MCP server (ports 7421/7423/7422) — that routing is what this benchmark validates. Current results (run 2026-06-07T03:23:30Z, judge `gemma3:4b`, see [results/parity_personal_ai.md](../results/parity_personal_ai.md)): 2/7 archetypes passing — `code-assistant` (3/3) and `chat-simple` (4/4). The other five (`daily-digest`, `deep-research`, `scheduled-monitor`, `voice-companion`, `vrm-overlay`) are 0/3. Quality scoring (LLM-judge 0–10) is not wired up for any archetype yet — every row reads N/A. See [parity-enforcement-rules.md](../parity-enforcement-rules.md).

## Overview

This benchmark runs **7 canonical task archetypes** through TerranSoul
(via MCP on `:7421`/`:7423`) using a fixed prompt set. It records:

- **Latency** (seconds per call)
- **Quality** (LLM-judge score 0–10)
- **Success rate** (MCP call success/failure)

## Task Archetypes

| # | Archetype | TerranSoul MCP Tool |
|---|---|---|
| 1 | `daily-digest` | `brain_search` |
| 2 | `deep-research` | `brain_search` |
| 3 | `code-assistant` | `code_query` |
| 4 | `scheduled-monitor` | `brain_search` + `brain_ingest_url` |
| 5 | `chat-simple` | `brain_search` |
| 6 | `voice-companion` | `brain_search` |
| 7 | `vrm-overlay` | `brain_search` |

## Directory Structure

```
benchmark/parity-personal-ai/
├── README.md              ← this file
├── fixtures/              ← 7 prompt fixture JSONs
├── runners/               ← per-system runners (internal harness)
├── orchestrator          ← drives the run across systems
├── judge                 ← LLM-judge scoring (Ollama)
└── results/              ← committed output
```

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Runner scripts |
| TerranSoul MCP server | Running on `:7421` or `:7423` |
| Ollama | With a judge model pulled (default: `gemma3:1b`) |

## Usage

The harness runs all 7 archetypes through the live MCP server and scores each response with the LLM judge (Ollama), on the same prompts, model, and judge. It supports running a single archetype, skipping the judge for latency-only, a dry run, and overriding the judge model.

## Output

Results are committed alongside the harness as JSON plus a Markdown summary.

## Scoring

Quality scoring uses an LLM-as-judge approach via Ollama:
- Each MCP response is scored 0–10 on relevance, accuracy, and completeness
- A fixed judge prompt and rubric are used for every system
- Scores are averaged per task archetype
- The judge is given the prompt's `context_seed` as **memory context**, so facts
  the assistant correctly recalled from memory are scored as legitimate recall,
  not hallucination. (Without this, any memory-augmented system is unfairly
  penalised — see the cs-3/cs-4 zero-score artifact fixed 2026-06-08.)

## Head-to-Head: TerranSoul vs OpenJarvis

The harness runs TerranSoul against
[OpenJarvis](https://github.com/open-jarvis/OpenJarvis) (Stanford, Apache-2.0),
a local personal-AI stack, on the same task archetypes. Each side runs its own
real pipeline; the harness can run both stacks or one side only.

**Protocol (controlled for fairness):**
- Both answer the **same 22 prompts** with the **same model** (`gemma4:12b-it-qat`)
  on the **same hardware**, each given the fixture's `context_seed` so neither is
  blind. Single generation pass.
- **TerranSoul**: live `brain_search` (hybrid RAG) → Ollama generation.
- **OpenJarvis**: its own engine answers each prompt directly, parsing its
  reported telemetry.
- **Latency** = inference time (excludes the OpenJarvis CLI cold-start, an
  artifact of its per-call invocation; a deployed OpenJarvis runs as a resident
  server).
- **USD** = $0 — both fully local.
- **Energy** = `n/a*` — the test GPU (RTX 3080 Ti) does not expose `power.draw`
  via NVML/`nvidia-smi`, so energy is reported as n/a rather than fabricated.

Output is committed alongside the harness and rolled up in
[COMPARISON.md](../COMPARISON.md) under **OpenJarvis-Parity**.

**Setup:** OpenJarvis is installed from its public repo and pointed at the
existing local Ollama (reuses `gemma4:12b-it-qat`, no new model download).
