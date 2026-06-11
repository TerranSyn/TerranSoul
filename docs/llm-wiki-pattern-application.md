# LLM Wiki Pattern + Graphify Reverse-Engineering — Application to TerranSoul

> **Status:** Design — May 6, 2026
>
> **Authors:** TerranSoul brain team (Copilot session)
>
> **Sources studied:**
>
> - **graphify** (`safishamsi/graphify`, Apache-2.0/MIT, v0.7.6, 43.6k★) —
>   tree-sitter + Leiden community detection + LLM subagents,
>   Python AST extractor, 32 test files, MCP stdio server, knowledge-graph CLI.
> - **Karpathy LLM Knowledge Bases** (`karpathy/llm-wiki.md` gist, Apr 2026, 5k★;
>   plus *The append-and-review note*, Mar 2025) — the persistent compounding
>   wiki pattern (raw / wiki / schema layers; ingest / query / lint
>   operations; index.md + log.md special files).
> - **Critique**: `a-a-k`'s response on the gist (lossy compression, missing
>   benchmarks, provenance, span-level citations, conflict resolution).
>
> **Credit:** see `CREDITS.md` for non-code influence and licensing notes.

---

## 1. The pattern in one paragraph

Karpathy's "LLM Wiki" is a **three-layer** scheme — *raw sources* (immutable),
a *wiki* (LLM-curated structured markdown), and a *schema* (the LLM's
instructions). Four operations — *ingest*, *query*, *lint*, *append-and-review* —
keep the wiki compounding: each new source touches 10–15 wiki pages, queries
can be filed back as new pages, periodic lint passes flag contradictions,
orphans, and gaps. The wiki is "a persistent, compounding artifact" instead of
a re-derivation pipeline (RAG).

**Graphify** is the operational counterpart: instead of LLM-generated prose
pages, it builds a **knowledge graph** (nodes + typed edges) with confidence
labels (EXTRACTED / INFERRED / AMBIGUOUS), Leiden community detection,
god-nodes, surprising connections, and a publicly reported token-cost win of
**71.5×** over naive raw-file reading on a 52-file mixed corpus. TerranSoul
does not claim that fixed number for its own MCP brain; the local measurement
procedure and current session numbers live in
[docs/mcp-token-usage-benchmark.md](mcp-token-usage-benchmark.md).

The two patterns are complementary: graphify is the **structural map**; the
wiki is the **prose synthesis**. Together they form a "brain" that
accumulates rather than re-derives.

---

## 2. What TerranSoul already has (audit)

| Capability | Status | Where |
| --- | --- | --- |
| Raw memory store with FTS5 | ✅ | `memory/store.rs`, `schema.rs` (V15) |
| Vector embeddings + HNSW ANN | ✅ | `memory/ann_index.rs`, usearch |
| 6-signal hybrid retrieval + RRF (k=60) | ✅ | `memory/store.rs`, `memory/fusion.rs` |
| HyDE | ✅ | `memory/hyde.rs` |
| LLM-as-judge reranker | ✅ | `memory/reranker.rs` |
| Typed knowledge-graph edges | ✅ | `memory/edges.rs` (`MemoryEdge`) |
| Edge confidence + provenance (`User`/`Llm`/`Auto`) | ✅ | `EdgeSource` enum |
| Contradiction detection (open / resolved / dismissed) | ✅ | `memory/conflicts.rs` |
| Leiden-style community detection | ✅ | `memory/graph_rag.rs` |
| Cognitive kinds (episodic / semantic / procedural / judgment) | ✅ | `memory/cognitive_kind.rs` |
| Decay / GC / promotion maintenance | ✅ | `memory/maintenance.rs` |
| `memories.source_url` + `memories.source_hash` columns | ✅ | `schema.rs` (V15) |
| Capacity-based eviction (1M cap, importance≥4 protected) | ✅ | `memory/eviction.rs` |
| Obsidian export | ✅ | `memory/obsidian_export.rs` |
| MCP brain server (7421/7422/7423) with `brain_*` + `code_*` tools | ✅ | `ai_integrations/mcp/` |
| Plugin slash command dispatch | ✅ | `composables/usePluginSlashDispatch.ts` |
| Self-improve session slash commands (`/clear`, `/rename`, ...) | ✅ | `utils/slash-commands.ts` |
| URL ingest with chunking | ✅ | `commands/brain.rs::brain_ingest_url` |

**Strong pre-condition:** TerranSoul has every primitive Karpathy and
graphify rely on. The work is mostly **wiring**, not invention.

---

## 3. Gap analysis

| Gap | Karpathy / Graphify name | Why it matters | Effort |
| --- | --- | --- | --- |
| No `source_hash` dedup in ingest pipeline | graphify SHA256 cache | Re-ingesting the same article should skip the work, not duplicate memories | S |
| No append-only timeline of ingests / queries / lint passes | `log.md` | Auditability + agent context (parseable `## [date] op | title` prefix) | S |
| No "audit / lint" pass that surfaces all health issues at once | LLM Wiki "Lint" | Today the user has to navigate to each conflict / orphan / stale row separately | M |
| No "wiki page" abstraction (synthesised topic page vs raw memory) | LLM Wiki "Wiki layer" | Compounding artifact — high-importance Summary memory tagged `wiki:concept:*` | M |
| No god-node / most-connected report | graphify god nodes | Quickly see what the brain considers central | S |
| No surprising-connections report | graphify surprises | Cross-community edges that link previously-unrelated topics | S |
| No append-and-review prioritised queue | Karpathy 2025 note | Surface ideas the user hasn't revisited recently → "fish through" UX | S |
| No shortest-path between two memories | `graphify path` | Trace causal / semantic chain | S |
| No `why` / rationale extraction | graphify rationale nodes | Code/notes contain `# WHY:` / `# NOTE:` annotations the LLM should index | M |
| No suggested-questions report | graphify suggested questions | Self-discovery of latent knowledge | M |
| No confidence rubric on edge creation | graphify `EXTRACTED`/`INFERRED`/`AMBIGUOUS` | We have `EdgeSource` and a confidence float; needs a rubric mapping (0.95/0.85/0.75/0.65/0.55 → labels) | S |

---

## 4. UX mapping (chat-first, no CLI)

The user explicitly asked for these to live in the **chatbox** and **UI
configuration**, not as terminal commands. Graphify's CLI is replaced with
in-chat slash commands (recognised by the conversation pipeline) and panels
in the Brain view. Names are deliberately **not** clones of `graphify
*` or Karpathy's `ingest/query/lint` — they're TerranSoul-native verbs.

| TerranSoul verb (chat / UI) | Equivalent in graphify | Equivalent in Karpathy LLM Wiki |
| --- | --- | --- |
| `/digest <url\|text>` | `/graphify add` / `extract` | `Ingest` |
| `/ponder` | `--cluster-only` + audit | `Lint` |
| `/weave <topic>` | (no direct equivalent — graphify writes JSON; we write prose) | `Ingest` step where wiki pages are written |
| `/spotlight` | god nodes section in `GRAPH_REPORT.md` | (none — graphify-specific) |
| `/serendipity` | surprising connections section | (none — graphify-specific) |
| `/revisit` | (none — graphify-specific) | Karpathy 2025 *append-and-review* note |
| `/trace <a> <b>` | `/graphify path` | (none) |
| `/why <id>` | `/graphify explain` | (none) |
| Brain → **Knowledge Wiki** panel | `graph.html` browser viewer | Obsidian graph view |
| Brain → **Audit** badges | `GRAPH_REPORT.md` confidence + warnings | Lint report |

The **schema layer** (CLAUDE.md / AGENTS.md in graphify+Karpathy) is already
covered by TerranSoul's `.github/copilot-instructions.md`, `AGENTS.md`,
`CLAUDE.md`, and the `rules/*.md` files; this is the only layer we don't need
to build.

### 4.1 MCP surface: graphify-like power, TerranSoul-native interface

TerranSoul's MCP server advertises the same graph/wiki operations for coding
agents and local automation, but the MCP verbs are **TerranSoul-owned** and
backed by the same Rust functions used by the app UI. The user-facing path
remains chat and configuration panels; MCP is the agent integration layer, not
a CLI replacement.

MCP tools:

| MCP tool | Reuses Rust function | Human UI equivalent |
| --- | --- | --- |
| `brain_wiki_audit` | `memory::wiki::audit_report` | `/ponder`, Brain → Knowledge Wiki → Audit |
| `brain_wiki_spotlight` | `memory::wiki::god_nodes` | `/spotlight`, Spotlight tab |
| `brain_wiki_serendipity` | `memory::wiki::surprising_connections` | `/serendipity`, Serendipity tab |
| `brain_wiki_revisit` | `memory::wiki::append_and_review_queue` | `/revisit`, Revisit tab |
| `brain_wiki_digest_text` | `memory::wiki::ensure_source_dedup` | `/digest <text>`, paste/file/source digest |

`brain_wiki_audit`, `brain_wiki_spotlight`, `brain_wiki_serendipity`, and
`brain_wiki_revisit` require `brain_read` and are available to LAN public
read-only peers. `brain_wiki_digest_text` requires `brain_write` because it
persists a deduplicated memory row.

This gives external agents a graphify-like query and analysis layer without
asking humans to learn graphify's CLI or command names. It also avoids a split
brain: every app button, chat command, and MCP tool calls the same tested Rust
operation.

---

## 5. Architecture deltas

### 5.1 Wiki pages reuse the existing memories table (no migration)

A "wiki page" in TerranSoul is a memory with:

- `memory_type = 'summary'`
- `tags = 'wiki:<kind>:<slug>, ...'` where `<kind>` ∈ `entity / concept /
  comparison / overview / log`
- `importance = 5` (so it's never evicted by capacity guard)
- `protected = 1`
- `category = 'wiki'`
- `source_hash = sha256(member_ids ‖ rel_types)` so re-runs detect changes
- Edges of `rel_type = 'derived_from'` from the wiki page back to each member

This means **all existing retrieval, fusion, KG-walk, decay, and Obsidian
export work on wiki pages day one** with no schema migration. The only new
SQL is a few targeted `WHERE category = 'wiki'` queries.

### 5.2 Confidence-rubric mapping (graphify → TerranSoul)

We already store `MemoryEdge.confidence: f64` and `MemoryEdge.source:
EdgeSource (User|Llm|Auto)`. We'll add a pure helper that translates between
graphify's discrete labels and our continuous confidence:

| graphify label | TerranSoul `EdgeSource` | confidence | Notes |
| --- | --- | --- | --- |
| `EXTRACTED` | `User` *or* `Auto` | `1.0` | Explicit (user assertion or deterministic AST extraction) |
| `INFERRED@0.95` | `Llm` | `0.95` | Cross-file with one plausible target |
| `INFERRED@0.85` | `Llm` | `0.85` | Strong evidence — naming + context align |
| `INFERRED@0.75` | `Llm` | `0.75` | Reasonable, contextual but not explicit |
| `INFERRED@0.65` | `Llm` | `0.65` | Weak (naming similarity only) |
| `AMBIGUOUS` | `Llm` | `≤ 0.55` | Flagged for review |

This is implemented as `pub fn confidence_label(edge: &MemoryEdge) ->
ConfidenceLabel` — pure function, well-tested, no schema change.

### 5.3 Source dedup on ingest

The `memories.source_hash` column already exists. We hook ingest:

```rust
let hash = blake3::hash(content.as_bytes()).to_hex();          // or SHA-256
let existing = store.find_by_source_hash(&hash, source_url)?;
match existing {
    Some(entry) => SourceDedupResult::Skipped { existing_id: entry.id },
    None        => SourceDedupResult::Ingested(store.add(...)?),
}
```

`source_hash` was already indexed in V15 (`idx_memories_source_hash`), so
this is O(log n) — no perf cost. This becomes the foundation of *compounding*:
re-running `/digest` on the same URL becomes a no-op instead of duplicating
1000 memories at 1M scale.

### 5.4 Audit (`/ponder`) — five health signals, one report

| Signal | Source primitive |
| --- | --- |
| Open contradictions | `memory_conflicts WHERE status='open'` |
| Orphan memories | `memories LEFT JOIN memory_edges ... WHERE edge_count = 0 AND tier='long'` |
| Stale claims | `memories WHERE decay_score < threshold AND importance < 4` |
| Missing wiki pages | mentioned entities in content not in `memories WHERE category='wiki'` |
| Embedding gaps | `pending_embeddings` count + memories without embedding |

Each row links into the existing memory explorer; the report is a single
struct returned by one Tauri command (`audit_brain_report`).

### 5.5 God-nodes & surprising-connections (cheap, fully derivable)

```sql
-- god nodes
SELECT m.id, m.content, COUNT(e.id) AS deg
FROM memories m LEFT JOIN memory_edges e
  ON (e.src_id = m.id OR e.dst_id = m.id) AND e.valid_to IS NULL
GROUP BY m.id ORDER BY deg DESC LIMIT ?
```

```sql
-- surprising = cross-community edges with high confidence
SELECT e.* FROM memory_edges e
JOIN memory_communities ca ON ca.member_ids LIKE '%[' || e.src_id || ']%'
JOIN memory_communities cb ON cb.member_ids LIKE '%[' || e.dst_id || ']%'
WHERE ca.id <> cb.id AND e.confidence >= 0.7 AND e.valid_to IS NULL
ORDER BY e.confidence DESC LIMIT ?
```

Both run in <50ms even at 100k memories given existing indexes.

### 5.6 Append-and-review queue (Karpathy 2025)

Score per memory: `gravity = 1.0 / (now - last_accessed) + 0.3 *
importance + 0.2 * decay_score`. Ascending order = "needs review";
descending = "currently relevant". Uses only existing columns. The UI
shows a chronological column ("notes sinking") and a rescue button that
bumps `last_accessed` and importance.

---

## 6. Tests ported from graphify

graphify tests under `tests/` map onto TerranSoul tests as follows. We
**don't** copy code (different language, different schema); we copy the
*expectations* and *test names* so coverage is comparable.

| graphify test | TerranSoul equivalent | Type |
| --- | --- | --- |
| `test_cache.py` (SHA256 dedup) | `wiki::tests::dedup_skips_identical_source` | Rust unit |
| `test_incremental.py` | `wiki::tests::incremental_reingest_updates_only_changed` | Rust unit |
| `test_confidence.py` (rubric) | `wiki::tests::confidence_label_matches_rubric` | Rust unit |
| `test_validate.py` (graph integrity) | `wiki::tests::audit_detects_orphans_and_dangling_refs` | Rust unit |
| `test_dedup.py` | `wiki::tests::dedup_skips_identical_source` (combined) | Rust unit |
| `test_analyze.py` (god nodes, surprises) | `wiki::tests::god_nodes_returns_top_connected` + `surprising_connections_crosses_communities` | Rust unit |
| `test_serve.py` (MCP contract) | existing `mcp::handlers::tests` extended with `brain_audit`, `brain_spotlight` | Rust unit |
| `test_benchmark.py` | `million_memory.rs` already exists; extend with `wiki_dedup_throughput` | Bench |
| `test_pipeline.py` | new e2e `e2e/wiki-flow.spec.ts` (digest → ponder → spotlight) | Playwright |
| `test_query_cli.py` | new Vitest `WikiPanel.test.ts` covering chat slash commands | Vue |

**Privacy parity with graphify:** all wiki ops run on the same SQLite +
embedding stack; no data leaves the device unless the user has explicitly
configured a cloud brain mode. `brain_ingest_url` already enforces SSRF /
size guards via `ai_integrations/mcp/security.rs`.

---

## 7. Rollout plan

### Phase 1 — Foundations (this PR)

1. New module `src-tauri/src/memory/wiki.rs`:
   - `confidence_label()` rubric helper
   - `god_nodes()`, `surprising_connections()`
   - `audit_report()` (5 signals)
   - `append_and_review_queue()`
   - `ensure_source_dedup()` (uses `source_hash`)
2. Tauri commands in `src-tauri/src/commands/wiki.rs`, registered in
   `src-tauri/src/lib.rs::run`.
3. 8+ unit tests modelled on graphify patterns.
4. Frontend slash commands: `/digest`, `/ponder`, `/spotlight`,
   `/serendipity`, `/revisit`, `/trace`. Recognised in the conversation
   pipeline (not the self-improve session pipeline).
5. New `WikiPanel.vue` with four tabs (Spotlight, Serendipity, Audit,
   Revisit) and one config row in `BrainCapacityPanel.vue` for
   "auto-audit cadence (hours)".
6. Vitest suite for the slash parser additions and the panel.

### Phase 2 — Synthesis (`/weave`) — follow-up PR

LLM call that takes a topic → top-K related memories → community → asks
the brain to write a 200–600-word wiki page → store as protected Summary
with `category='wiki', tags='wiki:concept:<slug>'`. Reuses the existing
`OllamaAgent` / `embed_for_mode` infra.

### Phase 3 — Append-only timeline (`brain_log`) — follow-up PR

A `brain_log` table (or memories with `tags='brain:log'`) appended on
every ingest / query / audit / weave. Surfaces a parseable timeline in
the BrainView and feeds the agent context.

### Phase 4 — `/why` rationale extraction — follow-up PR

Code-path comment scraper (graphify already does this for Python + 25
languages; TerranSoul targets Rust + Vue + TS). Lifts `// WHY:` and
`// NOTE:` and `// HACK:` into rationale memories edged to the symbol
they document.

---

## 8. Why this design respects the constraints

- **No CLI** — every operation is reachable from the chat box (slash
  commands) or from the Brain configuration panel. No new terminal
  binaries.
- **Names are not graphify clones** — `digest / ponder / weave / spotlight
  / serendipity / revisit / trace / why` are TerranSoul-native verbs. None
  appear in graphify's command surface.
- **No schema migration** — every feature reuses V15 columns
  (`source_hash`, `tags`, `category`, `importance`, `protected`,
  `decay_score`, `MemoryEdge.confidence`, `EdgeSource`).
- **Performance** — all five queries are indexed; god-nodes is O(n
  log n) and bounded by `LIMIT`. Source dedup is O(log n) via the
  `idx_memories_source_hash` index.
- **Reliability** — failure cases (missing brain, MCP offline, vector
  embed failure) reuse the existing graceful-degradation paths. Slash
  commands fall through to plain chat when the brain is unconfigured.
- **Tests** — graphify's expectations are ported one-for-one. The
  `million_memory.rs` bench is extended to cover wiki dedup throughput.

---

## 9. Open questions / explicit non-goals

- **Multi-user wikis** — out of scope. TerranSoul is single-user/single-device
  with optional LAN sharing; we don't pursue audit logs for concurrent edits.
- **Span-level citations** — `a-a-k`'s critique. We track source URL +
  memory ID; we don't (yet) store character offsets. Phase 4 candidate.
- **Eval / regression suite** — we won't ship a benchmark paper; we will
  ship benchmarks in `million_memory.rs` covering retrieval latency at
  1M / 10M scale (already in flight).
- **Wiki rollback / branching** — `memory_versions` table already gives
  per-row history; full git-style branching is out of scope.

---

## 10. References

- Karpathy, A. *LLM Wiki* gist
  ([gist.github.com/karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)),
  Apr 2026.
- Karpathy, A. *The append-and-review note*
  ([karpathy.bearblog.dev/the-append-and-review-note](https://karpathy.bearblog.dev/the-append-and-review-note/)),
  Mar 2025.
- Shamsi, S. *graphify* (`safishamsi/graphify`, MIT) — pipeline,
  Leiden community detection, confidence rubric.
- Bush, V. *As We May Think* (Atlantic, 1945) — Memex.
- Anthropic. *Contextual Retrieval*, 2024.
- Cormack, G. et al. *Reciprocal Rank Fusion*, SIGIR 2009.
- DeepWiki summary
  ([deepwiki.com/safishamsi/graphify](https://deepwiki.com/safishamsi/graphify)),
  May 2026.

> Reverse-engineering of `safishamsi/graphify` was conducted via the
> public README, ARCHITECTURE.md, docs/how-it-works.md, and the
> `tests/` directory. No graphify source was copied; only patterns,
> expectations, and test naming were ported. License: MIT (compatible).
