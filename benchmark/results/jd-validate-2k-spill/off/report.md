# MILLION-RESUME-BENCH Report

Date: 2026-07-11T06:33:26.168Z
Corpus: 2,000 synthetic resumes, seed 20260703
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
| LONGMEM_DATA_DIR | C:/TerranSoul/jd-validate-2k-spill/off/store |
| LONGMEM_SHIM_EXE | internal module.exe |
| LONGMEM_DATA_DIR (effective) | C:/TerranSoul/jd-validate-2k-spill/off/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 2,000 in 0.3s (**7,084 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 2,000 | 7,090 | 7,088 | 0.3 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 (warm) | p95 (warm) | cold (warm-up) |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| jd-en-backend | en | 1 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 10.0% | 100.0% | 0.4ms | 0.49ms | 891.93ms |
| jd-vi-data-engineering | vi | 4 | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% | 0.0% | 0.41ms | 0.6ms | 1011.18ms |
| jd-ja-mobile | ja | 2 | 50.0% / 50.0% | 50.0% / 50.0% | 50.0% / 50.0% | 10.0% | 61.3% | 0.45ms | 0.63ms | 139.58ms |
| jd-en-backend-typo | en | 1 | 0.0% / 0.0% | 100.0% / 100.0% | 100.0% / 100.0% | 0.0% | 0.0% | 0.32ms | 0.41ms | 887.19ms |

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

### jd-en-backend (gold=1)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 1 | 1 |

### jd-vi-data-engineering (gold=4)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 2 | 0 |
| zh | 2 | 0 |

### jd-ja-mobile (gold=2)

| Lang | Gold | rrf hits |
|---|---:|---:|
| zh | 1 | 1 |
| en | 1 | 0 |

### jd-en-backend-typo (gold=1)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 1 | 1 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (an internal work item resume pattern).
