# Boeing 747 Bench — Taught Online Solutions (2026-07-18)

Knowledge pack for TerranSoul taught memory. Distilled from the only publicly passing build (Claude Fable 5 via Claude Code, HF space `victor/fable-5-boeing-747`), its released 31.6 MB agent trace (`victor/fable-5-boeing-747-trace`), the Loop Library #021 protocol (signals.forwardfuture.com), and peer-reviewed VLM-perception research. All numbers are real 747-400 meters unless noted.

**Legend:** `[open-medium-only]` = requires custom indexed BufferGeometry (ring lofts, vertex welding) — NOT achievable with stock Three.js primitive classes. Everything untagged uses stock primitives (Box/Cylinder/Cone/Sphere/Circle/Lathe/Extrude) plus canvas textures, which are always admissible.

**Local artifacts (already downloaded):** de-minified winning source `scratchpad/fable5-plane-pretty.js`, raw bundle `scratchpad/fable747.js`, full trace `scratchpad/trace.jsonl`, narrative `scratchpad/trace-text.txt`.

## Bench protocol and loop discipline

- Lock reference images, scoring rubric, visual threshold, and budget BEFORE building anything — that is step 1 of the canonical loop. https://signals.forwardfuture.com/loop-library/catalog.json
- Build the repeatable multi-angle camera rig before iterating; never move it between iterations or score deltas become meaningless.
- After EVERY change re-render all views, score against references, let the critic name the single weakest feature, fix only that without regressing stronger views, keep the best version.
- Stop only at: all views meet threshold, stalled progress, or budget exhausted — and report stagnation + remaining gaps honestly (verification gate verbatim from the catalog).
- The only public pass (Claude Fable 5, June 2026) converged in just 8 render→inspect→fix iterations (~30 min); iteration count is not the bottleneck, critique quality is. https://x.com/victormustar/status/1990816086065820076
- Follow the winning fix ordering: silhouette/proportions first → junction fairings → per-view details (gear/engines/cockpit) → texture/lighting balance last. https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- There is no hidden scoring trick and no public numeric leaderboard — the entire transferable edge is construction technique + critic playbook. https://explainx.ai/blog/matthew-berman-loop-library-forward-future-ai-agents-2026

## Proportion tables — real 747-400 dimensions (build 1:1 in meters)

- Master fuselage config: length 70.66, radius 3.25, noseLen 9.2, tailStart 47, tailTipR 0.32, tailRise 2.45, humpH 1.62, humpSigma 0.52. https://huggingface.co/spaces/victor/fable-5-boeing-747
- Wing = 5 spanwise stations {z, xLE, chord, thickness, y}: (0, 23.3, 15.4, 0.135, −1.85), (3.2, 23.8, 14.2, 0.13, −1.85), (10.4, 29.2, 9.6, 0.115, −0.97), (20, 36.4, 6.2, 0.095, 0.21), (29.7, 43.7, 3.7, 0.08, 1.4); incidence +2°. Sweep is encoded as rising xLE, dihedral as rising y — the signature yehudi trailing-edge kink emerges automatically from this non-linear table.
- Winglet: height 2.9, cant 68°, chord 3.3→1.35, sweepBack 2.3.
- Horizontal stab stations: (z 0.4, x 59.3, c 7.6, y 1.45) → (z 11, x 67, c 2.5, y 2.75), incidence −1.5°. Fin stations (x-y plane): (y 1.2, x 54.8, c 12.2) → (y 6.2, x 59, c 8.6) → (y 13.6, x 65, c 4.2).
- Engines at z = ±11.7 (inboard) and ±21 (outboard); nacelle center 2.35 below and 2.6 forward of the local wing leading edge; inboard ground clearance ~1 m (matches the real aircraft).
- Gear config: wheelR 0.62, wheelW 0.45, nose gear x 7.4, wing bogies x 34.6 z ±5.65, body bogies x 38.1 z ±1.95, groundY −5.45.
- Door stations x = [8.5, 17.5, 28.5, 44.5, 58.5]; passenger-window pitch 0.56 m from x=6.4 to 65; upper-deck window row only x=9..26 (must match hump extent).
- Hump must end ~1/3 of fuselage length with a visible aft step — wrong hump length is punished harder than any missing detail (canonical-configuration rule, see judge-perception section).

## Fuselage construction — double-bubble loft `[open-medium-only]`

- Build the fuselage as a loft of 120 analytic cross-section rings (96 points each) into one indexed BufferGeometry — never a capsule/cylinder. https://huggingface.co/spaces/victor/fable-5-boeing-747
- loft(sections, {closed, capStart, capEnd, flip}): push ring points with UV=(row/(rows−1), col/cols), quad-strip indices between consecutive rings, center-point fans for caps, computeVertexNormals(), then WELD the seam by averaging normals of first/last column vertices — kills the visible lighting seam.
- Cluster ring spacing toward nose/tail: t<0.5 ? 0.5*(2t)^1.35 : 1−0.5*(2(1−t))^1.35.
- Radius profile: nose (x<9.2) r = R*(1−(1−x/9.2)^2.1)^0.72 (ogive); tail (x>47) r = R−(R−0.32)*((x−47)/(L−47))^1.5; else R.
- Centerline offsets: nose droop y −= 0.72*(1−x/9.2)^1.8; tail upsweep y += 2.45*((x−47)/(L−47))^1.7.
- Cross-section must be a TRUE double-bubble, not a circle with a bump: ray-union of the main circle with an upper-deck lobe rU = 1.95*(r/R) at an offset center, blended by smooth-max with k=0.06 so a visible crease forms. Trace critique verbatim: "Cross-section was an egg, not a 747 — replaced a Gaussian bump with a true double-bubble". https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- Hump longitudinal weight = smoothstep(0.6, 4.8, x) − smoothstep(22.8, 31.8, x) — this produces the hump's aft step, a first-class judge cue.
- Width factor 0.86→1.0 over the first 12 m so the nose is slightly slab-sided.
- Mirror helper for all symmetric parts: clone geometry, negate all z, swap i1↔i2 per triangle (fix winding), recompute normals.
- Primitive-only fallback: a stock capsule cannot express the aft step — approximate the hump with an overlapping half-cylinder + fairing and accept a lower realism ceiling on side/three-quarter views.

## Flying surfaces — NACA airfoil station lofts `[open-medium-only]`

- One generic station-table loft function serves wing, horizontal stab, fin, and winglets — sweep, taper, dihedral, and the yehudi kink all emerge from the tables (see proportion section). https://huggingface.co/spaces/victor/fable-5-boeing-747
- NACA 4-digit thickness (6 lines of code): yt(x) = 5t(0.2969√x − 0.126x − 0.3516x² + 0.2843x³ − 0.1036x⁴); camber yc = 0.015·4x(1−x); upper = yc+yt/2, lower = yc−yt/2; 26 cosine-spaced points per surface.
- Scale each section by chord, rotate about the quarter-chord point (x−0.25)*chord by incidence (+2° wing, −1.5° hstab), position at {xLE + 0.25·chord, station y, station z}, loft station-to-station with closed caps.
- Winglet = 3-station loft canted 68°: z = h·cos(cant), y = h·sin(cant), chord taper 3.3→1.35.
- Fin = 3-station loft in the x-y plane; hstab mirrored with the z-mirror helper (fix index winding after mirroring).
- README-confirmed judge cues: yehudi trailing-edge kink and 7° dihedral are signature features. https://huggingface.co/spaces/victor/fable-5-boeing-747/raw/main/README.md
- Anti-pattern boundary (what LOW scorers do): flattened boxes + MeshPhongMaterial + FlatShading + saturated toy colors (Codrops Aviator style). Keep its part-encapsulation/taper idea, drop everything else. https://tympanus.net/codrops/2016/04/26/the-aviator-animating-basic-3d-scene-threejs/

## Engine nacelles + pylons (stock primitives: Lathe/Cylinder/Circle/Cone/Extrude)

- Cowl = LatheGeometry of a 7-point profile (x-axial, r): (0, 1.10), (0.18, 1.286), (0.70, 1.34), (2.4, 1.327), (3.2, 1.152), (4.0, 0.804), (4.8, 0.563) with 56 segments, rotated to face forward — gives intake lip, max-diameter bulge, and boat-tail in one revolve. https://huggingface.co/spaces/victor/fable-5-boeing-747
- Interior sub-parts (5): open-ended CylinderGeometry(1.089, 1.023, 1.45, 40) dark intake duct at x 0.78; CircleGeometry(1.034) fan disc at x 1.45; ConeGeometry(0.24, 0.6) spinner at x 1.12; rear CircleGeometry(0.549) dark closing disc; Cylinder(0.563, 0.429, 0.85) + Cone(0.295, 1.1) exhaust plug at x len+1.
- Always close the nacelle back with dark geometry — trace bug verbatim: "from dead astern the engine backs read as white circles" until the dark rear disc + larger nozzle were added. https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- Pylon = ExtrudeGeometry of a 4-point Shape from cowl top to wing LE, depth 0.55, bevelSize/Thickness 0.06, shaped to ride ON the cowl — inspect the intake-mouth close-up: the pylon plate must never protrude into the mouth (trace-documented bug).
- Position each engine at x = wingLE(z) − 2.6, y = wingY(z) − 2.35; verify ~1 m inboard ground clearance in the low-front view.
- Exactly 4 underslung engines — engine count and placement are canonical-configuration cues with outsized judge weight.

## Junction fairings — hide seams by overlap, never booleans

- Wing-root fairing `[open-medium-only]`: loft 27 elliptical rings over x=22..44 with half-width 3.18 + 1.0·b and half-height 2.2 + 0.55·b where b = sin(π·u^0.9)^1.1, centered 1.05 m BELOW the fuselage centerline — it swallows the wing/fuselage intersection. https://huggingface.co/spaces/victor/fable-5-boeing-747
- Keep the fairing belly-only: trace fix verbatim — "wing-body fairing wrapped the whole hull hiding the hump's aft step — rebuilt as a belly-only blister" (x=22→44 only). https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- Flap-track canoe fairings (stock Lathe), 4 per wing at z = ±6.8/10.6/15.4/20.6: r(w) = max(0.001, B·sin(πw)^0.75) with B = 0.34 − 0.004·z, length 4.4 − 0.075·z, placed at trailingEdge − 0.55·len, y − 0.32, yawed 0.04 rad outboard.
- Fin root fillet (stock Extrude): triangle (51.5, 3) − (58.8, 2.8) − (58.8, 5.5), depth 0.42, bevel 0.05, TUCKED under the fin leading edge — the trace's tail close-up caught a sky gap ("floating dorsal fillet") until it was tucked.
- APU tailcone: Cone(0.34, 1.1) at x = length + 0.35 (~x 71) closes the upswept tail.
- All fairings simply OVERLAP the parts they join — no CSG/boolean operations anywhere in the winning build.

## Landing gear + silhouette extras (stock primitives)

- Model the signature 5-post layout: nose gear + 2 wing trucks + 2 body trucks, four 4-wheel bogies — a canonical 747 cue judges check. https://huggingface.co/spaces/victor/fable-5-boeing-747
- Wheel pair = CylinderGeometry(0.62, 0.62, 0.45, 28) rotated x by π/2 at z = ±0.42 (nose) / ±0.52 (main); hub Cylinder(0.248, r·0.4) + axle Cylinder(0.12).
- Bogie = two wheel-pairs at x = ±0.725 + beam Box(2.05, 0.34, 0.36) at y = 0.3·wheelR; struts = vertical Cylinders r 0.17–0.19 from axle height to the belly.
- Offset the whole model group position.set(−length/2, −groundY, 0) with groundY = −5.45 so tires rest exactly on y=0 — floating or sunken wheels destroy the ground shots.
- Add the small silhouette finishers: red beacon Sphere(0.09) with emissive 0x550000 on the hump spine at x 14, antenna Boxes at x 20.5 and 42.

## Livery, windows, cockpit — one procedural canvas texture (no geometry)

- Paint windows/doors/cockpit/cheatline/titles/panel lines on a single 4096×2048 canvas mapped so canvas-x = meters/70.66; set texture.flipY = false, anisotropy 8, sRGB colorSpace. https://huggingface.co/spaces/victor/fable-5-boeing-747
- Base coat: off-white crown #f4f6f8 blending to light-gray belly #b9bfc7 via vertical gradient with blend bands at 34% and 66% of texture height; secondary panel grays #d8dadd / #d6dade / #aeb3bb.
- Windows = dark rounded rects #1c2430, 0.26 m wide × 0.0175·H tall (corner r 0.45·h), pitch 0.56 m from x=6.4 to 65, SKIPPING ±0.95 m around the 5 door stations [8.5, 17.5, 28.5, 44.5, 58.5]; main row at V = 0.197 (mirror as 1−V for the far side), upper-deck row x=9..26 at V = 0.098.
- Doors = 1.1 m stroked rounded-rect outlines, each with its own small window.
- Cockpit = filled dark polygon #0d131c over x=3..6.1 with a raked leading edge + 3 light-gray mullion strokes at 0.38/0.62/0.82 of its width (the raked 3-pane windscreen is a checklist item).
- Cheatline: #16307a stripe 0.012 tall + #b01f2e accent 0.004 just below the window line; "B O E I N G  7 4 7" bold text at x 10.2.
- Far-side titles need a 180° canvas rotation (or ctx.scale(−1,1)) — NOT a plain mirror; the trace hit both the upside-down-livery (flipY vs UV convention) and mirrored-title bug classes. https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- Panel seams: vertical lines every 3.2 m at rgba(120,128,138,0.16) + 6 faint horizontal stringers at alpha 0.10.
- Wing skin texture `[open-medium-only detail]`: compensate loft UV non-uniformity with v = acos(2f−1)/π·0.5 so painted spar/rib lines land correctly.
- Debug the texture pipeline directly: dump the canvas to PNG to compare drawn-vs-rendered, and use the paint-it-red flood test to prove a texture renders at all.

## Materials + colors (MeshStandardMaterial, exact hex values)

- Painted airliner skin is NOT metal — fuselage roughness 0.32 / metalness 0.08; never use "aluminum = metalness 1.0" (renders dark/alien without a strong env map and is wrong for painted 747s). https://huggingface.co/spaces/victor/fable-5-boeing-747
- Full winning material table {roughness, metalness}: wing #BCC1C9 {0.45, 0.2}; belly #B4BAC2 {0.42, 0.14}; fin base #1B3A8C {0.35, 0.1}; nacelle cowl #D6D9DD {0.3, 0.25, DoubleSide}; intake interior #23262B {0.6, 0.4, DoubleSide}; fan disc #14161A {0.45, 0.7}; exhaust darkMetal #5D6166 {0.38, 0.85}; tires #17181A {0.95, 0.0}; hubs #787D83 {0.5, 0.6}; struts #C6C9CD {0.35, 0.7}.
- Use real Boeing paint hexes to land in the reference-photo color distribution: FS 16515 "Boeing Gray" #BEC1BE for wings/belly fairing/nacelles; Boeing livery blue #0039A6 or "True Blue" #1A409F. https://hextoral.com/hex-color/bec1be/ams-std-595a/ https://www.schemecolor.com/boeing-blue-color.php
- Fuselage white must be off-white (#F4F6F8-class), never pure #FFFFFF — pure white clips under ACES tone mapping and reads as CG.
- Tail/engine accent = horizontal gradient #16307c → #2c55c4.
- Beacon material: #B01F2E with emissive 0x550000.

## Lighting, tone mapping, ground, atmosphere (render-quality factors)

- Use the three.js Sky addon (examples/jsm, scale 450000; shader only — no custom geometry): sun elevation 32°, azimuth 145°, turbidity 6, rayleigh 1.6, mieCoefficient 0.004, mieDirectionalG 0.85. https://huggingface.co/spaces/victor/fable-5-boeing-747/raw/main/index-xmspvjfq.js
- Generate the environment FROM that sky: scene.environment = PMREMGenerator(renderer).fromScene(skyOnlyScene, 0.04).texture with scene.environmentIntensity = 0.45 — physically-plausible ambient color that reads as real-photo lighting.
- Balance env against exposure: trace iteration-4 fix verbatim — "sky-based PMREM environment was overexposing into the ACES shoulder; rebalanced env intensity/exposure". Tone-mapping interaction is a first-class realism lever. https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- Key light: DirectionalLight(0xFFF2E0, 2.2) at sunDir·220, castShadow, shadow.mapSize 4096², ortho frustum ±85 (near 50, far 500), bias −0.0004, normalBias 0.06. Fill: HemisphereLight(0xBDD5F0, 0x4D5258, 0.55).
- Renderer: antialias true, setPixelRatio(devicePixelRatio), shadowMap.type = PCFSoftShadowMap, toneMapping = ACESFilmicToneMapping, toneMappingExposure 0.62 (deliberately LOW so the white fuselage never clips — clipped whites are a strong CG tell).
- Ground the aircraft: CircleGeometry(900, 64) with a 1024px procedural tarmac canvas — base #6e7073, 26,000 speckles (gray 90–135, alpha 0.16–0.36, 1.6px), expansion-joint grid rgba(40,42,45,0.5) every 128px, yellow centerline rgba(228,196,60,0.85) 10px — repeat 14×14, roughness 0.96, metalness 0, receiveShadow.
- Add atmospheric depth: scene.fog = Fog(0xC7D4E2, 350, 1400).
- Grounding + soft contact shadows + atmospheric depth are the three cheapest photo-realism signals when compared against airport reference photos.
- For stills, supersample: render at 2–4× target resolution and downscale — cleaner edges than MSAA alone. https://discourse.threejs.org/t/downsampling-antialiasing-via-css/8751

## Camera rig + headless screenshot plumbing

- Bake 12 named presets {pos → target, fov}: hero [−52,9,42]→[0,7,0] 40; front [−75,6.5,0]→[0,7,0] 35; rear [78,9,0]→[0,9,0] 35; side [0,8,78]→[0,8.5,0] 42; threeq_rear [50,12,48]→[0,7,0] 42; top [0,125,0.1]→[0,0,0] 45; low_front [−48,2.2,26]→[0,6,0] 42; nose [−52,8,20]→[−24,7.5,0] 35; engines [−26,3,26]→[−4,3,12] 40; gear [−10,1.4,9]→[3,1.4,0] 50; tail [48,9,22]→[30,11,0] 40; wing_top [8,32,34]→[0,2,14] 45. https://huggingface.co/spaces/victor/fable-5-boeing-747
- PerspectiveCamera near 0.1, far 5000; expose window.setCam(name) + window.listCams() + a ?cam= URL param for headless driving.
- Set window.__ready = true INSIDE the animation loop so the screenshotter only captures valid rendered frames.
- Include the dedicated close-ups (engines, gear, tail, nose, wing_top) — they force detail work the hero view hides, and they are where interpenetration/gap bugs are caught.
- Recenter the model with group.position.set(−length/2, −groundY, 0) so the origin is mid-fuselage at ground level and all presets frame correctly.

## Critic playbook — community-proven debug tactics (from the winning trace)

- Paint-it-red test: flood a texture with solid red to prove whether it renders at all — this diagnosed an inverted wing-loft winding where top-surface triangles were backface-culled ("I was seeing the interior of the bottom skin"). https://huggingface.co/datasets/victor/fable-5-boeing-747-trace
- Dump the canvas texture itself to a PNG and diff what is drawn vs what renders — separates texture-authoring bugs from mapping bugs.
- Sweep every close-up view for interpenetration (pylon poking through the intake mouth) and gaps (sky visible between dorsal fillet and fin LE).
- Grep-able bug classes to check proactively: CanvasTexture flipY vs UV convention (upside-down livery), mirrored-vs-rotated far-side titles, index winding after any z-mirror clone.
- Verify the signature-feature checklist per view (the de-facto pass rubric, verbatim): "the hump with its aft step, raked 3-pane windscreen on the upper deck, yehudi trailing-edge kink, 4 underslung engines with tight inboard ground clearance (~1 m), 5-bogie gear layout, upswept tail cone, and the dorsal-filleted fin".
- Then verify the pass/near-miss separators: real ~0.55–0.56 m window pitch, 4 flap-track canoes per wing, 68° winglets, antennas + emissive red beacon, dark exhaust closures, APU tailcone, 4-wheel bogies.
- Per-view canonical-cue audit: front must show 4 intake circles + hump bump; side must show hump-then-flat fuselage line + cheatline + tail; top must show wing sweep/taper + engine pods; low-front must show gear + nacelle undersides. Fix the view whose cues are weakest.

## Visual-realism priorities — how vision judges perceive renders (paper-grounded, judge-agnostic)

- Fix canonical configuration BEFORE detail: VLMs judge against memorized canonical appearance (~75% prior-driven on counterfactuals; accuracy collapses 100%→2–26% when a familiar object deviates from canonical form). Hump ending ~1/3 of length, exactly 4 underslung engines, visible sweep + dihedral, tall single tail. Delete wrong details rather than refine them — a wrong feature costs more than its detail earns. https://arxiv.org/html/2505.23941v1
- Silhouette carries more signal than surface texture (VLMs are shape-biased, ICLR 2025): verify each view as a near-binary silhouette check (dark object vs bright sky) before spending iterations on texture; keep fuselage value far from sky/ground values so the outline never melts. https://arxiv.org/html/2403.09193v1
- The background is load-bearing: a physically-plausible sky + tarmac + markings actively raises realism reads (background alone can flip model decisions up to 87.5%); keep it plausible but sparse — sky, tarmac disc, centerline, nothing else. https://arxiv.org/pdf/2006.09994
- Only thumbnail-visible changes move scores (judge scores cluster in a narrow band): triage candidate fixes by pixel footprint across the rig views and do the largest-area weakest feature first; sub-0.5%-of-frame details (rivets, tiny antennas) are invisible work. https://arxiv.org/pdf/2604.17768
- Verify legibility by self-downscaling: shrink your own render to ~900 px square and check what survives — features narrower than ~0.3% of frame width vanish; that is why window ROWS/bands at 1.5–2% of fuselage height work and individual tiny windows do not. Render near-square so aspect-ratio cropping never slices the aircraft. https://arxiv.org/pdf/2503.19786
- Recognition is viewpoint-fragile (success can drop 65%→6% from a 15° camera change): every rig view must independently present canonical cues — never rely on the hero view alone, and never reposition the rig mid-run. https://arxiv.org/pdf/2402.03973
