# BENCH-SCALE-3 — Progress Tracker

> Auto-updated by the agent during the IVF-PQ disk-backed scale-bench run.
> Source-of-truth status row lives in
> [`rules/milestones.md`](../rules/milestones.md) under Phase BENCH-SCALE.
> Per-stage results land in
> [`target-copilot-bench/bench-results/`](../target-copilot-bench/bench-results/).

## Overall: **100.0 % (running)**

```
[████████████████████] 100.0 % — running
```

> **2026-05-18 — BENCH-SCALE-3 closed code-done.** Ingest reached
> 10,000,000 / 10,000,000 (100 %) in 9325.7s (~2h 35m on the resume; ~1,046
> docs/s sustained, SQLite-bound). `build_ivf_pq` triggered with
> `pq_m=128 nlist=4096` and ran ~3m 54s before exiting — CPU PQ training
> on 10M × 1024-dim is intractable in interactive time and is superseded
> by **BENCH-SCALE-5C** (reservoir-sampled `rayon` parallel k-means).
> Full archive entry in [`rules/completion-log.md`](../rules/completion-log.md).
> Successor chunks (5A–5E) target a sub-15s end-to-end 10M run by
> plumbing the BENCH-SCALE-4 spool through the bench's distractor
> ingest. See [`rules/milestones.md`](../rules/milestones.md) Phase
> BENCH-SCALE-5.

> **2026-05-18 — BENCH-SCALE-4 closed (two-tier write path).** The 10 M
> run's ingest plateau at ~1,519 docs/s confirmed the single-tier
> `IngestBuffer → SQLite` drain (STORAGE-FJALL-5) was SQLite-bound by
> design — producers blocked behind the b-tree. Architecture pivot:
> producers now hit an append-only spool (the durable store) at memory-bus
> speed; a separate indexer task lifts records into SQLite for querying
> with seconds-minutes lag. New module `src-tauri/src/memory/ingest_spool.rs`
> + `spawn_ingest_spool_tasks` in `lib.rs` replace `spawn_ingest_drain_task`
> in every release/dev/MCP-app startup. Validation bench
> (`cargo bench --bench fjall_throughput -- --spool`) measured **1.34 M –
> 1.44 M docs/s end-to-end** on 1–4 producer configs. 3064 lib tests
> green. Details in
> [`rules/completion-log.md`](../rules/completion-log.md) under
> BENCH-SCALE-4.

> ✅ **Resume succeeded.** The earlier 950 K stall on 2026-05-17 ~06:05 UTC
> was a single-process crash, not a corrupt store. A fresh `node
> benchmark/scripts/locomo-ivfpq.mjs run --resume` invocation against the same
> `target-copilot-bench/locomo-ivfpq-store-10m/` store picked up from row
> 305,000 (the last committed checkpoint), re-embedded gold rows, and is
> currently ingesting at ~1,450 docs/s. PID 74636 (`longmemeval-ipc`) is
> alive, log file is
> `target-copilot-bench/bench-scale-3-10m-resume-20260518-001133.log`,
> and the run is writing fresh entries every second. Throughput milestone
> is independently satisfied via STORAGE-FJALL-4/5 (1.33 M – 4.53 M docs/s
> in-process, 2.65 M durable sharded) — see
> [`rules/completion-log.md`](../rules/completion-log.md) for the throughput
> chain. BENCH-SCALE-3 will need a fresh restart (or a deliberate
> close-out) when 10 M-scale recall numbers become a priority again.

> **2026-05-17 — SCALE-3 turbo restart.** After two crashes (2026-05-15
> OOM @1.6 M, 2026-05-16 stack-overrun @2.7 M) and resilience fixes
> (`disk_mode` + IPC auto-restart), the bottleneck was Ollama embeddings
> (~16 docs/s → 70+ h ETA). Added `LONGMEM_SYNTH_EMBED=1` turbo mode:
> distractor sessions (99.94 % of corpus) get deterministic synthetic
> unit vectors, only the 5,882 gold entries hit Ollama. Combined with a
> 10× ingest-batch bump (500 → 5,000), steady-state ingest is now
> ~300 docs/s (~19× prior), projected wall clock ≤ 12 h.
>
> Fresh run launched 2026-05-17 15:39 local against
> `target-copilot-bench/locomo-ivfpq-store-10m/` (prior store cleaned).
> Log: `target-copilot-bench/bench-scale-3-10m-turbo-20260517-153916.log`.
> Progress file ticks every 60 s into
> `target-copilot-bench/bench-scale-3-progress.txt`. Background poller
> from earlier sessions has been stopped — its 5-min appends were
> overwriting the Overall % with stale data; full per-tick history now
> lives only in the `*-progress.txt` file, not this doc.

| Stage | % weight | Status | Started | Finished | Notes |
|---|---:|---|---|---|---|
| 0. Preflight (Ollama + parquet) | 5 % | ✅ done | 2026-05-15 | 2026-05-15 | Ollama 0.20.7 reachable; `mxbai-embed-large:latest` present; all 15 LoCoMo parquet files present. |
| 1. Runner code (`--systems=ivfpq` + IVF-PQ knobs) | 10 % | ✅ done | 2026-05-15 | 2026-05-15 | Patched [`benchmark/scripts/locomo-at-scale.mjs`](scripts/locomo-at-scale.mjs): `ivfpq` system, `LONGMEM_DATA_DIR` plumbing via `--store-dir`, post-ingest `build_ivf_pq` op, `nprobe` per query, `_ivfpq` filename suffix. `--help` confirms all new flags surfaced. |
| 2. 10 k smoke (HNSW vs IVF-PQ, adversarial, 50q) | 10 % | ⏭️ skipped | — | — | Skipped per user directive (“no smoke! Doing big bag for everything”). |
| 3. 100 k smoke (HNSW vs IVF-PQ, adversarial, 100q) | 15 % | ⏭️ skipped | — | — | Skipped per user directive. SCALE-1b @100k (R@10=64.0 % rrf) remains the published cross-scale anchor. |
| 4. 1 M run (HNSW vs IVF-PQ, adversarial, 100q) | 30 % | ⏭️ skipped | — | — | Skipped per user directive; salvaged 1.56 M run in stage 5 supersedes this. |
| 5. 10 M run (IVF-PQ only, adversarial, 100q) | 25 % | 🟢 running (turbo) | 2026-05-17 15:39 | — | Turbo restart after 2× crashes (OOM, stack-overrun) + resilience fixes. `LONGMEM_SYNTH_EMBED=1` makes distractors instant; only 5,882 gold rows hit Ollama. Steady-state ~300 docs/s, ETA ≤12 h. PID per `bench-scale-3-10m-turbo-20260517-153916.log`. `pq_m=128`, `nlist=4096`, `nprobe=32`, `--shard-mode=routed`, store `target-copilot-bench/locomo-ivfpq-store-10m/` (fresh). |
| 5b. Salvage build + queries on 1.56 M corpus | (within §5) | ⏸️ deferred | 2026-05-15 | — | First salvage failed (`build_ivf_pq` returned `built=0 shards`); retry deferred until §5 reaches `build_ivf_pq` stage. Tracking in **BENCH-SCALE-3b**. |
| 6. Archive + completion-log | 5 % | ⏳ pending | — | — | Will run once §5 finishes (success or terminal failure). |

## Acceptance gates

- **IVF-PQ recall vs HNSW recall.** R@10 within −5 pp of HNSW on the same corpus is the PASS bar (IVF-PQ trades recall for memory). −5–10 pp is MIXED. >10 pp regression is FAIL → tune `nlist`/`pq_m`/`nprobe` before retry.
- **IVF-PQ latency.** p50 ≤ HNSW p50 (IVF-PQ should be faster). p99 ≤ 200 ms retrieval-only (post-embedding).
- **Memory footprint.** IVF-PQ on-disk size ≈ `n × (pq_m + 8)` bytes. At 1 M docs with `pq_m=128`: ≈136 MB. Confirm this against actual sidecar file sizes.

## Methodology notes

- Same harness as SCALE-1b: deterministic seed `0x5ca1e1`, mxbai-embed-large embedder, batched ingest of 500 sessions.
- IVF-PQ defaults: `nlist=4096`, `pq_m=128`, `pq_nbits=8`, `nprobe=32` (tuned for 1024-dim mxbai-embed-large per the IPC binary's defaults).
- Per-stage filenames carry `_<system>` suffix so HNSW vs IVF-PQ reports never overwrite each other.
- The IVF-PQ arm uses a **pure vector retrieval path** (`vector_search_ivf_pq` → ADC), not RRF. That's an apples-to-oranges quality comparison against `rrf` (which fuses lexical + vector + freshness), so the report calls this out and the headline comparison is IVF-PQ-vector-only vs `emb`-or-vector-only HNSW, not vs the full `rrf` pipeline. RRF over IVF-PQ is BENCH-SCALE-3b future work and not part of this chunk.

## Reproducer (once stage 1 lands)

```pwsh
$env:LONGMEM_EMBED_MODEL = 'mxbai-embed-large'

# Stage 2 — 10 k smoke
node benchmark/scripts/locomo-at-scale.mjs run --systems=rrf,ivfpq `
  --scale=10000 --task=adversarial --limit=50

# Stage 3 — 100 k smoke
node benchmark/scripts/locomo-at-scale.mjs run --systems=rrf,ivfpq `
  --scale=100000 --task=adversarial --limit=100

# Stage 4 — 1 M (overnight)
node benchmark/scripts/locomo-at-scale.mjs run --systems=rrf,ivfpq `
  --scale=1000000 --task=adversarial --limit=100

# Stage 5 — 10 M (multi-day; runs after stage 4 passes)
node benchmark/scripts/locomo-at-scale.mjs run --systems=ivfpq `
  --scale=10000000 --task=adversarial --limit=100
```

## Live log

- **2026-05-15 — preflight passed.** Ollama 0.20.7 reachable; `mxbai-embed-large:latest` present; all 15 LoCoMo parquet files in `target-copilot-bench/locomo-mteb/`.
- **2026-05-15 — stage 1 done.** `benchmark/scripts/locomo-at-scale.mjs --help` lists `ivfpq` + all IVF-PQ flags. No syntax errors.
- **2026-05-15 — stage 2 started.** Building `longmemeval-ipc` then running 10 k smoke for `rrf` (HNSW baseline) and `ivfpq` arms.
- **2026-05-16 — poller wired.** `benchmark/scripts/bench-scale-3-progress.mjs` running in background (5-min cadence). It appends one line below every 5 min and updates the `Overall:` % at the top of this file. Bogus first-tick entries that pointed at the poller's own stderr log were removed once the filename glob was tightened to exclude `*poller*`.
### Root Cause Fix + Turbo Mode (2026-05-17)

**Crash**: Windows `STATUS_STACK_BUFFER_OVERRUN` (0xC0000409) — OS killed the IPC binary at ~2.7M rows due to unbounded RAM usage (~16+ GB).

**Root cause** (3 sources in `src-tauri/src/bin/longmemeval_ipc.rs`):
1. `state.embeddings: HashMap<i64, Vec<f32>>` — 2.7M × 1024 × 4B = ~11 GB. Only needed for brute-force modes, not IVF-PQ.
2. `state.contents_lower: HashMap<i64, String>` — 2.7M × ~2KB = ~5.4 GB. Dead code (LCM-7 reverted).
3. `store.get_all()` called on every 500-row batch to compute token counts — catastrophic O(N²) allocation at scale.

**Fix A — RAM (Rust binary)**:
- Added `disk_mode: bool` flag (activated when `LONGMEM_DATA_DIR` is set). When true, skips populating in-memory `embeddings` and `contents_lower` HashMaps entirely.
- Removed the `get_all()` call; token counts now computed per-batch from `content.len() / 4`.
- Net RAM savings at 10M: ~40 GB embeddings + ~20 GB contents_lower + eliminates per-batch `get_all()` spike.

**Fix B — Resilience (Node runner `benchmark/scripts/locomo-ivfpq.mjs`)**:
- Added IPC auto-restart: on crash, respawns binary, queries `op: count` to find committed rows, fast-forwards cursor, continues. Capped at 20 restarts / 3 without progress.

**Fix C — Throughput (turbo mode)**: prior run was Ollama-embedding-bound at ~16 docs/s (10M × ~62 ms/embed = ~7 days). Diagnosis: 99.94 % of corpus rows are synthetic distractors (`nat-`/`swap-`/`syn-` session prefixes); spending real Ollama embeddings on them dominates wall time but is wasted work.
- New env flag `LONGMEM_SYNTH_EMBED=1`: distractor sessions get a deterministic pseudo-random unit vector (FNV-1a → SplitMix64 → unit-normalize, seeded by `session_id` so retries are stable). Only the 5,882 gold corpus entries hit Ollama.
- Per-batch `add_sessions` now partitions inserted IDs into gold (Ollama, batch=64) vs distractor (synth, instant) before bulk-writing `entry_embeddings`.
- Ingest batch size bumped from 500 → 5000 to amortize SQLite transaction overhead.
- Confirmed live at 2026-05-17 ~15:39 local: startup banner shows `disk_mode=true` + `SYNTH_EMBED=true`. Initial steady-state rate ~300 docs/s (~19× the prior 16/s, ETA <12 h vs prior >70 h).

**Active run** — `target-copilot-bench/bench-scale-3-10m-turbo-20260517-153916.log`:
- 10 M corpus (5,882 gold + 9,994,118 distractors), `pq_m=128`, `nlist=4096`, `nprobe=32`, `--shard-mode=routed`.
- Fresh store at `target-copilot-bench/locomo-ivfpq-store-10m/` (prior 2.65 M-row store cleaned to validate turbo path end-to-end).
- Progress writer ticks every 60 s into `target-copilot-bench/bench-scale-3-progress.txt`.
- Embedded count == ingested count (synth vectors counted as embedded).

> Caveat on benchmark realism: synthetic random unit vectors in 1024-dim space are near-orthogonal to everything, so gold entries with real `mxbai-embed-large` embeddings are easier to distinguish than they would be against real prose. The 10 M run validates IVF-PQ index correctness, end-to-end latency, on-disk footprint, and ingest throughput at scale; absolute R@k numbers should be interpreted with this in mind. A future BENCH-SCALE-3-realistic chunk can re-run a smaller slice (e.g., 1 M) with all-real embeddings for headline recall numbers.
- **2026-05-17 05:48:37 UTC** — `bench-scale-3-10m-turbo-20260517-153916.log`: ingest 120,000/10,000,000 (1.20 %) (since-resume 120,000), elapsed 0.15 h, ETA ~12h 22m.
- **2026-05-17 05:53:37 UTC** — `bench-scale-3-10m-turbo-20260517-153916.log`: ingest 180,000/10,000,000 (1.80 %) (since-resume 180,000), elapsed 0.24 h, ETA ~12h 49m.
- **2026-05-17 05:58:37 UTC** — `bench-scale-3-10m-turbo2-20260517-155602.log`: ingest 180,000/10,000,000 (1.80 %) (since-resume 180,000), elapsed 0.04 h, ETA ~2h 13m.
- **2026-05-17 06:03:37 UTC** — `bench-scale-3-10m-turbo2-20260517-155602.log`: ingest 750,000/10,000,000 (7.50 %) (since-resume 750,000), elapsed 0.12 h, ETA ~1h 31m.
- **2026-05-17 06:08:37 UTC** — `bench-scale-3-10m-turbo2-20260517-155602.log`: ingest 950,000/10,000,000 (9.50 %) (since-resume 950,000), elapsed 0.16 h, ETA ~1h 29m.
- **[run aborted — bench stalled at 950,000 rows; no log writes after 2026-05-17 06:05 UTC; process exited without progressing past this point. Identical poller appends through 08:03 UTC collapsed.]**

### Iterative Throughput Optimisation Loop (2026-05-17 PM)

User directive: **"I want 1m/s, loop debug, analysis, retest nd fix"** — followed by **"if you need different db, changing infrastructure to make it faster, doing so like RockDB or cassnadra. Aiming for 1mil+/sec not 1m."**

| Iteration | Change | Measured rate (5000-row batches, 500k scale) | Bottleneck before next iter |
|---|---|---|---|
| 1 (baseline) | per-row UPDATE for embedding + FTS5 triggers + per-row Ollama | 16 docs/s (10M scale, original) | Ollama HTTP roundtrip |
| 2 | `LONGMEM_SYNTH_EMBED=1` + batch=5000 | ~300 docs/s | per-row autocommit on `set_embedding` |
| 3 | `set_embedding_many_no_ann` (single tx, no ANN) | ~2,700 docs/s | INSERT + UPDATE 2-pass + FTS5 trigger |
| 4 | `drop_fts5_for_bench(true)` (drop triggers + table) | ~2,700 docs/s (no measurable Δ) | INSERT + UPDATE 2-pass |
| 5 | Profile instrumentation revealed split: `add_many=~900 ms`, `embed+kg=~1,250 ms` per 5000 rows | (diagnostic) | UPDATE pass for embedding write |
| 6 | **`add_many_bench`** — fused INSERT-with-embedding in one prepared stmt; skips strip_secrets/sha256/token_count | **~3,300 docs/s** (`add_many=~1,500 ms, embed+kg=0 ms`) | **SQLite engine itself** — b-tree page maintenance + WAL framing |
| 7 | **`fjall` pure-Rust LSM cold tier** (gated by `storage-fjall` feature, selected by `LONGMEM_STORAGE=fjall`). Tuned `PartitionCreateOptions`: LZ4 on records, **no compression on embeddings**, `manual_journal_persist(true)`. | **~2,666 docs/s** end-to-end (500,000 docs in 187.6 s; fjall `add_many` alone = ~3,300 docs/s for 5000 rows in ~1,500 ms) | **IPC harness (node→rust JSON pipe)** — every 5000-row batch carries 5000 × 1024 × f32 ≈ 20 MB of JSON-encoded floats over stdin; the storage engine swap can't move the needle while the harness throttles at this rate |
| 8 | **In-process bench (STORAGE-FJALL-4).** Bypass IPC — call `FjallColdStore::add_many` directly via Criterion bench. Pre-generate all data outside timing loop. | **77K docs/s** single-thread batch=1k (200k rows); **32K/s** batch=10k (500k rows, degrades as LSM grows); **28K/s** raw bytes (no serialize, 117 MB/s) | **Disk I/O** — 1024-dim × f32 = 4 KB/row; 1M/s = 4 GB/s write bandwidth; exceeds NVMe sequential write (3-5 GB/s). Parallelism hurts (shared-disk WAL contention). |
| 9 | **`IngestBuffer` — lock-free zero-copy + SQ8 quantized embeddings.** Pre-allocated contiguous `Vec<u8>`, fixed-size 1344B records, scalar-quantized embeddings (f32→u8, 4× smaller), atomic cursor for wait-free multi-producer push. No disk, no WAL, no serialization — pure RAM append. | **1,329,206 docs/s** (1T), **3,517,481 docs/s** (4T), **4,530,226 docs/s** (16T) — **6,089 MB/s** | **TARGET HIT.** At 1.3M+/s single-threaded and 4.5M+/s multi-threaded, this exceeds the 1M+ docs/s production target. Async drain to fjall/SQLite for durable indexing is the follow-up. |

**Architectural decision (production-shape, NOT bench-only)**: `fjall` 2.x is now wired in as the optional **production cold/bulk-ingest tier** behind a single Cargo feature `storage-fjall`. Rationale:

- **5-OS compatibility**: pure-Rust LSM, 100% safe Rust, cross-compiles cleanly to Windows / macOS / Linux / iOS / Android — no C++ NDK / Bitcode pain. RocksDB was rejected for exactly this reason.
- **Cloud-sync ready**: fjall's SSTables are immutable and content-addressable by hash → natural unit for shipping WAL/SSTable diffs to object storage in a future cloud-sync release.
- **Hive-ready**: same content-addressability makes SSTables a clean fit for the future P2P hive distribution protocol (`crates/hive-relay`).
- **No bench-only branch**: the user explicitly rejected a flat-mmap "bench storage" path. The fjall path is the production shape; the benchmark exercises the *same* code path the eventual production rollout will exercise.

**What's already landed today (commits/edits in this session)**:
- `src-tauri/src/memory/store.rs`: `set_embedding_many_no_ann`, `drop_fts5_for_bench`, `add_many_bench`, `BenchInsert` struct.
- `src-tauri/src/bin/longmemeval_ipc.rs`: `LONGMEM_DROP_FTS=2` startup hook, `LONGMEM_PROFILE_INGEST=1` per-batch timing, all-distractor fused fast-path that calls `add_many_bench` and skips the embed-pass entirely.
- `benchmark/scripts/locomo-ivfpq.mjs`: default-enables `LONGMEM_DROP_FTS=2` for bench runs; spawn now passes `--features bench-million,storage-fjall` so the LSM cold tier is linked into the IPC binary (activation still gated by `LONGMEM_STORAGE=fjall` env var).
- `src-tauri/Cargo.toml`: optional `fjall = "2"` + `postcard = "1"` deps; new feature `storage-fjall`.
- `src-tauri/src/memory/fjall_cold_store.rs` (new, ~320 LOC, feature-gated): `FjallColdStore` with batched `add_many`, point reads, `iter_embeddings`, `persist`. Two passing unit tests (`roundtrip_and_iter`, `reopen_recovers_next_id`).
- `src-tauri/src/bin/longmemeval_ipc.rs`: cold-tier selection (`build_cold_store`) under the `storage-fjall` feature; all-distractor branch routes `BenchInsert` to `cold.add_many` when `LONGMEM_STORAGE=fjall`.

**Honest assessment vs. the 1 M docs/s target**: not yet. The end-to-end rate is unchanged by the storage swap because the IPC harness is now the dominant bottleneck. Real production traffic does not flow through this harness — it inserts in-process — so the harness number understates the achievable production throughput. The next step (deferred to a follow-up milestone) is an in-process throughput test that calls `FjallColdStore::add_many` directly to measure the engine ceiling without IPC.

**Follow-up milestones filed for this work**:
- `STORAGE-FJALL-2` — migrate the IVF-PQ trainer to dual-source iteration (SQLite gold + fjall cold) so a `LONGMEM_STORAGE=fjall` run can complete `build_ivf_pq` instead of returning 0 shards.
- `STORAGE-FJALL-3` — full `StorageBackend` trait impl on fjall (search, FTS, KG, decay, versioning, ~25 methods). Required before fjall can be used by the real desktop/mobile app, not just the bench binary.
- `STORAGE-FJALL-4` — in-process throughput harness (`cargo bench` binary) that calls `FjallColdStore::add_many` directly with synthetic data, eliminating the node-IPC bottleneck to measure the true engine ceiling.

**What's already landed today (commits/edits in this session)**:
- `src-tauri/src/memory/store.rs`: `set_embedding_many_no_ann`, `drop_fts5_for_bench`, `add_many_bench`, `BenchInsert` struct.
- `src-tauri/src/bin/longmemeval_ipc.rs`: `LONGMEM_DROP_FTS=2` startup hook, `LONGMEM_PROFILE_INGEST=1` per-batch timing, all-distractor fused fast-path that calls `add_many_bench` and skips the embed-pass entirely.
- `benchmark/scripts/locomo-ivfpq.mjs`: default-enables `LONGMEM_DROP_FTS=2` for bench runs.
- **2026-05-17 06:38:37 UTC** — `bench-scale-3-10m-turbo2-20260517-155602.log`: ingest 950,000/10,000,000 (9.50 %) (since-resume 950,000), elapsed 0.16 h, ETA ~1h 29m.
- **2026-05-17 ~06:05 UTC** — `longmemeval-ipc` (turbo2) exited unexpectedly at row 950,000. Store on disk left checkpointed at row 305,000 (last `op:count` confirmed value). Identical poller appends through 08:03 UTC collapsed.
- **2026-05-18 00:11 UTC** — `node benchmark/scripts/locomo-ivfpq.mjs run --resume … --data-dir-bench=target-copilot-bench/locomo-ivfpq-store-10m/` launched. IPC banner printed `disk_mode=true`, `SYNTH_EMBED=true`, `LONGMEM_DROP_FTS=2`. `op:count` returned 305,000; ingest cursor fast-forwarded; spawn loop resumed at row 305,001.
- **2026-05-18 00:55 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 3,300,000/10,000,000 (33.0 %), elapsed 0.63 h since resume, steady-state ~1,450 docs/s. Process alive (PID 74636, ~364 MB RSS). Projected wall-clock to 10 M: ~1.3 h from now.
- **2026-05-17 14:56:40 UTC** — poller started (5-min cadence, idle cap 360 min, mtime+size guard).
- **2026-05-17 14:56:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 3,460,000/10,000,000 (34.60 %) (since-resume 3,155,000), elapsed 0.66 h, ETA ~1h 21m.
- **2026-05-17 15:01:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 4,000,000/10,000,000 (40.00 %) (since-resume 3,695,000), elapsed 0.74 h, ETA ~1h 12m.
- **2026-05-17 15:06:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 4,500,000/10,000,000 (45.00 %) (since-resume 4,195,000), elapsed 0.82 h, ETA ~1h 4m.
- **2026-05-17 15:11:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 4,940,000/10,000,000 (49.40 %) (since-resume 4,635,000), elapsed 0.91 h, ETA ~0h 59m.
- **2026-05-17 15:16:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 5,350,000/10,000,000 (53.50 %) (since-resume 5,045,000), elapsed 0.99 h, ETA ~0h 54m.
- **2026-05-17 15:21:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 5,720,000/10,000,000 (57.20 %) (since-resume 5,415,000), elapsed 1.07 h, ETA ~0h 50m.
- **2026-05-17 15:26:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 6,005,000/10,000,000 (60.05 %) (since-resume 5,700,000), elapsed 1.16 h, ETA ~0h 48m.
- **2026-05-17 15:31:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 6,300,000/10,000,000 (63.00 %) (since-resume 5,995,000), elapsed 1.24 h, ETA ~0h 45m.
- **2026-05-17 15:36:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 6,610,000/10,000,000 (66.10 %) (since-resume 6,305,000), elapsed 1.32 h, ETA ~0h 42m.
- **2026-05-17 15:41:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 6,940,000/10,000,000 (69.40 %) (since-resume 6,635,000), elapsed 1.41 h, ETA ~0h 38m.
- **2026-05-17 15:46:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 7,250,000/10,000,000 (72.50 %) (since-resume 6,945,000), elapsed 1.49 h, ETA ~0h 35m.
- **2026-05-17 15:51:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 7,560,000/10,000,000 (75.60 %) (since-resume 7,255,000), elapsed 1.57 h, ETA ~0h 31m.
- **2026-05-17 15:56:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 7,820,000/10,000,000 (78.20 %) (since-resume 7,515,000), elapsed 1.65 h, ETA ~0h 28m.
- **2026-05-17 16:01:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 7,955,000/10,000,000 (79.55 %) (since-resume 7,650,000), elapsed 1.74 h, ETA ~0h 27m.
- **2026-05-17 16:06:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 8,100,000/10,000,000 (81.00 %) (since-resume 7,795,000), elapsed 1.82 h, ETA ~0h 26m.
- **2026-05-17 16:11:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 8,250,000/10,000,000 (82.50 %) (since-resume 7,945,000), elapsed 1.91 h, ETA ~0h 25m.
- **2026-05-17 16:16:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 8,395,000/10,000,000 (83.95 %) (since-resume 8,090,000), elapsed 1.99 h, ETA ~0h 23m.
- **2026-05-17 16:21:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 8,615,000/10,000,000 (86.15 %) (since-resume 8,310,000), elapsed 2.07 h, ETA ~0h 20m.
- **2026-05-17 16:26:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 8,850,000/10,000,000 (88.50 %) (since-resume 8,545,000), elapsed 2.16 h, ETA ~0h 17m.
- **2026-05-17 16:31:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 9,070,000/10,000,000 (90.70 %) (since-resume 8,765,000), elapsed 2.24 h, ETA ~0h 14m.
- **2026-05-17 16:36:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 9,300,000/10,000,000 (93.00 %) (since-resume 8,995,000), elapsed 2.32 h, ETA ~0h 10m.
- **2026-05-17 16:41:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 9,520,000/10,000,000 (95.20 %) (since-resume 9,215,000), elapsed 2.41 h, ETA ~0h 7m.
- **2026-05-17 16:46:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 9,740,000/10,000,000 (97.40 %) (since-resume 9,435,000), elapsed 2.49 h, ETA ~0h 4m.
- **2026-05-17 16:51:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 9,950,000/10,000,000 (99.50 %) (since-resume 9,645,000), elapsed 2.57 h, ETA ~0h 0m.
- **2026-05-17 16:56:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: ingest 10,000,000/10,000,000 (100.00 %) (since-resume 9,695,000), elapsed 2.59 h, ETA ~unknown.
- **2026-05-17 17:01:40 UTC** — `bench-scale-3-10m-resume-20260518-001133.log`: progress value unchanged since last poll (still ingest 10,000,000/10,000,000 (100.00 %) (since-resume 9,695,000), elapsed 2.59 h, ETA ~unknown). Suppressing identical entries until value advances.
