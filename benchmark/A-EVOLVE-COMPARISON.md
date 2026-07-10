# A-Evolve — external benchmark record (context, not a TerranSoul run)

> **What this file is.** A-Evolve ([A-EVO-Lab/a-evolve](https://github.com/A-EVO-Lab/a-evolve),
> MIT license, 686+ stars at time of access) is an open-source infrastructure
> for evolving the *harness* around a **frozen** LLM — skills, episodic
> memory, and prompts are mutated by an LLM-driven loop, gated on holdout
> tasks, and rolled back via `git` on regression, while the base model's
> weights never change. That "keep the model frozen, evolve what surrounds
> it" thesis is the same one TerranSoul's own brain/memory architecture is
> built on, which is why the project owner asked for this record. **TerranSoul
> has not run any of A-Evolve's benchmark suite** (MCP-Atlas, SWE-bench,
> Terminal-Bench, SkillsBench, ARC-AGI, OSWorld, τ-bench, CL-Bench,
> WebArena-Infinity) — this file catalogs A-Evolve's own **published** numbers
> for reference and comparison context, the same way
> [`BOEING-COMPARISON.md`](./BOEING-COMPARISON.md)'s "Existing online
> benchmarks" section catalogs other frontier systems' published standings.
> No TerranSoul number appears in this file. Per this repo's factual-language
> policy, nothing here is framed as TerranSoul "beating" or "matching"
> anything.

## Methodology (as published by A-Evolve)

- **Base model, frozen throughout:** a single Claude Opus 4.6 checkpoint —
  A-Evolve's evolution loop never updates the model's weights.
- **What actually changes:** the agent's on-disk workspace — skill files,
  an episodic-memory log, system-prompt text, and tool configuration — via
  an Observe → Evolve → Evaluate → Reload cycle. Each accepted mutation is
  `git`-tagged (`evo-1`, `evo-2`, …); mutations that regress on a holdout
  task set are rolled back.
- **Claimed harness-engineering cost:** "0 hours of manual harness
  engineering" per run, i.e. the same reference evolution algorithm was
  applied to each benchmark's seed agent without per-benchmark hand-tuning.
- **Dating:** the headline table below is dated by A-Evolve as "checked
  March 2026." This file was compiled from the repository's public README
  on 2026-07-10 — later benchmark updates on their side would not yet be
  reflected here.
- **Source:** [github.com/A-EVO-Lab/a-evolve](https://github.com/A-EVO-Lab/a-evolve),
  README §"Benchmark Highlights," accessed 2026-07-10. Position/methodology
  paper: *"Position: Agentic Evolution is the Path to Evolving LLMs"*
  ([arXiv:2602.00359](https://arxiv.org/abs/2602.00359)).

## Results — all 10 benchmarks A-Evolve reports for the Opus-4.6 base model

| Benchmark | Baseline (seed agent) | Evolved (A-Evolve) | Δ | Standing (as reported) |
|---|---|---|---|---|
| MCP-Atlas | 76.0%¹ | **79.4%** | +3.4pp | 🥇 #1 |
| SWE-bench Verified | 74.2%¹ | **76.8%** | +2.6pp | ~#5 |
| Terminal-Bench 2.0 | 63.5%¹ | **76.5%** | +13.0pp | ~#7 |
| SkillsBench | 19.7%¹ | **34.9%** | +15.2pp | #2 |
| ARC-AGI | 10.1%¹ | **12.3%** | +2.2pp | 🥇 #2 (community leaderboard) |
| OSWorld | 65.7%¹ | **69.6%** | +3.9pp | — (not stated) |
| SWE-bench Lite | 63.7% | **67.0%** | +3.3pp | "Evolved" (no external rank given) |
| τ-bench | 72.7% | **77.0%** | +4.3pp | "Evolved" (no external rank given) |
| CL-Bench | 29.5% | **34.0%** | +4.5pp | "Evolved" (no external rank given) |
| WebArena-Infinity | 72.5% | **76.3%** | +3.8pp | "Evolved" (no external rank given) |

¹ A-Evolve's README states the evolved score and the point-delta but not an
explicit standalone baseline number for these six rows; the baseline column
here is arithmetically derived (evolved − Δ) from those two published
figures, not a separately-published number — flagged so the precision isn't
overstated.

**Reading the "Standing" column:** rankings (`#1`, `~#5`, …) are A-Evolve's
own reported placement against each benchmark's external leaderboard at the
time they measured, not independently re-verified here — treat them the same
informal-aggregate way `BOEING-COMPARISON.md` treats "○" sourced figures
elsewhere in this repo, since no primary-leaderboard cross-check was
performed for this file.

## What "evolved" changed, per A-Evolve's own MCP-Atlas example

A-Evolve's README illustrates one run with a before/after workspace diff: the
seed agent shipped a 20-line generic system prompt, no skills, and no memory;
the evolved agent (79.4% on MCP-Atlas) kept the system prompt **unchanged**
and instead added five targeted skill files (entity verification, search
iteration, multi-requirement handling, code execution, conditional
handling) plus a six-entry episodic-memory log — their own framing is that
five *targeted* skills outperformed a broader set of ten generic ones they
also tried. This is a single illustrative example from their repo, not a
statistic to be treated as a benchmark result in its own right.

## Related, not directly comparable: A-Evolve-Training

A-Evolve's authors separately publish *"A-Evolve-Training: Autonomous
Post-Training of a 30B Model"* ([arXiv:2606.20657](https://arxiv.org/abs/2606.20657)),
reporting an autonomous system that **does** update model weights — four
rounds of post-training a 30B Nemotron checkpoint, reaching 0.86 against the
top human submission's 0.87 on the public NVIDIA Nemotron-Reasoning
Challenge leaderboard (8th of ~4,000 at time of writing). This is a
**different category of work** (weight fine-tuning) from the frozen-model
harness-evolution results tabulated above, and is not comparable to
TerranSoul's own frozen-actor, no-weight-training design choice (see the SIA
benchmark work referenced elsewhere in this repo's benchmark history) —
included here only so the two are not conflated by a future reader.

## Why no TerranSoul row exists here

TerranSoul's own comparable, **measured** results live in
[`BOEING-COMPARISON.md`](./BOEING-COMPARISON.md) (a frozen Three.js-primitives
vision self-improve loop) and [`COMPARISON.md`](./COMPARISON.md) (memory/RAG
benchmarks, self-improving-agent head-to-heads). None of those overlap
A-Evolve's specific suite (MCP-Atlas, SWE-bench, Terminal-Bench, SkillsBench,
ARC-AGI, OSWorld, τ-bench, CL-Bench, WebArena-Infinity), so per this repo's
"never fabricate a number" policy, no comparison row is presented — adding
one would require actually running TerranSoul's own agent against these
suites, which has not happened. If a future session runs any of these
benchmarks against TerranSoul, the honest result — whatever it is — belongs
in a new dated section of this file, not a retrofit of the table above.

## Architectural relevance to TerranSoul (brief — see the fuller writeup)

A-Evolve's "frozen model, evolve the harness" design is the same shape as
TerranSoul's own skill-synthesis and procedural-memory pipeline (the
outcome-predicate → LLM skill-authoring → promotion-gate → curator lifecycle
chain — see `rules/completion-log.md`). The detailed, file:line-grounded
comparison of the two architectures **completed the same day this file was
written**: see `docs/a-evolve-parity-audit-2026-07-10.md` (RESOLVED
2026-07-10 — its 5 findings were closed as code changes in the same session;
gap closures logged in `rules/completion-log.md` →
`RSL-3-AEVOLVE-GAPS-2026-07-10`, and the audit is linked from
`docs/brain-advanced-design.md`'s Related Documents). This file's scope
remains strictly A-Evolve's own published numbers.
