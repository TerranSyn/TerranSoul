# Boeing 747 primitives vision benchmark — model comparison

> **The test.** Build the most realistic Boeing 747 using **Three.js primitives
> only** (`Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`, `Capsule`, `Lathe`,
> `Extrude` — no meshes, loaders, or textures). A rig screenshots **nine fixed
> camera angles**; a vision judge scores each view against real 747 reference
> photos on a **frozen weighted rubric** (four underwing engines, partial-length
> upper-deck hump, slender ~70 m fuselage, ~37.5° wing sweep, tail, gear, livery,
> …) for a total out of **100**; a critic names the single weakest feature; the
> actor fixes it without regressing; iterate to a per-view threshold, a stall, or
> the 12-iteration budget. Protocol adopted from the **Loop Library**
> ([signals.forwardfuture.com](https://signals.forwardfuture.com)). Full frozen
> harness: [`benchmark/boeing747/`](./boeing747/) (rubric, cameras, judge, scoring
> — all CI-tested and sha256-stamped into every result).

## Measurement status (read first)

The harness is complete and merged. The **only measured result so far is the
stub rig-validation run (28.25 / 100)** — a fixed, deliberately-crude plane that
exercises the rig and judge end-to-end. The real per-model runs are
**BOEING-747-BENCH** (queued; GPU-exclusive because the vision judge and the
gemma4 baseline share the single local GPU, and the project runs one bench at a
time). That run produces, into `benchmark/boeing747/results/`:

- **gemma4:12b-it-qat, single-shot** — the local baseline (one prompt, no loop);
- **Claude Opus 4.8, single-shot** — a frontier-actor single-shot baseline;
- **TerranSoul + Claude Opus 4.8, self-improve loop** — the same frontier actor
  driven by TerranSoul's critic→fix→re-judge loop (the capability being measured).

Rows below marked **_pending_** are filled *only* from those committed results
JSON files — **no number is written here that has not been measured**. Every
figure is reported factually; the project does not use "beat / win / outperform"
framing in any published benchmark content.

## How to read the comparison

- **Single-shot** — one prompt, no iteration (`run-baselines.mjs`). This is how a
  raw LLM is normally asked to "draw a 747 in Three.js."
- **Self-improve loop** — TerranSoul's iterative loop (`loop-runner.mjs`): render →
  vision-judge → critic names the weakest feature → actor applies one targeted fix
  → re-judge, never regressing, up to the frozen 12-iteration budget. The
  comparison is designed to isolate what the *loop* adds on top of the same frozen
  actor.
- **Score** — the frozen weighted rubric total out of 100, taken as the
  median of three judge seeds (7 / 8 / 9). The `rubric.json` sha256 is stamped
  into every result so cross-run numbers are only compared when the rubric is
  byte-identical.

## Comparison table

| System / model | Approach | Boeing-747 score /100 | Iterations | Source |
|---|---|---|---|---|
| Stub (rig validation) | fixed source | **28.25** | — | `results/stub-validation.json` (measured) |
| gemma4:12b-it-qat | single-shot | _pending_ | 1 | BOEING-747-BENCH |
| Claude Opus 4.8 | single-shot | _pending_ | 1 | BOEING-747-BENCH |
| **TerranSoul + Claude Opus 4.8** | self-improve loop | _pending_ | ≤ 12 | BOEING-747-BENCH |
| _frontier models (context)_ | see below | _see § Related published results_ | — | cited |

_(This table records scores on **this frozen harness**. A frontier model's number
appears here only if it was run through this exact rig + rubric; scores taken from
other benchmarks are kept separate in the context section below, because a
different scene/rubric/judge is not directly comparable.)_

## Related published results (context)

> Populated from a citation sweep of the protocol source and the broader
> "LLM builds/draws an object from code" benchmark genre. These are **context**:
> where a source used a *different* rig, rubric, or task (e.g. an SVG drawing
> rather than a Three.js scene), that is stated explicitly — such a number is not
> a drop-in comparison to the scores in the table above.

_Citation sweep in progress — this section is filled from the research pass with
source URLs and access dates (the Loop Library's own Boeing 747 results where
published; Simon Willison's cross-model "pelican on a bicycle" SVG comparison as
genre context, flagged as a different, 2D test; the mid-2026 frontier landscape)._

## Reproduce

```bash
# 1. references (real 747 photos, gitignored) — one-time
node benchmark/boeing747/references/fetch-references.mjs

# 2. single-shot baselines (one prompt per model)
node benchmark/boeing747/run-baselines.mjs --model gemma4:12b-it-qat
node benchmark/boeing747/run-baselines.mjs --actor opus48        # Claude Opus 4.8

# 3. the self-improve loop (TerranSoul + Claude Opus 4.8 actor)
node benchmark/boeing747/loop-runner.mjs --actor opus48 --terransoul

# results land in benchmark/boeing747/results/*.json (rubric sha256 stamped)
```

The rubric, cameras, scene, judge model/options/seeds, thresholds, and budget are
**frozen** and identical across every actor and iteration — changing any of them
invalidates cross-run comparability and re-baselines the whole table. Per
`rules/bench-never-regress.md`, once a real number is published here it becomes a
floor: a later run below it triggers an investigate → optimize → rebench loop
before anything is republished.
