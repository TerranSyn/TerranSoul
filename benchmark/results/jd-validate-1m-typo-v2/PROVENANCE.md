# jd-validate-1m-typo-v2 — provenance (typo-ON arm)

- Date: 2026-07-11. Shim built from working tree at commit `8cef4e30` + uncommitted
  wire-phase edits (`metrics_snapshot` op in `internal module`,
  counter plumbing in `benchmark/scripts/jd-million-bench.mjs`). Includes fix
  commit `7af48656` (deadline threaded into keyword tier-3 + typo_dict_cache counters).
- Config: `--count 1000000 --seed 20260703 --systems rrf --top-k 100 --resume`,
  `LONGMEM_APPLY_SEED=1`, `LONGMEM_DATA_DIR=C:/TerranSoul/jd-validate-1m-typo-v2/store`,
  `internal module`. Same corpus
  generation as the 2026-07-09 failing run (gold 1441/1166/925/1441 — identical).
- **typo-ON mechanism**: the shipped seed keeps `query.typo.enabled=false` (parked;
  seed defaults were NOT flipped). Typo was enabled for THIS STORE ONLY via a
  bench-local `memories` row (`source_hash =
  'bench:jd-validate-1m-typo-v2-typo-on-override'`, importance 7 > the parked seed
  row's 6, same tags/category), inserted between the typo-OFF control run and this
  `--resume` run. Mechanism validated at 2k scale on the same shim: with the same
  override row, `typo_dict_cache` shows miss_cold=1 → rebuild=1, hits on repeat,
  expansions p50 4.1 ms, warm p50 1.09–1.52 ms.
- The store was fresh-ingested by the typo-OFF control run
  (`benchmark/results/jd-validate-1m-typo-v2-off/`, 1M rows @ 3,355 rows/s), then
  reused here via `--resume` (0 rows ingested; new shim process, so all in-process
  caches were cold at the query phase).
- Standalone measurement on this 1M store: the per-query
  `QueryDeadline::from_brain_seed` settings scan
  (`lower(tags) LIKE '%query-deadline%'` over 1,000,805 rows) costs ~910 ms and runs
  BEFORE the SEARCH_CACHE check on every `hybrid_search_rrf` call — it dominates the
  end-to-end warm latency in BOTH arms and predates fix `7af48656` (the pre-fix
  canonical `benchmark/results/jd-million/report.md` 2026-07-09 shows the same
  1.29 s-class p50).
