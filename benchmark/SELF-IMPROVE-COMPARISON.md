# TerranSoul vs SIA — Self-Improvement & Memory Comparison

> **Navigation:** This is a focused two-system comparison: **TerranSoul** (this repo) vs **[hexo-ai/sia](https://github.com/hexo-ai/sia)** ("Self-Improving AI with Harness & Weight Updates"). For the full cross-system retrieval matrix (~20 memory/RAG/agent systems), see [COMPARISON.md](COMPARISON.md). For the ZorkGPT self-improvement campaign narrative, see [terransoul/zorkgpt/README.md](terransoul/zorkgpt/README.md) and the research write-up [`docs/LLM-Brain-Design-Research-Paper.md`](../docs/LLM-Brain-Design-Research-Paper.md).
>
> **Why this page exists.** SIA is a fast-rising (≈1.9k★, created 2026-03-25) self-improving-agent framework that shares TerranSoul's *goal* — an AI that gets better at a task over time without a human in the loop — but takes the **opposite architectural bet**. This page puts the two side by side on both axes a reader asks about: **how each self-improves** and **what each remembers**.

> **SIA provenance.** Repo [github.com/hexo-ai/sia](https://github.com/hexo-ai/sia) reached and read (README, `docs/architecture.md`, `sia/orchestrator.py`, `sia/context_manager.py`, `EVALUATION_GUIDE.md`); license confirmed **MIT** (`LICENSE`: "Copyright (c) 2025 Hexo"). SIA's headline numbers below are **task-success / accuracy / speedup** figures from its README; SIA publishes **no** retrieval-recall, latency, or cost numbers (it is not a retrieval/memory system), so those cells are honest "—" blanks, never fabricated. The paper-claimed **LoRA / RL weight-update** path could **not** be confirmed in the public source tree (only the harness/scaffold-editing path and provider scaffolds are present) — flagged with † throughout. The press-release "**350× faster path to superintelligence**" line is **not** in the README and is excluded as unverified marketing.
>
> Last reviewed: 2026-06-30. SIA last push 2026-06-24.

---

## At a glance — by the numbers

> **Numbers are not comparable across the two systems' headline benchmarks.** TerranSoul's retrieval cells are **LongMemEval-S** recall (a memory benchmark); SIA's headline is **LawBench Top-1 accuracy** (a task-success benchmark with model-weight training in the loop). One measures *did it find the right saved fact*; the other measures *did the trained agent solve the task*. They share **no corpus, no metric shape, and no model**. The honest overlap is **mechanism and cost**, not the score columns. A "—" is an **honest blank** — a metric the system does not publish or that does not apply — never a zero or a failure.

| System | Category | Self-improvement target | Memory R@5 | R@10 | R@20 | Quality 0–10 | Latency p50 | Cost | License | Published headline |
|---|---|---|--:|--:|--:|--:|--:|--:|---|---|
| **🧠 TerranSoul** (this repo) | Self-improving memory **brain** + agent | **Frozen model** — context / memory / KG / skills | **98.6 %** | **99.8 %** | **100.0 %** | **9.8** | **1.0 s** | **$0** | proprietary | LongMemEval-S **top-1** (R@5 98.6 %); Zork **0 → 10–20** AGI-pure on a frozen 4B |
| *— Self-improving agent frameworks —* | | | | | | | | | | |
| SIA (hexo-ai / Hexo Labs) | Self-improving **agent + weights** framework | **Weights (LoRA+RL†) + harness code** | — ⁵ | — ⁵ | — ⁵ | — ⁵ | — ⁶ | — ⁷ | MIT | LawBench **70.1 %** Top-1 (vs 45 % prior SOTA); GPU kernels **−91.9 %** runtime; scRNA denoising **+502 %** ⁸ |

*Plain English: TerranSoul is measured on whether it pulls back the right saved memory (recall, the % columns) and on an answer-quality head-to-head (9.8/10), running a frozen local model for free. SIA is measured on whether its self-trained agent solves a benchmark task (e.g. 70.1 % on a legal-reasoning test) — a different kind of score entirely. The "—" cells are honest: SIA simply does not publish recall, latency, or cost, because it is not a memory/retrieval system.*

**Honesty notes.**
⁵ SIA publishes **no** retrieval-recall (R@k / NDCG / MRR) numbers and ships **no embedder, vector store, or knowledge graph** — it is a code-evolution + weight-training harness, not a retrieval/memory system. Blank by category, not by omission.
⁶ SIA publishes **no** latency figures. Its loop is a multi-generation offline optimization (minutes-to-hours per generation), not an interactive query path, so a "p50 per query" does not apply.
⁷ SIA cost is **unpublished** and provider-dependent: the framework drives cloud LLMs (Anthropic / OpenAI / Gemini) and, for the weight path, GPU RL training (Nebius / `gpt-oss-120b`) — neither is a fixed "$0 local" figure like TerranSoul's. Marked "—" rather than guessed.
⁸ SIA's headline numbers are **task-success / accuracy / speedup**, *not* retrieval recall or answer-quality-on-a-judge. They are reproduced verbatim from SIA's README and are **not comparable** to any TerranSoul column. Reported combined ("SIA-W+H") figures: LawBench 70.1 % Top-1, AlphaFold-3 TriMul kernel 14× speedup (−91.9 % runtime), single-cell RNA denoising 0.289 MSEnorm (+502 % over baseline), MLE-Bench ranked #1 across generations tested.
† The **LoRA (rank 32) + RL** weight-update path (PPO+GAE / GRPO / entropic-advantage, base `openai/gpt-oss-120b`) is documented in SIA's paper and announcement but **could not be confirmed in the public source tree** inspected here — only the harness/scaffold-editing path was visible. Treat "weight-editing" as paper-claimed, source-unconfirmed.

---

## What each system is

**TerranSoul** is a local-first, self-improving **memory brain** for any agent, reached over MCP. A frozen local model (`gemma4:12b-it-qat` via Ollama; **never** autonomously swapped or retrained — a standing project mandate) gets better at a task by **accumulating and retrieving knowledge**: a 3-tier store (short / working / long) sharded across five cognitive kinds (semantic, procedural, principle, episodic, analytical), a typed `memory_edges` knowledge graph, hybrid lexical + vector + graph retrieval with HyDE and LLM-as-judge rerank, and a write→manage→read self-improvement loop (outcome-classified write-back, Laplace L4→L1 confidence ladder, autonomous skill synthesis). Knowledge is **persistent and cross-session**.

**SIA** ("Self-Improving AI") from Hexo Labs is a self-improving-**agent** framework: "*a Self Improving AI framework to autonomously improve the performance of any AI system (Model / Agent) on a benchmark task.*" It runs a three-role loop — a **Meta-Agent** writes the initial task agent ("harness") from the task spec, a **Target Agent** executes the task and logs its full trajectory, and a **Feedback Agent** reads that trajectory and authors the next generation's improvement. The improvement lands in **two places**: the harness *code* (Action A, weights frozen) and, per the paper, the **model weights** via LoRA + RL (Action B†, scaffold frozen). It is Python 3.11+, backend-agnostic (Claude Agent SDK / OpenHands / Pydantic AI), MIT-licensed, and ships a web dashboard. It has **no persistent memory subsystem** — state is per-run flat files, discarded between unrelated runs.

**The one-line contrast:** SIA makes the *agent* (its code and its weights) smarter; TerranSoul makes the *memory around a frozen model* smarter. SIA is the philosophical opposite of TerranSoul's frozen-model, brain-mediated doctrine — which is exactly why it is worth studying.

---

## Self-improvement approach — side by side

| Dimension | **🧠 TerranSoul** | SIA |
|---|---|---|
| What changes between iterations | **Memory + context only** — lessons, KG edges, procedural confidence, synthesized skills; the model is **frozen** | **Harness code** (Action A) and/or **model weights** (Action B†, LoRA+RL on `gpt-oss-120b`) |
| Model weights | **Never touched** (standing `gemma4:12b-it-qat` mandate; no autonomous retraining) | **Edited** via RL (PPO+GAE / GRPO / entropic advantage / DPO / best-of-N BC), algorithm chosen per reward shape † |
| Loop roles | Actor (frozen LLM) + critic/sampler + reflection write-back + skill synth, all brain-mediated | **Meta-Agent** (writes agent) → **Target Agent** (runs, logs trajectory) → **Feedback Agent** (diagnoses + writes fix) |
| Improvement signal | Outcome-classified write-back + Laplace L4→L1 confidence ladder; bench score feeds the next run | `evaluate.py` auto-score per generation, piped into the next generation's feedback prompt |
| What the critic reads | Episode outcome + retrieved memory context | **Full run trajectory** (every step/action/result), not just the terminal score |
| Persistence of learning | **Cross-session, durable** (SQLite + KG, single source of truth) | **Per-run flat files** (`runs/run_{id}/gen_{n}/`); discarded between unrelated runs |
| Audit / provenance | Per-mutation audit log; reflections seeded to `mcp-data/shared/` | **Per-generation diffable artifacts** (`improvement.md` + `target_agent.py`, `diff gen_1 gen_2`) |
| Regression guard | Confidence decay + quarantine; honest de-confounding of cross-run gains | **Best-generation-wins** finalization (keeps the champion artifact, not the latest) |
| Verified self-improve result | Zork: frozen 4B **0 → 10–20** AGI-pure (both controls 0); 12B per-run cross-episode **~15**, peak 45 via across-run accumulation; reliability demo **350/350** deterministic | LawBench **13.5 % → 70.1 %** (SIA-W+H); harness-only (SIA-H) plateaued at **50.0 %**, RL weight updates pushed to **70.1 %** ⁸ |

*Plain English: both systems improve themselves without a human editing them, but TerranSoul does it by learning facts and skills into a memory layer while keeping the model fixed, whereas SIA rewrites the agent's own code and (per its paper) retrains the model's weights. SIA's own ablation is the clearest tell: rewriting code alone got it to 50 %, and only weight-training pushed it to 70 % — the opposite of TerranSoul's "frozen-model, fix-the-memory" thesis.*

**The honest tension.** SIA's LawBench ablation (harness-only 50.0 % → harness+weights 70.1 %) is direct evidence that, *on those benchmarks*, weight editing did work where scaffold editing plateaued. TerranSoul's standing bet is the inverse — that for a long-lived **personal-assistant memory** the frozen-model + externalized-knowledge path is the right trade (no retraining, full auditability, cross-session accumulation, $0 local). These are different problems (one-shot benchmark maximization vs durable lifelong memory), so neither result refutes the other — but SIA is the strongest available counter-example to the "never touch the weights" doctrine and should be cited as such, not hand-waved.

---

## Memory approach — side by side

| Dimension | **🧠 TerranSoul** | SIA |
|---|---|---|
| Storage | SQLite (+ Postgres / MSSQL / Cassandra), single source of truth | **Flat files only** — `runs/run_{id}/gen_{n}/` tree + isolated `venv/` |
| Embedder / vectors | ✅ `embeddinggemma` 768-d (+ mxbai / nomic fallbacks), asymmetric query/doc prefixes | ❌ **none** — no embeddings, no vectorization anywhere |
| Knowledge graph | ✅ typed `memory_edges` + `brain_add_edge` write tool + contradiction resolution | ❌ none |
| Retrieval | Hybrid lexical + vector + graph fusion, HyDE, LLM-as-judge rerank, KG hop | **Linear file reads** — feedback prompt loads only the **immediately preceding generation's** artifacts; older gens referenced as a list of numbers, not content |
| Closest thing to long-term memory | 3-tier store, 5 cognitive-kind shards, per-kind decay/half-lives, consolidation | `context.md` — an **LLM-summarized markdown evolution log** (per-gen deltas + top-5 insights, token-budgeted, compressed via a meta-model) |
| Cross-session knowledge | ✅ durable, accumulates across runs and games (Detective +20 memory-lift, n=2) | ❌ single-run, procedural; nothing carries between unrelated tasks |
| Recall benchmark | **LongMemEval-S R@5 98.6 % / R@10 99.8 % / R@20 100.0 % / NDCG@10 88.8 % / MRR 89.1 %** (top-1) | — ⁵ (no retrieval benchmark; not a retrieval system) |
| Token discipline | `npm run brain:tokens`; RRF default ~2,748 tok/query (~3× fewer than keyword path) | Named caps: `AGENT_CODE_PREVIEW_LIMIT`, `INSIGHT_PREVIEW_LIMIT` (top-5), `TRAJECTORY_PREVIEW_LIMIT`, last-10-stdout-lines |

*Plain English: TerranSoul is a real memory engine — it embeds, indexes, and graph-links everything it learns and can prove it finds the right item 98.6 % of the time. SIA has no memory engine in that sense: it keeps a folder of files per run and an auto-summarized "what changed this generation" markdown log, and it only ever looks back one generation. They are not competitors on recall — SIA simply isn't playing that game.*

---

## Published benchmark numbers (read the caveat first)

> **These rows are NOT comparable to each other.** TerranSoul's numbers are **retrieval recall** (LongMemEval-S) and **judge answer-quality** (parity-personal-ai), on a **frozen local model for $0**. SIA's numbers are **task accuracy / speedup** on benchmarks where **model weights were trained in the loop**, on cloud/GPU infrastructure. A "—" is an honest blank where the system publishes nothing on that axis.

| Metric | **🧠 TerranSoul** | SIA |
|---|--:|--:|
| LongMemEval-S R@5 (retrieval) | **98.6 %** | — ⁵ |
| LongMemEval-S R@10 / R@20 | **99.8 % / 100.0 %** | — ⁵ |
| MTEB LoCoMo R@10 (`rrf_emb`) | 64.5 % | — ⁵ |
| Parity answer-quality (0–10 judge) | **9.8** (22/22 success) | — ⁵ |
| Long-horizon task (Zork, frozen LLM) | **0 → 10–20** AGI-pure; reliability demo 350/350 | — |
| LawBench Top-1 accuracy ⁸ | — | **70.1 %** (vs 45 % prior SOTA; 13.5 % init) |
| GPU/CUDA kernel runtime ⁸ | — | **−91.9 %** (14× speedup, TriMul) |
| scRNA-seq denoising ⁸ | — | **+502 %** (0.289 MSEnorm) |
| MLE-Bench (Hard) ⁸ | — | **#1** across generations tested |
| Latency p50 | **1.0 s** | — ⁶ |
| Cost | **$0** (local) | — ⁷ (provider + GPU dependent) |
| License | proprietary (pre-release) | MIT |
| Maturity | private, pre-release | ≈1.9k★, 227 forks, 7 releases, ~19 commits, created 2026-03-25, last push 2026-06-24 |

*Plain English: each system fills the column for the test it actually ran. The blanks are not losses — TerranSoul never ran LawBench (it's a frozen-model memory engine, not a weight-trainer), and SIA never ran a recall benchmark (it has no retrieval layer). The only directly comparable facts are license (SIA MIT, more open) and cost (TerranSoul $0 local, SIA unpublished/provider-paid).*

---

## What we could adopt from SIA

SIA is **MIT-licensed**, so under TerranSoul's private-repo policy any of it could be vendored verbatim today — but the valuable parts here are **methodology and architecture patterns**, not code to copy. MIT is permissive (no copyleft / no unknown-license risk), so **no `docs/licensing-audit.md` entry is required** if we adopt patterns rather than verbatim source; if we ever do vendor a SIA file verbatim, add a deduplicated `CREDITS.md` row and note it in the audit as MIT (cheap pass).

The flat-file, single-run, embedder-less memory model and the **weight-editing (LoRA+RL) path are explicitly NOT adoptable** — the former is strictly weaker than TerranSoul's hybrid-RAG + typed-KG brain, and the latter directly violates the frozen-`gemma4:12b-it-qat` mandate. Cite weight-editing as a **contrasting design point**, do not copy it.

Genuinely useful patterns (each frozen-model-compatible and aligned with our existing doctrine):

1. **Per-generation diffable artifact trail** (`improvement.md` + agent state per generation; `diff gen_1 gen_2`). Maps onto our `audit → fix → re-bench` loop — a structured per-iteration provenance trail would make Zork-campaign brain edits replayable, reversible, and lesson-attributable instead of scattered across bench logs.
2. **`context.md` LLM-summarized evolution log** (token-budgeted running narrative of how the agent changed across iterations, compressed by a meta-model). A cheap "why did the brain change between session N−1 and N" recall artifact alongside the KG — readable by the actor without re-querying the full graph.
3. **Per-generation delta computation** (size/metric deltas vs the prior generation = stored causal attribution of what changed and its measured effect). Directly addresses TerranSoul's lesson-quality / fix-attribution gap: *which brain edit moved the bench score* — something the Zork loop currently lacks.
4. **Best-generation-wins finalization** (keep the champion artifact, not the latest). The bench loop could checkpoint and retain the **highest-scoring brain state** rather than always carrying the last iteration forward — a regression guard for self-improvement.
5. **Feedback Agent reads the FULL trajectory** (every step/action/result) before authoring the fix, not just the terminal score. Upgrade for our reflection critic (Principle 7 root-cause work): condition lessons on full episode traces, not scalar reward.
6. **Mutually-exclusive lever per iteration** (SIA changes scaffold OR weights, never both, to isolate the cause of each delta). Frozen-model analogue: change **prompt OR retrieval** per bench iter, never both — clean attribution of harness gains vs the model-capacity wall (self-learning-doctrine Principle 7: "model too small is the last hypothesis").
7. **Metrics-extraction fallback hierarchy** (`results.json` → `detailed_results.json` → parse stdout). A defensive pattern for harvesting an outcome signal when structured logs are missing — hardens the bench bridge's reward/score capture.

---

## Verdict — where each leads

**TerranSoul leads on:** durable cross-session memory (98.6 % R@5 top-1, a real embedder + typed KG + hybrid retrieval SIA has none of), interactive latency (1.0 s p50), cost ($0 local frozen model), auditability (per-mutation log, no opaque weight deltas), and the breadth of a shipping personal-assistant stack (3D VRM, omni-channel, CRDT sync).

**SIA leads on:** raw single-task benchmark maximization where retraining is allowed (its 50 % → 70.1 % LawBench ablation is direct evidence weight-editing beats scaffold-only on those tasks), a cleaner explicit three-role loop (Meta / Target / Feedback) with diffable per-generation provenance, openness (MIT vs proprietary), and public traction (≈1.9k★ in three months).

**The takeaway:** they optimize different problems. SIA maximizes a benchmark by mutating the agent and its weights for one run; TerranSoul accumulates auditable, retrievable knowledge around a permanently frozen model for a lifelong assistant. SIA's value to TerranSoul is its **self-improvement *bookkeeping*** — diffable artifacts, delta attribution, champion-keeping, full-trajectory critique — not its weight-editing engine.
