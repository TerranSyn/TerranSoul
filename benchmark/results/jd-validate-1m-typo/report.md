# MILLION-RESUME-BENCH Report

Date: 2026-07-09T09:17:30.419Z
Corpus: 1,000,000 synthetic resumes, seed 20260703
Systems: rrf | top-k: 100

## Methodology

- Deterministic multilingual synthetic resumes (en 40%, vi/ja 15%, ko/zh 8%, es/fr 7%),
  10 job areas, canonical skill IDs with Latin-script tech tokens in every language.
- Gold predicate per JD: `area equal AND >= 2 requiredSkills present AND years >= minYears`.
- Ingest through the `longmemeval-ipc` JSONL shim (same MemoryStore code path production uses).
- Each JD query issues one untimed warm-up request (discarded, primes caches/plans) then
  5 timed runs per system; latency_ms.p50/p95 are computed over ONLY those 5 warm timed runs
  (JD-MILLION-WARMP50-1); the warm-up's own latency is preserved separately as
  `latency_ms.cold_ms` so the cold-start cost stays visible/auditable. Accuracy is from the
  LAST timed run.
- Recall@K is reported in two labelled forms: **capped** = hits / min(K, |gold|)
  (1.0 achievable when |gold| > K) and **raw** = hits / |gold| (classic recall,
  bounded by K/|gold| at this gold density). NDCG@10 uses binary relevance.
- NOTE: with `LONGMEM_EMBED` unset the dense channel is OFF and `rrf` degenerates to
  lexical-only fusion (see the env table below before comparing systems).

## Environment

| Variable | Value |
|---|---|
| LONGMEM_APPLY_SEED | 1 |
| LONGMEM_DATA_DIR | C:/TerranSoul/jd-validate-1m-typo/store |
| LONGMEM_SHIM_EXE | internal module.exe |
| LONGMEM_DATA_DIR (effective) | C:/TerranSoul/jd-validate-1m-typo/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 1,000,000 in 783.3s (**1,277 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 100,000 | 2,414 | 2,414 | 41.4 |
| 200,000 | 1,794 | 2,058 | 97.2 |
| 300,000 | 1,447 | 1,804 | 166.3 |
| 400,000 | 1,446 | 1,699 | 235.4 |
| 500,000 | 1,264 | 1,590 | 314.5 |
| 600,000 | 1,231 | 1,516 | 395.8 |
| 700,000 | 1,151 | 1,450 | 482.7 |
| 800,000 | 1,105 | 1,396 | 573.3 |
| 900,000 | 884 | 1,311 | 686.4 |
| 1,000,000 | 1,032 | 1,277 | 783.3 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 (warm) | p95 (warm) | cold (warm-up) |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| jd-en-backend | en | 1441 | 100.0% / 0.7% | 84.0% / 2.9% | 57.0% / 4.0% | 100.0% | 100.0% | 16609.21ms | 17670.74ms | 16653.19ms |
| jd-vi-data-engineering | vi | 1166 | 40.0% / 0.3% | 20.0% / 0.9% | 16.0% / 1.4% | 40.0% | 53.5% | 13671.26ms | 13831.57ms | 13403.72ms |
| jd-ja-mobile | ja | 925 | 60.0% / 0.6% | 44.0% / 2.4% | 34.0% / 3.7% | 60.0% | 65.8% | 10904.64ms | 11273.66ms | 10657.84ms |
| jd-en-backend-typo | en | 1441 | 70.0% / 0.5% | 56.0% / 1.9% | 31.0% / 2.2% | 70.0% | 65.6% | 16290.63ms | 16429.83ms | 15858.17ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=1441)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 580 | 57 |
| ja | 228 | 0 |
| vi | 224 | 0 |
| zh | 110 | 0 |
| ko | 105 | 0 |
| es | 104 | 0 |
| fr | 90 | 0 |

### jd-vi-data-engineering (gold=1166)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 459 | 0 |
| vi | 177 | 16 |
| ja | 169 | 0 |
| ko | 95 | 0 |
| fr | 94 | 0 |
| es | 87 | 0 |
| zh | 85 | 0 |

### jd-ja-mobile (gold=925)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 375 | 0 |
| ja | 151 | 34 |
| vi | 134 | 0 |
| zh | 77 | 0 |
| ko | 70 | 0 |
| fr | 68 | 0 |
| es | 50 | 0 |

### jd-en-backend-typo (gold=1441)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 580 | 31 |
| ja | 228 | 0 |
| vi | 224 | 0 |
| zh | 110 | 0 |
| ko | 105 | 0 |
| es | 104 | 0 |
| fr | 90 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (an internal work item resume pattern).
