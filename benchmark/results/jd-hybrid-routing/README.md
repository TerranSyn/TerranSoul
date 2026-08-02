# JD hybrid routing — selectable text first, OCR only where there is none

**Measured 2026-07-27.** Reproduce with:

```bash
npm run jd:mixed:build                    # 160 text + 40 image-only pages, one folder
npm run jd:routing-proof -- --ocr-limit 40
npm run jd:text-layer:test                # the regression guard
```

Artifact: `Real-E2E/jd/output/routing-proof-mixed-200.json` (gitignored — it is a
local measurement; the numbers below are the published copy).

## Why a MIXED corpus

The JD demo ingests `D:/TerranSoul/jd-1000-text`, so it never reaches OCR. That is
the point — extraction is exact and effectively free — but it also means the demo
proves nothing about the fallback. A parser with the OCR path deleted would pass a
100 %-text corpus and nobody would notice until a scanned CV arrived.

`jd-mixed` therefore holds both kinds of page in one folder, drawn from **disjoint
résumé ids** so an OCR page's content cannot be recovered from a text twin:

| | pages | source |
|---|---|---|
| selectable text | 160 | `jd-1000-text` |
| image-only | 40 | `jd-1000-scanned` |
| languages | 7 | en, es, fr, ja, ko, vi, zh (both halves) |

Disjointness independently verified on the built corpus, not just asserted by the
builder: **0 id overlap** between the 160 text ids and the 40 OCR ids, 200 unique
files, ground-truth `.text` present on all 200 rows, and all 7 languages present in
*both* halves — so neither half is a language-skewed sample. The builder joins the two
source manifests on **`.id`, never `.index`** (the bulk generator runs 20 workers, so
row order differs between them) and picks the two halves from disjoint slices of one
seeded shuffle.

Two failure modes matter, and both are silent:

- **text page → OCR** — the demo pays a vision-model call per page and takes OCR's
  error rate on text it could have read exactly.
- **scanned page → text** — the page is **dropped**, no error, no telemetry. This is
  what the old document-level ratio gate did to a mixed document: ≥50 % of pages had
  text, so it returned "OCR nothing".

## Result

| | measured |
|---|---|
| routed to extraction | **160 / 160** expected |
| routed to OCR | **40 / 40** expected |
| text pages sent to OCR | **0** |
| scanned pages kept as text (content dropped) | **0** |
| decide + extract, all 200 pages | **146 ms** (0.73 ms/page — **~1,370 pages/s**) |
| extraction CER vs ground truth | **0.142 %** |
| extraction CER ignoring whitespace | **0.0000 %** |
| OCR, 40 image-only pages | **10.3 min** (15.5 s/page) |

Independently re-run 2026-07-27 on a contended machine (10 cargo/rustc processes):
**160/40 split, 0 misroutes, 167 ms / 0.83 ms per page (~1,200 pages/s), CER 0.142 %,
glyph CER 0.0000 %** — same verdict, so none of the above is a single-run artifact.

**Extraction is character-exact — verified, not assumed.** Per-language CER ignoring
whitespace is 0.0000 % for all seven languages. Checked a second way, independently of
the CER scorer: a **character-multiset diff** against ground truth over all 160 text
pages found **0 pages** that differ once whitespace is removed, and on the worst page
(`text-res-461.pdf`, ja, 1.17 % CER) the *entire* difference is **5 extra `\n`**. So
JD-TEXT-4's warning does not fire: pdfkit's font subsetting did **not** damage this
corpus, the residual is line wrapping against an unwrapped reference, and there is no
defect in our own PDF generation to report.

### Extraction vs the OCR baseline

| | per page | 1,000 pages | CER |
|---|---|---|---|
| text-layer extraction | **0.73–0.83 ms** | **~0.8 s** | 0.000 % (glyphs) |
| OCR, uncontended baseline | 1.1 s | ~18 min | 0.67 % (full-1000) |
| OCR, this run (contended) | 15.5 s | ~4.3 h | see caveat below |

OCR baseline source: `benchmark/results/ocr-1000-slice/README.md` (1.1 s/page
uncontended on a 105-page slice; 0.67 % CER over the full 1,000). Against that
*uncontended* baseline, extraction is **~1,300× faster and strictly more accurate**.
That ratio — not the contended 15.5 s/page this arm happened to measure while ten
cargo/rustc processes and another workflow shared the machine — is the honest argument
for routing text-layer pages away from OCR. Both OCR figures are real; they measure
different machine conditions, and neither changes the routing verdict.

**The fallback is not free.** The 40 pages without a text layer cost 619 s; the 160
with one cost 117 ms. That ~5,000x is why the demo runs on the text corpus.

⚠️ **The OCR CER in the artifact (15.57 %) is not a benchmark number.** `routing-proof.mjs`
calls `ocrViaLlm` directly, without the `looksDegenerate` repetition-loop retry that
`run-ocr.mjs`'s main loop applies. 5 of the 40 pages hit such a loop and scored 100 %;
the other 35 average 3.50 %. The real recognition number lives in
`benchmark/results/ocr-1000-slice/`. This arm prices the fallback in **seconds**.

## What is proved, and what is still owed

**Proved:** the corpus routes correctly under production's own accept-rule — trim +
NFC, then reject empty or `looks_like_garbage` (`docparse.rs:513-520`) — applied
per page by `Real-E2E/jd/pdf-text-layer.mjs`, and the split is exactly the expected
160/40 with zero errors in either direction.

> **Correction (2026-07-27).** That check was itself broken and reported `PENDING`
> for the wrong reason. It watched `target/{debug,release}/terransoul-cli.exe`, but
> the CLI cargo target is **`terransoul-console`** (`src-tauri/Cargo.toml:47`), which
> `npm run build:cli` installs as `target/release/cli/terransoul.exe`. The
> `terransoul-cli.exe` files still on disk are orphans of a target name Cargo.toml no
> longer declares, so **nothing can ever rebuild them** — the check could never have
> flipped to `YES`, and anything touching a dead file's mtime would have flipped it to
> a false `YES` for a binary built from the old document-level gate. Now fixed: it
> checks the three real paths, excludes the orphans, and prints each candidate's build
> time. Current verdict, with evidence rather than assertion — the newest real binary
> is `2026-07-26T14:53:31Z`, `docparse.rs` is `2026-07-27T11:42:49Z`, so it genuinely
> predates the per-page router. The item stays owed; the reason is now true.

**CLOSED (2026-07-28, PDF-2/JD-CLI-3).** No CLI target reached `DocParser` at all —
`grep -rn "DocParser\|docparse::" src-tauri/src/bin/` returned nothing. Fixed by adding
`DocParser::route_pdf_pages` (the real `pages_needing_ocr` decision, no OCR performed)
and `terransoul --docparse-route <pdf-or-dir>` (JSONL routing dump) /
`--docparse-parse <file>` (full `ParsedDoc` dump) to `cli.rs`. Reproduce:

```bash
cd src-tauri && cargo build --bin terransoul-console
node Real-E2E/jd/docparse-route-proof.mjs          # this corpus (jd-mixed)
```

**Result: the real Rust router matches the JS mirror exactly.** 200 pages, 160
extracted / 40 OCR, **0 misroutes in either direction**, 734 ms – 1.1 s wall clock for
the whole corpus (JSONL decode + per-file process overhead included; the in-process
routing decision itself is ~1 ms/page, consistent with the JS-mirror timing above).
The item is no longer PENDING — it is a measured `YES`, not an assumption from binary
freshness. Artifact: `Real-E2E/jd/output/docparse-route-proof-mixed-*.json`
(gitignored — local measurement; this paragraph is the published copy).

The harder population (25 hand-adversarial fixtures interleaved with 500 clean pages)
found real gaps the JS mirror could not — see
`benchmark/results/jd-mixed-adversarial/README.md`'s "Real Rust router" section: one
confirmed-and-fixed silent-garbage bug, one benign-but-notable edge case, and one
still-open gap (encrypted/corrupt PDFs silently route to OCR instead of raising).

## Harness bug found and fixed while measuring

The first run reported Japanese extraction at 7.82 % CER (worst page 58.85 %) — which
read exactly like a font-embedding defect in our own PDF generation. It was not. The
CMap reader's hex-string pattern was `<[0-9a-fA-F]+>`, which does not match a bfrange
array entry that maps one glyph to several code units — `<0066 006c>`, the `fl`
ligature. Because array **position** is the glyph code, skipping that entry shifted
every later glyph in the font by one. YuGothic substitutes the ligature and Arial does
not, so only Japanese pages showed it. Fixed by allowing whitespace inside hex strings;
CER went 1.435 % → 0.142 % overall and 7.82 % → 0.692 % for Japanese, with glyph-level
CER at exactly 0.
