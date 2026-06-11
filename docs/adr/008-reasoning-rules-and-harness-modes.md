# ADR 008 — Reasoning rules contract and harness modes

**Status:** Accepted  
**Date:** 2026  
**Rule:** [`rules/harness-reasoning-engineering.md`](../../rules/harness-reasoning-engineering.md)  
**Source:** `src-tauri/src/reasoning/`, `src/stores/reasoning-rules.ts`

---

## Context

An LLM follows the path of least resistance. Without explicit prompting, it:
- Takes the first plausible answer rather than the simplest correct one.
- Avoids saying "I don't know" when hallucinating is easier.
- Doesn't distinguish between a goal and a sub-task.

Most apps paper over this by writing longer, more specific system prompts.
TerranSoul makes the *discipline stack* configurable, observable, and stored
in the brain.

## Decision

### 1. Reasoning rules contract

A user-configurable stack of **12 builtin disciplines** is serialised into
every LLM system prompt. Each rule is stored in `reasoning_rules` SQLite table
and can be toggled, reordered, or supplemented via the Brain hub UI.

**Bundled disciplines (Karpathy-core + TerranSoul extensions):**

| Rule | What it enforces |
|------|-----------------|
| Think | Always reason before concluding |
| Simplify | Prefer the simplest solution that satisfies the constraints |
| Surgical | Change only what is necessary; do not refactor opportunistically |
| Goal-driven | Keep the user's actual goal in focus, not the stated sub-task |
| Judgment | Apply quality standards; don't pass low-confidence answers without flagging |
| Budgets | Respect token/time/compute budgets |
| Conflicts | Surface contradictions rather than silently resolving them |
| Reading | Read the source before explaining it |
| Tests | Propose a test before claiming something works |
| Checkpoints | Break long tasks into verifiable checkpoints |
| Conventions | Follow the project's code style, not the LLM's defaults |
| Fail-loud | Prefer an honest "I can't do this" over a plausible wrong answer |

All rules are **visible to the user** in the reasoning panel — the user can see
which disciplines the model is being asked to follow on every turn.

### 2. Harness modes (task-type overlays)

Five named reasoning harnesses inject a system-prompt addendum that restructures
the LLM's thinking phase for a specific task type:

| Harness | Pattern | Best for |
|---------|---------|----------|
| `Off` | Default chat | Casual conversation |
| `ReAct` | Thought → Action → Observation loop | Tool-using tasks |
| `DeepResearch` | Hypothesis → Evidence → Contradiction sweep → Conclusion | Research questions requiring citations |
| `CodeAct` | Intent → Plan → `<code>` block → Verify | Coding tasks |
| `Digest` | Chunk → Extract → Summarise | Long document ingestion |

Harness mode is set per-session via `AppSettings.harness_mode`.

## Why configurable rules instead of a fixed system prompt

1. **Different users need different disciplines.** A power user doing code review
   wants `Surgical` and `Tests`; a creative writing session wants neither.
2. **Observable = auditable.** When the LLM violates a discipline, the user sees
   which rule was active and can diagnose whether the rule needs strengthening.
3. **Brain-stored, not hardcoded.** Rules are SQLite rows. New rules or tuned
   versions of existing ones are `INSERT` statements, not deploys.

## Why harness modes instead of role prompts

Role prompts ("you are a senior engineer") add vague persona but don't
structure the *reasoning loop*. ReAct forces explicit Thought/Action/Observation
turns, making the LLM's decision chain transparent and interruptible.
This is a documented quality lift on tool-using benchmarks.

## Consequences

**Good:**
- The system prompt is deterministic given a settings snapshot — reproducible
  behaviour across model restarts.
- Users can tune the discipline stack without touching source code.
- The reasoning panel in the UI surfaces every thought step, making the LLM's
  decision chain visible.

**Trade-offs:**
- 12-rule stack adds ≈ 400–600 tokens to every system prompt — a fixed overhead.
  Mitigated by the query-intent gate (ADR 002) that skips harness injection on
  trivial turns.

## Related ADRs

- [ADR 004](004-brain-driven-self-improvement.md) — doctrine that makes rules configurable, not hardcoded
- [ADR 002](002-hybrid-rag-pipeline.md) — intent gate that decides when harness injection fires
