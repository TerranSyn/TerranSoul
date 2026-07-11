# jd-validate-1m-typo-v2-off — provenance (typo-OFF control arm)

- Date: 2026-07-11. Same shim/build/config as `../jd-validate-1m-typo-v2/` (see its
  PROVENANCE.md), but WITHOUT `--resume` and WITHOUT the bench-local typo override
  row: fresh store, fresh 1M ingest (298.1 s, 3,355 rows/s), production seed applied
  (`LONGMEM_APPLY_SEED=1` ⇒ `query.deadline_ms=5000` live, `query.typo.enabled=false`
  as currently parked). This is the post-fix floor-control arm.
- Warm p50 969–1235 ms end-to-end is NOT ms-class: in-store warm searches are
  SEARCH_CACHE hits (`rag_cache_hit` 20/20 warm calls, mean 1.23 ms;
  `hybrid_search_rrf` warm p50 1.02 ms) — the delta is the per-query
  `from_brain_seed` settings scan (~910 ms measured standalone on this store), an
  ADAPT-3-era cost that runs before the cache check and is unrelated to fix
  `7af48656`. Equal-or-better than the last recorded 1M run (canonical
  `benchmark/results/jd-million/report.md`, 2026-07-09: p50 1288–1304 ms).
