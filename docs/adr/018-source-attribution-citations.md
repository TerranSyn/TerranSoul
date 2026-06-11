# ADR 018 — Source Attribution Citations in Chat

**Status:** Accepted  
**Date:** 2026-06-07  
**Spec:** Spec 026 — Source Attribution Citations in Chat  
**Related ADRs:** [ADR 001](001-brain-and-memory-architecture.md), [ADR 002](002-hybrid-rag-pipeline.md), [ADR 007](007-tauri-2-desktop-runtime.md), [ADR 009](009-sqlite-for-memory.md)

---

## Context

When TerranSoul generates a response it performs a hybrid RAG retrieval step —
fetching relevant memory entries via vector ANN, keyword FTS5, and freshness
ranking — before constructing the Ollama prompt. The user has no visibility into
which memories influenced the response. Without attribution:

- Answers appear to come from nowhere, eroding trust.
- Factual errors cannot be traced back to a stale or incorrect memory.
- The user cannot audit what personal data was retrieved for a given turn.

Competing open-source tools (Onyx, PrivateGPT, Perplexity-style UIs) surface
citations using one of three delivery mechanisms: (1) REST polling, (2) SSE
stream injection, or (3) out-of-band IPC events.

---

## Decision

### 1. Tauri event, not HTTP endpoint

`SourceAttribution` is emitted as a Tauri `source_attribution` event immediately
after the **first LLM token** arrives. The frontend registers a listener once per
session startup and attaches the payload to the last assistant message.

**Why not an HTTP endpoint:**
- TerranSoul has no outward-facing HTTP server in production. Opening one solely
  for citation delivery would widen the attack surface and require CORS policy.
- Tauri IPC is already the contract for every other streaming primitive
  (`token_chunk`, `pipeline_log`, `think_chunk`). Adding a parallel HTTP channel
  would create two inconsistent transport layers.
- The event fires in less than 1 ms after the first token; HTTP round-trip on
  localhost would add ~3–10 ms and require a correlation ID scheme.

The event payload is:

```rust
pub struct SourceAttribution {
    pub citations: CitationMap,   // Vec<CitationEntry>
}
```

### 2. CitationMap deduplication contract

`CitationMap = Vec<CitationEntry>` is built by `build_citation_map()` in
`src-tauri/src/commands/streaming.rs`.

The deduplication contract is:

1. Iterate the retrieved `MemoryEntry` slice in retrieval rank order.
2. Insert `memory_id` into a `HashSet<i64>`; skip duplicates.
3. Assign stable 1-based `index` values (first unique occurrence wins).
4. Cap at `MAX_CITATIONS` entries (see §3).

"First occurrence wins" preserves the rank ordering produced by the hybrid
fusion step (`reciprocal_rank_fuse`), so the highest-confidence memory always
gets index `[1]`. The frontend renders badges in index order and stores the full
`CitationMap` in `citations_json` via the `update_message_citations` Tauri
command for persistence across sessions.

### 3. 8-citation cap rationale

`MAX_CITATIONS = 8` is a deliberate trade-off:

| Factor | Rationale |
|--------|-----------|
| Local context budget | A 600-char snippet per citation costs ~150 tokens. Eight citations = ~1,200 tokens, well inside the 2,048-token system-prompt budget for 4-bit quantised models (Gemma4 12B Q4). |
| Cognitive load | User studies on inline citations (Perplexity, Elicit) show diminishing utility beyond 6–8 sources per response. |
| RAG precision | Our hybrid pipeline's top-8 hits achieve R@8 > 99 % on LongMemEval-S; further hits are near-duplicates or low-confidence. |
| UI layout | `SourceCitations.vue` renders chips in a horizontal-scroll row; beyond 8 chips the row requires two scroll gestures on a 1440p display. |

The cap is a named constant (`MAX_CITATIONS`) in Rust, not an inline literal, so
it can be tuned via a future settings API without touching call sites.

### 4. Origin flag bitfield

Each `CitationEntry` carries an `origin: u8` bitfield that records which
retrieval paths contributed the entry:

| Bit | Hex | Meaning |
|-----|-----|---------|
| 0 | `0x1` | Vector ANN (cosine similarity via TurboVec) |
| 1 | `0x2` | Keyword FTS5 (SQLite full-text search) |
| 2 | `0x4` | Freshness boost (recency-reranked into top-k) |

Entries contributed by multiple retrievers carry ORed bits (e.g. `0x3` = vector
+ keyword). The frontend uses this field to render a small icon in the citation
popover indicating provenance. The bitfield is future-proof: bits 3–7 are
reserved for planned retrievers (graph traversal `0x8`, connector ingestion
`0x10`).

### 5. Why better than Onyx-style citation

Onyx (open-source enterprise RAG) surfaces citations by:
1. Storing retrieved chunks in a Postgres table keyed to a chat session.
2. Polling a `/api/citations/{session_id}` REST endpoint from the browser.
3. Rendering document cards with external URLs only.

TerranSoul's approach is superior in three dimensions:

| Dimension | Onyx | TerranSoul |
|-----------|------|------------|
| Latency | 50–200 ms REST polling | < 1 ms Tauri IPC event |
| Storage | Postgres (external service) | Local SQLite `citations_json` column — zero-latency, offline-capable |
| Semantic labels | Document title + URL | `cognitive_kind` (`semantic`, `episodic`, `procedural`, `judgment`) + `origin` bitfield — richer provenance signal for users debugging memory quality |
| Privacy | Chunks transit a server | All data stays in-process on the user's machine |

The richer semantic labels are possible because TerranSoul's memory layer already
classifies every entry at write time (`classify_cognitive_kind`). Onyx has no
equivalent concept: it treats all retrieved chunks as homogeneous document
fragments.

---

## Implementation summary

| Artifact | Role |
|----------|------|
| `src-tauri/src/commands/streaming.rs` | `CitationEntry`, `CitationMap`, `SourceAttribution` types; `build_citation_map()`; `format_numbered_rag_context()`; event emission after first token |
| `src-tauri/src/commands/chat.rs` | `update_message_citations` Tauri command — persists `CitationMap` JSON to `messages.citations_json` |
| `src/components/SourceCitations.vue` | Chip row UI with popover; horizontal-scroll; Escape-to-close |
| `src/components/ChatMessageList.vue` | Mounts `<SourceCitations>` below every AI bubble that has citations |
| `src/stores/conversation.ts` | `CitationEntry` TypeScript type; `source_attribution` event listener; `citations` field on `Message` |
| `src/types/index.ts` | `CitationEntry` export for shared use across store + components |

---

## Consequences

**Positive:**
- Users can audit which memories grounded each AI response.
- Stale or incorrect memory can be identified and corrected.
- Zero additional infrastructure: no HTTP server, no polling, no external DB.
- Persisted `citations_json` enables future "why did it say that?" tooling.

**Negative / risks:**
- `pending_citations` mutex in `AppState` is cleared at turn start; a race
  between two concurrent streams (not currently possible but planned for
  multi-agent mode) could emit the wrong citation map. Mitigation: add a
  per-turn correlation ID in a future spec.
- The 8-citation cap may feel insufficient for long-form research answers. A
  future setting (`max_citations_per_turn`) will make this user-configurable
  within the context budget constraint.
