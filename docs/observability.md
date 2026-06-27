# TerranSoul — Observability Spec

> **Status:** Spec-driven design, implemented/shipped. Implementation record
> archived as the `OBSERVABILITY-1..8` chunks in [`rules/completion-log.md`](../rules/completion-log.md).
>
> **Methodology:** [GitHub Spec Kit / Spec-Driven Development](https://github.com/github/spec-kit)
> (MIT). We do not run the `specify` CLI; we apply the SDD seven-step flow
> (Constitution → Specify → Clarify → Plan → Tasks → Analyze → Implement)
> as document sections. Credit: `CREDITS.md`.
>
> **Audience:** developers debugging TerranSoul, users self-diagnosing
> a misbehaving companion, and the in-app LLM performing real-time
> root-cause analysis via the new `analyze_observability` tool.

---

## 1. Constitution — Observability Principles

These are the **non-negotiable** rules every observability artifact must obey.
They sit alongside `rules/architecture-rules.md` and
`rules/coding-standards.md` and trump any chunk-level decision.

| # | Principle | Why |
|---|---|---|
| C1 | **Local-first, zero telemetry exfiltration.** Logs, traces, and metrics live in `<app-data>/observability/` on the user's device. No outbound HTTP. | Aligns with TerranSoul's privacy posture (`docs/brain-advanced-design.md` C1). |
| C2 | **Structured by default.** Every log line is a `tracing` event with named fields (no `println!`, no string-interpolated logs). | Lets the LLM analyzer parse without regex; lets the UI table render columns. |
| C3 | **Three-pillar parity.** Every user-visible feature emits **logs** (what happened), **metrics** (how often / how fast), and **traces** (causal chain). Missing any pillar is a chunk gap. | WalkingLabs Verification subsystem — silent failures are debt. |
| C4 | **Correlated by `trace_id`.** A single user turn — chat → intent classify → RAG retrieve → LLM stream → tag parse → tool dispatch — emits one trace ID carried through every span and metric label. | Makes "why was that answer slow?" answerable in one query. |
| C5 | **Bounded retention.** Default 7-day rolling window for logs, 30 days for metrics aggregates, traces capped at 10 000 most recent. User-tunable in Settings. | Prevents `<app-data>` from growing unbounded. |
| C6 | **UI-first debugging.** Every persisted observability signal MUST be reachable through a Vue view — no "tail the log file" workflows for end users. CLI/file access is a developer fallback only. | Users debug from the app, not from terminals. |
| C7 | **LLM-readable surface.** A stable, versioned JSON schema (`ObservabilityQuery` / `ObservabilityFinding`) exposes the same data the UI uses to the in-app LLM via Tauri commands + MCP tools. No bespoke prompts mining unstructured logs. | C3 + WalkingLabs Scope subsystem (machine-readable tool spec). |
| C8 | **Failure modes self-instrument.** Every `?` error path in async Tauri commands and every `tracing::warn!` / `tracing::error!` increments a counter and emits a metric — silent error returns are forbidden in the chat/brain hot path. | Closes the WalkingLabs Verification Gap for runtime errors. |
| C9 | **No PII in logs by default.** Memory text, persona traits, and user messages are redacted to `<text:NN chars, sha:HHHHHHHH>` unless the user explicitly enables "Verbose mode" in Settings → Observability → Privacy. | Local-first ≠ "leak everything to whoever opens the log file." |

---

## 2. Specify — What & Why (tech-stack-free)

**Problem statement.** TerranSoul has rich instrumentation primitives —
`tracing` crate calls scattered through ~540 Tauri commands, lock-free
latency histograms in `src-tauri/src/memory/metrics.rs`, the
`brain_health` MCP surface, embedding-queue diagnostics in `BrainView.vue`,
`BreakerMetrics` for circuit breakers in `src-tauri/src/workflows/resilience.rs` —
but no unified observability stack. When a user reports "the
companion got slow" or "she forgot something she should know," there is no
single screen, no single trace ID, no single AI-driven explainer that
answers it. Developers tail console output. Users wait for a release.

**Goal.** Make every user-visible symptom traceable to a structured
event in one click, both for the developer and for the in-app LLM
itself. A user asking "why did you take so long to answer?" should get a
real, data-backed reply, not a generic apology.

**Non-goals.**
- We do not build a cloud-hosted observability service (constitution C1).
- We do not adopt full OpenTelemetry collector / Jaeger / Grafana stacks
  — too heavy for a desktop companion. We borrow the W3C tracecontext
  shape and span vocabulary, nothing else.
- We do not replace the existing `tracing` macros — we layer on top of them.
- We do not instrument **every** Tauri command in the first pass —
  hot-path coverage (chat, RAG, memory CRUD, brain provider, voice, MCP)
  is the v1 target. Cold paths get instrumented as bugs surface.

**Primary user stories.**
1. **As a user**, when the companion's reply is slow, I open **Settings →
   Observability → Recent Activity**, see the last 20 turns ranked by
   latency, click the slow one, and read an LLM-generated explanation
   ("The local Ollama provider was paused for 14 s by the embedding
   rate limiter while building working-memory embeddings — see span
   `embed_queue.pause` at 14:03:22.").
2. **As a developer**, when a test fails in CI, I open
   `<app-data>/observability/traces/last-failed.json`, paste it into the
   in-app `analyze_observability` panel, and get a hypothesis ranked
   list of root causes.
3. **As an AI coding agent (Copilot/Claude/Codex)**, when investigating
   a bug via MCP, I call the `obs_query` MCP tool with a time range and
   span name filter, get structured findings back, and use them to
   write a regression test.
4. **As a user with limited storage**, I cap observability data to 100 MB
   in Settings; older traces age out without me ever having to manage files.
5. **As an in-app LLM**, when the user asks "why don't you remember X?",
   I call `analyze_observability` with `{ "topic": "memory recall for 'X'" }`
   and get back the retrieval trace + retrieval signal weights, then
   answer the user truthfully.

**Success criteria.**
- S1: 100 % of chat turns emit a `chat.turn` root span with child spans
  `intent.classify`, `rag.retrieve`, `llm.stream`, `tag.parse`, `tool.dispatch`.
- S2: One Vue view (`ObservabilityView.vue`) lets the user see the last
  100 traces with filter (turn / memory / voice / MCP / error-only) and
  drill into any single trace's timeline.
- S3: The in-app LLM can call `analyze_observability` and produce a
  ≤300-token explanation containing at least one concrete span name +
  one concrete duration / count, in <2 s wall-clock from a warm cache.
- S4: Adding observability adds ≤5 % p50 latency to a typical chat turn
  on the canonical benchmark (`benchmark/scripts/zork-bench/`).
- S5: `<app-data>/observability/` never exceeds the user's configured cap
  even under 30-day continuous use (verified by integration test).
- S6: Removing observability (env var `TERRANSOUL_OBS_DISABLED=1`) is a
  zero-cost fast path — all macros compile to no-ops.

---

## 3. Clarify — Underspecified Areas (resolved)

These are questions a spec reviewer would ask. Decisions recorded inline
so chunks below have no ambiguity.

| Q | Decision | Rationale |
|---|---|---|
| Which trace format? | **Custom JSON aligned with W3C `traceparent` shape** — `{ trace_id (16 hex), span_id (16 hex), parent_span_id, name, start_ns, end_ns, kind, status, attrs: {...} }`. Optionally exportable to `OTLP/JSON` later. | Borrow OTel vocabulary without the collector dependency. |
| Logs storage? | **SQLite database** at `<app-data>/observability/obs.sqlite` with WAL mode, one table per pillar (`logs`, `spans`, `metrics_samples`, `metrics_aggregates`). | We already ship `rusqlite` for memory store; FTS5 already linked; the LLM-analyzer can run SQL directly. No new dep. |
| Aggregation? | **In-process Rust task** runs every 60 s: rolls raw `metrics_samples` into 1-min / 5-min / 1-h buckets in `metrics_aggregates`, then prunes samples older than 24 h. | Avoids an external time-series DB. |
| What does the LLM see? | **Findings JSON only.** The LLM never sees raw SQL or raw log lines — it sees a structured `ObservabilityFinding` envelope produced by Rust query helpers (`obs::query::*`). | Constitution C7 + safer prompt surface. |
| Trace sampling? | **100 % for chat turns**, **100 % for errors**, **10 % for periodic background tasks** (embed-queue tick, decay sweep). User-tunable in Settings → Observability → Sampling. | Chat is rare and high-value; background ticks are noisy. |
| When the user is offline / Ollama down — do we still emit traces? | **Yes.** Observability stack runs entirely in-process and never depends on a provider. | Constitution C1. |
| How do we instrument the frontend (Vue)? | **`tauriEvent('obs:span', payload)` from Vue → Rust ingester.** A small TS helper `src/utils/obs.ts` wraps `withSpan(name, fn)`. | Reuses existing event bus; no new IPC layer. |
| Where does the LLM-analyzer prompt live? | **`src-tauri/src/observability/analyzer.rs`** — single const `ANALYZER_SYSTEM_PROMPT`, registered as a tool in the `TOOL_REGISTRY` from `CHAT-HARNESS-3`. | Co-locate with the harness scope subsystem. |
| Retention defaults? | **Logs 7 days, metric samples 24 h, metric aggregates 30 days, traces last 10 000 or 100 MB whichever first.** All exposed in Settings. | C5. |

---

## 4. Plan — Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────────────────┐
│                       OBSERVABILITY STACK                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ Producers ──────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  Rust  : tracing macros + #[obs::span] proc-macro            │  │
│  │  Vue   : src/utils/obs.ts → withSpan(...) → tauriEvent      │  │
│  │  MCP   : router middleware emits span per tools/call         │  │
│  │                                                              │  │
│  └────────────────────────┬─────────────────────────────────────┘  │
│                           │                                        │
│  ┌─ Ingester (Rust, in-process) ────▼────────────────────────────┐ │
│  │  src-tauri/src/observability/                                  │ │
│  │    sink.rs      — tracing::Layer + Vue event listener         │ │
│  │    schema.rs    — Span, LogRecord, Metric types               │ │
│  │    sqlite.rs    — async writer task, bounded mpsc(8192)       │ │
│  │    aggregator.rs— 60 s rollup task                            │ │
│  │    retention.rs — daily prune task                            │ │
│  └────────────────────────┬─────────────────────────────────────┘  │
│                           │                                        │
│  ┌─ Store ─────────────────▼──────────────────────────────────────┐│
│  │  <app-data>/observability/obs.sqlite (WAL, FTS5)               ││
│  │    tables: spans, logs, metrics_samples, metrics_aggregates    ││
│  │    indices: (trace_id), (start_ns DESC), (name, start_ns)      ││
│  └────────────────────────┬─────────────────────────────────────┘  │
│                           │                                        │
│  ┌─ Query API ─────────────▼──────────────────────────────────────┐│
│  │  src-tauri/src/observability/query.rs                          ││
│  │    obs_recent_turns(limit) → Vec<TurnSummary>                  ││
│  │    obs_trace(trace_id) → TraceTree                             ││
│  │    obs_logs(filter) → Vec<LogRecord>                           ││
│  │    obs_metrics(name, range) → Vec<MetricPoint>                 ││
│  │    obs_search_fts(query) → Vec<LogRecord>                      ││
│  └─────┬─────────────────────┬─────────────────────────┬────────┘  │
│        │ Tauri cmd           │ MCP tool                │ analyzer  │
│  ┌─────▼──────┐      ┌──────▼─────────┐      ┌────────▼────────┐  │
│  │ Vue UI     │      │ MCP: obs_*     │      │ AI Analyzer     │  │
│  │ Observabi- │      │ obs_query      │      │ analyze_observ- │  │
│  │ lityView.vue      │ obs_trace      │      │ ability(topic)  │  │
│  │ + 4 sub-  │      │ obs_logs       │      │ → Finding[]      │  │
│  │ panels    │      │ obs_metrics    │      │ (LLM-rendered)  │  │
│  └────────────┘      └────────────────┘      └─────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### Tech choices

| Layer | Choice | Why (and what we rejected) |
|---|---|---|
| Tracing core | **`tracing` 0.1 + custom `tracing::Layer`** | Already in tree. Rejected `opentelemetry-rust` SDK as it pulls 15+ crates and an async runtime layer we don't need. |
| Storage | **SQLite via `rusqlite` (bundled)** | Already shipped, FTS5 already linked, single file. Rejected `duckdb` (extra dep), Parquet files (no FTS, harder to query). |
| Async writer | **`tokio::sync::mpsc(8192)`, single writer task** | Backpressure when storage is slow; bounded channel never panics. Rejected unbounded channel (OOM risk on burst). |
| Frontend store | **Pinia `observability.ts` store** | Mirrors existing `brain.ts`, `conversation.ts` pattern. |
| UI charts | **`uplot` (npm `uplot ~1.6`)** | 50 KB gzipped, no D3 dependency tree, lazy-loaded. Rejected `chart.js` (4× larger). |
| LLM analyzer | **Reuse the active brain provider** (Free / Paid / Local Ollama via `ProviderRotator`) with a dedicated `[ANALYZER]` system prompt | Constitution C1: no separate provider, no extra config. |
| Export | **`obs_export(range, format)` → `.jsonl.gz`** (and optional `.otlp.json` for OTel users) | Local-first; user-initiated export only. |

### File layout (new)

```
src-tauri/src/observability/
  mod.rs              # public re-exports + init_observability()
  schema.rs           # Span, LogRecord, MetricSample, Finding types
  sink.rs             # tracing::Layer impl + Vue event ingest
  sqlite.rs           # writer task, schema migration
  aggregator.rs       # 1-min/5-min/1-h rollup
  retention.rs        # daily prune task
  query.rs            # obs_recent_turns / obs_trace / obs_logs / obs_metrics
  analyzer.rs         # ANALYZER_SYSTEM_PROMPT + run_analyzer()
  commands.rs         # #[tauri::command] wrappers (8 commands)

src/views/ObservabilityView.vue        # main view (4 tabs)
src/components/observability/
  RecentTurnsPanel.vue                  # tab 1
  TraceTimelinePanel.vue                # tab 2
  MetricsPanel.vue                      # tab 3 (uPlot)
  LogTailPanel.vue                      # tab 4
  AnalyzerPanel.vue                     # shared inline analyzer drawer

src/stores/observability.ts             # Pinia store
src/utils/obs.ts                        # withSpan() helper for Vue

src-tauri/src/ai_integrations/mcp/tools.rs   # +5 MCP tools
docs/observability.md                   # THIS FILE
```

### Span vocabulary (canonical names)

Names are dot-separated lowercase. The MCP tools and the LLM analyzer
filter by these. Adding a new span name without listing it here is a lint
error (enforced by a small `cargo test` in `observability::schema::tests::known_names_exhaustive`).

| Span | Emitted by | Attributes |
|---|---|---|
| `chat.turn` | `commands/streaming.rs::run_chat_stream` | `mode`, `model`, `provider`, `input_tokens`, `output_tokens` |
| `intent.classify` | `brain/intent_classifier.rs` | `intent`, `confidence` |
| `rag.retrieve` | `commands/chat.rs::retrieve_prompt_memories` | `query_len`, `signals_used`, `top_k`, `kg_hops`, `rerank_used`, `entries_returned` |
| `rag.embed` | `brain/ollama_agent.rs::embed_text` | `provider`, `dim`, `cached` |
| `rag.rerank` | `memory/reranker.rs` | `pairs`, `judge_model` |
| `llm.stream` | `commands/streaming.rs::stream_*` | `provider`, `ttft_ms`, `tokens`, `finish_reason` |
| `tag.parse` | `commands/streaming.rs::StreamTagParser` | `tags_seen`, `tags_malformed` |
| `tool.dispatch` | `commands/streaming.rs::dispatch_tool` | `tool`, `args_hash`, `result_status` |
| `memory.crud` | `memory/store.rs` | `op` ∈ {add, update, delete, search}, `n`, `latency_ms` |
| `embed_queue.tick` | `memory/embedding_queue.rs` | `processed`, `failed`, `rate_limited` |
| `voice.tts` | `voice/*` | `engine`, `chars`, `audio_ms` |
| `voice.asr` | `voice/*` | `engine`, `audio_ms`, `text_len` |
| `mcp.tool_call` | `ai_integrations/mcp/router.rs` | `tool`, `caller`, `status` |
| `provider.failover` | `brain/provider_rotator.rs` | `from`, `to`, `reason` |

### LLM analyzer prompt (excerpt)

```
[ANALYZER] You are TerranSoul's observability analyst. Input: a JSON
findings envelope already filtered by the user's question. Output: a
≤300-token explanation in plain language that always cites at least one
span name and one concrete number (duration, count, or percentile) from
the envelope. If the envelope is empty or insufficient to answer,
respond with `INSUFFICIENT_DATA: <what additional span/metric would
answer it>` so the caller can refine.

Required output shape:
{
  "summary": "...",
  "evidence": [{ "span": "...", "value": "...", "trace_id": "..." }],
  "recommended_action": "..."  // or null
}
```

---

## 5. Tasks — Per-chunk Breakdown

Archived as the **OBSERVABILITY-1..8** chunks in
[`rules/completion-log.md`](../rules/completion-log.md). Each chunk was sized to
land in a single PR with tests. Order was mandatory — later chunks depend
on earlier ones.

| Chunk | Depends on | Goal |
|---|---|---|
| OBSERVABILITY-1 | – | Schema + ingester foundation (§4 file layout) |
| OBSERVABILITY-2 | -1 | Hot-path instrumentation (chat / RAG / LLM / tag-parse) |
| OBSERVABILITY-3 | -1 | Aggregator + retention background tasks |
| OBSERVABILITY-4 | -1, -2 | Tauri command API + Pinia store |
| OBSERVABILITY-5 | -4 | `ObservabilityView.vue` UI (4 tabs) |
| OBSERVABILITY-6 | -4 | LLM analyzer (`analyze_observability`) + tool-registry entry |
| OBSERVABILITY-7 | -4 | MCP tools (`obs_query`, `obs_trace`, `obs_logs`, `obs_metrics`, `obs_search`) |
| OBSERVABILITY-8 | -1..-7 | Privacy redaction + Settings panel + retention controls |

Detailed Goal text and the completed record for each chunk live in `rules/completion-log.md`.

---

## 6. Analyze — Cross-artifact Consistency Check

Items the reviewer should re-verify before chunk -1 starts coding:

- [ ] `tracing` Layer order: our layer goes **after** any subscriber
      that may add metadata (e.g., a `tracing-error::ErrorLayer`) but
      **before** the formatter. Verified in
      `src-tauri/src/lib.rs::init_tracing()` during -1.
- [ ] No span name collision with `crates/hive-relay`'s `tracing`
      output. Hive-relay logs to its own subscriber; we filter by
      target prefix `terransoul::` in the SQLite layer.
- [ ] The `chat.turn` span ID is the canonical `trace_id` for the user
      turn — every downstream span uses it as `trace_id`, not just
      `parent_span_id`. This is the C4 contract.
- [ ] The MCP `obs_*` tool surface honors the existing bearer-token
      auth on `:7421/:7423/:7422`; no new auth bypass.
- [ ] The analyzer system prompt counts against the active brain
      mode's token budget (Free 7K / Paid 16K / Local 12K) via the
      existing `context_budget::fit()` from
      [`docs/brain-advanced-design.md`](brain-advanced-design.md).
- [ ] Privacy redaction (C9) MUST happen at **ingest** time, not at
      query time — a bug in the UI must not be able to leak raw memory
      text from the database. The verbose-mode toggle controls what
      gets written, not what gets read.
- [ ] CHAT-HARNESS-3 (`TOOL_REGISTRY`) and OBSERVABILITY-6 share the
      registry surface — `analyze_observability` is registered there
      with the same `when_to_invoke` / `verification` shape as
      `<sing>` / `<lookup>` / `<listen>`.

---

## 7. Implement — Usage Quickstart

> Written ahead of implementation so the spec doubles as the future
> user-facing docs page. Each section will be exercise-tested by the
> integration tests in chunk -5.

### 7.1 For end users

1. **Open the observability view.** Settings → **Observability**, or
   press `Ctrl+Shift+O` (Windows/Linux) / `Cmd+Shift+O` (macOS).
2. **Recent Turns** (tab 1) — shows the last 100 chat turns ranked
   newest-first. Columns: time, latency (color-coded green
   <1.5 s / yellow <4 s / red ≥4 s), provider, model, # memories
   retrieved, # tools called, error flag. Click any row → tab 2.
3. **Trace Timeline** (tab 2) — Gantt-style timeline of all spans in the
   selected `trace_id`. Hover for attributes. Click "**Ask the AI**" →
   inline analyzer panel pops out with `analyze_observability` running
   on this trace. Wait <2 s for the explanation.
4. **Metrics** (tab 3) — uPlot line charts for `chat.turn.duration_ms
   p50/p95`, `rag.retrieve.duration_ms p50/p95`, `embed_queue.depth`,
   `memory.size_bytes`, `provider.failover.count`. Time range selector
   (1 h / 24 h / 7 d / 30 d).
5. **Logs** (tab 4) — full-text searchable log tail. Filter by level
   (warn/error only by default), span name, or substring. Same
   "**Ask the AI**" affordance.
6. **Tune retention.** Settings → Observability → Retention: logs N days,
   traces N items / N MB, sample rate % for background spans.
7. **Verbose mode.** Settings → Observability → Privacy → "Include
   memory text in logs (developer mode)". Off by default. Turning on
   only affects newly emitted logs; never retroactively un-redacts.
8. **Export.** Settings → Observability → Export → pick range / format
   (`jsonl.gz` or `otlp.json`) → save to disk. Use this to attach to
   bug reports.

### 7.2 For the in-app companion (LLM)

The user might say "why did you take so long just now?" — the companion's
system prompt registers `analyze_observability` as one of the tools
(alongside `<sing>` / `<lookup>` / `<listen>`). Call shape:

```
<observe>{"topic":"last chat turn latency","trace_id":"auto"}</observe>
```

`trace_id: "auto"` means "the most recent `chat.turn` from this session
that is not the in-progress one." The tool result is a
`ObservabilityFinding` JSON; the companion paraphrases the `summary`
and `recommended_action` into natural language. WHY+FIX errors from
CHAT-HARNESS-5 apply if the LLM emits malformed JSON.

### 7.3 For developers

```bash
# Set log level + enable file sink (already default to console + sqlite)
$Env:RUST_LOG = "terransoul=debug,info"

# Find slow chat turns from the last hour
sqlite3 "$Env:APPDATA\TerranSoul\observability\obs.sqlite" \
  "SELECT trace_id, attrs->>'$.provider', (end_ns-start_ns)/1e6 AS ms
   FROM spans WHERE name='chat.turn'
     AND start_ns > strftime('%s','now','-1 hour')*1e9
   ORDER BY ms DESC LIMIT 20;"

# Or, from another agent shell: call MCP
curl -s -H "Authorization: Bearer $Env:TERRANSOUL_MCP_TOKEN" \
  -X POST http://127.0.0.1:7423/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/call",
       "params":{"name":"obs_query","arguments":{
         "topic":"slow chat turns","range":"1h"}}}'
```

### 7.4 For AI coding agents (Copilot / Claude / Codex)

The MCP surface adds five tools (full schemas in
`src-tauri/src/ai_integrations/mcp/tools.rs`):

| MCP tool | Use when |
|---|---|
| `obs_query` | High-level: "why was the last chat turn slow?" — returns Findings |
| `obs_trace` | Drill into a specific `trace_id` |
| `obs_logs` | Filter logs by level / span / substring |
| `obs_metrics` | Time-series for a known metric name |
| `obs_search` | FTS5 search over log bodies |

These are gated by the same bearer token as the existing brain MCP
tools. Use them before broad grep — they are usually faster and more
precise than searching the source tree for a symptom.

---

## See also

- [`rules/completion-log.md`](../rules/completion-log.md) `OBSERVABILITY-1..8` — per-chunk completed record
- [`docs/brain-advanced-design.md`](brain-advanced-design.md) — brain architecture this observes
- [`rules/harness-reasoning-engineering.md`](../rules/harness-reasoning-engineering.md) — the build-tools-not-hardcoded-decisions rule
- [`crates/hive-relay/docs/architecture.md`](../crates/hive-relay/docs/architecture.md) — relay's own tracing config (out of scope here)
- [GitHub Spec Kit](https://github.com/github/spec-kit) — methodology credit
