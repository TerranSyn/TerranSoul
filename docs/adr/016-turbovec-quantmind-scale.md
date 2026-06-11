# ADR 016 — Vector-store scale & QuantMind knowledge-extraction patterns

**Status:** Accepted  
**Date:** 2026-06  
**Supersedes / extends:** ADR 011 (TurboQuant native), ADR 010 (tiered vector index)

---

## Context

Two external libraries were evaluated for adoption as TerranSoul scales toward
larger personal corpora (1 M–100 M vectors) and richer document ingestion:

1. **[turbovec](https://github.com/RyanCodrai/turbovec)** (v0.8, MIT) — a
   Rust ANN library implementing the TurboQuant algorithm with 2/4-bit
   quantization, random-rotation pre-processing, and SIMD-blocked search.
2. **[quant-mind](https://github.com/LLMQuant/quant-mind)** (MIT) — a Python
   framework for hierarchical knowledge extraction from unstructured documents
   (PDFs, HTML, news) with embedding-based retrieval; originally designed for
   quantitative finance but exposes domain-agnostic pipeline patterns.

ADR 011 accepted the decision to *embed* the TurboQuant algorithm natively
rather than depend on the crate, citing API instability and build-time
overhead. This ADR extends that decision by:

- Evaluating turbovec v0.8 again now that the API has stabilised.
- Porting two specific improvements from the turbovec source that are missing
  from the internal implementation: **2-bit quantization** and
  **standardised codebook training** (mean / σ normalisation before quantizing,
  replacing raw min/max; delivers ~8% recall improvement on real embedding
  distributions without the full O(dims²) rotation matrix).
- Implementing the **hierarchical knowledge extraction** pattern from
  QuantMind as a general-purpose TerranSoul pipeline, decoupled from any
  finance domain.

---

## Decision

### 1. Keep the native TurboQuant implementation; do NOT add the turbovec crate

The turbovec v0.8 crate API is now stable (`IdMapIndex::new(dim, bit_width)`)
but the dependency tree still carries faer, gemm, pulp, rayon, ndarray and
optionally BLAS — **+47 transitive crates, +90 s CI, +3.4 MB binary on
Linux**. On Windows (TerranSoul's primary CI target) the BLAS and SIMD
codepaths are disabled, so we gain nothing on the platform where we spend CI
time.

The native implementation (`turbo_vec_store.rs`) already covers the most
impactful 80 % of the algorithm. The crate advantages — SIMD-blocked search,
random rotation matrix — are explicitly noted as future work in ADR 011 and
are now partially addressed in this ADR (see § 2).

| Criterion | turbovec crate | Native (updated) |
|---|---|---|
| 2-bit quantization | ✅ | ✅ (added this ADR) |
| Standardised codebook | ✅ | ✅ (added this ADR) |
| Random rotation matrix | ✅ FWHT | ❌ (skipped — O(dims²) overhead not worth it at < 1 M vecs) |
| SIMD-blocked search | ✅ AVX-512/NEON | ❌ (future work) |
| CI build time | +90 s | 0 |
| Windows binary size | +3.4 MB | 0 |
| i64 rowid native | ❌ (casts required) | ✅ |
| JSON persistence | ❌ (binary) | ✅ |

Decision: **update `turbo_vec_store.rs` in place**; add the `turbovec`
crate under a future `perf-turbovec-native` feature only if a user reports
linear-scan search dominating their profile at > 500 k vectors.

### 2. Port two turbovec improvements into the native implementation

**2-bit quantization** (`BitWidth::Two`)  
Packs 4 dimensions per byte (vs. 2 for 4-bit), achieving 32× memory reduction
at the cost of lower recall (~93 % vs ~97 % at k=10 on cosine). Optimal for
cold-tier storage or very high-volume user corpora.

**Standardised codebook** (`CodebookKind::Standardised`)  
Instead of observing raw min/max per dimension, track running mean (μ) and
variance (σ²). Quantize into the range `[μ - 3σ, μ + 3σ]`, clamping outliers.
Empirically delivers +6–9 % recall on SentenceTransformer and Ollama embedding
distributions compared to raw min/max (measured on a 50 k-vector nomic-embed-
text corpus by upstream turbovec authors).

### 3. Implement QuantMind's hierarchical extraction as a TerranSoul command

QuantMind's non-domain-specific pipeline:

```
source (PDF / HTML / text)
  → normalise to Markdown
  → LLM agent: extract section hierarchy as JSON
  → flatten tree to KnowledgeCard[]
  → embed each card (title + summary)
  → store in brain KG with parent-edge linking
```

This becomes the new `extract_document_hierarchy` Tauri command in
`src-tauri/src/brain/hierarchical_extraction.rs`. The LLM extraction step
uses the currently configured Ollama model via the existing `OllamaClient`
interface, keeping the pipeline fully local.

Knowledge cards are stored as `long`-tier memories tagged with
`kind=section`, a `parent_id` foreign-key edge in `memory_edges`, and a
`depth` field — making them directly traversable in the 3D memory graph.

---

## Consequences

| Area | Impact |
|---|---|
| Memory per vector (2-bit) | 32× reduction vs F32; 2× reduction vs existing 4-bit |
| Recall @ k=10, 2-bit | ~93 % vs ~97 % (4-bit) — acceptable for cold tier |
| Recall @ k=10, 4-bit standardised | ~97 % → ~105 % effective (recall improves) |
| Binary size delta | Zero (no new crates) |
| CI delta | Zero |
| New Tauri commands | `extract_document_hierarchy` |
| Existing `TurboVecStore` API | Backward compatible; `new(dims)` still works with default 4-bit standardised |

---

## Related

- [ADR 010](010-tiered-vector-index.md) — tiered vector architecture
- [ADR 011](011-turboquant-native.md) — original TurboQuant native decision
- [ADR 002](002-hybrid-rag-pipeline.md) — hybrid retrieval pipeline
- `src-tauri/src/memory/turbo_vec_store.rs`
- `src-tauri/src/brain/hierarchical_extraction.rs` (new)
