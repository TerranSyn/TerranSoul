# RAG_COMPARISON — TerranSoul's memory/graph/DB fragmentation vs. GYOM15/rag-vector-hybrid-graph

> **What this file is.** Owner ask 2026-07-30: *"Make sure that we learn from
> https://github.com/GYOM15/rag-vector-hybrid-graph to improve our RAG
> combining with my memory and graph and db. They are so fragmented."* This
> is an **architecture comparison**, not a scored benchmark — the external
> repo publishes retrieval-quality numbers (BEIR-style nDCG/recall/MRR on
> HotpotQA) for its OWN three internal stacks, but those numbers are not
> comparable to any TerranSoul number (different corpus, different task,
> different embedder) and none are cited here as if they were. Same
> discipline as `APERAG_COMPARISON.md`/`A-EVOLVE-COMPARISON.md`: read the
> source directly (shallow clone, not just the README), report what's
> actually there, and separate "what's genuinely well-designed" from "what's
> demo-scale and wouldn't survive production." No source, prompts, or
> branded identity were copied in this pass — see the "What to actually
> vendor" section at the end for what's recommended for a follow-up, per the
> owner's explicit go-ahead to copy from that repo if needed.
>
> Source: [github.com/GYOM15/rag-vector-hybrid-graph](https://github.com/GYOM15/rag-vector-hybrid-graph),
> MIT license, shallow-cloned and read directly 2026-07-30 (`src/pipeline.py`,
> `src/stack1_traditional/`, `src/stack2_hybrid/`, `src/stack3_graphrag/`,
> `src/shared/`, `app/streamlit_app.py`, `README.md`, `LICENSE`).

## 1. What the external repo actually is

**Not one hybrid system — a controlled comparative study of three separate,
independent RAG pipelines** run over the same corpus/chunking/prompt/LLM so
only the retriever varies (`src/pipeline.py::assemble_stacks`):

| Stack | Retrieval | Components |
|---|---|---|
| 1 — Vector | Dense-only cosine similarity | FAISS `IndexFlatIP` |
| 2 — "Hybrid" | Vector + lexical, fused by RRF | FAISS + `rank_bm25.BM25Okapi`, `rrf_k=60` |
| 3 — GraphRAG | Vector seeds + 1-hop entity-graph local search | spaCy NER + `networkx`, additive scoring |

The repo's own name is precise but easy to misread: **"hybrid" here means
vector+keyword** (Stack 2), and the graph is a **third, separate, non-fused**
stack — not "hybrid = vector+graph." All three share one thin `BaseRAG`
skeleton (`retrieve → build_prompt → llm_fn`, timed); each stack's own
`rag.py` adds nothing beyond that.

**Fusion (Stack 2):** pure Reciprocal Rank Fusion, no learned reranker in the
base pipeline:

```python
def reciprocal_rank_fusion(ranked_lists, rrf_k: int = 60) -> dict[int, float]:
    scores = {}
    for ranking in ranked_lists:
        for rank, idx in enumerate(ranking):
            scores[idx] = scores.get(idx, 0.0) + 1.0 / (rrf_k + rank)
    return scores
```

An optional cross-encoder rerank stage (`ms-marco-MiniLM-L-6-v2`) can wrap
*any* retriever post-hoc — off by default. The repo's own eval found the
replace-vs-fuse winner **flips per dataset**, reported as a negative,
non-generalizing result rather than hidden.

**Graph (Stack 3):** not community detection, not an LLM-typed knowledge
graph. A **co-occurrence entity graph** — one `chunk:{i}` node per chunk, one
`entity:{name}` node per spaCy-NER-extracted entity, `MENTIONS`
(chunk→entity) and `RELATED_TO` (entity↔entity, weighted by co-occurrence)
edges. Retrieval is 1-hop local search: vector seeds as a semantic floor,
plus entities matched from the query text linking to chunks directly
(`MENTIONS`) or one hop out (`RELATED_TO`, discounted 0.5×). The README says
outright: *"A true GraphRAG advantage would need LLM-extracted typed
relations + community summaries (out of scope)."*

**Memory:** none. Explicitly, twice, in the app's own docstring and UI
caption: *"the RAG has no conversational memory — each question is handled
independently."* The Streamlit session dict stores display history only,
never fed back into retrieval or the prompt.

**Storage:** none, in the database sense. FAISS is in-RAM (optional
flat-file sidecar, never actually invoked by the default app). BM25 rebuilds
in RAM on every process start. The graph is an in-RAM `networkx.Graph`,
never persisted. Repo-wide grep for `sqlite|postgres|sql|database` across
`src/`: **zero matches.** There is exactly one ingest pipeline building both
the FAISS index and the graph once per process — so within a run they can
never drift out of sync, but only because there is no persistence and no
update path to drift *from*: the corpus is rebuilt from scratch every start.

**What's genuinely well done, for a project this size:** a real held-out
validation sweep (not tuned on the test split) that root-caused and fixed an
actual graph-retrieval failure — an unnormalized entity-overlap boost let
"hub" chunks (e.g. a calendar page mentioning 53 countries) drown out
focused chunks, fixed with a BM25-style length-normalized boost
(`boost / entities_per_chunk ** 0.75`), raising HotpotQA nDCG@10 0.484 →
0.748; a committed-baseline CI regression gate (`eval/check_regression.py` +
`eval/baselines.json`) that fails the build if any stack's retrieval score
drops; and an honest separation of retrieval-quality eval (BEIR, no LLM,
deterministic) from end-to-end answer quality (EM/F1/RAGAS), with a stated
finding that they don't move together.

**What's demo-scale, stated candidly by the repo itself:** no persistence or
incremental-update story at all (full rebuild every run); no real database;
the graph is shallow 1-hop with no community detection; no conversational
memory; single-process/GIL-bound; and an explicit "Security & limitations"
section disclaiming no content moderation, input validation, rate limiting,
or prompt-injection defense — appropriate for a local single-user demo, not
a production deployment.

## 2. TerranSoul's own architecture, as it actually exists today

This is the part worth being unflinching about, because the owner's
"fragmented" concern turns out to be **confirmed at the code level, not just
a feeling**.

**Storage:** `internal module`'s `MemoryStore` is the one
canonical persistence object (SQLite by default; Postgres/SQL
Server/CassandraDB behind a `StorageBackend` trait for other deployments),
holding `memories`, `memory_edges`, `memory_communities`, `memories_fts` /
`memories_fts_cjk`, and `pending_embeddings`. Genuinely more capable than the
external repo on this axis — real persistence, real incremental
CRUD, multiple backend options, an optional sharded high-throughput write
engine for scale.

**Fusion:** `MemoryStore::hybrid_search_rrf_bounded` builds up to four peer
rankings (vector cosine, keyword/lexical, a CJK trigram channel, a
freshness fallback) and fuses them with the same primitive the external
repo uses — reciprocal rank fusion, `internal module` — then
applies post-fusion adjustments (freshness/importance boost, a graph-edge
boost, a contested-claim penalty, activation weighting, echo-collapse,
session diversification). On paper, richer than either of the external
repo's stacks.

**The fragmentation, confirmed by grep, not assumed:**

1. **The real GraphRAG module is never called by retrieval.**
   `internal module` is a genuine, more sophisticated system
   than the external repo's Stack 3 — greedy-modularity community detection
   (Louvain/Leiden-style, hierarchical, 5 levels), LLM-generated community
   summaries, dual-level (entity + community) search, its own internal RRF
   fusion. **Grep confirms `graph_rag` has zero occurrences in `internal module`.**
   None of `hybrid_search_rrf_bounded`, `hybrid_search_rrf`,
   `hybrid_search_rrf_with_intent`, `hybrid_search_rrf_diversified`,
   `hybrid_search_rrf_filtered`, or `search()` ever call it. Its only callers
   are a Tauri command (`graph_rag_search`/`graph_rag_search_routed`) and an
   MCP tool (`brain_graph_rag_search`) — both things a caller must
   *explicitly* invoke. The main chat/CLI ranking path only ever sees a much
   shallower signal: a direct 1-hop SQL read of `memory_edges`
   (`graph_neighbor_boosts`, `edge_degrees`) as a small multiplicative boost.
   **This is the single clearest fragmentation finding**: the better graph
   engine exists and works, but is architecturally a side door, not part of
   the main hallway — the exact opposite of the external repo's Stack 2,
   where fusion IS the main path for its two channels.

2. **At least five different retrieval code paths, not one entrypoint.**
   Desktop chat + CLI share `commands::chat::process_message` (the "ONE
   REASONING CORE" fix already landed there), which calls
   `hybrid_search_rrf_filtered` → `hybrid_search_rrf_bounded`. But
   `commands/internal module` has its OWN `retrieve_chat_rag_memories` (sync
   path) and a third, `retrieve_chat_rag_memories_reranked` (async path,
   with its own doc comment saying it exists specifically "to match"
   `commands::chat`'s function — i.e. a parallel reimplementation patched
   toward parity after the fact, not a shared call). The MCP gateway
   dispatches to yet another pair
   (`hybrid_search_rrf_diversified`/`hybrid_search_iterative`). The
   LongMemEval bench binary (`internal module`) reimplements retrieval
   directly against `MemoryStore` with its own 10+-mode dispatch, entirely
   bypassing `process_message`. Comment tags like `BENCH-MCP-an internal work item/3` and
   `BENCH-an internal work item` scattered through the codebase are the visible scar
   tissue of keeping these five paths in sync by hand rather than by
   sharing one function.

3. **Three different consistency guarantees for three "unified" signals.**
   A freshly-saved memory is *immediately* keyword-searchable (FTS5 triggers
   fire in the same transaction), *eventually* vector-searchable (embeddings
   drain from `pending_embeddings` on a background worker with backoff up to
   1 hour under failure), and *only conditionally and eventually*
   graph-connected — two separate settings gate two separate async LLM
   extraction passes (`auto_extract_edges`, default ON; `graph_extract_enabled`,
   default OFF, for the richer typed-entity extraction), both running
   **after** the primary save with the code comment *"Failures are
   swallowed — primary save succeeded"* (`commands/internal module:811`). The
   external repo's single-process, rebuild-every-run design sidesteps this
   entire class of problem by having no persistence to drift from; TerranSoul
   has the opposite, harder problem (a live, mutating store) and today
   solves it with three different strengths of guarantee rather than one.

## 3. Side-by-side

| Dimension | rag-vector-hybrid-graph | TerranSoul (today) |
|---|---|---|
| Deployment | Single Python process, in-RAM, rebuild-per-run | Single desktop app, embedded SQLite, persistent |
| Vector store | FAISS `IndexFlatIP`, in-RAM only | `usearch` HNSW / brute-force fallback, on-disk `vectors.usearch` |
| Keyword store | `rank_bm25`, rebuilt in RAM every start | SQLite FTS5, trigger-synced with `memories` transactionally |
| Fusion | RRF over 2 channels (vector+BM25), `k=60` | RRF over up to 4 channels + several post-fusion adjustments, `DEFAULT_RRF_K` |
| Graph | 1-hop co-occurrence, in-RAM, own separate stack | Two graphs: a real hierarchical-community GraphRAG (**not wired into ranking**) + a shallow 1-hop `memory_edges` boost (**is** wired in) |
| Memory/conversation state | None — explicitly stateless, documented twice | Persistent multi-turn memory is the whole product |
| Ingest consistency | Trivial — no persistence, nothing to keep in sync | Real and unsolved — 3 different lag/failure profiles across FTS/vector/graph |
| Retrieval entrypoints | One (`assemble_stacks` builds all three from shared state) | At least five, independently maintained, kept in parity by hand |
| Regression discipline | Committed-baseline CI gate on a small golden set | `bench-never-regress.md` — same spirit, enforced by convention/process rather than a lightweight per-commit CI check |
| Scale target | Single demo user, fixed 500-article corpus | Multi-device (CRDT sync), sharded write engine, up to postgres/mssql/cassandra backends |

## 4. What's actually worth adopting

Three concrete, checkable ideas, in order of cost:

1. **Check `graph_neighbor_boosts`/`edge_degrees` for the same hub-pollution
   failure mode the external repo found and fixed.** Both are unnormalized:
   a memory involved in many edges (a "hub" — e.g. a frequently-referenced
   project name) could dominate the boost the same way the external repo's
   unnormalized entity-overlap term did, for the same underlying reason
   (no length/degree normalization). The external repo's fix — divide by
   `degree ** p`, with `p` chosen via a held-out sweep, never tuned on the
   scoring split — is a direct, cheap, testable port. **No bench time
   needed to check whether the bug exists**: it's a code inspection plus a
   small unit test constructing a synthetic hub node, same shape as this
   session's other "reproduce first" fixes.
2. **Fuse `internal module`'s community-level signal as a genuine channel in
   `hybrid_search_rrf_bounded`, not a side door.** This is the concrete fix
   for the "fragmented" complaint: today the more sophisticated graph engine
   is strictly worse for the user than the shallow one, because it's
   unreachable from normal chat. Making it a fifth RRF input (behind a flag,
   default off until measured, per `bench-never-regress.md`) would let a
   `max`/`research`-tier turn actually benefit from community structure
   instead of requiring an explicit MCP/Tauri call. This is the single
   highest-leverage item in this document and is filed as its own
   milestones.md row below — real backend work, not a "few hours" wire.
3. **Consider a lightweight, committed-baseline regression check** on a
   small fixed slice (a handful of pinned questions with known-good
   retrieval orderings) that runs in the fast CI-exact gate, not just the
   documented-but-manual `bench-never-regress.md` discipline. This is
   process, not code — closer to what `MAX-100-14`/`MAX-100-12` are already
   building (ordering-invariant tests, a verdict-replay harness) than a new
   idea, but the external repo's version (one committed JSON, one script,
   fails the build) is worth citing as prior art for how small that can be.

**Not recommended for adoption:** the vector/keyword stack choices
themselves (FAISS, BM25, in-RAM rebuild) — TerranSoul's embedded,
persistent, incrementally-updated design is a strictly harder and more
capable problem than the external repo solves, and downgrading to
in-RAM/rebuild-per-run would be a regression, not an improvement. The value
here is in the graph-fusion and hub-normalization *ideas*, not the storage
technology.

## 5. What to actually vendor (if a follow-up chunk builds this)

Per the owner's explicit go-ahead to copy from the source repo: the only
piece worth vendoring near-verbatim is the **RRF implementation and the
hub-normalization formula shape** (`reciprocal_rank_fusion` in
`stack2_hybrid/fusion.py`, and the `boost / entities_per_chunk ** p`
pattern in the graph retriever) — both are small, self-contained, MIT-
licensed, and this repo's own `reciprocal_rank_fuse` already implements the
same RRF formula independently, so this is confirmation/cross-check
material rather than new code to import. Nothing else in the external repo
(FAISS wrapper, BM25 wrapper, Streamlit app, spaCy NER pipeline) has a
TerranSoul equivalent worth replacing — those subsystems are already more
capable on the TerranSoul side. Any vendored snippet must be credited in
`CREDITS.md` per this repo's own policy before it ships.

## 6. Action items filed to `rules/milestones.md`

See the new `RAG-FRAGMENT-1` row: fuse `internal module`'s community signal
into the main RRF ranking as a flagged, default-off channel, plus check
`graph_neighbor_boosts`/`edge_degrees` for the same unnormalized hub-boost
failure mode this comparison found in the external repo, before any bench
run is authorized.
