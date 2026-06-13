# Failure economy of the gemma4:e4b ZorkGPT bench runs

> Empirical grounding for `docs/LLM-Brain-Design-Research-Paper.md` §8 item 6:
> *"Quantify the 4B's failure economy. Measure tool-call/JSON-malformation rate
> and context-saturation effects per 100 turns to ground the R_d definition of §4.4."*
>
> Generated 2026-06-12 by scanning every ZorkGPT bench artifact in
> `benchmark/terransoul/zorkgpt/` and `target-copilot-bench/bench-results/`.
> Machine-readable companion: [`failure-economy.json`](failure-economy.json)
> (209 run groups, 641 files inventoried, per-log marker counts under `runs[].log_detail`).

## Method

- **Turn denominators** — `episode_end.turns` from the run's JSONL/summary when present;
  otherwise `Turn N:` lines in arm/runner/bench logs; otherwise `--- Turn N ---` markers
  in transcripts. Each table states the grounded denominator it uses.
- **LLM-call failures (primary)** — log lines `ERROR: Error getting agent action`,
  `Error getting critic evaluation`, `LLM extraction failed`, `Objective LLM call failed`,
  `LLM call failed`, `LLM episode summary failed`, synthesis failures, and
  `Turn failed with exception` — excluding circuit-breaker lines.
- **Circuit-breaker cascade (reported separately)** — `Circuit breaker is open` lines are
  *suppressed* calls that follow a primary failure burst; counting them as failures would
  multiply one incident by hundreds of lines.
- **JSON malformation** — `ERROR: Error parsing critic response`, `Error parsing LLM
  extractor response`, `Failed to parse JSON/completion JSON`, pydantic validation errors.
  These are exactly the failures Patches 5-7 of
  `benchmark/scripts/zork-bench/llm_client_patch.py` (force Ollama JSON mode, balanced-brace
  extractor, native `/api/chat` rerouting) were built to remove.
- **Context saturation** — `Empty response from model <X>` events (attempt-level; the
  reasoning-budget exhaustion path described in `llm_client_patch.py` Patch 1) plus Jericho
  `TruncatedInputActionWarning` / `'…' was truncated to '…'` events (CoT prose leaking into
  the 198-char action channel). **No `done_reason=length` markers exist in any bench log**
  (that marker only appears in the desktop-app obs pipeline), so empty-completion +
  action-channel truncation are the saturation observables available here.
- **Harness interventions** — `harness_sanitise`, `harness_verb_reject`,
  `harness_loop_break`, `obj_llm_fallback_calls` counters from `episode_end` JSONL records
  (fields exist only from spec008 onward; older episodes are reported as ungrounded, not 0).
- **De-duplication** — runner logs that tee an arm log byte-for-byte (spec011/012 dirs)
  are detected by identical marker-count fingerprints and counted once
  (`log_detail[*].duplicate_of` in the JSON).
- **Model attribution** — by campaign era + in-log markers (`model=`/404 bodies/
  `Empty response from model X`). iter10/iter12 (2026-05-25) are **gemma3:4b** per the bench
  README and are therefore outside the e4b aggregate.

## Headline: per-cohort rates per 100 turns

| Cohort | Runs | Turns | LLM fail /100t | CB cascade lines /100t | JSON malf /100t | Empty compl /100t | Sanitise /100t | Verb-reject /100t | Loop-break /100t | MCP err /100t |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| e4b pre-Patch7 (2026-05-28, BEFORE JSON-mode fix) | 7 | 3291 | 7.92 | 56.94 | 94.92 | 40.49 | - | - | - | 0.00 |
| e4b canonical spec003-010 + smokes (2026-05-27..29) | 14 | 1356 | 10.36 | 0.00 | 0.15 | 0.00 | 71.41 | 2.34 | 17.34 | 18.58 |
| e4b arms of spec011/012 sweep (2026-05-29) | 3 | 80 | 17.50 | 0.00 | 0.00 | 0.00 | 12.50 | 3.75 | 1.25 | 0.00 |
| e4b spec014 + K runner-era iters (2026-05-29..06-01) | 82 | 2548 | 0.08 | 0.00 | 0.04 | 0.00 | 1.43 | 0.00 | 0.00 | 23.81 |
| e4b K-campaign arm-era k15-k59 (2026-06-01..02) | 45 | 4169 | 0.17 | 0.00 | 0.10 | 0.00 | 0.00 | 0.19 | 6.30 | 1.60 |
| e4b taught, INTERMITTENT delivery k61-k65 (2026-06-02..03) | 7 | 2063 | 3.35 | 216.24 | 0.00 | 0.00 | 0.00 | 2.04 | 0.39 | 2.81 |
| e4b taught, RELIABLE delivery k68-orchfork (2026-06-03) | 1 | 500 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 2.20 |
| e4b none/zorkgpt-default comparison (2026-06-02) | 2 | 107 | 0.00 | 0.00 | 0.00 | 0.00 | - | - | - | - |
| gemma4:12b-it-qat runs (2026-06-07) | 8 | 883 | 113.79 | 143.10 | 0.00 | 0.00 | 0.00 | 0.00 | 3.25 | 1.50 |
| iter10/iter12 (2026-05-25, gemma3:4b) | 3 | 225 | - | - | - | - | - | - | - | 3.11 |
| other models + unattributed archives | 31 | 2344 | 9.34 | 24.12 | 0.09 | 16.50 | 15.00 | 8.00 | 22.33 | 9.25 |
| **gemma4:e4b, all eras blended** | 161 | 14114 | 2.86 | 43.51 | 11.56 | 4.91 | 7.10 | 1.00 | 4.79 | 5.23 |

Rates are computed over the turns of runs that actually ground each metric
(`*_grounded_turns` in the JSON), not over all turns — e.g. harness counters only
exist from spec008 onward, so their denominator is smaller. The blended e4b JSON rate
(11.56/100t) is dominated by the pre-Patch7 era and should not be quoted without the
era split below.

**The R_d story in one row pair:** before the JSON-mode fix (Patches 5-7) the e4b stack
produced **94.9 JSON malformations per 100 turns** (critic/extractor parse failed on
nearly every turn) and **40.5 empty completions per 100 turns**; after the fix, every
post-spec010 e4b cohort sits at **0-0.15 JSON malformations** and **0 empty completions**
per 100 turns. Likewise the intermittent taught arm carried 3.35 primary LLM failures per
100 turns (plus 216 circuit-breaker cascade lines/100t during the 400-turn marathons) and
scored 73/177/desync, while the execution-keyed fork over the *same* infra delivered
396/396 moves with **zero** error lines — delivery reliability, not model capacity, was
the binding constraint.

## 1. LLM-call failure rate (exceptions, timeouts, retry exhaustion)

Denominator: turns of runs that have runner/arm/bench logs. `Cause` summarises the
non-cascade failure lines; `CB` is the separately-reported circuit-breaker cascade.

| Run | Cohort | Model | Turns | Count | /100 turns | CB lines | Causes |
|---|---|---|---:|---:|---:|---|---|
| `archive-pre-p7-20260528-065830/none` | e4b-pre-patch7 | gemma4:e4b | 555 | 90 | 16.22 | 841 | retry_exhausted=89, empty_response=89 |
| `archive-pre-p7-20260528-065830/terransoul-brain-rerun` | e4b-pre-patch7 | gemma4:e4b | 457 | 26 | 5.69 | 0 | — |
| `archive-pre-p7-20260528-065830/terransoul-brain` | e4b-pre-patch7 | gemma4:e4b | 170 | 1 | 0.59 | 0 | — |
| _(1 more e4b-pre-patch7 runs, all zero)_ | e4b-pre-patch7 | — | 295 | 0 | 0.00 | — | — |
| `zork-bench-canonical-spec003` | e4b-canonical-spec | gemma4:e4b | 100 | 116 | 116.00 | 0 | — |
| `zork-bench-canonical-spec004` | e4b-canonical-spec | gemma4:e4b | 1 | 1 | 100.00 | 0 | retry_exhausted=1, timeout=1 |
| `zork-bench-canonical-spec010-fast` | e4b-canonical-spec | gemma4:e4b | 40 | 8 | 20.00 | 0 | retry_exhausted=2, timeout=2 |
| `zork-bench-smoke` | e4b-canonical-spec | gemma4:e4b | 10 | 1 | 10.00 | 0 | — |
| `zork-bench-smoke2` | e4b-canonical-spec | gemma4:e4b | 15 | 1 | 6.67 | 0 | — |
| `zork-bench-smoke3` | e4b-canonical-spec | gemma4:e4b | 25 | 1 | 4.00 | 0 | — |
| `zork-bench-canonical-spec005` | e4b-canonical-spec | gemma4:e4b | 200 | 4 | 2.00 | 0 | — |
| `zork-bench-canonical-spec006` | e4b-canonical-spec | gemma4:e4b | 200 | 2 | 1.00 | 0 | — |
| `zork-bench-canonical-spec008` | e4b-canonical-spec | gemma4:e4b | 200 | 2 | 1.00 | 0 | — |
| `zork-bench-canonical-spec009` | e4b-canonical-spec | gemma4:e4b | 200 | 2 | 1.00 | 0 | — |
| `zork-bench-canonical-spec010-full` | e4b-canonical-spec | gemma4:e4b | 200 | 2 | 1.00 | 0 | — |
| _(2 more e4b-canonical-spec runs, all zero)_ | e4b-canonical-spec | — | 160 | 0 | 0.00 | — | — |
| `zork-bench-canonical-spec012-I-gemma4-e4b-rebaseline-10t` | e4b-spec011-012 | gemma4:e4b | 20 | 6 | 30.00 | 0 | — |
| `zork-bench-canonical-spec011-B2-gemma4-e4b-BUGGY-pre-spec012` | e4b-spec011-012 | gemma4:e4b | 40 | 6 | 15.00 | 0 | — |
| `zork-bench-canonical-spec011-B-gemma4-e4b-partial` | e4b-spec011-012 | gemma4:e4b | 20 | 2 | 10.00 | 0 | retry_exhausted=1, timeout=1 |
| `archive-spec014-K1-K2-20260529202333` | e4b-spec014-runner-era | gemma4:e4b | 24 | 2 | 8.33 | 0 | retry_exhausted=1, timeout=1 |
| _(80 more e4b-spec014-runner-era runs, all zero)_ | e4b-spec014-runner-era | — | 2494 | 0 | 0.00 | — | — |
| `k21-2ep` | e4b-K-arm-era | gemma4:e4b | 60 | 1 | 1.67 | 0 | timeout=1 |
| `k52-all-zadopt` | e4b-K-arm-era | gemma4:e4b | 89 | 1 | 1.12 | 0 | timeout=1 |
| `k37-deliver` | e4b-K-arm-era | gemma4:e4b | 100 | 1 | 1.00 | 0 | timeout=1 |
| `k58-brainfix` | e4b-K-arm-era | gemma4:e4b | 200 | 2 | 1.00 | 0 | timeout=2 |
| `k45-open-success` | e4b-K-arm-era | gemma4:e4b | 151 | 1 | 0.66 | 0 | timeout=1 |
| `k48-dark-survival` | e4b-K-arm-era | gemma4:e4b | 195 | 1 | 0.51 | 0 | timeout=1 |
| _(38 more e4b-K-arm-era runs, all zero)_ | e4b-K-arm-era | — | 3295 | 0 | 0.00 | — | — |
| `k63-taught700` | e4b-taught-intermittent | gemma4:e4b | 32 | 7 | 21.88 | 5 | retry_exhausted=7, network=7 |
| `k63-taughtfull` | e4b-taught-intermittent | gemma4:e4b | 410 | 24 | 5.85 | 944 | timeout=1, retry_exhausted=22, network=22 |
| `k65-taught` | e4b-taught-intermittent | gemma4:e4b | 311 | 18 | 5.79 | 1222 | retry_exhausted=14, network=14, timeout=4 |
| `k64-taught` | e4b-taught-intermittent | gemma4:e4b | 450 | 18 | 4.00 | 2290 | retry_exhausted=15, network=15, timeout=2 |
| `k61-taughtfull` | e4b-taught-intermittent | gemma4:e4b | 400 | 2 | 0.50 | 0 | timeout=2 |
| _(2 more e4b-taught-intermittent runs, all zero)_ | e4b-taught-intermittent | — | 460 | 0 | 0.00 | — | — |
| _(1 more e4b-taught-reliable runs, all zero)_ | e4b-taught-reliable | — | 500 | 0 | 0.00 | — | — |
| _(2 more e4b-baselines runs, all zero)_ | e4b-baselines | — | 107 | 0 | 0.00 | — | — |
| `12b-canonical-none` | gemma4-12b | gemma4:12b-it-qat | 14 | 28 | 200.00 | 0 | http_404=28 |
| `12b-canonical-zorkgpt-default` | gemma4-12b | gemma4:12b-it-qat | 29 | 38 | 131.03 | 83 | http_404=38 |
| _(1 more gemma4-12b runs, all zero)_ | gemma4-12b | — | 15 | 0 | 0.00 | — | — |
| `zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated` | other-models-and-unattributed | gpt-oss:20b | 20 | 20 | 100.00 | 41 | retry_exhausted=17, empty_response=17 |
| `zork-bench-canonical-spec012-G-gpt-oss-20b-10t` | other-models-and-unattributed | gpt-oss:20b | 20 | 13 | 65.00 | 16 | retry_exhausted=11, empty_response=11 |
| `zork-bench-canonical-spec011-C-gemma4-31b` | other-models-and-unattributed | gemma4:31b | 40 | 24 | 60.00 | 102 | retry_exhausted=15, timeout=2, server_500=14 |
| `zork-bench-canonical-spec011-C2-gemma4-31b` | other-models-and-unattributed | gemma4:31b | 40 | 22 | 55.00 | 107 | retry_exhausted=14, server_500=14 |
| `zork-bench-canonical-spec011-F-qwen3.5-9b-BUGGY-pre-spec012` | other-models-and-unattributed | qwen3.5:9b | 40 | 6 | 15.00 | 0 | retry_exhausted=1, timeout=1 |
| `zork-bench-canonical-spec011-A-qwen2.5-7b` | other-models-and-unattributed | qwen2.5:7b | 40 | 4 | 10.00 | 0 | retry_exhausted=2, timeout=2 |
| `zork-bench-canonical-spec012-E-gemma3-4b-10t` | other-models-and-unattributed | gemma3:4b | 20 | 2 | 10.00 | 0 | — |
| `zork-bench-canonical-spec012-F-qwen3.5-9b-10t` | other-models-and-unattributed | qwen3.5:9b | 20 | 2 | 10.00 | 0 | — |
| `zork-bench-canonical-spec012-H-qwen3.5-4b-10t` | other-models-and-unattributed | qwen3.5:4b | 20 | 2 | 10.00 | 0 | — |
| `zork-bench-canonical-spec011-E-gemma3-4b-BUGGY-pre-spec012` | other-models-and-unattributed | gemma3:4b | 40 | 2 | 5.00 | 0 | — |
| `archive-7b/none-v2` | other-models-and-unattributed | unknown (archive-7b, 2026-05-24..25) | 50 | 1 | 2.00 | 0 | — |
| `archive-7b/terransoul-brain` | other-models-and-unattributed | unknown (archive-7b, 2026-05-24..25) | 50 | 1 | 2.00 | 0 | — |
| `archive-7b/terransoul-brain-v3` | other-models-and-unattributed | unknown (archive-7b, 2026-05-24..25) | 50 | 1 | 2.00 | 0 | — |
| `archive-7b/terransoul-brain-v4` | other-models-and-unattributed | unknown (archive-7b, 2026-05-24..25) | 50 | 1 | 2.00 | 0 | — |
| `archive-7b/zorkgpt-default` | other-models-and-unattributed | unknown (archive-7b, 2026-05-24..25) | 50 | 1 | 2.00 | 0 | — |
| `archive-7b/zorkgpt-default-v2` | other-models-and-unattributed | unknown (archive-7b, 2026-05-24..25) | 50 | 1 | 2.00 | 0 | — |
| _(6 more other-models-and-unattributed runs, all zero)_ | other-models-and-unattributed | — | 503 | 0 | 0.00 | — | — |

Reading guide: `zork-bench-canonical-spec003` is an infrastructure incident (the bridge
could not reach MCP — 115 × `urlopen Errno 111`), and the two `12b-canonical-*` rows are a
stale-model-tag 404 storm, not a model failure economy. Excluding the spec003 incident,
the post-fix steady-state e4b LLM-call failure rate is **0.39/100 turns**
(33 failures / 8,466 grounded turns across the canonical, runner-era, arm-era,
baseline and reliable-taught cohorts); the taught marathons (k61-k65) add timeout/
retry-exhaustion bursts at 3.35/100t when Ollama saturates under 400-turn load.

## 2. JSON-malformation rate (critic/extractor parse failures)

| Run | Cohort | Model | Turns | Count | /100 turns | critic | extractor | other |
|---|---|---|---:|---:|---:|---|---|---|
| `archive-pre-p7-20260528-065830/terransoul-brain-rerun` | e4b-pre-patch7 | gemma4:e4b | 457 | 704 | 154.05 | 478 | 226 | 0 |
| `archive-pre-p7-20260528-065830/terransoul-brain` | e4b-pre-patch7 | gemma4:e4b | 170 | 261 | 153.53 | 170 | 91 | 0 |
| `archive-pre-p7-20260528-065830/zorkgpt-default` | e4b-pre-patch7 | gemma4:e4b | 295 | 437 | 148.14 | 296 | 141 | 0 |
| _(1 more e4b-pre-patch7 runs, all zero)_ | e4b-pre-patch7 | — | 555 | 0 | 0.00 | — | — | — |
| `zork-bench-canonical-spec008` | e4b-canonical-spec | gemma4:e4b | 200 | 2 | 1.00 | 2 | 0 | 0 |
| _(12 more e4b-canonical-spec runs, all zero)_ | e4b-canonical-spec | — | 1151 | 0 | 0.00 | — | — | — |
| _(3 more e4b-spec011-012 runs, all zero)_ | e4b-spec011-012 | — | 80 | 0 | 0.00 | — | — | — |
| `runner-era-K72` | e4b-spec014-runner-era | gemma4:e4b | 30 | 1 | 3.33 | 0 | 0 | 1 |
| _(80 more e4b-spec014-runner-era runs, all zero)_ | e4b-spec014-runner-era | — | 2488 | 0 | 0.00 | — | — | — |
| `k56-loopcap` | e4b-K-arm-era | gemma4:e4b | 66 | 1 | 1.52 | 0 | 0 | 1 |
| `k28-blockerexpand` | e4b-K-arm-era | gemma4:e4b | 100 | 1 | 1.00 | 0 | 0 | 1 |
| `k29-untried-exit` | e4b-K-arm-era | gemma4:e4b | 100 | 1 | 1.00 | 0 | 0 | 1 |
| `k58-brainfix` | e4b-K-arm-era | gemma4:e4b | 200 | 1 | 0.50 | 0 | 0 | 1 |
| _(40 more e4b-K-arm-era runs, all zero)_ | e4b-K-arm-era | — | 3624 | 0 | 0.00 | — | — | — |
| _(7 more e4b-taught-intermittent runs, all zero)_ | e4b-taught-intermittent | — | 2063 | 0 | 0.00 | — | — | — |
| _(1 more e4b-taught-reliable runs, all zero)_ | e4b-taught-reliable | — | 500 | 0 | 0.00 | — | — | — |
| _(2 more e4b-baselines runs, all zero)_ | e4b-baselines | — | 107 | 0 | 0.00 | — | — | — |
| _(3 more gemma4-12b runs, all zero)_ | gemma4-12b | — | 58 | 0 | 0.00 | — | — | — |
| `zork-bench-canonical-spec012-H-qwen3.5-4b-10t` | other-models-and-unattributed | qwen3.5:4b | 20 | 1 | 5.00 | 0 | 1 | 0 |
| _(21 more other-models-and-unattributed runs, all zero)_ | other-models-and-unattributed | — | 1083 | 0 | 0.00 | — | — | — |

The pre-Patch7 arms are the empirical record of *why* `llm_client_patch.py` Patches 5-7
exist: gemma4:e4b ignored `response_format=json_schema` and emitted prose, so the critic
parse (`Expecting value: line 1 column 1`) failed on ~95-154% of turns (some turns fail
more than once: critic + extractor). After forcing Ollama-native JSON mode the rate
collapses to ≤0.15/100t (7 events in ~10,700 post-fix e4b turns, 4 of them in one
arm-era iteration).

## 3. Harness intervention rates (episode_end counters)

Grounded only for episodes whose `episode_end` carries the counters (spec008+).

| Run | Cohort | Model | Turns | Count | /100 turns |
|---|---|---|---:|---:|---:|
| `zork-bench-canonical-spec010-full` | e4b-canonical-spec | gemma4:e4b | 200 | 159 | 79.50 |
| `zork-bench-canonical-spec009` | e4b-canonical-spec | gemma4:e4b | 200 | 157 | 78.50 |
| `zork-bench-canonical-spec008` | e4b-canonical-spec | gemma4:e4b | 200 | 136 | 68.00 |
| `zork-bench-canonical-spec010-fast` | e4b-canonical-spec | gemma4:e4b | 40 | 5 | 12.50 |
| `zork-bench-canonical-spec011-B2-gemma4-e4b-BUGGY-pre-spec012` | e4b-spec011-012 | gemma4:e4b | 40 | 9 | 22.50 |
| `zork-bench-canonical-spec012-I-gemma4-e4b-rebaseline-10t` | e4b-spec011-012 | gemma4:e4b | 20 | 1 | 5.00 |
| _(1 more e4b-spec011-012 runs, all zero)_ | e4b-spec011-012 | — | 20 | 0 | 0.00 |
| `runner-era-K73` | e4b-spec014-runner-era | gemma4:e4b | 30 | 3 | 10.00 |
| _(6 more e4b-spec014-runner-era runs, all zero)_ | e4b-spec014-runner-era | — | 180 | 0 | 0.00 |
| _(33 more e4b-K-arm-era runs, all zero)_ | e4b-K-arm-era | — | 3129 | 0 | 0.00 |
| _(7 more e4b-taught-intermittent runs, all zero)_ | e4b-taught-intermittent | — | 2063 | 0 | 0.00 |
| _(1 more e4b-taught-reliable runs, all zero)_ | e4b-taught-reliable | — | 500 | 0 | 0.00 |
| _(4 more gemma4-12b runs, all zero)_ | gemma4-12b | — | 800 | 0 | 0.00 |
| `zork-bench-canonical-spec011-F-qwen3.5-9b-BUGGY-pre-spec012` | other-models-and-unattributed | qwen3.5:9b | 40 | 17 | 42.50 |
| `zork-bench-canonical-spec012-F-qwen3.5-9b-10t` | other-models-and-unattributed | qwen3.5:9b | 20 | 7 | 35.00 |
| `zork-bench-canonical-spec012-H-qwen3.5-4b-10t` | other-models-and-unattributed | qwen3.5:4b | 20 | 7 | 35.00 |
| `zork-bench-canonical-spec011-A-qwen2.5-7b` | other-models-and-unattributed | qwen2.5:7b | 40 | 12 | 30.00 |
| `zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated` | other-models-and-unattributed | gpt-oss:20b | 20 | 1 | 5.00 |
| `zork-bench-canonical-spec012-G-gpt-oss-20b-10t` | other-models-and-unattributed | gpt-oss:20b | 20 | 1 | 5.00 |
| _(4 more other-models-and-unattributed runs, all zero)_ | other-models-and-unattributed | — | 140 | 0 | 0.00 |

`harness_verb_reject` and `harness_loop_break`:

| Run | Cohort | Turns | verb_reject | /100t | loop_break | /100t | obj_llm_fallback | /100t |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `zork-bench-canonical-spec010-full` | e4b-canonical-spec | 200 | 3 | 1.50 | 58 | 29.00 | 61 | 30.50 |
| `zork-bench-canonical-spec009` | e4b-canonical-spec | 200 | 6 | 3.00 | 29 | 14.50 | 0 | 0.00 |
| `zork-bench-canonical-spec008` | e4b-canonical-spec | 200 | 6 | 3.00 | 24 | 12.00 | 0 | 0.00 |
| _(1 more e4b-canonical-spec runs, all zero)_ | e4b-canonical-spec | 40 | 0 | 0.00 | 0 | 0.00 | 0 | 0.00 |
| `zork-bench-canonical-spec011-B-gemma4-e4b-partial` | e4b-spec011-012 | 20 | 1 | 5.00 | 0 | 0.00 | 0 | 0.00 |
| `zork-bench-canonical-spec011-B2-gemma4-e4b-BUGGY-pre-spec012` | e4b-spec011-012 | 40 | 1 | 2.50 | 1 | 2.50 | 0 | 0.00 |
| `zork-bench-canonical-spec012-I-gemma4-e4b-rebaseline-10t` | e4b-spec011-012 | 20 | 1 | 5.00 | 0 | 0.00 | 1 | 5.00 |
| _(7 more e4b-spec014-runner-era runs, all zero)_ | e4b-spec014-runner-era | 210 | 0 | 0.00 | 0 | 0.00 | 0 | 0.00 |
| `k55-deliver` | e4b-K-arm-era | 200 | 0 | 0.00 | 33 | 16.50 | 0 | 0.00 |
| `k42-solution-replay` | e4b-K-arm-era | 240 | 0 | 0.00 | 31 | 12.92 | 0 | 0.00 |
| `k26-longhorizon` | e4b-K-arm-era | 100 | 0 | 0.00 | 12 | 12.00 | 0 | 0.00 |
| `k35-stop-retake` | e4b-K-arm-era | 100 | 0 | 0.00 | 11 | 11.00 | 0 | 0.00 |
| `k40-150turns` | e4b-K-arm-era | 150 | 0 | 0.00 | 16 | 10.67 | 0 | 0.00 |
| `k53-enter-gateway` | e4b-K-arm-era | 200 | 0 | 0.00 | 21 | 10.50 | 0 | 0.00 |
| `k18-frontier` | e4b-K-arm-era | 30 | 2 | 6.67 | 1 | 3.33 | 0 | 0.00 |
| `k20-leastvisited` | e4b-K-arm-era | 30 | 1 | 3.33 | 2 | 6.67 | 0 | 0.00 |
| `k39-xep-replay` | e4b-K-arm-era | 200 | 0 | 0.00 | 19 | 9.50 | 0 | 0.00 |
| `k25-openable` | e4b-K-arm-era | 60 | 0 | 0.00 | 5 | 8.33 | 0 | 0.00 |
| `k38-deposit-headnoun` | e4b-K-arm-era | 100 | 0 | 0.00 | 8 | 8.00 | 0 | 0.00 |
| `k28-blockerexpand` | e4b-K-arm-era | 100 | 0 | 0.00 | 7 | 7.00 | 0 | 0.00 |
| `k21-2ep` | e4b-K-arm-era | 60 | 1 | 1.67 | 3 | 5.00 | 0 | 0.00 |
| `k30-openwindow` | e4b-K-arm-era | 100 | 0 | 0.00 | 6 | 6.00 | 0 | 0.00 |
| `k36-dark-precise` | e4b-K-arm-era | 100 | 0 | 0.00 | 5 | 5.00 | 0 | 0.00 |
| `arm-era-k15` | e4b-K-arm-era | 30 | 0 | 0.00 | 1 | 3.33 | 0 | 0.00 |
| `k16-osc` | e4b-K-arm-era | 30 | 1 | 3.33 | 0 | 0.00 | 0 | 0.00 |
| `k19-frontier2` | e4b-K-arm-era | 30 | 0 | 0.00 | 1 | 3.33 | 0 | 0.00 |
| `k23-criticaccept` | e4b-K-arm-era | 60 | 0 | 0.00 | 2 | 3.33 | 0 | 0.00 |
| `k24-recency` | e4b-K-arm-era | 60 | 0 | 0.00 | 2 | 3.33 | 0 | 0.00 |
| `k31-window-proximity` | e4b-K-arm-era | 100 | 1 | 1.00 | 2 | 2.00 | 0 | 0.00 |
| `k47-deliver-ody10` | e4b-K-arm-era | 46 | 0 | 0.00 | 1 | 2.17 | 0 | 0.00 |
| `k27-longhorizon-ody1d` | e4b-K-arm-era | 100 | 0 | 0.00 | 2 | 2.00 | 0 | 0.00 |
| `k29-untried-exit` | e4b-K-arm-era | 100 | 0 | 0.00 | 2 | 2.00 | 0 | 0.00 |
| `k22-xepmap` | e4b-K-arm-era | 60 | 0 | 0.00 | 1 | 1.67 | 0 | 0.00 |
| `k34-dark-retreat` | e4b-K-arm-era | 100 | 0 | 0.00 | 1 | 1.00 | 0 | 0.00 |
| `k41-sticky-deposit` | e4b-K-arm-era | 150 | 0 | 0.00 | 1 | 0.67 | 0 | 0.00 |
| `k58-brainfix` | e4b-K-arm-era | 200 | 0 | 0.00 | 1 | 0.50 | 0 | 0.00 |
| _(5 more e4b-K-arm-era runs, all zero)_ | e4b-K-arm-era | 293 | 0 | 0.00 | 0 | 0.00 | 0 | 0.00 |
| `k61-taughtdemo` | e4b-taught-intermittent | 60 | 4 | 6.67 | 0 | 0.00 | 0 | 0.00 |
| `k61-taughtfull` | e4b-taught-intermittent | 400 | 19 | 4.75 | 4 | 1.00 | 3 | 0.75 |
| `k62-taughtfull` | e4b-taught-intermittent | 400 | 19 | 4.75 | 4 | 1.00 | 3 | 0.75 |
| `k63-taughtfull` | e4b-taught-intermittent | 410 | 0 | 0.00 | 0 | 0.00 | 2 | 0.49 |
| `k65-taught` | e4b-taught-intermittent | 311 | 0 | 0.00 | 0 | 0.00 | 1 | 0.32 |
| _(2 more e4b-taught-intermittent runs, all zero)_ | e4b-taught-intermittent | 482 | 0 | 0.00 | 0 | 0.00 | 0 | 0.00 |
| `k68-orchfork` | e4b-taught-reliable | 500 | 0 | 0.00 | 0 | 0.00 | 2 | 0.40 |
| `zork-12b-trial1` | gemma4-12b | 200 | 0 | 0.00 | 14 | 7.00 | 0 | 0.00 |
| `zork-bench-12b-run2` | gemma4-12b | 200 | 0 | 0.00 | 8 | 4.00 | 0 | 0.00 |
| `zork-12b-trial2` | gemma4-12b | 200 | 0 | 0.00 | 2 | 1.00 | 0 | 0.00 |
| `zork-12b-trial3` | gemma4-12b | 200 | 0 | 0.00 | 2 | 1.00 | 0 | 0.00 |
| `zork-bench-canonical-spec011-C2-gemma4-31b` | other-models-and-unattributed | 40 | 0 | 0.00 | 33 | 82.50 | 0 | 0.00 |
| `zork-bench-canonical-spec011-C-gemma4-31b` | other-models-and-unattributed | 40 | 0 | 0.00 | 31 | 77.50 | 0 | 0.00 |
| `zork-bench-canonical-spec011-E-gemma3-4b-BUGGY-pre-spec012` | other-models-and-unattributed | 40 | 12 | 30.00 | 0 | 0.00 | 0 | 0.00 |
| `zork-bench-canonical-spec012-H-qwen3.5-4b-10t` | other-models-and-unattributed | 20 | 5 | 25.00 | 0 | 0.00 | 0 | 0.00 |
| `zork-bench-canonical-spec011-F-qwen3.5-9b-BUGGY-pre-spec012` | other-models-and-unattributed | 40 | 3 | 7.50 | 2 | 5.00 | 0 | 0.00 |
| `zork-bench-canonical-spec011-A-qwen2.5-7b` | other-models-and-unattributed | 40 | 1 | 2.50 | 1 | 2.50 | 0 | 0.00 |
| `zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated` | other-models-and-unattributed | 20 | 1 | 5.00 | 0 | 0.00 | 0 | 0.00 |
| `zork-bench-canonical-spec012-E-gemma3-4b-10t` | other-models-and-unattributed | 20 | 1 | 5.00 | 0 | 0.00 | 0 | 0.00 |
| `zork-bench-canonical-spec012-F-qwen3.5-9b-10t` | other-models-and-unattributed | 20 | 1 | 5.00 | 0 | 0.00 | 0 | 0.00 |
| _(1 more other-models-and-unattributed runs, all zero)_ | other-models-and-unattributed | 20 | 0 | 0.00 | 0 | 0.00 | 0 | 0.00 |

Context: the sanitiser (CoT-strip + verb normalisation) fired on ~70% of turns in the
canonical era (spec008-010) — the same failure channel the `TruncatedInputActionWarning`
events show — and fell to ~0 by the K-campaign once the brain-pin gate served normalised
actions. `harness_loop_break` carried the K-arm-era exploration economy (6.3/100t).

## 4. Context saturation (empty completions + action-channel truncation)

| Run | Cohort | Model | Turns | Count | /100 turns | by model | TruncatedInputAction | CoT-leak truncations |
|---|---|---|---:|---:|---:|---|---|---|
| `archive-pre-p7-20260528-065830/none` | e4b-pre-patch7 | gemma4:e4b | 555 | 598 | 107.75 | gemma4:e4b:598 | 175 | 175 |
| `archive-pre-p7-20260528-065830/terransoul-brain` | e4b-pre-patch7 | gemma4:e4b | 170 | 0 | 0.00 | — | 13 | 13 |
| `archive-pre-p7-20260528-065830/terransoul-brain-rerun` | e4b-pre-patch7 | gemma4:e4b | 457 | 0 | 0.00 | — | 117 | 115 |
| `archive-pre-p7-20260528-065830/zorkgpt-default` | e4b-pre-patch7 | gemma4:e4b | 295 | 0 | 0.00 | — | 6 | 5 |
| `zork-bench-canonical-spec005` | e4b-canonical-spec | gemma4:e4b | 200 | 0 | 0.00 | — | 34 | 34 |
| `zork-bench-canonical-spec006` | e4b-canonical-spec | gemma4:e4b | 200 | 0 | 0.00 | — | 15 | 14 |
| _(11 more e4b-canonical-spec runs, all zero)_ | e4b-canonical-spec | — | 951 | 0 | 0.00 | — | — | — |
| _(3 more e4b-spec011-012 runs, all zero)_ | e4b-spec011-012 | — | 80 | 0 | 0.00 | — | — | — |
| _(81 more e4b-spec014-runner-era runs, all zero)_ | e4b-spec014-runner-era | — | 2518 | 0 | 0.00 | — | — | — |
| _(44 more e4b-K-arm-era runs, all zero)_ | e4b-K-arm-era | — | 4090 | 0 | 0.00 | — | — | — |
| _(7 more e4b-taught-intermittent runs, all zero)_ | e4b-taught-intermittent | — | 2063 | 0 | 0.00 | — | — | — |
| _(1 more e4b-taught-reliable runs, all zero)_ | e4b-taught-reliable | — | 500 | 0 | 0.00 | — | — | — |
| _(2 more e4b-baselines runs, all zero)_ | e4b-baselines | — | 107 | 0 | 0.00 | — | — | — |
| _(3 more gemma4-12b runs, all zero)_ | gemma4-12b | — | 58 | 0 | 0.00 | — | — | — |
| `zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated` | other-models-and-unattributed | gpt-oss:20b | 20 | 103 | 515.00 | gpt-oss:20b:103 | 0 | 0 |
| `zork-bench-canonical-spec012-G-gpt-oss-20b-10t` | other-models-and-unattributed | gpt-oss:20b | 20 | 79 | 395.00 | gpt-oss:20b:79 | 0 | 0 |
| `archive-stale-2026-05-26/none` | other-models-and-unattributed | unknown (stale) | 200 | 0 | 0.00 | — | 59 | 59 |
| _(19 more other-models-and-unattributed runs, all zero)_ | other-models-and-unattributed | — | 863 | 0 | 0.00 | — | — | — |

Empty completions are attempt-level (a single turn can burn all 6 retry attempts).
All 598 e4b events sit in the pre-Patch7 `none` arm (107.7/100t for that arm): with
hidden reasoning enabled, gemma4:e4b consumed the whole `max_tokens` budget on thinking
and returned empty `content` — `think:false`/`reasoning_effort:none` (Patch 1) plus JSON
grammar constraints eliminated the class. gpt-oss:20b shows the same signature (182
deduped events) in its spec011/012 arms. The 360 e4b `TruncatedInputActionWarning`
events (311 pre-Patch7 + 49 in spec005/006) are the complementary saturation channel: CoT
prose >198 chars submitted as the Z-machine action and truncated by Jericho.

## 5. Taught-run delivery verification (intermittent vs reliable)

| Run | Turns | Final score | [ORCH-TAUGHT] serves | LLM fails (primary) | CB cascade | verb_reject | MCP calls | MCP errors | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `k61-taughtdemo` | 60 | 63 | 0 | 0 | 0 | 4 | 749 | 1 |  |
| `k61-taughtfull` | 400 | 73 | 0 | 2 | 0 | 19 | 4356 | 7 | intermittent taught delivery, final 73/400t (paper's '73') |
| `k62-taughtfull` | 400 | 73 | 0 | 0 | 0 | 19 | 4378 | 14 | intermittent taught delivery, final 73/400t (paper's '73') |
| `k63-taught700` | 32 | 30 | 0 | 7 | 5 | 0 | 412 | 6 |  |
| `k63-taughtfull` | 410 | 177 | 0 | 24 | 944 | 0 | 4870 | 10 | intermittent taught delivery, final 177/410t (paper's '177') |
| `k64-taught` | 450 | 59 | 0 | 18 | 2290 | 0 | 4659 | 9 | intermittent taught delivery, desynced, final 59/450t |
| `k65-taught` | 311 | 49 | 0 | 18 | 1222 | 0 | 3196 | 11 | intermittent taught delivery, ended turn 311, final 49 (death/abort leg) |
| `k68-orchfork` | 500 | 350 | 396 | 0 | 0 | 0 | 6456 | 11 | RELIABLE taught run: 396/396 [ORCH-TAUGHT] serves (ptr 0..395 contiguous, turns 1..396 1:1), 0 ERROR lines in run.log; score 350 first logged at Turn 387; episode ran to 500-turn cap |

**Verification of the paper's 396/396, 0-errors claim** (from
`target-copilot-bench/bench-results/zork-bench/k68-orchfork/run.log` +
`zork_bench_terransoul-brain_ep1_20260603T093842.jsonl`):

- 396 `[ORCH-TAUGHT]` lines; pointer values 0..395 with no gap or repeat; served on
  turns 1..396 exactly 1:1. **Verified.**
- `grep -c ERROR run.log` = **0**; no Traceback, no parse failure, no timeout in the
  episode log. **Verified** (delivery errors = 0).
- Score 350 first logged at **Turn 387** (`PUT trunk in case`); the taught sequence
  finishes at turn 396, after which the now-unguided agent ran to the 500-turn episode
  cap at the banked 350. The paper's phrasing "reaching 350 exactly at move 396" refers
  to the sequence completing at move 396; the score counter itself reaches 350 at move
  387 of 396 in this artifact — worth a one-word precision fix if §4.4 is revised.
- `episode_end`: `memory_calls_total=6456`, `memory_calls_with_errors=11` (0.17% —
  ingest-side retries, not move-delivery errors; delivery itself shows 0 errors).
- The intermittent arms in the same table are the paper's 73/177/death contrast:
  k61/k62 = 73, k63 = 177, k64/k65 = desync legs (59@450t, 49@311t). Their failure
  economy (timeout/retry-exhaustion bursts at 3.35/100t + circuit-breaker storms up to
  509/100t in k64) under a blind turn-counter index is exactly the R_d mechanism §4.4
  describes.
- **Gap:** no per-turn artifact survives for the *original* ~60%-serving intermittent
  run referenced in the paper beyond k61-k65 above; the "~60% of turns" figure cannot be
  recomputed from the archived logs (no [ORCH-TAUGHT]-style serve markers exist in the
  intermittent-era logs).

## 6. MCP memory-call error rates

Across **all** episodes with `episode_end` counters (every arm, every model): **84,660 memory calls, 473 errors = 0.559%**.

| Cohort | MCP calls | MCP errors | Error % | Errors /100 turns |
|---|---:|---:|---:|---:|
| e4b pre-Patch7 (2026-05-28, BEFORE JSON-mode fix) | 959 | 0 | 0.00% | 0.00 |
| e4b canonical spec003-010 + smokes (2026-05-27..29) | 5,074 | 222 | 4.38% | 18.58 |
| e4b arms of spec011/012 sweep (2026-05-29) | 438 | 0 | 0.00% | 0.00 |
| e4b spec014 + K runner-era iters (2026-05-29..06-01) | 2,351 | 50 | 2.13% | 23.81 |
| e4b K-campaign arm-era k15-k59 (2026-06-01..02) | 35,053 | 50 | 0.14% | 1.60 |
| e4b taught, INTERMITTENT delivery k61-k65 (2026-06-02..03) | 22,620 | 58 | 0.26% | 2.81 |
| e4b taught, RELIABLE delivery k68-orchfork (2026-06-03) | 6,456 | 11 | 0.17% | 2.20 |
| gemma4:12b-it-qat runs (2026-06-07) | 9,673 | 12 | 0.12% | 1.50 |
| iter10/iter12 (2026-05-25, gemma3:4b) | 359 | 7 | 1.95% | 3.11 |
| other models + unattributed archives | 1,677 | 63 | 3.76% | 9.25 |

Largest single contributor: `zork-bench-canonical-spec003` with **221 errors / 323 calls
(68%)** — this is the documented BRIDGE-INGEST-SILENT-FAILURE incident (the bridge omitted
the required `category` param and passed `tags` as an array; the 2026-05-28 fix made
`McpClient.tool()` surface `isError`, which is why this run records the failures at all).
Excluding that incident run: 84,337 calls, 252 errors = **0.30%**. The residual errors are
spread thin — the largest concentrations are the taught marathons (7-14 errors per
~4,400-call episode, 0.16-0.32%) and 50 errors each across the runner-era and arm-era
K-iterations.

## Data availability

641 files inventoried across the three roots; 209 run groups; 0 files left unassigned.
Full per-file inventory with group assignment: `failure-economy.json` → `inventory[]`;
per-log marker counts: `runs[].log_detail`. Logs are listed exhaustively below;
episode artifacts (JSONL / summary / transcript) are summarised per group.

### Logs inventoried (all parsed)

**e4b pre-Patch7 (2026-05-28, BEFORE JSON-mode fix)**

- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-pre-p7-20260528-065830/arm-none-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-pre-p7-20260528-065830/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-pre-p7-20260528-065830/arm-terransoul-brain-rerun.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-pre-p7-20260528-065830/arm-zorkgpt-default-canonical.log`

**e4b canonical spec003-010 + smokes (2026-05-27..29)**

- `target-copilot-bench/bench-results/zork-bench-canonical-spec003/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec004/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec005/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec006/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec007/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec008/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec009/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast/bench.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-full/bench.log`
- `target-copilot-bench/bench-results/zork-bench-smoke/smoke.log`
- `target-copilot-bench/bench-results/zork-bench-smoke2/smoke.log`
- `target-copilot-bench/bench-results/zork-bench-smoke3/smoke.log`
- `target-copilot-bench/bench-results/zork-brain-canonical-2ep/run.log`

**e4b arms of spec011/012 sweep (2026-05-29)**

- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-B-gemma4-e4b-partial/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-B-gemma4-e4b-partial/iter-B-20260529083603.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-B2-gemma4-e4b-BUGGY-pre-spec012/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-B2-gemma4-e4b-BUGGY-pre-spec012/iter-B2-20260529114027.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-I-gemma4-e4b-rebaseline-10t/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-I-gemma4-e4b-rebaseline-10t/iter-spec012-I-gemma4-e4b-rebaseline-10t-20260529161717.runner.log` *(byte-duplicate of arm log — counted once)*

**e4b spec014 + K runner-era iters (2026-05-29..06-01)**

- `target-copilot-bench/bench-results/zork-bench/K15-archive/iter-spec014-K15-BRAIN-GATE-30T-20260530074642.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K16-archive/iter-spec014-K16-NOUN-EXTRACTOR-FIX-30T-20260530075342.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K17-archive/iter-spec014-K17-PLANNER-REBALANCE-AGENT-PIN-30T-20260530081445.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K18-archive/iter-spec014-K18-TRIED-MAP-PARSER-FIX-30T-20260530082444.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K19-archive/iter-spec014-K19-HARD-PIN-SHORTLIST0-30T-20260530083420.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K20-archive/iter-spec014-K20-TAG-ALIGN-30T-20260530084254.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K21-archive/iter-spec014-K21-EPISODIC-TAG-30T-20260530090451.runner.log`
- `target-copilot-bench/bench-results/zork-bench/K22-stalled-archive/iter-spec014-K22-EXITFIX-30T-20260530095616.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-iter-K3-CLEAN-20260529205919/iter-spec014-K3-CLEAN-20260529205919.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-iter-K4-CLEAN-20260529212112/iter-spec014-K4-CLEAN-30T-20260529212022.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-iter-K4-CLEAN-20260529212112/iter-spec014-K4-CLEAN-30T-20260529212112.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-iter-K6-VISMAP-20260529224816/iter-spec014-K5-PERTURN-MCP-30T-20260529215158.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-iter-K6-VISMAP-20260529224816/iter-spec014-K6-VISMAP-30T-20260529215453.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-iter-K7-DEEPFIX-20260530001604/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/iter-spec014-K-20260529184854.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/iter-spec014-K-20260529191809.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/iter-spec014-K-20260529200445.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/iter-spec014-K2-20260529201437.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/iter-spec014-K3-FULL-20260529202300.runner.log`
- `target-copilot-bench/bench-results/zork-bench/archive-spec014-K1-K2-20260529202333/iter-spec014-K3-FULL-20260529202359.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K10-PLANNER-IN-KB-30T-20260530015819.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K11-PLANNER-SELF-30T-20260530024924.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K12-TAKE-PRIORITY-30T-20260530033652.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K13-TAKE10-50T-20260530042201.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K14-OBJREGEX-50T-20260530054222.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K22-EXITFIX-30T-20260530101346.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K23-launch.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K24-launch.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K24-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K25-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K26-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K27-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K28-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K28b-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K28c-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K28d-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K28e-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K28f-run.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K29-known-exits-fix-30T-20260530183946.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K29-known-exits-fix-30T-20260530184016.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K29-known-exits-fix-30T-20260530184129.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K30-exit-cache-30T-20260530184859.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K31-frontier-hardpin-30T-20260530185358.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K32-direction-no-frontier-30T-20260530190951.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K32b-cross-room-bleed-30T-20260530191109.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K33-K34-inventory-noun-stab-30T-20260530194708.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K35-inventory-not-score-30T-20260530202143.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K37-cardinal-probes-30T-20260530205222.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K38-acquire-dedup-30T-20260530212149.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K39-carried-cap-30T-20260530214912.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K39v2-branch-order-30T-20260530215100.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K40-cross-room-progress-30T-20260530222412.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K41-acquire-cap-30T-20260530225150.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K42-unstable-cap-all-verbs-30T-20260530231750.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K43-pin-threshold-30T-20260530234454.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K44-cardinal-tie-30T-20260531003121.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K45-visible-noun-tie-30T-20260531010421.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K46-cot-guard-30T-20260531013612.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K47-objpat-30T-20260531021314.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K47b-objpat-30T-20260531024026.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K48-reveals-30T-20260531061523.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K49-obs-nouns-30T-20260531064858.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K50-revisit-escalate-30T-20260531072655.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K50b-mm-fix-30T-launch.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K51-frontier-gate-30T-launch.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K53-persistent-nouns-30T-20260531084913.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K54-revisit-only-30T-20260531090757.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K55-failed-exit-30T-20260531093807.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K56-failed-exit-fix-30T-20260531100841.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K56-failed-exit-fix-30T-20260531100853.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K56-failed-exit-fix-30T-20260531100927.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K56-failed-exit-fix-30T-20260531101030.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K57-passthrough-hoist-30T-20260531103712.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K58-tried-tuple-30T-20260531110338.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K59-fix3-info-only-hoist-30T-20260531122803.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K59-noun3-unbound-30T-20260531115326.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K60-cot-extract-30T-20260531125805.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K61-sticky-objects-30T-20260531132546.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K62-room-scoped-objects-30T-20260531135543.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K63-force-take-30T-20260531142647.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K64-force-take-cardinal-30T-20260531145734.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K65-revert-tighten-30T-20260531152430.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K66-shortlist-revisit-30T-20260531155433.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K67-vertical-cardinal-30T-20260531162201.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K68-acquire-before-manipulate-30T-20260531165130.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K69-room-name-collision-30T-20260531171702.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K7-DEEPFIX-30T-20260529224745.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K7-DEEPFIX-30T-20260529224821.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K70-unfailed-compass-30T-20260531182423.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K70-unfailed-compass-30T-20260531182448.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K70b-inside-frontier-30T-20260531185552.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K71-cardinal-frontier-promote-30T-20260531192735.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K72-brain-30T-20260531233714.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K72-sync-tried-map-30T-20260531224007.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K72-sync-tried-map-30T-20260531230543.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K72-sync-tried-map-30T-20260531232244.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K72-verify-5T-20260531231012.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K73-brain-30T-20260601001436.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K73b-brain-30T-20260601004715.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K73b-brain-30T-20260601004741.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K74-brain-30T-20260601054027.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K75-brain-30T-20260601061400.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K75-brain-30T-20260601061423.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-K76-brain-30T-20260601065337.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K8-PLANNER-30T-20260530001522.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K8-PLANNER-30T-20260530001611.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K9-BRAIN-DRIVEN-30T-20260530010604.runner.log`
- `target-copilot-bench/bench-results/zork-bench/iter-spec014-K9-BRAIN-DRIVEN-30T-20260530010642.runner.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec014-J-gemma4-e4b-agi-pure-10t/iter-spec014-J-20260529182425.runner.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec014-K-gemma4-e4b-agi-pure-10t/iter-spec014-K-20260529183701.runner.log`

**e4b K-campaign arm-era k15-k59 (2026-06-01..02)**

- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k15.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k16.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k17.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k18.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k19.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k20.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k21.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k22.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k23.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k24.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k25.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k26.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k27.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k28.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k29.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k30.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k31.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k32.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k33.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k34.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k35.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k36.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k37.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k38.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k39.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k40.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k41.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k42.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k43.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k44.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k45.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k46.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k47.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k48.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k49.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k51.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k52.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k53.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k54.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k55.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k56.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k57.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k58.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k59smoke.log`

**e4b taught, INTERMITTENT delivery k61-k65 (2026-06-02..03)**

- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k61demo.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k61full.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k62full.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k63-700.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k63full.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k64.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-k65.log`

**e4b taught, RELIABLE delivery k68-orchfork (2026-06-03)**

- `target-copilot-bench/bench-results/zork-bench/k68-orchfork/run.log`

**e4b none/zorkgpt-default comparison (2026-06-02)**

- `target-copilot-bench/bench-results/zork-bench/comparison-gemma4-e4b/none.log`
- `target-copilot-bench/bench-results/zork-bench/comparison-gemma4-e4b/zorkgpt-default.log`

**gemma4:12b-it-qat runs (2026-06-07)**

- `target-copilot-bench/bench-results/zork-bench/arm-none-canonical.log`
- `target-copilot-bench/bench-results/zork-bench/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench/arm-zorkgpt-default-canonical.log`

**other models + unattributed archives**

- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-none-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-none-v2.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-terransoul-brain.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-terransoul-brain-v2.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-terransoul-brain-v3.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-terransoul-brain-v4.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-zorkgpt-default.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-7b/arm-zorkgpt-default-v2.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-stale-2026-05-26/arm-none-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-stale-2026-05-26/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec010-fast-leftover-20260529075051/archive-stale-2026-05-26/arm-zorkgpt-default-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-A-qwen2.5-7b/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-A-qwen2.5-7b/iter-A-20260529075058.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-C-gemma4-31b/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-C-gemma4-31b/iter-C-20260529092551.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-C2-gemma4-31b/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-C2-gemma4-31b/iter-C2-20260529120535.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-D-qwen2.5-7b-100t-interrupted/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-D-qwen2.5-7b-100t-interrupted/iter-D-20260529100402.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-D2-qwen2.5-7b-100t-terminated/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-D2-qwen2.5-7b-100t-terminated/iter-D2-20260529122240.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-E-gemma3-4b-BUGGY-pre-spec012/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-E-gemma3-4b-BUGGY-pre-spec012/iter-E-gemma3-4b-20260529130528.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-F-qwen3.5-9b-BUGGY-pre-spec012/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-F-qwen3.5-9b-BUGGY-pre-spec012/iter-spec011-F-qwen3.5-9b-20260529132805.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated/iter-spec011-G-gpt-oss-20b-20260529144106.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-E-gemma3-4b-10t/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-E-gemma3-4b-10t/iter-spec012-E-gemma3-4b-10t-20260529173806.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-F-qwen3.5-9b-10t/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-F-qwen3.5-9b-10t/iter-spec012-F-qwen3.5-9b-10t-20260529163042.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-G-gpt-oss-20b-10t/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-G-gpt-oss-20b-10t/iter-spec012-G-gpt-oss-20b-10t-20260529170033.runner.log` *(byte-duplicate of arm log — counted once)*
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-H-qwen3.5-4b-10t/arm-terransoul-brain-canonical.log`
- `target-copilot-bench/bench-results/zork-bench-canonical-spec012-H-qwen3.5-4b-10t/iter-spec012-H-qwen3.5-4b-10t-20260529164442.runner.log` *(byte-duplicate of arm log — counted once)*

### Episode artifacts per group (JSONL / summary / transcript counts)

| Group | Cohort | jsonl | summary | transcript | turns (basis) |
|---|---|---:|---:|---:|---|
| `archive-pre-p7-20260528-065830/none-episodes` | e4b-pre-patch7 | 0 | 0 | 4 | 1127 (transcript markers) |
| `archive-pre-p7-20260528-065830/terransoul-brain-episodes` | e4b-pre-patch7 | 1 | 1 | 2 | 300 (episode_end.turns) |
| `archive-pre-p7-20260528-065830/zorkgpt-default-episodes` | e4b-pre-patch7 | 0 | 0 | 2 | 387 (transcript markers) |
| `smoke-gemma4-think-off/none-episodes` | e4b-canonical-spec | 1 | 1 | 1 | 5 (episode_end.turns) |
| `zork-bench-canonical-spec003` | e4b-canonical-spec | 1 | 0 | 2 | 100 (episode_end.turns) |
| `zork-bench-canonical-spec004` | e4b-canonical-spec | 0 | 0 | 1 | 1 (transcript markers) |
| `zork-bench-canonical-spec005` | e4b-canonical-spec | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-bench-canonical-spec006` | e4b-canonical-spec | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-bench-canonical-spec007` | e4b-canonical-spec | 0 | 0 | 1 | 92 (transcript markers) |
| `zork-bench-canonical-spec008` | e4b-canonical-spec | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-bench-canonical-spec009` | e4b-canonical-spec | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-bench-canonical-spec010-fast` | e4b-canonical-spec | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec010-full` | e4b-canonical-spec | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-bench-smoke` | e4b-canonical-spec | 1 | 1 | 1 | 10 (episode_end.turns) |
| `zork-bench-smoke2` | e4b-canonical-spec | 1 | 1 | 1 | 15 (episode_end.turns) |
| `zork-bench-smoke3` | e4b-canonical-spec | 1 | 1 | 1 | 25 (episode_end.turns) |
| `zork-brain-canonical-2ep` | e4b-canonical-spec | 0 | 0 | 1 | 68 (transcript markers) |
| `zork-bench-canonical-spec011-B-gemma4-e4b-partial` | e4b-spec011-012 | 1 | 0 | 2 | 20 (episode_end.turns) |
| `zork-bench-canonical-spec011-B2-gemma4-e4b-BUGGY-pre-spec012` | e4b-spec011-012 | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec012-I-gemma4-e4b-rebaseline-10t` | e4b-spec011-012 | 2 | 1 | 2 | 20 (episode_end.turns) |
| `runner-era-K71` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `runner-era-K72` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `runner-era-K73` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `runner-era-K73B` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `runner-era-K74` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `runner-era-K75` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `runner-era-K76` | e4b-spec014-runner-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `arm-era-k15` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `k16-osc` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `k17-loopfix` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `k18-frontier` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `k19-frontier2` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `k20-leastvisited` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `k21-2ep` | e4b-K-arm-era | 2 | 1 | 2 | 60 (episode_end.turns) |
| `k22-xepmap` | e4b-K-arm-era | 2 | 1 | 2 | 60 (episode_end.turns) |
| `k23-criticaccept` | e4b-K-arm-era | 2 | 1 | 2 | 60 (episode_end.turns) |
| `k24-recency` | e4b-K-arm-era | 2 | 1 | 2 | 60 (episode_end.turns) |
| `k25-openable` | e4b-K-arm-era | 2 | 1 | 2 | 60 (episode_end.turns) |
| `k26-longhorizon` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k27-longhorizon-ody1d` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k28-blockerexpand` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k29-untried-exit` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k30-openwindow` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k31-window-proximity` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k32-enter-after-open` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k33-highconf-pin` | e4b-K-arm-era | 1 | 1 | 1 | 33 (episode_end.turns) |
| `k34-dark-retreat` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k35-stop-retake` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k36-dark-precise` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k37-deliver` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k38-deposit-headnoun` | e4b-K-arm-era | 1 | 1 | 1 | 100 (episode_end.turns) |
| `k39-xep-replay` | e4b-K-arm-era | 2 | 1 | 2 | 200 (episode_end.turns) |
| `k40-150turns` | e4b-K-arm-era | 1 | 1 | 1 | 150 (episode_end.turns) |
| `k41-sticky-deposit` | e4b-K-arm-era | 1 | 1 | 1 | 150 (episode_end.turns) |
| `k42-solution-replay` | e4b-K-arm-era | 2 | 1 | 2 | 240 (episode_end.turns) |
| `k43-acquire-light` | e4b-K-arm-era | 0 | 0 | 1 | 42 (transcript markers) |
| `k44-egg-reloop-fix` | e4b-K-arm-era | 0 | 0 | 1 | 47 (transcript markers) |
| `k45-open-success` | e4b-K-arm-era | 0 | 0 | 1 | 151 (transcript markers) |
| `k46-promotable-gate` | e4b-K-arm-era | 0 | 0 | 1 | 160 (transcript markers) |
| `k47-deliver-ody10` | e4b-K-arm-era | 2 | 1 | 2 | 46 (episode_end.turns) |
| `k48-dark-survival` | e4b-K-arm-era | 0 | 0 | 1 | 195 (transcript markers) |
| `k49-avoid-dark` | e4b-K-arm-era | 0 | 0 | 1 | 55 (transcript markers) |
| `k51-id-keyed-map` | e4b-K-arm-era | 0 | 0 | 1 | 35 (transcript markers) |
| `k52-all-zadopt` | e4b-K-arm-era | 0 | 0 | 1 | 89 (transcript markers) |
| `k53-enter-gateway` | e4b-K-arm-era | 1 | 1 | 1 | 200 (episode_end.turns) |
| `k54-lightloop` | e4b-K-arm-era | 0 | 0 | 1 | 77 (transcript markers) |
| `k55-deliver` | e4b-K-arm-era | 1 | 1 | 1 | 200 (episode_end.turns) |
| `k56-loopcap` | e4b-K-arm-era | 0 | 0 | 1 | 66 (transcript markers) |
| `k57-cumcap` | e4b-K-arm-era | 0 | 0 | 1 | 44 (transcript markers) |
| `k58-brainfix` | e4b-K-arm-era | 1 | 1 | 1 | 200 (episode_end.turns) |
| `k59-smoke` | e4b-K-arm-era | 1 | 1 | 1 | 30 (episode_end.turns) |
| `zb-root-none-strays` | e4b-K-arm-era | 0 | 0 | 4 | 79 (transcript markers) |
| `k61-taughtdemo` | e4b-taught-intermittent | 1 | 1 | 1 | 60 (episode_end.turns) |
| `k61-taughtfull` | e4b-taught-intermittent | 1 | 1 | 1 | 400 (episode_end.turns) |
| `k62-taughtfull` | e4b-taught-intermittent | 1 | 1 | 1 | 400 (episode_end.turns) |
| `k63-taught700` | e4b-taught-intermittent | 1 | 1 | 1 | 32 (episode_end.turns) |
| `k63-taughtfull` | e4b-taught-intermittent | 1 | 1 | 1 | 410 (episode_end.turns) |
| `k64-taught` | e4b-taught-intermittent | 1 | 1 | 1 | 450 (episode_end.turns) |
| `k65-taught` | e4b-taught-intermittent | 1 | 1 | 1 | 311 (episode_end.turns) |
| `k68-orchfork` | e4b-taught-reliable | 1 | 1 | 1 | 500 (episode_end.turns) |
| `comparison-e4b-none` | e4b-baselines | 0 | 0 | 1 | 59 (transcript markers) |
| `comparison-e4b-zorkgpt-default` | e4b-baselines | 0 | 0 | 1 | 48 (transcript markers) |
| `12b-canonical-none` | gemma4-12b | 0 | 0 | 4 | 14 (transcript markers) |
| `12b-canonical-terransoul-brain` | gemma4-12b | 0 | 0 | 3 | 15 (transcript markers) |
| `12b-canonical-zorkgpt-default` | gemma4-12b | 0 | 0 | 1 | 29 (transcript markers) |
| `zork-12b-trial1` | gemma4-12b | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-12b-trial2` | gemma4-12b | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-12b-trial3` | gemma4-12b | 2 | 1 | 2 | 200 (episode_end.turns) |
| `zork-bench-12b` | gemma4-12b | 0 | 0 | 1 | 25 (transcript markers) |
| `zork-bench-12b-run2` | gemma4-12b | 2 | 1 | 2 | 200 (episode_end.turns) |
| `iter10-brain` | iter-may25-gemma3 | 3 | 1 | 3 | 75 (episode_end.turns) |
| `iter12-brain` | iter-may25-gemma3 | 3 | 1 | 3 | 75 (episode_end.turns) |
| `iter12-default` | iter-may25-gemma3 | 3 | 1 | 3 | 75 (episode_end.turns) |
| `archive-7b/none-episodes` | other-models-and-unattributed | 3 | 3 | 4 | 81 (episode_end.turns) |
| `archive-7b/terransoul-brain-episodes` | other-models-and-unattributed | 4 | 4 | 1 | 200 (episode_end.turns) |
| `archive-7b/zorkgpt-default-episodes` | other-models-and-unattributed | 2 | 2 | 2 | 100 (episode_end.turns) |
| `archive-pre-brain-improvements/none-episodes` | other-models-and-unattributed | 0 | 0 | 1 | 99 (transcript markers) |
| `archive-pre-brain-improvements/zorkgpt-default-episodes` | other-models-and-unattributed | 0 | 0 | 1 | 78 (transcript markers) |
| `archive-stale-2026-05-26/none-episodes` | other-models-and-unattributed | 0 | 0 | 3 | 242 (transcript markers) |
| `archive-stale-2026-05-26/terransoul-brain-episodes` | other-models-and-unattributed | 0 | 0 | 10 | 264 (transcript markers) |
| `archive-stale-2026-05-26/zorkgpt-default-episodes` | other-models-and-unattributed | 0 | 0 | 4 | 173 (transcript markers) |
| `stale-none-20260526` | other-models-and-unattributed | 0 | 0 | 1 | 4 (transcript markers) |
| `zork-bench-canonical-spec011-A-qwen2.5-7b` | other-models-and-unattributed | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec011-C-gemma4-31b` | other-models-and-unattributed | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec011-C2-gemma4-31b` | other-models-and-unattributed | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec011-D-qwen2.5-7b-100t-interrupted` | other-models-and-unattributed | 0 | 0 | 1 | 44 (transcript markers) |
| `zork-bench-canonical-spec011-D2-qwen2.5-7b-100t-terminated` | other-models-and-unattributed | 0 | 0 | 1 | 70 (transcript markers) |
| `zork-bench-canonical-spec011-E-gemma3-4b-BUGGY-pre-spec012` | other-models-and-unattributed | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec011-F-qwen3.5-9b-BUGGY-pre-spec012` | other-models-and-unattributed | 2 | 1 | 2 | 40 (episode_end.turns) |
| `zork-bench-canonical-spec011-G-gpt-oss-20b-BUGGY-terminated` | other-models-and-unattributed | 1 | 0 | 2 | 20 (episode_end.turns) |
| `zork-bench-canonical-spec012-E-gemma3-4b-10t` | other-models-and-unattributed | 2 | 1 | 2 | 20 (episode_end.turns) |
| `zork-bench-canonical-spec012-F-qwen3.5-9b-10t` | other-models-and-unattributed | 2 | 1 | 2 | 20 (episode_end.turns) |
| `zork-bench-canonical-spec012-G-gpt-oss-20b-10t` | other-models-and-unattributed | 2 | 1 | 2 | 20 (episode_end.turns) |
| `zork-bench-canonical-spec012-H-qwen3.5-4b-10t` | other-models-and-unattributed | 2 | 1 | 2 | 20 (episode_end.turns) |

### Gaps (what could NOT be grounded — no fabrication)

- **iter10 / iter12 / iter12-default (2026-05-25, gemma3:4b):** no runner/arm logs were
  archived — LLM-failure and JSON-malformation rates are NOT derivable; only `episode_end`
  MCP counters survive (359 calls / 7 errors over 225 turns). Also these are gemma3:4b,
  not gemma4:e4b.
- **zork-12b-trial1-3, zork-bench-12b(-run2):** JSONL/transcripts only, no logs — no
  LLM-failure or JSON grounding. The `12b-canonical-*` logs that do exist record only a
  stale-model-tag 404 storm (66 failures in <60 turns) and say nothing about 12b's real
  failure economy.
- **Harness counters before spec008:** `harness_sanitise`/`verb_reject`/`loop_break`/
  `obj_llm_fallback_calls` fields do not exist in earlier `episode_end` records (incl. all
  of pre-Patch7, spec003-007, iter10/12) — reported as ungrounded, not zero.
- **Pre-Patch7 cohort:** no `episode_end` for the log-bearing arms (turn denominators come
  from `Turn N:` log lines); the separate `*-episodes` groups in the JSON hold the few
  surviving transcripts/JSONL of adjacent attempts and may not align 1:1 with the logs.
- **`zork-bench-canonical-spec004` / `spec007` / `spec011-D/D2/G`:** runs interrupted or
  hung (see HANG-NOTES.md/QUEUE-NOTES.md in those dirs); partial transcripts only.
- **Intermittent-taught serve ratio:** the paper's "~60% of turns" serving figure for the
  intermittent regime is not recomputable — intermittent-era logs carry no per-serve
  marker (only k68's fork logs `[ORCH-TAUGHT]`).
- **`done_reason=length`:** absent from every bench log (it is a desktop-app observability
  marker); context saturation is therefore grounded via empty-completion and
  action-truncation events instead.
- **`benchmark/terransoul/zorkgpt/taughtLocalLLM/`** contains only the taught-knowledge
  text (`zork_solution_knowledge.txt`); the taught-run logs live under
  `target-copilot-bench/bench-results/zork-bench/k6*-taught*` and `k68-orchfork/`.
- **Circuit-breaker cascade counts** are line counts of suppressed calls, not independent
  failures; quote primary-failure rates, never the cascade, as the LLM failure rate.

