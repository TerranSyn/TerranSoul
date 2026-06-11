# ADR 009 — SQLite as the primary memory store

**Status:** Accepted  
**Date:** 2025  
**Source:** `src-tauri/src/memory/store.rs`, `src-tauri/src/memory/schema.rs`

---

## Context

TerranSoul needs to persist long-term memories, knowledge-graph edges,
chat history, embeddings, and persona data. The store must:
- Survive app restarts and OS upgrades
- Be queryable by multiple criteria (FTS5 full-text, rowid range, semantic tags, knowledge-graph BFS)
- Work offline on a single machine without network dependencies
- Support CRDT merge for multi-device sync (ADR 005)

## Decision

Use a single SQLite file (`memory.db` in the app data directory) as the
primary durable store for all structured data.

## Why SQLite

| Property | How SQLite provides it |
|----------|----------------------|
| Offline-first | Zero external process; file-portable |
| FTS5 full-text | Built-in; corpus-aware BM25; trigram extension available |
| Relational joins | `memory_edges` JOIN `memories` for KG traversal |
| ACID transactions | WAL mode; safe for background maintenance concurrent with chat |
| Inspectable | Any SQLite browser, `sqlite3` CLI, DBeaver |
| Portable backup | Single file copy = full backup |
| Per-user isolation | Each app instance has its own file; no server, no port conflicts |

## Why not alternatives

| Alternative | Why rejected |
|-------------|-------------|
| Postgres | Requires a running server. Breaks the offline/install-free UX. |
| DuckDB | Excellent for analytics; single-writer only; worse FTS than SQLite FTS5; no CRDT merge path |
| Qdrant / Weaviate | Vector-only; no relational joins; no FTS; would require a second DB alongside SQLite |
| Pure-file JSON | O(n) queries; no ACID; no FTS; no indexing |
| IndexedDB (browser) | Inaccessible from Rust backend; no FTS5; cannot be used as a Tauri sidecar |

## SQLite is not the vector store

SQLite does not have a built-in vector similarity type or cosine distance
function in its standard distribution. The ANN index lives in a sidecar file
(`vectors.usearch` or `turbo_vec.json`) next to `memory.db`, managed by the
tiered vector index system described in ADR 010.

Both FTS5 and ANN candidates are fused via RRF in ADR 002's pipeline — SQLite
provides the lexical + structured half, the ANN index provides the semantic half.

## Performance tuning

The `AppSettings` expose SQLite knobs that take effect on restart:
- `sqlite_cache_mb` (default 16 MiB page cache)
- `sqlite_mmap_mb` (default 64 MiB mmap window)
- `code_index_cache_mb` / `code_index_mmap_mb` for the separate code intelligence DB

These allow power users to trade RAM for query latency.

## Related ADRs

- [ADR 001](001-brain-and-memory-architecture.md) — what is stored in SQLite
- [ADR 010](010-tiered-vector-index.md) — the sidecar ANN index that complements SQLite
