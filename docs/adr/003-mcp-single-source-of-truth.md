# ADR 003 — MCP as the single source of truth for all memory CRUD

**Status:** Accepted  
**Date:** 2025  
**Rule:** [`rules/mcp-single-source-of-truth.md`](../../rules/mcp-single-source-of-truth.md)

---

## Context

TerranSoul's brain/memory needs to be accessible from multiple runtime surfaces:
the desktop app, CLI benchmark runners, coding agents (Claude Code, GitHub Copilot,
Cursor, Codex), and Real-E2E test harnesses.

Each surface needs to read and write the **same** memory corpus without maintaining
private caches that drift apart.

## Decision

Use the **Model Context Protocol (MCP)** brain server as the single, authoritative
access point for all memory and knowledge CRUD.

- The server runs locally at `:7421` (release tray), `:7423` (MCP tray), or `:7422` (dev).
- Every agent — human-driven or autonomous — calls `brain_search`, `brain_ingest_lesson`,
  `brain_suggest_context` etc. through MCP, **never** through direct SQLite reads
  or private in-memory embedding caches.
- The `CLAUDE.md` preflight rule (`rules/agent-mcp-bootstrap.md`) makes MCP startup
  mandatory at the beginning of every AI coding session. Skipping is a violation.

## Why MCP over alternatives

| Alternative | Why rejected |
|-------------|-------------|
| Direct SQLite from agents | Schema changes break agents on every migration; each agent would need to re-implement hybrid search, decay, RRF — defeating the point |
| REST API (custom) | Doesn't compose with existing agent toolchains (Claude Code, Copilot); no standard schema for tool use; maintenance burden |
| Shared in-memory struct | Works only within a single process; benchmark runners and coding agents are separate processes |
| gRPC only | Good for Rust-to-Rust; poor for TypeScript/Python coding agents that need tool schemas |

MCP was chosen because:
1. Claude, Copilot, Codex, Gemini all speak it natively — tool schema is free.
2. Session resumption and streaming are built into the protocol.
3. The tool schema (JSON Schema) doubles as client-side validation, preventing malformed writes before they hit SQLite.

## The single-source rule in practice

The rule is enforced by code review + the `mcp-single-source-of-truth.md` rule:

- **Forbidden pattern:** any Python/TypeScript bench bridge that maintains its own
  SQLite connection to `memory.db`.
- **Forbidden pattern:** any LLM agent that caches retrieval results in a local dict
  across turns without writing them back to MCP.
- **Permitted:** `AppStateGateway` in `src-tauri/src/ai_integrations/gateway.rs` —
  this is the *owner* of the memory, not a cache.

When MCP cannot start (ECONNREFUSED on all three ports), the coding session records
the blocker explicitly and waits. It does not silently fall back to direct DB access.

## Consequences

**Good:**
- Any agent that speaks MCP immediately gets the full 6-signal hybrid search,
  decay, and KG traversal without re-implementing anything.
- `brain_search` results seen by an AI coding agent are identical to what the
  desktop chat sees — no divergence between "what the app knows" and "what the
  agent knows."
- Logging and telemetry at the MCP layer captures every tool call across all clients.

**Trade-offs:**
- MCP startup requires the Rust binary to be built and running (≈ 2–4 s on a warm build).
  CI runners skip it (`GITHUB_ACTIONS=true`) to save build time.
- If the MCP server crashes mid-session, any in-flight tool call fails. The bootstrap
  rule requires the agent to detect the failure, restart the tray, and retry — not
  silently proceed.

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — what MCP exposes
- [ADR 004](004-brain-driven-self-improvement.md) — doctrine that makes MCP mandatory
