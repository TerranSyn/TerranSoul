# Brain Advanced Design ↔ Daily Chatbox — Feature Mapping & Audit

> **Purpose.** [docs/brain-advanced-design.md](brain-advanced-design.md) is the
> canonical reference for TerranSoul's brain/RAG/memory architecture. This
> document audits **every feature in that design doc against what the
> chatbox actually fires per turn** — what is wired into the live message
> path, what is exposed as a slash command or button next to chat, what is
> registered as a Tauri/MCP command but not yet on the chatbox path, and
> what is documented but unimplemented.
>
> **Scope = "daily chatbox"**: the user typing a message in `ChatView.vue`,
> hitting Enter, and reading the streamed reply. This excludes pure setup
> screens, code-intelligence, MCP-only surfaces, and standalone admin
> tooling unless they directly affect a chat turn.
>
> Last audited: 2026-05-11. Source-of-truth code paths cited inline.

---

## 1. Anatomy of one chatbox turn

`ChatView.vue` → `useConversationStore().sendMessage()` →
[src/stores/conversation.ts](../src/stores/conversation.ts) drives the turn.
Backend assembly lives in
[src-tauri/src/commands/streaming.rs](../src-tauri/src/commands/streaming.rs)
(desktop) and
[src-tauri/src/ai_integrations/grpc/phone_control.rs](../src-tauri/src/ai_integrations/grpc/phone_control.rs)
(iOS / paired-mobile / browser-LAN).

| # | Step | Where | Maps to design doc |
|---|------|-------|--------------------|
| 1 | Push user msg into in-memory `Vec<Message>` (short-term tier) | `state.conversation`, `commands/chat.rs` | §2 Short-Term Memory, §21.1 Step 1 |
| 2 | Frontend fast-path gate (`shouldUseFastChatPath`) — short content-light turns skip classifier + RAG | [conversation.ts L78](../src/stores/conversation.ts#L78) | §4 Step 0, §20.2 row 10a |
| 3 | LLM intent classifier `classify_intent` (free → paid → local → 1.5s timeout, LRU cache) | [intent_classifier.rs](../src-tauri/src/brain/intent_classifier.rs), [conversation.ts L172](../src/stores/conversation.ts#L172) | §25 |
| 4 | If decision ≠ chat → side-channel routing (learn-with-docs quest, teach-ingest, gated setup) | conversation.ts `sendMessage` switch | §25.2, §25.5 |
| 5 | Backend `send_message_stream` builds prompt: `SYSTEM_PROMPT_FOR_STREAMING` + RAG block + persona block + one-shot handoff block | [streaming.rs L700-770](../src-tauri/src/commands/streaming.rs#L700-L770) | §4 Step 4, §20.3 |
| 6 | Backend RAG: `should_skip_rag` → `embed_for_mode` where safe → `retrieve_chat_rag_memories` (`hybrid_search_with_threshold` eligibility + `hybrid_search_rrf_with_intent` final order) → `format_retrieved_context_pack` | streaming.rs, phone-control gRPC | §4 Steps 0–3, §3.5.6 |
| 7 | Provider streams tokens via `llm-chunk` events; `<anim>`/`<pose>` parsed by `StreamTagParser` and split into `llm-animation` | streaming.rs, OllamaAgent / OpenAiClient / FreeProvider | §4 Step 4, §10 |
| 8 | Push assistant msg to short-term; charisma/sentiment/quest hooks fire | conversation.ts after-stream block | §3.5, §21 |
| 9 | Auto-learn evaluator: `evaluate_auto_learn(total_turns, last_autolearn_turn)` | [auto_learn.rs](../src-tauri/src/memory/auto_learn.rs), [conversation.ts L1334](../src/stores/conversation.ts#L1334) | §21.2 |
| 10 | On `Fire`: `extract_memories_from_session` uses segmented extraction when embeddings are available, writes ≤5 atomic facts, then best-effort auto-extracts KG edges when `auto_extract_edges` is enabled | [conversation.ts](../src/stores/conversation.ts), `commands/memory.rs::extract_memories_from_session`, [memory/brain_memory.rs](../src-tauri/src/memory/brain_memory.rs) | §21.1 Step 4, §21.7, §11 op 1 |
| 11 | On accumulated 25 facts: `check_persona_drift` → `DriftReport` | [conversation.ts](../src/stores/conversation.ts), [persona/drift.rs](../src-tauri/src/persona/drift.rs) | §21.6 |
| 12 | Background `MaintenanceJob` ticks (decay, GC, promote, edge extraction, Obsidian export, sleep-time consolidation, conflict scan) — independent of any single turn | [brain/maintenance_runtime](../src-tauri/src/brain/maintenance_runtime.rs) | §21.1 Step 5, §16 Phase 4-6 |

Browser mode runs an analogous pipeline in
[src/transport/browser-rag.ts](../src/transport/browser-rag.ts) backing the
`memory` Pinia store, and `conversation.ts` falls back to direct provider
calls listed by `browserDirectFallbackProviders` when Tauri IPC is absent.

---

## 2. Per-feature mapping table

Status legend:
- ✅ **Live on every chat turn** — fires automatically inside the user-typed
  send pipeline above.
- 🟢 **One-click adjacent** — wired to a chat-side button, slash command, or
  the immediate post-turn flow.
- 🟡 **Registered, not on chat path** — Tauri/MCP command exists and is
  exercised by MemoryView/BrainView/MCP, but not called from `ChatView`.
- 🔵 **Background-only** — runs in the maintenance scheduler / consolidation
  job, never per chat turn.
- ⚪ **Documented gap or roadmap** — design doc lists it, code does not yet
  hit it from any user-visible path.

### 2.1 Three-tier memory model (§2)

| Feature | Status | Chatbox surface | Backend |
|---|---|---|---|
| Short-term `Vec<Message>` window (last ~20) | ✅ | Every turn appended; last 20 read into the next prompt. | `state.conversation`, `commands/chat.rs`, `streaming.rs` ~L224 |
| Working-tier writes (`tier='working'`) | ✅ | Auto-learn fact extraction writes here on every Fire. | `memory/brain_memory.rs::save_facts` |
| Long-tier promotion when `importance ≥ 4` | 🔵 | `auto_promote_memories` runs in the maintenance scheduler; users can press *Promote* in MemoryView. | `MemoryStore::auto_promote_to_long` |
| Tier-aware hybrid scoring (`tier_priority` 5 % weight) | ✅ | Applied during threshold eligibility on every contentful turn, then RRF+intent decides final prompt order. | `memory/store.rs::hybrid_search`, `commands/streaming.rs::retrieve_chat_rag_memories` |

### 2.2 Memory categories + cognitive kinds (§3, §3.5)

| Feature | Status | Chatbox surface | Backend |
|---|---|---|---|
| Tag-prefix taxonomy (`personal:*`, `domain:*`, …) | ✅ | Every auto-learned fact runs through `auto_tag` (when `AppSettings.auto_tag` on), tags merged with curated prefixes before insert. | `memory/auto_tag.rs`, `memory/tag_vocabulary.rs` |
| Cognitive-kind classifier (episodic / semantic / procedural / judgment) | ✅ | Classified at write time when `cognitive_kind` is `NULL`; falls back to pure-fn heuristic at retrieval. | `memory/cognitive_kind.rs`, mirror `src/utils/cognitive-kind.ts` |
| Query-intent kind boosts via `hybrid_search_rrf_with_intent` | ✅ | Desktop streamed chat and paired-mobile chat use it for final prompt order after threshold eligibility. Search-only RemoteHost/MCP surfaces expose it through RRF modes. | `commands/streaming.rs::retrieve_chat_rag_memories`, `memory/store.rs`, `memory/query_intent.rs` |
| Kind-aware decay multipliers | 🔵 | Applied inside `apply_memory_decay` on the maintenance tick. | `memory/store.rs` |

### 2.3 Hybrid RAG pipeline (§4)

| Feature | Design status | Chatbox status | Notes |
|---|---|---|---|
| Fast-path gate (`should_skip_rag` / `shouldUseFastChatPath`) | ✅ | ✅ | Frontend short-circuits classifier + retrieval; backend skips embed + search for `count==0` or short turns. Mirror unit tests in [streaming.rs L1469-1478](../src-tauri/src/commands/streaming.rs#L1469-L1478). |
| Embed query via `embed_for_mode` (Ollama local; cloud `/v1/embeddings` for free/paid) | ✅ | ✅ | `brain::cloud_embeddings::embed_for_mode`, `OllamaAgent::resolve_embed_model` (60 s `/api/tags` cache + unsupported-model cache). |
| Hybrid 6-signal scoring (vector 40 / kw 20 / recency 15 / importance 10 / decay 10 / tier 5) | ✅ | ✅ | Used as the relevance-threshold eligibility gate before prompt injection. |
| RRF fusion (vector + keyword + freshness, k=60) | ✅ | ✅ | Used by desktop streamed chat and paired-mobile chat through `retrieve_chat_rag_memories`; exposed separately as `hybrid_search_memories_rrf` for MemoryView/MCP. |
| HyDE (`hyde_search_memories`) | ✅ | ✅ | Tauri command + MCP tool; **auto-fired on live chat send** for Semantic/Episodic queries when `hyde_enabled` is true + brain configured (DOCAUDIT-1). |
| LLM-as-judge cross-encoder rerank (`rerank_search_memories`) | ✅ | ✅ | Tauri command + MCP tool; **auto-fired on live chat send** when a local brain is configured (DOCAUDIT-1). Threshold: `rerank_threshold` (default 0.55). |
| Matryoshka two-stage search (`matryoshka_search_memories`) | ✅ | 🟡 | Tauri command exists; not on chat path. |
| Multi-hop graph search (`multi_hop_search_memories`) | ✅ | 🟡 | Available in MemoryView and MCP; chat send does single-hop hybrid only. |
| Relevance threshold (`AppSettings.relevance_threshold`) | ✅ | ✅ | Read on every contentful chat turn and applied before RRF results are injected. UI control in BrainView. |
| Top-k injection (k=5) into `[RETRIEVED CONTEXT]` / `[LONG-TERM MEMORY]` block | ✅ | ✅ | Hard-coded to 5 in all three streaming branches and in phone-control gRPC. |
| `[RETRIEVED CONTEXT]` outer wrapper contract | ✅ | ✅ | `memory/context_pack.rs::format_retrieved_context_pack` invoked at every injection site, including browser RAG path. |
| Vector index adapter (linear cosine default; `native-ann` HNSW via `usearch`) | ✅ | ✅ (transparent) | `memory/ann_index.rs`. |
| Embedding model fallback chain (nomic → mxbai → snowflake → bge-m3 → all-minilm → chat model → keyword-only) | ✅ | ✅ | `OllamaAgent::resolve_embed_model`. |
| Cloud embeddings (free/paid modes) | ✅ | ✅ | `brain::cloud_embeddings::embed_for_mode` called inside the streaming RAG block. |
| Plugin memory hooks (`pre_store` / `post_store`) | ✅ | ✅ (indirect) | Auto-learned writes go through `add_memory`, which fires the hook chain when plugins contribute `memory_hooks`. |
| Tool plugins / brain routing (e.g. `openclaw-bridge`) | ✅ | 🟢 | Slash commands handled by plugin dispatcher in ChatView before hitting the LLM. |

### 2.4 Decay & garbage collection (§5)

| Feature | Status | Surface | Notes |
|---|---|---|---|
| Exponential `decay_score = 0.95^(hrs/168)` | ✅ (data-side) / 🔵 (refresh) | Decay multiplier weights every retrieval (10 % signal). Refresh runs on the maintenance tick or explicit *Apply Decay* in MemoryView. | `MemoryStore::apply_memory_decay`, [memory.ts L224](../src/stores/memory.ts#L224) |
| Configurable in-memory + storage caps (`max_memory_mb`, `max_memory_gb`) | ✅ | Range/number controls in MemoryView; enforced after every write & maintenance pass. | `MemoryStore::enforce_size_limit` |
| Category-aware decay multipliers | ✅ | Background-only; no per-turn UI signal. | `memory/store.rs` + `memory/tag_vocabulary::category_decay_multiplier` |
| GC threshold (`decay < 0.05 AND importance ≤ 2`, respects `protected`) | 🟢 | *Garbage Collect* button in MemoryView; runs on maintenance tick. | `MemoryStore::gc_memories`, [memory.ts L233](../src/stores/memory.ts#L233) |

### 2.5 Knowledge graph (§6, §7.5)

| Feature | Status | Chatbox surface | Backend |
|---|---|---|---|
| `memory_edges` schema (typed, directional, confidence, source, valid_from/to) | ✅ | Underlies multi-hop and audit. | `memory/edges.rs`, schema V21 |
| LLM edge extraction (`extract_edges_via_brain`) | ✅ / 🟢 | Best-effort auto-fires after successful chat fact extraction when `auto_extract_edges` is enabled and a local active model exists; also available from MemoryView and maintenance. | `commands/memory.rs::extract_memories_from_session`, `memory/brain_memory.rs::propose_edges`, [memory.ts](../src/stores/memory.ts) |
| Multi-hop hybrid search (`hybrid_search_with_graph` / `multi_hop_search_memories`, ≤3 hops) | 🟡 | MemoryView *Multi-hop* search and MCP `brain_kg_neighbors`. Not on chat send. | `memory/edges.rs`, [memory.ts L373](../src/stores/memory.ts#L373) |
| Memory-audit provenance view | 🟢 | MemoryView *Audit* panel via `get_memory_provenance`. | `memory/audit.rs` |
| 3-D KG viewport (Three.js + d3-force-3d) | 🟢 | `MemoryGraph3D.vue` rendered inside `MemoryGraph.vue` when mode='3d'. | `src/components/MemoryGraph3D.vue` |
| Folder ↔ KG sync (`sync_context_folders`, `import_file_to_knowledge_graph`, `export_kg_subtree`, `convert_context_to_knowledge`) | 🟢 | BrainView *📂 Context Folders* panel + `/digest <path>` slash command in chat. | `commands/context_folder.rs` |
| Temporal KG (`valid_from`/`valid_to`, `close_memory_edge`, `get_edges_for_at`) | 🟡 | Schema + commands shipped; no chatbox UI yet. | `memory/edges.rs` |
| Paged graph adjacency (billion-scale Phase 5) | ✅ | `memory_graph_page` detail+focus fast path uses O(k log n) paged adjacency via covering indexes instead of full-graph load. | `memory/graph_paging.rs`, `commands/memory.rs` |
| FTS5 keyword index (billion-scale Phase 4) | ✅ | Transparent — keyword retriever uses `keyword_candidate_ids_fts5()` fast path with INSTR fallback when FTS5 unavailable. | `memory/store.rs`, `memories_fts` virtual table, schema V21 |
| Shard backpressure + health (billion-scale cross-cutting) | ✅ | Transparent — `shard_health_summary()` wired into `brain_health` MCP response; backpressure rejects ingests at shard capacity (2M default). | `memory/shard_backpressure.rs`, `ai_integrations/gateway.rs` |

### 2.6 SQLite, schema, persistence (§8, §9)

All transparent to chat. WAL mode, auto-backup `memory.db.bak`, schema V21
with `pending_embeddings`, `protected`, `cognitive_kind`, `category`,
`updated_at`, `origin_device` columns, FTS5 keyword index (`memories_fts`),
composite covering indexes on `memory_edges`, and `memory_graph_clusters`
pre-aggregated table are all enforced at startup. ✅.

### 2.7 Brain modes & provider architecture (§10, §10.1)

| Feature | Status | Chatbox surface |
|---|---|---|
| `BrainMode` enum (Free / Paid / Local Ollama) | ✅ | Mode badge in ChatView header; *Reconfigure LLM* button. |
| `ProviderRotator` (fastest healthy free provider) | ✅ | Used by both `classify_intent` and the streaming chat path. |
| Free-API model selection persisted in `BrainMode::FreeApi { model }` | ✅ | Browser modal, marketplace, setup wizard. |
| Local Ollama RAM-adaptive recommender (`model_recommender.rs`) | ✅ | Setup + BrainView *Model* picker. |
| LocalOllama VRAM guard (5 min startup quiet, embed pause during chat, `keep_alive: 0` on embed, `keep_alive: 30m` on chat, `think:false` on hot stream) | ✅ | Invisible, but every local turn benefits. See §4 RAG injection note (2026-05-09). |
| External CLI backend (`codex`, `claude`, `gemini`, custom) | 🟢 | Selected per-agent in Agent Roster; chat goes through `agents/cli_worker.rs` instead of unified LLM interface. |

### 2.8 LLM-powered memory ops (§11)

| Op | Status | Chatbox surface |
|---|---|---|
| `extract_facts` | ✅ | Auto-learn Fire after every N turns; manual *Extract from session* in MemoryView. |
| `summarize_session` | 🟢 | MemoryView *Summarize* button; not auto-fired. [memory.ts L171](../src/stores/memory.ts#L171). |
| Legacy `semantic_search_entries` (LLM ranks all entries) | 🟡 | Deprecated per §11; replaced by `hybrid_search`. Still exposed for backwards compatibility. |
| `embed_text` | ✅ | Used at every contentful turn for the query embedding and at every memory write. |
| Duplicate check (cosine > 0.97 dedup) | ✅ | Runs inside `add_memory`. |
| `backfill_embeddings` | 🟢 | MemoryView button; auto on first-run seeding for MCP. |
| `extract_edges_via_brain` | ✅ / 🟢 | See §2.5. |
| `multi_hop_search_memories` | 🟡 | See §2.5. |
| `reflect_on_session` (`/reflect`) | 🟢 | Slash command in ChatView at [ChatView.vue L1267](../src/views/ChatView.vue#L1267); writes `session_reflection` summary + `derived_from` edges. |

### 2.9 Multi-source knowledge management (§12)

| Feature | Status | Chatbox surface |
|---|---|---|
| Source-hash change detection on re-ingest | ✅ | Triggered by *Sync* in BrainView and by `/digest <url|file>` in chat. |
| NotebookLM-style source guides | ✅ | Created automatically by `commands/ingest::run_ingest_task`. Broad questions retrieve the guide before raw chunks. |
| `expires_at` TTL expiry | ✅ | Daily maintenance pass deletes expired rows. No chatbox UI. |
| Access-count decay → GC candidates | ✅ | Maintenance + MemoryView. |
| LLM contradiction resolution (`memory::conflicts`) | 🔵 | Runs on maintenance tick (`edge_conflict_scan`) and after KG-subtree re-imports. Surfaces via Audit panel. |

### 2.10 Context Folders (§12.5)

🟢 — wired through BrainView panel and the `/digest` slash command. After
ingest, chunks join hybrid RAG so the next chat turn already retrieves
them. *Convert to Knowledge* and *Export to Folder* are user-triggered.

### 2.11 Browser-mode RAG surface

`src/transport/browser-rag.ts` mirrors the desktop pipeline: IndexedDB +
localStorage persistence, deterministic embedding seam, flat vector
search, RRF (k=60) fusion, HyDE prompt builder for direct provider
calls, and the same `[RETRIEVED CONTEXT]` injection contract before
streaming. Browser turns also write back into local memory. ✅.

### 2.12 Brain component selection & routing (§20)

| Feature | Status | Chatbox surface |
|---|---|---|
| Deterministic Rust router (mode, rotator, embed model, tier weights, storage backend) | ✅ | Underlies every turn. |
| LLM-driven decision points (intent classifier, fact extraction, edge type, memory ranking) | ✅ | Intent classifier per turn; the others on auto-learn / KG ops. |
| `BrainSelection` snapshot via `get_brain_selection` | 🟢 | BrainView *Active Selection* panel; not on chat send. |
| Failure / degradation contract (rotator, no embed → keyword-only, fast-path skip) | ✅ | Exercised on every turn under failure modes; UI signals in BrainView strip + provider badges. |

### 2.13 Write-back / learning loop (§21)

| Feature | Status | Chatbox surface |
|---|---|---|
| Auto-learn cadence policy (`AutoLearnPolicy`) | ✅ | Defaults: enabled, every 10 turns, cooldown 3. Configurable in BrainView *Daily learning* card. |
| Auto-learn evaluator decisions (`Fire` / `SkipDisabled` / `SkipBelowThreshold` / `SkipCooldown`) | ✅ | Toast on Fire; progress dial in BrainView. |
| `extract_memories_from_session` on Fire | ✅ | conversation.ts L1340. |
| `summarize_session` | 🟢 | MemoryView only. |
| `reflect_on_session` | 🟢 | `/reflect` slash command. |
| Persona drift detection (every 25 facts) | ✅ | Toast surfaces `DriftReport` from `check_persona_drift`. |
| Background scheduler (`brain::maintenance_runtime`) — decay, GC, promote, edge extraction, Obsidian export | ✅ (background) | Runs in app + headless `npm run mcp` runner; honours `AppSettings.maintenance_interval_hours`. |
| Conversation-aware (segmented) extraction | ✅ | `extract_memories_from_session` calls `extract_facts_segmented_any_mode`; it falls back to single-pass extraction when there are too few turns or embeddings are unavailable. |
| Auto-fire `extract_edges_via_brain` after each `extract_facts` | ✅ | Best-effort follow-up after successful fact writes; gated by `auto_extract_edges` and active model availability. |
| Replay-from-history rebuild | ⚪ | Roadmap (§21.7). |

### 2.14 MCP server surface that touches chat (§24)

| Feature | Status | Chatbox surface |
|---|---|---|
| `mcp-activity` event + `McpActivityPanel.vue` | 🟢 | Visible in BrainView while external agents drive the brain; surfaces TTS speech. Not directly part of `sendMessage`. |
| `brain_wiki_*` MCP tools (audit, spotlight, serendipity, revisit, digest_text) | 🟢 | Same operations exposed in chat as `/ponder`, `/spotlight`, `/serendipity`, `/revisit`, `/digest`. |
| LAN sharing (`token_required` / `public_read_only`) | 🟢 | Off by default; enables remote chat clients to query this brain. |

### 2.15 Knowledge Wiki ops (§26)

✅ on the chat path through slash commands wired in
`src/utils/slash-commands.ts` and dispatched by `ChatView.vue` before
plugin slash dispatch:

| Slash | Tauri command | Backend |
|---|---|---|
| `/digest <text>` | `brain_wiki_digest_text` | `memory/wiki.rs::ensure_source_dedup` |
| `/digest <url\|file\|crawl:…>` | `ingest_document` | normal chunk + source-guide pipeline |
| `/ponder` | `brain_wiki_audit` | `memory/wiki.rs::audit_report` |
| `/spotlight` | `brain_wiki_spotlight` | `memory/wiki.rs::god_nodes` |
| `/serendipity` | `brain_wiki_serendipity` | `memory/wiki.rs::surprising_connections` |
| `/revisit` | `brain_wiki_revisit` | `memory/wiki.rs::append_and_review_queue` |
| `/weave`, `/trace`, `/why` | (planned) | Returns a planned-state message today. |

### 2.16 Hive Protocol (§28)

⚪ — `share_scope` ACL exists; chatbox writes inherit defaults
(`episodic`/`preference`/`personal` → `private`). No chatbox-level UI
yet for changing scope per message.

---

## 3. Daily chatbox feature playbook

Use this section as the operator-facing map: what to do in chat, what the
backend runs, and what result to expect.

| Design feature | How to use it from daily chat | What fires | Expected behavior |
|---|---|---|---|
| Fast local small-talk path (§4) | Send a short greeting or acknowledgement such as "hi" or "ok". | Frontend `shouldUseFastChatPath`; backend `should_skip_rag`. | No classifier, embedding, or memory search runs. Local replies start quickly. |
| Contentful memory question (§4) | Ask a real question with a content word, for example "What do you remember about my project preferences?" | `embed_for_mode` in free/paid modes; keyword-only local hot path; `retrieve_chat_rag_memories`. | Up to five threshold-qualified memories are injected in RRF+intent order. |
| Relevance threshold (§4) | Adjust the BrainView relevance control, then ask the same memory question again. | `hybrid_search_with_threshold` gates eligible memories before RRF. | Higher threshold reduces noisy recall; lower threshold admits weaker context. |
| Query-intent cognitive boosts (§3.5) | Phrase the ask naturally: "what happened", "what facts", "how do I", or "what should I choose". | `query_intent::classify_query` inside `hybrid_search_rrf_with_intent`. | Episodic, semantic, procedural, or judgment memories receive a matching boost. |
| Free/Paid/Local brain modes (§10) | Choose a brain mode in setup/BrainView and send the same chat message. | Free/paid route chat and embeddings through provider clients; Local Ollama keeps the chat model warm and avoids hot-path embedding swaps. | The chatbox UI is unchanged; retrieval degrades from vector+keyword+freshness to keyword+freshness when embeddings are unavailable. |
| Provider failover (§10.1) | Use Free API mode with multiple configured providers, then send a chat. | `ProviderRotator` attempts healthy providers in order. | Streaming continues with the first working provider; failures surface as provider/debug events, not lost messages. |
| Visible thinking / reasoning (§10, §20) | Pick a reasoning-capable local model and enable reasoning effort. | `llm-chunk.thinking=true` chunks accumulate separately in `streaming.thinkingText`. | Chat history shows a collapsed thinking panel; the input placeholder says "Thinking..." in grey; TTS skips thinking text. |
| Auto-learn from chat (§21) | Keep chatting until the daily learning cadence fires, or use BrainView to lower the turn interval. | `evaluate_auto_learn` then `extract_memories_from_session`. | Up to five atomic facts are saved, tagged, embedded when possible, and made available to the next turn. |
| Topic-segmented extraction (§21.7) | Discuss multiple topics in one longer session before auto-learn fires. | `extract_facts_segmented_any_mode` embeds turns, segments topic shifts, extracts per segment, and deduplicates. | Learned facts stay focused instead of one blended summary. If embeddings fail, extraction falls back to single-pass. |
| Auto KG edge extraction (§6, §21.7) | Let auto-learn save facts while `auto_extract_edges` is enabled and a local active model exists. | `run_edge_extraction` follows successful fact writes. | New facts can immediately gain typed KG edges; failures are non-fatal and retried by later maintenance. |
| Manual reflection (§11, §21) | Type `/reflect`. | `reflect_on_session`. | A session summary fact is saved and linked to source turns with provenance edges. |
| Learn documents / URLs (§12) | Type `/digest <url>`, `/digest <path>`, or paste text after `/digest`. | URL/file ingest or wiki digest; chunking, source hash, embeddings, source guide, edge extraction. | The next contentful chat turn can retrieve the new source guide/chunks. |
| Knowledge Wiki curation (§26) | Use `/ponder`, `/spotlight`, `/serendipity`, `/revisit`, or `/digest ...`. | `brain_wiki_*` commands. | Chat returns audit, central-memory, connection, revisit, or digest results without opening MemoryView. |
| Multi-hop KG search (§6) | Use MemoryView/MCP multi-hop tools, then ask follow-up questions in chat. | `multi_hop_search_memories` is not called by normal send. | Multi-hop is available as an adjacent investigation tool; normal chat uses single-turn RRF context for latency. |
| HyDE cold-query retrieval (§19.3) | Auto-fires on live chat send for Semantic/Episodic queries when `hyde_enabled` is true. Also available via MemoryView/MCP `hyde` search mode. | `hyde_search_memories`; `streaming.rs` HyDE gate. | Gated by `app_settings.hyde_enabled` (default off) + intent classifier. |
| Cross-encoder rerank (§19.3) | Auto-fires on live chat send when a local brain is configured. Also available via MemoryView/MCP rerank search. | `rerank_search_memories`; `retrieve_chat_rag_memories_reranked`. | Threshold: `app_settings.rerank_threshold` (default 0.55). Adds N×~200ms per candidate on local Ollama. |
| Matryoshka search (§19.3) | Use MemoryView/MCP matryoshka search. | `matryoshka_search_memories`. | Available for search/analysis surfaces, not automatic chat send. |
| Persona drift (§21.6) | Let auto-learn accumulate at least 25 facts. | `check_persona_drift`. | A toast summarizes possible trait drift and lets the persona layer stay aligned. |
| Browser/LAN chat (§24) | Use the browser or paired mobile client. | Browser uses `browser-rag.ts`; mobile uses phone-control gRPC and the same server-side RRF helper. | The chat UI stays consistent while retrieval/prompt assembly remains server-side when paired. |
| `@source-id` per-turn source override | Type `@owner/repo` (or `@self`) anywhere in the message. | `parseSourceMentions` extracts source IDs → Rust `source_overrides` slot → `cross_source_search` scoped to mentioned sources. | The `[LONG-TERM MEMORY]` block retrieves only from the mentioned source(s) for that turn. The active source picker is never mutated. ChatInput shows an autocomplete dropdown. |
| Hive privacy scope (§28) | Chat normally. | Memory writes use schema/default scope rules. | Per-message scope override is not exposed yet; sensitive categories remain private by default. |

## 4. Verified gaps — design features **not yet automatic on the daily chatbox send path**

These are implemented elsewhere or explicitly planned, but a normal
`ChatView.vue` send does not call them automatically today.

1. ~~**HyDE on normal chat send.**~~ **CLOSED (DOCAUDIT-1).** Both cloud
  and local Ollama streaming paths now gate HyDE via
  `app_settings.hyde_enabled` + `query_intent::should_run_hyde()`. Fires
  automatically on Semantic/Episodic queries when a brain is configured.

2. ~~**Cross-encoder LLM-as-judge rerank on normal streamed send.**~~
  **CLOSED (DOCAUDIT-1).** Both streaming paths call
  `retrieve_chat_rag_memories_reranked` which runs the cross-encoder when
  a local brain is configured. Threshold controlled by
  `app_settings.rerank_threshold` (default 0.55).

3. **Matryoshka two-stage search on normal chat send.** The Tauri command
  is available for search surfaces; the chatbox does not automatically
  run the two-stage path.

4. **Multi-hop graph traversal on normal chat send.** Multi-hop is exposed
  in MemoryView and MCP, but normal chat injects direct RRF hits only.

5. **Replay-from-history rebuild.** The design doc keeps this as a §21.7
  roadmap item for rebuilding memory from historical conversation logs.

6. **`/weave`, `/trace`, `/why` slash commands.** Chat currently returns
  a planned-state message for these names.

7. **Per-message Hive `share_scope` chooser.** Schema-level support exists,
  but ChatView has no composer control to override the default scope.

---

## 5. How to verify

### 5.1 Rust unit/integration tests

```powershell
cd src-tauri
# RAG pipeline + scoring
cargo test -p terransoul --lib memory::store
cargo test -p terransoul --lib memory::fusion
cargo test -p terransoul --lib memory::hyde
cargo test -p terransoul --lib memory::reranker
cargo test -p terransoul --lib memory::contextualize
cargo test -p terransoul --lib memory::cognitive_kind
cargo test -p terransoul --lib memory::auto_learn
cargo test -p terransoul --lib memory::wiki
cargo test -p terransoul --lib memory::context_pack
# Chat surface
cargo test -p terransoul --lib commands::streaming
cargo test -p terransoul --lib brain::intent_classifier
cargo test -p terransoul --lib brain::ollama_agent
cargo test -p terransoul --lib persona::drift
```

### 5.2 Frontend tests

```powershell
npx vitest run src/stores/conversation.test.ts
npx vitest run src/stores/memory.test.ts
npx vitest run src/stores/ai-decision-policy.test.ts
npx vitest run src/transport/browser-rag.test.ts
```

### 5.3 Live chatbox dry-run

1. `npm run dev` (Tauri) **or** `npm run dev:vite -- --host 127.0.0.1` for
   browser mode.
2. Configure a brain (Free → free providers list, or Local Ollama).
3. Seed at least one memory (Memory tab → Add).
4. Send a contentful message ("What do you remember about my
   preferences?"). In the dev console you should see:
   - intent classifier IPC fires once (skipped on greetings),
   - free/paid modes resolve an embedding (or return `None` and
     keyword-only path is taken),
   - the backend calls `retrieve_chat_rag_memories`, threshold-qualifies
     candidates, and orders injected memories with RRF + query intent,
   - after every 10 contentful turns a "Brain is learning…" toast
     fires from auto-learn.
5. Type `/reflect`, `/ponder`, `/spotlight`, `/serendipity`,
   `/revisit`, `/digest …` to exercise the wiki ops directly from
   chat.

### 5.4 Auto-learn + drift sanity check

After 10 contentful turns: `MemoryStore::count(tier='working')` should
have grown by ≤ 5. After 25 cumulative facts: a `check_persona_drift`
result is rendered as a toast. `evaluate_auto_learn` decisions are
recorded in `state.last_autolearn_turn`.

---

## 6. Suggested follow-up chunks

Filed against the conventions in `rules/milestones.md`:

- **chunk:** *Optional HyDE + rerank toggles in BrainView wired into
  `send_message_stream`* (closes gaps #1 and #2, with `AppSettings`
  fields and a fast-path bypass when the brain is unreachable).
- **chunk:** *Per-message Hive `share_scope` selector in ChatView*
  (closes gap #7).
- **chunk:** *`/weave`, `/trace`, `/why` slash commands* (closes gap
  #6).

---

## 7. Related documents

- [brain-advanced-design.md](brain-advanced-design.md) — canonical
  architecture (this doc audits it).
- [billion-scale-retrieval-design.md](billion-scale-retrieval-design.md) —
  scaling path to 1B records (FTS5, paged graph, backpressure, sharded HNSW).
- [BRAIN-COMPLEX-EXAMPLE-EXPLAIN.md](../instructions/BRAIN-COMPLEX-EXAMPLE-EXPLAIN.md)
  — technical reference (schema, RAG pipeline, comparisons).
- [brain-rag-setup-tutorial.md](../tutorials/brain-rag-setup-tutorial.md)
  — quest-guided setup walkthrough with screenshots.
- [brain-rag-local-lm-tutorial.md](../tutorials/brain-rag-local-lm-tutorial.md)
  — local LM Studio variant.
- [llm-wiki-pattern-application.md](llm-wiki-pattern-application.md) —
  Knowledge Wiki ops pattern source.
- [AI-coding-integrations.md](AI-coding-integrations.md) — MCP / gRPC /
  A2A integration design.
