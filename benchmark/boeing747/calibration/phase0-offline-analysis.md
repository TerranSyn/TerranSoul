# Phase 0 offline analysis — M2 / M5 / M6 falsification

**Status:** read-only, offline, no bench run, no API calls, no edits to any bench file.
**Scope:** `docs/boeing-100-mechanism-plan.md` §6 "Phase 0" items 1–3 (M2, M5, M6 falsification tests).
**Date:** 2026-07-14.
**Method:** two throwaway Node scripts run against the files already on disk under
`benchmark/boeing747/results/`, `benchmark/boeing747/calibration/`, and `benchmark/boeing747/candidates/`
(scripts kept only in the session scratchpad, not committed — this file is the durable artifact).

---

## Top-line numbers

| Test | Finding |
|---|---|
| **M2** | Of 90 (criterion × view) pairs with recorded structured scores, exactly **5** show a null/undecided rate ≥ 0.5 in the available data, and **all 5 are already in `rubric.json`'s hand-authored `view_visibility` mask**. **Zero new mask candidates** are supported by the data on hand. **Critical caveat below: the actual stuck pairwise-claude run (iters 6–10) has NO per-criterion-per-view ledger at all — the doc's own "silhouette_747 0–2.5" style claims are not reproducible from recorded JSON.** |
| **M5** | Of **3** recorded `rejected-edits.json` entries (the only such file that exists), **2** improved at least one of v1/v2/v3 while the aggregate total dropped; **0** improved *all three* simultaneously. Both partial cases are the two race-corrupted iterations (6 and 8) already flagged elsewhere. "Small, not zero" — confirms the doc's own hedge, refutes its stronger reading. |
| **M6** | **No genuine best-of-N round exists anywhere in the recorded history.** Every candidate track (`candidates/*/plane.js`) has held exactly one file, mutated serially in place, for the whole project. `git log` confirms every historical commit touches one `plane.js` at a time. No fabricated similarity number is reported. |

---

## Data inventory (read first — this bounds everything below)

Searched: `benchmark/boeing747/results/**` (17 result dirs incl. both `*.corrupt-bjke07o2u` archives),
`benchmark/boeing747/calibration/**`, `benchmark/boeing747/candidates/**`, plus `git log --all` over
`candidates/`.

**Files containing a genuine per-`(criterion, view)` numeric ledger (`criteria_medians`):**

| Source | Judge / track | `rubric_sha256` | `plane_sha256` | Views |
|---|---|---|---|---|
| `calibration/probe-identity-1.json` (= `ref-shots/judge-pairwise/view-*.json`) | Opus-4.8 pairwise, PROBE A pass 1 | `1ee64f89…` (current v2) | `92f5e42a…` (= reference build) | 9 |
| `calibration/probe-identity-2.json` | Opus-4.8 pairwise, PROBE A pass 2 (8 min later) | `1ee64f89…` | `92f5e42a…` (= reference build) | 9 |
| `calibration/probe-discrimination.json` (= `weak-probe/judge-pairwise/view-*.json`) | Opus-4.8 pairwise, PROBE C | `1ee64f89…` | `59bfd02b…` (a known-weak fable5 build) | 9 |
| `results/terransoul-opus48-claude/final-gemma-flagship.json` | gemma4:12b direct | `23ac79fd…` (v1) | `fb60cd1b…` | 9 |
| `results/terransoul-opus48-claude/final-opus-median3.json` | Opus-4.8, median-of-3 direct | `23ac79fd…` | `0e014f8f…` | 9 |
| `results/terransoul-opus48-claude/original-plane-gemma-samerender.json` | gemma4:12b direct | `23ac79fd…` | `86b0a81f…` | 9 |
| `results/stub-validation.json` | gemma4:12b direct | `a1e01f59…` | `17a7048a…` (deliberately near-empty stub) | 9 |
| `calibration/ref-shots/judge/view-*.json` (×9) | gemma4:12b direct calibration, identity | gemma direct calib | reference build | 1 each |

That is **8 distinct source documents, spanning 7 distinct candidate geometries** (two of the eight —
the two PROBE-A identity panels — score the *same* reference-vs-reference tie, by design).

**Files that do NOT contain `criteria_medians` (only an aggregate per-view `score` + free-text `notes`,
plus a per-*run* — not per-*view* — criterion mean under `weakest_feature.perCriterion`):**

- Every iteration file in **every** actor track's results directory, including the one this whole
  mechanism plan is about: `results/terransoul-opus48-pairwise-claude/iter-{1,2,3}.json`,
  `results/terransoul-opus48-pairwise-claude.corrupt-bjke07o2u/iter-{1..10}.json`, `best.json`,
  `gate-state.json`. Confirmed by grep: `grep -rl criteria_medians results/` returns exactly the 4
  files listed in the table above and nothing under any `*pairwise*` or `*fable5*` or `*open*` run
  directory.
- `lib/pairwise-parse.mjs` confirms *why*: the raw per-criterion `{verdict, evidence_a, evidence_b,
  confidence}` comparison objects and their `reconcileOrders()` output are computed in memory and never
  written to disk — only `lib/pairwise-scoring.mjs::scoreView()`'s final aggregate (`score`,
  `decided_fraction`, `masked_out`) plus a ≤400-char judge `notes` string survive into the iteration
  JSON. `shots/…` holds only PNGs, no raw judge JSON.

**Consequence, stated plainly:** the mechanism-plan's finding (a) — *"`silhouette_747` 0–2.5,
`upper_deck_hump` 0–2.5, `empennage` 2.5, `landing_gear` 1.25–3.75 on v1/v2/v3"* — and finding (b) —
*"`engines_four_underwing` scores 7.5 from the rear in every iteration and 2.5 from the front in every
iteration"* — **cannot be reproduced from any structured field in the recorded ledger.** Those specific
numbers are not "not found because I didn't look hard enough"; they are not persisted anywhere on disk
for the pairwise-claude track. They must have come from either a live re-run (out of scope here) or a
manual reading of renders + rubric anchors. I did not fabricate a replacement number; see the
"engines proxy" section below for the closest defensible substitute from data that *is* recorded.

---

## M2 — criterion × view null-rate and discrimination

**Method.** Built one row per `(criterion, view)` pair (90 = 10 criteria × 9 views) from the 8 sources
above. For each pair: `n` = number of sources that asked it, `nulls` = how many returned `null`,
`nullRate = nulls/n`, `distinctGeometries` = number of distinct `(rubric_sha256, plane_sha256)` pairs
contributing a non-null value, `range = max − min` of the non-null values.

**Caveat that matters more than any single number below:** this corpus mixes two judge models (Opus-4.8
pairwise-parity scale and gemma4 direct 0–10 scale) and three rubric versions (v1 unmasked, v2 masked,
and stub's own sha) across a **very wide capability spread** — from a near-empty stub (`total_0_100`
≈ 2.98–28) to a near-reference build (`total_0_100` ≈ 50–74). A criterion trivially "discriminates"
across that spread; that is *not* the same claim as "discriminates between two close, competitive
candidates near the current plateau" (the actual question for the stuck v1/v2/v3 views), and no data on
disk lets me answer that narrower question — see the data-inventory section above.

**Result 1 — no pair is flat/degenerate across the available geometries.** Every one of the 90 pairs
that had ≥2 distinct non-null geometries showed `range > 0`. Zero pairs are literally constant. So on
this (capability-spread-confounded) evidence, no criterion is *worthless* everywhere.

**Result 2 — exactly 5 pairs cross a 0.5 null-rate threshold, and all 5 are already masked:**

| Criterion | View | null_rate (n=8) | Already in `rubric.json::view_visibility`? |
|---|---|---|---|
| `landing_gear` | 5 (top-down) | **1.00** (8/8) | yes |
| `upper_deck_hump` | 4 (rear) | **0.75** (6/8) | yes |
| `window_door_lines` | 4 (rear) | **0.50** (4/8) | yes |

Six more pairs sit at the next-highest recorded rate, 0.375 (3/8) — worth naming as a watch-list, **not**
a mask recommendation (n=8 is too small to act on at that level, and I am not hand-adding a mask entry
per the AGI-purity boundary in the mechanism plan — "derived-from-the-scorer = pure; authored-by-us =
impure"):

| Criterion | View | null_rate | Already masked? |
|---|---|---|---|
| `upper_deck_hump` | 5 (top-down) | 0.375 | yes |
| `window_door_lines` | 3 (front) | 0.375 | yes |
| `empennage` | 3 (front) | 0.375 | **no** |
| `landing_gear` | 4 (rear) | 0.375 | **no** |
| `landing_gear` | 6 (front-¾-left) | 0.375 | **no** |
| `landing_gear` | 8 (low-front-left) | 0.375 | **no** |

**Result 3 — the existing hand-authored mask is empirically corroborated, not contradicted.** All 5
`(criterion, view)` pairs already in `rubric.json`'s v2 `view_visibility` mask show null_rate ≥ 0.375 in
this independent data (mean 0.575); zero already-masked pairs show a low null rate that would suggest
the mask is over-broad. **Zero NEW pairs clear the 0.5 threshold that isn't already masked.** On the
data available today, the M2 mechanism ("generalize the hand-authored mask to a derived one") would
reproduce the current mask almost exactly rather than expand it — the genuinely informative test (would
it *change* on the real plateaued lineage) needs the raw per-criterion ledger that section "Data
inventory" shows does not exist yet.

**`engines_four_underwing` specifically** (finding (b)'s subject): null rate is 0% on 8 of 9 views and
12.5% on view 4 — the lowest null rate of any criterion in the whole table. The doc's claim about this
criterion was never "the judge can't decide" (a null-rate claim); it was "the judge decides
*inconsistently* between views on the same geometry" — a different failure mode that null-rate cannot
detect and that the missing raw-panel data cannot let me test directly. As the closest defensible
substitute from data that *is* recorded, I scanned the **free-text `notes` field** (the one thing the
pairwise ledger does persist) across all 15 recorded pairwise-claude iteration/best files for the
pattern `"<criterion_id>: reference shows …"` (the judge's own citation format when a criterion is its
most salient visible gap on a view) and tallied which criterion is cited first, per view:

```
view 1: engines_four_underwing=11   view 4: livery_coherence=5, empennage=2   view 7: engines_four_underwing=6, window_door_lines=5
view 2: engines_four_underwing=11   view 5: livery_coherence=4, empennage=2   view 8: engines_four_underwing=5, landing_gear=1
view 3: engines_four_underwing=9, fuselage_proportions=1, empennage=1        view 9: landing_gear=7, engines_four_underwing=4
view 6: engines_four_underwing=6, landing_gear=3, empennage=1, upper_deck_hump=1
```

`engines_four_underwing` is the most-cited deficiency on **11/11, 11/11 and 9/9** of the structured
notes on views 1/2/3 respectively, and **0/0** on views 4 and 5 — where notes shift entirely to
comparative A-vs-B prose about `livery_coherence`/`empennage` instead. This is **consistent with** (not
proof of) the doc's claim that engines reads as a severe deficiency on the profile/front views and a
non-issue on the rear/top views for the same geometry. **Labeled explicitly: this is a citation-salience
proxy from free text, not a re-derivation of the doc's specific "7.5 vs 2.5" score claim**, which remains
unverifiable from the recorded ledger.

Full per-pair table: `C:\Users\DevStar\AppData\Local\Temp\claude\D--Git-TerranSoulApp\97414a8d-39bb-4eda-9f4a-8d22de8e449c\scratchpad\m2-report.json`
(session scratchpad — not committed; regenerate from the sources listed above if needed).

---

## M5 — replay `rejected-edits.json`

**Method.** Found every file named `rejected-edits.json` under `benchmark/boeing747/results/` (recursive
search). **Exactly one exists** —
`results/terransoul-opus48-pairwise-claude.corrupt-bjke07o2u/rejected-edits.json` — with **3 entries**
(iters 2, 6, 8). No other actor track, and no non-corrupt directory, has ever produced a rejected edit
that was logged to this file. Replayed all 3 against `per_view_delta` indices 0/1/2 (views 1/2/3, the
doc's "stuck" views) vs `gating_delta` (the total delta that drove the reject):

| iter | `per_view_delta[v1,v2,v3]` | `gating_delta` (total) | ≥1 of v1/v2/v3 improved? | All 3 improved? | Reason recorded |
|---|---|---|---|---|---|
| 2 | `[-1.22, 0, -0.54]` | −1.91 | no | no | `total regression: 41.93 < best 43.84 − epsilonTotal 0 (delta −1.91)` |
| 6 | `[-0.07, -0.26, +1.04]` | −5.07 | **yes** (v3 +1.04) | no | `total regression: 54.32 < best 59.39 − epsilonTotal 0 (delta −5.07)` |
| 8 | `[+0.43, -0.93, +3.06]` | −4.40 | **yes** (v1 +0.43, v3 +3.06) | no | `total regression: 54.99 < best 59.39 − epsilonTotal 0 (delta −4.40)` |

**Counts:**
- Total rejected-edit entries in the entire recorded history: **3**.
- Entries improving **at least one** of v1/v2/v3 while the aggregate total dropped: **2 of 3 (67%)**.
- Entries improving **all three** stuck views simultaneously while the aggregate total dropped: **0 of 3**.

**Reading this honestly, both ways:**
- The doc's falsification test asked for the count of edits that "improved v1/v2/v3 … while dropping the
  total" and predicted it would be small. **2 of 3 is small in absolute terms (n=3 total) but is not the
  literal zero the doc's stronger framing implies** ("if that count is 0, no stepping stone was ever
  proposed"). A partial, single-view improvement *was* discarded twice.
- However, **both of the 2 "improved" entries are iters 6 and 8 — exactly the two iterations the
  project has already independently flagged as corrupted by the concurrent-writer race** (see
  `docs/boeing-100-mechanism-plan.md` §1 and the actors' own `edit_summary` text embedded in this same
  `rejected-edits.json`: iter 6's entry literally says *"A concurrent process running my same prompt
  wrote a complete iter-18 pylon rebuild into plane.js in the gap between my Read and my Edit"*, and
  iter 8's says *"a concurrent process running this same actor prompt rewrote the engine block between
  my Read and my Edit … This is the identical race that regressed iter 6"*). So the 2 "partial
  improvements" are not evidence of a clean, reproducible stepping-stone edit being discarded by an
  over-tight ratchet — they are evidence of the **same race condition** double-counted, once per
  affected iteration.
- **Zero** entries show the clean pattern M5 is actually trying to detect — a coherent single edit that
  helps *all three* stuck views at a small aggregate cost, discarded by a zero-epsilon gate. On that
  specific, stronger and more decision-relevant question, the doc's prediction holds: **there is no
  rescuable stepping-stone in the recorded ledger**, but the sample is 3 entries from 1 file, which is
  too small to generalize a mechanism decision from either way.

---

## M6 — best-of-N sibling candidates

**Method.** Searched `benchmark/boeing747/` for any directory or file pattern suggesting a best-of-N
round (`best-of-n` in a path, any `candidates/*/plane-\d+.js` or similar sibling-numbering scheme, any
result field named `best_of_n`/`bestOfN`), then checked `git log --all --stat` over
`benchmark/boeing747/candidates/` for every historical commit that ever touched a `plane.js`.

**Result: no such round exists, at any point in the project's history.**

- `find . -iname "*best-of-n*"` matches only the **library code** (`lib/best-of-n.mjs`,
  `lib/best-of-n-orchestrate.mjs`, `lib/best-of-n-wiring.mjs`) and its **tests**
  (`lib/best-of-n.test.mjs`, `loop-runner-bestofn.test.mjs`) — a real, vitest-covered selection
  mechanism (worst-view LCB ranking + a reward-hack divergence guard) that has **never been invoked by a
  live bench run**: `grep -ri "best_of_n\|bestOfN\|BEST_OF_N" results/` returns zero matches anywhere in
  the recorded results tree.
- Every candidate track directory (`candidates/stub`, `candidates/terransoul-fable5{,-v2,-v2r2}`,
  `candidates/terransoul-opus48{,-open,-open-mesh,-pairwise}`, plus the git-history-only
  `terransoul-agent-opus48`) holds **exactly one `plane.js`**, mutated serially in place. There has
  never been a `plane-0.js`/`plane-1.js`/`candidate-a.js` sibling pair, nor a `best-of-n/` subdirectory,
  committed or uncommitted, at any point in `git log --all`.
- `git log --all --stat -- benchmark/boeing747/candidates/` confirms every historical commit's diff
  touches **one** `plane.js` path at a time — the closest thing to "parallel candidates" in the whole
  history is the *sequential* per-track lineage (`terransoul-opus48` → `terransoul-opus48-open` →
  `terransoul-opus48-open-mesh` → `terransoul-opus48-pairwise`), which are different experiments run
  one after another, not N siblings sampled and judged within one generation.
- As a side confirmation (not requested, but free once the hashes were computed): `candidates/
  terransoul-opus48-pairwise/plane.js` and `candidates/terransoul-opus48/plane.js` are byte-identical
  (`sha256 92f5e42a445e5dc92179c933be846c4626649c7a5c5dc4a677858acdf8a77d18`, 286 lines / 18213 bytes
  each) — independently reproducing the mechanism-plan's M3 finding that the pairwise track's seed is
  currently the opponent build itself.

**Per the task's own instruction, no similarity number is reported.** There is nothing to diff — a
proxy edit-distance between, say, two *different sequential tracks'* single files (e.g.
`terransoul-fable5/plane.js` vs `terransoul-opus48/plane.js`) would not answer "how similar are the N
candidates from one best-of-N generation" because no generation with N > 1 candidates has ever run;
computing that number would misrepresent unrelated, differently-purposed files as siblings. **M6's
falsification is unambiguous: the mechanism it tests (`buildBestOfNDiversityInstruction`'s unenforced
diversity ask) has never fired in a real run, so there is no diversity-collapse evidence to measure yet
— only the (separately confirmed) fact that the selection code downstream of it is untested in
production.**

---

## Files consulted

- `docs/boeing-100-mechanism-plan.md` (task brief, Phase 0 items 1–3)
- `benchmark/boeing747/rubric.json` (criteria, `view_visibility` mask, weights)
- `benchmark/boeing747/lib/pairwise-scoring.mjs`, `lib/pairwise-parse.mjs`, `lib/pairwise-config.mjs`,
  `lib/best-of-n.mjs` (read only — score-vector/JSON shapes, confirmed nothing persists raw panels)
- `benchmark/boeing747/results/**/*.json` (all 17 result dirs, both `.corrupt-bjke07o2u` archives)
- `benchmark/boeing747/calibration/**/*.json` (sidecar, both probe dirs, the 4 top-level probe files)
- `benchmark/boeing747/candidates/*/plane.js` (hashed, sized)
- `git log --all` over `benchmark/boeing747/candidates/`
