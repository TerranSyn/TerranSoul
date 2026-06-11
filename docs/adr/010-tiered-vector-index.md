# ADR 010 — Tiered vector-index architecture

**Status:** Accepted  
**Date:** 2026  
**Source:** `src-tauri/src/memory/ann_index.rs`, `src-tauri/src/memory/mobile_ann.rs`,
`src-tauri/src/memory/turbo_vec_store.rs`, `src-tauri/src/memory/ivf_pq.rs`

---

## Context

ANN (approximate nearest-neighbour) search is at the heart of the RAG pipeline.
The right backend depends on:
- Corpus size (hundreds to millions of vectors)
- Platform (Windows desktop, macOS, Linux, headless CI)
- Whether native C++ libraries (MSVC runtime, BLAS) can be assumed
- User preference for memory footprint vs recall quality

TerranSoul must work without MSVC C++ runtime at load time (Windows store
constraint) yet deliver sub-100 ms ANN search on a personal corpus.

## Decision

Four-tier dispatch in `memory/ann_index.rs`, runtime-selected by `AppSettings.vector_backend`:

| Tier | Backend | Corpus size | When used |
|------|---------|-------------|-----------|
| **Linear** | Pure-Rust brute-force | ≤ ~50 k | Default; zero deps; always correct |
| **TurboQuant** | Native 4-bit quantised, `turbo_vec_store.rs` | ≤ ~10 M | Opt-in `vector_backend = turbo` |
| **IVF-PQ** | Custom IVF + Product Quantisation, `ivf_pq.rs` | Millions+ | `bench-million` feature gate |
| **HNSW (usearch)** | C++ HNSW via `usearch` crate | Any | `native-ann` feature gate; best recall |

The `AppState` dispatcher is backend-agnostic — all tiers implement the same
`add / remove / search / flush` interface.

## Why SQLite is not the vector store

See ADR 009. SQLite FTS5 does not compute cosine similarity over f32 embedding
vectors. The sidecar index files (`vectors.usearch` or `turbo_vec.json`) coexist
with `memory.db`; both are in the app data directory.

## Why the linear scan is the default

On a fresh install the TurboQuant codebook (per-dimension min/max) has not been
trained. The first few thousand vectors get uniform quantisation, which slightly
reduces recall. The linear scan is O(n) but n is small at startup and fully
correct. Users who grow their corpus beyond ~50 k entries are prompted to switch
to TurboQuant via the Brain settings panel.

## Why HNSW (usearch) is not the default

`usearch` compiles to a native binary that links against the MSVC C++ runtime
on Windows. Shipping a Tauri app that requires MSVC at load time breaks the
Microsoft Store packaging rules and degrades the install experience on machines
without Visual C++ Redistributables. The `native-ann` feature gate is opt-in
for developers and research builds.

## Related ADRs

- [ADR 011](011-turboquant-native.md) — why TurboQuant is implemented natively
- [ADR 002](002-hybrid-rag-pipeline.md) — the pipeline that uses this index
- [ADR 009](009-sqlite-for-memory.md) — why SQLite is the structured store but not the vector store
