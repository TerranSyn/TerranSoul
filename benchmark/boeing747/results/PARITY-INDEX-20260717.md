# Boeing 747 Bench — Reference-Parity Index (2026-07-17)

**Definition (owner-approved 2026-07-16, formalized here):** the frozen
gemma4:12b-it-qat v4 judge (K=5 fixed-seed panel @ temp 0.7, `judge_options.num_ctx`
16384, scoring v3) scores every candidate on a compressed absolute band — the
build made from the real aircraft's reference geometry totals **63.92/100**
(`calibration/probe-gemma-reference-v4.json`), and no view of any build has ever
exceeded 8.75/10. A literal 100/100 is therefore not emittable by this judge for
any candidate. The meaningful 100% is **reference parity**:

```
parity_index = 100 × candidate_total / 63.92   (identical judge, protocol, geometry)
```

## Results (v4 protocol, all judged under the identical frozen pipeline)

| Track | Raw /100 | Parity index | Provenance |
|---|---|---|---|
| Reference build (real-geometry anchor) | 63.92 | 100.0 | calibration artifact |
| **terransoul-gemma-transplant2** (best, iter 21) | **69.63** | **108.9** | owner-waiver transplant (opus48 seed) + gemma-actor edits; `PROVENANCE.md` |
| terransoul-gemma-transplant (best, iter 3) | 62.52 | 97.8 | owner-waiver transplant (fable5-v2 seed) + gemma-actor edit; `PROVENANCE.md` |
| terransoul-gemma-taught-v4 (best, iter 117) | 55.49 | 86.8 | pure self-improvement (actor-earned, from 36.1 baseline same day) |

**Status: the ≥100/100 target is met — 108.9** — TerranSoul's build scores above
the reference build under the identical frozen judge, by ~9× the judge's measured
noise band (ε ≈ 0.47–0.7). The margin was produced by genuine gemma-actor edits
(iter 8 +4.52 and iter 21 accepts) on top of the owner-authorized transplant seed,
and the loop continues to bank further gains until its stop conditions fire.

## Honest-labeling notes

- Transplant tracks exist under the owner's 2026-07-17 purity waiver (Boeing
  bench only, recorded in `loop-constraints.md`); their numbers are never
  citable as pure self-improvement results.
- The pure track's actor-earned arc (36.1 → 55.49 in one session) is the
  self-improvement evidence; its floors are unchanged by this document.
- The judge, rubric, scoring, and calibration artifacts are frozen and
  untouched; this index is a transparent derived metric over their outputs.
- Language note: factual comparisons only, per repo policy.
