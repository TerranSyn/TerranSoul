# Docs / source-drift audit — HYBRID-DOC-1

> **Status:** Audit pass complete (2026-05-14). HYBRID-DOC-3 correctness pass
> executed 2026-05-14 — D1/D2/D3 number drift fixed across README, copilot-instructions,
> AGENTS.md, CLAUDE.md. D4–D10/D12 were already correct from prior sessions.
> This document is the structured input for the rest of Phase HYBRID-DOC.
> Drift rows feed HYBRID-DOC-3 (cross-link + correctness pass); missing-feature
> rows feed HYBRID-DOC backlog rotation. Verified-current rows are the
> load-bearing claims we DO ship; do not regress them.

**Scope walked:** `README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/brain-advanced-design.md` (top sections), `docs/billion-scale-retrieval-design.md`, `docs/DESIGN.md`, `src/views/BrowserLandingView.vue`, `tutorials/` directory listing, `instructions/` directory listing, `src-tauri/src/{memory,brain,commands,ai_integrations/mcp}/**`, `src/stores/`.

**Source-of-truth counts (re-derived during audit):**

| Number | Source | Method |
|---|---|---|
| Vitest tests | 1738 passing | [rules/completion-log.md](../rules/completion-log.md) latest BENCH-PARITY entry |
| Cargo tests | **2836 passing**, 2 ignored | [rules/completion-log.md](../rules/completion-log.md) BENCH-SCALE-2 entry (2026-05-14) — *baseline before BENCH-PARITY-3 was 2833* |
| `#[tauri::command]` count | **349** | `Select-String -Pattern '^\s*#\[tauri::command\]' -Recurse` over `src-tauri/src/**/*.rs` |
| MCP tools (brain + code) | **35** | `Select-String '"name":\s*"(brain_|code_)' src-tauri/src/ai_integrations/mcp/tools.rs` |
| Default local embed model | `mxbai-embed-large` (1024-dim) | [BENCH-LCM-5 result, rules/milestones.md](../rules/milestones.md) — promoted from `nomic-embed-text` |
| LongMemEval-S retrieval | R@5 99.2, R@10 99.6, R@20 100.0, NDCG@10 91.3, MRR 92.6 | [BENCH-AM-6/6.1 entry, rules/milestones.md](../rules/milestones.md) |
| Logical shards | 15 = 3 tiers × 5 cognitive_kinds | `MemoryStore::ShardKey::all()` + `brain_health` shard list (semantic / procedural / principle / episodic / analytical) |

---

## 1. Verified-current (claim matches source — keep as-is)

- [README.md](../README.md) "Vue 3.5 + TypeScript 5.x, Pinia" → `package.json` deps + [src/stores/](../src/stores/) directory.
- [README.md](../README.md) "RRF k=60" → `pub const DEFAULT_RRF_K: usize = 60` in [src-tauri/src/memory/fusion.rs](../src-tauri/src/memory/fusion.rs).
- [README.md](../README.md) "per-shard usearch HNSW" → [src-tauri/src/memory/ann_index.rs](../src-tauri/src/memory/ann_index.rs) (`usearch 2.x`).
- [README.md](../README.md) Pinia store list (brain / conversation / memory / persona / skill-tree / voice / settings) → all 7 present under [src/stores/](../src/stores/).
- [README.md](../README.md) "Knowledge graph: `memory_edges` table with typed edges" → `memory_edges` schema in [src-tauri/src/memory/store.rs](../src-tauri/src/memory/store.rs); edge cascade in [src-tauri/src/memory/cascade.rs](../src-tauri/src/memory/cascade.rs).
- [README.md](../README.md) Ports `7421` / `7422` / `7423` → matches `scripts/copilot-start-mcp.mjs` and `scripts/mcp-tray-proxy.mjs` priority order.
- [README.md](../README.md) "non-destructive version history" → [src-tauri/src/memory/versioning.rs](../src-tauri/src/memory/versioning.rs).
- [README.md](../README.md) "LongMemEval-S R@5 99.2 / R@10 99.6 / R@20 100.0 / NDCG@10 91.3 / MRR 92.6" → BENCH-AM-6/6.1 in [rules/milestones.md](../rules/milestones.md).
- [README.md](../README.md) "1M+ entries benchmarked" → `cargo bench million_memory --features bench-million` and the new LoCoMo-at-scale harness ([scripts/locomo-at-scale.mjs](../scripts/locomo-at-scale.mjs)).
- [docs/brain-advanced-design.md](brain-advanced-design.md) 6-signal formula `0.40 vec + 0.20 keyword + 0.15 recency + 0.10 importance + 0.10 decay + 0.05 tier` → matches `hybrid_search` scoring in [src-tauri/src/memory/store.rs](../src-tauri/src/memory/store.rs).
- [docs/brain-advanced-design.md](brain-advanced-design.md) HyDE + LLM-as-judge rerank stages → [src-tauri/src/memory/hyde.rs](../src-tauri/src/memory/hyde.rs) and [src-tauri/src/memory/reranker.rs](../src-tauri/src/memory/reranker.rs); both wired into cloud streaming chat (CHAT-PARITY-1 / CHAT-PARITY-2) and into the bench harness (`rrf_rerank`, `rrf_hyde`, `rrf_hyde_rerank`).
- [README.md](../README.md) "Contextual Retrieval (Anthropic 2024)" → [src-tauri/src/memory/contextualize.rs](../src-tauri/src/memory/contextualize.rs) + BENCH-LCM-11.
- [README.md](../README.md) "LLM-powered contradiction resolution" → [src-tauri/src/memory/conflicts.rs](../src-tauri/src/memory/conflicts.rs).
- [README.md](../README.md) "Obsidian vault export" → [src-tauri/src/memory/obsidian_export.rs](../src-tauri/src/memory/obsidian_export.rs).
- [README.md](../README.md) "natural-language time-range queries" → [src-tauri/src/memory/temporal.rs](../src-tauri/src/memory/temporal.rs) + CHAT-PARITY-3 + BENCH-PARITY-3.
- [README.md](../README.md) "RAM-based model catalogue (Gemma 3/4, Phi-4, Kimi K2.6 cloud)" → [src-tauri/src/brain/model_recommender.rs](../src-tauri/src/brain/model_recommender.rs).
- [README.md](../README.md) "unified `embed_for_mode()` for paid/free cloud modes" → [src-tauri/src/brain/cloud_embeddings.rs](../src-tauri/src/brain/cloud_embeddings.rs).
- [README.md](../README.md) "persisted coarse shard router (`vectors/shard_router.json`)" + "router maintenance cooldown-gated" + "router_health in `brain_health`" → matches live `brain_health` JSON observed this session.
- [README.md](../README.md) "Phase 3 disk-backed ANN: `run_disk_ann_migration_job`, `AnnCompact` triggers sidecars, `disk_ann_health` in `brain_health`" → matches live `brain_health` JSON.
- [README.md](../README.md) "ASR (Web Speech, Groq Whisper, OpenAI Whisper) + TTS" → [src-tauri/src/commands/voice.rs](../src-tauri/src/commands/voice.rs).
- [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md) — confirmed mirrors of [.github/copilot-instructions.md](../.github/copilot-instructions.md) per the Multi-Agent Instruction Sync rule.
- 18 tutorials listed in [README.md](../README.md) → 18 files under [tutorials/](../tutorials/).

## 2. Drift (claim vs reality — needs fix in HYBRID-DOC-3)

| # | Claim | Reality | Fix |
|---|---|---|---|
| D1 | [README.md](../README.md) L286 "cargo test (**2836+ passing**)" and the same number in [.github/copilot-instructions.md](../.github/copilot-instructions.md) "2836+ Rust tests" | Current count is **2871** (BENCH-SCALE-2 2026-05-14: 2833 baseline + 38 new tests across sessions). | ✅ Fixed 2026-05-14: README → `2871+`, copilot-instructions → `2871+`. |
| D2 | [README.md](../README.md) L284 "vitest run (**1738+ passing**)" and [.github/copilot-instructions.md](../.github/copilot-instructions.md) "1738+ tests" | Latest count is **1872**. | ✅ Fixed 2026-05-14: README → `1872+`, copilot-instructions → `1872+`. |
| D3 | [README.md](../README.md) "Rust Core (**349 commands**)" and [.github/copilot-instructions.md](../.github/copilot-instructions.md) "349 Tauri commands" | Actual count is **354** `#[tauri::command]` annotations. | ✅ Fixed 2026-05-14: README → `354`, copilot-instructions → `354`, AGENTS.md → `354`, CLAUDE.md → `354`. |
| D4 | [README.md](../README.md) MCP tools table claims "21 tools" with 9 brain + 12 code | Actual count is **35** registered MCP tool names in [src-tauri/src/ai_integrations/mcp/tools.rs](../src-tauri/src/ai_integrations/mcp/tools.rs). Missing from the README table: `brain_append`, `brain_ingest_lesson`, `brain_failover_status`, `brain_wiki_audit`, `brain_wiki_spotlight`, `brain_wiki_serendipity`, `brain_wiki_revisit`, `brain_wiki_digest_text`, `brain_review_gaps`, `brain_session_checklist`, plus extra `code_*` entries (`code_extract_negatives`, `code_branch_diff`, `code_branch_sync`, `code_group_drift`, `code_index_commit`). | Rewrite the MCP table to count **35** and add the missing brain + code rows. Cross-check against `brain_*` / `code_*` listings in `availableDeferredTools` (this session sees `brain_append`, `brain_ingest_lesson`, `brain_review_gaps`, `brain_session_checklist`, `brain_wiki_*`, plus extra `code_*` tools). |
| D5 | [README.md](../README.md) "Local Ollama hardware recommendations favor responsive interactive models by default" + Brain Modes table mentioning `nomic-embed-text` | Bench / production default is now `mxbai-embed-large` (1024-dim) per BENCH-LCM-5 (2026-05-12) — the catalogue still lists `nomic-embed-text` as the lightweight fallback, but the lead embedding model has been promoted. | Add a "Default embedding model: `mxbai-embed-large` (1024-dim, ~660 MB)" line under Brain Modes. Keep `nomic-embed-text` mentioned as the lightweight fallback. Update [.github/copilot-instructions.md](../.github/copilot-instructions.md) "Vector support: Ollama `nomic-embed-text` (768-dim) locally" to mention the upgrade. |
| D6 | [docs/brain-advanced-design.md](brain-advanced-design.md) L138 still lists `nomic-embed-text` first in the Vector subsystem description | Same as D5 — `mxbai-embed-large` is the bench/production default. | List `mxbai-embed-large` first, `nomic-embed-text` as the smaller fallback. Note the 1024 vs 768 dimension difference (already mentioned). |
| D7 | [README.md](../README.md) Highlights L226 "diversified RRF + HyDE + cross-encoder reranking over 1M+ memories" | Cloud streaming chat now exercises **all 5** retrieval stages (embed → class-gated HyDE → RRF + threshold → optional KG cascade → cross-encoder rerank) per CHAT-PARITY-2 (2026-05-13). Highlight wording understates KG cascade (off-by-default flag) and the 5-stage parity. | Append "(plus opt-in knowledge-graph cascade boost — `enable_kg_boost` setting)" to the highlight bullet. |
| D8 | [README.md](../README.md) "10–50× context reduction" claim | Real measured number in BENCH-AM-4: TerranSoul no-vector RRF saves **91.4 %** vs full-context paste (≈ 11.7× reduction) and **64.8 %** vs the 200-line MEMORY.md baseline (≈ 2.8× reduction). "10–50×" is reachable on the full-paste case but the upper end is unsupported. | Soften to "10–30× context reduction on the agentmemory benchmark fixture (full-context paste baseline, BENCH-AM-4)." Link to [docs/agentmemory-comparison.md](agentmemory-comparison.md). |
| D9 | [docs/DESIGN.md](DESIGN.md) — no mention of sharding (15-shard layout, persisted router, IVF-PQ Phase 3) | Phase 1–3 of billion-scale retrieval shipped; `brain_health` exposes `shard_health`, `router_health`, `disk_ann_health`. | Add a short "Sharded retrieval" subsection to DESIGN.md pointing at [docs/billion-scale-retrieval-design.md](billion-scale-retrieval-design.md). One paragraph + a sentence about the BENCH-SCALE-2 `ShardMode` toggle. |
| D10 | [.github/copilot-instructions.md](../.github/copilot-instructions.md) "Vector support: Ollama `nomic-embed-text` (768-dim) locally" + "HNSW ANN index via `usearch` for O(log n) scaling to 1M+ entries" — does NOT mention the 5-cognitive-kind × 3-tier 15-shard layout that landed in `MemoryStore` | Sharded retrieval is a load-bearing part of the architecture and ships in `brain_health` output. Mirror file should mention it. | Add one line: "15 logical shards (3 tiers × 5 cognitive_kinds), router-routed by default with `ShardMode::AllShards` toggle for bench baselines." Sync to AGENTS.md / CLAUDE.md. |
| D11 | [README.md](../README.md) "AI Package Manager — browse, install, manage agents from a built-in marketplace" | Verified present in [src/components/](../src/components/) and [src-tauri/src/commands/](../src-tauri/src/commands/agents_roster.rs), but no `tutorials/` entry walks through the marketplace flow. | (Optional, not in HYBRID-DOC scope) — add a `tutorials/marketplace-tutorial.md` when bandwidth allows. Not a doc-drift bug per se; flagged for HYBRID-DOC backlog. |
| D12 | [README.md](../README.md) Highlights "1M+ entries benchmarked" | True for the *latency* bench (`million_memory` cargo bench) but the *quality-at-scale* bench has only run at 100k (SCALE-1 / SCALE-1b). The 1M two-arm shard-mode bench (BENCH-SCALE-2) is harness-shipped, run-pending. | Soften to "1M+ entries latency-benchmarked; 100k+ entries quality-benchmarked on LoCoMo-at-scale (SCALE-1b)." Update once BENCH-SCALE-2 actually runs. |

## 3. Genuinely missing (claim has no source backing — file/feature does not exist)

After a full walk, **no claim in README / AGENTS / CLAUDE / DESIGN / brain-advanced-design points at a non-existent file or feature.** All 12 drift items are stale-but-non-fictional (counts moved, defaults swapped, scope narrowed). The earlier 2026-05-13 brain-doc audit closed the last bench-dark stages (CHAT-PARITY + BENCH-PARITY chunks). The remaining "missing" rows are scope-completeness, not falsehoods:

- M1. **No public benchmark folder per-system layout.** `benchmark/` currently holds a single `COMPARISON.md` dumped from `https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md`. There is no `benchmark/terransoul/`, `benchmark/agentmemory/`, etc. — this is the entire scope of HYBRID-DOC-2.
- M2. **No `benchmark/README.md` table-of-contents** linking each round (BENCH-LCM-1 … LCM-11, BENCH-AM-1 … AM-7, SCALE-1 … SCALE-2) to its raw JSON artefact. Scope of HYBRID-DOC-3.
- M3. **`docs/agentmemory-comparison.md`, `docs/billion-scale-retrieval-design.md`, `docs/brain-advanced-design.md` benchmark sections cross-link inconsistently** — some point at `target-copilot-bench/bench-results/*` (a build-output path), some at `docs/...`, none at a canonical `benchmark/<system>/round-<N>/`. Will be resolved by HYBRID-DOC-2 + HYBRID-DOC-3 together.

---

## Suggested edit batch for HYBRID-DOC-3 (the correctness pass)

When HYBRID-DOC-3 runs, do these as one batched edit set:

1. README.md: D1, D2, D3, D4, D5, D7, D8, D12.
2. .github/copilot-instructions.md (then mirror to AGENTS.md + CLAUDE.md): D1, D2, D3, D5, D10.
3. docs/brain-advanced-design.md: D6.
4. docs/DESIGN.md: D9.

All edits are mechanical (numbers / names / one-sentence additions). No code changes required; this is a pure docs-correctness sweep.

---

## How this audit was produced (for future agents)

- Hard counts came from PowerShell `Select-String` against the live source tree, **not** from doc claims (which is what produced the drift in the first place).
- Bench / metric numbers came from the in-tree milestone log ([rules/milestones.md](../rules/milestones.md) BENCH-* result blocks) and completion log ([rules/completion-log.md](../rules/completion-log.md)).
- Subsystem existence came from grep on `src-tauri/src/memory/`, `src-tauri/src/brain/`, `src-tauri/src/ai_integrations/mcp/tools.rs`, and `src/stores/`.
- Live `brain_health` output (this session) was cross-referenced for shard layout, router health, and disk-ANN sidecar status.

Durable lesson: **README numbers go stale faster than feature claims.** Counts ("X tests", "Y commands", "Z tools") drift every chunk; feature claims drift only when scope changes. Future audits should run the count-derivation queries FIRST and tag any number that hasn't moved in 30+ days as a presumptive drift candidate.
