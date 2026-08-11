# MILLION-RESUME-BENCH Report

Date: 2026-07-11T05:13:51.118Z
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
| LONGMEM_DATA_DIR | C:/TerranSoul/jd-validate-1m-settings-memo/store |
| LONGMEM_SHIM_EXE | D:/Git/TerranSoulApp/src-tauri/target/release/longmemeval-ipc.exe |
| LONGMEM_DATA_DIR (effective) | C:/TerranSoul/jd-validate-1m-settings-memo/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 1,000,000 in 350.0s (**2,857 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 100,000 | 5,679 | 5,679 | 17.6 |
| 200,000 | 4,806 | 5,206 | 38.4 |
| 300,000 | 3,956 | 4,710 | 63.7 |
| 400,000 | 3,479 | 4,328 | 92.4 |
| 500,000 | 1,825 | 3,396 | 147.2 |
| 600,000 | 1,972 | 3,031 | 197.9 |
| 700,000 | 2,309 | 2,902 | 241.3 |
| 800,000 | 3,046 | 2,919 | 274.1 |
| 900,000 | 2,447 | 2,858 | 314.9 |
| 1,000,000 | 2,851 | 2,857 | 350.0 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 (warm) | p95 (warm) | cold (warm-up) |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| jd-en-backend | en | 1441 | 100.0% / 0.7% | 84.0% / 2.9% | 62.0% / 4.3% | 100.0% | 100.0% | 0.43ms | 0.58ms | 6374.39ms |
| jd-vi-data-engineering | vi | 1166 | 30.0% / 0.3% | 14.0% / 0.6% | 16.0% / 1.4% | 30.0% | 45.4% | 0.52ms | 0.64ms | 3566.73ms |
| jd-ja-mobile | ja | 925 | 60.0% / 0.6% | 44.0% / 2.4% | 34.0% / 3.7% | 60.0% | 65.0% | 0.56ms | 0.87ms | 1776.19ms |
| jd-en-backend-typo | en | 1441 | 70.0% / 0.5% | 60.0% / 2.1% | 31.0% / 2.2% | 70.0% | 71.0% | 0.46ms | 0.62ms | 4398.27ms |

## Typo-dictionary cache counters (TYPESENSE-ADAPT-6-CACHE-SCALE-GAP-1)

Cumulative process-wide values snapshotted after each query block
(diff consecutive rows for per-query deltas). `after ingest` is the
pre-query baseline.

| Phase | Hits | Miss cold | Miss mutations | Miss data_version | Hit rate | Rebuilds (p50 ms) | Expansions (p50 ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| after ingest | 0 | 0 | 0 | 0 | n/a | 0 (—) | 0 (—) |
| rrf jd-en-backend | 0 | 0 | 0 | 0 | n/a | 0 (—) | 0 (—) |
| rrf jd-vi-data-engineering | 0 | 0 | 0 | 0 | n/a | 0 (—) | 0 (—) |
| rrf jd-ja-mobile | 0 | 0 | 0 | 0 | n/a | 0 (—) | 0 (—) |
| rrf jd-en-backend-typo | 0 | 0 | 0 | 0 | n/a | 0 (—) | 0 (—) |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=1441)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 580 | 62 |
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
| en | 375 | 1 |
| ja | 151 | 33 |
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
  store's `count` (BENCH-SCALE-3 resume pattern).
