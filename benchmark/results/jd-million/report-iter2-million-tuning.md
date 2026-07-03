# MILLION-RESUME-BENCH Report

Date: 2026-07-03T03:09:47.657Z
Corpus: 1,000,000 synthetic resumes, seed 20260703
Systems: rrf, hybrid | top-k: 100

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

Path: skipped (resume complete)
Rows: 0 in 0.0s (**0 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 1441 | 90.0% / 0.6% | 82.0% / 2.8% | 83.0% / 5.8% | 90.0% | 93.4% | 2.65ms | 26177.62ms |
| jd-vi-data-engineering | vi | 1166 | 30.0% / 0.3% | 14.0% / 0.6% | 16.0% / 1.4% | 30.0% | 45.4% | 3.34ms | 23681.22ms |
| jd-ja-mobile | ja | 925 | 10.0% / 0.1% | 6.0% / 0.3% | 4.0% / 0.4% | 10.0% | 9.5% | 3.03ms | 2770.68ms |

### system: hybrid

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 1441 | 80.0% / 0.6% | 70.0% / 2.4% | 58.0% / 4.0% | 80.0% | 85.7% | 18531.97ms | 18709.37ms |
| jd-vi-data-engineering | vi | 1166 | 30.0% / 0.3% | 8.0% / 0.3% | 6.0% / 0.5% | 30.0% | 33.4% | 11178.78ms | 11582.1ms |
| jd-ja-mobile | ja | 925 | 10.0% / 0.1% | 6.0% / 0.3% | 4.0% / 0.4% | 10.0% | 9.5% | 929.7ms | 1115ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=1441)

| Lang | Gold | rrf hits | hybrid hits |
|---|---:|---:|---:|
| en | 580 | 83 | 58 |
| ja | 228 | 0 | 0 |
| vi | 224 | 0 | 0 |
| zh | 110 | 0 | 0 |
| ko | 105 | 0 | 0 |
| es | 104 | 0 | 0 |
| fr | 90 | 0 | 0 |

### jd-vi-data-engineering (gold=1166)

| Lang | Gold | rrf hits | hybrid hits |
|---|---:|---:|---:|
| en | 459 | 0 | 0 |
| vi | 177 | 16 | 6 |
| ja | 169 | 0 | 0 |
| ko | 95 | 0 | 0 |
| fr | 94 | 0 | 0 |
| es | 87 | 0 | 0 |
| zh | 85 | 0 | 0 |

### jd-ja-mobile (gold=925)

| Lang | Gold | rrf hits | hybrid hits |
|---|---:|---:|---:|
| en | 375 | 1 | 1 |
| ja | 151 | 3 | 3 |
| vi | 134 | 0 | 0 |
| zh | 77 | 0 | 0 |
| ko | 70 | 0 | 0 |
| fr | 68 | 0 | 0 |
| es | 50 | 0 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (BENCH-SCALE-3 resume pattern).
