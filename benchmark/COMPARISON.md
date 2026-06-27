# TerranSoul Memory — State-of-the-Art Comparison

> **Navigation:** This is the cross-system results matrix. For round-by-round narratives, see [terransoul/](terransoul/README.md). For per-task indexes (LongMemEval-S, LoCoMo MTEB, LoCoMo at scale, agentmemory quality), see the subfolders under `terransoul/`. For runner script flags, see [scripts/](scripts/README.md). For dataset provenance, see [fixtures/](fixtures/README.md). Top-level index: [README.md](README.md).
>
> **Historical iteration logs** (Round 1–7 of BENCH-AM, Phase TOP1
> Round 1, BENCH-MCP-PARITY, BENCH-MCP-LATENCY-1, BENCH-LCM-KG-HYDE-1,
> BENCH-ZORK-iter12, BENCH-ZORK-RERUN-1, and the superseded
> BENCH-ZORK-1.5 300-turn placeholder) moved to
> [`COMPARISON-archive.md`](COMPARISON-archive.md) by
> COMPARISON-CONDENSE-1 on 2026-05-28.

> Folder layout mirrors the convention from <https://github.com/rohitg00/agentmemory/tree/main/benchmark> (`benchmark/COMPARISON.md`).
> Reference fixture pinned commit: `ae8f061cd66093d7be1539c24da6d3e595531dd2`
> Last bench run: 2026-06-03 (BENCH-ZORK reliability fork — serving the brain's move every turn drives `gemma4:e4b` to a deterministic 350/350; AGI-pure arm 10–20 vs 0 controls; 0 MCP errors). Earlier: BENCH-ZORK-1.5 closed 2026-05-28 (spec 002–006, SC4 PASS, 0/1682 MCP errors). Write-up: `docs/LLM-Brain-Design-Research-Paper.md`.
> LongMemEval-S adapter: 2026-05-12 (BENCH-AM-5), full result verified 2026-05-11, gateway parity verified 2026-05-26 (BENCH-MCP-PARITY-3).
> Feature-matrix parity sweep: 2026-05-11 (BENCH-AM-7).

This page is TerranSoul's apples-to-apples retrieval-quality comparison against
multiple top-tier memory systems — not against any single project. It collects
results across four reproducible benchmarks:

1. **Concept-tagged corpus** (240 observations / 20 queries, MIT-licensed dataset originally published by rohitg00/agentmemory and pinned to the commit above). Used as one of many references.
2. **LongMemEval-S** (xiaowu0162/longmemeval-cleaned).
3. **LoCoMo / MTEB-style retrieval** (mteb/LoCoMo).
4. **ZorkGPT long-horizon task bench** (BENCH-ZORK-1.5, the 2-ep × 100-turn `gemma4:e4b` canonical that closed 2026-05-28; supersedes the BENCH-ZORK-iter12 `gemma3:4b` baseline).

Results are tracked through Phase BENCH-AM in [milestones.md](../rules/milestones.md). The latest canonical for each benchmark is below; the iteration trail is in the archive.

## Latest canonical per benchmark

| Benchmark | Latest run | TerranSoul headline | Date | Section |
|---|---|---|---|---|
| **LongMemEval-S** retrieval-only (500 questions, all types) | BENCH-AM-6/6.1 | `search`: **R@5 99.2 % / R@10 99.6 % / R@20 100.0 % / NDCG@10 91.3 % / MRR 92.6 %** — verified top-1 vs agentmemory (95.2 % R@5) and MemPalace (~96.6 % R@5) | 2026-05-11 | [§ LongMemEval-S](#longmemeval-s-verified-top-1-bench-am-66-1) |
| **agentmemory bench:quality** (concept-tagged, 240 obs / 20 queries) | regenerated 2026-06-25 | keyword-only `search`: **R@10 67.1 % / NDCG@10 98.2 % / MRR 100.0 %** (quality leader); `hybrid_search_rrf` no-vector: **R@10 66.8 % / NDCG@10 95.0 % / MRR 95.0 %** (production default, restored after the RRF regression fix `c560514e`) | 2026-06-25 | [§ Feature matrix](#feature-matrix-vs-agentmemory) |
| **MTEB LoCoMo retrieval** (250-query slice across 5 tasks) | BENCH-LCM-1 | `rrf`: **R@10 51.6 % / R@100 65.9 % / NDCG@10 41.5 % / MRR 41.4 %** — temporal-reasoning strong; multi-hop and open-domain are documented gaps requiring iterative retrieval | 2026-05-13 | [§ MTEB LoCoMo](#mteb-locomo-retrieval-adapter-bench-lcm-1) |
| **ZorkGPT long-horizon** (`gemma4:e4b` 4B) | BENCH-ZORK (spec 002–014 + K-series → reliability fork) | **AGI-pure:** the brain lifts the same 4B from **0** (both controls) to **10–20** and stops its fixation loops; cross-episode behavioural change verified (new room *Up a Tree* via reflection hydration); **0/1682 MCP errors**. **Reliability demonstration (taught solution):** serving the brain's move on *every* turn via an exception-safe orchestrator fork drives the 4B to a deterministic **350/350** (396/396 moves, 0 errors), vs a non-deterministic 73/177 under intermittent serving — isolating *delivery reliability* from model size | 2026-06-03 | [§ ZorkGPT bench](#zorkgpt--terransoul--long-horizon-task-bench-bench-zork-15-2026-05-28--pass) |

The research write-up — silent ingest, room-scoped reflection, prompt-as-snapshot, grammar-vs-strategy seed, and the **delivery-reliability** result (reliable serving lets a 4B finish where intermittent serving stalls) — is in [`docs/LLM-Brain-Design-Research-Paper.md`](../docs/LLM-Brain-Design-Research-Paper.md), published at the [project site](https://terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/). Per-turn result pages: [TaughtLocalLLM 350](https://terransyn.github.io/TerranSoul/zorkgpt/taughtLocalLLM/) and [Opus 4.8 (recall 350 / reasoning 50)](https://terransyn.github.io/TerranSoul/zorkgpt/claude-opus-4.8/).

## How to reproduce

```pwsh
# 1. Build the reference concept-tagged fixture (240 obs / 20 queries) into JSON.
node scripts/build-memory-quality-fixture.mjs

# 2. Run the bench (Rust, in-memory MemoryStore, deterministic embeddings).
Set-Location src-tauri
cargo bench --bench memory_quality --target-dir ../target-copilot-bench
Set-Location ..

# Reports land at:
#   target-copilot-bench/bench-results/memory_quality.json
#   target-copilot-bench/bench-results/memory_quality.md

# 3. Print the yearly token-savings calculator (default: 50 queries/day).
npm run brain:tokens

# 4. Smoke the LongMemEval-S adapter on a tiny built-in fixture.
npm run brain:longmem:sample

# 5. Prepare and run the full LongMemEval-S retrieval evaluation.
# The dataset is about 264 MB and the full run is intentionally owner-triggered.
npm run brain:longmem:prepare
npm run brain:longmem:run

# 6. ZorkGPT long-horizon bench (Docker required for jericho; ~2 h per canonical).
# Self-improve smoke (no Z-machine, ~30 s):
python benchmark/scripts/zork-bench/smoke_self_improve.py
# Canonical 2-ep × 100-turn:
docker build -t zork-bench -f benchmark/scripts/zork-bench/Dockerfile .
docker run --rm -v "<repo>/target-copilot-bench/bench-results/zork-bench-canonical:/out" \
  -v "<repo>/mcp-data:/mcp-data:ro" --add-host=host.docker.internal:host-gateway \
  zork-bench --arm terransoul-brain --episodes 2 --max-turns 100 \
  --mcp-host host.docker.internal --mcp-port 7423
```

The concept-tagged fixture is the canonical `dataset.ts` corpus, transpiled with esbuild and serialised as JSON. Re-running the fetcher against the same pinned commit always produces a byte-identical fixture (timestamps are anchored to `2026-01-01T00:00:00Z`). Attribution for the datasets lives in [CREDITS.md](../CREDITS.md).

## Methodology parity (concept-tagged corpus)

| Aspect | Reference `bench:quality` | TerranSoul `memory_quality` |
|---|---|---|
| Corpus | 240 observations / 30 sessions | identical (same JSON) |
| Queries | 20 concept-tagged labels | identical |
| Ground truth | `relevantObsIds` from concept-filter | identical |
| BM25 backend | hand-rolled `SearchIndex` | SQLite FTS5 + 6-signal hybrid scorer |
| Vector backend | deterministic 384-d hash | deterministic 384-d hash (same algo) |
| Vector backend (real) | `all-MiniLM-L6-v2` 384-d | `nomic-embed-text` 768-d (Ollama) |
| Metrics | Recall@5/10/20, P@5/10, NDCG@10, MRR | identical |

Algorithmic note: TerranSoul mirrors the reference deterministic hash embedding **exactly** (same modulo arithmetic, same `dims=384`, same `[title, narrative, ...concepts, ...facts].join(" ")` shape) so the dual-stream comparison is apples-to-apples and not biased by a different fake-embedding distribution.

## Feature matrix vs agentmemory

> Source for agentmemory column: <https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md#feature-matrix>
> TerranSoul column verified against [docs/brain-advanced-design.md](brain-advanced-design.md), [README.md](../README.md), and the live `MemoryStore` API.

| Capability | agentmemory | TerranSoul | Notes |
|---|---|---|---|
| Auto-capture | ✅ 12 lifecycle hooks | ✅ Per-message brain pipeline + Tauri command interceptors | TerranSoul captures every chat turn through `brain_memory.rs` and the conversation store. |
| Search strategy | BM25 + Vector + Graph | FTS5 + 1024-d Ollama embeds (`mxbai-embed-large`, default since BENCH-LCM-5; `nomic-embed-text` 768-d fallback) + RRF + LLM rerank + KG hop | TerranSoul adds HyDE and LLM-as-judge cross-encoder rerank. |
| Multi-agent coordination | ✅ Leases + signals + mesh | Partial — MCP gateway + `AppStateGateway`, no leases/signals primitive yet | Tracked in `rules/backlog.md`. |
| Framework lock-in | None | None | Tauri shell, library is plain Rust + Vue. |
| External deps | None | None (SQLite + optional Ollama) | Postgres/Cassandra/MSSQL backends optional. |
| Knowledge graph | ✅ Entity extraction + BFS | ✅ `memory_edges` + KG audit + edge versioning + typed-write `brain_add_edge` MCP tool (spec 003, 2026-05-28) | Includes contradiction resolution. |
| Memory decay | ✅ Ebbinghaus + tiered | ✅ Per-cognitive-kind half-lives + confidence decay | See `confidence_decay.rs`. |
| 4-tier consolidation | ✅ Working → episodic → semantic → procedural | ✅ Short / Working / Long with cognitive-kind shards (semantic, procedural, principle, episodic, analytical) | TerranSoul also has consolidation synthesis. |
| Version / supersession | ✅ Jaccard-based | ✅ V8 non-destructive edit history + `valid_to` soft-close | Audit trail per mutation. |
| Real-time viewer | ✅ Port 3113 | ✅ In-app `MemoryGraph.vue` (canvas + sigma WebGL) | Different deployment (in-app vs separate web port). |
| Privacy filtering | ✅ Strips secrets pre-store | ✅ `privacy::strip_secrets` pre-insert | Both fail-closed at the storage boundary. |
| Obsidian export | ✅ Built-in | ✅ One-way vault export (`obsidian_export.rs`) | TerranSoul also imports back. |
| Cross-agent | ✅ MCP + REST | ✅ MCP on three ports (`7421`/`7422`/`7423`) + AI gateway | Same shape. |
| Audit trail | ✅ All mutations logged | ✅ `audit.rs` per-mutation log | Same. |
| Language SDKs | Any (REST + MCP) | Any (MCP) + native Rust + Vue store APIs | TerranSoul does not ship a separate Python/TS SDK yet. |
| Token-efficiency calculator | ✅ `npx … status` | ✅ `npm run brain:tokens` + per-query bench report | Shipped in BENCH-AM-4. |
| **Self-healing local LLM provider probe** | ❌ | ✅ `brain_health.llm_provider_state` (live `/api/tags` Ollama probe, 2s timeout, healthy/degraded/unreachable) + PowerShell watchdog auto-restarts tray + `docker restart ollama` on outage (spec 005, 2026-05-28) | Tray watchdog covers the OS-level recovery path. |

### Intentional scope boundaries

BENCH-AM-7 reviewed the two rows where TerranSoul is intentionally not a one-for-one clone of agentmemory:

- **Leases / signals / mesh:** TerranSoul keeps MCP plus the Hive relay/federation layer as the external coordination boundary. A standalone in-memory lease mesh is not shipped in the core desktop memory module because it would duplicate Hive orchestration before there is a concrete cross-agent workflow that needs it.
- **Separate language SDKs:** TerranSoul keeps MCP, Tauri IPC, native Rust APIs, and Vue stores as the stable integration surfaces. Dedicated Python/TypeScript SDK packages are deferred by design until external adopters need versioned package distribution; shipping them now would duplicate schema/contracts without a real consumer.

We retain advantages they do not list: HyDE retrieval, LLM-as-judge cross-encoder rerank, Postgres/MSSQL/Cassandra storage backends, contextual retrieval (Anthropic 2024), CRDT device sync, the `brain_add_edge` typed-KG write tool (spec 003), and the `brain_health.llm_provider_state` self-healing probe (spec 005).

## Token efficiency

> Full per-query token report at `target-copilot-bench/bench-results/memory_quality.md`. Standalone calculator: `npm run brain:tokens`.

Baseline context cost on the pinned fixture:

| Baseline | Tokens per query | Yearly tokens at 50 queries/day |
|---|---:|---:|
| Full-context paste | 32,660 | 596.05M |
| 200-line MEMORY.md | 7,960 | 145.27M |

> **2026-06-25 regenerated** from `target-copilot-bench/bench-results/memory_quality.md` (the committed source of truth) after the RRF regression fix (commit `c560514e`). The P6 echo-collapse penalty (a 0.5× / 50% attenuation) had been dominating the ~2% RRF rank gaps and had collapsed `hybrid_search_rrf` no-vector to R@10 22.9% / NDCG 53.1%; bounding it to a ~2.5% tiebreaker (`EchoCollapseConfig.tiebreaker_compression`) restored it to R@10 66.8% / NDCG 95.0%. `AppStateGateway::search` (rrf) recovered 22.3% → 63.9% in the same fix. Keyword-only `search` is unchanged at 67.1%. Yearly-savings columns are derived from the per-row saved-percentage; values may drift ±0.2M from internal unrounded fractions.

| System | R@10 | NDCG@10 | MRR | Avg retrieved tokens/query | Saved vs full paste | Saved vs 200-line | Full-paste yearly savings | 200-line yearly savings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Built-in (CLAUDE.md / grep) | 55.8 % | 80.3 % | 82.5 % | 2,653 | 91.9 % | 66.7 % | 547.77M | 96.90M |
| Built-in (200-line MEMORY.md) | 37.8 % | 56.4 % | 65.5 % | 2,078 | 93.6 % | 73.9 % | 557.90M | 107.35M |
| **TerranSoul keyword-only `search` (quality leader)** | **67.1 %** | **98.2 %** | **100.0 %** | 8,245 | 74.8 % | -3.6 % | 445.85M | -5.23M |
| TerranSoul `hybrid_search` no-vector | 60.6 % | 90.2 % | 95.8 % | 2,770 | 91.5 % | 65.2 % | 545.39M | 94.72M |
| TerranSoul `hybrid_search` deterministic | 62.3 % | 91.5 % | 95.8 % | 2,841 | 91.3 % | 64.3 % | 544.19M | 93.41M |
| **TerranSoul `hybrid_search_rrf` no-vector (balanced)** | **66.8 %** | **95.0 %** | **95.0 %** | 2,748 | 91.6 % | 65.5 % | 545.98M | 95.15M |
| TerranSoul `hybrid_search_rrf` deterministic | 61.5 % | 91.3 % | 100.0 % | 2,834 | 91.3 % | 64.4 % | 544.19M | 93.55M |
| TerranSoul `AppStateGateway::search` (rrf, no vectors) | 63.9 % | 90.0 % | 90.0 % | 2,747 | 91.6 % | 65.5 % | 545.98M | 95.15M |

**Verdict:** TerranSoul has a standalone token-savings CLI and a per-query token report, closing the agentmemory comparison gap. After the 2026-06-25 RRF regression fix, no-vector RRF is the production default: it lands at R@10 66.8% / NDCG@10 95.0% — within 0.3 pp Recall@10 of the keyword-only quality leader (67.1%) — while cutting retrieved context from 8,245 to 2,748 tokens/query (vs the keyword path's full-token cost). The gateway path (`AppStateGateway::search` rrf) recovered to 63.9% in the same fix.

## LongMemEval-S verified top-1 (BENCH-AM-6/6.1)

BENCH-AM-6 ran the full 500-question LongMemEval-S cleaned set and BENCH-AM-6.1 closed the remaining rank-order gaps. The final improvement came from corpus-aware lexical weighting in `MemoryStore::search`: the reranker computes term rarity across the candidate pool so rare anchors (names, objects, domain terms) rank above generic filler words, with light query variants for common natural-language forms.

This is the same retrieval-only shape used by agentmemory's LongMemEval-S script: each question builds a fresh in-memory index from its haystack sessions, searches with the raw question, and checks `answer_session_ids`. It is not official end-to-end LongMemEval QA accuracy.

| System | R@5 | R@10 | R@20 | NDCG@10 | MRR | Source |
|---|---:|---:|---:|---:|---:|---|
| **TerranSoul `search`** | **99.2 %** | **99.6 %** | **100.0 %** | **91.3 %** | **92.6 %** | `target-copilot-bench/bench-results/longmemeval_s_terransoul.md` |
| TerranSoul `rrf` | 99.0 % | 99.6 % | 100.0 % | 91.0 % | 92.0 % | same run |
| agentmemory LongMemEval-S | 95.2 % | 98.6 % | 99.4 % | 87.9 % | 88.2 % | upstream published row |
| MemPalace LongMemEval-S | ~96.6 % | — | — | — | — | MemPalace paper |

Per-type `search` R@5: single-session-user 100.0 %, multi-session 98.5 %, single-session-preference 100.0 %, temporal-reasoning 99.2 %, knowledge-update 98.7 %, single-session-assistant 100.0 %.

Adapter runbook: [docs/longmemeval-s-adapter.md](longmemeval-s-adapter.md).

## MTEB LoCoMo retrieval adapter (BENCH-LCM-1)

BENCH-LCM-1 adds a direct MTEB LoCoMo retrieval runner so TerranSoul has an apples-to-apples qrel table instead of only citing mixed LoCoMo QA numbers from other systems. The adapter reads the pinned `mteb/LoCoMo` parquet configs (`single_hop`, `multi_hop`, `temporal_reasoning`, `open_domain`, `adversarial`), inserts each task corpus into a fresh in-memory `MemoryStore` through the existing JSONL IPC shim, and computes retrieval-only IR metrics over `*-qrels`.

Runbook: [docs/locomo-mteb-adapter.md](locomo-mteb-adapter.md).

The first broad verified slice covers 250 queries total (`50` per task):

| System | Queries | R@1 | R@5 | R@10 | R@20 | R@100 | NDCG@10 | MAP@10 | MRR@100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TerranSoul `search` | 250 | 28.9 % | 46.6 % | 51.3 % | 57.5 % | 65.9 % | 40.9 % | 36.3 % | 40.5 % |
| TerranSoul `rrf` | 250 | 29.4 % | 46.8 % | 51.6 % | 57.3 % | 65.9 % | 41.5 % | 36.9 % | 41.4 % |

Per-task signal: temporal reasoning is already strong (R@10 90.0 %, NDCG@10 78.4 % for both modes), while `multi_hop` and `open_domain` are the clear gaps. Those tasks likely need query decomposition and/or a stronger semantic retrieval pass before TerranSoul can claim a leading LoCoMo retrieval score. This MTEB table is **not** comparable to Mem0/Letta/MemPalace LoCoMo QA accuracy; those remain separate published-context rows below.

## Comparison with all top-tier agent-memory systems

> User asked for a comparison with every top-tier agent-memory system at the level of agentmemory's [COMPARISON.md](https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md). Direct apples-to-apples requires running each system through the same harness, which means each project's source has to build and run on this workstation. Below is a verified snapshot of what is comparable today, plus published numbers cited with their original benchmark. TerranSoul now has directly run LongMemEval-S, MTEB LoCoMo retrieval, and the ZorkGPT long-horizon bench; other systems remain published-source comparisons unless their codebases are brought into this workspace.

### Quality numbers (mixed benchmarks — read the "Benchmark" column)

| System | Benchmark | Recall@K / Score | NDCG@10 | MRR | Source | Directly run? |
|---|---|---|---|---|---|---|
| **TerranSoul `search`** | LongMemEval-S retrieval-only | **R@5 99.2 % / R@10 99.6 % / R@20 100.0 %** | **91.3 %** | **92.6 %** | this repo, BENCH-AM-6/6.1 | ✅ this repo |
| TerranSoul `rrf` | LongMemEval-S retrieval-only | R@5 99.0 % / R@10 99.6 % / R@20 100.0 % | 91.0 % | 92.0 % | this repo, BENCH-AM-6/6.1 | ✅ this repo |
| **TerranSoul keyword-only `search` (regenerated 2026-06-25)** | agentmemory bench:quality | **R@10 67.1 %** | **98.2 %** | **100.0 %** | this doc | ✅ this repo |
| **TerranSoul `hybrid_search_rrf` no-vector (regenerated 2026-06-25, post RRF-fix)** | agentmemory bench:quality | **R@10 66.8 %** | **95.0 %** | **95.0 %** | this doc | ✅ this repo |
| TerranSoul `rrf` | MTEB LoCoMo retrieval-only, 250-query slice | R@10 51.6 % / R@100 65.9 % | 41.5 % | 41.4 % | [docs/locomo-mteb-adapter.md](locomo-mteb-adapter.md) | ✅ this repo |
| TerranSoul `search` | MTEB LoCoMo retrieval-only, 250-query slice | R@10 51.3 % / R@100 65.9 % | 40.9 % | 40.5 % | [docs/locomo-mteb-adapter.md](locomo-mteb-adapter.md) | ✅ this repo |
| **TerranSoul brain (ZorkGPT bridge)** | ZorkGPT long-horizon, `gemma4:e4b`, 2-ep × 100-turn | **SC4 PASS** — cross-episode behavioural change (new room *Up a Tree* reached in ep2 via reflection hydration); 0/1682 MCP errors | n/a (long-horizon, not IR) | n/a | this repo, BENCH-ZORK-1.5 (spec series 002–006) | ✅ this repo |
| agentmemory dual-stream | agentmemory bench:quality | R@10 58.6 % | 84.7 % | 95.4 % | upstream `QUALITY.md` | port pending |
| agentmemory built-in (CLAUDE.md / grep) | agentmemory bench:quality | R@10 55.8 % | 80.3 % | 82.5 % | upstream `QUALITY.md` | ✅ mirrored in this repo |
| agentmemory built-in (200-line MEMORY.md cap) | agentmemory bench:quality | R@10 37.8 % | 56.4 % | 65.5 % | upstream `QUALITY.md` | ✅ mirrored in this repo |
| agentmemory dual-stream | LongMemEval-S retrieval-only | R@5 95.2 % / R@10 98.6 % / R@20 99.4 % | 87.9 % | 88.2 % | upstream README + LongMemEval-S | published upstream |
| MemPalace (best published) | LongMemEval-S | ~96.6 % R@5 | — | — | <https://arxiv.org/abs/2503.06868> | published upstream |
| Mem0 | LoCoMo (QA, J score) | 68.5 % | — | — | <https://arxiv.org/abs/2504.19413> | different bench (QA, not retrieval-only) |
| Letta / MemGPT | LoCoMo (QA, J score) | 83.2 % | — | — | <https://arxiv.org/abs/2310.08560> + Letta blog | different bench (QA, not retrieval-only) |
| Zep | LoCoMo (QA, J score) | 34.53 % | — | — | <https://arxiv.org/abs/2504.19413> Table 2 | different bench |
| Cognee | LoCoMo (QA, J score) | (varies) | — | — | <https://arxiv.org/abs/2504.19413> Table 2 | different bench |
| A-Mem | n/a published IR numbers | — | — | — | <https://github.com/jamez-bondos/A-Mem> | no IR numbers published |
| claude-mem | qualitative | "~10× token savings" | — | — | <https://github.com/thomasvuylsteke/claude-mem> | no IR numbers published |
| Hippo (HippoRAG) | MuSiQue / HotpotQA | F1 ≈ 65–70 % on multi-hop QA | — | — | <https://arxiv.org/abs/2405.14831> | different bench |
| Khoj | n/a published IR numbers | personal-AI features, no IR bench | — | — | <https://github.com/khoj-ai/khoj> | no IR numbers published |

Caveats:

- **Cross-benchmark numbers are not directly comparable.** LongMemEval-S, MTEB LoCoMo retrieval, LoCoMo QA, MuSiQue, and the ZorkGPT long-horizon harness have completely different corpora, ground-truth shapes, and judge models. They are listed here so a reader who knows those benchmarks can place each system on a familiar yardstick.
- TerranSoul cannot self-run Mem0 / Letta / MemPalace / HippoRAG / Zep without their codebases. BENCH-AM-6/6.1 provides a verified TerranSoul number on the same LongMemEval-S retrieval-only table used by agentmemory (95.2 % R@5) and MemPalace (~96.6 % R@5).
- claude-mem, Khoj, and A-Mem publish capability descriptions but not IR-style retrieval numbers. They appear in the feature matrix below; they cannot appear in the numeric table.
- **Mem0 / Letta / Zep / Cognee "LoCoMo" numbers are end-to-end QA accuracy (J score)** — not retrieval recall. Treating them as comparable to TerranSoul's retrieval rows would either falsely flatter TerranSoul (retrieval ≫ end-to-end on Mem0 paper numbers) or falsely punish it. The honest comparison shape is LongMemEval-S retrieval (where TerranSoul, agentmemory, and MemPalace all overlap).

### Feature matrix vs top-tier systems

Legend: ✅ ships, ◐ partial, ❌ missing, n/a not applicable.

| Capability | TerranSoul | agentmemory | Mem0 | Letta | MemPalace | claude-mem | Hippo | Khoj |
|---|---|---|---|---|---|---|---|---|
| Hybrid lexical + vector search | ✅ FTS5 + embeddings + RRF | ✅ BM25 + Vector | ✅ | ✅ | ✅ | ◐ summaries | ✅ | ✅ |
| Knowledge graph hop | ✅ `memory_edges` + typed-write `brain_add_edge` | ✅ | ◐ | ✅ | ✅ | ❌ | ✅ PPR | ❌ |
| Per-cognitive-kind decay | ✅ 5 kinds | ✅ Ebbinghaus | ❌ | ◐ | ◐ | ❌ | ❌ | ❌ |
| HyDE | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| LLM-as-judge cross-encoder rerank | ✅ | ❌ | ❌ | ❌ | ◐ | ❌ | ❌ | ❌ |
| Contextual Retrieval (Anthropic 2024) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Contradiction / conflict resolution | ✅ | ◐ | ◐ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Non-destructive edit history | ✅ V8 + valid_to | ◐ | ◐ | ✅ | ✅ | ❌ | ❌ | ❌ |
| MCP server | ✅ 3 ports | ✅ | ◐ | ✅ | ❌ | ✅ Claude-only | ❌ | ❌ |
| Local-first / offline-capable | ✅ Ollama | ✅ | ❌ cloud-first | ◐ | ❌ | ✅ Claude-only | ✅ | ✅ |
| Multiple storage backends | ✅ SQLite/PG/MSSQL/Cassandra | ◐ SQLite | ✅ many | ◐ Postgres | ◐ | ❌ | ❌ | ◐ |
| Privacy / secret stripping | ✅ pre-insert | ✅ | ◐ | ◐ | ❌ | ◐ | ❌ | ◐ |
| CRDT device sync | ✅ QUIC/WS | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ |
| Real-time UI viewer | ✅ in-app graph | ✅ port 3113 | ◐ web | ✅ ADE | ❌ | ❌ | ❌ | ✅ |
| Multi-agent leases / signals / mesh | ◐ MCP gateway + Hive relay; standalone lease mesh out of scope for core memory | ✅ | ◐ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Language SDKs / integration API | ◐ MCP + Tauri/Rust/Vue APIs; separate SDK packages deferred by design | ✅ REST + MCP | ✅ | ✅ | ❌ | ❌ | ❌ | ◐ |
| Token-savings CLI calculator | ✅ `npm run brain:tokens` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Self-healing local LLM provider probe | ✅ `brain_health.llm_provider_state` + PowerShell watchdog | ❌ | n/a (cloud) | ❌ | ❌ | n/a | ❌ | ❌ |
| LongMemEval-S verified number | ✅ R@5 99.2 %, R@10 99.6 %, R@20 100.0 %, NDCG@10 91.3 %, MRR 92.6 % | ✅ 95.2 % R@5 | ❌ | ❌ | ✅ ~96.6 % R@5 | ❌ | ❌ | ❌ |
| ZorkGPT long-horizon verified | ✅ SC4 PASS (BENCH-ZORK-1.5, spec series 002–006, `gemma4:e4b`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

TerranSoul is the only system on this matrix that ships all of {HyDE, LLM-as-judge rerank, Contextual Retrieval, CRDT device sync, four production storage backends, typed-KG write tool, self-healing local LLM provider probe, ZorkGPT long-horizon verified bench}. BENCH-AM-7 documents the two non-green rows as deliberate scope boundaries, so no BENCH-AM feature-matrix blocker remains.

### Architectural comparison vs adopted reference architectures (Hermes-Agent · GENesis-AGI · OpenClaw)

These three are *reference architectures TerranSoul studied and adopted patterns from* — see [CREDITS.md](https://github.com/TerranSyn/TerranSoulApp/blob/main/CREDITS.md) and `docs/{hermes-agent-adoption,genesis-agi-brain-adoption,hermes-vs-openclaw-analysis}.md` — **not** memory engines we can self-run. As with the Mem0 / Letta / MemPalace rows above, this matrix is a **capability comparison** sourced from each project's public docs + our adoption studies; **measured head-to-head judge scores for OpenClaw and Hermes-Agent are in the table below** (GENesis-AGI cannot be scored on a same-model bench — see the footnotes). We publish **no invented scores**. TerranSoul cells mark shipped capabilities ✅; adoption deltas that are *speced but not yet shipped* are marked ◐ and detailed in the adoption docs.

Legend: ✅ ships · ◐ partial / planned · ❌ missing or not-a-goal · — unclear from public docs.

| Capability | TerranSoul (brain) | Hermes-Agent (Nous Research) | GENesis-AGI (WingedGuardian) | OpenClaw |
|---|---|---|---|---|
| License | proprietary (this repo) | MIT | open source (verify upstream) | MIT |
| Primary purpose | local-first self-improving **memory brain** for any agent (over MCP) | self-hosted self-improving **personal agent** | autonomous **cognitive agent** ("personal proto-AGI") | config-first self-hosted **personal assistant** (omni-channel) |
| Reasoning engine | local Ollama (`gemma4:12b-it-qat`) + cloud fallback | any LLM (local/cloud) | Claude Code (cloud) | any LLM (Claude / GPT / Gemini / DeepSeek) |
| Memory store | SQLite (+PG/MSSQL/Cassandra), single source of truth | Markdown state files (USER/MEMORY.md) + SQLite FTS5 | SQLite + Markdown | per-agent config + memory (`SOUL.md`) |
| Tiered memory | ✅ 3-tier (short / working / long) | ✅ 3-tier (state files → FTS5 + summaries → external providers) | ✅ compounding long-term | ◐ |
| Hybrid lexical+vector retrieval (RRF) | ✅ FTS5 + embeddings + RRF + HyDE + cross-encoder | ◐ FTS5 keyword + LLM summarization (no vector/RRF surfaced) | ✅ RRF (k=60) + activation scoring | ❌ (not a retrieval/RAG engine) |
| Typed knowledge graph | ✅ `memory_edges` + `brain_add_edge` write tool | ❌ | ✅ typed KG + decay | ❌ |
| Self-improvement loop | ◐ outcome-classified write-back + procedural reinforcement ship; GENesis-style confidence ladder + Hermes skill synthesis speced | ✅ autonomous skill synthesis (DSPy + GEPA self-evolution) | ✅ post-session outcome classification + causal attribution + procedure extraction | ◐ community skills; no self-evolution surfaced |
| Procedural memory / confidence tiers | ◐ `procedural.rs` ships; Laplace L4→L1 ladder speced (GENesis adoption) | ◐ skills self-improve in use | ✅ confidence-tiered (Laplace) | ❌ |
| Autonomous skill creation (Markdown) | ◐ optimize / import today; synthesis = HERMES-ADOPT (speced) | ✅ Markdown skills (agentskills.io standard) | ◐ procedure extraction | ✅ community skill catalog (~13.7k) |
| Earned / graduated autonomy | ◐ role-gated actions | ◐ | ✅ trust per action category | ◐ |
| Local-first / offline-capable | ✅ Ollama, fully offline | ✅ | ◐ depends on Claude Code (cloud engine) | ◐ depends on chosen LLM |
| MCP server | ✅ 3 ports | ✅ (`mcp_servers:` YAML) | ◐ | ✅ |
| Omni-channel chat (WhatsApp / Telegram / …) | ❌ (in-app + MCP clients) | ◐ | ❌ | ✅ 20+ channels |
| 3D VRM character + voice | ✅ Tauri / Vue / VRM + TTS / ASR | ❌ | ❌ | ❌ |
| CRDT cross-device sync | ✅ QUIC / WS | ❌ | ❌ | ◐ |
| Config model | JSON-first (also *writes* Hermes YAML) | YAML (`cli-config.yaml`) | scripted install | **config-first** (`SOUL.md`) |
| Verified retrieval bench (LongMemEval-S) | ✅ R@5 99.2 % (this repo) | — not published on this bench | — | — |
| Verified long-horizon bench (ZorkGPT) | ✅ SC4 PASS | — | — | — |

**What TerranSoul adopted from each** (generic Rust reimplementations — no source, prompts, schema, or branded identity copied):
- **Hermes-Agent** → autonomous skill synthesis from observed successful trajectories (the closed `TRIGGER → AUTHOR → VALIDATE → REGISTER → REUSE → REFINE` loop; proposed `brain/skill_synthesizer.rs`, milestones HERMES-ADOPT-1..6) + first-class MCP YAML auto-setup. Spec: [`docs/hermes-agent-adoption.md`](../docs/hermes-agent-adoption.md).
- **GENesis-AGI** → outcome-classified self-learning loop + confidence-tiered procedural memory (Laplace, L4→L1 promotion/demotion/quarantine) + unified activation ranking + consolidation safety gates. Spec: [`docs/genesis-agi-brain-adoption.md`](../docs/genesis-agi-brain-adoption.md).
- **OpenClaw** → config-first agent UX + slash-command / session-design inspiration (studied alongside Claude Code). Analysis: [`docs/hermes-vs-openclaw-analysis.md`](../docs/hermes-vs-openclaw-analysis.md).

#### Measured head-to-head (parity-personal-ai)

Each system's **real CLI** answers the **same 22 prompts** (7 archetypes) on the **same local model `gemma4:12b-it-qat`**, with the **same injected context** and the **same LLM judge** (`gemma4:12b-it-qat`, 0–10), via [`run-headtohead.mjs`](parity-personal-ai/run-headtohead.mjs) — isolating the assistant pipeline, not the model.

| System | Quality (judge 0–10) | Success | Latency p50 | Measured |
|---|---:|---:|---:|---|
| **TerranSoul** (brain → Ollama) | **9.82** | 22/22 | 1.0 s¹ | 2026-06-07 |
| OpenJarvis (Stanford SAIL) | 9.55 | 22/22 | 3.2 s¹ | 2026-06-07 |
| **OpenClaw** (`agent --local`) | **8.36** | 22/22 | 38.1 s² | 2026-06-27 |
| **Hermes-Agent** (`-z` one-shot) | **6.90** | 21/22³ | 10.9 s² | 2026-06-27 |
| GENesis-AGI | **n/a**⁴ | — | — | — |

¹ TerranSoul/OpenJarvis latency is **inference-only** (excludes CLI cold-start). ² OpenClaw/Hermes latency is **wall-clock including the per-call CLI cold-start** (Node/Python process spawn) — *not* comparable to ¹; **quality is the apples-to-apples metric**. OpenClaw additionally runs its full agent loop each turn (hence the high p50). ³ Hermes: 1/22 prompts (`vrm-overlay/vo-3`) hit the 240 s timeout and is excluded from its mean. ⁴ **GENesis-AGI's reasoning engine is Claude Code (cloud)** and it requires an Incus container — it cannot run on the local `gemma4:12b-it-qat`, so a same-model head-to-head is architecturally impossible; we report **n/a** rather than a model-confounded or fabricated number.

**Method note.** TerranSoul + OpenJarvis rows are the **2026-06-07** canonical run (recovered from git `08676f10` into the cited JSON, which now holds all four systems with a `measured_date` per row); OpenClaw + Hermes were measured **2026-06-27** — identical harness, model, judge, and prompts, so directly comparable modulo run-to-run judge variance. Each system runs its *real* pipeline at equal injected context (TerranSoul retrieves via its brain; OpenClaw runs its agent; Hermes/OpenJarvis single-pass). Runners under [`parity-personal-ai/runners/`](parity-personal-ai/runners/); raw per-prompt output for all four in `target-copilot-bench/bench-results/parity_headtohead_4way.json` (the 2-system `parity_headtohead.json` remains the canonical TerranSoul-vs-OpenJarvis run that feeds the public leaderboard). Reproduce OpenClaw/Hermes: `node benchmark/parity-personal-ai/run-headtohead.mjs --system=openclaw,hermes` (OpenClaw via its Ollama-configured `bench` profile; Hermes via `HERMES_BENCH_HOME` → an Ollama-configured home); TerranSoul/OpenJarvis via `--system=terransoul,openjarvis` (needs the MCP brain server + OpenJarvis CLI).

Sources: [openclaw/openclaw](https://github.com/openclaw/openclaw) (MIT) · [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent) (MIT) · [WingedGuardian/GENesis-AGI](https://github.com/WingedGuardian/GENesis-AGI) · plus the in-repo adoption studies cited above.

## ZorkGPT × TerranSoul — long-horizon task bench (BENCH-ZORK-1.5, 2026-05-28) — **PASS**

Long-horizon task harness where the *same* agent stack (Agent/Critic/Extractor LMs + Jericho + Map) runs against *the same game* (Zork 1, `zork1.z5`) — and **only the memory/knowledge substrate is swapped**. Full setup, methodology, threats to validity, pass criteria, raw transcripts, and the iter1–iter17 history in [terransoul/zorkgpt/README.md](terransoul/zorkgpt/README.md). Paper write-up at [`docs/LLM-Brain-Design-Research-Paper.md`](../docs/LLM-Brain-Design-Research-Paper.md).

### Latest canonical (BENCH-ZORK-1.5, gemma4:e4b)

Two 2-ep × 100-turn canonical runs (spec 005 + spec 006) on `gemma4:e4b` (q4_k_m via Ollama, 2048-token context, 4B effective parameters). All four episodes through the same `terransoul-brain` arm. Distinct from iter12 (which used `gemma3:4b` and a smaller 3-ep × 25-turn budget).

| Run | Episode | Final score | Turns | MCP calls | MCP errors | Rooms | acquire recipes | reflections_retrievable |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| spec 005 | ep1 | 0 | 100 | 415 | **0** | 8 | 1 (leaflet) | 5 |
| spec 005 | ep2 | 0 | 100 | 432 | **0** | 8 | 1 | 5 |
| spec 006 | ep1 | 0 | 100 | 420 | **0** | 5 | 1 | 5 |
| spec 006 | ep2 | 0 | 100 | 415 | **0** | **6 (Up a Tree, new)** | **2** | 5 |
| total / aggregate | — | — | 400 | **1682** | **0 (0.0 %)** | — | — | — |

**Verdict: SC4 PASS — cross-episode self-improve produced a behavioural change.** spec 006 ep2 reached the canopy room *Up a Tree* (9 events there in ep2 vs 0 in ep1) via `go up` at Forest Path after the bridge's `_load_prior_reflections` hook hydrated ep1's room-scoped reflection into ep2's `knowledgebase.md` at episode start. The egg (a 5-point treasure) was visible in the room description; the agent did not commit to `take egg → walk back to Living Room → put egg in trophy case`. The brain delivered new strategy; the model didn't follow through. Score=0 across all four episodes is the **`gemma4:e4b` reasoning ceiling** (a multi-step planning problem on a 4B model with 2048-token context), not a memory ceiling — the next experimental knob is a 13B / 30B reasoning model.

> **Update (2026-06-21):** the 13B knob was run. On `gemma4:12b-it-qat` the self-improvement-stack campaign **broke the modal-10 ceiling → peak 45** (full underground-descent chain closed and survived; floor lifted to 35, best mean 36.7), AGI-pure — the cap-breaking prerequisite discovered at runtime and replayed by the brain. Cross-model `qwen2.5:7b` lifts 0→5 (memory-lift generalises across architectures, bounded by actor planning). Cross-game at n=2: Detective's lift-to-20 is reproducible but its 20→60 climb is not; 9:05's null is robust. Full results + honest variance in the research paper §4.3c/§4.3d (`docs/LLM-Brain-Design-Research-Paper.md`).
>
> **De-confounding (2026-06-25):** the peak-45 above was measured on a **persistent** brain across 9 sequential runs, conflating within-run cross-episode learning with across-run accumulation of one lucky runtime discovery (the rug-move prerequisite). Re-running on a **fresh task-naïve brain per run** gives the honest cross-episode result **10/10/15 then 10/20/15** (mean 11.7 → 15.0, peak 20 over six episodes): the agent reliably reaches the interior but never re-discovers the full rug→trap-door→lamp→cellar chain from a clean start. So peak-45 **required** across-run accumulation; the pure cross-episode result (~15) is consistent with the modal-10 / actor-bound thesis — the frozen 12B's discovery is the bottleneck, not the memory layer. This sharpens, not overturns (externalised memory is still a genuine performance axis). See §4.3d.

Why the brain layer is the right place to fix this class of bug, and how each fix surfaced:

- **Silent ingest** — every `brain_ingest_lesson` had been silently failing for the entire bench history because the bridge passed `tags` as a JSON array and omitted required `category`, plus the client ignored `result.isError`. Caught by spec 002 T2's verification probe (`reflections_retrievable=0` after we claimed to have ingested four).
- **Prompt snapshot vs stream** — upstream zorkgpt freezes `system_prompt` at `__init__`; the bridge now calls `agent.reload_knowledge_base()` after high-signal writes (spec 004).
- **Strategy vs grammar seed** — v2 → v3 added five strategy principles (open closed containers, take-on-sight, anti-loop, light-before-dark, score-stuck).
- **Prior-reflection hydration** — bridge re-instantiated per episode and started ep2 with empty `_learned_lessons` until spec 006 added `_load_prior_reflections` in `__post_init__`.
- **Local LLM self-healing** — `brain_health.llm_provider_state` Ollama probe + PowerShell watchdog auto-restarts the tray + `docker restart ollama` on outage (spec 005, after the spec-004 canonical wedged on an Ollama CLOSE_WAIT pileup).

All five lessons seeded into `mcp-data/shared/memory-seed.sql` and documented in [`rules/completion-log.md`](../rules/completion-log.md) under SPEC-002 through SPEC-006.

Receipts: `target-copilot-bench/bench-results/zork-bench-canonical-spec005/` and `…/zork-bench-canonical-spec006/`.

### BENCH-ZORK-1.6 (2026-05-29, K7 deepfix) — generic brain contract gap closed, score floor confirmed

Follow-up canonical (2-ep × 30-turn, same `gemma4:e4b`) after discovering a generic MCP contract gap during a 5-probe diagnostic: `brain_search`'s `cognitive_kind` parameter is a hard column filter, but runtime-ingested rows (`brain_ingest_lesson` / `brain_append`) leave the column NULL — every prior bench iter had silently dropped all runtime reflections from retrieval. Fix is task-agnostic (per `rules/bench-agi-purity.md` Rule 1.1): drop `cognitive_kind` from `brain_search`, fold tag tokens into the query string so lexical FTS5 fires. Documented in `docs/brain-advanced-design.md` §3.5.7.1.

| Run | Episode | Final score | Turns | MCP calls | MCP errors | Rooms | reflections_retrievable |
|---|---|---:|---:|---:|---:|---:|---:|
| K7 | ep1 | 0 | 30 | 189 | **0** | 4 | **2** (was 0 in K6) |
| K7 | ep2 | 0 | 30 | 214 | **0** | 4 | **1** (was 0 in K6) |

Cross-episode behavioural change held: ep2 reached Forest Path on **turn 3** (vs ep1 turn 17) and North House on turn 4 (vs turn 18) — 4–5× navigation efficiency improvement from cross-episode reflection hydration, confirming the BENCH-ZORK-1.5 SC4 finding at a smaller budget. Score 0/350 holds at the `gemma4:e4b` reasoning ceiling. The discovered contract gap and bridge workaround now apply generically to any agent (TerranSoul desktop, coding assistants, future benches) using MCP `brain_search`.

### BENCH-ZORK-1.6 spec-014 (2026-05-30, K8→K14) — brain-driven action planner wired, model-capacity wall confirmed

Seven-iteration sweep (K8 → K14) implementing spec-014's eight gaps: a brain-driven affordance shortlist, cross-episode tried-actions memory, dead-end avoidance, generic observation-to-affordance extractors. All affordance priorities live in brain memory only (`universal-text-affordance` tag) — zero verb constants in source code per `rules/brain-driven-self-improvement.md` Rules 3/4.

| Iter | Change | ep1 | ep2 | Rooms | Notable signal |
|---|---|---:|---:|---:|---|
| K8 | Baseline | 0 | 0 | 5 | Model only emits `examine` |
| K11 | Planner wired into `_rewrite_knowledge_file` | 0 | 0 | 6 | ep2 t2=`open mailbox`, t3=`examine leaflet`; `brain_search\|tried` 22 calls/ep, hits 2-4/turn |
| K12 | take=9 ties open=9, examine=6 | 0 | 0 | 6 | ep1 t3=`take leaflet`, ep2 reached **Up a Tree** (egg treasure room) |
| K13 | take=10, MaxTurns 50 | 0 | 0 | 7-8 | ep2 reached Rocky Ledge; visited Behind House 8× but never `open window` |
| K14 | Broadened object regex (relative-clause nouns) | 0 | 0 | 6/5 | Planner now extracts `small window`; model still picks `examine` over planner's top entry `open` |

**Score plateau diagnosis:** infrastructure complete and verifiable in JSONL telemetry (`brain_search\|affordances` cached, `brain_search\|tried` 5-7 hits/turn, tried-action ingest with classify_outcome buckets). Score=0 is bounded by the **gemma4:e4b 4B-parameter capacity ceiling** — model does not reliably follow planner top-1 shortlist (K14 ep1 t13: planner top entry `open window`, model emitted `examine window`, then left Behind House t14). Critic-rejection meltdowns produce multi-line stream-of-consciousness "actions" that the harness sanitises (harness_sanitise=13 in K13 ep1).

**Durable wins** (independent of score):
- Brain-driven planner via `_rewrite_knowledge_file` (the *real* prompt source the upstream agent reads), not `get_knowledge_for_context`.
- Object extractor covers relative-clause nouns ("a window which is ajar") — generic regex coverage fix, applies to any IF parser.
- Universal-IF affordance priority scheme: take=10 (state-commit primacy), open=9, read=7, examine=6, look_in=5 — justifiable across IF / file managers / workflow systems / agentic conversations.
- Cross-episode tried-actions memory verifiably consumed (FTS5 retrieval with `loc_<room>` tag).

**Next leverage point** (deferred): critic-prompt injection — force-rank planner shortlist into the rejection-sampling critic so the model can't pick a low-ranked verb when a high-priority alternative is available. Highest expected ROI without changing model size. Sonnet 4.7 reference row is not yet a fair comparator — needs re-run with `gemma4:e4b` for true model-parity.

Artifacts: `target-copilot-bench/bench-results/zork-bench/{K8…K14}-archive/`. Memory id 8934 (consolidated lesson, persisted to seed).

### Earlier canonical (BENCH-ZORK-iter12, 2026-05-25) — gemma3:4b reference baseline

For provenance: the 2026-05-25 iter12 run with `gemma3:4b` and a 3-ep × 25-turn budget cleared all 5 original pass criteria with `terransoul-brain` ep3 scoring **35** vs `zorkgpt-default` ep3 = 0. Pass criteria: ep3 > ep1 strict (35 > 0); brain ep3 ≥ default ep3 (35 ≥ 0); unique locations 8 ≥ 3; wasted-action rate ~16 % ≤ ~84 %; `memory_calls_err / total` = 2 / 69 = 2.9 % ≤ 5 %. BENCH-ZORK-1.5 (gemma4:e4b, 100-turn) replaced iter12 as the canonical row because the more demanding model + longer-horizon budget is the better stress test of the architecture; iter12 numbers are retained in [terransoul/zorkgpt/README.md](terransoul/zorkgpt/README.md) as a reference baseline.

## How TerranSoul compares

A short, honest narrative summarising where the system leads, where it ties, and where it lags against the peer landscape above.

### Frontier-model reference baseline on Zork (BENCH-ZORK regime)

> Spec 016 — quantified Sonnet 4.x goalpost for the spec-014
> brain-driven action planner.

| Model | Harness regime | Score / 350 | Source | Retrieved |
|---|---|---|---|---|
| Claude-Opus-4.5 | BALROG aggregate (NetHack, Crafter, MiniHack, BabaIsAI, TextWorld, Babylon) | 43.5 % ± 2.3 % avg | <https://balrogai.com> | 2026-05-30 |
| Claude-Opus-4.5-Thinking | BALROG aggregate | 43.0 % ± 2.3 % avg | <https://balrogai.com> | 2026-05-30 |
| Claude-Haiku-4.5 | BALROG aggregate | 31.2 % ± 2.1 % avg | <https://balrogai.com> | 2026-05-30 |
| Gemini-3-Pro | BALROG aggregate (current #1) | 58.1 % ± 2.1 % avg | <https://balrogai.com> | 2026-05-30 |
| ZorkGPT live agent (frontier model, 199+ turns, accumulated memory) | ZorkGPT harness, NO turn cap, persistent knowledge across days of play | 94 / 350 at turn 199 (observed); ep120 peak 115 | <https://zorkgpt.com> | 2026-05-30 |
| **Claude Opus 4.8 (this work) — recall** | reproduces the known solution move-by-move on Jericho | **350 / 350** | this repo, [Opus page](https://terransyn.github.io/TerranSoul/zorkgpt/claude-opus-4.8/) | 2026-06-03 |
| **Claude Opus 4.8 (this work) — cold reasoning** | from-scratch, no recall | 50 / 350 | this repo (Opus page) | 2026-06-03 |
| **`gemma4:e4b` + TerranSoul brain — AGI-pure** | brain + harness, no taught solution | 10–20 / 350 (both controls 0) | this repo, BENCH-ZORK | 2026-06-03 |
| **`gemma4:e4b` + TerranSoul brain — reliability demo** | brain serves the taught move (distilled from Opus 4.8's 350 run) every turn via an orchestrator fork | **350 / 350**, deterministic (vs 73/177 intermittent) | this repo, [TaughtLocalLLM page](https://terransyn.github.io/TerranSoul/zorkgpt/taughtLocalLLM/) | 2026-06-03 |
| **Sonnet 4.7** | not on BALROG leaderboard (no public 30-turn cold-start Zork I number) | estimated upper bound **≤ ~25 / 350** in 30-turn cold start, by Opus-4.5/Haiku-4.5 interpolation + ZorkGPT-live early-turn floor | no live measurement | n/a |

**TerranSoul spec-014 goalpost** — `gemma4:e4b` + brain-driven action planner, cold-start 30-turn cap, no Zork-specific seeds (Rule 1.1): target **≥ 30 / 350 by episode 3** with persistent cross-episode memory. The win condition is not raw single-episode reasoning (where Sonnet 4.7 will always out-reason a 4B model) but rather **cumulative memory leverage** — by episode 3 the brain holds map adjacency + tried-actions outcomes + recipe lessons that Sonnet 4.7 cannot carry across the harness's per-episode reset. See [.specify/specs/014-brain-driven-action-planner/spec.md](../.specify/specs/014-brain-driven-action-planner/spec.md) for the planner design and [.specify/specs/016-sonnet-4-7-reference-baseline/spec.md](../.specify/specs/016-sonnet-4-7-reference-baseline/spec.md) for the goalpost rationale.

### Where TerranSoul leads

- **LongMemEval-S retrieval-only** — TerranSoul `search` is **top-1 in this table** (R@5 99.2 %, R@10 99.6 %, R@20 100.0 %, NDCG@10 91.3 %, MRR 92.6 %), ahead of agentmemory (95.2 % R@5) and MemPalace (~96.6 % R@5). The win comes from corpus-aware lexical weighting in `MemoryStore::search` + per-cognitive-kind decay + the 6-signal hybrid scorer. BENCH-AM-6/6.1 verified the full 500-question table; BENCH-AM-7 confirmed no quality regression after the low-signal cap landed.
- **agentmemory bench:quality** — on the upstream's own pinned fixture, TerranSoul keyword-only `search` leads on raw quality (R@10 67.1 %, NDCG@10 98.2 %, MRR 100.0 %), while the production-default `hybrid_search_rrf` no-vector lands within 0.3 pp R@10 (66.8 %, NDCG@10 95.0 %, MRR 95.0 %) at roughly a third of the retrieved-token budget. RRF was regressed (R@10 22.9 %) by the P6 echo-collapse penalty dominating the ~2 % rank gaps and was restored in the 2026-06-25 fix (`c560514e`) that bounds the penalty to a ~2.5 % tiebreaker; for context, agentmemory v0.6 dual-stream reference is R@10 58.6 %.
- **Architectural affordances not in the peer set** — HyDE retrieval, LLM-as-judge cross-encoder rerank, Contextual Retrieval (Anthropic 2024), CRDT device sync, the typed-KG write tool (`brain_add_edge`, spec 003), and the live LLM-provider self-healing probe (`brain_health.llm_provider_state` + watchdog, spec 005). Each one is verified to ship and tested — see the feature matrix above and `rules/completion-log.md` entries.
- **ZorkGPT long-horizon, real local LLM** — BENCH-ZORK exposes its full call log (**0 MCP errors across 1682 brain calls**, 5 reflections retrievable per episode, ep2 reached a new room via cross-episode reflection hydration), and adds two results we have not seen published elsewhere on Zork I: with no task seeds the brain lifts the same 4B from **0 → 10–20** while both controls stay at 0; and a controlled **delivery-reliability demonstration** shows that serving the brain's move every turn drives the 4B to a deterministic **350/350**, where intermittent serving stalls at a non-deterministic 73/177 — isolating *delivery reliability* from model size. Research write-up: [`docs/LLM-Brain-Design-Research-Paper.md`](../docs/LLM-Brain-Design-Research-Paper.md).

### Where TerranSoul ties

- **Auto-capture, MCP cross-agent exposure, audit trail, privacy filtering, Obsidian export, real-time graph viewer** — checkmarks in both columns of the agentmemory feature matrix, with different deployment shapes (in-app graph vs standalone port; per-mutation `audit.rs` vs upstream log) but equivalent capability.
- **Local-first / offline-capable** — TerranSoul, agentmemory, Hippo, and Khoj all support local-only operation. Mem0 is cloud-first; Letta is partial; MemPalace is research-only.
- **Knowledge-graph hop** — TerranSoul, agentmemory, Letta, MemPalace, and Hippo all ship a typed-graph read path; TerranSoul adds the `brain_add_edge` MCP write tool (spec 003) which lets external clients promote co-tag co-existence into first-class edges.

### Where TerranSoul lags

- **MTEB LoCoMo retrieval, multi-hop and open-domain tasks** — TerranSoul `rrf` is at R@10 51.6 % on the 250-query slice. Temporal-reasoning is already strong (R@10 90.0 %), but `multi_hop` and `open_domain` need either query decomposition / iterative retrieve-expand-retrieve or a stronger semantic pass to compete with HippoRAG-style multi-hop architectures. Tracked as a documented gap in §19.3 of [`docs/brain-advanced-design.md`](../docs/brain-advanced-design.md). Cross-system note: LoCoMo *QA* (J score) is the metric Mem0/Letta/Zep paper rows use; TerranSoul does not publish a comparable end-to-end QA number on LoCoMo yet because the LoCoMo retrieval gap is the upstream bottleneck.
- **Standalone leases / signals / mesh primitive** — TerranSoul wraps coordination in MCP + Hive relay; agentmemory and Letta ship a lower-level lease mesh. BENCH-AM-7 documents this as an intentional scope boundary (we use the Hive federation layer for cross-device coordination instead of duplicating the mesh inside the core memory module).
- **Separate language SDK packages** — TerranSoul's stable surface is MCP + Tauri IPC + native Rust + Vue. agentmemory and Mem0 ship dedicated Python/TypeScript SDKs. Deferred by design; will reconsider when external adopters need package-managed bindings.
- **ZorkGPT score on `gemma4:e4b`** — final_score=0 across all four canonical episodes. This is the **model reasoning ceiling**, not a memory ceiling — the brain delivered new strategy (ep2 reached Up a Tree) but `gemma4:e4b` (4B params, 2048-tok context) couldn't commit to the multi-step plan to take the egg and return it to the trophy case. iter12 with the older `gemma3:4b` and a 25-turn budget *did* score (35 vs 0 vs default), so the spec 002–006 architecture is provably capable; bumping to a 13B or 30B reasoning model is the next experimental knob.

### Why TerranSoul has a brain at all

The five lessons surfaced by the ZorkGPT bench (silent ingest, room-scoped reflection, prompt-as-snapshot, grammar-vs-strategy seed, cross-episode hydration, and the self-healing local-LLM provider probe) are **not Zork lessons; they are agent-memory lessons**. Each is a failure mode that would break in any LLM-plus-memory stack — local or cloud, big model or small. Putting memory in a brain server instead of inside the model is what makes all five observable, diagnosable, and fixable at the memory layer.

A model-only stack changes strategy by retraining. TerranSoul changes strategy with a `brain_ingest_lesson` call and a `zork-seed-v3` tag.

The case is not "TerranSoul scored X on Zork." The case is **"these five classes of failure are inevitable in any agent + memory stack, and TerranSoul makes them all addressable without retraining a model."** Full paper: [`docs/LLM-Brain-Design-Research-Paper.md`](../docs/LLM-Brain-Design-Research-Paper.md).

## What ships next

Open chunks in [rules/milestones.md](../rules/milestones.md): README-AUDIT-2 (closed 2026-05-28 with this and the README update) and COMPARISON-CONDENSE-1 (this rewrite). No active BENCH-AM blockers. New benchmark, source system, or implementation target → open a new chunk in `milestones.md`.

For deeper iteration narrative (Round 1 baseline through Round 7 parity sweep, Phase TOP1 Round 1 cross-system matrix, BENCH-MCP-PARITY / BENCH-MCP-LATENCY-1 / BENCH-LCM-KG-HYDE-1 / BENCH-ZORK-iter12 / BENCH-ZORK-RERUN-1, and the superseded BENCH-ZORK-1.5 300-turn placeholder), see [`COMPARISON-archive.md`](COMPARISON-archive.md).
