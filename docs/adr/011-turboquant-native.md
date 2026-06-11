# ADR 011 — TurboQuant implemented natively, not via the turbovec crate

**Status:** Accepted  
**Date:** 2026-06  
**Source:** `src-tauri/src/memory/turbo_vec_store.rs`  
**Attribution:** Algorithm design: Ryan Codrai, github.com/RyanCodrai/turbovec (MIT)

---

## Context

The `turbovec` crate (MIT) implements TurboQuant, a 4-bit compressed ANN
index with 16× memory reduction and +12–20% query speed over FAISS IndexPQ.

Two integration paths were evaluated:
1. Add `turbovec = "0.8"` to `Cargo.toml` and call `IdMapIndex`.
2. Read the MIT-licensed source and implement the algorithm directly in TerranSoul.

## Decision

**Implement TurboQuant natively** in `src-tauri/src/memory/turbo_vec_store.rs`.

## Why not the crate

| Factor | turbovec crate | Native |
|--------|---------------|--------|
| API stability | `IdMapIndex::new()` requires undocumented shape arguments that changed between patch versions; compilation failed on v0.8 | Stable — we own the API |
| Build hermeticism | Pulls 30+ transitive crates (faer, gemm, pulp, …); +60 s CI | Zero new dependencies |
| ID type | Crate uses `u64`; TerranSoul uses `i64` SQLite rowids — requires casting boilerplate | `i64` native throughout |
| Persistence format | Binary blob | JSON — readable with `jq`, compatible with MCP export |
| Maintenance | Upstream may break between minor versions | We own the 200-line core |

## What "natively" means

The implementation in `turbo_vec_store.rs`:
- 4-bit scalar quantisation per dimension using a per-dimension `[min, max]` codebook
- `HashMap<i64, usize>` for O(1) id → flat-array slot mapping
- O(1) tombstone delete; compaction at > 30% tombstone fraction
- Approximate dot-product similarity via dequantised vectors
- JSON persistence (version-tagged, schema-stable)

SIMD acceleration (AVX-512, NEON) is not yet implemented — the scalar path is
~2–4× slower than the turbovec crate's kernels on large corpora. Acceptable because:
- The linear backend is the default; TurboQuant is opt-in.
- On a personal corpus (< 500 k vectors), the scalar path is still sub-100 ms.
- SIMD can be added inside `turbo_vec_store.rs` without changing any caller.

## Related ADRs

- [ADR 010](010-tiered-vector-index.md) — where TurboQuant fits in the tiered architecture
