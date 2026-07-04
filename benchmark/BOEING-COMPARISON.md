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

## Comparison at a glance

The actor being maximized is **Claude Opus 4.8, driven inside TerranSoul** (via
TerranSoul's Claude CLI brain provider — `claude --model claude-opus-4-8`, the
same `BrainMode::ClaudeCli` path the app ships), wrapped in TerranSoul's
self-improve loop (render → frozen vision-judge → critic → targeted fix →
re-judge). The vision judge is held **frozen at gemma4:12b-it-qat** (neutral,
local, reproducible, sha256-stamped) so every row is scored by the same yardstick.

> Scores are the frozen weighted rubric total /100 on **this** harness. Rows
> marked _pending_ are filled only from the committed results JSON when
> BOEING-747-BENCH runs (GPU-exclusive; queued behind the JD bench). The
> "published 747 result" column is the **qualitative** history reported for the
> original (un-scored) test — cited, not a number on this rubric. No value here
> is fabricated, and no "beat/win" framing is used (factual policy).

The one result that matters here is **Claude Opus 4.8 + TerranSoul** on this
frozen harness, set against the **existing published benchmark landscape** (the
§ Existing online benchmarks audit below carries the full cited catalogue —
SWE-bench, ARC-AGI-2, LiveCodeBench, the qualitative 747 history, the pelican
SVG). The 747-specific context:

| System | Self-improve loop | Autonomy | Boeing-747 /100 (this harness) | Existing published standing (cited) |
|---|---|---|---|---|
| **Claude Opus 4.8 + TerranSoul** | ✅ yes | **none (autonomous)** | _pending — target: maximum_ | flagship: the first autonomous **scored** 747 run |
| Claude Fable 5 (published reference) | ✅ own loop | none (autonomous) | — (not run here) | 747: "~30 min, zero human intervention, near-perfect / 'AGI-level'" — subjective [Mustar/HF, 2026-06-09] |
| Claude Opus 4.8 alone (published) | ❌ no | needed human | — (not run here) | 747: "~25 min, 7 iterations, **with human guidance**" [BigGo, 2026-06-10]; SWE-bench Pro 69.2% |
| GPT-5.x / Gemini 3.x / DeepSeek V4 / Grok 4.3 | — | — | — (not run here) | no published **747** number (the 63/62/91 figures are a **different** Senior-Engineer bench [BigGo; KuCoin]); their standing on the standard evals is in § Existing online benchmarks |

**Reading it.** The published history says Claude Opus 4.8 **needed human
guidance** to finish the 747 solo, while the fully-autonomous near-perfect run
came from a larger model (Fable 5). TerranSoul's self-improve loop supplies exactly
the automated self-verification ("loop until 100% satisfied") that Opus 4.8 lacked
on its own — so the flagship row measures whether **Opus 4.8 + TerranSoul reaches
the target autonomously** where Opus 4.8 alone did not. The score fills in when the
run completes; single-shot local baselines were dropped per the project owner's
direction.

> **Actor configuration (per user directive 2026-07-04).** Primary: Claude Opus
> 4.8 **inside TerranSoul** (Claude CLI brain) as the builder/fixer actor. If
> Opus-inside-TerranSoul is unavailable in a given environment, the sanctioned
> fallback is **Opus 4.8 + TerranSoul with DeepSeek** replacing the local model
> for the reasoning/critic role. The vision **judge** stays gemma4 (frozen,
> neutral) unless a neutral non-Claude cloud **vision** judge is provisioned — a
> Claude-family judge grading a Claude actor is avoided (self-family score bias).

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

| System | Approach | Boeing-747 score /100 | Iterations | Source |
|---|---|---|---|---|
| **Claude Opus 4.8 + TerranSoul** | self-improve loop (Opus actor inside TerranSoul) | _pending — target: maximum_ | ≤ 12 | BOEING-747-BENCH |
| Stub (rig validation) | fixed source | 28.25 | — | `results/stub-validation.json` (measured, methodology check only) |

_(This table records the single figure that matters: **Opus 4.8 + TerranSoul** on
this frozen harness — the flagship autonomous run. The stub is a rig/judge
methodology check, not a competitor. Single-shot local baselines were dropped per
the project owner's direction — the comparison of interest is the best
Opus 4.8 + TerranSoul result against the **existing published benchmark
landscape**, catalogued in § Existing online benchmarks below.)_

## Existing online benchmarks (audit)

> The comparison the project owner asked for: **Claude Opus 4.8 + TerranSoul**
> against the existing published benchmark landscape. This section is a cited
> audit of the major current LLM benchmarks and the frontier models' latest
> published scores — so the flagship 747 result (above) is read in context. It is
> populated from an online research sweep; every figure carries a source and an
> access date, official leaderboards are distinguished from informal blog
> aggregates, and version numbers are quoted as each source states them (they vary
> across sources). No number is invented; factual language only.

_Citation audit in progress (research sweep running) — this table fills with, per
benchmark: what it measures, the top-model scores with source + date, and an
official-vs-informal flag. Benchmarks in scope: the Loop Library Boeing 747
(qualitative — the flagship's own protocol), SWE-bench Verified / SWE-bench Pro,
Terminal-Bench / agentic-coding leaderboards (the closest existing analog to an
autonomous self-improve loop), LiveCodeBench / Codeforces, ARC-AGI-2, the pelican
SVG (2D genre context), and the "Senior-Engineer" bench that the 63/62/91 figures
actually belong to._

**Note on comparability.** TerranSoul's differentiator is an **autonomous
self-improvement loop** (iterate-until-satisfied), which most standard benchmarks
do not measure — they score a single attempt. Where an existing benchmark does
reward agentic/iterative behaviour (e.g. SWE-bench-style agent runs,
Terminal-Bench), that is flagged as the closest analog; a single-attempt score
(ARC-AGI, LiveCodeBench) is a different measurement and is labelled as such rather
than presented as an apples-to-apples number against the 747 loop.

## Published history of this test (qualitative — no numeric leaderboard exists)

The Boeing 747 loop originates with **Victor Mustar** (product lead at Hugging
Face); the Loop Library page publishes the **protocol only** — there is **no
published per-model numeric score, point-scale, or leaderboard** for it. Every
reported "result" is a **qualitative** assessment by the test's author, framed by
him as being "more about spatial understanding than library knowledge." That
history, cited:

- Through **late 2025**, Mustar reported that **no model completed the task**
  correctly. [modemguides, 2026]
- **Claude Opus 4.8** (an earlier attempt): **"barely completed the task" after
  ~25 minutes and 7 iterations, with human guidance.** [BigGo, 2026-06-10]
- **Claude Fable 5** (2026-06-09): completed it with **zero human intervention in
  ~30 minutes**, a result Mustar described qualitatively as "near-perfect" /
  "AGI-level." This is one enthusiast's **subjective** assessment, **not a scored
  measurement.** [modemguides; BigGo; KuCoin, 2026] The primary artifact is the
  Claude Code session trace `victor/fable-5-boeing-747-trace` on Hugging Face
  (21 messages, 303 tool calls, ~30 min), whose original prompt is quoted:
  *"create the most realistic boeing 747 using THREEJS — use your vision
  capabilities to create a self verifiable system, enter a loop until you are
  100% satisfied about the result."*

**De-confliction (important):** several 2026 articles cite the figures **63
(Opus 4.8), 62 (GPT-5.5), 91 (Fable 5)**. Those belong to a **separate
"Senior-Engineer" benchmark and are NOT Boeing 747 scores** — both BigGo and
KuCoin state this explicitly. They are deliberately excluded from the table above.

**Why this harness adds a scored, reproducible version.** Because the original
test was scored only by eye, `benchmark/boeing747/` contributes what did not
exist publicly: a **frozen, reproducible, numeric** rubric (nine fixed views,
weighted criteria, sha256-stamped) so the same 747 build gets the same score on
any machine. TerranSoul's role maps directly onto Mustar's own prompt — "a self
verifiable system … loop until 100% satisfied": TerranSoul **automates** that
self-verification loop (render → vision-judge → critic → targeted fix → re-judge)
for a **frozen** actor. The measurement of interest is therefore whether that
automated loop lets **Claude Opus 4.8** — which the published history says needed
**human guidance** to finish solo — reach the target **autonomously**, in the
spirit of the fully-autonomous Fable 5 run.

## Drawing-benchmark genre (context only — different tests)

The canonical LLM "draw from code" eval is **Simon Willison's "pelican riding a
bicycle" SVG** test — but it is **2D SVG, not Three.js 3D primitives**, and is
also scored **qualitatively** (no numbers). It is genre context, not a comparable
figure: Willison called **Gemini 3 Deep Think** the "best one I've seen so far"
(2026-02), and **Claude Sonnet 5** (2026-06-30) "nothing to write home about."
[simonwillison.net/tags/pelican-riding-a-bicycle]

A methodology caveat that the pelican coverage surfaces and that this harness
takes seriously: **LLM-as-judge scoring can be poorly calibrated** (a judge model
has been observed to score other model families lower and its own family higher,
distorting rankings). This harness mitigates that with a **single frozen judge
model, temperature 0, median of three fixed seeds**, applied identically to every
actor including its own baseline — so the judge is a constant, not a variable, in
the comparison. It is not a perfect neutral oracle, and that limitation is stated
rather than hidden.

### Frontier landscape, mid-2026 (context)

For orientation only — no formal Three.js/3D-from-code multi-model leaderboard
exists; version numbers vary across informal sources, so these are directional:
Claude Opus 4.8, Claude Sonnet 5 (2026-06-30), Claude Fable 5 (2026-06-09),
GPT-5.5/5.6, Google Gemini 3 Deep Think / 3.1 Pro, xAI Grok 4.3, DeepSeek V4-Pro.
Sources: signals.forwardfuture.com (protocol); huggingface.co/datasets/victor/
fable-5-boeing-747-trace; finance.biggo.com/news/q8Z2sJ4BX0tZvRTvJuO0
(2026-06-10); modemguides.com/blogs/ai-news/claude-fable-5-demos-first-week;
simonwillison.net/tags/pelican-riding-a-bicycle. All accessed 2026-07-05.

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
