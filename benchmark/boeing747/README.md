# Boeing 747 primitives vision benchmark (frozen harness)

Protocol adopted from the **Loop Library** at
[signals.forwardfuture.com](https://signals.forwardfuture.com): build the most
realistic Boeing 747 using **Three.js primitives only**; a rig screenshots
**nine repeatable angles**; a vision judge scores each view against real 747
references; a critic names the **weakest feature** with a concrete fix; the
actor fixes it without regressing; stop at threshold, stall, or budget.

Everything in this directory that defines measurement — camera spec, scene,
rubric, weights, judge prompts, seeds, references — is **FROZEN** across all
actors and iterations. The sha256 of `rubric.json` is printed into every
result; changing any frozen artifact invalidates cross-run comparability.

### Version 2 re-baseline (measurement-fidelity corrections, 2026-07-05)

Three measurement bugs were root-caused and fixed as harness corrections (the
geometry judged is unchanged; the fixes let the judge see it faithfully). They
re-baseline the harness — **version-2 numbers are NOT comparable to version-1**:

1. **SSAA render** (`rig/render-rig.mjs`, `BOEING_SUPERSAMPLE`, default 3×). The
   pinned SwiftShader software-GL path ignores the WebGL `antialias:true` flag,
   so v1 frames were stair-stepped along every diagonal edge (wings, fin,
   nacelles, fuselage taper), which read to the vision judge as rough
   craftsmanship / jagged silhouette. The drawing buffer is now rendered at N×
   and Lanczos-downscaled to the frozen 1024×768. Same geometry, camera,
   lighting, scene — only edge sampling. Measured effect: **≈ +3.6** on the
   gemma track for the identical plane.
2. **View-visibility mask** (`rubric.json` `view_visibility`, rubric **version
   2**). A criterion is scored ONLY on views where the feature is structurally
   visible; on masked views its median is forced to `null` and excluded (weight
   renormalized). This deterministically enforces the rubric's own "null if not
   assessable from this angle" instruction, which the judges violated (e.g.
   `window_door_lines` = 2 on the head-on rear view, with the judge's own note
   "no windows visible from this angle"). Measured effect: **≈ +1.0–1.4** on
   Opus, **≈ +0.7** on gemma.
3. **Projected per-view framing** (`lib/cameras.mjs`, `CAMERA_SPEC_VERSION` 2).
   Full views (1–8) are framed by the aircraft's projected silhouette instead of
   its worst-case 3D bounding sphere — the sphere reserved room for the full
   wingspan even in a side view, rendering the candidate as a ~25%-of-frame
   thumbnail while the reference photos fill the frame. Fills the frame (~1.5×)
   at the same angle/target; view 9 (the tuned close-up) is preserved exactly on
   the v1 sphere frame.

## Layout

```
rubric.json          FROZEN: criteria/anchors/weights, judge+critic+builder
                     prompts, judge model/options/seeds/retry policy,
                     thresholds, budget
lib/                 pure frozen helpers (CI-tested via vitest):
  cameras.mjs          nine-view camera spec + auto-framing math
  scoring.mjs          seed-median, weighted mean, total, weakest-criterion
  stop-conditions.mjs  threshold / stall / budget evaluation
  contract.mjs         candidate source contract (primitives-only gate)
  judge-parse.mjs      reply extraction (content/thinking/done_reason),
                       strict-JSON parsing, same-seed retry policy
rig/                 render-rig.mjs + rig.html + static-server.mjs
judge/               judge.mjs (median-of-3 vision judge + critic mode)
                     + live-smoke.mjs (one live call, Ollama-dependent)
references/          fetch-references.mjs + manifest (images gitignored)
candidates/          stub/ (rig validation) + baseline-<model>/ (generated)
run-baselines.mjs    single-shot baseline protocol (one prompt, no loop)
loop-runner.mjs      per-iteration protocol for the improvement loop
shots/               (gitignored) rendered runs: view-1..9.png + contact sheet
results/             committed JSON results (baselines + loop iterations)
```

## Candidate contract (frozen)

`plane.js` is a single self-contained ES module:

```js
export function buildPlane(THREE) { /* ... */ return group; }
```

- **Primitives only**: `BoxGeometry`, `CylinderGeometry`, `SphereGeometry`,
  `ConeGeometry`, `TorusGeometry`, `CapsuleGeometry`, `LatheGeometry`,
  `ExtrudeGeometry`. Anything else (`PlaneGeometry`, `BufferGeometry`,
  loaders, textures) fails the contract gate (`lib/contract.mjs`).
- **No** imports, network, DOM, storage, `eval`/`Function`, workers.
  The source is gated by grep BEFORE it executes in the rig page (same class
  as the repo's execute_code checks).
- **Orientation**: nose along **+X**, up **+Y** (wings span Z). Position and
  scale are free — the rig auto-frames from the bounding box.

## The nine frozen views (`lib/cameras.mjs`, CAMERA_SPEC_VERSION 2)

1024x768, vertical FOV 35 deg, pixel ratio 1. **Full views (1–8) are framed by
the aircraft's projected silhouette** (bbox corners projected onto the camera's
right/up axes, filled to the vertical/horizontal FOV with a 1.05 margin, backed
off by the near-depth half-extent so nothing clips). **View 9** (the nose/hump
close-up — the only view with an explicit `distanceFactor`) is preserved exactly
on the version-1 bounding-sphere frame `d = 1.05r / sin(17.5 deg) × 0.42`,
targeted at the nose/hump. Angles/targets are unchanged from version 1; only the
full-view distances tighten (see the Version 2 re-baseline note above).

| # | view | azimuth | elevation |
|---|------|---------|-----------|
| 1 | left (port) profile | -90 | 0 |
| 2 | right (starboard) profile | 90 | 0 |
| 3 | front head-on | 0 | 0 |
| 4 | rear head-on | 180 | 0 |
| 5 | top-down planform (nose = frame top) | 0 | 90 |
| 6 | front 3/4 left, elevated | -45 | 20 |
| 7 | rear 3/4 right, elevated | 135 | 20 |
| 8 | low front-left (landing-gear view) | -60 | -10 |
| 9 | nose + upper-deck hump close-up | -35 | 12 |

Scene (frozen): background `#eef2f7`, hemisphere light (white/`#b0b8c0`,
0.9) + directional (2.2, direction `[1, 1.2, 0.8]` normalized), no ground
plane, no shadows, no tone mapping, no animation loop. The drawing buffer is
rendered at `BOEING_SUPERSAMPLE`× (default 3) and Lanczos-downscaled to
1024×768 (SSAA — SwiftShader ignores MSAA; see the Version 2 note). Three.js is
served from the repo's own `node_modules` over a local static server — **no CDN,
fully offline**.

## Judge (frozen)

Per view: screenshot + the 2 most relevant references (frozen mapping in
`rubric.json`) + the 10-criterion rubric go to `gemma4:12b-it-qat`
(temperature 0, `think:false`, `format:"json"`, num_ctx 8192). **Median of 3
calls** (fixed seeds 7/8/9), per-view score = weighted mean of criterion
medians, **TOTAL = mean of 9 views scaled to /100**.

- A criterion the judge cannot see from an angle is `null` — excluded with
  weight renormalization, never zeroed. Failed judge calls are recorded and
  dropped (fail-open; a dead judge must not destroy the signal). Because the
  judges frequently return a low integer instead of `null` on structurally
  invisible views, the `view_visibility` mask (rubric v2) enforces this
  deterministically in aggregation: `criteria_medians` stays RAW for audit, but
  `score` is computed from the masked medians and `score_unmasked` is recorded
  alongside so the mask's effect is transparent in every result.
- `think:false` is load-bearing and frozen: gemma4 under Ollama otherwise
  burns the whole `num_predict` budget inside `message.thinking` and returns
  empty content (`done_reason=length`) on this prompt shape (measured
  2026-07-03).
- **Reply parsing** (`lib/judge-parse.mjs`, pure + CI-tested): the reply text
  is taken from `message.content`, falling back to `message.thinking` when
  content is empty (the thinking-swallow shape); an all-empty or non-JSON
  reply is a classified retryable failure. **Frozen retry policy**
  (`judge_parse_retries` in rubric.json): retried with the IDENTICAL seed —
  never a fresh seed, so the seed set stays exactly `judge_seeds`. A seed
  that still fails is recorded (`error`) and dropped; successful seeds record
  `reply_source`, `done_reason`, and `parse_retries` for auditability.
- Judge calls are strictly sequential with 180 s timeouts (GPU may be shared
  with other benches; judging is latency-insensitive).
- **Live smoke** (`npm run bench:747:smoke`): ONE judge call (default
  view 1, seed 7, stub-validation shots) printing `done_reason` /
  `reply_source` / lengths / parsed scores — run it before any full judge
  run; it exits 1 with the classified failure instead of failing open.

**Critic mode**: the weakest FEATURE is computed deterministically (lowest
across-view mean of criterion medians); the LLM contributes only the concrete
geometric fix suggestion (deterministic fallback if the call fails). This is
the loop's steering signal.

## Stop conditions (printed by loop-runner, never silently enforced)

- **threshold**: all 9 views >= 8.0/10 (`view_threshold`)
- **stall**: 3 consecutive iterations without improving the best total
- **budget**: 12 iterations

A regression vs best KEEPS the best candidate and marks the iteration
`regressed: true`.

## Commands

```
npm run bench:747:rig -- --plane <plane.js> [--run-id <id>]
npm run bench:747:smoke -- [--shots <dir>] [--view 1] [--seed 7]
npm run bench:747:judge -- --shots benchmark/boeing747/shots/<run-id> [--views 1,2,3]
npm run bench:747:judge -- --critic --results <results.json> --shots <dir>
npm run bench:747:baseline -- [--models gemma4:12b-it-qat]
npm run bench:747:loop -- --plane <iter-k plane.js> [--iter k]
```

All stages are resumable (`--views` chunking, per-view partials, reused
generations/shots), so GPU-contended runs converge across re-invocations.
Local-only per `rules/ci-vs-local-testing.md` — CI runs only the pure
`lib/*.test.mjs` helpers via vitest.

## Reporting rules (FACTUAL language)

Report numbers as measured, with the rubric sha256, judge model, and seed
set. No "beats/wins/outperforms" phrasing. A judge score is an LLM judgment
under a frozen rubric — describe it as such, not as objective realism. If
GPU contention delayed or degraded a run, say so in the result narrative.
Single-shot baselines and loop iterations are different protocols — never
compare them without naming that difference.
