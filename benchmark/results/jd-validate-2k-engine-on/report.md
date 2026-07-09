# MILLION-RESUME-BENCH Report

Date: 2026-07-09T13:34:42.881Z
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
| LONGMEM_APPLY_SEED | 1 |
| LONGMEM_DATA_DIR | C:/TerranSoul/jd-validate-2k-engine-on/store |
| LONGMEM_WRITE_ENGINE | 1 |
| LONGMEM_DATA_DIR (effective) | C:/TerranSoul/jd-validate-2k-engine-on/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 2,000 in 0.1s (**19,670 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 2,000 | 19,744 | 19,726 | 0.1 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 (warm) | p95 (warm) | cold (warm-up) |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| jd-en-backend | en | 1 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% | 10.0% | 30.1% | 3.67ms | 5.59ms | 4098.75ms |
| jd-vi-data-engineering | vi | 4 | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% | 0.0% | 2.55ms | 3.81ms | 3852.11ms |
| jd-ja-mobile | ja | 2 | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% | 0.0% | 2.79ms | 3.16ms | 262.83ms |
| jd-en-backend-typo | en | 1 | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% | 0.0% | 2.54ms | 4.06ms | 3996.22ms |

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
| zh | 1 | 0 |
| en | 1 | 0 |

### jd-en-backend-typo (gold=1)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 1 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (BENCH-SCALE-3 resume pattern).
