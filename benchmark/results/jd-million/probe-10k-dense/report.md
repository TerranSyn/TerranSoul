# MILLION-RESUME-BENCH Report

Date: 2026-07-03T07:40:22.447Z
Corpus: 10,000 synthetic resumes, seed 20260703
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
| LONGMEM_DATA_DIR | D:/Git/ts-jdbench-wt/target-copilot-bench/jdbench-probe/store |
| LONGMEM_EMBED | 1 |
| LONGMEM_EMBED_MODEL | embeddinggemma |
| LONGMEM_DATA_DIR (effective) | D:/Git/ts-jdbench-wt/target-copilot-bench/jdbench-probe/store |
| node | v24.3.0 |
| platform | win32 x64 |

## Ingest

Path: add_sessions_jsonl
Rows: 10,000 in 1993.6s (**5 rows/s** overall)

| Checkpoint rows | Slice rows/s | Overall rows/s | Elapsed s |
|---:|---:|---:|---:|
| 10,000 | 5 | 5 | 1993.6 |

## Results

### system: rrf

| JD | Lang | Gold | R@10 (capped/raw) | R@50 | R@100 | P@10 | NDCG@10 | p50 | p95 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| jd-en-backend | en | 13 | 60.0% / 46.2% | 61.5% / 61.5% | 61.5% / 61.5% | 60.0% | 68.4% | 159.08ms | 15137.54ms |
| jd-vi-data-engineering | vi | 10 | 10.0% / 10.0% | 10.0% / 10.0% | 10.0% / 10.0% | 10.0% | 13.9% | 156.77ms | 8213.04ms |
| jd-ja-mobile | ja | 13 | 30.0% / 23.1% | 23.1% / 23.1% | 46.2% / 46.2% | 30.0% | 34.4% | 147.14ms | 1525.58ms |

## Per-language gold composition and hits

Gold composition = where the gold resumes live per language (corpus fact).
Hits = languages of gold resumes found in the top-100 (last run).

### jd-en-backend (gold=13)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 7 | 7 |
| vi | 3 | 0 |
| zh | 2 | 1 |
| es | 1 | 0 |

### jd-vi-data-engineering (gold=10)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 5 | 0 |
| zh | 3 | 0 |
| fr | 1 | 0 |
| vi | 1 | 1 |

### jd-ja-mobile (gold=13)

| Lang | Gold | rrf hits |
|---|---:|---:|
| en | 7 | 2 |
| ja | 2 | 2 |
| ko | 2 | 1 |
| zh | 1 | 1 |
| vi | 1 | 0 |

## Notes

- Local-only bench per rules/ci-vs-local-testing.md — never wire into .github/workflows.
- Corpus row N is a pure function of (seed, N); `--resume` slices the corpus at the
  store's `count` (an internal work item resume pattern).
