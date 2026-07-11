# boeing747-open — relaxed-contract variant design

> **Authorship note:** designed 2026-07-11 by the Fable 5 session per the
> owner decisions recorded in `rules/milestones.md` ("2026-07-11 OWNER
> DECISIONS" item 4b) and the "design first on Fable 5" directive. This is
> the authoritative design; the frozen primitives track and its records
> (71.66 Fable-5 / 73.68 Opus 4.8) are UNTOUCHED by everything below.

## 1. What it is

A SEPARATE benchmark track answering "how close to the all-views ≥ 8.0
threshold (the '100%' bar) can a self-improving agent get when the
*modeling medium* is unconstrained?" — while the original track keeps
answering "how good can pure primitives get?" The two tracks share the
measurement machinery and differ ONLY in the candidate contract.

## 2. Contract (the ONLY delta from the frozen track)

New `lib/contract-open.mjs` (the frozen `lib/contract.mjs` is
sha256-stamped and must not change):

**Allowed:** everything the frozen contract allows PLUS
`BufferGeometry` construction, `THREE.Shape`/`ExtrudeGeometry` freeform,
procedural textures via `DataTexture`/`CanvasTexture` (generated
in-code), vertex colors, normal/bump maps generated in-code,
`LatheGeometry` with arbitrary profiles, groups/instancing.

**Still forbidden (unchanged rationale — determinism + no-asset-smuggling):**
- Network/filesystem access of any kind (`fetch`, `XMLHttpRequest`,
  `import()` of remote modules, data-URI decoding of pre-baked binary
  assets longer than 1 KB — the anti-smuggling line: textures must be
  COMPUTED, not embedded).
- External model/texture FILES and loaders reading them (`GLTFLoader`
  etc. stay banned — the agent must BUILD, not download).
- DOM/window access, nondeterminism (`Math.random` without a seeded PRNG
  provided by the harness shim, `Date.now`).
- The same export signature: `export function buildPlane(THREE)`.

The essence: **open the geometry/material medium, keep the
closed-world determinism.** "Meshes/textures allowed" per the owner
decision = arbitrary computed meshes and computed textures, not asset
imports (an asset-import variant would benchmark searching, not
modeling; record here that if the owner wants a third
"anything-goes-assets" tier later it is a separate contract again).

## 3. Measurement machinery — shared, byte-identical

- Same 9 cameras (`lib/cameras.mjs` v2), same rig (`rig/render-rig.mjs`
  3× SSAA), same frozen rubric (`rubric.json` v2) and scoring
  (`lib/scoring.mjs` view-visibility mask), same judges (gemma4:12b
  median-of-3 primary; actor-family vision judge secondary), same stop
  conditions (threshold all-9 ≥ 8.0 / stall 3 / budget 12), same
  retry/self-learning harness (`loop-runner-terransoul.mjs` — add a
  `--contract open` flag that swaps ONLY the contract validator and the
  actor-prompt contract text; default remains frozen).
- Results namespace: `candidates/terransoul-fable5-open/`,
  `results/terransoul-fable5-open*/`. `BOEING-COMPARISON.md` gets a new
  clearly-separated section; open-track numbers are NEVER placed in the
  primitives table (different benchmark, per the file's own "read down
  columns" discipline).

## 4. Actor protocol

Identical loop (render → judge → weakest-feature critic → one targeted
fix), actor = `claude-fable-5 --effort max` through
`terransoul-cli --agent-task`. Seed candidate: START from the frozen
track's 71.66 geometry (a strong primitive scaffold the agent may then
re-mesh/texture freely) — this measures the VALUE ADDED by the opened
medium over the same starting point. The actor prompt must state the
open contract explicitly (computed textures allowed, assets banned) and
include the anti-smuggling rule verbatim.

## 5. Acceptance & honesty rules

- Never-regress applies per-track: the open track sets its OWN floor on
  its first completed run; it cannot touch the primitives floors.
- The "100%" claim requires the frozen threshold stop
  (`all 9 views ≥ 8.0`) on the gemma4 track — a budget/stall stop
  publishes the best score with the stop reason, exactly like the
  primitives track's honesty conventions.
- Contract-open validation tests mirror the frozen contract's test
  suite (allowed-constructs pass; each banned construct rejected;
  the 1 KB data-URI anti-smuggling line tested at 1023/1024/1025).
- Factual language everywhere.

## 6. Implementation checklist (executor)

1. `lib/contract-open.mjs` + `lib/contract-open.test.mjs` (mirror the
   frozen suite's conventions; register in vitest include if needed).
2. `loop-runner-terransoul.mjs`: `--contract open|frozen` (default
   frozen; open swaps validator + prompt text; frozen path byte-safe —
   the frozen artifacts' sha256 stamps must remain untouched).
3. Actor prompt block for the open contract (contract text + smuggling
   ban + "computed, not embedded" phrasing).
4. Seed `candidates/terransoul-fable5-open/plane.js` from the 71.66
   geometry (`candidates/terransoul-fable5-v2/plane.js`, sha
   `3e4bbd2e…` — verify against `results/terransoul-fable5-v2/best.json`
   before seeding).
5. Run (bench slot discipline: after the r3 frozen re-verify finishes),
   publish per §3/§5.
