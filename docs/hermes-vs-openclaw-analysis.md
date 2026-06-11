# Hermes Agent vs. OpenClaw — Comparison & TerranSoul Adoption Plan

**Date:** 2026-05-11
**Subjects:**
- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT, Python, ~143k stars at study time)
- [openclaw/openclaw](https://github.com/openclaw/openclaw) (MIT, TypeScript, ~371k stars at study time)

> Studied public READMEs, `cli-config.yaml.example`, and DeepWiki summaries
> only. No source code, prompts, asset names, or branded identity copied.
> All adoption proposals below are mapped onto neutral TerranSoul modules.

## Why this comparison exists

OpenClaw is the most widely-watched open Claude-Code-style agent UX, and
TerranSoul already learned session-management patterns from it (see
[CREDITS.md](../CREDITS.md)). Hermes Agent is a newer NousResearch
project that explicitly ships with MCP support, AGENTS.md conventions,
FTS5 session search, subagent delegation, and a built-in learning loop —
several of which align directly with TerranSoul's roadmap. This doc
captures what Hermes does that OpenClaw does not, what TerranSoul
already covers, and what is worth adopting.

## What Hermes wins over OpenClaw

| # | Hermes capability | OpenClaw status | TerranSoul gap? |
|---|---|---|---|
| 1 | Native MCP `mcp_servers:` block with HTTP + stdio transports | Manual / external | **No** — TerranSoul ships first-class MCP since Phase 15 |
| 2 | AGENTS.md auto-load convention | Project-specific | **No** — already in `AGENTS.md` (Multi-Agent Instruction Sync rule) |
| 3 | YAML `cli-config.yaml` with structured sections | JSON-only | Adopted only as a *consumer* (we now write Hermes config) |
| 4 | Built-in learning loop (self-improve from session traces) | Not surfaced | **Validates** existing self-improve engine (Chunk 25 / Phase 25) |
| 5 | Honcho dialectic user modeling | Not surfaced | Backlog candidate — see persona drift detector (`persona/`) |
| 6 | FTS5 session search | Linear scroll | **Validates** Chunk 48.5 (FTS5 session search) |
| 7 | Subagent delegation RPC | Single-agent | Already in agent roster + orchestrator; backlog: explicit delegation handoff |
| 8 | Cron-style scheduled jobs | None | Backlog candidate — see `coding/scheduler` design |
| 9 | Trajectory compression | None | **Already in flight** — Chunk 47.4 |
| 10 | Tool-loop guardrails (max iterations, budget caps) | Loose | Already enforced in `coding::engine` |
| 11 | First-class `mcp_servers:` config schema | N/A | We now write to it directly via `write_hermes_config` |
| 12 | Connect/request timeouts per MCP server | N/A | Implemented in our YAML block (`timeout: 120`, `connect_timeout: 60`) |
| 13 | Marker-managed config blocks (their docs imply manual editing) | N/A | TerranSoul **goes further**: marker-comment upsert preserves user content verbatim |

## Decisions

**Apply now (this PR):**
1. ✅ MCP auto-setup writer for Hermes Agent (`write_hermes_config` + stdio variant)
2. ✅ Tauri commands (`setup_hermes_mcp`, `setup_hermes_mcp_stdio`, `remove_hermes_mcp`)
3. ✅ Pinia store + view union types include `'hermes'`
4. ✅ `check_all_clients` reports Hermes status (marker-based YAML check)
5. ✅ CREDITS.md attribution
6. ✅ Durable lesson sync to `mcp-data/shared/memory-seed.sql`

**Already covered by existing chunks (no new work):**
- FTS5 session search → Chunk 48.5 (validates the design)
- Trajectory compression → Chunk 47.4
- Tool-loop guardrails → `coding::engine`
- Self-improve loop → Phase 25

**Backlog candidates (defer):**
- Cron-style scheduled jobs (would extend `coding/scheduler`)
- Honcho-style dialectic user modeling (would extend `persona/`)
- Explicit subagent delegation RPC (would extend `orchestrator::Router`)

**Rejected:**
- Adopting YAML as TerranSoul's config format. We remain JSON-first; YAML
  is only handled as an *output* target for Hermes (and any future
  YAML-only consumer).

## Implementation notes

### YAML-safe writer strategy

Hermes uses YAML, which has no comment-preservation guarantees in any
common Rust YAML parser (`serde_yaml`, `yaml-rust`). To avoid clobbering
user-edited comments and customizations, `write_hermes_config` does
**not** parse YAML. Instead it:

1. Wraps the TerranSoul block in unique marker comments:
   - `# >>> TerranSoul MCP auto-config (managed; do not edit between markers) >>>`
   - `# <<< TerranSoul MCP auto-config <<<`
2. On re-run, finds the markers and replaces the block in place.
3. If markers are missing, appends to the end of the file with a leading
   blank line.
4. Detects user-owned top-level `mcp_servers:` keys outside the markers
   and surfaces a warning (YAML disallows duplicate top-level keys).

This avoids a YAML parser dependency entirely and gives the user full
control over the rest of their `cli-config.yaml`.

### Config path resolution

- **Native Windows:** `%LOCALAPPDATA%\hermes\cli-config.yaml` (per
  Hermes README) when that directory already exists.
- **WSL2 / Linux / macOS:** `~/.hermes/cli-config.yaml`.

The setup orchestrator only writes if the parent directory already
exists, to avoid creating user state for a tool the user hasn't
installed.

## License & attribution

- **Hermes:** MIT — credit in [CREDITS.md](../CREDITS.md). No source copied.
- **OpenClaw:** existing CREDITS entry retained.

## References

- Hermes README and `cli-config.yaml.example` (commit at study time)
- OpenClaw README and DeepWiki pages
- TerranSoul: [auto_setup.rs](../src-tauri/src/ai_integrations/mcp/auto_setup.rs), [commands/auto_setup.rs](../src-tauri/src/commands/auto_setup.rs), [stores/ai-integrations.ts](../src/stores/ai-integrations.ts)
