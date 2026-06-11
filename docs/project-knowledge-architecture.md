# Project Knowledge Architecture — TerranSoul

> **Audience.** Anyone designing, reviewing, or extending how TerranSoul
> turns a working tree into project knowledge that the local MCP brain and
> coding workbench can query.
> **Status.** Design doc, 2026-05-07. Companion to the
> [native code-intelligence spec](native-code-intelligence-spec.md) and
> [coding workflow design](coding-workflow-design.md).
> **Scope.** Branch-aware indexing, git sync (checkout / merge / pull /
> push / PR), and large/multi-repo scale. No third-party code,
> binaries, prompts, or assets are bundled.

---

## 1. Why a project-knowledge layer at all

A folder of files is what humans read. An AI coding agent works much
better against a *graph* — symbols, calls, types, processes,
imports, clusters, contracts — because graphs are queryable, summarisable,
and diff-friendly.

Public projects in this space (credited in [`CREDITS.md`](../CREDITS.md))
make this idea easy to study without copying:

- **Graphify** (`safishamsi/graphify`, MIT, Python) — turns a folder
  into a knowledge graph, ships `graph.json` + `graph.html` +
  `GRAPH_REPORT.md` per repo, syncs via a git post-commit hook and a git
  merge driver, and aggregates repos into a single global graph at
  `~/.graphify/global.json`. Issue
  [`#52`](https://github.com/safishamsi/graphify/issues/52) is a
  detailed teardown of how that approach degrades at large scale.
- **GitNexus** (`abhigyanpatwari/GitNexus`, **PolyForm Noncommercial
  1.0.0**) — public docs and DeepWiki pages describe a similar
  precomputed relational code graph with a graph workbench UI. By
  policy TerranSoul never bundles, vendors, or auto-installs GitNexus
  packages, binaries, prompts, or UI; we read its public design only.

TerranSoul takes the same **graph-first** stance, but implements it
natively in Rust + Vue with a neutral schema, content-hash
incremental indexing, and a git-derived branch overlay so the graph
faithfully tracks the branch you are actually on.

---

## 2. What already exists in TerranSoul

| Layer | Where | Notes |
|---|---|---|
| Tree-sitter symbol extractor | [`src-tauri/src/coding/symbol_index.rs`](../src-tauri/src/coding/symbol_index.rs) | Rust + TypeScript always on; Python/Go/Java/C/C++ behind `parser-*` features. |
| Content-hash incremental table | `code_file_hashes(repo_id, file, hash)` | Files whose hash matches last run are skipped. |
| Cross-file resolver | [`coding/resolver.rs`](../src-tauri/src/coding/resolver.rs) | Confidence tiers + provenance on every edge. |
| Functional clustering & processes | [`coding/processes.rs`](../src-tauri/src/coding/processes.rs) | Label-propagation clusters + BFS execution traces. |
| Multi-repo groups + contracts | [`coding/repo_groups.rs`](../src-tauri/src/coding/repo_groups.rs) | `code_repo_groups`, `code_repo_group_members`, `code_contracts` (signature_hash). |
| Hybrid code search | [`coding/code_search.rs`](../src-tauri/src/coding/code_search.rs) | BM25 + embedding + RRF fused with brain memory. |
| Diff impact | [`coding/diff_impact.rs`](../src-tauri/src/coding/diff_impact.rs) | Maps a diff to symbols/processes touched. |
| MCP code tools (12) | `ai_integrations/mcp/` | `code_query`, `code_context`, `code_impact`, `code_rename`, `code_extract_contracts`, `code_*_group*`, `code_cross_repo_query`, `code_generate_skills`. |

**Gap (this doc).** None of the above is *branch-aware*. Two checkouts
of the same repo at different commits would today share one
`code_index.sqlite` whose rows correspond to whichever commit was last
indexed. Switching branches silently makes the graph wrong until the
next full re-index. PR review, "compare to main", merge/pull, and
multi-repo orgs all need a layer above the existing schema.

---

## 3. Design — three-tier knowledge layers

The simplest model that handles branches, PRs, merges, and dirty
working trees without exploding storage is three stacked layers, each
addressed by a `git rev` (commit SHA-1):

```
┌─────────────────────────────────────────────────────────────────┐
│ Working-tree overlay   — uncommitted edits, in-memory / TEMP DB │
├─────────────────────────────────────────────────────────────────┤
│ Branch overlay         — (HEAD ∖ base) per-file rows in SQLite  │
├─────────────────────────────────────────────────────────────────┤
│ Base snapshot          — committed-graph snapshot at origin/main│
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Base snapshot (committed)

A *deterministic*, content-addressable export of the graph at
`origin/main` (or another configurable base ref) lives at
`.codegraph/snapshot.json` in the repo. Because every row is keyed by
`(repo_label, file, content_hash, line)`, two devs regenerating the
snapshot from the same commit get **byte-identical** output. That
property means:

- **No git merge driver required.** Graphify needs one because its
  `graph.json` is generated with timestamps and ordering quirks; if
  every input is hashed and outputs are sorted lexicographically,
  re-running on the merge commit produces the merged graph
  automatically.
- The snapshot is small (it stores symbol/edge rows but no
  embeddings; embeddings live in the local `code_index.sqlite` and
  are recomputed lazily).
- The snapshot lets a freshly cloned checkout get a working graph in
  one import call instead of a full re-parse.

### 3.2 Branch overlay (local, per-checkout)

When `HEAD ≠ base`, only files whose content differs from `base` get
re-indexed and stored in a new table:

```sql
CREATE TABLE code_branch_overlays (
    id          INTEGER PRIMARY KEY,
    repo_id     INTEGER NOT NULL REFERENCES code_repos(id) ON DELETE CASCADE,
    base_ref    TEXT    NOT NULL,   -- commit sha the overlay diffs against
    branch_ref  TEXT    NOT NULL,   -- commit sha the overlay represents
    file        TEXT    NOT NULL,
    hash        TEXT    NOT NULL,
    indexed_at  INTEGER NOT NULL,
    UNIQUE(repo_id, base_ref, branch_ref, file)
);
```

Symbols and edges produced for those files are tagged via
`code_symbols.overlay_id` (NULL = belongs to base snapshot). A query
for the *current branch* unions:

```
base_rows  WHERE NOT EXISTS (overlay row for same file)
∪ overlay_rows for current (base_ref, branch_ref)
```

This is O(changed-files), not O(repo-size). On a 9 389-file repo
where a PR touches 28 files, the branch overlay holds 28 file
records — Graphify's Issue #52 worst case becomes a non-event.

### 3.3 Working-tree overlay (in-memory)

Dirty files (`git status --porcelain`) are reparsed into an in-memory
`HashMap<PathBuf, FileGraph>` that the MCP query path consults *before*
the SQLite layers. This avoids touching disk on every keystroke and
keeps the graph consistent with the editor.

---

## 4. Branch / merge / pull / push lifecycle

### 4.1 Git hooks installed by TerranSoul

A new opt-in installer (`code_install_hooks` Tauri command, mirroring
Graphify's `graphify hook install`) writes three short shell scripts
to `.git/hooks/`:

| Hook | Action |
|---|---|
| `post-checkout` | If `<prev_sha> != <new_sha>`, POST `{prev, new}` to local MCP `code_branch_sync`. |
| `post-merge` | POST `{prev, new}` to `code_branch_sync` so merged-in changes update overlay. |
| `post-commit` | POST `{commit_sha}` to `code_index_commit` — re-index changed files into the active branch overlay; if HEAD now equals `base_ref`, atomically promote the overlay rows into base and drop them from `code_branch_overlays`. |

Each hook is a 5-line POSIX shell that does an authenticated `curl`
against `127.0.0.1:7421/hooks/...` (release MCP, dev `:7422`,
headless `:7423`) and **exits 0 on any error** so the user's git
operation is never blocked. The hook script is generated by
TerranSoul, not vendored from any third party.

### 4.2 The `code_branch_sync` algorithm

```
fn code_branch_sync(repo, prev, new):
    diff_files = git_diff_name_only(prev..new)
    for file in diff_files:
        if file_was_deleted(repo, file, new):
            delete_overlay_rows(repo, file)
            continue
        h = blake3(file_at(new))
        if existing_hash(repo, file) == h:
            continue                              # nothing to do
        symbols, edges = parse(file_at(new))
        upsert_overlay(repo, base_ref, new, file, h, symbols, edges)
    refresh_clusters_for_changed_files()          # local, label-propagation
    emit_event(code_index_branch_changed)
```

**Properties:**

- Idempotent. Running it twice with the same `(prev, new)` is a no-op.
- Bounded. Cost is linear in the number of changed files, not repo
  size.
- Crash-safe. All writes happen inside one SQLite transaction per
  file batch; the existing `code_file_hashes` short-circuit keeps the
  index advancing even if a previous run aborted mid-batch.

### 4.3 Switching back and forth

Because every overlay row is keyed by `(base_ref, branch_ref, file)`,
TerranSoul can keep overlays for **multiple branches** at once and
switch between them in O(1) — `code_branch_sync` with `prev=feature`
and `new=main` simply selects the existing `main` overlay rows
(usually empty when `main == base`) and drops the feature overlay
from active queries.

### 4.4 PR vs main comparison

A new MCP tool `code_branch_diff` takes `(left_ref, right_ref)` and
returns symbols/contracts/processes that exist in one side but not
the other, plus signature hash drift on shared symbols. The
existing `code_contracts.signature_hash` mechanism already detects
breaking changes; this tool just wires it up to the overlay schema.
This is the basis of the workbench "PR review" mode.

### 4.5 Pull / push

`git pull` triggers `post-merge` automatically. `git push` does not
need a hook because pushing does not change local state. CI in the
remote may run a headless `code_index_publish` to refresh the
committed `.codegraph/snapshot.json`; that is opt-in and lives in a
GitHub Actions workflow rather than in the Tauri app.

---

## 5. Scaling — how to stay useful past 100 k files

Graphify Issue #52 documents specific failure modes when a repo grows
past a few thousand files. We adopt explicit guards for each.

| Issue (Graphify #52) | TerranSoul mitigation |
|---|---|
| Tree-sitter version mismatch crashes whole pipeline | Each parser lives behind a `parser-*` Cargo feature with a single Rust API; a parse error on file X never aborts files Y/Z (already true in `symbol_index.rs`). |
| Python-only logic crashed all other languages | Resolver is per-language, gated by file extension; cross-file resolution failures are caught and degrade to "unresolved" edges with `provenance = "skipped: parser_error"`. |
| Asset PDFs misclassified as papers | Indexer never sees binary or image files. A new vendor/asset detector (§5.1) excludes them by path. |
| 7 414 micro-clusters on 22 k nodes | Clusterer takes `min_cluster_size` (default 8) and falls back to two-phase clustering: directory partition first, label-propagation within each partition. |
| 5 000-node hard cap on visualisation | Workbench renders at most N top-degree nodes per cluster + a "drill into cluster" path. No hard error. |
| God nodes dominated by `Pods/`, `node_modules/` | Vendor-tier symbols are excluded from god-node ranking and from the workbench top-N by default; toggle in Settings. |
| No directory awareness for iOS / monorepos | `.codeignore` (gitignore syntax) plus per-language vendor presets (§5.1). |
| No progress feedback on large batches | The existing `gate_telemetry.rs` event stream emits a `code_index_progress` event every 100 files. |

### 5.1 Vendor / asset detection

A new `coding/vendor_detector.rs` tags every file as one of:

- `app` — first-party source under `src/`, `app/`, or repo root code dirs.
- `vendor` — generated lockfile-tracked dependencies (`node_modules/`,
  `Pods/`, `vendor/`, `target/`, `dist/`, `build/`,
  `.venv/`, `Cargo.lock`-pinned source).
- `asset` — `*.png|jpg|webp|gif|mp4|mov|wav|mp3|pdf` inside
  `*.imageset/`, `*.xcassets/`, `assets/`, `public/`.
- `generated` — files matching `*.generated.*` or with a generator
  banner detected in the first 200 bytes.

**Indexing tier per kind:**

| Kind | AST symbols | Cross-file edges | Clustering | God-node ranking |
|---|---|---|---|---|
| `app` | yes | yes | yes | yes |
| `vendor` | yes (symbols only) | yes (incoming only) | no | no |
| `asset` | no | no | no | no |
| `generated` | configurable | no | no | no |

This single change addresses Issues #52.6 and #52.7 from Graphify's
report directly.

### 5.2 `.codeignore`

Same syntax as `.gitignore`, with `!` negation. Lives at repo root and
is honoured by the Rust indexer through the existing `ignore` crate
(MIT/Apache-2.0). Default presets are merged automatically based on
detected build files (`package.json`, `Cargo.toml`, `Podfile`,
`go.mod`, `pom.xml`, `requirements.txt`).

### 5.3 Multi-repo scale (orgs)

TerranSoul already has `code_repo_groups` + `code_repo_group_members`
+ `code_contracts` (chunk 37.13). The branch-overlay model composes
cleanly with groups:

- A group's snapshot is the union of each member's
  `.codegraph/snapshot.json` plus the cross-repo edges in
  `code_contracts`.
- `code_cross_repo_query(group, query)` already exists; it now
  consults overlays so PR-time queries see the in-flight contracts.
- A new `code_group_drift(group)` flags contracts whose
  `signature_hash` differs between two member repos' current
  branches, surfacing breakage *before* merge.

### 5.4 Out-of-scale (>1 M symbols)

Two escape hatches:

1. **Lazy cluster expansion.** Top-level cluster summaries are
   precomputed; cluster bodies are loaded on demand when the
   workbench or `code_context` asks for them.
2. **Subdirectory roots.** A user can register the same repo with
   multiple `code_repos.path` entries (e.g. one per service in a
   monorepo). Each has its own overlay, group membership, and
   `.codegraph/snapshot.json` shard.

If we cross 10 M symbols, the next step is Lance/Polars-style
columnar storage — out of scope for Phase 45.

---

## 6. Storage layout

```
<repo-root>/
├── .codegraph/
│   ├── snapshot.json         ← committed; deterministic export at base ref
│   ├── snapshot.meta.json    ← committed; base_ref, schema_version, file count
│   └── (optional cache/)     ← gitignored; per-language parse caches
└── .codeignore               ← committed; user + auto-detected vendor rules
```

Local-only state stays in TerranSoul's per-user data directory:

```
<app-data>/code_index.sqlite      ← embeddings, overlays, working state
<app-data>/code_index.sqlite-wal  ← WAL
```

`.codegraph/` is the source of truth that crosses machines; the
SQLite DB is a derived, machine-local cache that can be deleted
without losing project knowledge.

---

## 7. Comparison snapshot

| Capability | Graphify (MIT) | GitNexus (PolyForm-NC, design study only) | TerranSoul (this doc) |
|---|---|---|---|
| Per-file content-hash incremental | ✓ | ✓ | ✓ (already shipped) |
| Branch-aware overlay | partial (re-runs on checkout) | partial | **✓ explicit overlay rows** |
| Deterministic committable snapshot | git merge driver | n/a (server-side) | **✓ deterministic export, no driver needed** |
| Vendor/asset tiering | manual `.graphifyignore` | n/a | **✓ auto-detect + tiered indexing** |
| Multi-repo group + contract drift | global graph file | precomputed | **✓ contracts + drift between branches** |
| Cluster fragmentation guard | partial (post-#52) | unknown | **✓ `min_cluster_size` + two-phase** |
| Visualisation past 5 k nodes | sample mode | unknown | **✓ cluster-collapse, no hard cap** |
| Local-first, no external service | ✓ | server | ✓ (local MCP) |
| License posture for bundling | OK to credit | **forbidden to bundle** | clean-room native |

---

## 8. Open questions

1. **Snapshot format vs schema evolution.** When the schema changes,
   old snapshots must still import. A `schema_version` field plus a
   small migration ladder solves this; we already do this for
   `mcp-data/shared/memory-seed.sql`.
2. **Hook installation on Windows.** `.git/hooks/post-checkout` runs
   under Git Bash on Windows. The generated script uses POSIX
   `curl`, which Git for Windows ships. No hard dependency on WSL.
3. **CI cost of regenerating snapshots.** Re-indexing on every push
   may be wasted work. The CI workflow only regenerates when
   `git diff --name-only HEAD^..HEAD` includes code files; for
   docs-only PRs it is a no-op.
4. **Privacy of multi-repo group queries.** Querying repo B's
   contracts from repo A's PR session is intentional but must respect
   per-repo MCP capabilities. The existing `caps.code_read` gate
   already covers this.

---

## 9. Implementation chunks (Phase 45)

See [`rules/milestones.md`](../rules/milestones.md). Phase 45 —
*Project Knowledge Sync & Scale* — has six chunks (45.1 → 45.6) that
implement everything above without touching the branch-naive parts of
the existing pipeline.

---

## 10. Credits

Knowledge of how a project-knowledge graph behaves at scale, and the
specific failure modes we mitigate in §5, comes from public study of:

- [Graphify](https://github.com/safishamsi/graphify) (MIT) — README,
  ARCHITECTURE.md, and Issue
  [`#52`](https://github.com/safishamsi/graphify/issues/52)
  (large-scale iOS analysis).
- [GitNexus](https://github.com/abhigyanpatwari/GitNexus) (PolyForm
  Noncommercial 1.0.0) — public docs and DeepWiki pages, design
  research only. No code, prompts, packaging, binaries, or UI assets
  are bundled.
- [cocoindex-io/cocoindex](https://github.com/cocoindex-io/cocoindex)
  (Apache-2.0) — incremental Δ-only re-indexing patterns.

Full attribution lives in [`CREDITS.md`](../CREDITS.md).
