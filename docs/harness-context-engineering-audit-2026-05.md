# Harness and Context Engineering Audit (through 2026-05)

Date: 2026-05-10
Scope: TerranSoul coding harness, context engineering pipeline, and external references through 2026-05.

## Executive Summary

TerranSoul already has strong harness foundations:
- deterministic coding workflow runner
- milestone-driven autonomous loop with DAG gates
- MCP-native memory and code-intelligence surface
- session replay and resumable handoff state
- runtime hooks for tool offload and summarization

The highest-impact short-term improvement was to make context-budget assembly mandatory in the shared coding task path, so every task now applies context compression rules consistently.

## Sources Audited

## TerranSoul internal sources
- rules and workflow docs: rules/prompting-rules.md, rules/coding-workflow-reliability.md, docs/coding-workflow-design.md
- core harness modules: src-tauri/src/coding/workflow.rs, src-tauri/src/coding/engine.rs, src-tauri/src/coding/dag_runner.rs
- context modules: src-tauri/src/coding/context_budget.rs, src-tauri/src/coding/context_engineering.rs, src-tauri/src/coding/summarization_hook.rs
- session continuity: src-tauri/src/coding/session_chat.rs, src-tauri/src/coding/session_replay.rs
- MCP integration: src-tauri/src/ai_integrations/mcp/mod.rs, src-tauri/src/ai_integrations/mcp/tools.rs

## External references (up to 2026-05)
- OpenAI Harness Engineering article (2026-02)
- Anthropic Building Effective Agents
- OpenAI Agents SDK docs
- LangChain/LangSmith deployment docs
- hoangnb24/harness-experimental

## What "Harness Engineering" Means in TerranSoul

For TerranSoul, harness engineering is the set of repo-level mechanisms that make agent work:
- safe (gates, policy, and scoped tool surfaces)
- legible (structured docs and stable entry points)
- recoverable (session replay, handoff seeds, durable logs)
- continuously improvable (lessons persisted back into MCP memory)

## What "Context Engineering" Means in TerranSoul

For TerranSoul, context engineering is the process of shaping what enters model context:
- selecting source documents by policy
- fitting to token budget by section priority
- preserving critical context (errors, active plan, handoff)
- compressing stale context via summaries and exclude flags
- reseeding usage counters across resumed sessions

## Capability Mapping

### Already implemented strongly
- structured prompt contract and output-shape extraction
- context section prioritization model
- rolling summarization hook with resume token seeding
- durable session transcript and orphan repair
- MCP knowledge retrieval before broad exploration

### Gaps and friction points identified
- budget assembly was not enforced in the main run_coding_task path
- no dedicated public-facing README section for harness/context model
- no single audit doc tying external patterns to TerranSoul modules

## Improvement Applied in This Audit

### 1) Enforced budget-aware context assembly in shared workflow
- File: src-tauri/src/coding/workflow.rs
- Change: run_coding_task now invokes auto_budget_assembly with BudgetConfig::default before prompt.build.
- Effect: all coding tasks consistently apply context-fit rules instead of relying on per-caller behavior.

### 2) Added explicit README positioning
- TerranSoul now clearly states that its 3D assistant and coding system are built on harness + context engineering principles.

### 3) Added this audit document
- This file provides a stable, versioned source of truth for strategy through 2026-05.

## Recommended Next Improvements

1. Add lane-based feature intake for coding tasks
- Add a small pre-execution classifier that tags work as tiny, normal, high-risk.
- Route high-risk tasks to stricter gate requirements and explicit human confirmation.

2. Add evaluator-optimizer gate for risky patches
- Add an optional review-refine loop after test failures or policy violations.
- Keep bounded attempts and persist concise repair rationale in session metadata.

3. Add harness freshness checks in CI
- Validate that key docs (README claims, workflow docs, and MCP tool list) are cross-consistent.
- Fail fast when declared features diverge from actual tool/module exports.

## Practical Outcome

TerranSoul now has:
- stronger shared context assembly behavior in its coding harness
- clearer product-level articulation that the assistant is built on harness and context engineering
- a current (2026-05) external+internal audit baseline for future iterations
