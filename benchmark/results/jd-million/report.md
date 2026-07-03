# MILLION-RESUME-BENCH Report

Date: 2026-07-03 (overnight run)
Corpus: 1,000,000 deterministic multilingual synthetic resumes, seed 20260703
Store: TerranSoul MemoryStore (SQLite + FTS5, production code path) via the `longmemeval-ipc` shim
Primary system: `rrf` (hybrid_search_rrf - lexical candidate pool + RRF fusion; dense channel OFF tonight, `LONGMEM_EMBED` unset)

## Headline

| Metric | Value |
|---|---|
| Ingest | 1,000,000 rows in 1,493.8 s - **669 rows/s overall** (per-slice 2,285 -> 388 rows/s as the FTS5 index grew) |
| Query latency (rrf, warm) | p50 2.6-3.3 ms per JD query over 1M rows |
| Query latency (rrf, cold first query) | 2.9-32.8 s (FTS5 OR-scan of a long JD query, then served by the search cache) |
| NDCG@10 (rrf) | en 93.4% / vi 45.4% / ja 9.5% |
| `search` mode at 1M | did NOT complete one query in 480 s (probe below) |

## Environment

| Variable | Value |
|---|---|
| LONGMEM_DATA_DIR | D:\Git\ts-jdbench-wt\target-copilot-bench\jdbench\store |
| LONGMEM_EMBED | (unset - dense channel OFF; `rrf` is lexical+freshness fusion only) |
| Other LONGMEM_* / LCM_CONV_AWARE | (unset) |
| node | v24.3.0 |
| platform | win32 x64 (single desktop machine, NVMe, corpus + store on D:) |
| shim build | cargo dev profile, target-copilot-bench (worktree branch feature/jd-million-bench, main merged at f1abe401) |

## Methodology

- Corpus (benchmark/scripts/jd-corpus.mjs): deterministic multilingual synthetic resumes
  (en 40%, vi/ja 15%, ko/zh 8%, es/fr 7%), 10 job areas, canonical skill IDs with
  Latin-script tech tokens in every language. Resume N is a pure function of (seed, N).
- Gold predicate per JD (exact, language-agnostic): `area equal AND >= 2 requiredSkills
  present AND years >= minYears`.
- 3 fixed JD queries (benchmark/scripts/jd-queries.mjs), one language each:
  `jd-en-backend` (en - Rust/PostgreSQL/Kubernetes/gRPC, >=5y),
  `jd-vi-data-engineering` (vi - Python/Spark/Airflow/SQL, >=3y),
  `jd-ja-mobile` (ja - Swift/Kotlin/React Native, >=3y).
- Ingest through the `add_sessions_jsonl` shim op (5K-row batches through the SAME
  `add_sessions` code path production ingest uses; corpus streamed Rust-side, no
  stdio JSON marshalling).
- Each JD query runs 5x per system at top-k 100; latency is p50/p95 over the 5 runs;
  accuracy from the LAST run. NOTE: `hybrid_search_rrf` has a process-lifetime search
  cache, so runs 2-5 measure the cached path (~3 ms) and p95 captures the cold first
  query. `hybrid` does not use that cache; its p50 is the true repeated-query cost.
- Recall@K reported two ways: **capped** = hits / min(K, |gold|) (how full the top-K is
  of gold) and **raw** = hits / |gold| (classic recall; bounded by K/|gold| at this gold
  density - for example raw R@100 <= 100/1441 = 6.9% for jd-en-backend).

## Ingest - 1,000,000 rows

Path: `add_sessions_jsonl` (JSONL streamed Rust-side, 5K-row batches)
Total: 1,000,000 rows in 1,493.8 s = **669 rows/s** overall.

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 100,000 | 2,285 | 2,285 | 43.8 |
| 200,000 | 1,536 | 1,837 | 108.9 |
| 300,000 | 890 | 1,356 | 221.3 |
| 400,000 | 727 | 1,115 | 358.9 |
| 500,000 | 723 | 1,005 | 497.3 |
| 600,000 | 624 | 912 | 657.6 |
| 700,000 | 645 | 861 | 812.6 |
| 800,000 | 542 | 802 | 997.1 |
| 900,000 | 419 | 728 | 1,235.9 |
| 1,000,000 | 388 | 669 | 1,493.8 |

The slice-rate decay (2,285 -> 388 rows/s) is FTS5 index maintenance cost growing with
index size; the SQLite file reached ~1.2 GB (plus WAL) for the 697 MB corpus.

Context vs the million-CRUD/s figures (measured on this same machine, 2026-05-17,
STORAGE-FJALL-5): the raw sharded ring-buffer append pipeline sustained 1.42-2.65M
docs/s durable in a bench-isolate. That is a DIFFERENT write path - no SQLite, no
FTS5 tokenization, no per-batch transactions, no contextualizer - measured to prove
the disk/ingest-buffer ceiling. Tonight's 669 rows/s is the full production
MemoryStore path (SQLite + FTS5 + batch transactions) end to end. The two numbers
are not equivalent and are both reported as measured.

## Query results at 1,000,000 rows

Gold sizes: jd-en-backend 1,441 / jd-vi-data-engineering 1,166 / jd-ja-mobile 925.

### system: rrf (iteration 1 - primary; identical when re-run in iteration 2)

| JD | Lang | Gold | R@10 capped (raw) | R@50 capped (raw) | R@100 capped (raw) | P@10 | NDCG@10 | p50 warm | cold 1st query |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 1,441 | 90.0% (0.62%) | 82.0% (2.85%) | 83.0% (5.76%) | 90.0% | 93.4% | 2.64 ms | 32.8 s |
| jd-vi-data-engineering | vi | 1,166 | 30.0% (0.26%) | 14.0% (0.60%) | 16.0% (1.37%) | 30.0% | 45.4% | 2.86 ms | 30.1 s |
| jd-ja-mobile | ja | 925 | 10.0% (0.11%) | 6.0% (0.32%) | 4.0% (0.43%) | 10.0% | 9.5% | 2.94 ms | 2.9 s |

### system: hybrid, keyword-only weights (iteration 2 - optimize attempt, same store)

`set_hybrid_weights [0, 1, 0, 0, 0, 0]` (vector, keyword, recency, importance, decay,
tier_priority) - isolates the weighted-lexical scorer over the same 1,000-candidate
pool, removing rrf's freshness/decay/confidence post-adjustments. No search cache, so
p50 here is the real repeated-query cost of this mode.

| JD | Lang | Gold | R@10 capped | R@100 capped | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| jd-en-backend | en | 1,441 | 80.0% | 58.0% | 80.0% | 85.7% | 18,532 ms | 18,709 ms |
| jd-vi-data-engineering | vi | 1,166 | 30.0% | 6.0% | 30.0% | 33.4% | 11,179 ms | 11,582 ms |
| jd-ja-mobile | ja | 925 | 10.0% | 4.0% | 10.0% | 9.5% | 930 ms | 1,115 ms |

## Per-language gold composition and hits (top-100, rrf)

Gold is language-agnostic (the predicate ignores language); hits are where the
retrieved gold actually lives.

| JD | Gold by language (corpus fact) | rrf gold hits by language |
|---|---|---|
| jd-en-backend | en 580, ja 228, vi 224, zh 110, ko 105, es 104, fr 90 | **en 83** (all hits en) |
| jd-vi-data-engineering | en 459, vi 177, ja 169, ko 95, fr 94, zh 85, es 87 | **vi 16** (all hits vi) |
| jd-ja-mobile | en 375, ja 151, vi 134, zh 77, ko 70, fr 68, es 50 | **ja 3, en 1** |

This table is the core accuracy finding: with the dense channel off, retrieval finds
gold almost exclusively in the query's own language. The ~30 query-language surface
words dominate the lexical candidate pool and ranking; only the 3-4 Latin-script
skill tokens are cross-lingual. jd-en-backend scores highest because 40% of the
corpus (and its largest gold slice) is English; jd-ja-mobile scores lowest because
unicode61 tokenization does not segment Japanese (kana/kanji runs fuse with adjacent
Latin tokens, so even the skill tokens often fail to match ja-language resumes).

## Optimize iteration log (bounded to one tuning iteration)

- Trigger: rrf NDCG@10 < 0.5 for jd-vi-data-engineering (45.4%) and jd-ja-mobile (9.5%).
- Mechanism used (existing only): the `set_hybrid_weights` op (MEMORY-CFG-AUDIT-5)
  with keyword-isolated weights `[0,1,0,0,0,0]`, evaluated as the `hybrid` system in a
  `--resume` query-phase re-run (store untouched; rrf re-run reproduced iteration-1
  numbers exactly, confirming determinism).
- Outcome: no improvement. hybrid(keyword-only) scored below rrf on en (85.7 vs 93.4
  NDCG@10) and vi (33.4 vs 45.4), equal on ja (9.5). The bottleneck is not the
  post-fusion adjustments - it is the language composition of the 1,000-candidate
  lexical pool itself. Re-weighting existing lexical signals cannot recover gold
  resumes written in other languages.
- Next lever (documented, not run tonight): `rrf_emb` - the dense channel
  (multilingual embeddings) is cross-lingual by construction, and `LONGMEM_EMBED=1`
  was the decisive factor in the 2026-07-02 RRF investigation. Embedding 1M rows is
  hours of compute on this machine, so it is scoped as the follow-up iteration.

## `search` mode at scale (single-query probe)

`MemoryStore::search` (shim mode `search`) is the app's unbounded keyword API: FTS5
OR-match over every query token with no LIMIT, full row materialization, lexical +
graph rerank of the entire match set, then one autocommit UPDATE
(last_accessed/access_count) per matched row.

| Store size | Protocol | Result |
|---:|---|---|
| 5,000 | 5 runs x 3 JDs (smoke) | 0.65-18.0 s per query (en 18.0 s, vi 7.7 s, ja 0.65 s p50) |
| 1,000,000 | ONE bounded query (jd-en-backend, benchmark/scripts/jd-search-probe.mjs) | **did not complete within 480 s** (killed at timeout) |

A long JD query OR-matches most of the corpus, so the per-row UPDATE storm and full
materialization scale with corpus size. The full 5x3 protocol is not tractable at 1M;
`rrf` (candidate-pooled) is the scale-viable system. For this reason the million run
was executed with `--systems rrf` and `search` is reported via the probe above.

## Smoke (5,000 rows) - protocol validation

search: en R@10 50.0%, vi 0.0%, ja 0.0% (p50 0.65-18.0 s). rrf: en NDCG@10 64.5%,
vi 0.0%, ja 0.0% (p50 ~0.9 ms warm). Gold sets at 5K are tiny (5-9 rows), so smoke
accuracy is noisy; the run validates the end-to-end path, not the numbers.

## Comparison: TerranSoul vs Claude (Sonnet-5-class) on the same 300 resumes

Setup (benchmark/scripts/jd-sample-bench.mjs): deterministic language-stratified
300-resume sample of the million corpus (seeded 10 gold picks per JD + stride-sampled
fillers; sample gold recomputed by predicate: en-backend 12, vi-data-eng 10,
ja-mobile 10 - spread across all 7 languages). Both systems saw the SAME resumes and
were scored against the SAME gold with the SAME metric functions. Claude (this
session, Fable 5 acting as the Sonnet-5-class in-context baseline) read all 300
resumes in 6 batches and ranked the top-20 per JD from the resume text alone
(meta/gold files not consulted); its pass was timed honestly end to end.

| | TerranSoul rrf (300-row store) | Claude in-context (300 resumes) |
|---|---|---|
| jd-en-backend NDCG@10 | 80.1% | 100.0% |
| jd-vi-data-engineering NDCG@10 | 8.5% | 100.0% |
| jd-ja-mobile NDCG@10 | 30.7% | 100.0% |
| R@10 capped (en / vi / ja) | 70.0% / 10.0% / 30.0% | 100.0% / 100.0% / 100.0% |
| P@10 (en / vi / ja) | 70.0% / 10.0% / 30.0% | 100.0% / 100.0% / 100.0% |
| Index/prepare time | 0.05 s ingest (3.0 s wall incl. shim spawn) | none (reads raw text) |
| Per-query latency after prepare | 0.55-0.99 ms (warm) | n/a (single 148.7 s pass covers all 3 JDs) |
| End-to-end wall time, 3 JDs | 3.0 s | 148.7 s |
| Scales to 1,000,000 resumes? | Yes - measured above (ingest 25 min once; 2.6-3.3 ms warm queries; NDCG@10 en 93.4 / vi 45.4 / ja 9.5) | Not in-context: 300 resumes ~ 60-70K tokens; 1M resumes ~ 200M+ tokens, far beyond any context window. Would require its own retrieval layer (chunked map-reduce reading at roughly proportional cost: ~3,300x the 300-resume pass) |

Honest notes:
- The gold predicate (area + >=2 skills + years) is mechanically extractable from
  every resume's text, so a careful reader that sees ALL candidates saturates this
  task at 300 scale; Claude's 100% reflects full in-context visibility, not
  general-purpose superiority - and it re-pays the full read cost on every new JD
  batch, while TerranSoul indexes once and answers each new JD in milliseconds.
- TerranSoul's 300-row accuracy differs from its 1M accuracy (en 80.1 vs 93.4
  NDCG@10; vi 8.5 vs 45.4) because a 300-row corpus has only ~1-2 same-language gold
  rows per JD and 10-12 gold rows total per JD - small-sample noise dominates, with
  the same language-bias mechanism at different density.
- Claude's wall time excludes nothing: 148.7 s covers reading all 300 resumes and
  producing all three top-20 rankings in one pass.

## Limitations

- Lexical-only tonight: `LONGMEM_EMBED` unset, dense/vector channel OFF. `rrf_emb`
  with a multilingual embedder is the identified accuracy lever for vi/ja and is not
  yet measured at 1M (hours of embedding compute).
- Japanese tokenization: FTS5 unicode61 does not segment CJK; a CJK-aware tokenizer
  (or the dense channel) is required for ja-language recall.
- Synthetic corpus: template-generated resumes with exact skill labels; real resumes
  are noisier, which would lower exact-criteria extraction accuracy for ALL systems.
- Single machine, single run per configuration (rrf reproduced identically once via
  --resume); no variance bars.
- `search` probe bounded at 480 s (one query) rather than measured to completion.
- Warm-query p50 measures the process-lifetime search cache for `rrf` (the production
  chat path uses the same cache); the `hybrid` rows show the uncached repeated-query
  cost of a candidate-pool scan at 1M (0.9-18.5 s).

## Artifacts

- report.json (this run, machine-readable, combined)
- report-iter1-million.{md,json} - iteration 1 (rrf, full ingest)
- report-iter2-million-tuning.{md,json} - iteration 2 (rrf + hybrid keyword-only, --resume)
- report-smoke-5k.{md,json} - 5K smoke
- terransoul-300.json / claude-sonnet5-300.json / claude-sonnet5-ranking.json - comparison leg
- Local-only bench per rules/ci-vs-local-testing.md - not wired into CI.
