# ADR 004 — Brain-driven self-improvement doctrine

**Status:** Accepted  
**Date:** 2025–2026  
**Rules:** [`rules/brain-driven-self-improvement.md`](../../rules/brain-driven-self-improvement.md),  
[`rules/agent-self-learning-doctrine.md`](../../rules/agent-self-learning-doctrine.md),  
[`rules/harness-reasoning-engineering.md`](../../rules/harness-reasoning-engineering.md)

---

## Context

Most AI companion and coding-agent projects hardcode their decision logic in
Python/TypeScript `if` statements: "if the user mentions X, do Y". This is
fragile, domain-specific, and cannot improve without a code change.

TerranSoul's founding principle is that decisions should **live in the brain**
and improve through use, not in source code.

## Decision

Four mandatory principles (enforced by code review, not convention):

### Principle 1 — Every turn writes to + reads from MCP

Every chat turn, every agent action, every tool call:
- **Reads** context via `brain_search` / `brain_suggest_context` before deciding.
- **Writes** the outcome (lesson, observation, reflection) back via `brain_ingest_lesson`.

No turn is allowed to make decisions purely from pre-baked source code logic
without checking what the brain knows first.

### Principle 2 — Reason against your own LLM ceiling

When the model gives a wrong or weak answer, the fix belongs in the
**brain / context layer**, not in model weights. The brain compensates for what
a weak model can't compute alone. The Zork benchmark proves this:
`gemma4:e4b` (a 4B parameter model) deterministically achieves 350/350 turns
when served one successful walkthrough via the brain — impossible without it.

"The model is too small" is the **last hypothesis**, not the first.

### Principle 3 — No hardcoded decisions in source

Verb lists, room names, domain mechanics, scoring heuristics, priority weights —
none of these belong in source code. They belong in brain SQL or MCP seed data.

Forbidden pattern: `if message.contains("go north") { ... }`  
Correct pattern: brain stores `action:navigation` examples; the RAG pipeline
surfaces them; the LLM generalises.

### Principle 4 — No hardcoded domain logic

Planners, routers, and classifiers must be **generic** — they should work on
any domain, not just the current benchmark. A planner for interactive fiction
must also work for coding, form-filling, and calendar management.

This is enforced by the `bench-agi-purity.md` grep gate that rejects any
hint file, curated vocab list, or domain-specific seed in MCP/brain.

---

## Extensions (principles 5–8)

**Principle 5 — Audit brain-advanced-design.md every session.**  
Scan for: contradicting lessons, in-code shortcuts that bypass the brain,
schema fields without justification, model-capacity walls.

**Principle 7 — Investigate before blaming model size.**  
When the LLM ignores a brain directive, fix at the critic/sampler/prompt layer.
"Model too small" is the last hypothesis. Always reproduce the failure in a
< 10-second snippet before diagnosing.

**Principle 8 — Reproduce first.**  
Build a sub-10-second reproducible snippet that confirms the bug before re-running
the full 100-turn Zork episode. Promote the snippet to a regression test.

---

## Why this is unusual

Most projects improve by modifying source code. TerranSoul improves by:
1. Writing a lesson to `brain_ingest_lesson` (≤ 2 LLM calls)
2. Verifying the next benchmark iter retrieves and uses the lesson
3. Never touching source until the brain can't compensate alone

The Zork benchmark makes this measurable: any regression in ADR 004 compliance
shows up as a score drop, not just as a philosophy violation.

## Consequences

**Good:**
- The system is genuinely self-improving across sessions — weak models get stronger
  through accumulated brain context, not weight updates.
- Domain-specific logic lives in SQL rows, not source code. Adding support for
  a new game / workflow / language requires brain edits, not deploys.

**Trade-offs:**
- Requires discipline: every new feature must be reviewed for hardcoded decisions.
  The `bench-agi-purity.md` grep gate catches the most obvious violations, but
  the principle applies throughout.
- The brain bootstrap is heavier than a simple `if` statement. An agent that follows
  Principle 1 makes more LLM calls per turn — mitigated by the query-intent gate
  in ADR 002 that skips RAG on trivial turns.

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — the brain this doctrine uses
- [ADR 002](002-hybrid-rag-pipeline.md) — the retrieval pipeline that serves decisions
- [ADR 003](003-mcp-single-source-of-truth.md) — MCP as the write target
