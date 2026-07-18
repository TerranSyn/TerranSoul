# 747-Class Widebody — Primitives-Only Construction Reference ADDENDUM (replay distillation 2, 2026-07-17)

Conventions (repeated context for every section; each H2 below is self-contained for retrieval):

- Axes: nose points **+X**, up is **+Y**, sides are **±Z**. Fuselage length **L = 60**, radius **R = 3** (nose tip x = +30, tail x = −30).
- Allowed geometry: stock `BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, `CapsuleGeometry`, `ConeGeometry`, `TorusGeometry`, composed ONLY with position / rotation / scale / groups / matrix-basis transforms.
- Edit discipline (applies everywhere): re-read the file immediately before every `edit_file`; ONE bounded change per pass; NEVER reference `window` / `document` / DOM globals inside `buildPlane`.
- Attachment rule (applies everywhere): every part overlaps its parent by ≥ 0.2 buried margin; state the two touching coordinates in the edit note.
- This addendum extends the base reference with what actually CONVERTED (was kept) versus what was ROLLED BACK during the most recent long run. Where the two documents differ on tactics, this addendum wins.

## Window + door lines

**Numbers that survived (from the current kept build):** main deck = 50 panes per side, `BoxGeometry(0.8, 0.5, 0.1)`, pitch 1.0 along X starting x = −24, at y = 1.1, z = ±2.8 (flush: `sqrt(R*R − y*y)` = `sqrt(9 − 1.21)` ≈ 2.79). Upper deck = 15 panes per side, `BoxGeometry(0.7, 0.4, 0.1)`, pitch 0.9, at y = 3.6, z = ±2.1, anchored to the hump's actual span. Cockpit = four SMALL angled panes (`BoxGeometry(4, 2.5, 0.1)`): two front-facing rotated ±10°, two wrap panes rotated ±30°. Doors = `BoxGeometry(1.5, 2.0, 0.3)` at two stations (x = +7 and x = −20), y = 1.2, z = ±2.6.

**Recipe:**
1. Keep every pane THIN — depth 0.1. A thick pane reads as a stud bolted on; a 0.1-deep pane reads as a window line. Thinning existing panes from 0.3 to 0.1 while raising the count into one continuous row was the highest-converting window move on record.
2. Derive the side offset from the local radius — `zSurf(y) = sqrt(R*R − y*y)` — and seat panes flush ON the skin; a hair inside the skin beats floating outside it.
3. Improve windows by changing the EXISTING pane loop's numbers (count, pitch, y, z, pane size) — never by replacing the loop structure itself.
4. Keep one continuous, evenly-pitched row per deck; irregular spacing, gaps, or extra rows read as noise, not detail.
5. Anchor upper-deck panes to the hump's real current coordinates (its actual x-span and surface), not to idealized targets — realigning panes onto the hump as-built converted; realigning the hump to the panes did not.
6. Build the cockpit as several small angled panes wrapping the nose (±10° fronts, ±30° sides), not as a few thick prisms — the prism-to-panes swap converted.
7. Keep doors at two stations per side, slightly taller than the pane row, seated on the same `zSurf`-derived surface.
8. Change windows OR doors OR cockpit in one pass — never all three at once.
9. After any window edit, check the low-front-left render FIRST: floating or misaligned panes show up there before anywhere else.
10. Never rewrite the whole window system (loop restructure + re-derivation + new rows) in one pass; each such rewrite left visible breakage.

**Worked contrasts (from real edit history):**
- KEPT: one edit call — existing panes thinned to depth 0.1, count raised to 50/side for one continuous clean row, the four thick cockpit prisms replaced by smaller angled wrap panes, upper-deck panes re-anchored to the hump. Nearly every camera improved and none visibly degraded. This is the geometry the current build carries.
- KEPT: one edit call — existing panes repositioned from floating outside the hull to flush on the skin, plus tighter pitch. The low-front-left and both profile renders improved; nothing was rebuilt.
- ROLLED BACK: four consecutive whole-system window rewrites (loop-bounds restructure, from-scratch flush re-derivation, bigger panes + a third door row for 8 doors, ground-up upper-deck realignment), each launched from the previous failed attempt's output instead of the last kept build. Every link showed misaligned/floating panes in the low-front-left render, and the damage compounded instead of recovering.

## Engines + pylons (four underwing)

**Numbers that survived (from the current kept build):** both wing halves at the SAME mirrored sweep (~32°, side-signed); four nacelles as two side-signed inboard/outboard pairs driven from ONE config table (`engineConfigs` with `side * offset` entries); nacelle = `CylinderGeometry(2.0, 1.6, 7, 8)` axis along X at y = −6 under the wing group; pylon = `BoxGeometry(0.9, 1.4, 3.5)` at the nacelle's x + side·2, y = −4.8 (midway between nacelle top and wing underside).

**Recipe:**
1. Keep exactly FOUR nacelles as two mirrored inboard/outboard pairs; drive both sides from one config table with side-signed offsets so left/right can never drift apart.
2. Make the two wing halves internally consistent FIRST (same sweep magnitude, mirrored sign; symmetric root/tip placement) — the one edit that made sweep + engine offsets consistent lifted the rear, low-front-left, and both profile renders at once, worth more than any nacelle polish.
3. Adjust the existing `engineConfigs` offsets numerically to move an engine; never rebuild the wing to fix an engine.
4. Derive each pylon FROM its engine (small forward x offset, y midway between nacelle top and wing underside) so moving a nacelle carries its pylon automatically.
5. State the attachment numbers before finishing: nacelle-top y vs wing-underside y at that station, pylon buried ≥ 0.2 into BOTH cowl and wing.
6. Keep the nacelle visibly BELOW the wing line — daylight between nacelle top and the belly line in the front render.
7. Change at most one station pair (inboard or outboard) or one shared parameter per pass.
8. Never rewrite the wing into a multi-section root/mid/tip chain in the same pass that touches engines — the combined re-architecture broke the rear and front renders both times it was tried.
9. If an engine floats, fix the ONE offset that misplaces it; do not re-architect the pylons.
10. After any engine/wing move, re-check the front AND top-down renders, not just the profile that motivated the edit.

**Worked contrasts (from real edit history):**
- KEPT: two focused edit calls after four reads — both wing halves set to the same mirrored ~32° sweep, and all four engines repositioned as symmetric side-signed inboard/outboard pairs beneath the wing. A consistency fix applied to the EXISTING assembly; rear, low-front-left, and both profile renders improved together.
- ROLLED BACK: a pylon-repositioning re-architecture followed in the same burst by a full 3-section root/mid/tip wing rebuild, 4–5 edit calls per pass. Both passes broke the rear render and worsened the low-front-left; the assembly never re-converged and the whole sequence was restored away.

## Upper-deck hump

**Current state (kept build):** one two-radius `CylinderGeometry(4.5, 3.2, 22)` frustum laid along X at (5, 3.5, 0), spanning roughly x = −6 … +16, with 15 upper-deck panes per side anchored to it. The base reference is right that a single rounded primitive (capsule / scaled sphere, lower half buried in the crown, front third only) is the better TYPE — but a multi-primitive faired reconstruction is the wrong ROUTE to it.

**Recipe:**
1. Treat the hump as ONE mesh; improve it by changing that one mesh's numbers, or at most swapping its single geometry type in place.
2. If swapping type, make it strictly one-for-one: same variable, same `group.add`, one edit call, ZERO other lines touched — leave the upper-deck panes byte-identical in that pass and realign them the NEXT pass.
3. Prefer numeric refinement of the existing hump before any type swap: bring the two end radii closer together, sink the center deeper into the crown, shorten toward the front third — smallest change first.
4. Bury the lower half in the crown (center y ≈ +0.75 R ≈ +2.2) so the rounded ends fair into the tube with no seam.
5. Keep the hump to the front third of the body (x ≈ +24 … +6 at L = 60): length ≈ 0.3 L, height above the crown ≈ 1.4–1.8, width ≈ 0.6–0.7 D.
6. Keep upper-deck panes anchored to whatever the hump currently IS, not to what it should become.
7. Never build a faired multi-primitive hump (overlapping tapered cylinders + fillet spheres for the crown transition) in one pass — tried once as a reconstruction and rolled back with visible breakage in the rear and low-front-left renders.
8. Never move the hump and rewrite its windows in the same pass.
9. After any hump edit, check the nose-hump-closeup AND rear renders before finishing.

**Worked contrasts (from real edit history):**
- ROLLED BACK: a full hump reconstruction — overlapping tapered cylinders plus a fillet sphere for the crown transition, several edit calls in one turn, launched on top of a prior failed attempt — broke the rear render badly and deepened the low-front-left damage; the harness restored the last kept build.
- KEPT (adjacent evidence): re-anchoring upper-deck panes onto the hump's actual surface — leaving the hump mesh itself untouched — improved the nose-hump-closeup render. Small alignment against the existing hump converted where reconstruction did not.
- KEPT (earlier build, base reference): a one-for-one geometry-type swap — frustum out, one lengthwise-stretched capsule in, same mesh slot, nothing else touched — converted. The difference from the failed reconstruction was footprint: one primitive in, one primitive out, in one bounded edit.

## ONE-EDIT DISCIPLINE

The shape shared by every improvement that survived this run, and the anti-shape shared by every sequence that was rolled back. This section outranks any per-part ambition: a correct plan executed as a sprawl still fails.

**Recipe:**
1. Make exactly ONE `edit_file` call per pass. Every surviving improvement came from a single bounded edit; every multi-call rewrite pass was rolled back.
2. Prefer numeric/positional adjustment of EXISTING meshes — reposition, resize, thin, re-derive one coordinate from another — over introducing new structures or replacing an assembly.
3. Before editing, name the ONE visible difference the edit should make and WHICH renders should show it (e.g. "continuous window line in both profile views", "engines symmetric in top-down"). If you cannot name it, the edit is too big.
4. Before finishing, verify the attachment numbers: the two touching coordinates and a buried margin ≥ 0.2, written into the edit note.
5. Confirm zero lines changed outside the target block; preserve all other code and logic exactly as-is.
6. Expect a winning edit to improve SEVERAL renders a little rather than transforming one; if the plan trades a big gain in one view for unknown effects elsewhere, shrink it.
7. Treat the low-front-left render as the tripwire: every rolled-back sprawling rewrite broke it first (floating/misaligned parts read worst from the close low angle), and the best kept edit left no render visibly worse.
8. Always start from the last KEPT build. Never edit on top of a rolled-back attempt's output — inherited breakage compounds and never recovers.
9. After a rollback, make the next attempt SMALLER or aim it at a DIFFERENT part — never escalate to a rebuild of the same part.
10. Never rewrite an entire subsystem (hump, wing + engines, window system) in one pass, whatever the motivation; if a subsystem needs restructuring, stage it as a series of one-for-one bounded swaps across passes, each independently kept-or-rolled-back.

**Worked contrasts (from real edit history):**
- KEPT (the winning shape): one edit call — thinned existing window panes to depth 0.1, raised the count for one continuous row, split thick cockpit prisms into small angled panes, re-anchored upper-deck panes. One concern, existing meshes, numeric changes, nearly every render a little better, none visibly worse.
- KEPT (even "safe" edits trade): one edit call — pure numeric count/size change to existing panes. Net improvement across most renders, but one previously strong render (low-front-left) visibly gave ground. Small footprint kept the trade affordable; a bigger edit with the same per-view trade would have been rolled back.
- ROLLED BACK (the losing shape, twice): two separate multi-pass rebuild campaigns — four chained whole-window-system rewrites, then a hump reconstruction followed by two wing+engine re-architectures at 4–5 edit calls per pass — every pass in both campaigns was worse than the last kept build, each chained attempt inherited the previous one's breakage, and both campaigns ended in a forced restore. Even the one fresh-start rebuild attempted from a clean baseline failed: full-assembly rebuilds are a losing move for this actor regardless of starting point.
