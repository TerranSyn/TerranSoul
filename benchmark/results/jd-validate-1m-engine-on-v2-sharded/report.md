# MILLION-RESUME-BENCH Report

Date: 2026-07-11T07:57:02.681Z
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
| LONGMEM_DATA_DIR | C:/TerranSoul/jd-validate-1m-engine-on-v2/store |
| LONGMEM_SHIM_EXE | D:/Git/TerranSoulApp/src-tauri/target/release/longmemeval-ipc.exe |
| LONGMEM_WRITE_ENGINE | 1 |
| LONGMEM_DATA_DIR (effective) | C:/TerranSoul/jd-validate-1m-engine-on-v2/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: skipped (resume complete)
Rows: 0 in 0.0s (**0 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 (warm) | p95 (warm) | cold (warm-up) |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| jd-en-backend | en | 1441 | 100.0% / 0.7% | 84.0% / 2.9% | 84.0% / 5.8% | 100.0% | 100.0% | 0.47ms | 0.58ms | 6387.51ms |
| jd-vi-data-engineering | vi | 1166 | 30.0% / 0.3% | 14.0% / 0.6% | 15.0% / 1.3% | 30.0% | 45.4% | 0.57ms | 0.72ms | 3591.32ms |
| jd-ja-mobile | ja | 925 | 60.0% / 0.6% | 46.0% / 2.5% | 34.0% / 3.7% | 60.0% | 64.7% | 0.47ms | 0.62ms | 2347.26ms |
| jd-en-backend-typo | en | 1441 | 70.0% / 0.5% | 62.0% / 2.2% | 39.0% / 2.7% | 70.0% | 71.0% | 0.45ms | 0.53ms | 4051.63ms |

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
| en | 580 | 84 |
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
| vi | 177 | 15 |
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
| en | 580 | 39 |
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
