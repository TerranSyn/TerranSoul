# ADR 017 — TurboVec Phase 2: FWHT Rotation + Filtered Search + QuantMind Domain Types

**Status:** Accepted  
**Date:** 2026-06  
**Supersedes / extends:** ADR 016 (TurboVec scale & QuantMind extraction), ADR 011 (TurboQuant native)

---

## Context

ADR-016 deferred three turbovec crate features as explicit "future work":

1. **FWHT random rotation** — O(d log d) decorrelation pre-processing per vector
2. **Per-coordinate TQ+ calibration** — empirical percentile-based codebook bounds
3. **SIMD-blocked search kernels** — AVX-512/NEON accelerated linear scan

ADR-016 also introduced `extract_document_hierarchy` with domain-agnostic knowledge
cards. As TerranSoul ingests financial research documents (arXiv papers, news feeds,
thesis PDFs), the generic `KnowledgeCard` schema loses signal that downstream
retrieval and ranking depend on — asset classes, citation provenance, factor
categories.

This ADR delivers:
- Item 1 from the deferred list: **FWHT random rotation** implemented natively
- **Filtered search** (`search_filtered`) enabling SQL pre-filter → dense rerank
- **QuantMind domain types**: typed `KnowledgeKind` enum + `Citation` struct +
  `extract_document_hierarchy_typed` Tauri command

---

## Decision

### 1. FWHT Random Rotation

The Walsh-Hadamard Transform is implemented in-place inside `turbo_vec_store.rs`
as a pre-processing step applied symmetrically to stored and query vectors.

**Algorithm:**

1. Sample a Rademacher sign vector `s ∈ {−1, +1}^d` seeded with the golden-ratio
   constant `0x9e3779b97f4a7c15` (deterministic, reproducible across restarts).
2. Multiply each coordinate `v[i] *= s[i]`.
3. Run the butterfly WHT in-place over `padded_dims = next_power_of_2(dims)`,
   zero-padding if necessary.
4. Scale every coordinate by `1 / sqrt(padded_dims)`.

Because the same transform is applied to both stored vectors (at insert time) and
query vectors (at search time), cosine similarity is preserved exactly. The rotation
acts as a pseudo-random permutation that spreads energy across all dimensions,
eliminating the coordinate-concentration bias that degrades quantization recall on
real sentence-transformer embeddings.

**Expected recall improvement:** +2–4 pp at k=10 on nomic-embed-text embeddings
(per upstream turbovec benchmarks on similar distributions; not yet benchmarked on
TerranSoul corpora — tracked in specs/026-onyx-hybrid-search).

**Cost:**
- Rotation per vector: O(d log d) ≈ 0.15 ms at d=768 — negligible vs embedding
  generation (~50 ms).
- Memory: `rotation_signs: Vec<i8>` stored alongside the index — 768 bytes at d=768.

**Serialization:** `rotation_signs` are written into the v2 JSON index. Although
the signs are deterministically derived from the seed, persisting them guards against
future seed changes or seed-override configurations invalidating stored indexes.
v1 (MinMax) indexes load with `use_rotation = false`; rotation is never applied
retroactively, preserving backward compatibility.

### 2. Filtered Search

```rust
pub fn search_filtered(
    &self,
    query: &[f32],
    limit: usize,
    allowlist: &[i64],
) -> Vec<(i64, f32)>
```

Implementation: build a `HashSet<i64>` from `allowlist`, then run the existing
linear scan, skipping entries whose rowid is not present in the set.

**Complexity:** O(n_total) scan, O(1) allowlist check per entry — identical
asymptotic cost to unfiltered search but with constant overhead from the set lookup.

**Usage pattern (hybrid retrieval):**

```
SQL WHERE clause → matching rowids
  → search_filtered(query, limit, &rowids)
  → re-ranked top-k by dense cosine similarity
```

This enables metadata pre-filtering (date range, asset class, source) without
a separate ANN index per filter facet.

### 3. QuantMind Domain Types

The generic `KnowledgeCard` schema (from ADR-016) is extended with a typed
`KnowledgeKind` enum that captures the document provenance signals needed for
ranking and citation tracing.

**`KnowledgeKind` enum:**

| Variant | Fields | Inferred from |
|---|---|---|
| `Generic` | — | Default when no other pattern matches |
| `Paper` | `asset_classes: Vec<String>` | Source URL matches `arxiv.org` or ends `.pdf` |
| `News` | `source_url: String` | Source URL matches known news domains; `source_url` populated from the document `source` parameter |
| `Thesis` | `asset_classes: Vec<String>` | Content contains "thesis", "dissertation", or "investment thesis" signals; `asset_classes` extracted via `extract_asset_classes()` |
| `Factor` | `category: String` | Title or summary references a factor taxonomy term; `category` is one of `momentum`, `value`, `quality`, `multi_factor` |

**Thesis detection** (`infer_kind` Phase 3 addition): matches documents whose content
includes "investment thesis" or "portfolio thesis" keyword patterns, in addition to
source filenames containing "thesis" or "dissertation". `extract_asset_classes()` is
called to populate the `asset_classes` field with canonical names
(`equity`, `fixed_income`, `commodity`, `fx`, `crypto`) derived from term scanning.

**Factor detection** (`infer_kind` Phase 3 addition): matches documents referencing
momentum, value, quality, or diversified risk premia / multi-factor strategies. The
`category` field is set to one of four canonical values. Factor detection runs before
Paper detection so factor-strategy papers are classified as `Factor`, not `Paper`.

**`extract_asset_classes(content) -> Vec<String>`** (Phase 3 addition):
scans document text for canonical asset-class terms. Canonical output names:

| Output name | Source terms matched |
|---|---|
| `equity` | "equities", "equity", "stocks" |
| `fixed_income` | "bonds", "fixed income", "credit" |
| `commodity` | "commodities", "commodity", "futures" |
| `fx` | "forex", "fx", "currency", "currencies" |
| `crypto` | "crypto", "bitcoin", "cryptocurrency" |

**`Citation` struct:**

```rust
pub struct Citation {
    pub text: String,      // supporting passage (verbatim sentence)
    pub node_ref: String,  // section breadcrumb, e.g. "§3.2 Methodology"
}
```

`extract_citations()` applies lightweight NLP pattern matching — scanning for
attribution triggers — without requiring a second LLM call. **Phase 3 extended the
trigger list from 5 to 19 patterns:**

| Category | Patterns added |
|---|---|
| Original (5) | "according to", "study shows", "research indicates", "evidence suggests", "data shows" |
| Extended (14) | "research shows", "data suggests", "findings indicate", "results demonstrate", "cited in", "reference:", "see also", "as noted by", " per ", "source:", "the paper", "the study", "the report", "in their analysis" |

**`infer_kind(source_url, content) -> KnowledgeKind`** applies the heuristic
table above in priority order (Factor → Thesis → Paper → News → Generic); `Generic`
is the fallback. Note: the function signature uses `content` (not `title` + `summary`)
as a single combined document string.

**`extract_document_hierarchy_typed` Tauri command** wraps the existing
`extract_document_hierarchy` command, passing output through `infer_kind` and
`extract_citations` to produce `TypedKnowledgeCard` values. The untyped command
remains available for callers that do not need domain classification.

---

## What Was Implemented (Phase 3)

| Feature | Implementation notes |
|---|---|
| TQ+ per-coordinate calibration (`PerCoordStats`) | `PerCoordStats` struct with `means: Vec<f32>` and `scales: Vec<f32>` (inverse stddev). `calibrate_from_corpus()` computes stats from a raw embedding corpus. `apply_coord_norm()` applies `(v[i] - means[i]) * scales[i]` before rotation+quantization. `use_coord_norm: bool` field defaults to `false` for full backwards compatibility. `coord_means` / `coord_scales` / `use_coord_norm` serialized in v2 JSON schema; absent in v1 indexes → `coord_stats: None`. |
| Thesis detection in `infer_kind()` | Matches "investment thesis", "portfolio thesis" content signals + source filename heuristics; populates `asset_classes` via `extract_asset_classes()`. |
| Factor detection in `infer_kind()` | Matches momentum/value/quality/multi_factor taxonomy; `category` field set to one of four canonical values; runs before Paper detection. |
| `extract_asset_classes()` | Canonical asset class extraction: equity / fixed_income / commodity / fx / crypto; deduplicates output. |
| 14 new citation trigger patterns | Extended `extract_citations()` from 5 to 19 patterns covering "research shows", "findings indicate", "see also", "as noted by", "the paper", etc. |
| `News.source_url` population | `source_url` now populated from the document `source` parameter when it begins with `http`; empty string otherwise. |

## What Was Deferred (Still Future Work)

| Feature | Reason deferred | Tracking |
|---|---|---|
| SIMD-blocked search (NEON / AVX-512) | Linear scan adequate up to ~1 M vectors; requires profiling to justify; Windows CI has no AVX-512 runner | ADR 011 future-work note |
| Full QuantMind ingestion pipeline | PDF, arXiv, HTML connectors; connector framework not yet in place | specs/026-onyx-hybrid-search |

---

## Performance Impact

| Dimension | Value |
|---|---|
| Rotation per vector (d=768) | O(d log d) ≈ 0.15 ms — negligible vs ~50 ms embedding generation |
| Rotation memory overhead | `Vec<i8>` × d = 768 bytes at d=768 |
| Filtered search overhead | +O(allowlist_size) HashSet build per query |
| Recall expected (FWHT + 4-bit standardised) | +2–4 pp vs 4-bit standardised alone at k=10 on nomic-embed-text (not yet measured on TerranSoul corpora) |
| Binary size delta | Zero — no new crates |
| CI build time delta | Zero |

---

## Consequences

| Area | Impact |
|---|---|
| v2 JSON indexes | `rotation_signs` field added; old v2 indexes without the field load correctly (field defaults to deterministic re-derivation from seed for one migration cycle, then the field becomes required) |
| v1 (MinMax) indexes | Load with `use_rotation = false`; no rotation applied — fully backward compatible |
| New Tauri commands | `extract_document_hierarchy_typed` (added to `lib.rs` `invoke_handler`) |
| Existing `search()` API | Unchanged; `search_filtered()` is an additive overload |
| `KnowledgeCard` schema | Additive — `kind` and `citations` fields are optional in v1 cards; typed cards require `kind` |

---

## Related

- [ADR 016](016-turbovec-quantmind-scale.md) — vector-store scale & QuantMind extraction (superseded in part)
- [ADR 011](011-turboquant-native.md) — original TurboQuant native decision
- [ADR 010](010-tiered-vector-index.md) — tiered vector architecture
- [ADR 002](002-hybrid-rag-pipeline.md) — hybrid retrieval pipeline
- `src-tauri/src/memory/turbo_vec_store.rs`
- `src-tauri/src/brain/hierarchical_extraction.rs`
- `specs/026-onyx-hybrid-search` (planned — PDF/arXiv/HTML connector pipeline)
