# MILLION-RESUME-BENCH Report

Date: 2026-07-03T16:59:09.987Z
Corpus: 100,000 synthetic resumes, seed 20260703
Systems: rrf | top-k: 100

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
| LONGMEM_DATA_DIR | D:/Git/ts-jdbench-wt/target-copilot-bench/jdbench-100k/store-cjk |
| LONGMEM_DATA_DIR (effective) | D:/Git/ts-jdbench-wt/target-copilot-bench/jdbench-100k/store-cjk |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 100,000 in 58.7s (**1,704 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 100,000 | 1,704 | 1,704 | 58.7 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 146 | 90.0% / 6.2% | 48.0% / 16.4% | 33.0% / 22.6% | 90.0% | 78.0% | 0.85ms | 5377.24ms |
| jd-vi-data-engineering | vi | 131 | 10.0% / 0.8% | 6.0% / 2.3% | 6.0% / 4.6% | 10.0% | 22.0% | 1ms | 6924.55ms |
| jd-ja-mobile | ja | 107 | 50.0% / 4.7% | 14.0% / 6.5% | 12.0% / 11.2% | 50.0% | 54.6% | 0.98ms | 1368.67ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=146)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 67 | 33 |
| ja | 25 | 0 |
| vi | 18 | 0 |
| es | 10 | 0 |
| zh | 9 | 0 |
| ko | 9 | 0 |
| fr | 8 | 0 |

### jd-vi-data-engineering (gold=131)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 54 | 0 |
| ja | 21 | 0 |
| vi | 17 | 6 |
| zh | 13 | 0 |
| ko | 10 | 0 |
| fr | 9 | 0 |
| es | 7 | 0 |

### jd-ja-mobile (gold=107)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 42 | 0 |
| ja | 18 | 11 |
| vi | 13 | 0 |
| ko | 10 | 1 |
| zh | 9 | 0 |
| fr | 9 | 0 |
| es | 6 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (an internal work item resume pattern).
