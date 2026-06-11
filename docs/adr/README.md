# Architecture Decision Records (ADRs)

This directory documents significant architectural choices in TerranSoul —
ranked by uniqueness and foundational importance.
Each ADR explains the context, the decision, the alternatives considered,
and why the chosen approach was preferred.

> **How to read these:** Start with ADR 001 (brain architecture) to understand
> the core thesis. Everything else exists to serve it.

## Index

| # | Title | Status | What makes it unique |
|---|-------|--------|----------------------|
| [001](001-brain-and-memory-architecture.md) | Brain and memory architecture | Accepted | Three-tier memory, cognitive-kind decay, knowledge graph, 99.6% R@10 on LongMemEval-S |
| [002](002-hybrid-rag-pipeline.md) | Hybrid RAG pipeline (6-signal, RRF, intent gating) | Accepted | 4 parallel retrievers, query-intent gating, 91.4% token savings vs full-context |
| [003](003-mcp-single-source-of-truth.md) | MCP as the single source of truth | Accepted | Every agent (human + AI) shares one brain — no stale replicas |
| [004](004-brain-driven-self-improvement.md) | Brain-driven self-improvement doctrine | Accepted | Four mandatory principles; improvements go in brain SQL, not source code |
| [005](005-hive-protocol-crdt-sync.md) | Hive Protocol: CRDT offline-first multi-device sync | Accepted | Ed25519 + HLC + CRDT; P2P federation with no cloud server required |
| [006](006-vrm-avatar-and-motion-pipeline.md) | VRM avatar, motion tokens, streaming tag pipeline | Accepted | LLM generates `"wave"` tokens; library plays polished clips; live webcam also drives the rig |
| [007](007-tauri-2-desktop-runtime.md) | Tauri 2 as the desktop runtime | Accepted | 8 MB vs 150 MB bundle; transparent pet-mode window; full Rust OS access |
| [008](008-reasoning-rules-and-harness-modes.md) | Reasoning rules contract + harness modes | Accepted | 12 configurable disciplines injected into every prompt; observable in UI |
| [009](009-sqlite-for-memory.md) | SQLite as the primary memory store | Accepted | Zero server deps; FTS5; ACID; CRDT-mergeable; single-file backup |
| [010](010-tiered-vector-index.md) | Tiered vector-index architecture | Accepted | Linear → TurboQuant → IVF-PQ → HNSW; runtime-switchable; no MSVC dep by default |
| [011](011-turboquant-native.md) | TurboQuant implemented natively | Accepted | 16× compression; no external crate (API unstable); 200 loc; JSON persistence |
| [012](012-ollama-local-first-llm.md) | Ollama as the local-first LLM runtime | Accepted | RAM-adaptive model tier; pinned `num_ctx` to prevent KV-cache realloc |
| [013](013-vtuber-mode.md) | VTuber mode (MediaPipe + Kalidokit) | Accepted | Webcam drives VRM rig; reuses existing `@mediapipe/tasks-vision`; learn-from-owner |
| [014](014-gemma4-default-and-multimodal.md) | Gemma 4 12B default LLM + multimodal chat | Accepted | Vision + multilingual without embedding model; images flow to Ollama base64 |

---

## What makes TerranSoul architecturally distinctive

Most "AI companion" or "local RAG" projects pick 2–3 of these. TerranSoul ships all:

- **Persistent, brain-centric memory** — not optional RAG bolted on top of a chatbot
- **Self-improving via four documented principles** — decisions live in brain SQL, not `if` statements
- **Observable reasoning** — every discipline, tool call, and memory access is visible to the user
- **Offline-first federation** — Hive Protocol CRDT, no cloud server required
- **3D personalized avatar** — learns from the user's own face and motion; not static
- **Streaming motion generation** — LLM outputs motion tokens that drive the VRM rig live
- **Reproducible benchmark** — Zork proves cross-session memory compounds; `gemma4:e4b` → 350/350
