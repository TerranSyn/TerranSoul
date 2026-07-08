# MILLION-RESUME-BENCH Report

Date: 2026-07-08T21:26:28.557Z
Corpus: 1,000,000 synthetic resumes, seed 20260703
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
| LONGMEM_DATA_DIR | C:\ts-bench-cache\jdbench\store |
| LONGMEM_DATA_DIR (effective) | C:\ts-bench-cache\jdbench\store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 1,000,000 in 544.2s (**1,838 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 100,000 | 2,608 | 2,608 | 38.3 |
| 200,000 | 2,463 | 2,533 | 79.0 |
| 300,000 | 2,152 | 2,392 | 125.4 |
| 400,000 | 2,136 | 2,322 | 172.2 |
| 500,000 | 1,900 | 2,223 | 224.9 |
| 600,000 | 1,720 | 2,120 | 283.0 |
| 700,000 | 1,680 | 2,043 | 342.6 |
| 800,000 | 1,571 | 1,969 | 406.2 |
| 900,000 | 1,358 | 1,875 | 479.9 |
| 1,000,000 | 1,555 | 1,838 | 544.2 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 1441 | 90.0% / 0.6% | 82.0% / 2.8% | 83.0% / 5.8% | 90.0% | 93.4% | 1423.08ms | 14635.38ms |
| jd-vi-data-engineering | vi | 1166 | 30.0% / 0.3% | 14.0% / 0.6% | 16.0% / 1.4% | 30.0% | 45.4% | 1397.07ms | 12605.76ms |
| jd-ja-mobile | ja | 925 | 60.0% / 0.6% | 44.0% / 2.4% | 34.0% / 3.7% | 60.0% | 65.0% | 1575.51ms | 5905.54ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=1441)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 580 | 83 |
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

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (BENCH-SCALE-3 resume pattern).
