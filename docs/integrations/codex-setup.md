# Codex CLI — TerranSoul Integration Guide

> **Date:** 2026-05-26
> **Status:** Fully implemented. Auto-setup via UI and Tauri commands.

OpenAI's [Codex CLI](https://github.com/openai/codex) is a terminal-based
coding agent that supports MCP servers for external tool access. TerranSoul
provides first-class Codex integration so the agent shares the same
persistent memory, semantic search, knowledge graph, and code intelligence
as every other supported agent.

---

## Prerequisites

| Requirement | How to get it |
|---|---|
| **Codex CLI** | `npm i -g @openai/codex` (requires Node.js 18+) |
| **TerranSoul MCP server** | Running on any port (release `:7421`, tray `:7423`, or dev `:7422`) |
| **OpenAI API key** | Set `OPENAI_API_KEY` in your environment for Codex itself |

---

## Quick Start (Auto-Setup)

### From TerranSoul UI

1. Open TerranSoul → Brain panel → Integrations tab.
2. Click **Codex CLI** → Enable.
3. TerranSoul writes `~/.codex/config.json` with the correct URL and token.
4. Done — Codex will use TerranSoul's brain on next invocation.

### From Terminal (Tauri command)

```bash
# If you have the dev console open:
invoke setup_codex_mcp
```

---

## Manual Setup

### HTTP Transport (Recommended)

Add to `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "terransoul-brain": {
      "url": "http://127.0.0.1:7423/mcp",
      "token": "<contents of mcp-data/mcp-token.txt>"
    }
  }
}
```

### Stdio Transport (No HTTP Server Needed)

```json
{
  "mcpServers": {
    "terransoul-brain": {
      "command": "/path/to/terransoul",
      "args": ["--mcp-stdio"]
    }
  }
}
```

The stdio transport spawns the TerranSoul binary directly — no network
port needed. Useful for isolated environments or CI.

---

## AGENTS.md Integration

TerranSoul ships an `AGENTS.md` at the project root. Codex CLI reads
this file automatically on session start. It contains:

- MCP preflight instructions (health check + brain search before work)
- Session resumption protocol
- Architecture overview for context

No additional configuration is needed — Codex will follow the
instructions in `AGENTS.md` and use the MCP tools naturally.

---

## Available Tools

Once connected, Codex has access to **46 MCP tools** across 4 categories:

| Category | Tools | Examples |
|---|---|---|
| **Brain** (22) | Memory search, ingest, summarize, knowledge graph | `brain_search`, `brain_ingest_lesson`, `brain_kg_neighbors` |
| **Repo** (5) | File listing, reading, search, signatures | `repo_map`, `repo_read_file`, `repo_search` |
| **Code** (18) | Cross-repo query, contracts, drift, impact | `code_query`, `code_extract_contracts`, `code_impact` |
| **Cross-source** (1) | Unified search across brain + code | `cross_source_search` |

---

## Verifying the Connection

```bash
# Start TerranSoul MCP (if not running)
npm run mcp

# In another terminal, test with Codex
codex "Use brain_health to check the TerranSoul MCP connection"
```

Expected: Codex calls `brain_health` and reports the server status.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `~/.codex/config.json` not found | Run `mkdir -p ~/.codex && echo '{}' > ~/.codex/config.json` first |
| Token rejected | Re-read token from `mcp-data/mcp-token.txt` (regenerated on each MCP start) |
| Codex not using brain tools | Ensure `AGENTS.md` is in the project root; Codex reads it on startup |
| Connection refused on :7423 | Start the MCP server: `npm run mcp` or launch TerranSoul desktop |
| Stdio mode hangs | Verify the `terransoul` binary path is absolute and the binary exists |

---

## Removing the Integration

```bash
# Auto-remove via Tauri command
invoke remove_codex_mcp

# Or manually delete the terransoul-brain entry from ~/.codex/config.json
```

---

## See Also

- [MCP for Coding Agents](../../tutorials/mcp-coding-agents-tutorial.md) — Full tutorial with all agents
- [Hermes Setup](hermes-setup.md) — Hermes Agent integration
- [AI Coding Integrations](../AI-coding-integrations.md) — Architecture overview
