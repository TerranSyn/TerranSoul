# JD-DEMO — TerranSoul (Gemma 4 12B) vs Claude Sonnet 5

> The million-resume /demo jd benchmark: 1,000,000 deterministic multilingual
> resumes (7 languages, 10 job areas), 3 job-description queries — one each in
> English, Vietnamese, Japanese — accuracy + speed measured for both learning
> (ingest) and query, on the REAL production TerranSoul store path.
> Full measured detail: `benchmark/results/jd-million/report.md`.
>
> **Loop status: OPEN (user directive 2026-07-03: "loop optimal and rebench
> until we beat sonnet 5 in everything") — see §4 for the levers in flight.**
> Every number below is measured; this table is updated equal-or-better only
> (`rules/bench-never-regress.md`).

## 1. Comprehensive comparison (leader in bold per row)

Shared-corpus rows are measured on the SAME language-stratified 300-resume
sample with the SAME gold and metric functions — the largest corpus the
in-context approach can read at all. Scale rows are TerranSoul's measured 1M
run; Claude Sonnet 5 cannot participate at that scale (≈200M+ tokens).

| Metric | TerranSoul (Gemma 4 12B, local) | Claude Sonnet 5 (in-context) | Leader today |
|---|---|---|---|
| Accuracy NDCG@10 — en (300 shared) | 80.1 % | 100 % | **Claude Sonnet 5** (+19.9 pts) — open loop target |
| Accuracy NDCG@10 — vi (300 shared) | 8.5 % | 100 % | **Claude Sonnet 5** (+91.5 pts) — open loop target |
| Accuracy NDCG@10 — ja (300 shared) | 30.7 % | 100 % | **Claude Sonnet 5** (+69.3 pts) — open loop target |
| Accuracy NDCG@10 — en at 1,000,000 | 93.4 % | cannot run (context ceiling ~300 resumes) | **TerranSoul** — only system that runs |
| Learning throughput | **669 resumes/s** sustained to 1M (full production SQLite+FTS5 path) | none — re-reads corpus every time (2.0 resumes/s per pass) | **TerranSoul** (334×) |
| Query throughput (warm, 1M store) | **~300–385 queries/s** (p50 2.6–3.3 ms) | 0.02 JD-batches/s (one 148.7 s pass per batch) | **TerranSoul** (~15,000×) |
| End-to-end wall, 3 JDs (300 shared) | **3.0 s** (incl. ingest + shim spawn) | 148.7 s | **TerranSoul** (49×) |
| Marginal cost of the NEXT query | **milliseconds, $0** (index persists) | full re-read of the corpus, API tokens | **TerranSoul** |
| Scale ceiling (measured) | **1,000,000 resumes** (25-min one-time ingest) | ~300 resumes (context window) | **TerranSoul** (3,300×) |
| Privacy / locality | **fully local, $0, no data leaves the machine** | cloud API | **TerranSoul** |

**Scoreboard today: TerranSoul leads 7 rows, Claude Sonnet 5 leads 3 rows (the
three shared-scale accuracy rows). Those 3 rows are the open loop's target —
the loop does not close until TerranSoul is equal-or-better on all 10.**

## 2. Per-second stats (measured)

| Stat | TerranSoul (Gemma 4 12B) | Claude Sonnet 5 |
|---|---|---|
| Resumes learned per second (production store path, sustained to 1M) | **669/s** (2,285/s early → 388/s at the 1M mark as FTS5 grows) | n/a — no persistent learning |
| Raw durable append ceiling (same machine, sharded ring-buffer isolate, STORAGE-FJALL-5 2026-05-17) | **1.42–2.65 M docs/s** (different layer: no SQLite/FTS5 — reported for the million-CRUD/s requirement, not equivalent to the row above) | n/a |
| Resumes read per second (in-context pass) | n/a — reads its index, not raw text | 2.0/s (300 resumes / 148.7 s) |
| JD queries answered per second (warm, over 1M resumes) | **~300–385/s** | ~0.02/s (and only over ≤300 resumes) |
| Cold first-query cost (1M, long-JD FTS5 scan) | 2.9–32.8 s once, then cached | n/a |

## 3. Where each number comes from

| Artifact | Contents |
|---|---|
| `benchmark/results/jd-million/report.md` | the full 1M run: methodology, env stamp, ingest checkpoints, per-language gold/hit forensics, iteration log, probes, limitations |
| `benchmark/results/jd-million/report.json` | machine-readable results |
| `benchmark/scripts/jd-corpus.mjs`, `jd-queries.mjs`, `jd-million-bench.mjs`, `jd-sample-bench.mjs` | deterministic corpus, the 3 JDs, the 1M harness, the shared-sample harness |

Honest context for §1's shared-scale accuracy rows: the gold predicate
(area + ≥2 skills + years) is mechanically extractable from every resume, so a
reader with full in-context visibility saturates the 300-scale task — Claude's
100 % is real but reflects that visibility; it re-pays the entire read on every
new JD batch, while TerranSoul answers from a persistent index in milliseconds.
Neither framing is discounted in the table: the accuracy rows stand as
measured, and closing them at TerranSoul's speed/scale/cost is the loop's job.

## 4. The open optimization loop (MILLION-RESUME-2)

Target per the user directive: **equal-or-better than Claude Sonnet 5 on every
row of §1**, without regressing any TerranSoul-led row (floors: en NDCG@10
≥ 93.4 % at 1M, ingest ≥ 669 rows/s, warm p50 ≤ 3.3 ms).

Root cause of the accuracy gap (measured, `report.md` §per-language): with the
dense channel off, lexical retrieval finds gold almost exclusively in the
query's own language, and FTS5 unicode61 cannot segment Japanese at all.

Levers (schema V62, worktree line `feature/jd-million-bench`):
1. **CJK trigram lexical channel — implemented + tested, awaiting bench:**
   conditional `memories_fts_cjk` mirror fused into `hybrid_search_rrf` as a
   peer RRF ranking; non-CJK queries produce byte-identical pre-V62 fusion
   inputs (en floor protected by construction).
2. **Dense multilingual channel (`rrf_emb`) at scale — queued:** EmbeddingGemma
   is cross-lingual by construction; a resumable `embed_backfill` op (durable
   per 256-row batch, VRAM-placement preflight) upgrades the existing 1M store
   without re-ingest.
3. **Bench ladder:** 100K baseline → 100K dense → 100K +CJK → 100K +both →
   1M +CJK (en floor assert) → gated 1M embed backfill → 1M +both →
   **re-run the shared 300-sample comparison with the improved retrieval**
   (same gold, same metrics, Sonnet's published 100 % stands as its score) →
   update §1/§2 equal-or-better only.
4. If the ladder tops out below the target, the next architecture levers are
   already scoped: language-normalized skill indexing (canonical skill IDs are
   already cross-lingual in the corpus schema) and per-language candidate-pool
   quotas in the RRF fusion — both generic, production-path changes.

This document is the canonical scoreboard for the /demo jd mandate; it is
updated at every loop iteration that publishes a new floor.
