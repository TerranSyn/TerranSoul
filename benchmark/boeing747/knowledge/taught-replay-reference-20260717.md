# 747-Class Widebody — Primitives-Only Construction Reference (replay distillation, 2026-07-17)

Conventions (repeated context for every section; each H2 below is self-contained for retrieval):

- Axes: nose points **+X**, up is **+Y**, sides are **±Z**. Fuselage length **L**, fuselage radius **R**, diameter **D = 2R**. Worked numbers assume **L = 60, R = 3** (nose tip at x = +30, tail at x = −30).
- Allowed geometry: stock `BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, `CapsuleGeometry`, `ConeGeometry`, `TorusGeometry`, composed ONLY with position / rotation / scale / groups / matrix-basis transforms. Anything marked **open-medium only** must NOT be attempted under the primitives contract.
- Edit discipline (applies everywhere): re-read the file immediately before every `edit_file` and copy the exact current text for `old_string`; make ONE bounded change per pass; spell `THREE` correctly (a `THEREO.Mesh` typo has burned a full pass before); NEVER reference `window`, `document`, or any DOM/browser global inside `buildPlane` — a single forbidden token discards the whole edit no matter how good the geometry is.
- Attachment rule (applies everywhere): every part must overlap its parent by a positive buried margin (≥ 0.2 units). Compute the two touching coordinates and state both numbers in the edit note, e.g. "pylon top y = −1.10 vs wing underside y = −1.35 at that station → buried 0.25".

## Wing geometry

**Hard numbers (public 747-400 knowledge):**
- Total span ≈ 0.91 L tip-to-tip; each panel root→tip ≈ 0.44 L (L=60: ≈ 27 outward from the hull side).
- Leading-edge sweep ≈ 37.5° toward the tail. Dihedral ≈ 7° (tips higher than roots).
- Root chord ≈ 0.23 L (L=60: ≈ 14); tip chord ≈ 0.06 L (≈ 3.5); taper ratio ≈ 0.25.
- Thickness ≈ 0.10–0.12 × local chord (root ≈ 1.4 thick, tip ≈ 0.4).
- Mounted LOW on the body: root underside near y ≈ −0.7 R. Root leading edge slightly forward of mid-body (L=60: root chord spans roughly x = +4 back to x = −10).

**Recipe A — 3-segment tapered box chain (simplest composition that reads as a wing):**
1. Per side, build 3 Boxes with span along Z and chord along X, decreasing in size: root `Box(12, 1.2, 9.5)`, mid `Box(8, 0.8, 9.5)`, tip `Box(4.5, 0.45, 9.5)` (L=60 numbers).
2. Sweep: rotate the side (group or each segment) about **Y** — NOT Z — by ≈ 37°, with mirrored sign per side. Verify in a top-down render that BOTH tips point toward the tail; if a tip points toward the nose, flip that side's sign.
3. Dihedral: rotate ≈ 7° about X (mirrored sign per side) so tips ride higher than roots; verify in a front render.
4. Chain: start each next segment ~0.7 units INSIDE the previous segment's tip (overlapping), positioned at the previous tip's swept X and raised Y — zero gaps between segments.
5. Bury the root: the root segment's inner end sits inside the hull (|z| ≤ R − 0.5), never flush against the skin.

**Recipe B — single-primitive tapered panel (advanced; still primitives-legal):**
- One `CylinderGeometry(tipChord/2, rootChord/2, panelSpan, 4, 1)` per panel: 4 radial segments give a diamond cross-section; the radius taper carries BOTH chord and thickness root→tip in one primitive. Scale the thickness axis to ≈ 0.12 × chord. Orient the local length axis along the root→tip span direction — either plain rotations or `mesh.matrix.makeBasis(chordDir, spanDir, thickDir).setPosition(midpoint)` with `matrixAutoUpdate = false`. One shared helper built this way can produce both wings, the vertical fin, and both tailplanes.

**Worked contrast (from real edit history):**
- BEFORE: one flat `BoxGeometry(1, 0.8, 36)`, swept with `rotation.z` — the side view looks plausible, but top-down the outline stays a straight rectangular slab. Dozens of angle-only retunes of that same shape changed nothing that mattered.
- AFTER: the identical panel swept with `rotation.y` (the correct axis for a Z-span panel), roots re-seated outward from the centerline, and engines re-derived under the new panel in the same pass — the top-down outline snapped into a swept jet planform. That one-line axis correction accomplished more than every prior angle retune combined.
- Taper contrast: a constant-cross-section box reads as a plank from every angle; a 3-segment chain (or a diamond-frustum panel) whose chord AND thickness shrink root→tip reads as a wing.

**Self-check (all YES before finishing):** both tips point toward the tail in top-down? tips higher than roots in front view? tip chord visibly narrower than root chord? root buried inside the hull? engines re-derived from the wing formulas (see Engines section) after any wing move?

**DO NOT:**
- Do not sweep a Z-span wing with `rotation.z` — it rolls the plank; the top-down outline stays rectangular. One long run burned most of its budget on this before trying `rotation.y`.
- Do not re-tune sweep/dihedral numbers a third time on the same untapered box after two failed attempts — change the composition (add taper segments), then refine once.
- Do not shrink a wing part's face-on width during a "precision" pass without re-checking a render; slimming re-creates edge-on invisibility.
- **Open-medium only:** `Shape` + `ExtrudeGeometry` planforms — do not attempt under the primitives contract. (Even in an open medium: the pinned three r175 build emits wall-only, cap-less extrudes — a 10-line Node repro counting triangles showed a unit-square extrude produced 0 cap faces. Verify triangle counts before trusting it.)

## Engines + pylons

**Hard numbers:**
- Exactly FOUR nacelles, two per side, slung UNDER the wing: inboard at ≈ 40% of the panel span, outboard at ≈ 69% (L=60 with ≈27 panel: s ≈ 11 and s ≈ 19 out from the root).
- Nacelle diameter ≈ 0.37 D (L=60: ≈ 2.2); nacelle length ≈ 0.065 L (≈ 4).
- Nacelle axis sits ≈ 0.6 nacelle-diameters BELOW the local wing underside; the inlet face sits AHEAD of the local wing leading edge.
- The pylon connects the nacelle's top-rear to the wing underside, pitched slightly nose-down.

**Recipe:**
1. Define the wing's own placement formulas ONCE and derive every engine from them — never hardcode per-engine coordinates:
   `wingLEx(s) = rootLEx − tan(sweep) * s` and `wingUnderY(s) = rootUnderY + tan(dihedral) * s`, where `s` = span distance from the root.
2. Loop sides × stations `s ∈ {0.40, 0.69} × panelSpan`; per engine compute `le = wingLEx(s)`, `under = wingUnderY(s)`, `z = ±(rootZ + s)` once and position ALL of that engine's meshes from those three values.
3. Nacelle kit per engine (all cylinders rotated so their axis runs along X), centered at x ≈ le + 1.0 (inlet ahead of the leading edge), y ≈ under − 1.3:
   - Cowl: `CylinderGeometry(1.1, 1.1, 3.4, 24, 1, true)` (openEnded) in a LIGHT cowl material.
   - Inlet: a dark disc `CylinderGeometry(1.0, 1.0, 0.3, 24)` recessed ~0.3 inside the cowl mouth.
   - Spinner: small sphere or cone at the inlet center.
   - Exhaust: tapered `CylinderGeometry(0.5, 0.8, 1.2, 16)` at the rear, darker metal.
4. Pylon: a Box wedge ≈ `(3.2, 1.6, 0.7)` from the cowl top into the wing underside, pitched ~16° nose-down, in the SAME LIGHT material as the cowl (not the dark inlet material). Its top must end ≥ 0.2 ABOVE `wingUnderY(s)` (buried in the wing); its bottom buried into the cowl.
5. Verify numerically, and state the numbers: pylon-top y vs wing-underside y (positive overlap), nacelle-bottom y vs hull-belly y at that x (nacelle visibly below and clear of the belly line).

**Worked contrast (from real edit history):**
- BEFORE: `engineX = (idx===0) ? (side*4-3) : (side*2-6); // Approximate positions` — hardcoded guesses decoupled from the wing. The nacelles floated off the wing and were re-flagged as detached again and again across a whole run, no matter how they were nudged.
- AFTER (strongest surviving build): all four engines placed from ONE loop calling `wingLEx`/`wingUnderY` at the two stations; the edit note read "inboard nacelle bottom is now y=−4.33 and the outboard y=−3.38 — both staggered engines per side now visibly clear the belly line". The parts finally read as mounted.
- Pylon visibility contrast: a 0.45-thin dark pylon against a dark wing is an invisible edge-on sliver from every camera; a 3.6 × 1.8 × 0.7 wedge in the light cowl material pitched 16° nose-down reads as a real mount.

**Self-check (all YES):** four nacelles, mirrored two per side? every engine position derived from `wingLEx`/`wingUnderY`, zero magic numbers? inlet ahead of the leading edge? pylon buried into BOTH cowl and wing with stated overlap numbers? cowl/pylon in light material, inlet dark? top-down and front renders re-checked after the move (not just the side view)?

**DO NOT:**
- Do not hardcode engine coordinates as magic-number ternaries — that pattern never converged in any run.
- Do not paint pylons/nacelles with the same dark material used for inlets, windows, or tires.
- Do not fix a "floating engine" with small one-axis nudges — recompute from the wing formulas.
- Do not slim or re-stagger an already-visible engine/pylon group for "physical correctness" without re-rendering; a confident retune of a good group has caused regressions more than once.
- After ANY engine/pylon/root reposition, check the top-down and front renders — X/Z nudges that look fine in profile can wreck the planform outline in exactly those views.

## Fuselage proportions

**Hard numbers:**
- Slenderness L/D ≈ 10.5 (747: 70.7 m long, 6.5 m diameter) — a long slender tube, not a sausage.
- Nose taper occupies the front ≈ 0.12 L, ending in a rounded cap with a slight downward droop.
- Tail cone occupies the rear ≈ 0.20 L, tapering AND sweeping up so the tail tip sits ≈ 0.3–0.5 R above the centerline.
- Constant radius in between.

**Recipe (L=60, R=3; nose tip +30, tail −30):**
1. Mid tube: `CylinderGeometry(3, 3, 41, 24)` axis along X, spanning x ≈ +23 … −18.
2. Nose: a frustum from R down to 0.4R over length 7 (`CylinderGeometry` with the small end toward +X), spanning +23 … +30; add a `SphereGeometry(1.3)` cap at the tip, center dropped ≈ 0.3 for the droop.
3. Tail cone: a frustum from R down to 0.22R over length 12, small end aft, spanning −18 … −30; tilt ≈ 5° about Z (or raise the aft end ≈ +1.2) so the taper reads upswept; small sphere cap at the tip.
4. Overlap each frustum 0.5 into the mid tube; reuse the tube's material so the joints vanish.
5. Any flush-mounted detail (windows, cheatline) must compute its offset from the LOCAL radius: `zSurf(y) = sqrt(R*R − y*y)` — so panes still touch the skin through the tapered zones.

**Worked contrast (from real edit history):**
- BEFORE: a single `CylinderGeometry(3, 3, 60, 24)` — the body reads as a pipe with flat ends from every camera. One entire run left this untouched for all 68 passes while editing everything else; the body never stopped reading as a pipe.
- AFTER: strong builds use 4–5 primitives (constant tube + tapered nose frustum + nose cap sphere + upswept tail frustum + tail cap). On a pipe-bodied craft this is the cheapest, most outline-visible single upgrade available.

**Self-check (all YES):** body narrows at BOTH ends? tail tip above the centerline? overall L/D still ≈ 10 (not fattened)? frustums overlap the tube by ≥ 0.5? flush details still touch the skin at the tapers?

**DO NOT:**
- Do not ship a constant-radius cylinder as the whole fuselage.
- Do not create taper by non-uniformly scaling the entire tube — it squashes the mid-body.
- Do not hardcode window/door z offsets that only coincidentally match the mid-body radius — they float the moment a taper is added; use `zSurf(y)`.
- **Open-medium only:** `LatheGeometry` ogive nose profiles — do not attempt under the primitives contract.

## Upper-deck hump

**Hard numbers:**
- The hump starts just behind the nose taper and runs back to ≈ 0.30–0.35 L from the nose (L=60: roughly x = +24 back to x = +6).
- Height above the main crown ≈ 0.23–0.3 D (L=60: ≈ 1.4–1.8); width ≈ 0.6–0.7 D.
- The front of the hump is the cockpit region (dark windshield band).

**Recipe:**
1. Use ONE smoothly-rounded primitive — `CapsuleGeometry` laid along X, or a `SphereGeometry(1, 24, 16)` with `scale.set(halfLength, height, halfWidth)` — e.g. capsule `CapsuleGeometry(2.0, 8, 8, 24)` stretched lengthwise with `scale.set(1, 1.54, 1)` then rotated to lie along X, or sphere scaled ≈ `(9, 1.6, 2.0)`.
2. Sink it: center y ≈ +0.75 R (≈ +2.2) so the lower HALF is buried inside the crown — the rounded ends then fair into the tube with no seam.
3. Center around x ≈ +15 so the hump spans ≈ +24 … +6.
4. Add a short dark "cockpit band" (concentric short cylinder or a slim curved box) near the hump's front.
5. Optional: a second, shorter window row on the hump flanks.

**Worked contrast (from real edit history):**
- BEFORE: a two-radius `CylinderGeometry(4.5, 3.2, 22)` frustum telescoped onto the crown — the flat conical wall between the differing end radii reads as a hard seam / blunt tube. Position-only nudges never fixed it across an entire run, because the geometry TYPE was the problem.
- AFTER: one capsule stretched lengthwise and half-buried in the crown — its own rounded end-caps fair gently into the tube. In an earlier build this single swap replaced a "floating visor block" that had been the weakest thing on the craft.

**Self-check (all YES):** single rounded primitive (capsule/scaled sphere), not a frustum or box stack? lower half buried in the crown? spans the front third of the body only? dark cockpit band present at its front?

**DO NOT:**
- Do not build the hump from a cylinder frustum (conical seam) or stacked boxes (hard edges).
- Do not perch it on top of the crown — bury the lower half.
- Do not keep repositioning a wrong-type hump primitive; swap the geometry type once instead.

## Empennage (vertical fin + horizontal stabilizers)

**Hard numbers:**
- Vertical fin height above the fuselage ≈ 1.4–1.6 D (L=60: ≈ 8.5–9.5 above the crown); leading-edge sweep ≈ 45°; root chord ≈ 0.15 L (≈ 9) tapering to ≈ 0.05 L (≈ 3).
- TWO horizontal stabilizers — a miniature swept wing pair: total span ≈ 0.31 L (semi-span ≈ 9 per side), sweep ≈ 38°, slight dihedral ≈ 6°, chord ≈ 4.5 root → 1.5 tip.
- All three surfaces mount over the last ≈ 0.15 L of the body (L=60: around x = −22 … −30), on the tail cone.

**Recipe:**
1. Reuse the SAME tapered-panel recipe as the wing (3-segment box chain, or the diamond-frustum panel `CylinderGeometry(tipChord/2, rootChord/2, span, 4, 1)`) at smaller scale — one shared helper for all five lifting surfaces is the ideal structure.
2. Fin: root buried ≥ 0.5 into the tail-cone crown at x ≈ −24, panel rising along +Y, leaned back ≈ 45° (rotate about Z so the tip is aft of the root); chord 9 → 3 over height ≈ 8.5.
3. Stabilizers: a mirrored ±Z pair, roots buried into the tail-cone sides near centerline height, semi-span ≈ 9, swept back ≈ 38° (rotate about Y, mirrored signs — same axis rule as the wing), dihedral ≈ 6°.
4. Verify: the side render shows the fin leaning back (not a vertical rectangle); the top-down render shows two small swept triangles at the tail.

**Worked contrast (from real edit history):**
- BEFORE: a single `BoxGeometry(6, 12, 0.6)` vertical slab as the entire tail — it reads as a flat fence board, and the craft has NO horizontal tail at all. One long run shipped exactly this, untouched, for its whole duration.
- AFTER: fin + two tailplanes all emitted by one shared tapered-panel helper with roots buried in the crown/centerline — the tail finally reads as an aircraft tail from both side and top-down.
- The missing-part rule: a class-defining part that is absent costs more than any polish elsewhere can recover; the stabilizer pair is the most commonly forgotten part on this craft.

**Self-check (all YES):** fin swept back ≈ 45°, tapered, root buried in the crown? BOTH horizontal stabilizers present, mirrored, swept ≈ 38°? all roots overlap the tail cone by ≥ 0.5? top-down shows two small swept triangles?

**DO NOT:**
- Do not ship the fin alone — the horizontal stabilizer pair is mandatory inventory.
- Do not use an unswept, untapered slab; sweep and taper must be numerically present, not just "a fin-shaped box exists".
- Do not let tail surfaces hover behind or above the tail cone — bury the roots.

## Landing gear

**Hard numbers:**
- Nose gear: one strut + 2 wheels at ≈ 0.10–0.12 L behind the nose tip (L=60: x ≈ +23).
- Main gear: FOUR 4-wheel bogies (2 wing-mounted further outboard, 2 body-mounted near the belly centerline), clustered near ≈ 0.50–0.55 L from the nose (L=60: x ≈ −2 … −6), 16 main wheels total.
- Wheel diameter ≈ 0.018 L (L=60: ≈ 1.1); struts long enough for a belly clearance ≈ 0.4–0.5 D.

**Recipe:**
1. Table-drive it: `const bogies = [{x, z, top}, ...]` — four main entries + one nose config; ONE loop expands each entry into strut + beam + wheels. Never four near-duplicate hardcoded blocks.
2. Derive strut height FROM the table: `strutH = top − BOGIE_Y`, where `top` is the local hull-belly y (body pairs) or wing-underside y from `wingUnderY(s)` (wing pairs) — never hand-pick per bogie.
3. Weld a Box "truck beam" between the strut bottom and the wheels; wheels overlap the beam (never placed loose against the strut).
4. Add small bridging Boxes at every strut-to-hull junction — guaranteed visible contact beats exact flush arithmetic.
5. Wheels: dark tire cylinders (axis along Z) + a smaller light hub disc each.
6. NEVER reference `window` / `document` / DOM globals in the gear code (or anywhere in `buildPlane`) — one track lost two consecutive maximum-effort passes to a single `window` token in a gear rebuild; the whole edit is discarded.

**Worked contrast (from real edit history):**
- BEFORE: wheels placed loose against struts with hand-tuned offsets — hairline gaps everywhere; the assembly reads as parts hovering near each other.
- AFTER: an edit whose note read "added connector boxes to both the nose and main landing gear struts … bridge the gap" was part of the single largest improvement in one run's history. Bridging primitives at junctions are cheap and always safe.

**Self-check (all YES):** 1 nose + 4 main bogies from one table+loop? every strut visibly reaches the belly or wing underside (stated overlap)? wheels overlap their beam? bridging boxes at hull junctions? zero DOM globals?

**DO NOT:**
- Do not write duplicate per-bogie blocks — table + loop only.
- Do not leave any strut ending short of the body; state the contact numbers.
- Do not use `window`/DOM globals — instant whole-edit discard.

## Surface craftsmanship / attachment

**Hard rules (cross-cutting — apply to every part on the craft):**
1. Positive buried margin everywhere: before finishing an edit, numerically compare the two touching coordinates (nacelle-bottom vs belly, pylon-top vs wing underside, root vs hull, strut-top vs belly) and require overlap ≥ +0.2. Write both numbers into the edit note as verification.
2. Shared named constants: define `R`, `BODY_LEN`, wing root/span/sweep ONCE; every dependent part's position formula references them. Re-deriving numbers per part per edit is how parts drift apart.
3. Flush details on curved skin: `zSurf(y) = sqrt(R*R − y*y)` for every pane/cheatline/door so nothing floats off the curve.
4. Material palette — 8–10 named `MeshStandardMaterial`s, one per part family: body white/off-white, belly grey, wing/tail metal grey, accent blue (cheatline/fin), dark glass (windows + inlets), aluminum struts, light nacelle cowl, dark tire, light hub. Never reuse one "dark" for engines, pylons, windows, doors, AND gear — shared materials make part families visually inseparable and make any one family unfixable without touching all the others.
5. Visibility: a mounting part needs a face-on silhouette wide enough not to vanish edge-on (≥ ~0.7 units) AND a material lighter than whatever is directly behind it in camera.
6. Bilateral symmetry structurally: build one side's assembly in a `THREE.Group` and mirror positions/signs for the other side, so left/right can never drift apart across edits.
7. After ANY reposition edit, re-check the top-down AND front renders, not only the view that prompted the edit.

**Worked contrasts (from real edit history):**
- Invisible mount → visible mount: a 0.45-thin pylon in the dark material was invisible from every camera (dark-on-dark + edge-on sliver); rebuilt as a 3.6 × 1.8 × 0.7 wedge in the light cowl material, it finally read as a mount. Diagnose color contrast AND face width before touching positions.
- "Close the gap by moving parts closer" gone wrong: an edit pulled a wing root's Z from 18 → 14 and a pylon's Y from −3 → −1.3 to close a visual gap — plausible-sounding, but it broke the planform outline in the top-down and front renders. Check the mesh-envelope math (does the part still overlap its parent? does the outline survive top-down?) before accepting any "pull it closer" move.
- Detached part fixed by OFFSET, not angle: when a part sits far from the body, the win came from reducing the large positional offset placing it away from the parent — not from re-tuning rotation on the same primitive.

**Self-check (all YES):** every junction has a stated positive overlap? no part shares a material with an unrelated family? no thin dark part in front of a dark backdrop? both sides mirror-identical? top-down + front renders verified after the edit?

**DO NOT:**
- Do not trust "looks fine in the one screenshot" — verify the orthogonal renders.
- Do not fine-tune an already-good region with "more correct" numbers and no re-render; precision retunes of good regions are a recurring source of regressions, and narrated confidence ("now looks realistic") has preceded regressions.
- Do not fake detail with clusters of micro-primitives — a few large readable parts beat many small ones; render repeated micro-detail (e.g. dozens of window panes) as either one thin dark flush band, or an evenly-spaced loop computed from `zSurf(y)` with a door-position skip-list — never dozens of hand-placed boxes.

## Silhouette

**Hard numbers (the outline the craft must cut from every camera):**
- Slender body: L/D ≈ 10.5. Span ≈ 0.91 L. Fin top ≈ 1.5 D above the body. Hump swelling over the front third only. Nose and tail both visibly tapered; tail tip above the centerline.
- Top-down: two swept trapezoids (37.5°) + two small swept triangles at the tail + four nacelle dots ahead of the wing.
- Side: nose droop, hump bump, upswept tail, fin leaning back 45°, nacelles hanging below the wing line.

**Recipe — order of work:**
1. Outline first: fuselage slenderness + nose/tail taper, wing sweep/span/taper, fin height/sweep — BEFORE any surface detail. A wrong outline caps everything else no matter how good the details are.
2. Complete the canonical inventory before refining ANY single part: fuselage with both tapers, upper-deck hump, 2 swept+tapered wings, 4 underwing nacelles + pylons, vertical fin, 2 horizontal stabilizers, landing gear, dark cockpit band. A missing class-defining part costs more than any polish gains.
3. Trace all 9 camera outlines each pass (top-down, front, sides, three-quarters): the craft must read as the SAME coherent aircraft from every one; find views where a thin part vanishes edge-on or the outline degenerates, and fix those parts' face widths.
4. Zero floaters anywhere: any visibly detached or interpenetrating-mess part is a top-priority fix before adding anything new — on flat-shaded primitive renders every gap and hole is maximally visible.
5. One dedicated color-blocking pass AFTER geometry is stable: large uniform livery regions (white/off-white upper body, grey belly, dark cockpit band, contrasting nacelle cowls, accent tail) — never per-primitive color noise or fine patterns.

**Worked contrast (from real edit history):**
- The single most outline-changing one-line fix ever recorded in these runs was a wing sweep-axis correction whose effect was visible ONLY in the top-down render — the side view had looked plausible under both the wrong and the right axis for the entire run. Verify the silhouette per-view, not from one angle.
- A canonical layout with the complete part inventory reads as this aircraft even in plain primitives; a carefully-detailed but incomplete build (no stabilizers, pipe body) does not read as it from any angle.

**Self-check (all YES):** all inventory parts present? top-down shows swept trapezoid wings + swept tail triangles? side shows hump + upswept tail + leaning fin? no view where the craft degenerates or a part floats? colors are large uniform regions?

**DO NOT:**
- Do not polish surface detail while an outline-level defect exists (unswept wing, pipe fuselage, missing stabilizers, no nose/tail taper).
- Do not add micro-primitives that fuzz the outline.
- Do not judge an edit from the single camera it was motivated by — the outline must survive every view.
