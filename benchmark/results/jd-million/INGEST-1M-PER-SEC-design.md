# INGEST-1M-PER-SEC — make the JD "learn" ≈1 s (durable), full search in ~10–15 s

Grounded design from the `jd-ingest-1m-per-sec` analysis workflow (2026-07-05), against
`internal module`, `internal module`, `internal module`, `internal module` and
the `longmemeval_ipc` shim. AGI-pure: changes **when/where the FTS index is built, never
what is stored**; all CRUD via the gateway; tunables brain-seeded (`an internal config key`,
`EngineConfig::from_brain_seed`), no bench-only id-prefix gates. Never-regress floors
(en NDCG@10 ≥ 93.4 / retrieval quality) must be re-measured before shipping Step 4.

## Where the 669/s goes
Not insert/embed/fsync-bound. It is **synchronous FTS5 tokenization via AFTER-INSERT
triggers on one connection/one core**: `memories_fts_ai` (`internal module:1212`) + the V62
`memories_fts_cjk_ai` mirror (`internal module:1240`), whose `WHEN … GLOB '*[…CJK…]*'` guard is
a leading-`*` full-string scan on content+tags for all 1M rows, and whose trigram
tokenizer emits ~one posting per CJK character (~31% of the corpus). Plus `strip_secrets`
(`internal module:2405`) ride-along. Single connection ⇒ single core. The 2,285→388 rows/s decay
(`report.md:53-70`) is the FTS b-tree spilling past the 16 MiB page cache. FTS-free
sharded append on the same box = 1.42–2.65 M docs/s (STORAGE-FJALL-5).

## Verdict
- **~1M immediately-fully-searchable/s: NO** (physical wall — one tokenizer, one b-tree,
  250M+ token events; FTS5 writes low-single-digit-M tokens/s/core).
- **~1–2 s durable "learned" (persistent, crash-safe, read-your-writes by id): YES**
  (~500k–1M/s) via the sharded engine with FTS deferred.
- **Fully searchable: eventually consistent, ~10–15 s for 1M (~70–100k/s)** via parallel
  per-shard rebuild + sharded search.

## Ranked plan
1. **Route `learn` through `ShardedWriteEngine`, FTS deferred (biggest lever, near-trivial
   wiring).** Swap `add_many_bench→self.conn` for `enable_sharded_writes_from_brain()` +
   `add_many_buffered` (`internal module:1964`) → `put_batch` (the `internal module:1482`
   seam, "not wired yet"). `defer_fts=true` (`:783`) drops FTS triggers + secondary
   indexes generically via `defer_search_indexes` (`:1093`, discovered from
   `sqlite_master`, no hardcoded names). Per-shard apply = lock-free CAS ring push +
   memcpy + one group-commit fsync per 8,192-op batch. `flush_write_engine` (`internal module:1862`)
   blocks to `committed_lsn` — that fsync is the honest "learned" ack. Crash-safe via
   `replay_oplog` (`:1647`). → ~500k–1M/s durable, 1M in ~1–2 s.
2. **Parallelize the per-shard FTS rebuild.** `reconcile_indexes` (`:1611`) loops shards
   serially; fan across a thread pool (each shard is an independent `.db`), each worker
   running set-based `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`
   (`reconcile_search_indexes`, `:1121`). Each shard becomes queryable when its own rebuild
   returns (progressive). → ~70–100k rows/s effective, 1M searchable in ~10–15 s.
3. **Cheapen the CJK guard at the source.** Replace the per-row full-string `GLOB` WHEN-
   guard with a precomputed has-CJK flag set once in Rust (`memory/internal module::is_cjk_char`);
   the deferred CJK-mirror populate MUST be a *filtered* `INSERT … SELECT … WHERE <has-cjk>`
   (a bare `VALUES('rebuild')` ignores the WHEN guard and would trigram-index all 1M rows).
4. **Shard the SEARCH path (the real ceiling remover).** Today `hybrid_search_rrf →
   search_candidates` (`internal module:3602`) reads only `self.conn`, and `materialize_engine_writes`
   (`:2011`) re-collapses shards through one FTS file (re-introducing the single-writer wall).
   Scatter-gather across per-shard FTS (proven in the `deferred_fts_reconcile` test,
   `internal module:3428`) + fuse with `merge_shard_rankings` (`internal module:137`,
   RRF k=60). **Ranking risk:** BM25 IDF becomes per-shard — cross-shard RRF must hold the
   JD retrieval-quality never-regress floor; MEASURE before shipping.
5. **Readiness signal + backlog metric.** Expose `indexed_lsn / committed_lsn` as
   "indexing NN%" + a bounded O(tail) brute-force scan of not-yet-reconciled rows, so
   lexical search between ack and reconcile is correct-but-growing-recall, never silently
   wrong; add a lag metric (the ring backpressures, the FTS backlog does not).

**Alternative (single-connection, immediately-searchable, no eventual consistency):** a
bulk-load session extending `drop_fts5_for_bench` (`internal module:3469`) — 2 GiB cache, full-file
mmap, `wal_autocheckpoint=0`, `automerge=0`, filtered CJK rebuild, restore
`production_pragmas` on `finish()`. ~2k–10k/s (24.9 min → ~2–8 min), a real 3–15×, firmly
10³–10⁴ class (not 10⁶). Ship this if the eventual-consistency window is unacceptable.

## Honest reporting
JD-DEMO-COMPARISON.md must separate **durable-append learn (~1–2 s, ~1M/s)** from
**fully-FTS-searchable (~10–15 s, ~70–100k/s)** — never claim "instantly searchable at
1M/s." Publish the ~1–2 s number only once measured; 669/s remains the current measured
fully-searchable figure until Steps 1–2 land.
