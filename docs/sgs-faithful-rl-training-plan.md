# Faithful SGS (RL training) — scoping plan

> **Status:** scoping only. This documents what a *faithful* implementation of
> **Self-Guided Self-Play (SGS)** [Bailey, Wen, Dong, Hashimoto, Ma,
> arXiv:2604.20209] would require, why it is a **separate effort** rather than a
> bench-bridge chunk, and the **gradient-free approximation** we can land now
> without breaking the project's frozen-harness / AGI-purity doctrine.
>
> Requested 2026-06-16: user picked "Faithful SGS (RL training)" over the
> docs-only and inference-only options. This plan exists because the faithful
> version cannot be honestly shipped as a single coding chunk — see §3.

## 1. What SGS actually is (from the paper)

SGS is a **gradient-based RL training** algorithm with three roles, all updated
by REINFORCE:

- **Solver** `π_θ` — attempts the target problem and the conjectured sub-problems;
  trained on binary verification reward, only on problems with solve-rate ≤ 0.5.
- **Conjecturer** `g_φ` — from an unsolved target, generates a simpler related
  sub-problem (§E.1); trained on `R_synth = R_solve · R_guide`.
- **Guide** `ρ` — a *finetuned LLM-judge* scoring the sub-problem on
  relevance (0–5), conclusion-complexity (0–4), redundancy (0–1) →
  `R_guide = max(0, relevance + (2−complexity) + (1−redundancy))`, complexity ≥ 3 → 0.

`R_solve = 1 − s(x̃)` where `s(x̃)` is the **k=8-rollout empirical solve rate**
(too-easy and never-solved sub-problems zeroed). The paper's *gains come from the
RL training* — ablations show no-Guide 65.5 % vs 67.1 %, and a frozen Conjecturer
is strictly worse. Headline: a 7 B model after 200 rounds of self-play out-solves
a 671 B model pass@4 on Lean4.

## 2. What we currently do (gradient-free adaptation — shipped)

In `benchmark/scripts/zork-bench/terransoul_brain_bridge.py::reflect_on_episode`
and documented in `docs/brain-advanced-design.md` §34.10 + the research paper
§2.4/§8:

- **Conjecturer** — the brain conjectures a target-conditioned sub-goal from the
  agent's *own* failure reflection (`_build_conjecturer_prompt`, `_extract_subgoal`).
- **Guide** — a **deterministic** rubric implementing the exact `R_guide` formula
  (`_guide_score_subgoal`, complexity ≥ 3 → 0). Deterministic because a
  summariser-class brain cannot reliably emit rubric score-lines.
- A vetted sub-goal (`R_guide ≥ 4`) becomes a curriculum lesson the lesson-binding
  layer promotes next episode.

We adopt **neither the RL training nor `R_solve`** — weights are frozen. This is
honest and AGI-pure, but it is the *role* of SGS, not its learning dynamics.

## 3. Why faithful RL training is a separate effort (the honest blockers)

1. **Doctrine conflict.** `rules/bench-agi-purity.md` and the frozen-harness rule
   forbid training the actor: the whole bench measures the *brain's* runtime
   learning against a frozen model. Faithful SGS *is* actor training. Shipping it
   would require an explicit, documented carve-out from the AGI-purity doctrine
   (a new bench arm, e.g. `terransoul-brain-rl`, clearly labelled "trained", kept
   separate from the AGI-pure arm so the two results are never conflated).
2. **Compute.** RL-fine-tuning a 12 B model needs the model in *training* mode
   (optimizer + activation memory ≫ inference), plus k=8 rollouts × a large
   problem batch × ~200 rounds (the paper used 6 B+ tokens / ~230 epochs). This is
   **not feasible on the current single-PC GPU** — it would OOM / freeze the
   machine (the exact failure the user already hit with inference-only benches).
   It needs a rented multi-GPU box or a much smaller base model.
3. **Verifier.** SGS's reward is a *Lean4 compiler* (binary, cheap, exact). Zork
   has no such verifier — the only signal is the game score, which is sparse and
   not per-sub-goal. A faithful port needs a synthetic-task verifier we do not have.
4. **Testability.** Per project rules, no placeholder/non-functional code. A real
   training loop cannot be unit-proven sub-10s; it can only be validated by an
   actual (multi-day, multi-GPU) training run. So it cannot land as a normal,
   test-gated chunk.

## 4. The gradient-free approximation we CAN land now (AGI-pure)

Bring the curriculum closer to SGS's `R_synth = R_solve · R_guide` **without any
weight update**, using the agent's *own* outcome signal as a k-rollout-free
`R_solve` estimate:

- **ZORK-3 (observability-first, no behaviour change):** log an estimated
  `R_solve` alongside the existing `R_guide` at the Conjecturer gate, derived from
  the agent's own episode score-delta vs. the persistent frontier and the cached
  skill success-rate. Surfaces the signal before changing any gate.
- **ZORK-4 (gated on a bench A/B):** combine the estimate into the admission gate
  (`R_combined = R_solve_est · R_guide`), mapping to intermediate-difficulty
  preference (favour sub-goals that are neither already-solved nor never-reachable).
  AGI-pure **iff** the estimate is sourced only from the agent's own cached
  success-rate / score-delta — never a curated difficulty table or game seed
  (gate with the AGI-purity grep before commit). Unit-prove the estimator with a
  sub-10s repro snippet first (Principle 8).

This is the faithful-as-the-frozen-harness-allows path. It is the recommended
next step; the full RL version (§1) is a deliberate, separately-resourced project.

## 5. Decision points for the user

- **A — gradient-free only (recommended):** land ZORK-3 then (bench-gated) ZORK-4.
  Stays AGI-pure, runs on this hardware, test-gated.
- **B — faithful RL, separate arm:** provision a multi-GPU box (or a smaller base
  model), build the verifier + training loop, add a clearly-labelled `*-rl` bench
  arm with an explicit AGI-purity carve-out. Multi-day effort; not single-PC.
- **C — both:** A now, B scheduled when GPU infra is available.

Until B is resourced, A is the only honest way to "move toward faithful SGS"
tonight without freezing the machine or shipping untestable code.
