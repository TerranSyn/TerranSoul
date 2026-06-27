# Personal-AI framework parity audit — 2026-05-26

> **Reverse-engineering target:** [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis)
> (Stanford SAIL / Hazy Research, Apache-2.0, arXiv:2605.17172,
> [DeepWiki](https://deepwiki.com/open-jarvis/OpenJarvis) commit
> `2f553afb`, indexed 2026-03-13).
>
> **Scope:** functional A/B parity audit. TerranSoul ships TerranSoul-native
> Rust/Vue equivalents under neutral names; no OpenJarvis source, prompts,
> asset names, branded identity, `jarvis` CLI source, or `~/.openjarvis/`
> schema is copied. Attribution lives in [`../CREDITS.md`](../CREDITS.md).
>
> **Companion docs:** parity chunks in
> [`../rules/milestones.md`](../rules/milestones.md) → Phase
> PERSONAL-AI-PARITY (PARITY-OJ-1..14); the completed PARITY-OJ-1 record is
> archived in [`../rules/completion-log.md`](../rules/completion-log.md).

## Verdicts at a glance

| Verdict | Meaning |
|---|---|
| **PASS** | TerranSoul ships an equivalent or stronger capability today. |
| **PARTIAL** | TerranSoul has the building blocks but not the full user-visible feature. A parity chunk closes the gap. |
| **MISSING** | TerranSoul has no equivalent. A parity chunk introduces one. |
| **LEAD** | TerranSoul materially exceeds OpenJarvis here. Recorded so the parity bench (PARITY-OJ-14) does not flatten it. |

## Pillar 1 — Intelligence (LLM config)

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| LLM provider selection (model / temperature / max_tokens / top_p) | `config.toml [intelligence]` | `brain/mod.rs` + `Settings → Brain` | PASS | — |
| Free-tier cloud fallback | none documented | Pollinations, OpenRouter, NVIDIA free tier (`brain/free_provider.rs` + `provider_rotator.rs`) | LEAD | — |
| Local provider | Ollama via engine pillar | Ollama via `brain/ollama_agent.rs` | PASS | — |

## Pillar 2 — Agent

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| Orchestrator agent (multi-turn, auto tool selection) | `orchestrator` | `orchestrator/` capability gates | PASS | — |
| Simple single-turn agent | `simple` | chat default path | PASS | — |
| ReAct loop (Thought–Action–Observation) | `native_react` | — | MISSING | PARITY-OJ-8 (a) |
| CodeAct (LLM generates+executes Python in sandbox) | `native_openhands` | — | MISSING | PARITY-OJ-8 (b) |
| DeepResearch (multi-hop retrieve+cite) | `deep_research` | partial via brain RAG + chat | PARTIAL | PARITY-OJ-8 (c) |
| MonitorAgent (long-horizon continuous) | `monitor_operative`, `operative` | — | MISSING | PARITY-OJ-8 (d), PARITY-OJ-10 |
| Digest agent (scheduled spoken briefing) | `morning_digest` | — | MISSING | PARITY-OJ-8 (e), PARITY-OJ-10, PARITY-OJ-11 |

## Pillar 3 — Tools

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| MCP tool interface | yes | yes (release `:7421`, tray `:7423`, dev `:7422`) | PASS | — |
| SQLite tool storage | `memory.db` (flat) | sharded `memory.db` + `memory_edges` KG + HNSW ANN | LEAD | — |
| `code_interpreter` tool | yes | — (lands with PARITY-OJ-8 b) | PARTIAL | PARITY-OJ-8 (b) |
| `web_search` tool | yes | `web_search` MCP tool | PASS | — |
| `memory` tool | yes (flat KV) | `brain_search` + `brain_ingest_lesson` + 25+ MCP brain tools | LEAD | — |
| agentskills.io standard catalog (Hermes / OpenClaw imports) | yes (~13.7k skills) | gamified quest-skills (different concept) | MISSING (tool-skill axis) | PARITY-OJ-9 |

## Pillar 4 — Engine

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| Ollama backend (`:11434`) | yes | yes | PASS | — |
| vLLM backend (`:8001`) | yes | — | MISSING | PARITY-OJ-3 |
| SGLang backend (`:30000`) | yes | — | MISSING | PARITY-OJ-3 |
| llama.cpp backend | yes | — | MISSING | PARITY-OJ-3 |
| Auto engine pick from hardware | `jarvis init` | `model_recommender.rs` (RAM-only) | PARTIAL | PARITY-OJ-13 |

## Pillar 5 — Learning

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| Execution-trace store | `traces.db` | — (chat history exists, structured agent traces don't) | MISSING | PARITY-OJ-4 |
| GPU / energy polling @ 50 ms | `telemetry.db` | — | MISSING | PARITY-OJ-5 |
| Trace-driven skill optimization | `jarvis optimize skills --policy dspy` | — | MISSING | PARITY-OJ-6 |
| Public leaderboard | yes | benchmark MD files only | PARTIAL | PARITY-OJ-12 |
| Energy / FLOPs / latency / cost as first-class metrics | yes | latency only (benches measure quality) | PARTIAL | PARITY-OJ-5 + PARITY-OJ-12 |

## CLI surface

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| `jarvis init [--preset]` | yes | — | MISSING | PARITY-OJ-2, PARITY-OJ-7 |
| `jarvis ask "<q>"` | yes | — | MISSING | PARITY-OJ-2 |
| `jarvis doctor` | yes | partial via `npm run mcp` + `scripts/mcp-tray-proxy.mjs --probe` | PARTIAL | PARITY-OJ-2 |
| `jarvis serve` (headless API) | yes | Tauri app only (no headless HTTP) | MISSING | PARITY-OJ-2 |
| `jarvis digest`, `jarvis connect gdrive` | yes | — | MISSING | PARITY-OJ-10 + PARITY-OJ-11 |
| `jarvis skill install/sync/optimize/bench` | yes | — | MISSING | PARITY-OJ-9 + PARITY-OJ-6 |

## Starter presets

| Preset | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| daily / morning digest | `morning-digest-mac`, `morning-digest-linux`, `morning-digest-minimal` | — | MISSING | PARITY-OJ-7 |
| deep research | `deep-research` | — | MISSING | PARITY-OJ-7 |
| code assistant | `code-assistant` | partial via existing Self-Improve coding workflow | PARTIAL | PARITY-OJ-7 |
| scheduled monitor | `scheduled-monitor` | — | MISSING | PARITY-OJ-7, PARITY-OJ-10 |
| simple chat | `chat-simple` | TerranSoul ChatView (no preset CLI) | PARTIAL | PARITY-OJ-7 |
| voice companion (TerranSoul-only) | — | persona + TTS/ASR + VRM | LEAD | PARITY-OJ-7 adds preset |
| VRM overlay (TerranSoul-only) | — | character viewport | LEAD | PARITY-OJ-7 adds preset |

## Deployment

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| Tauri desktop app | yes | yes | PASS | — |
| Docker image | `Dockerfile`, `Dockerfile.gpu`, `Dockerfile.gpu.rocm` | `Dockerfile.mcp` only (MCP runner, not full app) | PARTIAL | optional follow-up |
| systemd / launchd service | yes | — | MISSING | optional follow-up |
| Auto-update via release channel | `desktop-latest` tag | Tauri updater not wired up | PARTIAL | optional follow-up |
| WSL2 install script | yes | — | N/A (TerranSoul runs natively on Windows) | — |

## Integrations (OAuth)

| Capability | OpenJarvis | TerranSoul | Verdict | Closes |
|---|---|---|---|---|
| Google (Gmail + Calendar + Tasks) | yes (one OAuth flow) | — | MISSING | PARITY-OJ-11 |
| Microsoft Graph (Outlook + Calendar) | — | — | MISSING | PARITY-OJ-11 |
| iCloud Mail / Calendar (CalDAV) | — | — | MISSING | PARITY-OJ-11 |

## Where TerranSoul leads (do not flatten in the A/B bench)

| Capability | TerranSoul | OpenJarvis | Verdict |
|---|---|---|---|
| Vector RAG (semantic recall) | 6-signal hybrid + RRF (k=60) + HyDE + cross-encoder rerank + HNSW (`usearch`) | flat `memory.db` SQLite; no vector RAG documented | LEAD |
| Knowledge graph | `memory_edges` typed edges, Leiden communities, GraphRAG-style routing | — | LEAD |
| 3D VRM character + persona drift detection + voice (TTS/ASR + singing) | `persona/`, `voice/`, `renderer/` | — | LEAD |
| CRDT cross-device sync (P2P / Hive) | `link/`, `identity/` | — | LEAD |
| Published retrieval / agent benches | 5: agentmemory (R@10 64.1%, NDCG@10 94.7%), LongMemEval-S (R@10 99.6%), LoCoMo MTEB (R@10 68.3%), LoCoMo @ 100k, ZorkGPT iter12 PASS (ep3 score 35 vs 0) | none of comparable rigor | LEAD |
| Reasoning-rules harness (12 toggleable rules, paraphrased from `tinbeta/skills`) | `reasoning/` + `BrainReasoningRulesPanel.vue` | — | LEAD |
| Gamified quest-skill UX | `skill-tree.ts` (1500+ LOC, 30+ skills, 5 categories, combos) | — | LEAD |

## A/B testing methodology (PARITY-OJ-14)

For each of the seven starter-preset tasks (PARITY-OJ-7), run:

1. **TerranSoul** in `terransoul serve` headless mode (PARITY-OJ-2).
2. **OpenJarvis** clean Docker install (`docker run …/openjarvis:latest`).

On the **same Ollama model** (defaults to `gemma3:4b` for fair small-model
parity; `qwen2.5:14b` for capability ceiling). Same prompt set per
preset. Record per task:

- **Latency** — wall-clock p50 / p95.
- **Energy** — Wh (via PARITY-OJ-5 telemetry on TerranSoul; via
  `nvidia-smi --query-gpu=power.draw` for OpenJarvis since OpenJarvis
  exposes the metric).
- **Tokens** — prompt + completion (from each engine's API).
- **Quality** — LLM-judge 0–10 with `gpt-4o-mini` (or local
  `qwen2.5:14b` for an air-gapped variant; report both when budget
  permits).

Acceptance: publishable table in
[`../benchmark/COMPARISON.md`](../benchmark/COMPARISON.md) showing
TerranSoul matches OpenJarvis (≤ 20 % regression on each axis) on at
least **6 of 7** preset tasks. TerranSoul-only presets
(voice-companion, vrm-overlay) are reported in a separate
TerranSoul-only column rather than ranked against a missing competitor
cell (same convention as the LoCoMo at-scale 100k row in
`COMPARISON.md`).

## Chunk roll-up

| Chunk | Closes | Pillar |
|---|---|---|
| PARITY-OJ-1 | this audit doc + CREDITS row + seed lesson | meta |
| PARITY-OJ-2 | CLI surface (`init/ask/doctor/serve`) | CLI |
| PARITY-OJ-3 | vLLM + SGLang + llama.cpp engines | Engine |
| PARITY-OJ-4 | `agent_traces` store | Learning |
| PARITY-OJ-5 | telemetry + energy polling | Learning |
| PARITY-OJ-6 | trace-driven skill optimizer | Learning |
| PARITY-OJ-7 | 7 starter presets | CLI + UX |
| PARITY-OJ-8 | 5 new agent harnesses | Agent |
| PARITY-OJ-9 | agentskills.io catalog ingestion | Tools |
| PARITY-OJ-10 | scheduled / continuous agent execution | Agent |
| PARITY-OJ-11 | Google / Microsoft / iCloud OAuth | Integrations |
| PARITY-OJ-12 | public leaderboard | Learning |
| PARITY-OJ-13 | hardware-aware first-launch auto-config | Engine |
| PARITY-OJ-14 | A/B parity validation bench | Bench |


---

## Harness & Reasoning Layer — `docs/brain-advanced-design.md` vs OpenJarvis (deep audit, 2026-05-26)

> **Why this section exists:** the audit above tabulates *capabilities*. This section answers the
> follow-up question — *"in the layer between user input and the LLM, is TerranSoul's
> brain-advanced-design.md harness deeper than OpenJarvis's?"* — by mapping
> [`brain-advanced-design.md`](brain-advanced-design.md) §§4, 19, 20, 21 onto OpenJarvis's `native_react`,
> `native_openhands`, `deep_research`, `monitor_operative`, `morning_digest` agents and per-engine routing.
>
> **Short verdict: TerranSoul's harness is materially deeper than OpenJarvis on retrieval, controllers,
> routing, and write-back; OpenJarvis is materially deeper on named agent templates and trace-driven
> optimization.** PARITY-OJ-8 should therefore land as *name-and-wire existing controllers + add the two
> agent shapes TerranSoul genuinely lacks (CodeAct, Digest)*, not as a five-new-agent rewrite.

### H.1 Retrieval pipeline depth

| Stage | TerranSoul (`brain-advanced-design.md` §4, §19) | OpenJarvis | Verdict |
|---|---|---|---|
| Fast-path gate | `should_skip_rag` + `shouldUseFastChatPath` skip embed/search on greetings | none documented | LEAD |
| Embedding | `mxbai-embed-large` default (BENCH-LCM-5) + 6-model fallback chain + 60 s `/api/tags` cache + cloud `embed_for_mode` | `nomic-embed-text` only | LEAD |
| Hybrid scoring | 6 signals (vector 0.40 / keyword 0.20 / recency 0.15 / importance 0.10 / decay 0.10 / tier 0.05) over FTS5 + corpus-aware lexical | flat `memory.db` lookup | LEAD |
| Rank fusion | RRF (`memory/fusion.rs`, k=60) over vector + keyword + freshness | — | LEAD |
| Query expansion | HyDE (`memory/hyde.rs`), intent-gated via `query_intent::should_run_hyde` (Semantic/Episodic only) | — | LEAD |
| Reranking | LLM-as-judge cross-encoder (`memory/reranker.rs`, prompt + parser + 14 tests); cloud streaming uses `retrieve_chat_rag_memories_reranked` | — | LEAD |
| KG cascade | `memory::cascade::cascade_expand` (1–2 hop BFS with `seed × edge_prior × 0.7^depth`) into RRF pool, gated by `enable_kg_boost` | — | LEAD |
| Temporal filter | `parse_time_range` post-RRF drop-out before rerank (CHAT-PARITY-3) | — | LEAD |
| Late chunking | `memory::late_chunking` with `CharSpan` + `embed_tokens` (Jina AI Sep 2024 pattern) | — | LEAD |
| Contextual retrieval | `memory::contextualize.rs` (Anthropic Sep 2024 — chunk-prepended context) | — | LEAD |
| Matryoshka 2-stage | `memory::matryoshka.rs` (truncate + two_stage_search) | — | LEAD |
| Temporal KG | `memory_edges.valid_from / valid_to` + `MemoryEdge::is_valid_at` + `close_edge` (Zep/Graphiti pattern) | — | LEAD |
| Context pack contract | `[RETRIEVED CONTEXT]` outer wrapper with explicit "not exhaustive" disclosure | — | LEAD |

**Conclusion:** TerranSoul's retrieval is roughly **a decade of 2022–2026 RAG research wired into one
codebase**; OpenJarvis's "memory" tool is a flat KV lookup. The gap here is too large to be a parity item
— it is recorded above in *Where TerranSoul leads* so PARITY-OJ-14 does not flatten it.

### H.2 Reasoning controllers (the harness layer itself)

| Controller | TerranSoul status | OpenJarvis | Verdict |
|---|---|---|---|
| Single-turn chat | `commands::chat` / `commands::streaming` with intent classifier fast-path (`brain::intent_classifier`) | `simple` agent | PASS |
| Orchestrator (multi-turn, auto tool selection) | `orchestrator::AgentOrchestrator` with capability gates (`orchestrator/agent_orchestrator.rs`) | `orchestrator` agent | PASS |
| ReAct (Thought-Action-Observation) | **Building blocks present** — `orchestrator::agentic_rag` ships the parser + `AGENTIC_RAG_TOOL_DESCRIPTION` + system prompt + `AgenticRagResult`; only single-tool today (`retrieve_memory`). Self-RAG reflection-token controller already ships in `orchestrator::self_rag` (3-iter decision SM). Naming + multi-tool wiring is the gap. | `native_react` | PARTIAL — name + wire |
| Self-reflective stopping | `orchestrator::self_rag` reflection-token parser + `Decision::Accept/Retrieve/Refine` SM — design-doc §19.2 row 5 | — | LEAD (we have it; OJ does not) |
| Corrective fallback (CRAG) | `memory::crag` evaluator (`build_evaluator_prompts` + `parse_verdict` + `aggregate` over Correct/Ambiguous/Incorrect) + full `commands::crag::run_crag_retrieve` with web-search fallback via `build_web_search_url` (DuckDuckGo HTML) | — | LEAD |
| DeepResearch (multi-hop retrieve + cite) | **Partial** — CRAG already does retrieve → evaluate → rewrite → web-fallback, and `used_web_search` flag is surfaced; missing piece is `[n]`-style citation markers in the final answer and an explicit multi-hop loop ceiling | `deep_research` | PARTIAL — add citations + named harness |
| CodeAct (LLM-generates-Python in sandbox) | — | `native_openhands` | MISSING |
| MonitorAgent (long-horizon continuous) | — (closed by PARITY-OJ-10 scheduler, not PARITY-OJ-8) | `monitor_operative`, `operative` | MISSING → scheduler track |
| Digest (scheduled spoken briefing) | — | `morning_digest` | MISSING |
| Reasoning-rules harness | 12 toggleable rules (`reasoning/` + `BrainReasoningRulesPanel.vue`) — TerranSoul-only | — | LEAD |
| Reasoning budget slider | `settings::ReasoningEffort { Off, Low, Medium, High }` + Ollama `think:` + `num_predict` knob | — | LEAD |

**Conclusion:** TerranSoul already ships **two reasoning controllers OpenJarvis does not have**
(Self-RAG + CRAG) and the **parsing infrastructure** for a third (agentic_rag). What it lacks is
*names and orchestration glue* — the user-visible "this is the ReAct harness" / "this is the DeepResearch
harness" surfaces. PARITY-OJ-8 is therefore best framed as *naming + wiring*, plus the two genuinely
missing agent shapes (CodeAct, Digest).

### H.3 Decision routing — who decides what

| Aspect | TerranSoul (`brain-advanced-design.md` §20) | OpenJarvis | Verdict |
|---|---|---|---|
| Deterministic-router topology | Documented 19-row decision matrix; 4 explicit LLM-only decision points (semantic-search-entries, extract-facts, extract-edges, free-text chat intent); pure-Rust routing for everything else | per-agent TOML in `config.toml` | LEAD |
| Provider rotation | `ProviderRotator::next_healthy_provider` — fastest healthy non-rate-limited free provider | none documented | LEAD |
| Embed-model resolver | `OllamaAgent::resolve_embed_model` with 60 s cache + permanent unsupported-model marking | — | LEAD |
| Failure / degradation matrix | Documented `effective_quality` percentages (0% / 60% / 100%) per failure mode, surfaced in Brain hub Active Selection panel | — | LEAD |
| UI surface for "what is currently selected" | `BrainView.vue` "Active Selection" + `get_brain_selection` Tauri command | — | LEAD |
| Per-agent engine routing | — (single active brain) | `engines.toml` routes per-agent backend (Ollama/vLLM/SGLang/llama.cpp) | PARTIAL → PARITY-OJ-3 + PARITY-OJ-13 |
| Hardware-aware engine pick | `model_recommender::recommend_for_ram` (RAM-only today) | `jarvis init` inspects CPU/GPU | PARTIAL → PARITY-OJ-13 |

**Conclusion:** TerranSoul's routing is **introspected and documented** in a way OpenJarvis's is not.
The one OJ advantage — per-agent engine routing — only matters once PARITY-OJ-3 lands multi-engine
support, at which point §20 already prescribes how to add the row (§20.6).

### H.4 Write-back / learning loop

| Step | TerranSoul (`brain-advanced-design.md` §21) | OpenJarvis | Verdict |
|---|---|---|---|
| Live append (short-term) | `state.conversation: Mutex<Vec<Message>>`, last 20 messages assembled into prompt | session history | PASS |
| Auto-learn cadence policy | `memory::auto_learn` pure-function policy (`Fire / SkipDisabled / SkipBelowThreshold / SkipCooldown`); default every 10 turns + 3-turn cooldown; configurable per user | — (no documented gating) | LEAD |
| Fact extraction | `brain_memory::extract_facts` (≤5 atomic facts) + `save_facts` | — | LEAD |
| Session reflection | `/reflect` + `reflect_on_session` + `derived_from` edges to source turns | — | LEAD |
| Persona drift detection | `persona::drift::build_drift_prompt` + 14 unit tests; piggybacks on auto-learn (every 25 facts) | — | LEAD |
| Sleep-time consolidation | `memory::consolidation::run_sleep_time_consolidation` (Letta sleep-time-compute pattern); creates parent `summary` rows + `parent_id` + `derived_from` edges | — | LEAD |
| Background scheduler | `brain::maintenance_runtime` tick loop (desktop + `npm run mcp` tray) with `maintenance_state.json` persistence | systemd / launchd service | PASS |
| Decay + GC | `apply_memory_decay` exponential + `gc_memories` threshold + `promote_memory` on importance ≥ 4 | — | LEAD |
| Auto-edge extraction | `extract_edges_via_brain` — manual today; per-fact-extraction auto-firing is a §21.7 gap | — | LEAD (with gap) |
| Trace-driven skill optimization | shipped in PARITY-OJ-6 (`brain::skill_optimizer` + `commands::skill_optimizer`); LLM-as-judge + A/B holdout + Markdown diff | `jarvis optimize skills --policy dspy` | PASS |
| Contradiction resolution | `embed_and_detect_contradiction` shared helper + `MemoryView` Contradictions section + `claim-verification` skill-tree quest | — | LEAD |

**Conclusion:** Write-back is a category TerranSoul **strongly leads** — there is no documented OpenJarvis
analogue to the `auto_learn` cadence policy, persona drift detector, sleep-time consolidation, or
contradiction resolver. The only OJ-equivalent capability (skill optimization) shipped in PARITY-OJ-6.

### H.5 What TerranSoul is genuinely missing (PARITY-OJ-8 reframed)

After this audit the PARITY-OJ-8 chunk should ship the following, in this order:

1. **Name the existing parsers as the *ReAct* harness.** `orchestrator::agentic_rag` already has the
   Thought-Action-Observation parser, system prompt, and `AgenticRagResult` struct (single-tool today —
   `retrieve_memory`). Extend its `Tool` set to include `web_search` (reusing
   `memory::crag::build_web_search_url` + the existing CRAG fetch path) and surface it via a
   `ReAct` (or `Agentic`) brain-harness setting alongside `ReasoningEffort`.
2. **Name the existing CRAG-plus-Self-RAG loop as *DeepResearch*.** `commands::crag::run_crag_retrieve`
   already does retrieve → evaluate → rewrite → web-fallback with a `used_web_search` flag. Add per-hop
   `Citation { source, snippet, url }` tracking on `CragResult` (or on a new `DeepResearchResult`
   wrapper) and emit `[n]`-style markers in the final answer. Cap multi-hop ceiling at 3 hops (matches
   `multi_hop_search_memories`).
3. **Add CodeAct.** New `orchestrator::code_act` module — LLM emits a Python block, host runs it through
   an existing `wasm-sandbox` or a subprocess sandbox (TerranSoul already ships WASM hooks for memory
   processors; same pattern). Tool-call schema mirrors §H.2 `code_interpreter`.
4. **Add Digest.** New `orchestrator::digest` agent — combines `read_inbox` + `read_calendar`
   (PARITY-OJ-11 OAuth) with the existing TTS pipeline. Scheduling is owned by PARITY-OJ-10. Until
   PARITY-OJ-11 ships, digest reads from local memory only (already useful for "what did we discuss
   yesterday?" style briefings).
5. **MonitorAgent moves out of PARITY-OJ-8 entirely** — it is a *scheduler* feature, owned by
   PARITY-OJ-10. PARITY-OJ-8 only needs to ensure agents can be re-entrant across runs (state stored as
   `memory_type='context'` rows with `tags='agent_state:<id>'`).

### H.6 What this changes in the roadmap

- **PARITY-OJ-8 scope shrinks** from "5 new agent harnesses" to "name + wire existing controllers (ReAct,
  DeepResearch) + add 2 genuinely missing shapes (CodeAct, Digest); MonitorAgent → PARITY-OJ-10".
- **TerranSoul keeps its harness lead** — the §H.1 retrieval table, §H.2 controllers row, §H.3 routing
  matrix, and §H.4 write-back loop all show TerranSoul shipping techniques OpenJarvis does not have.
  The A/B bench (PARITY-OJ-14) records these as a TerranSoul-only column rather than ranking them
  against missing OJ cells (same convention as voice-companion / vrm-overlay presets).
- **The deep-research / monitor / digest gaps are real** — but they are *agent-template* gaps, not
  *reasoning-engine* gaps. Closing them does not require building a new harness from scratch; it
  requires naming and wiring what `brain-advanced-design.md` §§4, 19, 20, 21 already designed.
