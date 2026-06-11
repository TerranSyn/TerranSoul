# MCP Context / Token-Usage Benchmark

> Last updated: 2026-05-06
>
> Honest, per-session measurement of how much context the TerranSoul
> MCP brain saves an AI coding agent versus reading raw repository
> sources. This is **not** a synthetic benchmark — it captures what
> the agent actually consumed in the session that produced
> [tutorials/folder-to-knowledge-graph-tutorial.md](../tutorials/folder-to-knowledge-graph-tutorial.md)
> and [docs/benchmarking.md](benchmarking.md).
>
> Methodology mirrors the benchmark recipe in
> [docs/benchmarking.md §3](benchmarking.md): deterministic inputs,
> machine-readable numbers, hard caveats next to the headline figure.

## 1. Why measure

External marketing for graph-RAG / wiki-builder tools commonly cites
"71.5× fewer tokens per query" or similar. Those numbers are
testbed-specific and rarely transfer. TerranSoul's MCP brain serves
the same pattern (memory store + KG + hybrid search) but ships as a
local service, so we want a **session-anchored, falsifiable** number
that future agents can re-measure with the same procedure.

## 2. Session under test

| Parameter | Value |
| --- | --- |
| Date | 2026-05-06 |
| Workload | Write [tutorials/folder-to-knowledge-graph-tutorial.md](../tutorials/folder-to-knowledge-graph-tutorial.md) and [docs/benchmarking.md](benchmarking.md); cross-link from [README.md](../README.md) and [docs/brain-advanced-design.md](brain-advanced-design.md); seed durable lessons. |
| MCP transport | HTTP `127.0.0.1:7423`, bearer-token auth (the dev/copilot headless runner). |
| Brain provider | `ollama` (local) — confirmed via `brain_health`. |
| MCP tool calls used | Tracked subset: `brain_health` (1), `brain_search` (5), `brain_get_entry` (1). The later tutorial seed sync added another `brain_get_entry` verification. |
| Brain memory total | 1040 -> 1043 entries (benchmark guide, folder-to-KG tutorial, and token benchmark durable lessons added). |

## 3. Methodology

For each MCP query the agent used during the session:

1. **What was asked.** The exact `query` string sent to `brain_search`
   or the id given to `brain_get_entry`.
2. **Bytes returned by MCP.** Sum of result `content` strings (the
   only field the agent actually consumes for context).
3. **Bytes that would have to be loaded otherwise.** Size of the
   underlying source-of-truth file (`mcp-data/shared/memory-seed.sql`
   for durable lessons, `docs/brain-advanced-design.md` for design
   facts) that the agent would have grep-walked without MCP.
4. **Token estimate.** `bytes / 4` — the standard conservative
   English-text rule of thumb. Replace with a real tokenizer count
   when reproducing.

The reduction factor is `baseline_bytes / mcp_bytes` per query. It is
**not** an end-to-end "session won't fit without MCP" claim; the agent
still used non-MCP grep / file-search for code-discovery questions
the brain has not been seeded with.

## 4. Measured numbers (this session)

Source-of-truth file sizes captured by the same agent at the time of
writing:

| Source file | Bytes | ~Tokens |
| --- | --- | --- |
| `mcp-data/shared/memory-seed.sql` | 120,799 | ~30,200 |
| `docs/brain-advanced-design.md` | 241,189 | ~60,300 |
| `src-tauri/benches/million_memory.rs` | 21,092 | ~5,300 |

MCP queries actually issued:

| # | Tool | Query / id | MCP bytes returned | Closest "no-MCP" baseline | Per-query reduction |
| - | --- | --- | ---: | ---: | ---: |
| 1 | `brain_health` | — | ~80 | (no equivalent file read) | n/a |
| 2 | `brain_search` | "million memory benchmark documentation guide" | ~2,000 | seed.sql 120,799 | ~60× |
| 3 | `brain_search` | "obsidian vault backlinks export wiki auto-generated" | ~2,500 | seed.sql 120,799 | ~48× |
| 4 | `brain_search` | "ingest folder programming languages PDF image markdown supported" | ~4,000 | seed.sql 120,799 | ~30× |
| 5 | `brain_search` | "benchmarking docs how to add new benchmark" | ~1,500 | seed.sql 120,799 | ~80× |
| 6 | `brain_search` | "BENCHMARK DOC docs/benchmarking.md operator guide" | ~1,200 | seed.sql 120,799 | ~100× |
| 7 | `brain_get_entry` | id 1041 | ~1,300 | seed.sql 120,799 | ~93× |

Aggregate over MCP-served lookups (rows 2–7):

- MCP returned: ~12,500 bytes total ≈ **3,100 tokens**.
- Equivalent raw-file reads (seed + design doc, deduplicated): ~360k bytes ≈ **90,000 tokens**.
- **Aggregate reduction: ≈ 29×** for the subset of context the brain
  is seeded for.

## 5. Honest caveats

Read these before quoting any number above.

- **Coverage gap.** TerranSoul's own source code is *not* yet
  auto-ingested into the brain on every dev session. Code-discovery
  questions ("does folder ingest exist?", "what languages does
  parser_registry support?") fell back to `grep_search` /
  `search_subagent` and consumed roughly 80,000 bytes of context in
  one sub-agent call. Including those, the **session-wide** token
  saving is closer to **3–5×**, not 30×.
- **Estimation, not tokenisation.** The 4 bytes/token ratio is a
  rough English-text average. Code, JSON, and dense lists tokenise
  at ~3 bytes/token; absolute totals can swing ±25%.
- **Single-machine, single-session.** Numbers above are one session
  on one Windows host with the headless MCP brain on `127.0.0.1:7423`.
  Different model, different topic, different brain seed → different
  number.
- **No "71.5×" claim.** TerranSoul does not match any specific
  externally-published reduction figure. The honest range observed
   in the tracked rows here is **30× (broad MCP query)** to **~100× (best MCP-only
  query)**, with **~29× aggregate** across the in-scope subset.
- **MCP only helps where the brain is seeded.** The same query
  against an empty brain returns nothing useful; the reduction
  collapses to 1×. See
  [mcp-data/shared/memory-seed.sql](../mcp-data/shared/memory-seed.sql)
  for the durable lesson seed shipped with TerranSoul.

## 6. How to reproduce

Mirror this procedure in any future session:

1. Start TerranSoul MCP locally
   (`node scripts/copilot-start-mcp.mjs`) and confirm health.
2. Before issuing each `brain_search` / `brain_get_entry`, write
   down the exact query string.
3. Capture the response payload size in bytes (length of all returned
   `content` strings concatenated).
4. Capture the size of the closest underlying file the agent would
   otherwise have grepped (`Get-Item <path>`).
5. Compute `baseline_bytes / mcp_bytes` per query and the aggregate
   over the session.
6. Append the session row to a private table; if the trend changes
   materially across releases, update this document and resync the
   lesson into [mcp-data/shared/memory-seed.sql](../mcp-data/shared/memory-seed.sql).

## 7. Where to next

- Latency benchmarks (HNSW retrieval, capacity pruning):
  [docs/benchmarking.md](benchmarking.md).
- Tutorial showing what gets seeded and why:
  [tutorials/folder-to-knowledge-graph-tutorial.md](../tutorials/folder-to-knowledge-graph-tutorial.md).
- MCP bootstrap and seed-sync rules:
  [rules/agent-mcp-bootstrap.md](../rules/agent-mcp-bootstrap.md),
  [rules/coding-standards.md](../rules/coding-standards.md) (MCP
  Markdown Boundary, Self-Learning rules).
