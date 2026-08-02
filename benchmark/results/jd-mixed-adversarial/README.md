# PDF-2 — hybrid routing on a MIXED corpus that contains the adversarial pages

**Measured 2026-07-28.** Artifacts in this folder: `summary.json` (every aggregate),
`pages.jsonl` (every per-page verdict, all four arms), `run.log` (the console output of
the run the numbers come from).

Reproduce:

```bash
node Real-E2E/jd/build-mixed-corpus.mjs --adversarial --text 400 --ocr 100
node Real-E2E/jd/mixed-corpus-e2e.mjs --repeat 5
node --test Real-E2E/jd/mixed-corpus-adversarial.test.mjs      # the regression guard
```

Exit codes: `0` every page routed as declared, `1` at least one misroute under the current
reader, `2` a required input is missing and **nothing was measured** (a missing corpus must
never read as a pass).

## Why this run exists

`benchmark/results/jd-hybrid-routing/` already showed 160 clean text pages and 40 clean
scans routing 160/40 with zero misroutes. That is the EASY population: both halves come
from one generator, so every text page is pdfkit's own layout and every scan is that same
page rasterised. A router can separate them by accident.

The population that actually broke the reader is the 25 hand-written fixtures in
`Real-E2E/jd/pdf-trap-fixtures.mjs` — /ObjStm behind an /XRef stream (the DEFAULT layout of
Word, Acrobat, Chrome print-to-PDF and modern LaTeX), text inside a Form XObject, inherited
/Resources, RC4-128 with an empty user password, /Differences encodings, inline-image noise.
**14 of those 25 were wrong before PDF-1's fix: 11 wrong route, 4 wrong text.** This run puts
them in the same folder as the easy pages and measures one pass over all of it.

## Corpus (n = 525 pages)

| class | pages | source | expectation |
|---|---:|---|---|
| clean-text | 400 | `jd-1000-text` | extract |
| clean-scan | 100 | `jd-1000-scanned` | OCR |
| adversarial | 25 | `pdf-trap-fixtures.mjs` | 16 extract / 4 OCR / **5 must ERROR** |

The 500 clean pages are drawn from **disjoint résumé ids** (verified on the built corpus: 0
overlap), so an OCR page's content cannot be recovered from a text twin, and all 7 languages
(en/es/fr/ja/ko/vi/zh) appear in **both** clean halves. Rows are interleaved, so a reader
cannot pass by treating the tail differently from the head.

> ⚠️ **The adversarial pages are ~700-byte synthetic PDFs, not résumés.** Their reference text
> is one line (41–49 characters) against a résumé's ~450. Never read a corpus-wide average as
> a statement about them — see *The aggregate is blind to them*, below, where that is measured
> rather than asserted.

> ⚠️ **Three expectations, not two.** Five fixtures are genuinely unreadable (dangling
> /Contents reference, /Contents that is not a stream, AESV3, a real password) and MUST raise.
> A reader that returns text for those is silently wrong, which is worse than a miss. Harnesses
> written for the 2-class corpus (`routing-proof.mjs`) must not be pointed at this one; that is
> why this corpus lives in its own directory and did not overwrite `jd-mixed`.

## Routing — the two directions, counted separately

They are different defects with different costs, so one number for both would hide the
expensive one behind the cheap one:

- **text → OCR** — latency and accuracy loss. The page was exactly readable; we pay ~1.8 s and
  take OCR's error rate instead of zero.
- **scan → text** — **silent data loss**. The page is indexed as whatever the text layer said,
  with no error and no telemetry, and the content is gone.

| current reader, 525 pages | measured |
|---|---:|
| routed to extraction | **416** (declared 416) |
| routed to OCR | **104** (declared 104) |
| refused (hard error) | **5** (declared 5) |
| **misrouted text → OCR** | **0** |
| **misrouted scan → text (silent data loss)** | **0** |
| kept as text with wrong characters | **0** |
| corrupt file accepted as text | **0** |
| threw on a readable file | **0** |

All 16 text-bearing fixtures come back **character-exact** (weighted CER 0.000 % over the
adversarial class).

> ⚠️ **357 of the 400 clean text pages differ from ground truth in whitespace only.** That is
> line wrapping — a PDF stores rendered LINES and the reference string is unwrapped — and it is
> reported as its own counter, never folded into "OK" silently. Glyph-level CER (NFC, whitespace
> removed) is **0.0000 %** on all 400. The verdict rule judges wrong-characters at glyph level
> for exactly this reason; string equality would have flagged 450 of 500 clean pages as corrupt,
> which is a statement about typesetting, not about the reader.

## The same 525 bytes through the PRE-FIX reader

The before/after runs the reader **as committed at HEAD (`618aba6d`)**, extracted from git at
run time rather than kept as a copy that would rot the moment HEAD moves.

| baseline reader, same corpus | |
|---|---:|
| misrouted text → OCR | **4** |
| misrouted scan → text (silent data loss) | **1** |
| kept as text with wrong characters | **4** |
| corrupt file sent to OCR | **4** |
| threw on a readable file | **2** |
| **adversarial pages correct** | **10 / 25** |
| **clean pages correct** | **500 / 500** |

**Every failure is in the adversarial population; the 500 clean pages are perfect in both
readers.** That is the whole argument for this corpus: a routing proof over easy inputs would
have scored the pre-fix reader 100 % and shipped it.

The 10/25 reconciles exactly with PDF-1's independent audit (10/25 OK, 11 wrong route, 4 wrong
text) — here the 11 wrong routes decompose as 4 text→OCR + 1 scan→text + 4 corrupt-sent-to-OCR
+ 2 threw-on-readable.

Named, because "1 silent data loss" is abstract:

- `trap-no-font-in-scope` — no font is in scope for the text-showing operator, so nothing can be
  decoded. The current reader says so and routes to OCR. The pre-fix reader returned **41
  characters of "selectable text"** and the page would have been indexed as that.
- `trap-inherited-resources` — font on the /Pages node (§7.7.3.4). The pre-fix reader decoded
  2-byte CIDs one byte at a time and returned **82 characters** of U+0001..U+001F soup at
  **192.7 % CER**, which `looks_like_garbage` accepts because C0 is not in its bad set.
- `trap-encrypted-aes128` (102.4 % CER), `trap-differences-encoding` (97.6 % CER) — same shape:
  accepted, wrong, silent.

**Priced:** the pre-fix reader sends **7 more pages to OCR** than the fixed one (11 unpriced OCR
pages vs 4). At the replay's 1.788 s/page that is **≈ 12.5 s of added latency on a 525-page
corpus** — *projected*, because those pages are synthetic and have no OCR output (see the OCR
caveat below) — plus 5 pages whose content is silently wrong and 2 readable files rejected outright.

## The distribution BEFORE the aggregate

Per-page CER over the 516 scoreable pages of the mixed corpus (9 unscoreable: 4 image-only and
5 unreadable fixtures have no reference text — they are **not** scored as 0 % and **not** as
100 %):

| | median | p90 | p95 | max | >1 % | >5 % | >50 % | perfect |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| mixed, current reader | 0.000 % | 0.726 % | 0.980 % | **19.654 %** | 24 | 2 | 0 | 393 / 516 |

**Worst pages, reported separately** (all three are OCR pages that routed correctly — the error
is recognition, not routing):

| page | class | lang | CER | ref chars | share of all errors |
|---|---|---|---:|---:|---:|
| `scan-res-538.pdf` | clean-scan | vi | 19.65 % | 463 | **15.7 %** |
| `scan-res-858.pdf` | clean-scan | en | 19.12 % | 455 | **15.1 %** |
| `scan-res-502.pdf` | clean-scan | ko | 5.00 % | 400 | 3.5 % |

Two pages out of 525 carry **30.8 % of every character error in the corpus**. The
length-weighted aggregate is 0.250 %; **remove the single worst page and it is 0.211 %.** Quote
the aggregate only with that alongside it.

Per language, and only then the mean — the seven scripts fail for different reasons:

| lang | mixed OCR half (100 pages) | mixed text half (400 pages) |
|---|---:|---:|
| vi | **2.465 %** | 0.004 % (glyphs 0.000 %) |
| ko | 1.854 % | 0.167 % (glyphs 0.000 %) |
| en | 0.390 % | 0.005 % (glyphs 0.000 %) |
| ja | 0.272 % | 0.717 % (glyphs 0.000 %) |
| es | 0.175 % | 0.007 % (glyphs 0.000 %) |
| fr | 0.041 % | 0.000 % |
| zh | 0.034 % | 0.025 % (glyphs 0.000 %) |

> ⚠️ **The text-half column is whitespace, not error.** Glyph CER is 0.0000 % for all seven
> languages; ja looks worst only because Japanese lines wrap most often against an unwrapped
> reference.

### The aggregate is blind to them

This is the finding that matters most for how this artifact should be read:

| mixed corpus, 525 pages | current reader | pre-fix reader | change |
|---|---:|---:|---:|
| **length-weighted CER** | 0.250 % | 0.373 % | +0.12 pp |
| macro (per-page) CER | 0.252 % | **1.607 %** | **6.4×** |
| worst page CER | 19.65 % | **192.68 %** | — |
| adversarial pages wrong | 0 / 25 | **15 / 25** | — |

A reader that gets 15 of 25 adversarial pages wrong — including one silent data loss and four
pages of pure junk indexed as clean text — moves the **length-weighted corpus CER by 0.12
percentage points**. The reason is arithmetic: the 16 scoreable adversarial references total
**664 characters out of 231,574 — 0.29 % of the corpus**. Length weighting is dominated by long
pages; the failing pages are short.

**So the corpus CER cannot be the acceptance criterion for this defect class.** The per-page
verdict counts are. That is why the routing table above leads and the CER table follows, and why
the harness exits non-zero on a misroute rather than on a CER threshold.

## Wall clock and CER vs the two pure baselines

Both baselines are built over the **same 500 résumés** as the mixed corpus (`BUILD.json` records
the ids), all-text and all-scanned, so the arms differ only in which pages have a text layer.

| arm | pages | route + extract | OCR (replayed) | **total** | per page | weighted CER |
|---|---:|---:|---:|---:|---:|---:|
| pure-text | 500 | 261 ms | — | **0.26 s** | **0.52 ms** | **0.114 %** (glyphs 0.0000 %) |
| **mixed** | **525** | **319 ms** | **179.3 s** | **179.7 s** | **342.2 ms** | **0.250 %** |
| pure-scan | 500 | 240 ms | 907.3 s | **907.5 s** | **1 815.0 ms** | **0.631 %** |

- **All-scanned costs 3,476× the wall clock of all-text** on identical content.
- In the mixed corpus, the 100 pages without a text layer (19 % of pages) consume **99.82 % of
  the wall clock**. The routing decision itself is ~0.6 ms/page and barely varies by population
  (clean-text 0.614, clean-scan 0.601, adversarial 0.540 ms/page) — deciding is free; being wrong
  is not.
- Mixed CER sits between the two baselines, as it must: its text half scores 0.124 % (glyphs
  0.0000 %) and its OCR half 0.754 %.

> ⚠️ **Timing spread, and a contended machine.** Route+extract is the **median of 5 repeats**;
> the five totals for the mixed arm were 359, 335, 315, 319, 295 ms. The whole measurement was
> then run a second time end to end: **every routing verdict and every CER was byte-identical**,
> while the extraction timings moved up to 11 % (mixed 288 → 319 ms, pure-text 264 → 261,
> pure-scan 246 → 240). A 12.6 h LongMemEval arm was running throughout with `cargo`/`cargo-clippy`
> processes live on the same 24-core box, so these extraction numbers are **conservative** (an idle
> machine would be faster) and the third decimal is noise. Timing is warm-cache: every file is read
> once before the timed arms.

> ⚠️ **OCR is REPLAYED, not re-run — this is the biggest caveat in this file.** OCR text and
> per-page latency come from `benchmark/results/ocr-1000-slice/ocr-unlimited-full.jsonl`, the
> measured full-1,000-page run of 2026-07-27 (baidu/Unlimited-OCR Q4_K_M on llama-server). The
> scanned pages here **are** pages of that corpus, byte for byte, so this is the same engine on
> the same bytes rather than an estimate — re-scoring the replay reproduces that run's published
> 0.67 % exactly (0.674 %). It was not re-executed because the GPU is held by the running
> LongMemEval arm; OCR would contend with it (contention has already invalidated two runs of that
> arm) and would have measured that contention rather than this workload. Every total containing
> it is labelled `replayed` in `summary.json`.

> ⚠️ **The OCR half of the mixed arm is a 100-page sample.** It scores 0.754 % where the 500-page
> pure-scan arm scores 0.631 % and the published full-1,000 scores 0.674 %. Same engine, same
> bytes — the spread is sampling, and it is why the mixed number is not quoted as an OCR
> benchmark. The OCR record remains `benchmark/results/ocr-1000-slice/`.

> ⚠️ **4 OCR pages in the mixed arm are UNPRICED** (11 in the pre-fix arm). They are synthetic
> fixtures that route to OCR correctly but have no OCR output and cannot get one — they are
> 700-byte hand-written PDFs, not images. They are counted and reported as unpriced, never
> costed at zero and never given an invented CER.

## What this did NOT prove (2026-07-28) — now closed, see below

**The production router was not exercised.** The routing rule under test above is
`Real-E2E/jd/pdf-text-layer.mjs`, a per-page JS mirror of production's accept-rule
(`docparse.rs:513-520` — trim + NFC, then reject empty or `looks_like_garbage`). Rust's own
`pages_needing_ocr` did not run, for two independent reasons:

1. **No binary contains it.** `pages_needing_ocr` exists only in the working tree; the newest
   real `terransoul-console` build is `2026-07-26T14:53:31Z` and `docparse.rs` is
   `2026-07-27T23:53:05Z`, so every build on this machine predates the per-page router and would
   "prove" the document-level gate it replaced. The check that establishes this is
   `productionRouterStatus()` in `Real-E2E/jd/routing-proof.mjs`, imported here rather than
   reimplemented, and it reports **PENDING** in `summary.json`.
2. **No binary exposes it either.** `grep -rn "DocParser\|docparse::" src-tauri/src/bin/` returns
   nothing: none of the five CLI targets reaches `DocParser`. So even a fresh build could not run
   this corpus without new Rust — a subcommand or a Rust-side harness. **A rebuild alone will not
   close this item**, which the earlier PENDING wording implied and this run does not.

`cargo` was not run at all that session (the LongMemEval arm's latency numbers would be
distorted by a concurrent compile), so nothing above was verified against Rust.

## Real Rust router (2026-07-28/29, PDF-2/JD-CLI-3 — CLOSED)

`DocParser::route_pdf_pages` (the real `pages_needing_ocr` decision, no OCR performed) and
`terransoul --docparse-route <pdf-or-dir>` / `--docparse-parse <file>` now exist in `cli.rs` —
the two-part gap above (no fresh binary AND no CLI surface) is closed. Reproduce:

```bash
cd src-tauri && cargo build --bin terransoul-console
node Real-E2E/jd/docparse-route-proof.mjs --adversarial
```

**Result, 525 pages, real Pdfium-backed production `model_root`
(`%APPDATA%/com.terransoul/dev/docparse`, matching what a real install resolves):**

| | measured (real Rust router) | manifest declares |
|---|---:|---:|
| routed to extraction | 418 | 416 |
| routed to OCR | 106 | 104 |
| hard error (throw) | 1 | 5 |
| text page → OCR misroute | 0 | — |
| **scan page → text misroute (silent data loss)** | **1** | 0 |
| wall clock, whole corpus | 1.6–1.8 s | — |

The extraction/OCR counts do not match the manifest 1:1 because the manifest's "throw" class (5
fixtures) is where the real router disagrees with its own design intent — see below. This is a
genuine finding the JS mirror, by construction, could never surface: it does not model "throw" at
all as a routing outcome for anything but well-formed-but-encrypted PDFs.

**Confirmed and fixed while measuring:** `adv-trap-identity-h-no-tounicode.pdf` (a 2-byte CID font
with no ToUnicode and no font program — "the glyph ids are NOT recoverable") came back from
`--docparse-parse` as `"U+0001 U+0002 U+0003 ..."` — literal
control-character soup — and was routed to `text`, not `ocr`. This is owed item 2 below, and it was
not a theoretical gap: it reproduced on the first real run. Fixed in `docparse.rs`'s
`looks_like_garbage` (added C0 controls U+0000..U+001F and DEL U+007F to the bad set) and ported to
`pdf-text-layer.mjs` in the same commit (the file's own "DRIFT PIN" test predicted exactly this: "the
fix is owed in docparse.rs; when it lands, this test fails and tells whoever lands it that the port
needs the same change" — it did). Re-measured after the fix: the fixture now routes to `ocr`, and the
corpus-wide `scanToText` misroute count dropped from 2 to 1. `cargo test --workspace --lib --features
postgres`: 2991/2992 passed pre-existing-flake aside (see below); `node --test
Real-E2E/jd/pdf-trap-fixtures.test.mjs`: 50/50.

**Confirmed benign, not a bug:** `adv-trap-no-font-in-scope.pdf` (`/Tf` names an undeclared font)
also routes to `text`, and the extracted content is coherent readable English
("Alex Nguyen - Full-stack Engineer, Ha Noi"), not garbage. Pdfium's default-encoding fallback
happens to decode this fixture's plain-ASCII/WinAnsi payload correctly even without resolving the
named font — a 1-byte encoding recovers by coincidence where the fixture's design intent (guard
against 2-byte CID guessing) does not apply. Left as-is: the output is genuinely correct for this
input, even though the fixture's stricter "never guess" reading would prefer an explicit refusal.

**Still open — new finding, not previously documented:** of the 5 fixtures the manifest marks
`expect: "throw"` ("Unreadable is NOT the same as 'no text layer' — this must throw, never route to
OCR"), only **1** actually throws (`adv-trap-encrypted-aes256-unsupported.pdf` — and only because
`lopdf::Document::load` fails outright on the AES-256/V5 trailer structure, not from a deliberate
"I cannot read this" check). The other 4 are silently routed instead:

| fixture | reason | actual route |
|---|---|---|
| `adv-trap-encrypted-real-password.pdf` | real user password | OCR |
| `adv-trap-dangling-contents-reference.pdf` | `/Contents` points at a missing object | OCR |
| `adv-trap-contents-not-a-stream.pdf` | `/Contents` resolves to a dict, not a stream | OCR |
| `adv-trap-ambiguous-object-number.pdf` | object 3 defined twice (ObjStm + top-level) | **text** (picked one silently) |

The OCR-routed three are a lesser failure than the pre-PDF-3 "silent garbage" class — the page is
at least queued for OCR rather than indexed as wrong text — but still violate the documented intent,
and for a real encrypted upload OCR cannot help either (Pdfium cannot rasterize a page it cannot
decrypt), so the practical outcome is the page silently produces nothing. The `ambiguous-object-number`
case is worse: it silently picked one of two conflicting object definitions and returned plausible,
unflagged text with no way for a caller to know the file was structurally ambiguous. **Filed as new
owed work** (see `rules/milestones.md` PDF-2 for the follow-up chunk) — distinguishing "structurally
unreadable" from "genuinely blank page" in `extract_text_layer`/`pdfium_page_texts`/`lopdf_page_texts`
needs a deliberate design pass (which failure classes should hard-error vs. degrade to OCR), not a
one-line fix like the C0 gap was.

**One pre-existing test flake observed, unrelated:**
`commands::channels::tests::whatsapp_sidecar_inbound_route_reply_loop_no_live_whatsapp` failed once
under the full 2992-test workspace suite ("fixture never delivered its canned inbound message in
time") and passed cleanly in isolation (8.2 s). Same class of contention-sensitive channel/sidecar
flake as `CHANNELS-FLAKE-ROOT-CAUSE` (`rules/completion-log.md`), not investigated further here —
unrelated to `docparse.rs`.

Artifacts: `Real-E2E/jd/output/docparse-route-proof-adversarial-*.json` (gitignored — local
measurement; this section is the published copy).

## Owed (Rust — status as of 2026-07-28/29)

1. ~~Exercise `pages_needing_ocr` on this corpus.~~ **DONE** — see "Real Rust router" above.
2. ~~`looks_like_garbage` accepts C0 controls.~~ **FIXED** — see "Real Rust router" above.
3. **The lopdf fallback gaps** listed in `benchmark/results/pdf-text-layer-traps/fixed.json`
   (`jsVsRustDrift`) are unchanged — Form XObjects, empty-password decryption,
   /Differences encodings, ASCIIHex/RunLength, inline-image prefix reads. Production falls back to
   lopdf whenever the Pdfium shared library is absent, **which is the default for a fresh
   install**, so the weaker extractor is the one most users get. Those rows are source-derived
   (read from the Rust and lopdf sources, citations inline) and have never been executed.
4. **NEW: "must throw" fixtures silently route instead.** 4 of 5 — see the table above. Needs a
   deliberate design pass distinguishing structurally-unreadable input (should hard-error) from a
   genuinely blank/text-free page (should route to OCR), not a quick patch.
