# MILLION-RESUME-BENCH Report

Date: 2026-07-05T18:12:32.227Z
Corpus: 40,000 synthetic resumes, seed 20260703
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
| LONGMEM_DATA_DIR | C:/TerranSoul/jd-40000-release-timing/store |
| LONGMEM_SHIM_EXE | D:/Git/TerranSoulApp/src-tauri/target/release/longmemeval-ipc.exe |
| LONGMEM_DATA_DIR (effective) | C:/TerranSoul/jd-40000-release-timing/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 40,000 in 15.1s (**2,652 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 40,000 | 2,652 | 2,652 | 15.1 |

## Results

### system: search

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 54 | 80.0% / 14.8% | 34.0% / 31.5% | 35.2% / 35.2% | 80.0% | 83.6% | 60825.99ms | 61498.86ms |
| jd-vi-data-engineering | vi | 50 | 10.0% / 2.0% | 4.0% / 4.0% | 10.0% / 10.0% | 10.0% | 22.0% | 39497.3ms | 40245.57ms |
| jd-ja-mobile | ja | 34 | 10.0% / 2.9% | 2.9% / 2.9% | 5.9% / 5.9% | 10.0% | 22.0% | 1925.91ms | 2138.96ms |

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 54 | 80.0% / 14.8% | 36.0% / 33.3% | 35.2% / 35.2% | 80.0% | 85.8% | 123.87ms | 3444.83ms |
| jd-vi-data-engineering | vi | 50 | 10.0% / 2.0% | 10.0% / 10.0% | 10.0% / 10.0% | 10.0% | 22.0% | 107.98ms | 4867.16ms |
| jd-ja-mobile | ja | 34 | 20.0% / 5.9% | 14.7% / 14.7% | 20.6% / 20.6% | 20.0% | 35.9% | 138.26ms | 1339.06ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=54)

| Lang | Gold | search hits | rrf hits |
|---|---:|---:|---:|
| en | 26 | 19 | 19 |
| vi | 9 | 0 | 0 |
| ja | 6 | 0 | 0 |
| zh | 5 | 0 | 0 |
| es | 3 | 0 | 0 |
| ko | 3 | 0 | 0 |
| fr | 2 | 0 | 0 |

### jd-vi-data-engineering (gold=50)

| Lang | Gold | search hits | rrf hits |
|---|---:|---:|---:|
| en | 16 | 0 | 0 |
| ja | 9 | 0 | 0 |
| zh | 6 | 0 | 0 |
| vi | 6 | 5 | 5 |
| ko | 5 | 0 | 0 |
| fr | 4 | 0 | 0 |
| es | 4 | 0 | 0 |

### jd-ja-mobile (gold=34)

| Lang | Gold | search hits | rrf hits |
|---|---:|---:|---:|
| en | 16 | 2 | 0 |
| ja | 5 | 0 | 5 |
| vi | 4 | 0 | 0 |
| zh | 3 | 0 | 1 |
| ko | 3 | 0 | 1 |
| fr | 3 | 0 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (BENCH-SCALE-3 resume pattern).
