# MILLION-RESUME-BENCH Report

Date: 2026-07-03T02:32:04.145Z
Corpus: 5,000 synthetic resumes, seed 20260703
Systems: search, rrf | top-k: 100

## Methodology

- Deterministic multilingual synthetic resumes (en 40%, vi/ja 15%, ko/zh 8%, es/fr 7%),
  10 job areas, canonical skill IDs with Latin-script tech tokens in every language.
- Gold predicate per JD: `area equal AND >= 2 requiredSkills present AND years >= minYears`.
- Ingest through the `longmemeval-ipc` JSONL shim (same MemoryStore code path production uses).
- Each JD query runs 5x per system; latency is p50/p95 over the 5 runs; accuracy from the LAST run.
- Recall@K is reported in two labelled forms: **capped** = hits / min(K, |gold|)
  (1.0 achievable when |gold| > K) and **raw** = hits / |gold| (classic recall,
  bounded by K/|gold| at this gold density). NDCG@10 uses binary relevance.
- NOTE: with `LONGMEM_EMBED` unset the dense channel is OFF and `rrf` degenerates to
  lexical-only fusion (see the env table below before comparing systems).

## Environment

| Variable | Value |
|---|---|
| LONGMEM_DATA_DIR | D:\Git\ts-jdbench-wt\target-copilot-bench\jdbench\store |
| LONGMEM_DATA_DIR (effective) | D:\Git\ts-jdbench-wt\target-copilot-bench\jdbench\store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 5,000 in 1.5s (**3,444 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 5,000 | 3,444 | 3,444 | 1.5 |

## Results

### system: search

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 6 | 50.0% / 50.0% | 66.7% / 66.7% | 66.7% / 66.7% | 30.0% | 55.0% | 18033.48ms | 19223.08ms |
| jd-vi-data-engineering | vi | 5 | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% | 0.0% | 7742.46ms | 10586.64ms |
| jd-ja-mobile | ja | 9 | 0.0% / 0.0% | 22.2% / 22.2% | 33.3% / 33.3% | 0.0% | 0.0% | 653.77ms | 668.03ms |

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 6 | 50.0% / 50.0% | 66.7% / 66.7% | 66.7% / 66.7% | 30.0% | 64.5% | 0.86ms | 4078.46ms |
| jd-vi-data-engineering | vi | 5 | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% | 0.0% | 0.98ms | 4789.52ms |
| jd-ja-mobile | ja | 9 | 0.0% / 0.0% | 11.1% / 11.1% | 22.2% / 22.2% | 0.0% | 0.0% | 0.89ms | 647.31ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=6)

| Lang | Gold | search hits | rrf hits |
|---|---:|---:|---:|
| en | 4 | 4 | 4 |
| vi | 2 | 0 | 0 |

### jd-vi-data-engineering (gold=5)

| Lang | Gold | search hits | rrf hits |
|---|---:|---:|---:|
| zh | 3 | 0 | 0 |
| en | 2 | 0 | 0 |

### jd-ja-mobile (gold=9)

| Lang | Gold | search hits | rrf hits |
|---|---:|---:|---:|
| en | 4 | 1 | 1 |
| ko | 2 | 1 | 0 |
| zh | 1 | 1 | 1 |
| ja | 1 | 0 | 0 |
| vi | 1 | 0 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (BENCH-SCALE-3 resume pattern).
