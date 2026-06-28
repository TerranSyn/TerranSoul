# ARC-AGI-2 benchmark (abstract reasoning, grid puzzles)

Real, locally-scored run of the **ARC-AGI-2 public evaluation set** (120 tasks) under the
standard ARC-AGI text protocol. Exact-match scoring, official **pass@2** plus **pass@1**.

- **Dataset:** `arcprize/ARC-AGI-2` `data/evaluation/*.json` (120 tasks). The public eval
  set ships the test outputs, so scoring is exact-match locally. Each task:
  `{"train":[{"input":grid,"output":grid},…], "test":[{"input":grid,"output":grid},…]}`,
  grids are 2-D arrays of ints 0–9.
- **Harness:** [`arc_harness.py`](arc_harness.py) (committed here).

## Protocol

1. **Prompt** — render every train pair's input/output grid as rows of digits, then the
   test input, and instruct the model to output **only** the predicted test-output grid in
   the same digit-grid format (one row per line, no separators).
2. **Parse robustly** — strip prose / code fences / `Row N:` labels / brackets; accept both
   contiguous digit rows (`110023`) and space/comma-separated rows; pick the last
   rectangular block. **If unparseable → counted WRONG (never correct).**
3. **Score = exact match** of the full predicted grid vs ground truth.
   - **pass@1** = first attempt correct.
   - **pass@2** = either of 2 attempts correct (official ARC metric).
   - Multi-test tasks: **all** test inputs must be correct for the task to count (ARC convention).
     45 of the 120 eval tasks have >1 test input.

## Arms

| Arm | Model | Endpoint | Tasks | Cost |
|---|---|---|---|---|
| **local** (TerranSoul actor) | `gemma4:12b-it-qat` | Ollama, `http://127.0.0.1:11434` | all **120** | $0 |
| **claude** (frontier reference) | `claude-haiku-4-5` | local `claude` CLI | **40**-task sample | measured (see summary) |

### Why `claude-haiku-4-5` (not opus)
The task allowed opus **or** haiku ("if opus is too costly — your choice, RECORD which").
`claude-opus-4-8` with adaptive thinking **timed out at >600s on a single ARC task** in this
environment (it overthinks hard puzzles), making a 40-task sample impractically slow/costly.
`claude-haiku-4-5` completes each task and its cost is bounded — so the reference arm is haiku.
Real per-task cost is captured per call via `claude -p … --output-format json`
(`total_cost_usd`) and summed in the summary JSON.

### `gemma4:12b-it-qat` is a thinking model — necessary adaptation
With thinking **enabled** this model never stops reasoning to emit an answer: on every ARC
task it exhausts the entire token budget inside the chain-of-thought and returns empty
`content` (verified — even the smallest 10×10 task hit `done_reason: length` at 15,430
thinking tokens, content length 0, after 259 s). The OpenAI-compat `/v1` endpoint cannot
disable thinking, so the local arm calls the **same Ollama server's** native `/api/chat`
with `"think": false` (same host:port, same model the task specifies — only the thinking
toggle differs). This yields a clean, parseable grid in ~10–15 s. The choice is documented
in the harness source.

### claude CLI overhead
Each `claude -p` invocation otherwise pays ~5 min of per-call agent overhead (MCP server
startup + project `CLAUDE.md`/skills/plugins loading). The harness passes
`--strict-mcp-config --setting-sources ""` to strip that, leaving only the model's own
reasoning time — keeping the reference a clean model call.

## Files

- `arc_harness.py` — the solver harness (both arms, scoring, robust parser).
- `results_local.jsonl` — per-task results for the local arm (all 120).
- `results_claude_claude-haiku-4-5.jsonl` — per-task results for the claude sample.
- `raw_local.jsonl` / `raw_claude_*.jsonl` — per-attempt raw output tails (evidence).
- `summary_local.json` / `summary_claude_claude-haiku-4-5.json` — headline pass@1 / pass@2.
- `summary.json` — combined summary across both arms (the headline numbers).

## Reproduce

```sh
# local arm — all 120 tasks (needs Ollama serving gemma4:12b-it-qat)
python arc_harness.py --arm local  --data <ARC-AGI-2>/data/evaluation --out .

# claude arm — 40-task sample (needs the `claude` CLI)
python arc_harness.py --arm claude --model claude-haiku-4-5 \
    --data <ARC-AGI-2>/data/evaluation --out . --tasks-file sample40.txt
```

Both runs are resumable (skip already-recorded task ids in the output file).

## Published context (cited, not measured)

ARC-AGI-2 is deliberately hard. Per the ARC Prize team, **humans solve ~60%** of ARC-AGI-2
(every task is solvable by humans by construction), while **frontier LLMs score in the low
single digits** (pure-LLM single-attempt; some report ~0%). These figures are **cited** from
the ARC Prize site / ARC-AGI-2 paper — *not* measured here. A near-zero local score is the
expected, correct, publishable result and reflects the underlying actor's reasoning ability.

> **Framing.** ARC-AGI-2 is reasoning-bound: each task is self-contained, so externalized
> memory provides **no per-task lift** — this score reflects the underlying *actor*
> (`gemma4:12b-it-qat`), consistent with the project's actor-bound thesis. The memory brain
> is measured on the memory/long-horizon benchmarks, not here.
