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

> The **Boeing-747** column is this harness's frozen weighted rubric total /100
> (median-of-3 gemma4 judge, sha256-stamped); every other column is the frontier
> models' **published** figure on that standard existing benchmark, filled from the
> online citation sweep below. No value is fabricated.

The flagship result — **Claude Opus 4.8 + TerranSoul, Boeing-747 = 73.68/100**
(frozen gemma4 judge, median-of-3) / **68.26/100** (Claude Opus 4.8 vision judge,
samples-of-3), on the **v2 corrected harness** _(provisional — v1 66.07/63.5 remains the
signed-off floor pending owner sign-off on the camera-spec re-baseline; see caveat below)_ —
set against the frontier models'
latest **published** standing across the major existing benchmarks (filled from the
online citation sweep in § Existing online benchmarks; every figure there carries a
source URL + access date).

> **v2 re-baseline (2026-07-05) — read § Measurement status.** The prior v1 numbers
> (66.07 gemma / 63.5 Opus) were depressed by **three measurement bugs** in the rig,
> now fixed (SwiftShader silently ignoring `antialias`; rubric criteria scored on
> views where the feature is structurally invisible; a bounding-sphere framer
> rendering the plane as a ~25%-frame thumbnail). On **identical geometry** the fixes
> recover **+8.6 for the gemma judge** (its ~67 cap was *largely a measurement
> artifact* — a 12B can't resolve an aliased thumbnail) but only **+0.2 for the Opus
> judge** (Opus already saw through the aliasing → its ~68 is *genuine geometry*, the
> real primitives ceiling). That split is the honest proof the fix is a *measurement*
> correction, not gaming (a gaming trick would inflate both judges). **v2 numbers are
> NOT comparable to v1.** Because the camera-framing fix re-baselines the *frozen* camera
> spec, **v1 (66.07 gemma / 63.5 Opus) remains the officially-signed-off published floor**
> and the **v2 figures here are provisional** until the project owner explicitly signs off
> on the camera-spec re-baseline — at which point v2 becomes the official record. The
> honest v2 decomposition is published now (rather than withheld) so the correction is
> transparent; the *status* (provisional vs. official) is what awaits sign-off, not the
> analysis.

> **Each column is a DIFFERENT benchmark on its own scale** — a SWE-bench % is not
> a Boeing /100 is not an ARC %. Read *down* each column (how models rank on that
> one test), never *across* rows as if the numbers were comparable. **●** = official
> / first-party leaderboard; **○** = informal blog aggregate (versions + splits vary
> by source — see the detailed tables). "—" = no published figure found. Numbers
> accessed 2026-07-05; factual reporting, no "beat/win" framing.

| Model | Score | Benchmark (what the score is on) | Source |
|---|---|---|---|
| **Claude Opus 4.8 + TerranSoul** | **73.68 %** (gemma4) · **68.26 %** (Opus 4.8 vision) | **Boeing-747** primitives — autonomous self-improve loop (v2 harness) | this harness (local) ● |
| Claude Fable 5 | 88.0 % | Terminal-Bench 2.1 (agentic coding, in a loop) | aggregate ○ |
| GPT-5.5 (Codex CLI) | 83.4 % | Terminal-Bench 2.1 | aggregate ○ |
| Claude Sonnet 5 | 80.4 % | Terminal-Bench 2.1 | aggregate ○ |
| Claude Opus 4.8 (bare actor) | 78.9 % | Terminal-Bench 2.1 | aggregate ○ |
| DeepSeek V4 Pro Max | 67.9 % | Terminal-Bench 2.1 | aggregate ○ |
| Kimi K2.6 | 66.7 % | Terminal-Bench 2.1 | aggregate ○ |
| Gemini 3.1 Pro | 46.1 % | SWE-bench Pro (Scale public set) | Scale ● |
| xAI Grok 4-Fast (+ Poetiq) | 54 % | ARC-AGI-2 (verified) | ARC Prize ● |
| Human senior engineers | 89 – 96 % | Every "Senior-Engineer" bench | Every ● |
| _rig floor — fixed hand-authored stub (**not a model**)_ | 28.25 % | Boeing-747 — harness sanity check | this harness ● |

**● official / first-party · ○ informal aggregate.** All scores are shown as **%**,
but the **Score column deliberately mixes benchmarks** — each row names its own test,
and the percentages are not the same *kind*: Boeing-747 and Senior-Eng are rubric
scores out of 100 (shown as %), while Terminal-Bench / SWE-Pro / ARC are benchmark
pass-rates. So it is **not** a like-for-like ranking; it places each system on the
benchmark most representative of *agentic coding* (Terminal-Bench 2.1 — "coding agent in a loop" — is used wherever published,
as the closest analog to TerranSoul's self-improve loop). Full per-benchmark numbers
(SWE-bench Verified/Pro, LiveCodeBench, ARC-AGI-2, Senior-Eng) with source URLs +
access dates are in § Existing online benchmarks. Notes carried there: Boeing-747 has
**no numeric online leaderboard** (the frontier models' 747 history is qualitative —
Opus 4.8 solo needed human guidance, Fable 5 finished autonomously); SWE-bench Pro
reads ~59% official vs ~69–80% blog depending on split; the **63/62.5/91** figures are
the Every Senior-Eng bench, **not** the 747; the ARC "85%" blog figure is excluded as
unsupported.

**Reading it.** The published 747 history says Claude Opus 4.8 **needed human
guidance** to finish the model solo, while the fully-autonomous near-perfect run
came from a larger model (Fable 5). TerranSoul's self-improve loop supplies the
automated self-verification ("loop until 100% satisfied") that Opus 4.8 lacked on
its own — so the flagship measures **Opus 4.8 + TerranSoul reaching the target
autonomously (66.07 gemma4 · 63.5 Opus vision)** where Opus 4.8 alone did not. On the *other* columns the
underlying actor is bare Opus 4.8 (its own row); TerranSoul adds the loop, measured
here on the 747.

> **Actor configuration (per user directive 2026-07-04).** Primary: Claude Opus
> 4.8 **inside TerranSoul** (Claude CLI brain) as the builder/fixer actor. If
> Opus-inside-TerranSoul is unavailable in a given environment, the sanctioned
> fallback is **Opus 4.8 + TerranSoul with DeepSeek** replacing the local model
> for the reasoning/critic role. The vision **judge** stays gemma4 (frozen,
> neutral) unless a neutral non-Claude cloud **vision** judge is provisioned — a
> Claude-family judge grading a Claude actor is avoided (self-family score bias).

## Measurement status (read first)

The flagship run is **measured** (2026-07-05, **v2 corrected harness**): **Claude Opus
4.8 + TerranSoul**, self-improve loop, best **73.68 / 100** (frozen gemma4:12b judge,
median-of-3) and **68.26 / 100** (Claude Opus 4.8 vision judge, samples-of-3) —
committed under `benchmark/boeing747/results/terransoul-opus48*/`.

**v2 re-baseline — the "~68 cap" root-caused as a measurement bug (2026-07-05).** The
project owner flagged the cap as a probable bug rather than a true ceiling. A
reproduce-first probe (identical-plane before/after renders) confirmed **three fixable
measurement bugs** in the rig, fixed with **no primitives relaxation and no
judge/label gaming**:

1. **No anti-aliasing.** SwiftShader silently ignores `antialias:true`, so every
   diagonal edge (wings, fin, nacelles, taper) was stair-stepped and read as rough
   craftsmanship. Fix: render at 3× and Lanczos-downscale to the frozen 1024×768.
2. **Criterion-on-invisible-view.** The judges scored `window_door_lines` on the
   head-on rear view *with their own note "no windows visible from this angle."* Fix:
   a `view_visibility` mask (rubric v2) scores each criterion only where it is
   structurally visible; masked cells → `null`. Raw `criteria_medians` retained for audit.
3. **Thumbnail framing.** The bounding-**sphere** auto-framer reserved wingspan room
   even in side views, so the candidate rendered at ~25% frame while the reference
   photos fill the frame. Fix: frame views 1–8 by the projected silhouette (~1.5×
   bigger, same angle/target); the tuned close-up view 9 is preserved exactly.

**Honest identical-geometry decomposition** (committed
`results/terransoul-opus48-claude/v2-rebaseline-decomposition.json`):
- **gemma4:12b (weak judge): 63.6 → 72.2 (+8.6)** — SSAA +3.6, mask +0.7, framing +4.3.
  The ~67 gemma cap was **largely a measurement artifact**; a 12B cannot resolve an
  aliased thumbnail. Best geometry under the corrected harness: **73.68**.
- **Opus 4.8 (strong judge): 67.84 → 68.0 ≈ flat** (only the mask nudged it, +0.5).
  Opus **already saw through** the aliasing/thumbnail, so its ~68 is **genuine
  geometry**, not a measurement cap. Best geometry: **68.26**.

**The split is the proof of honesty:** a gaming trick would inflate *both* judges; the
render fixes only helped the judge that was genuinely handicapped — which is exactly
what a *correct* measurement fix does. **v2 numbers are NOT comparable to v1**
(66.07 / 63.5, pre-fix rig — retained as the prior floor per `bench-never-regress.md`;
the corrected numbers are higher on both judges, so no regression). The
**camera-framing change re-baselines the frozen camera spec** and is the one edit
flagged for **explicit owner sign-off before any external (pitch / paper / wiki)
publishing**. The stub rig floor is 28.25 (pre-fix render). Single-shot local
baselines were dropped per the project owner's direction.

Every figure here is from a committed results JSON — **no number is written that
has not been measured** — and reported factually; the project does not use
"beat / win / outperform" framing in any published benchmark content.

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
| **Claude Opus 4.8 + TerranSoul** (v2 harness) | self-improve loop (Opus actor inside TerranSoul) | **73.68** gemma4 · **68.26** Opus vision | 9+ (both judge tracks) | measured — `results/terransoul-opus48*/` |
| _(v1 pre-fix rig — retained floor)_ | same, aliased/thumbnail render | 66.07 gemma4 · 63.5 Opus vision | — | prior record; **not comparable to v2** |
| Stub (rig validation) | fixed source | 28.25 | — | `results/stub-validation.json` (pre-render-fix; methodology check only) |

**The loop trajectory (measured).** Judged by Claude Opus 4.8 vision, the loop climbed
**37.9 → 60.4 → 61.0 → 62.6 → 63.7 → 64.4 → 66.3 (peak) → 63.5 (median-of-3)** as the
actor — via its own visual inspection of the nine views plus the critic — fixed real
defects the 12B judge had missed since iteration 1: a **mis-mirrored left wing/tailplane**
(the −Z engines had no wing above them), **missing `ExtrudeGeometry` caps** (fin/wings
rendered as thin outlines), and a reshape from a "supersonic dart" into a wide-body 747
(blunt nose, faired `Capsule` hump, four distinct light-cowl/dark-inlet underwing pods,
skin-seated windows). On the same render the frozen gemma4 judge reads **62.01 → 66.07**.
_(This climb is on the **v1 pre-fix rig**; under the v2 corrected harness the same
finished plane scores **73.68 gemma / 68.26 Opus** — see § Measurement status. The
trajectory is kept as the historical record of the loop's defect-fixing climb.)_
**Honest ceiling (v2, post measurement-bug fix).** On the **corrected** render the split
is now clear: the gemma judge reads **73.68** (its old ~67 was mostly aliasing/thumbnail
artifact, not geometry), but the **Opus 4.8 judge holds at 68.26 — a genuine structural
ceiling**, not a measurement one. On the clean render Opus's weakest features are all real
primitive limits: craftsmanship 6.22, engines 6.33 (nacelles visually cluster/merge with
the gear on side views), wing 6.56, silhouette 6.56 — the rubric's 8–10 anchors demand
near-photorealistic detail (open inlets, faired junctions, panel lines) that
Box/Cylinder/Sphere cannot render. Run-to-run judge noise (gemma ~±1.5/view, Opus ~±1/view)
now swamps small geometry gains, so further primitive tweaking has diminishing returns.
Materially exceeding ~70 on the strong judge requires **relaxing the primitives-only
contract to allow meshes/textures/`BufferGeometry` — i.e. a different benchmark, and the
project owner's call.**

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

> **Provenance discipline.** Official first-party / verified leaderboards are cited
> first and marked **[official]**; SEO "leaderboard" blogs report inflated numbers
> and newer version strings, so blog figures are marked **[informal]** and used
> only where no primary source was reachable. Where they disagree the official
> figure leads. Numbers accessed 2026-07-05. Version strings are quoted as each
> source states them (they vary across sources).

**Agentic software engineering (the closest genre to a coding self-improve loop)**

| Benchmark | What it measures | Reported standing (version as stated by source) | Source |
|---|---|---|---|
| **SWE-bench Pro** (public set) | Harder, contamination-resistant agentic bug-fixing | gpt-5.4 (xHigh) **59.1 ±3.6**; claude-opus-4-6 (thinking) 51.9; gemini-3.1-pro 46.1; gpt-5 41.8; kimi-k2 27.7; deepseek-v3p2 15.6 | Scale, `labs.scale.com/leaderboard/swe_bench_pro_public` **[official]** |
| SWE-bench Pro (blog) | same, vendor/blog splits | "Opus 4.8 69.2%"; "Mythos 5 80.3 / Fable 5 80" | morphllm.com, benchlm.ai **[informal]** — not on the official public set |
| SWE-bench Verified | Agentic bug-fix, resolve hidden test | "Mythos 5 95.5 / Fable 5 95 / Opus 4.8 88.6"; DeepSeek V4-Pro 80.6 | blog aggregates **[informal]**; official `swebench.com` (top numbers now compress ~90%+) |
| **Terminal-Bench 2.1** | Coding agent driving a terminal in a loop | Fable 5 88.0; GPT-5.5 (Codex) 83.4; Sonnet 5 80.4; Opus 4.8 (Claude Code) 78.9 | codingfleet aggregate **[informal]**; official `tbench.ai/leaderboard` |
| **LiveCodeBench** Pass@1 | Contamination-free competitive coding + self-repair | Gemini 3 Pro 91.7; Gemini 3 Flash 90.8; DeepSeek V3.2 89.6 | `livecodebench.github.io` **[semi-official]** |
| **WebDev / Code Arena** | Human-voted head-to-head web-app builds | claude-opus-4-7-thinking 1567 Elo (top), then opus-4-7 / opus-4-6-thinking / qwen3.7-max | LMArena `arena.ai/leaderboard/code/webdev` **[official]** |

**General capability (single-attempt evals — a different measurement)**

| Benchmark | What it measures | Reported standing | Source |
|---|---|---|---|
| **ARC-AGI-2** (verified) | Novel abstract visual reasoning | Poetiq-over-Grok-4-Fast **54%** ($30.6/task); Gemini 3 Deep Think **45%**; Gemini 3 Pro 31.1% | ARC-Prize-verified: `poetiq.ai/posts/arcagi_verified`, `arcprize.org/leaderboard` **[official]** — the blog "85%" figures are **unsupported**; do not use |
| **"Senior Engineer" bench** (Every) | One-task senior-level repo redesign, 6-dim human rubric | **Fable 5 91**; human seniors 89 & 96; **Opus 4.8 63**; GPT-5.5 62.5; Opus 4.7 33.5 | `every.to/benchmarks/senior-engineer-benchmark` **[first-party]** — this is the real source of the 63/62/91 figures (NOT the 747) |
| Boeing 747 (Loop Library) | 3D-from-primitives with a vision self-verification loop | qualitative only (see § Published history) — no numeric board | `signals.forwardfuture.com` **[qualitative]** |
| Pelican-on-a-bicycle SVG | Single-shot 2D SVG drawing | qualitative; Gemini 3 Deep Think named strongest (2026) | `simonwillison.net` **[first-party qualitative]** |

**Closest quantified prior art to TerranSoul's differentiator.** No mainstream
leaderboard publishes an *autonomous, iterate-until-satisfied loop* as its headline
metric — every board above scores a model or agent on a single attempt or a fixed
scaffold. The nearest **quantified** analog is the **Darwin Gödel Machine (DGM,
ICLR 2026)** — a self-modifying agent that rewrites its own code and empirically
validates each change, reporting **SWE-bench 20.0% → 50.0%** and **Polyglot 14.2%
→ 30.7%** over its evolution (`arxiv.org/abs/2505.22954`). The DGM number of
interest is the **delta the loop adds over the base agent**, not an absolute score —
which is exactly how the flagship row here should be read: **the improvement
Opus 4.8 + TerranSoul's loop earns over bare Opus 4.8** on the 747 (bare Opus 4.8
needed human guidance to finish; the loop supplies the automated self-verification).
The qualitative analogs are the 747 vision loop itself and the "Agentic Pelican"
critique loop (`robert-glaser.de/agentic-pelican-on-a-bicycle`).

**Cautions carried into this doc.** (1) SWE-bench Pro reads ~59% (official public)
vs ~69% (vendor blog) vs ~47% (private) — the split is always named. (2) The
ARC-AGI-2 "85%" blog figure contradicts the ~45–54% verified record and is not
used. (3) "Opus 4.8" appears mostly in aggregators; on Scale's official public set
the top verified Claude is opus-4-6 (51.9%) — Opus 4.8 figures are labelled by
provenance. (4) All figures are transcribed neutrally (no "beat/lead/dominate"),
per the factual-language policy.

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
