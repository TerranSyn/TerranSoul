# 747-Class Widebody — WINNING BUILD Reconstruction Blueprint
### (source: `terransoul-gemma-transplant2/best-plane.js`, v4 judge 69.63/100 — above the 63.92 real-aircraft reference)

This is not a generic recipe — it is a literal part-by-part reproduction spec for the
exact winning file. Every number below is copied or numerically derived from the real
source; where a position depends on another constant, the formula is quoted verbatim so
the same file can be rebuilt from scratch or any single part repaired without touching
the rest.

Conventions (repeated context for every section; each H2 below is self-contained for
retrieval):

- Axes: nose points **+X**, up is **+Y**, sides are **±Z** (right wing = +Z, left wing = −Z).
- Two composition helpers used EVERYWHERE in this file — reuse them, do not reinvent:
  - `add(mesh, x, y, z, rx, ry, rz)` — sets `mesh.position.set(x,y,z)`, sets
    `rotation.x/y/z` only for truthy args, calls `group.add(mesh)`, returns the mesh.
  - `tubeX(rTop, rBottom, len, material, segs=40)` — returns a bare
    `new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, segs), material)`.
    A stock `CylinderGeometry` axis is local **+Y**; every `tubeX(...)` call is then
    passed through `add(...)` with `rz = -Math.PI/2` (or `-Math.PI/2 + offset` for a
    tilted tube) to lay that axis along world **+X**. Under that rotation, `radiusTop`
    (the local +Y end) lands on the **+X-facing** side of the tube and `radiusBottom`
    (local −Y end) lands on the **−X-facing** side — this is why nose calls are written
    `tubeX(smallTipRadius, R, ...)` (small end forward) while a differently-tilted call
    can put the small end on the other side (see Fuselage section, tail cone).
- Primitives actually used in this exact file: `BoxGeometry`, `CylinderGeometry`
  (always via `tubeX`), `SphereGeometry`, `TorusGeometry`, and — for the wings, vertical
  fin, and horizontal stabilizers only — `THREE.Shape` + `THREE.ExtrudeGeometry`
  (tapered planform panels, `bevelEnabled: true`). `ConeGeometry`, `CapsuleGeometry`,
  and `LatheGeometry` are NOT used anywhere in this build. **If the current actor is
  under a strict Box/Cylinder/Sphere/Cone/Torus-only contract** (Shape+Extrude marked
  "open-medium only" elsewhere in this bench's taught references), substitute the
  3-segment tapered-box-chain recipe for wings/fin/tailplanes, but keep the exact root
  chord / tip chord / span numbers quoted in the Wings and Empennage sections below —
  those numbers are what scored, not the primitive that drew them.
- Edit discipline: re-read the file immediately before every edit; make ONE bounded
  change per pass; spell `THREE` correctly; never reference `window`/`document`/DOM
  globals inside `buildPlane`.
- Attachment rule: every child part must overlap its parent by a positive buried
  margin. This file's convention for curved-skin flush details is
  `zSurf(y) = Math.sqrt(Math.max(0.01, R*R - y*y))` — compute the true skin
  half-width at height `y` rather than hardcoding a Z offset; every pane/cheatline/door
  below is placed with `zSurf(paneY/doorY/cheatY) + small_epsilon`.

---

## Fuselage + nose + tail

**Exact constants (top of `buildPlane`):**
- `R = 3.4` — fuselage radius (≈6.8 m diameter, wide-body).
- `BODY_LEN = 46` — constant mid-section length.
- `bodyCX = 0` — fuselage centred on the origin along X.
- Main tube: `tubeX(R, R, BODY_LEN, WHITE)` at `(0, 0, 0)`, `rz = -Math.PI/2`. Spans
  `x = −23 … +23` at constant radius 3.4.
- `noseLen = 6.5`; `noseX = BODY_LEN/2 + noseLen/2 = 26.25`.
  Nose taper: `tubeX(2.0, R, noseLen, WHITE)` at `(26.25, 0, 0)`, `rz = -Math.PI/2`
  (radiusTop 2.0 = the small tip end, lands forward at world x=29.5; radiusBottom
  R=3.4 lands at world x=23, flush with the main tube's front face).
  Nose cap: `SphereGeometry(2.0, 24, 20)` at `(29.5, 0, 0)`, `scale.set(0.85, 1, 1)`.
- `tailLen = 13`; `tailX = -(BODY_LEN/2 + tailLen/2) = -29.5`.
  Tail cone: `tubeX(1.1, R, tailLen, WHITE)` at `(-29.5, 1.7, 0)`,
  `rz = -Math.PI/2 - 0.15` (the extra −0.15 rad is what produces the upsweep tilt).
  Verified world endpoints of this rotated tube: the radiusTop=1.1 end lands at
  `(-23.07, 0.73, 0)` (right against the main tube's rear face) and the
  radiusBottom=R=3.4 end lands at `(-35.93, 2.67, 0)` (near the tail tip, elevated).
  Tail/APU cap: `SphereGeometry(1.05, 16, 14)` at `(tailX - tailLen/2 + 0.2, 3.6, 0)`
  = `(-35.8, 3.6, 0)`, `scale.set(0.7, 1, 1)`.
- Belly fairing: `tubeX(R*1.02, R*1.02, BODY_LEN + 6, BELLY)` = radius 3.468, length 52,
  at `(0, -0.6, 0)`, `rz = -Math.PI/2`, `scale.set(1, 0.5, 1)` — deliberately proud of
  the skin radius (3.468 > 3.4) so it never z-fights the white upper fuselage.

**Attachment:**
- Nose base (radius 3.4, world x=23) meets the main tube's front cap face (also
  radius 3.4, x=23) — flush, coaxial, zero-gap, matching radii on both sides.
- Nose cap sphere center sits exactly ON the nose tube's tip face (x=29.5, radius
  2.0 vs sphere radius 2.0) — buried by construction, ~1.7 units of the sphere's
  back half sinks into the tapered nose tip.
- Tail cone's thin end (radius 1.1) sits at world `(-23.07, 0.73, 0)`, ~0.07 units
  past the main tube's rear face (x=-23) — essentially coincident, buried by the
  y=1.7 lift + rotation combination rather than by matching radii; do not "fix" this
  by matching radii without re-rendering, the geometry was tuned against the judge.
- Tail/APU cap sphere (x=-35.8, y=3.6) sits close to the tail cone's wide end
  (x=-35.93, y=2.67, radius 3.4) — offset ~0.9 above it, reads as a small round nub
  riding the upper surface near the tip.

**Repair bullets:**
- To lengthen the fuselage, change `BODY_LEN` only — `noseX`, `tailX`, cheatline
  length, and every pane-row loop bound (`BODY_LEN/2 ± ...`) all derive from it.
- To change nose bluntness, change the `2.0` radiusTop in the nose `tubeX(2.0, R, ...)`
  call AND the nose-cap `SphereGeometry(2.0, ...)` together — they must match or the
  cap will float or gap.
- To change the tail upsweep angle, change the `-0.15` term in
  `-Math.PI/2 - 0.15` and re-render; increasing its magnitude lifts both the
  radius-1.1 end's Y and the radius-3.4 end's Y further, so also re-check the
  tail/APU cap sphere position `(tailX - tailLen/2 + 0.2, 3.6, 0)` still sits near
  the cone's wide end after the change.
- To thicken/thin the fuselage, change `R` — this cascades into `WING_Z = R - 1.1`,
  `BELLY_Y = -R`, every `zSurf(y)` call, and the belly fairing radius `R*1.02`; do
  not change `R` without re-checking those four dependents.
- Belly must stay at radius `R*1.02` (not `R`) — dropping to `R` reproduces the
  z-fighting seam this build explicitly fixed.

---

## Wings

**Exact constants:**
- `DIHED = 0.085` (~5° dihedral).
- `WING_MX = 1.5` — wing box centre along X.
- `WING_Y = -1.1` — low-wing mount Y.
- `WING_Z = R - 1.1 = 2.3` — root Z (root is pushed 1.1 units inside the fuselage
  radius so it buries into the side).
- `SPAN = 31`.
- `wingShape` (local X = chord, local Y = span 0→31, extruded along local Z):
  `(7.5,0)` root LE → `(-6.5,0)` root TE (root chord **14**) → `(-11,31)` tip TE →
  `(-7.5,31)` tip LE (tip chord **3.5**) → close.
- `wingGeo = ExtrudeGeometry(wingShape, {depth:0.7, bevelEnabled:true,
  bevelThickness:0.03, bevelSize:0.03, bevelSegments:1})`, then
  `wingGeo.translate(0, 0, -0.35)` to center the depth on local Z=0.
- Right wing (+Z): `add(mesh, WING_MX, WING_Y, WING_Z, Math.PI/2 - DIHED, 0, 0)`.
- Left wing (−Z): `add(mesh, WING_MX, WING_Y, -WING_Z, -Math.PI/2 + DIHED, 0, 0)`
  — NOTE: the SAME `wingGeo` (not mirrored/scaled) is reused for both sides; only the
  add-call's Z sign and rotation sign flip. A plain `scale.z = -1` would NOT work here
  because span is baked along local Y, not local Z.
- Root fairings: `for (s of [1, -1])` → `BoxGeometry(15, 1.4, 3.2)` at
  `(WING_MX - 1, WING_Y + 0.4, s*(R - 1.4))` = `(0.5, -0.7, ±2.0)`.

**Attachment (numerically verified):**
- Root chord world position (right wing): LE at `(9.0, -1.1, 2.3)`, TE at
  `(-5.0, -1.1, 2.3)`. Fuselage skin half-width at y=-1.1 is `zSurf(-1.1) ≈ 3.22`;
  the root sits at z=2.3, buried **0.92** units inside the skin — solid overlap.
  (Left wing mirrors to z=-2.3.)
- Tip (right wing) reaches world `≈ (x −9.5…−6.0, y ≈ +1.54, z ≈ +33.2)` — dihedral
  visibly lifts the tip 2.6 units above the root.
- Root fairing boxes at z=±2.0 sit just inboard of the wing roots (z=±2.3),
  bridging the small visual step between fuselage skin and wing root.

**Repair bullets:**
- To move a wing fore/aft, change `WING_MX` only; both wingShape X coordinates and
  the root-fairing X are relative to it, so nothing else needs touching.
- To change span, change `SPAN` — it is baked into `wingShape`'s two tip points
  (`SPAN`) — but ALSO update `nacelle()`'s stations (`nacelle(14.5)`, `nacelle(26)`,
  etc., see Engines section) since those are absolute Z values, not `SPAN`-relative.
- To change sweep, edit the tip X coordinates in `wingShape` (`-11` and `-7.5`) —
  more negative = more sweep; keep `tipChord = |−11 − (−7.5)| = 3.5` if you don't
  also intend to change taper.
- To re-mirror a wing that reads flat/wrong-side, verify the rotation sign matches
  the Z sign: `+WING_Z` pairs with `+Math.PI/2 - DIHED`, `-WING_Z` pairs with
  `-Math.PI/2 + DIHED` — swapping only one of the pair un-mirrors it.
- If engines look detached after any wing edit, re-derive them — `nacelle(z)` reads
  `WING_MX`, `WING_Y`, `WING_Z`, `SPAN`, and `DIHED` directly (see next section); it
  is never hardcoded per engine.

---

## Engines + pylons

**Exact constants (inside the `nacelle(z)` function, called 4×):**
- `ncr = 1.6` — cowl radius. `ncLen = 6.5` — nacelle length.
- Per-call derived values: `s = Math.abs(z) - WING_Z` (spanwise distance from root);
  `leX = WING_MX + 7.5 - (15/SPAN) * s` (wing LE X at that station); `wingY = WING_Y
  + Math.tan(DIHED) * s` (wing underside Y at that station, following dihedral);
  `y = wingY - 3.20` (nacelle centerline, slung below the wing); `inletX = leX + 3.5`
  (inlet plane ahead of the LE); `cx = inletX - 0.25 - ncLen/2` (cowl centre);
  `cowlBack = inletX - 0.25 - ncLen`; `pylH = (wingY - (y + ncr)) + 0.8` — this
  algebraically simplifies to a **constant 2.4** regardless of `s`, since `y` is
  defined relative to `wingY`.
- Called at `nacelle(14.5); nacelle(26); nacelle(-14.5); nacelle(-26)` — inboard
  stations at |z|=14.5, outboard at |z|=26.
- Verified numbers, inboard right engine `nacelle(14.5)`: `s=12.2`, `leX≈3.10`,
  `wingY≈-0.06`, `y≈-3.26`, `inletX≈6.60`, `cx≈3.10`, `cowlBack≈-0.15`,
  pylon x = `leX+0.4≈3.50`, pylon Y-centre = `(wingY+y+ncr)/2+0.05 ≈ -0.81`.
  Outboard right engine `nacelle(26)`: `s=23.7`, `leX≈-2.47`, `wingY≈0.92`,
  `y≈-2.28`, `inletX≈1.03`, `cx≈-2.47`, `cowlBack≈-5.72`.
- Per-engine mesh kit (all cylinders axis-along-X via `rz=-Math.PI/2`):
  - Pylon: `BoxGeometry(2.6, pylH=2.4, 0.52)` (ALU) at
    `(leX+0.4, (wingY+y+ncr)/2+0.05, z)`, `rz=0.1`.
  - Cowl: `CylinderGeometry(ncr=1.6, ncr*0.86=1.376, ncLen=6.5, 32, 1, true)`
    (open-ended, NAC — light) at `(cx, y, z)`.
  - Inlet lip: `TorusGeometry(ncr=1.6, 0.15, 14, 30)` (NAC) at `(inletX, y, z)`,
    `ry=Math.PI/2`.
  - Inlet dark disc: `CylinderGeometry(ncr*0.97=1.552, 1.552, 0.55, 30)` (DARK) at
    `(inletX-0.65, y, z)`.
  - Spinner: `SphereGeometry(0.32, 16, 12)` (HUB) at `(inletX-0.5, y, z)`.
  - Exhaust: `CylinderGeometry(ncr*0.5=0.8, ncr*0.84=1.344, 1.3, 28)` (HUB) at
    `(cowlBack+0.55, y, z)`.

**Attachment:**
- `pylH` is fixed at 2.4 by construction — this is what guarantees the pylon top
  reaches the wing centerline (`wingY`) and the pylon bottom reaches just inside the
  cowl (`y + ncr`), for EVERY engine regardless of station, without per-engine tuning.
- Nacelle nose (inlet, `inletX = leX + 3.5`) sits 3.5 units ahead of the local wing
  leading edge `leX` — clear daylight gap, no interpenetration with the wing.
- Nacelle centerline `y = wingY - 3.20` sits 3.2 units below the local wing
  underside — clearly slung below, clear of the belly (belly bottom is `BELLY_Y =
  -R = -3.4`; at the inboard station `y≈-3.26`, comparable to the belly line, which
  is why inboard engines read close to the body while outboard ones (`y≈-2.28`) read
  clearly higher and further out).

**Repair bullets:**
- Never hardcode a per-engine X/Y — always derive from `leX`/`wingY`/`s` inside
  `nacelle(z)`; the ONLY per-engine input is the Z station passed to the call.
- To move all four engines' stations, edit the four `nacelle(...)` call arguments
  (14.5/26/-14.5/-26); to change how far inboard/outboard as a fraction of span,
  express new Z values relative to `WING_Z=2.3` and `SPAN=31` rather than eyeballing.
- To make the engines hang lower/higher, change the `-3.20` constant in
  `y = wingY - 3.20`; this shifts ALL FOUR engines identically and keeps `pylH`
  self-correcting (it is derived, not hardcoded).
- To resize a nacelle, scale `ncr` and `ncLen` together; every dependent offset
  (`inletX`, `cx`, `cowlBack`, exhaust radii) is a formula off those two, so a single
  edit to the two named constants propagates correctly.
- Keep the cowl/pylon material (NAC/ALU, light) and inlet material (DARK) distinct —
  this is what makes all four pods read as separate light pops against the darker
  grey wing rather than a dark smear.

---

## Upper-deck hump + cockpit

**Exact constants:**
- `humpLen = 18` (fore-aft length), `humpH = 3.15` (dome half-height scale),
  `humpW = 2.85` (dome half-width scale), `humpCX = 14.2` (centre X),
  `humpY = 2.5` (centre Y — kept low so the lower half stays submerged in the crown).
- `humpHalf = humpLen/2 = 9`; `humpFront = humpCX + humpHalf = 23.2`.
- Geometry: ONE `SphereGeometry(1, 46, 32)` with `scale.set(humpHalf=9, humpH=3.15,
  humpW=2.85)` at `(14.2, 2.5, 0)` — a single scaled sphere, not a capsule/frustum,
  so there is no cylindrical flat section or seam.
- `humpF(x) = Math.sqrt(Math.max(0, 1 - ((x - humpCX)/humpHalf)**2))` — local
  normalized half-height/half-width of the dome surface at world X `x` (1 at the
  centre, 0 at the ends).
- Cockpit: `cpX = humpFront - 2.2 = 21.0`; `cpY = humpY + humpH * humpF(cpX) * 0.72`.
  Verified: `humpF(21.0) ≈ 0.655`, so `cpY ≈ 3.986`.
  Windshield: `BoxGeometry(0.5, 0.8, 1.5)` (DARK) at `(21.0, 3.986, 0)`, `rz=0.42`.
  Side panes (×2): `BoxGeometry(0.55, 0.66, 0.85)` (DARK) at
  `(cpX-0.15=20.85, cpY-0.2≈3.786, ±0.82)`, `ry = ±0.34`, `rz = 0.42`.
- Upper-deck cabin panes: loop `i = 0..11` (12 stations × 2 sides = 24 panes),
  `x = humpFront - 3.4 - i*1.05` (i=0 → x=19.8, i=11 → x=8.25); skip if
  `humpF(x) < 0.2`; `y = humpY + humpH*humpF(x)*0.32`; `zz = humpW*humpF(x) + 0.05`.
  Verified: i=0 → `f≈0.783, y≈3.29, zz≈2.28`; i=11 → `f≈0.750, y≈3.26, zz≈2.19`.
  `BoxGeometry(0.3, 0.34, 0.06)` (DARK) at `(x, y, ±zz)`.

**Attachment:**
- The dome centre Y=2.5 vs fuselage crown radius R=3.4 means roughly the lower ~1
  unit of the dome (below world y≈3.4, i.e. wherever `humpY - humpH*humpF(x) < R`)
  is buried inside the main tube — this is what fairs the hump into the crown with
  no visible seam (the reason a scaled sphere was chosen over a capsule/frustum).
- Every cockpit and upper-deck-pane Y/Z is computed FROM `humpF(x)`, i.e. from the
  dome's own current surface — never a fixed offset — so panes stay seated on the
  dome through any resize.

**Repair bullets:**
- To make the hump more/less prominent, change `humpH` (peak height) and/or
  `humpW` (width) — both are direct scale factors on the same sphere, no other part
  needs to change.
- To slide the hump fore/aft, change `humpCX` — `humpFront`, `cpX`, and every
  upper-deck pane X automatically follow since they're all `humpFront`-relative.
- To change the hump's fore-aft length, change `humpLen` — `humpHalf` and
  `humpFront` are derived, so nothing else needs manual adjustment, but re-check the
  upper-deck pane loop still lands inside `humpF(x) >= 0.2` for all 12 stations.
- If cockpit or upper-deck panes look detached after any hump resize, do NOT
  re-tune their offsets by hand — re-render; they are already 100% formula-derived
  from `humpF(x)`, so a detached look means the hump itself moved wrong, not the panes.
- Keep this a single primitive; do not split it into a frustum + fillet — the file's
  own header comments record that a capsule/box-seam version scored worse (hump=3)
  than this one continuous scaled-sphere version.

---

## Empennage (vertical fin + horizontal stabilizers)

**Exact constants:**
- `finShape` (local X=chord, local Y=height, extruded along Z, NO rotation applied
  at add-time — local axes map straight to world axes): `(0,0)` root LE →
  `(-8,0)` root TE (root chord **8**) → `(-8.6,11)` tip TE → `(-4,11)` tip LE
  (tip chord **4.6**, height **11**) → close.
- `finGeo = ExtrudeGeometry(finShape, {depth:1.15, bevelEnabled:true,
  bevelThickness:0.05, bevelSize:0.06, bevelSegments:2})`, `finGeo.translate(0,0,-0.575)`.
- `add(finMesh, tailX + 2.5, 2.8, 0)` = `(-27, 2.8, 0)` — no rotation args, so local
  X/Y map directly to world X/Y: root sits at world x −27 (chord back to x −35),
  world y=2.8; tip reaches world y = 2.8+11 = 13.8, world x ≈ −31…−35.6.
- `hs` (horizontal stabilizer) shape: `(3,0)` root front → `(-3.5,0)` root back
  (root chord **6.5**) → `(-6,13)` tip TE → `(-3.5,13)` tip LE (tip chord **2.5**,
  semi-span **13**) → close.
- `hsGeo = ExtrudeGeometry(hs, {depth:0.62, bevelEnabled:true, bevelThickness:0.04,
  bevelSize:0.04, bevelSegments:1})`, `hsGeo.translate(0,0,-0.31)`.
- Right stabilizer: `add(hsMesh, tailX-0.5, 2.45, R-2.6, Math.PI/2-0.07, 0, 0)` =
  `(-30, 2.45, 0.8)`, rotated so local span (Y) maps mostly onto world Z.
- Left stabilizer: `add(hsMesh, tailX-0.5, 2.45, -(R-2.6), -Math.PI/2+0.07, 0, 0)`
  = `(-30, 2.45, -0.8)` — mirrored sign on both Z and rotation.
- Verified tip reach (right stabilizer): world `y ≈ 2.45+0.91=3.36`,
  `z ≈ 0.8+12.97=13.77`.

**Attachment:**
- Fin root (world x −27…−35, y=2.8) lands squarely inside the tail cone's own
  X-footprint (tail cone spans roughly x −23…−36 per the Fuselage section) at a Y
  consistent with the cone's upswept crown — buried into the tail structure, not
  perched on top.
- Stabilizer root Z = `R - 2.6 = 0.8`. Fuselage skin half-width at y=2.45 is
  `zSurf(2.45) ≈ 2.36`; the root sits at z=0.8, buried **≈1.56** units inside the
  skin — solid overlap, same pattern as the wing root.

**Repair bullets:**
- To change fin height, edit the `11` in both `finShape` tip points (`(-8.6,11)`
  and `(-4,11)`) together — mismatching them un-levels the tip edge.
- To change fin rake, edit `-8.6` and `-4` (more negative = more raked back);
  keep `rootChord=8` fixed if you don't also intend to change area.
- To move the whole empennage fore/aft, the fin uses `tailX + 2.5` and the
  stabilizers use `tailX - 0.5` — both are `tailX`-relative, so changing `tailX`
  (Fuselage section) moves all three surfaces together automatically.
- Stabilizer sweep/dihedral both come from the SAME rotation term
  `Math.PI/2 - 0.07` (right) / `-Math.PI/2 + 0.07` (left) — the `0.07` controls
  dihedral; sweep is baked into the `hs` shape's tip X offsets (`-6` vs `-3.5`), not
  the rotation.
- Never ship the fin without both stabilizers — this file's header comments flag
  the stabilizer pair as the most commonly forgotten class-defining part.

---

## Landing gear

**Exact constants:**
- `BELLY_Y = -R = -3.4`.
- `wheel(x,y,z,rad)` helper: tire `CylinderGeometry(rad,rad,0.72,22)` (TIRE) +
  hub `CylinderGeometry(rad*0.42,rad*0.42,0.76,14)` (HUB), both `rx=Math.PI/2`
  (axis along Z).
- `legStrut(x,z,botY,r)` helper: `topY = BELLY_Y + 0.5 = -2.9` (constant for every
  strut); `CylinderGeometry(r,r, topY-botY, 12)` (ALU) centred at Y=`(topY+botY)/2`.
- Nose gear: `noseGx = BODY_LEN/2 - 4 = 19`.
  `legStrut(19, 0, BELLY_Y-2.4=-5.8, 0.28)` → height 2.9, centre y=-4.35.
  Two wheels: `wheel(19, BELLY_Y-2.55=-5.95, ±0.62, 0.78)`.
- Main gear `bogie(x,z)`: `legStrut(x, z, BELLY_Y-2.7=-6.1, 0.34)` → height 3.2,
  centre y=-4.5; truck beam `BoxGeometry(2.5,0.48,1.6)` (ALU) at
  `(x, BELLY_Y-2.7=-6.1, z)`; 4 wheels via `dx∈[-0.9,0.9] × dz∈[-0.66,0.66]` →
  `wheel(x+dx, BELLY_Y-2.9=-6.3, z+dz, 0.9)`.
- Calls: `bogie(-4.5, 2.2); bogie(-4.5, -2.2)` (body gear, near centreline);
  `bogie(-0.5, 5.0); bogie(-0.5, -5.0)` (wing-root gear, outboard) — 4 bogies × 4
  wheels = 16 main wheels + 2 nose wheels = 18 total.

**Attachment:**
- Every strut's TOP is fixed at `topY = -2.9` by `legStrut`'s own formula — this is
  0.5 above `BELLY_Y = -3.4`, i.e. every strut top is driven 0.5 units UP INTO the
  belly volume, guaranteeing a buried top regardless of which bogie/nose call it's
  used from.
- Truck beam sits exactly at the strut's bottom Y (`BELLY_Y-2.7` for main gear); the
  4 wheels per bogie are offset ±0.9/±0.66 from the beam centre, so they overlap the
  beam's `BoxGeometry(2.5, 0.48, 1.6)` footprint rather than floating beside it.

**Repair bullets:**
- To change ride height (all gear taller/shorter together), do NOT touch `topY`
  (keep it buried in the belly) — change the two `botY` offsets consistently, e.g.
  `BELLY_Y-2.4` (nose) and `BELLY_Y-2.7` (main), which also cascades into
  the wheel Y offsets (`BELLY_Y-2.55`, `BELLY_Y-2.9`) since those are written
  relative to the same `BELLY_Y-2.x` pattern — keep the wheel offset ~0.15–0.2
  below its strut's `botY` so the tire still overlaps the beam.
- To reposition the nose gear fore/aft, change `noseGx` only (it derives from
  `BODY_LEN/2 - 4`, so it auto-follows a fuselage length change too).
- To widen/narrow the main gear track, edit the `z` arguments passed to
  `bogie(...)` (2.2/5.0) — keep the two body-gear Z values closer to centreline
  than the two wing-root ones, matching the real "four-post cluster" pattern.
- Never write a 5th near-duplicate bogie block by hand — add a new `{x,z}` entry
  and call `bogie(x,z)`; the whole strut+beam+4-wheel assembly is already a
  reusable function, not per-bogie boilerplate.

---

## Windows + doors + livery

**Material palette (defined once via `mat(color, opts)` = `MeshStandardMaterial({
color, roughness: 0.55, metalness: 0.12, ...opts})`, reused by name everywhere):**

| Name  | Hex       | Overrides                              | Role |
|-------|-----------|-----------------------------------------|------|
| WHITE | `0xf2f4f7`| —                                       | upper fuselage, nose, tail crown, hump |
| BELLY | `0xc2cad2`| —                                       | lower fuselage / belly fairing |
| WING  | `0x848d97`| metalness 0.32, roughness 0.45, DoubleSide | wings, wing-root fairings, tailplanes |
| BLUE  | `0x1f4e8c`| DoubleSide                              | cheatline, vertical fin |
| DARK  | `0x2a2f36`| roughness 0.35                          | cabin panes, cockpit glazing, engine inlets, doors |
| BAND  | `0x39414b`| roughness 0.4                           | recessed sill line beneath the cabin panes |
| ALU   | `0x8f98a2`| metalness 0.35, roughness 0.4           | pylons, gear struts, truck beams |
| NAC   | `0xdfe4ea`| metalness 0.25, roughness 0.45          | nacelle cowl + inlet lip (light, pops vs. wing grey) |
| TIRE  | `0x30343b`| roughness 0.8, metalness 0.04           | wheel tires (dark grey, not black — stays distinct from other bogies) |
| HUB   | `0x878e97`| metalness 0.4                           | wheel hubs, nacelle spinner, exhaust nozzle |

**Exact geometry constants:**
- `cheatY = 0.5`; `cheatZ = zSurf(0.5) + 0.02 ≈ 3.383`. Cheatline:
  `BoxGeometry(BODY_LEN+noseLen+2=54.5, 0.5, 0.06)` (BLUE) at `(1, 0.5, ±3.383)`.
- `paneY = 1.5`; `paneZ = zSurf(1.5) ≈ 3.051`. Sill:
  `BoxGeometry(46, 0.16, 0.045)` (BAND) at `(1.2, 1.17, ±3.071)`.
  Panes: loop `i=0..61` (62/side, 124 total), `x = 24 - i*0.95` (24 → −33.95),
  `BoxGeometry(0.71, 0.4, 0.05)` (DARK) at `(x, 1.5, ±3.101)`.
- `doorY = 0.7`; `doorZ = zSurf(0.7) + 0.02 ≈ 3.347`. Doors at
  `x ∈ {18, 8, -6, -18}` (4 stations × 2 sides = 8 doors):
  `BoxGeometry(0.7, 1.6, 0.06)` (DARK) at `(x, 0.7, ±3.347)`.

**Attachment:**
- Every one of cheatline/sill/panes/doors uses `zSurf(y)` computed at ITS OWN y
  (0.5, 1.5, 1.5, 0.7 respectively) plus a small `+0.02…+0.05` epsilon — so each
  band sits flush against the true curved skin at that specific height, never at a
  single hardcoded Z that would only be correct for one row.
- Pane depth is intentionally thin (0.05/0.06/0.045) — thin flush details read as
  window/panel lines; the belly fairing is the one part deliberately made PROUD
  (radius ×1.02) instead of flush, specifically to avoid a z-fight seam.

**Repair bullets:**
- To re-space or re-count panes, change the loop bound (`i<62`) and the pitch
  (`0.95`) together — count×pitch should stay ≈ the intended cabin length so the
  row doesn't run off the fuselage ends.
- To add/move doors, edit the `[18, 8, -6, -18]` array — keep entries spaced ≥ 8–10
  units apart so doors don't collide with the dense pane row.
- Any new flush detail at height `y` MUST be positioned with `zSurf(y) + epsilon`,
  never a copy-pasted Z from another row — a copied Z will float off the skin the
  moment it's at a different y.
- Never reuse DARK for two unrelated families (e.g. don't paint a strut or a pylon
  DARK) — this file keeps DARK strictly to panes/glazing/inlets/doors so those
  families stay visually distinguishable from ALU/NAC/HUB.
- To change the cheatline's vertical position, change `cheatY` only; its Z, length,
  and flush behavior are all derived.

---

## Silhouette / assembly

**How the 22 top-level `add(...)` groups combine into one coherent outline:**
- Everything is parented into a single `THREE.Group` (`group`, returned at the end)
  via the shared `add()` helper — there is no nested sub-grouping; every mesh is a
  direct child, positioned in the SAME world-space coordinate system described
  above, so every cross-part formula (`zSurf`, `humpF`, `wingLEx`-style `leX`) is
  directly comparable without a local-to-world conversion step.
- Build order in the source (top to bottom) IS the dependency order: materials →
  helpers → fuselage/nose/tail (defines `R`, `BODY_LEN`) → belly → `zSurf` →
  cheatline/panes/doors (consume `zSurf`) → hump/cockpit (defines `humpF`, used only
  locally) → wings (defines `WING_MX/Y/Z`, `SPAN`, `DIHED`) → engines (consume the
  wing constants via `nacelle(z)`) → empennage (reuses `tailX`) → landing gear
  (reuses `BODY_LEN`, `R`). Preserve this order when re-adding a removed part —
  inserting an engine block before the wing constants exist will throw or silently
  use stale values.
- Whole-craft footprint for a silhouette check (corrected to account for the nose-cap
  / tail-cap spheres' own protrusion beyond their center, and for wheel RADIUS not
  just wheel center — a sphere with `scale.set(sx,1,1)` extends `radius*sx` beyond its
  center along X, and ground contact is `wheelCenterY - tireRadius`, not the center):
  fuselage nose tip x ≈ 31.2 (nose-cap sphere center 29.5 + radius·scaleX
  `2.0*0.85=1.7`) to tail tip x ≈ −36.54 (tail-cap sphere center −35.8 −
  radius·scaleX `1.05*0.7=0.735`) — length span ≈ **67.7**; wingtip Z ≈ ±33.2 (full
  span ≈66.4); fin top y ≈13.8; belly bottom (wheel contact) y ≈ −6.73 (nose wheel:
  center `BELLY_Y-2.55=-5.95` − tire radius 0.78) down to y ≈ −7.2 (main wheel, the
  true low point: center `BELLY_Y-2.9=-6.3` − tire radius 0.9).

**Attachment (cross-family, restated):**
- Every buried-margin number quoted in the sections above is POSITIVE (wing root
  0.92, stabilizer root 1.56, nose-cap 1.7, pylon 2.4-constant) — this build never
  relies on exact coincident surfaces except at genuine coaxial cylinder-to-cylinder
  caps (nose base ↔ main tube, both radius R at x=23).

**Repair bullets:**
- If two families visually merge into one blob, check materials FIRST (palette
  table above) before touching geometry — this build's whole "pods pop against the
  wing" and "cabin line reads as one band" effects are material-contrast choices,
  not extra geometry.
- After changing any of `R`, `BODY_LEN`, `WING_MX/Y/Z`, `SPAN`, `DIHED`, or
  `humpCX/Y`, re-derive every part that reads that constant (grep the file for the
  exact identifier) rather than eyeballing a fix on the dependent part directly —
  every dependent listed in this document is a live formula, not a snapshot.
- When repairing a single part, keep the edit inside that part's own `add(...)`
  block; nothing in this file mutates shared state across blocks except through the
  named constants themselves.
- To sanity-check a repair without a full render, recompute the two touching
  coordinates by hand (as done throughout this document) and confirm the sign of
  the buried margin is still positive.

---

## MASTER PARTS TABLE

| # | Part | Primitive | Key dims | Position (x, y, z) | Rotation | Material |
|---|------|-----------|----------|---------------------|----------|----------|
| 1 | Main fuselage tube | Cylinder | r=3.4, len=46 | (0, 0, 0) | rz=−π/2 | WHITE |
| 2 | Nose taper | Cylinder | rTop=2.0, rBottom=3.4, len=6.5 | (26.25, 0, 0) | rz=−π/2 | WHITE |
| 3 | Nose cap | Sphere | r=2.0, scale(0.85,1,1) | (29.5, 0, 0) | — | WHITE |
| 4 | Tail cone | Cylinder | rTop=1.1, rBottom=3.4, len=13 | (−29.5, 1.7, 0) | rz=−π/2−0.15 | WHITE |
| 5 | Tail/APU cap | Sphere | r=1.05, scale(0.7,1,1) | (−35.8, 3.6, 0) | — | WHITE |
| 6 | Belly fairing | Cylinder | r=3.468, len=52, scale(1,0.5,1) | (0, −0.6, 0) | rz=−π/2 | BELLY |
| 7 | Cheatline ×2 | Box | 54.5 × 0.5 × 0.06 | (1, 0.5, ±3.383) | — | BLUE |
| 8 | Cabin sill ×2 | Box | 46 × 0.16 × 0.045 | (1.2, 1.17, ±3.071) | — | BAND |
| 9 | Cabin panes ×124 | Box | 0.71 × 0.4 × 0.05 | (24−0.95i, 1.5, ±3.101), i=0..61 | — | DARK |
| 10 | Passenger doors ×8 | Box | 0.7 × 1.6 × 0.06 | (x∈{18,8,−6,−18}, 0.7, ±3.347) | — | DARK |
| 11 | Upper-deck hump | Sphere (scaled) | scale(9, 3.15, 2.85) | (14.2, 2.5, 0) | — | WHITE |
| 12 | Cockpit windshield | Box | 0.5 × 0.8 × 1.5 | (21.0, 3.986, 0) | rz=0.42 | DARK |
| 13 | Cockpit side panes ×2 | Box | 0.55 × 0.66 × 0.85 | (20.85, 3.786, ±0.82) | ry=±0.34, rz=0.42 | DARK |
| 14 | Upper-deck panes ×24 | Box | 0.3 × 0.34 × 0.06 | along hump flank, 12 stations × 2 | — | DARK |
| 15 | Right wing | Extrude (Shape) | root chord 14, tip chord 3.5, span 31, depth 0.7 | (1.5, −1.1, 2.3) | rx=π/2−0.085 | WING |
| 16 | Left wing | Extrude (Shape, same geo) | same | (1.5, −1.1, −2.3) | rx=−π/2+0.085 | WING |
| 17 | Wing-root fairings ×2 | Box | 15 × 1.4 × 3.2 | (0.5, −0.7, ±2.0) | — | WING |
| 18 | Engine pylon ×4 | Box | 2.6 × 2.4 × 0.52 | f(leX, wingY, z) — see Engines section | rz=0.1 | ALU |
| 19 | Nacelle cowl ×4 | Cylinder (open) | r 1.6→1.376, len 6.5 | f(cx, y, z) | rz=−π/2 | NAC |
| 20 | Inlet lip ×4 | Torus | R=1.6, tube=0.15 | f(inletX, y, z) | ry=π/2 | NAC |
| 21 | Inlet dark disc ×4 | Cylinder | r=1.552, len=0.55 | f(inletX−0.65, y, z) | rz=−π/2 | DARK |
| 22 | Spinner ×4 | Sphere | r=0.32 | f(inletX−0.5, y, z) | — | HUB |
| 23 | Exhaust nozzle ×4 | Cylinder | r 0.8→1.344, len=1.3 | f(cowlBack+0.55, y, z) | rz=−π/2 | HUB |
| 24 | Vertical fin | Extrude (Shape) | root chord 8, tip chord 4.6, height 11, depth 1.15 | (−27, 2.8, 0) | — | BLUE |
| 25 | Horizontal stabilizers ×2 | Extrude (Shape, same geo) | root chord 6.5, tip chord 2.5, span 13, depth 0.62 | (−30, 2.45, ±0.8) | rx=±(π/2−0.07) | WING |
| 26 | Nose gear strut | Cylinder | r=0.28, len=2.9 | (19, −4.35, 0) | — | ALU |
| 27 | Nose wheels ×2 | Cylinder + Cylinder | tire r=0.78, hub r=0.328 | (19, −5.95, ±0.62) | rx=π/2 | TIRE/HUB |
| 28 | Main gear struts ×4 | Cylinder | r=0.34, len=3.2 | (−4.5, −4.5, ±2.2), (−0.5, −4.5, ±5.0) | — | ALU |
| 29 | Truck beams ×4 | Box | 2.5 × 0.48 × 1.6 | (x, −6.1, z) at same 4 stations | — | ALU |
| 30 | Main wheels ×16 | Cylinder + Cylinder | tire r=0.9, hub r=0.378 | (x±0.9, −6.3, z±0.66) × 4 bogies | rx=π/2 | TIRE/HUB |

*(f(...) = formula-derived per engine from `nacelle(z)`; see the Engines + pylons
section for the exact numeric values at z=14.5/26/−14.5/−26.)*
