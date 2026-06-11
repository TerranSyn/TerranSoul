# Coding & Repo RAG Systems — Research Synthesis (2026-05-16)

> **Why this doc exists.** The user asked TerranSoul to "learn gitnexus and
> all top rag for coding and project" so that future repo-knowledge work
> (chunk **BRAIN-REPO-RAG-1**) can ground itself in proven open-source
> patterns rather than greenfield guessing. The existing
> [gitnexus-capability-matrix.md](gitnexus-capability-matrix.md) already
> covers GitNexus + CocoIndex deeply; this doc fills the rest of the
> field and translates each finding into a concrete decision for the
> upcoming Memory-panel + per-repo SQLite work.

> **Method.** Per `rules/coding-standards.md` and
> `.github/copilot-instructions.md`: DeepWiki summaries fetched first
> for every project listed below (2026-04 – 2026-05 indexed snapshots),
> cross-checked against upstream README/CHANGELOG, then synthesised.
> No source is copied. All sources credited in
> [CREDITS.md](../CREDITS.md).

## Sources audited

| Project | Repo | License | DeepWiki indexed | What we wanted to learn |
|---|---|---|---|---|
| GitNexus | [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus) | PolyForm Noncommercial 1.0.0 | (see existing matrix) | Code-knowledge-graph pipeline, MCP surface |
| CocoIndex | [cocoindex-io/cocoindex](https://github.com/cocoindex-io/cocoindex) | Apache-2.0 | (see existing matrix) | Δ-only incremental ingest, hash memoization, lineage |
| Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | Apache-2.0 | 2026-04-27 (`3ec8ec5a`) | RepoMap + PageRank "Lines of Interest" |
| Continue | [continuedev/continue](https://github.com/continuedev/continue) | Apache-2.0 | 2026-04-22 (`cb273098`) | `@codebase` context provider + LanceDB |
| Cline | [cline/cline](https://github.com/cline/cline) | Apache-2.0 | 2026-04-22 (`9dea336c`) | Tool-driven file fetch vs precomputed index |
| Cody | [sourcegraph/cody](https://github.com/sourcegraph/cody) | Apache-2.0 (open core) | 2025-04-20 (`f8c68fc0`) | `ContextRetriever`/`PromptBuilder` split |
| LlamaIndex | [run-llama/llama_index](https://github.com/run-llama/llama_index) | MIT | 2026-04-02 (`8797f52b`) | Canonical RAG pipeline shape + `CodeHierarchyNodeParser` |
| gitingest | [cyclotruc/gitingest](https://github.com/cyclotruc/gitingest) | MIT | 2025-11-06 (`4e259a02`) | Clone → walk → filter pipeline, ignore precedence |
| repomix | [yamadashy/repomix](https://github.com/yamadashy/repomix) | MIT | 2026-04-29 (`7dfd2b96`) | Secretlint scanning, tree-sitter signature compression |
| Context7 | [upstash/context7](https://github.com/upstash/context7) | MIT (MCP server) + proprietary index | 2026-05-12 (`b2f1a0aa`) | MCP-first version-pinned library docs; `resolve-library-id` + `get-library-docs` |

## Findings — one paragraph each

### Context7 — MCP-first, version-pinned library docs (added 2026-05-15)
Context7 is an MCP server by Upstash that ships a curated, version-pinned
documentation index for thousands of open-source libraries (the index itself
is hosted; the server is MIT). Its public surface is two tools:
`resolve-library-id(query) → libraryID` and
`get-library-docs(libraryID, topic?, tokens?)`. The killer property is
**version selectivity**: an LLM gets exactly the docs for the `react@18.3.1`
or `react@19.0.0` it was asked about, not a Stack Overflow blend of all
versions. There is *no* repo cloning, *no* embedding pipeline, *no* code
graph — Context7 is closer to a docs-RAG-as-a-service than a code-RAG.
*Decision for BRAIN-REPO-RAG-1:* Context7 is **complementary, not
competitive** — TerranSoul's repo-RAG indexes *user-provided source code*,
Context7 indexes *upstream library documentation*. Both can coexist as MCP
tools. We deliberately do **not** copy Context7's hosted index, but we
*do* adopt two patterns: (1) the two-tool `resolve` → `fetch` shape (gives
LLMs an explicit narrowing step before bulk retrieval) — port to
`repo_resolve_source` + `repo_search`/`repo_read_file`; (2) the
version-pinning concept — every `memory_sources` row already carries
`repo_ref` (branch/tag/sha), so a single repo can be added at multiple
refs and queries can disambiguate. Anti-pattern *not* to copy: Context7's
hosted-only model — TerranSoul must work fully offline.



### Aider — `RepoMap` + PageRank
Aider's `RepoMap` (`aider/repomap.py`) parses every tracked file with
tree-sitter, extracts every defined and referenced tag, then builds a
graph where edges encode "tag X is referenced in file Y". It runs
**PageRank over that graph**, then greedily fills a token budget with
the highest-ranked tags + their tree-sitter context windows. The
result is a compact symbol+definition view of the *entire repo* that
fits in a fraction of the context window. This is the seminal "smart
context for coding" trick. *Decision for BRAIN-REPO-RAG-1:* native
Rust re-implementation on top of our existing
[symbol_index.rs](../src-tauri/src/coding/symbol_index.rs) — we
already have the symbol graph from chunk 31.x; add a PageRank pass
and a budget-aware tag picker as a new `code_repo_map` Tauri
command + MCP tool.

### Continue — `CodebaseIndexer` + LanceDB + typed `@`-context
Continue's `CodebaseIndexer` chunks the workspace, embeds via the
configured `ILLM`, and stores vectors in **LanceDB** (Apache-2.0
embedded columnar vector store, `vectordb` npm package). The UX
innovation is the typed **context provider** system: `@codebase`,
`@file`, `@folder`, `@github`, `@docs`, `@terminal`, etc. become
first-class @-mentions in the chat input (TipTap rich-text). The
user *names a source per turn* without changing global active state.
*Decision:* TerranSoul's Memory panel uses an active-source picker
(per the earlier scope answer), but the chat composer should *also*
support `@source-id` mentions so users can hot-reference a repo
without switching context. LanceDB is a viable alternative to
SQLite+HNSW for per-repo isolation — flag this for BRAIN-REPO-RAG-2
evaluation but do **not** swap defaults in chunk 1; we already have a
working SQLite+usearch stack and the user picked separate SQLite
files per repo.

### Cline — tool-driven file fetch, not precomputed index
Cline does **not** maintain a precomputed code embedding index. Its
agent loop relies on the LLM emitting `read_file` / `list_files` /
`search_files` tool calls, and a Plan/Act mode pair that lets the
user constrain access. File access is gated by `.clineIgnore` and
`CLINE_COMMAND_PERMISSIONS`. Every consequential write is approved
via `Task.ask()` suspending the loop. *Decision:* for an active
coding session, tool-driven fetch is complementary, not replacement,
for embedding RAG. TerranSoul's MCP surface should expose
`repo_list_files`, `repo_read_file(path, line_range)`,
`repo_search(query, source_id)` alongside the vector retriever, so
strong-tool-use models (Claude, GPT-5-class) can fall back to direct
file access when retrieval misses. The `.clineIgnore` precedent
hardens the safety story: TerranSoul will honour `.gitignore` +
`.terransoulignore` + the gitingest default-binary blacklist.

### Cody — `ContextRetriever` / `PromptBuilder` separation
Cody splits prompt assembly into `ContextRetriever` (gathers
relevant code via Sourcegraph backend + local heuristics) and
`PromptBuilder` (templates the final prompt with system + context +
user turn). The retrieval layer is pluggable — local embeddings,
Sourcegraph graph, or both. *Decision:* keep TerranSoul's retrieval +
prompt assembly cleanly separated: extend the existing
[brain memory pipeline](../src-tauri/src/memory/store.rs) so the
retriever returns a typed `Sources[]` payload (each tagged with
`source_id`, `kind`, `path`, `line_range`), and the prompt assembler
formats them under headed sections per source. This matters for the
Memory panel "All sources" toggle — recall must annotate provenance
back to the active or originating repo.

### LlamaIndex — canonical pipeline + `CodeHierarchyNodeParser`
LlamaIndex's textbook RAG pipeline is
`BaseReader → Document → NodeParser → Node → EmbedModel →
VectorStoreIndex → BaseRetriever → ResponseSynthesizer`. The
`llama-index-packs-code-hierarchy` pack's `CodeHierarchyNodeParser`
is the AST-aware variant: chunks at function/class boundary,
preserves parent → child relationships so a chunk for a method
inherits its class context as metadata. *Decision:* we already do
semantic chunking via the `text-splitter` crate in
[chunking.rs](../src-tauri/src/memory/chunking.rs); for repo code we
need an AST chunker. Reuse our existing tree-sitter parsers from
[coding/](../src-tauri/src/coding/) to emit one chunk per top-level
declaration with its full body, plus a tiny header chunk per file
containing the path + summary + imports. Persist
`(source_id, file_path, parent_symbol, kind, byte_start, byte_end)`
in `repo_chunks` so retrieval can rank by hierarchy.

### gitingest — clone, walk, filter, package
gitingest's pipeline is
`parse_remote_repo → clone_repo (sparse-checkout, submodules) →
_scan_directory → pathspec match → _read_file_content (size cap) →
_format_content → (summary, tree, content)`. Pattern precedence is
**user-includes → repo `.gitignore`/`.gitingestignore` → user-excludes
→ default ignores** (build artifacts, lockfiles, binaries). Per-file
cap defaults to **10 MB**. Token counting via `tiktoken
o200k_base`. `--include-submodules` flag. *Decision:* TerranSoul's
ingest path uses
- `gix` (pure-Rust git) to shallow-clone into
  `mcp-data/repos/<source_id>/checkout/`,
- the `ignore` crate (Rust equivalent of pathspec, also used by
  ripgrep) to apply `.gitignore` + `.terransoulignore`,
- our existing chunker for text, AST chunker for code,
- the same 10 MB per-file cap with a clear warning surfaced in the
  Memory panel,
- `tiktoken-rs` (already a dependency) for the same `o200k_base`
  token accounting we use elsewhere.

### repomix — Secretlint + tree-sitter compression + worker pool
repomix pipelines repos through six phases:
`searchFiles → collectFiles → validateFileSafety (Secretlint) →
processFiles (tree-sitter signature compression) → produceOutput
(Handlebars) → calculateMetrics (gpt-tokenizer)`. Worker pool via
`tinypool`. The two unique lessons: **(1) Secretlint scanning is
mandatory before any ingest** — otherwise GitHub tokens / AWS keys
end up indexed as RAG corpus and surfaced in chat. **(2) Tree-sitter
signature compression** strips function bodies and keeps signatures,
giving a much cheaper "what is in this file" view. *Decision:* port
a Rust-equivalent secret scanner before the embed step — the
`secrets-patterns-db` regex set is fine for v1 (we don't need full
Secretlint). Mark scrubbed files in `repo_chunks.flags` so the
Memory panel can show a "🛡 N files skipped — secrets detected"
badge. Signature-only previews live in a separate
`repo_file_signatures` table indexed independently — useful for
"give me a map of this repo" quick replies.

### GitNexus — already covered
See [gitnexus-capability-matrix.md](gitnexus-capability-matrix.md).
Only delta added by this audit: confirm that GitNexus's MCP tool
shape (`query`, `context`, `impact`, `detect_changes`, `rename`)
remains the right shape for our MCP surface — the per-repo source
just adds a `source_id` argument to each.

## Translated BRAIN-REPO-RAG-1 design (informed by the above)

### Storage (matches user's "separate SQLite file per repo" answer)

```
mcp-data/
├── memory.db                      # TerranSoul's own brain (source 'self')
├── repos/
│   ├── <source_id>/
│   │   ├── checkout/              # shallow git clone
│   │   ├── memories.db            # per-repo memories + repo_chunks + symbols
│   │   ├── ann.usearch            # HNSW index for this repo only
│   │   └── manifest.json          # url, ref, last_sync_at, file_count, …
│   └── …
└── shared/                        # unchanged
```

A new `memory_sources` registry lives in `memory.db` only:

```sql
CREATE TABLE memory_sources (
  id           TEXT PRIMARY KEY,    -- 'self' | uuid
  kind         TEXT NOT NULL,       -- 'self' | 'repo' | 'topic'
  label        TEXT NOT NULL,
  repo_url     TEXT,                -- nullable for 'self' / 'topic'
  repo_ref     TEXT,                -- branch/tag/sha
  created_at   INTEGER NOT NULL,
  last_synced_at INTEGER
);
```

Rationale: separate DB files give cheap per-repo delete (`rm -rf
repos/<id>/`), isolated ANN indexes (no rebuild of the personal
brain when a repo changes), and zero risk of repo content polluting
the `self` graph. The cost is "All sources" mode — searching that
must fan out, merge candidate sets, and RRF-fuse across DBs. We
already use RRF; this just means the fusion runs once per DB and
once across the merged ranked lists.

### Ingest pipeline (Rust)

1. `clone_repo(url, ref)` — `gix` shallow clone into `repos/<id>/checkout`.
2. `walk_repo(checkout)` — `ignore` crate, apply default + repo +
   `.terransoulignore` precedence (gitingest pattern).
3. `scan_secrets(file_bytes)` — regex sweep using
   `secrets-patterns-db`; skipped files recorded with reason.
4. `chunk_file(path, bytes)` — AST chunker (tree-sitter, reuse
   `coding/`) for `.rs/.ts/.tsx/.py/.go/.java/.c/.cpp`; text chunker
   for everything else; per-file 10 MB cap.
5. `embed_chunks(chunks)` — existing `mxbai-embed-large` path.
6. `persist(source_id, chunks)` — write into
   `repos/<source_id>/memories.db`; update HNSW.
7. `build_repo_map(source_id)` — Aider-style PageRank over the
   per-repo symbol graph, persisted as `repo_map_tags` for budget-aware
   retrieval.

### Retrieval

`hybrid_search(query, mode)` where `mode` is one of
- `Source(source_id)` — single DB,
- `Self` — current behaviour,
- `All` — fan-out + merge + RRF (k=60, matches our existing default).

Result rows always carry `source_id` so the prompt assembler can
group + cite.

### MCP surface (mirrors GitNexus shape, namespaced per source)

| Tool | Argument |
|---|---|
| `repo_list_sources` | – |
| `repo_add_source` | `{ url, ref?, label?, include?, exclude? }` |
| `repo_remove_source` | `{ source_id }` |
| `repo_sync` | `{ source_id, ref? }` |
| `repo_map` | `{ source_id, budget_tokens? }` (Aider-style) |
| `repo_search` | `{ source_id \| 'all', query, k? }` |
| `repo_read_file` | `{ source_id, path, line_range? }` (Cline-style) |
| `repo_signatures` | `{ source_id, path }` (repomix-style preview) |

### Memory panel UX

Source picker as a segmented header inside MemoryView:
`🧠 TerranSoul` · `📦 owner/repo` · `📦 …` · `🌐 All sources` · `➕ Add repo`.
Active source filters the stats dashboard, list, search, and "Add
memory" dialog. "Add repo" opens a small wizard:
URL → ref (default `HEAD`) → optional include/exclude globs → consent
preview (file count, size, estimated tokens, secrets-skipped count)
→ Start ingest. Progress bar reuses the Supertonic-1c pattern.

### Quests

- `scholar-quest` (existing) stays — topic-from-URLs.
- New `repo-scholar-quest` (gated on `memory_sources.count(kind='repo') >= 1`):
  steps = `add repo source` → `wait for ingest` →
  `ask a question about the repo`. Combo with `paid-brain` and
  `rag-knowledge`.

### Phased execution plan

| Sub-chunk | Scope | Rationale |
|---|---|---|
| `BRAIN-REPO-RAG-1a` | `memory_sources` table + Tauri CRUD + Memory panel source picker (with only `self` working) + frontend tests | Lowest-risk slice; unblocks UX without backend churn. |
| `BRAIN-REPO-RAG-1b` | per-repo DB layout, `gix` clone, `ignore` walk, secret scan, AST chunker, embed pipeline, `repo_add_source` / `repo_remove_source` / `repo_sync` commands | Backend ingest. |
| `BRAIN-REPO-RAG-1c` | retrieval: `Source` / `All` modes, fan-out + RRF, prompt assembler source grouping, `repo_search` / `repo_read_file` MCP tools | Wire retrieval into chat. |
| `BRAIN-REPO-RAG-1d` | Aider-style `repo_map` (PageRank), repomix-style `repo_signatures`, `repo-scholar-quest` skill, `mcp-data/shared/memory-seed.sql` lesson, README + brain-advanced-design.md updates (mandatory Brain Documentation Sync rule) | Polish + docs. |

## Anti-patterns to NOT copy

- **Aider's git auto-commit.** TerranSoul never commits without explicit
  user action. (Already covered by `rules/coding-standards.md`.)
- **Continue's mandatory cloud control plane.** Their `9.x Control
  Plane Integration` pages — TerranSoul stays offline-first; nothing
  goes to a Continue Hub.
- **Cline's YOLO `--auto-approve-all`.** TerranSoul keeps an
  approval gate for any write to the user's filesystem.
- **GitNexus install path (PolyForm-NC).** Already in matrix; reaffirmed.
- **Cody's Sourcegraph backend dependency.** We design for fully
  local; the Sourcegraph path is informational only.

## Credits

See [CREDITS.md](../CREDITS.md) — new entries added in the same PR
as this doc for Aider, Continue, Cline, Cody, LlamaIndex, gitingest,
and repomix, each with license, scope of what we learned, and a list
of TerranSoul files informed.
