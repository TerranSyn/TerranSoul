# OCR engine A/B — Unlimited-OCR vs gemma4 vision

**Full corpus, 1,000 pages, 2026-07-27.** Supersedes the 105-page slice below it.

## Headline

| | gemma4:12b-it-qat (vision) | **baidu/Unlimited-OCR Q4_K_M** |
|---|---:|---:|
| overall CER | 10.77 % *(105-page slice)* | **0.67 %** *(1,000 pages)* |
| latency | 13.0 s/page | **1.1 s/page** uncontended |
| perfect pages | 29 / 105 | **614 / 1,000** |
| VRAM | 7.6 GB | 1.95 GB + 0.83 GB mmproj |
| params | 12 B dense | 3 B total / **0.57 B activated** (MoE) |

Per language, full corpus:

| lang | n | CER | perfect |
|---|---:|---:|---:|
| fr | 73 | **0.01 %** | 70 |
| en | 429 | **0.15 %** | 416 |
| es | 69 | 0.23 % | 35 |
| ja | 127 | 0.41 % | 29 |
| ko † | 76 | 1.42 % | 1 |
| zh | 74 | 1.75 % | 59 |
| **vi** † | 152 | **2.20 %** | 4 |
| **overall** | **1,000** | **0.67 %** | **614** |

**Vietnamese is the weakest language** — 2.20 % CER and only 4 perfect pages of 152. Diacritics are
the plausible cause but that is a hypothesis, not a measurement.

> † **These two rows are measured WITHOUT crop-to-ink, and that is now a non-default flag.**
> `run-ocr.mjs` crops to the ink bounding box by default; reproducing the table above requires
> nothing (the crop is off by default). The crop was re-measured on the full vi and ko sets (OCR-11) and **made both languages
> worse** — see *Crop-to-ink: measured on the full sets, and rejected* below. **The numbers in this
> table remain the record**; the crop did not replace them.

## This is NOT 100 % accuracy, and the gap is structural

0.67 % CER means roughly **one wrong character per 150**. 386 of 1,000 pages have at least one error.
**16 pages (1.6 %) are still above 5 % CER**, two of them above 50 %.

Every one of those 16 is the same failure: **the model duplicates a line it already transcribed.**
Not misrecognition — duplication. Where a text layer exists, extracting it is exact and ~1,000×
faster; OCR is the fallback for genuinely image-only pages, not the primary path.

## Crop-to-ink: measured on the full sets, and rejected

**OCR-11, 2026-07-27.** All 152 vi + all 76 ko pages re-run with `trimToInk()` active, same corpus,
same `unlimited-ocr` Q4_K_M on the same llama-server, same guard. The only variable is the crop.
(Verified not confounded: **zero** of the 228 baseline vi/ko outputs trip the current
`looksDegenerate`, so the duplicate-line guard added after the original run is a no-op here.)

| | vi no-crop | vi **crop** | ko no-crop | ko **crop** |
|---|---:|---:|---:|---:|
| n | 152 | 152 | 76 | 76 |
| CER (length-weighted) | **2.20 %** | 2.28 % | **1.42 %** | **11.70 %** |
| CER (macro, per page) | 2.22 % | 2.31 % | 1.43 % | 11.59 % |
| CER (median page) | 1.40 % | **0.90 %** | 1.18 % | **0.74 %** |
| perfect pages | 4 | **11** | 1 | **6** |
| pages > 5 % CER | 8 | 13 | 1 | **28** |
| engine failures | 0 | 0 | 0 | **2** |

**Verdict: not adopted.** ko is **8.2× worse**; vi is a wash on the corpus metric (2.20 → 2.28 %).

### The crop does two opposite things at once

It is not simply "bad". **The typical page gets better** — median CER falls by a third in both
languages and perfect pages go 5 → 17. That part of the pilot's reasoning was sound. But it also
**induces line re-emission on a large minority of pages**, and that tail costs more than the median
gain wins. 147 of 228 pages improved, 71 got worse — and the 71 are worse by far more than the 147
are better.

### This is NOT the one-bad-page artifact of correction (2) — checked explicitly

The obvious objection, given this file's history, is that `ko 11.70 %` is another single pathological
page. **It is not, and here is the distribution that settles it:**

| | no-crop | crop |
|---|---:|---:|
| ko pages > 5 % CER | 1 / 76 | **28 / 76** |
| ko pages > 10 % CER | 0 / 76 | **24 / 76** |
| ko pages > 25 % CER | 0 / 76 | **14 / 76** |
| share of ko error carried by the single worst page | — | **11.9 %** |
| ko CER dropping the worst 1 / 5 / 10 pages | — | 10.45 % / 6.85 % / **4.77 %** |

Throwing away the worst **ten of seventy-six** pages still leaves ko at 4.77 %, **3.4× the 1.42 %
record**. In the retracted `ko 17.10 %` case one page *was* the entire weakness; here the worst page
is 11.9 % of the error and the damage is broad. The same test applied to vi: dropping its worst page
gives 2.09 %, so vi's aggregate is mildly tail-driven, but even its median-page gain cannot pull the
corpus metric below the 2.20 % record.

### Two pages now fail outright, and the crop causes it

`resume-0000071.pdf` and `resume-0000430.pdf` (both ko) return
`llama-server 500: The model produced output that does not match the expected peg-native format`.

**This is not a transient `fetch failed`, and it was verified rather than assumed:** each page was
re-run 3× cropped and 3× uncropped. **Cropped fails 3/3 on both pages; the full page succeeds 3/3 on
both** (445 and 452 chars, stable). The harder-penalty retry path also 500s. Scored as total loss
they contribute 897 of ko's 3,798 edits; **excluding them entirely, ko is still 9.19 %**, so they are
not what makes the crop lose. This is the same failure class that got the 2× upscale rejected in
OWNER DECISION 21 — the crop alone reaches it too, just more rarely.

### Mechanism: near-duplicate re-emission, invisible to the existing guard

The tail pages are **longer than their references**. ko pages more than 15 % longer than the
reference: **0 / 76 without the crop, 17 / 74 with it** (74, not 76, because the two 500s produced no
output to measure). The failure is the model re-emitting lines
it has already transcribed — but *not verbatim*, because each copy carries its own OCR substitutions:

```
ref    Tốt nghiệp loại giỏi ngành Kỹ thuật Máy tính.      (vi, page 655: 0.93 % -> 32.17 %)
hyp    Tố nghiệp loại giỏi ngành Kỹ thuật Máy tính.
hyp    Tố nghiệp loại giỏi ngành Kỹ thuật Máy tính.
hyp    Tố nghiệp loại giới ngành Kỹ thuật Mây tính.
```

`looksDegenerate` counts **exact** duplicate lines against a threshold of `> 5`, calibrated on
genuine references. These pages reach at most **4** exact duplicates (5 by an ≥ 85 %-similarity
measure), so the guard flags **0 of 26** bad ko pages and **0 of 13** bad vi pages. It is not
malfunctioning — near-duplicates are outside what it measures. Any future attempt at this crop needs
a similarity-based check, not a tighter equality count.

### A hypothesis I tested and discarded

That the crop's extreme aspect ratio (page 0.71 w/h, crop ~2.3–3.2) destabilises the vision encoder.
**Refuted:** mean crop aspect for bad vs good pages is 3.20 vs 3.00 (vi) and 2.32 vs 2.36 (ko), and
Spearman correlation between crop aspect ratio and CER is **0.150 (vi) / −0.083 (ko)** — no
relationship. Crop area and crop height likewise do not separate the two groups.

### The n=12 pilot was misleading, and the full set wins

OWNER DECISION 21 adopted the crop on `vi 2.83 % → 1.92 %` over **12 pages**. That pilot reproduces
exactly — the **first 12 vi pages** score 2.83 % no-crop and 1.88 % cropped — but the slice is not
the corpus: on all 152, the crop is 2.20 % → 2.28 %.

**Resampled 12-page vi slices (20,000 draws from the measured per-page results): the crop looks
better in 55.3 % of them and "≥ 30 % better" in 41.0 %.** At n=12 the pilot's headline was close to a
coin flip. **ko was never piloted with the crop at all** — and only 0.4 % of 12-page ko slices would
have shown the crop winning, so even n=12 would have caught it there.

**Where the crop stands:** `trimToInk()` is measured, tested and correct at what it does — 228/228
pages cropped, ink coverage 0.924–1.520 %, latency unchanged at 1.2 s/page. It is the *downstream
effect on the decoder* that fails. It must not ship on by default while ko is 8.2× worse.

### Unrelated but confirmed while running: the OCR-12 blank guard

The low-ink guard fired on **0 of 228** pages. The emptiest real page in this set carries 0.924 % ink
against a 0.1 % threshold — a 9.2× margin, consistent with the calibration claimed for it.

## Four corrections to this benchmark, and what caused each

Each was a real published number that had to be withdrawn. They are kept here because the *pattern*
is the lesson, not the individual figures. (1)–(3) are corrections to this file; (4) withdraws a
figure published in `rules/milestones.md`.

1. **`13.1 s/page` → `1.1 s/page`.** The first run was silently on **CPU**. The llama.cpp b10144 zip
   ships binaries only; CUDA needs the **separate cudart zip** or it falls back without saying so.
   That number would have killed the proposal. *Any llama.cpp latency taken without confirming GPU
   offload is worthless.*
2. **`ko 17.10 %` → `1.42 %`.** ONE page of 105 entered a tail repetition loop, emitting
   `전문대학 컴퓨터공학 전공 졸업.` to the 2,048-token cap — 1,426 chars against 403 expected. Against
   ~6,045 Korean reference chars, that single page WAS the entire "Korean weakness". It described a
   decoding failure, not a recognition one.
3. **`overall 2.71 %` → `0.67 %`.** Same cause as (2) plus a second, distinct failure mode found only
   at full scale — see below.
4. **`crop-to-ink: vi 2.83 % → 1.92 %, −32 %` (OWNER DECISION 21) → withdrawn.** Measured on **12**
   pages. The full 152-page vi set gives **2.20 % → 2.28 %**, and ko — never piloted with the crop —
   goes **1.42 % → 11.70 %**. The pilot number is not wrong about *its twelve pages*; resampling the
   measured per-page results shows a 12-page vi slice favours the crop **55 %** of the time, so it
   carried almost no information. *A direction taken from n=12 is a hypothesis, not a result — and
   this is the third time on this benchmark that a small sample has pointed the wrong way.*

**The generalisable lesson:** a length-weighted corpus metric is dominated by its worst page, so ONE
pathological output manufactures a per-language "weakness" that does not exist. Look at the
per-item distribution before attributing an aggregate to a property of the subject. Same trap as
`recall_ANY@5` reading 100 % on the multi-gold subset.

**The second lesson, from (4):** that check cuts *both* ways. The distribution must also be able to
*confirm* an aggregate — `ko 11.70 %` survives deleting its ten worst pages, which is precisely what
`ko 17.10 %` did not. "Look at the distribution" is not a licence to dismiss every bad number as an
outlier artifact.

## The second failure mode, and why the original guard missed it

The fix for (2) was a **tail-based** repetition check with a hard-penalty retry. At 1,000 pages a
second mode appeared that the tail check passes cleanly:

> The model transcribes correctly, **loses its place in a bullet list**, re-emits lines it already
> wrote, then **recovers and ends correctly**. Output reaches 1.87× reference length with a perfect
> final line — so every tail-based check sees a clean ending.

Four pages did this, at 42–93 % CER. They carried **30 % of the entire corpus error**. `looksDegenerate`
now also counts duplicate lines, with the threshold calibrated against the references rather than
guessed: the most repetitive genuine résumé in the corpus has **5** verbatim-duplicate lines
(histogram over 1,000: 910 pages at 0, then 41/26/12/10/1 for 1–5), so `> 5` is the first count no
real document reaches. On the measured run it flags 4 pages and **zero** good ones.

Re-running those four with the guard: zh 93.2 → 62.7 %, zh 90.0 → 51.7 %, ja 50.8 → **2.0 %**,
zh 42.2 → **2.3 %**. **The retry halves the damage on the worst two rather than eliminating it** — a
harder repetition penalty suppresses the loop without preventing it.

**A hypothesis I tested and discarded:** that the corpus induces this by cycling a small bullet-template
pool. It does not hold — **15 of the 18 originally-bad pages have references with no repeated lines at
all**, and the bad-rate difference (1.7 % for non-repetitive references vs 3.3 % for repetitive, n=90)
is noise. The duplication is intrinsic to the decoder, not an artifact of the corpus.

**Deliberately not guarded:** a *single* duplicated bullet, which is the majority of the remaining
error (14 of 18 pages). At that count it is indistinguishable from a document that genuinely repeats
a line, and a tighter threshold would delete real content. Those pages are counted and reported, not
silently retried. `npm run ocr:run:test` pins both modes.

## Method

- **Corpus** `D:/TerranSoul/jd-1000-scanned` — 1,000 image-only PDFs from `npm run ocr:build-scanned`.
  Verified text-layer-free (no `/BaseFont`, no `BT..Tj`, images only), so OCR genuinely runs; a
  text-layer PDF would be extracted directly and would measure nothing.
- **Ground truth is exact, not transcribed.** Résumé N is a pure function of `(seed, N)`, so the
  reference is known byte-for-byte and CER is exact rather than approximate.
- **Degradation** `medium` — 200 DPI, greyscale, 0.8° rotation, 0.6 blur, noise, JPEG q72. A pristine
  render is not a scan and would not discriminate engines.
- **Scoring** CER weighted by reference length, NFC-normalised (without which a correct Vietnamese
  transcription can score arbitrarily badly), whitespace collapsed. WER only for space-delimited
  languages. Missing pages are reported and scored as total loss, never as perfect.

### Timing caveat, stated rather than buried

The 1,000-page wall clock was **31.3 min (1.9 s/page)**, measured **while three other workflows shared
the GPU**. The uncontended figure is **1.1 s/page** (105-page slice, idle machine). Neither is wrong;
they measure different conditions. The 6-page re-run measured 4.8 s/page because the guard issues a
second inference on flagged pages *and* the machine was loaded.

### Harness defect worth keeping

**Unlimited-OCR does not emit plain text.** It emits an OmniDocBench-style parse —
`title [93, 53, 372, 76]Patricia Anderson`. Scoring that raw counts every coordinate as a character
error. `stripLayoutAnnotations()` removes exactly that prefix shape and nothing else.

Two pages failed with transient `fetch failed` (network, not OCR) and both succeeded on re-run. The
resumable output file is what made that a 30-second fix rather than a 31-minute re-run.

## Reproduce

No flag is needed to reproduce the table above: `run-ocr.mjs` does NOT crop by default, because
the crop changes the vi and ko numbers (see the OCR-11 section).

```bash
npm run ocr:build-scanned -- --count 1000 --out D:/TerranSoul/jd-1000-scanned --degrade medium
# llama-server -m unlimited-ocr-Q4_K_M.gguf --mmproj unlimited-ocr-mmproj-f16.gguf --port 8085 -ngl 99
npm run ocr:run -- --corpus D:/TerranSoul/jd-1000-scanned --out hyp.jsonl \
  --engine unlimited --model unlimited-ocr
npm run ocr:score -- --truth D:/TerranSoul/jd-1000-scanned/manifest.jsonl --hyp hyp.jsonl
```

The OCR-11 crop A/B, which is a 228-page / 4.5-minute run rather than a full 1,000 (`--lang` takes a
comma-separated list and **throws** on a language the corpus does not have, so a typo shrinks nothing
silently):

```bash
npm run ocr:run -- --corpus D:/TerranSoul/jd-1000-scanned --out crop-viko.jsonl \
  --engine unlimited --model unlimited-ocr --lang vi,ko          # crop on (default)
npm run ocr:score -- --truth D:/TerranSoul/jd-1000-scanned/manifest.jsonl --hyp crop-viko.jsonl
```

## Remaining caveats

- **The paper's own headline numbers are inflated** and we should not repeat them: its "+6.22" on
  OmniDocBench v1.5 is measured against its older sibling (87.01), while the best baseline in its own
  Table 1 is DeepSeek-OCR 2 at 89.17 — an honest +4.06. Its v1.6 "SOTA 93.92" is a +0.02 lead over
  Qianfan-OCR. **The numbers above are ours, on our corpus, and depend on neither.**
- **The gemma4 column is still the 105-page slice.** It was not re-run at 1,000 pages: at 13.0 s/page
  that is 3.6 h, and the comparison is already decided by an order of magnitude on both axes.
  Do not read the two columns as an equal-n comparison — they are not.
- Licence: code MIT, weights MIT (HF model card `license: mit`), paper CC BY 4.0. See
  `docs/licensing-audit.md`.

---

<details>
<summary>Superseded: original 105-page slice (kept for the correction trail)</summary>

105 pages, `--stratify` (15 per language × 7). Published as overall **2.71 %**, `ko 17.10 %`. Both
figures were artifacts of one degenerate page — see corrections (2) and (3) above. The per-language
values from that slice were: en 0.00, fr 0.00, zh 0.03, ja 0.22, es 0.25, vi 2.60, ko 17.10.

Note how badly the small slice mis-estimated the full corpus in **both** directions: it read en/fr/zh
as *perfect* (they are 0.15 / 0.01 / 1.75 at n=429/73/74) and ko as catastrophic. n=15 per language
was too thin to rank languages at all.

</details>
