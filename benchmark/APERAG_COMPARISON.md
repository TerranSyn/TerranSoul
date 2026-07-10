# ApeRAG — architecture comparison (no benchmark numbers to cite)

> **What this file is.** [ApeRAG](https://github.com/apecloud/ApeRAG)
> (apecloud/ApeRAG, Apache-2.0, 1,275+ stars at time of access) is a
> production-grade **Agentic GraphRAG platform**: hybrid vector/full-text/
> graph/summary/vision retrieval, built-in tool-using agents, an MCP server
> for external AI assistants, and Kubernetes/Helm deployment for teams.
> Unlike [`A-EVOLVE-COMPARISON.md`](./A-EVOLVE-COMPARISON.md), **ApeRAG
> publishes no quantitative benchmark suite** (no scores, no leaderboard
> table anywhere in its README or docs) — its own repository was checked
> directly for one (`docs/en-US/*`, README, changelog) and none exists. This
> file is therefore an **architecture comparison**, not a stats table, the
> same way `docs/brain-advanced-design.md`'s "Memory infrastructure" row
> compares TerranSoul against Letta/Zep/Mem0 by design, not by number. No
> fabricated metric appears anywhere below.

## What ApeRAG is (as published)

- **Core pitch:** an "open, Agentic Graph RAG platform" — graph-based
  entity/relationship extraction over documents, tool-using agents, and both
  a RESTful API and an [MCP](https://modelcontextprotocol.io/) server for
  external clients (Dify, Claude Desktop, Cursor) to query a team's
  knowledge base.
- **Retrieval:** five index types — Vector, Full-text, Graph, Summary, and
  Vision — combined in a hybrid retrieval engine.
- **Graph RAG lineage:** a "deeply modified" fork of
  [LightRAG](https://github.com/HKUDS/LightRAG) (Guo, Xia, Yu, Ao, Huang,
  *"LightRAG: Simple and Fast Retrieval-Augmented Generation,"*
  [arXiv:2410.05779](https://arxiv.org/abs/2410.05779), MIT license), with
  ApeRAG's own additions being entity normalization/merging for cleaner
  graphs, plus production concurrency (Celery/Prefect distributed task
  queues) and stateless operation. TerranSoul's own GraphRAG lineage is
  different: hierarchical community detection adopted from
  `microsoft/graphrag` (`docs/brain-advanced-design.md`, chunks
  `GRAPHRAG-1a/1b/1c`, 2026-05-16) — same *category* of technique
  (entity/relationship graph over a document corpus), different upstream
  project, not a shared codebase.
- **Storage:** five separate backing services — PostgreSQL, Qdrant (vector),
  Elasticsearch (full-text), Neo4j (graph), and MinIO (object storage) —
  orchestrated via Docker Compose for local use or a Helm chart (with
  optional KubeBlocks-managed databases) for Kubernetes production
  deployment.
- **Stack:** FastAPI backend, Next.js frontend, Celery async task workers;
  an optional [MinerU](https://github.com/opendatalab/MinerU)-powered
  parsing service (`doc-ray`) for complex PDFs/tables/formulas, with an
  optional GPU profile.
- **Deployment shape:** explicitly multi-tenant, team/enterprise-oriented —
  "Enterprise Management" (audit logging, LLM model management, agent
  workflow management) is a named feature category.

## Architectural comparison — same problem class, different deployment shape

| Dimension | ApeRAG | TerranSoul |
|---|---|---|
| Deployment unit | Docker Compose (dev) or Kubernetes + Helm (production); 5 separate backing services | Single desktop app (Tauri + Rust), one embedded SQLite file — no external services to run |
| Target user | Teams / enterprises, multi-tenant knowledge bases | One person, one local-first companion |
| Vector store | Qdrant (external service) | `usearch` HNSW + IVF-PQ, embedded in-process, sharded at scale (`docs/brain-advanced-design.md` chronology, Chunks 16.10, 48.1–48.3) |
| Full-text store | Elasticsearch (external service) | SQLite FTS5, embedded in-process |
| Graph store | Neo4j (external service) | `memory_edges` table in the same SQLite file — no separate graph database |
| Graph RAG lineage | Modified LightRAG fork (arXiv:2410.05779) | `microsoft/graphrag`-derived hierarchical community detection (own implementation, `crates/memory/src/graph_rag.rs`) |
| Retrieval fusion | Hybrid vector + full-text + graph + summary + vision, per-index | Reciprocal rank fusion (Cormack 2009, `k=60`) over vector + keyword + freshness, plus graph-cascade and CRAG-gated re-retrieval (`AGENTIC-CORRECTIVE-RAG-GAP-CLOSURE`, 2026-07-10) |
| Agents | Built-in tool-using agents with MCP tool support | Coding self-improve engine (`SelfImproveEngine`) + chat-mode orchestrators (`deep_research.rs`, `agentic_verify_rank.rs`) |
| MCP support | Ships an MCP **server** so external assistants (Dify/Claude/Cursor) can query ApeRAG's knowledge base | Also ships an MCP **server** (`brain_*` tools, Axum JSON-RPC on `:7421`/`:7422`/`:7423`) for the identical purpose — external agents querying TerranSoul's own brain. Structurally the same integration point, independently arrived at. |
| Sync across devices | Not part of the published feature set (single deployed instance) | CRDT-based multi-device sync (`crdt_sync.rs`, HLC-ordered, opt-in Hive Protocol federation) |
| Multimodal / vision | A named "Vision" index type for images/charts/visual content | Per-conversation multimodal input (e.g. résumé PDFs in the JD-DEMO flow) — **not independently verified in this pass whether TerranSoul has an equivalent standing, searchable *vision index*** as opposed to per-turn image handling; flagged rather than guessed either way |
| License | Apache-2.0 | Proprietary, pre-release (per this repo's own `CLAUDE.md` vendoring policy) |

## Why no TerranSoul benchmark row exists

Same discipline as `A-EVOLVE-COMPARISON.md`: ApeRAG publishes no scored
benchmark for its retrieval or agent quality, so there is nothing numeric to
either match or contrast against TerranSoul's own measured results
(`COMPARISON.md`'s LongMemEval-S/LoCoMo numbers, `BOEING-COMPARISON.md`'s
vision self-improve loop). If ApeRAG or a third party publishes a scored
comparison in the future, it belongs in a new dated section here — not a
retrofit of the table above.

## Where the two projects actually overlap in spirit

Both are answering a similar question — "how do you get an LLM to reason
faithfully over a private document/knowledge corpus, with retrieval that
combines multiple signal types and a graph over entities" — but for
different deployment shapes: ApeRAG is infrastructure a team stands up
(five services, Kubernetes, multi-tenant), while TerranSoul is a single
embedded companion (one file, one process, no infrastructure to operate).
The MCP-server-for-external-agents pattern is the most concrete point of
genuine convergence: both projects independently decided that exposing the
knowledge base over MCP, rather than only through their own first-party UI,
was the right integration surface for 2026-era AI assistants.

Source: [github.com/apecloud/ApeRAG](https://github.com/apecloud/ApeRAG),
README and `docs/en-US/design/architecture.md`, accessed 2026-07-10.
