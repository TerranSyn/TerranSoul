# Boeing 747 Design & Geometry Reference

*Compiled from public Boeing specifications, Wikipedia, and aviation-engineering references. Primary variant used for headline dimensions: **Boeing 747-400** (the most-produced passenger variant and the baseline most 747 imagery depicts). The 747-8 and 747SP are called out explicitly wherever they diverge, since those divergences are themselves useful modeling signal.*

---

## 1. Overall Dimensions (747-400 baseline)

| Dimension | Value | Source |
|---|---|---|
| Overall length | 231 ft 10 in (70.66 m) | [Wikipedia: Boeing 747-400] |
| Wingspan (incl. 6 ft/1.8 m winglets) | 211 ft 5 in (64.44 m) | [Wikipedia: Boeing 747-400]; winglet height confirmed at [Farnborough Air Sciences Trust] |
| Tail height (ground to top of fin) | 63 ft 8 in (19.41 m) | [Wikipedia: Boeing 747-400] |
| Fuselage exterior diameter/width | 21 ft 4 in (6.5 m) | [flugzeuginfo.net: Boeing 747-400]; corroborated in [Jenkinson et al., *Civil Jet Aircraft Design* — Aircraft Data File] |
| Fuselage exterior height (max, at the hump) | ~26 ft 7 in (8.10 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Fuselage fineness ratio (length ÷ diameter) | 10.56 | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Interior cabin width | ~20 ft (6.1 m) | multiple aviation reference sites (general widebody-cabin corroboration), width less than exterior 6.5 m due to sidewall/insulation thickness |
| Wheelbase (nose gear to main gear) | ~84 ft (25.60 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Main gear track (left-to-right) | 36 ft 1 in (11.00 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Landing gear wheel count | 16 main wheels (four 4-wheel bogies: two under the wing roots, two under the centerline fuselage) + 2 nose wheels | [Wikipedia: Boeing 747] |

**Variant deltas (same fuselage cross-section, different length/tail geometry):**
- **747-8** (Intercontinental/Freighter): length 250 ft 2 in (76.25 m) — an 18.3 ft (5.6 m) stretch over the -400; wingspan 224 ft 7 in (68.4 m), the largest of any 747; vertical tail height "largely unchanged" at 63 ft 6 in (19.35 m); fuselage width unchanged at 21 ft 4 in (6.5 m). [Wikipedia: Boeing 747-8]
- **747SP**: length only 183 ft 3 in (55.85 m) — fuselage shortened by 47–48 ft versus the -100/-200 while keeping the full wing, tail structure enlarged; height is actually *taller* than the -400 at 65 ft 10 in (20.06 m) because of an enlarged vertical stabilizer needed to compensate for the shorter tail moment arm. [Wikipedia: Boeing 747SP]; [SimpleFlying: "Why The Boeing 747SP's Ultra-Long-Range Fuselage Design..."]

**Modeling takeaway:** all 747 variants share one fuselage cross-section (~6.5 m diameter); only overall length and vertical-tail size change meaningfully between variants.

---

## 2. Wing Geometry

| Parameter | Value | Source |
|---|---|---|
| Leading-edge sweep angle | 37.5° | [Wikipedia: Boeing 747] — commonly cited figure enabling Mach 0.85 cruise |
| Quarter-chord sweep | 35.5° | technical aircraft-design course notes (Scholz, HAW Hamburg) — the lower figure reflects sweep measured at 25% chord rather than the leading edge; use 37.5° for a leading-edge silhouette |
| Dihedral angle | 7° | corroborated across [aircraftinvestigation.info: Boeing 747-8I performance] and general aerodynamics references |
| Wing incidence | ~2° | aircraft-design course notes (Scholz, HAW Hamburg) |
| Aspect ratio | 6.96 (747-100/-200) → 7.39 (747-400, pre-winglet reference area) | [Jenkinson et al., *Civil Jet Aircraft Design*]. Note: sources vary 7.4–7.9 for the winglet-equipped -400 depending on whether winglet span/area is folded into the reference figure — this is a genuine literature inconsistency, not a single hard number. |
| Taper ratio (tip chord ÷ root chord) | 0.284 (747-100/-200), 0.275 (747-400) | [Jenkinson et al., *Civil Jet Aircraft Design*]; other sources round to ~0.25 |
| Mean aerodynamic chord | 9.80 m (747-100/-200), 9.68 m (747-400) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Wing reference area | ~525 m² (5,650 ft²) per the engineering data table; ~541.2 m² (5,825 ft²) is the figure most commonly quoted on general aviation-spec sites | [Jenkinson et al., *Civil Jet Aircraft Design*] vs. general web consensus — flagged discrepancy, not resolved in sources found |
| Wing planform shape | Continuously tapering chord from root to tip (no straight-then-tapered "kink" panel on the leading edge/outboard wing; the inboard TRAILING edge does carry the Yehudi extension — see Addendum A.3); leading edge has Krueger flaps running almost its entire span | [Wikipedia: Boeing 747] |

**Modeling takeaway:** a single swept trapezoidal wing (~37.5° leading-edge sweep, taper ratio ~0.27–0.28, mild 7° dihedral) built from one primitive per side, mirrored across the fuselage centerline, is geometrically correct — the 747 wing has no separate outboard "kink" panel the way some later widebodies do.

---

## 3. The Upper-Deck "Hump"

**Origin/purpose:** the hump exists because Boeing's original launch customer (Pan Am) wanted a hinged, front-loading nose cargo door for eventual freighter conversion. Since the cockpit couldn't be split around a nose door, it was raised onto a short upper deck behind the nose — this is the origin of the hump, not an aerodynamic styling choice. [Smithsonian Air & Space Magazine: "How the 747 Got Its Hump"]; [Wikipedia: Boeing 747]

**Shape evolution:** Boeing's first hump concept was a hemispherical bump, which produced too much drag; the aft portion was stretched into a teardrop profile to fair it back into the main fuselage — this is why the hump has a long, gently-sloped aft taper rather than a blunt step-down. The extra internal volume was originally used as a lounge/bar (later converted to seating after the 1973 fuel crisis). [Smithsonian Air & Space Magazine]

**Length by variant** (this is the single most useful hard data point for hump proportions):

| Variant | Upper-deck length | Source |
|---|---|---|
| 747-100 / -200 | 20 ft (6.1 m) | [SimpleFlying: "Why The Boeing 747's Upper Deck Hump Will Be Nearly Impossible To Replicate In A Modern Jet"] |
| 747SP | 39 ft (11.9 m) | same |
| 747-300 | 43 ft (13.1 m) | same |
| 747-400 | 54 ft (16.5 m) | same |
| 747-8I | 73 ft (22.2 m) | same |

**Position along the fuselage:** on the -100/-200, the short hump sits entirely *ahead of* the wing box. Starting with the 747SP, Boeing extended the hump aft so it begins over the section of fuselage containing the wing box rather than ahead of it — this "mated to the wing box" profile then carried over to the -300, -400, and -8. [Wikipedia: Boeing 747SP]; [SimpleFlying: "Why The Boeing 747SP's Ultra-Long-Range Fuselage Design..."]

**Derived fraction (747-400, computed from the cited absolute dimensions above, not itself a separately published percentage):** hump length 16.5 m ÷ total length 70.66 m ≈ **23% of overall fuselage length**. The hump starts almost immediately aft of the cockpit glazing — roughly 6–8% of total length aft of the nose tip — and, given the 23% length, ends around **29–31% of total length from the nose**, consistent with the sourced fact that the -400's extended hump reaches back over the wing box (wing root leading edge sits in roughly that same region on large widebodies).

**Not full-length:** unlike the Airbus A380, the 747's upper deck never runs the full fuselage — it is explicitly a partial, humped second level "not along the whole fuselage." [Aircraft Recognition Guide: Boeing 747]

**Windows:** early -100s had 6 upper-deck windows (3 per side); later stretched-upper-deck variants have up to 10 per side. [Wikipedia: Boeing 747]

---

## 4. Engine Placement

- **Count:** 4 engines. [Wikipedia: Boeing 747]
- **Mounting:** all four underwing on pylons (no tail-mounted or fuselage-mounted engines). [Wikipedia: Boeing 747]
- **Numbering/position convention:** engines are numbered left-to-right from the pilot's forward-facing perspective — Engine 1 = outboard left, Engine 2 = inboard left, Engine 3 = inboard right, Engine 4 = outboard right. [Airliners.net forum: "How Are Engines Numbered?"]
- **Leading-edge flap segmentation as a position marker:** the wing's Krueger flaps run in a distinct 3-segment "flip-over" arrangement between the fuselage root and the *inboard* engine, transitioning to a different drooping leading-edge flap design for the rest of the span out to the tip — meaning the inboard engine sits roughly at the flap-type transition point, a useful landmark distinct from the outboard engine's further-out position. [Wikipedia: Boeing 747]
- **Spare-engine capability:** the 747 can carry a non-functioning fifth "pod" engine slung under the left wing, positioned between the inner functioning engine and the fuselage — evidence that there is deliberate clearance in that inboard region. [Wikipedia: Boeing 747]
- **Spanwise placement (geometric approximation, not independently sourced):** consistent with the general silhouette of a quad underwing-mounted widebody, the inboard pair sits close to the wing root/kink region and the outboard pair sits further out toward mid-span; all four nacelles hang forward of and below the leading edge on pylons, a standard underwing-jet arrangement for clearance and flutter avoidance. Treat exact span-fraction placement as a visual approximation rather than a cited figure — no source found gives precise percentages.

---

## 5. Tail Geometry (747-400 baseline)

| Parameter | Value | Source |
|---|---|---|
| Vertical stabilizer height (above fuselage) | 33 ft 4 in (10.16 m) | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Vertical tail area | 77.10 m² | same |
| Vertical tail aspect ratio | 1.34 (a short, wide-chord fin relative to its height) | same |
| Horizontal stabilizer span | ~72 ft 5 in–72 ft 9 in (22.08 m) | [Jenkinson et al., *Civil Jet Aircraft Design*], corroborated by independent forum sourcing |
| Horizontal tail area | 136.60 m² | [Jenkinson et al., *Civil Jet Aircraft Design*] |
| Horizontal tail aspect ratio | 3.57 (noticeably more slender/tapered than the vertical fin) | same |

**Proportion to fuselage:** the vertical fin height (10.16 m) is roughly 1/7 of overall fuselage length, and roughly half the fuselage's own cross-sectional height (8.1 m) — i.e., the fin is a comparatively short, deep-chord surface rather than a tall slender one. The horizontal stabilizer span (22.08 m) is about 1/3 of the main wingspan.

**Variant note — tail size is NOT constant:** the 747SP required an enlarged vertical stabilizer (and taller overall height, 20.06 m vs. the -400's 19.41 m) purely to restore directional stability lost from the shortened fuselage/reduced tail moment arm — proof that 747 tail size scales with fuselage length, it is not a fixed proportion across all variants. [Wikipedia: Boeing 747SP]. By contrast, the 747-8's vertical tail height (19.35 m) is "largely unchanged" from the -400 despite the longer fuselage. [Wikipedia: Boeing 747-8]

**Tail cone shape:** rounded tail cone with the APU exhaust centered in it. [Aircraft Recognition Guide: Boeing 747]

---

## 6. Fuselage Cross-Section & Nose/Tail Taper

- **Cross-section shape:** the 747 uses a single **circular** fuselage cross-section — this was a departure from Boeing's earlier "double-bubble"/figure-8 cross-section (two intersecting circles of different radii joined by the cabin floor, as used on the Boeing 377 Stratocruiser). The upper-deck hump on the 747 is a separate raised pod sitting on top of the circular main fuselage, not a merged double-bubble shape. [Wikipedia: Boeing 377 Stratocruiser] (for the double-bubble contrast); [Aircraft Recognition Guide: Boeing 747] (confirms 747 keeps a consistent circular cross-section)
- **Key cross-section numbers:** exterior diameter 6.5 m; exterior height at the widest point (including the hump) ~8.1 m; interior cabin width ~6.1 m. [Jenkinson et al., *Civil Jet Aircraft Design*]; general references
- **Nose/tail taper (generic estimate — no single sourced fuselage-station table was found for exact percentages):** consistent with standard large-widebody jet proportions and the 747's fineness ratio of 10.56, the nose taper (radome + cockpit section back to full constant-diameter fuselage) spans roughly the first ~8–12% of total length, while the tail taper (aft cabin bulkhead back to the tail cone tip) is longer and shallower, spanning roughly the last ~15–20% of total length. These are reasoned proportions typical of jet transports of this fineness ratio, not independently cited 747-specific fractions — flagged explicitly as an estimate rather than a hard fact.

---

## 7. Livery/Paint Conventions (generic, light-touch)

- **Cheatline:** a decorative horizontal stripe along the fuselage sides, historically used to visually "cheat the eye" into de-emphasizing the staccato rhythm of cabin windows; can be a single band ("rule") or multiple bands ("tramlines"), often incorporating the airline's title/emblem/colors. Cheatlines run either along, above, or below the window line. [Wikipedia: Aircraft livery]; [SimpleFlying: "What Is A Cheatline On An Aircraft Livery?"]
- **Dominant modern convention — "Eurowhite":** since the 1970s, most major-carrier liveries use a predominantly **white fuselage**, with the airline's brand colors concentrated on the vertical tail and engine nacelles; this also suits leased aircraft, which can be repainted between operators with minimal surface-area changes. [Wikipedia: Aircraft livery]
- **Belly:** typically left unpainted white/light gray on the lower fuselage in most modern liveries, consistent with the overall white-dominant convention above; a full-color cheatline (if present) sits at or just below the window line, well above the belly.
- **Cheatlines today are the exception, not the rule** — most current mainline liveries have dropped them in favor of plain white with tail/engine branding; airlines that retain a cheatline (e.g., Singapore Airlines' dark blue/gold stripe) are now the recognizable outliers. [SimpleFlying: "What Is A Cheatline On An Aircraft Livery?"]

---

## 8. Window & Door Row Rhythm (generic widebody convention)

- **Structural frame spacing:** most commercial jet fuselages use structural frames spaced about **20 inches (0.51 m)** apart (e.g., 737, A320); wider-body/later designs vary — 777 uses 21 in, 787 uses 24 in, A350/A380 use 25 in. [Dretloh.com: "Why Aren't the Windows Aligned with the Seats in Aircraft?"]; [Airliners.net forum: "Frame Pitch or Window Spacing Data"]
- **Window placement rule:** cabin windows are centered *between* structural frames rather than on them, and are typically placed at every other frame bay — meaning window pitch (center-to-center spacing) is roughly double the frame pitch, i.e. commonly in the **~38–40 inch** range on classic designs. This is also why window spacing rarely lines up exactly with seat-row pitch (which is independently set by cabin configuration, e.g. 31–34 in economy pitch). [Dretloh.com]; [Airliners.net forum: "Frame Pitch or Window Spacing Data"]
- **Door count context (747-400 specific, for row-rhythm scale reference):** the 747 has multiple large upper-body doors per side along the main deck (numbered sequentially, e.g., Doors 1–4 plus a Door 5 near the tail) spaced at roughly even intervals corresponding to the cabin's structural zones; the 747SP, having a shorter fuselage, has **one fewer door per side** than the standard-length variants. [Wikipedia: Boeing 747SP]; general Boeing airport-planning documentation (door numbering referenced but not independently re-verified in full detail here)
- **Modeling takeaway:** for a primitives-based widebody, a regular window strip with pitch roughly double the "frame" spacing, and door cutouts placed at a handful of evenly-spaced structural zones along the lower half of the fuselage side, is a reasonable generic approximation — exact 747-specific door fuselage-station coordinates were not found in publicly accessible sources during this research pass.

---

## Sources

- [Wikipedia: Boeing 747](https://en.wikipedia.org/wiki/Boeing_747)
- [Wikipedia: Boeing 747-400](https://en.wikipedia.org/wiki/Boeing_747-400)
- [Wikipedia: Boeing 747-8](https://en.wikipedia.org/wiki/Boeing_747-8)
- [Wikipedia: Boeing 747SP](https://en.wikipedia.org/wiki/Boeing_747SP)
- [Wikipedia: Boeing 377 Stratocruiser](https://en.wikipedia.org/wiki/Boeing_377_Stratocruiser)
- [Wikipedia: Aircraft livery](https://en.wikipedia.org/wiki/Aircraft_livery)
- [flugzeuginfo.net — Boeing 747-400 Specifications](https://www.flugzeuginfo.net/acdata_php/acdata_7474_en.php)
- [Jenkinson, Simpkin & Rhodes, *Civil Jet Aircraft Design* — Aircraft Data File (Butterworth-Heinemann / Elsevier)](https://booksite.elsevier.com/9780340741528/appendices/data-a/table-3/table.htm)
- [SimpleFlying — "Why The Boeing 747's Upper Deck Hump Will Be Nearly Impossible To Replicate In A Modern Jet"](https://simpleflying.com/why-boeing-747-upper-deck-hump-nearly-impossible-replicate-modern-jet/)
- [SimpleFlying — "Why The Boeing 747SP's Ultra-Long-Range Fuselage Design Will Be Nearly Impossible To Replicate In 2026"](https://simpleflying.com/boeing-747sp-fuselage-design/)
- [Smithsonian Air & Space Magazine — "How the 747 Got Its Hump"](https://www.smithsonianmag.com/air-space-magazine/how-the-747-got-its-hump-4578877/)
- [SimpleFlying — "What Is A Cheatline On An Aircraft Livery?"](https://simpleflying.com/aircraft-livery-cheatline/)
- [Dretloh.com — "Why Aren't the Windows Aligned with the Seats in Aircraft?"](https://dretloh.com/airplane-windows/)
- [Airliners.net forum — "Frame Pitch or Window Spacing Data"](https://www.airliners.net/forum/viewtopic.php?t=1340405)
- [Airliners.net forum — "How Are Engines Numbered?"](https://www.airliners.net/forum/viewtopic.php?t=737945)
- [Farnborough Air Sciences Trust — "Aircraft on Display: Boeing 747-400 Winglets"](https://airsciences.org.uk/aircraft-on-display-boeing-747-400-winglets/)
- [Aircraft Recognition Guide — Boeing 747](https://www.aircraftrecognitionguide.com/boeing-747)
- [aircraftinvestigation.info — Boeing 747-8I performance](https://aircraftinvestigation.info/airplanes/Boeing_747-8I.html)
- Scholz, D. — Aircraft Design course notes, HAW Hamburg (wing sweep/dihedral/incidence cross-reference, surfaced via web search, not independently re-fetched)
# Reference: Craftsmanship for Primitives-Based 3D Models, and Widebody Landing Gear Geometry

This section supplements existing primitives-modeling reference material with two
generic, source-backed topics: (1) what separates polished from amateurish
procedurally-built 3D geometry, and (2) the real-world geometry of large
widebody-jet landing gear, for use as a scale/shape reference when modeling.
Nothing here is derived from any project-internal scoring rubric — every claim
below traces to public CG-industry practice, Three.js documentation, or public
aviation-engineering sources, cited inline.

---

## 1. Craftsmanship Principles for Primitives-Based / Procedurally-Computed 3D Models

Procedural aircraft models are built almost entirely from parametric primitives —
`BoxGeometry`, `CylinderGeometry`, `ConeGeometry`, `LatheGeometry`,
`ExtrudeGeometry` — composed and transformed in code rather than sculpted or
scanned. Because there is no sculpting pass to smooth over mistakes, the gap
between "professional" and "amateur" output in this style is almost entirely a
function of a short list of disciplined habits, not artistic talent. These
habits are standard practice across hard-surface CG modeling (games, film,
product visualization) and apply directly to code-driven Three.js scenes.

### 1.1 Consistent proportions and scale coherence

The single biggest tell of an amateur model is parts that look acceptable in
isolation but clash in relative size once assembled — a wheel too big for its
strut, a wing too thick for its span, a cockpit that reads more like a
toy-scale add-on than an integrated section of the fuselage.

Professional hard-surface workflows treat this as the *first* problem to solve,
before any detail work: block out the whole object at real (or real-feeling)
proportions first, and only then refine individual parts. The Polycount wiki's
guidance on blockouts is explicit that "the blockout is arguably the most
important stage and should not be skimped on" and that its purpose is to nail
down "the main silhouette and proportions of your asset," with actual detail
topology addressed only afterward. The same source recommends anchoring the
blockout to real-world scale — using a bounding box at known dimensions, or
reference objects of known size, rather than eyeballing each part
independently. [Polycount Wiki: Topology](http://wiki.polycount.com/wiki/Topology)

For a procedurally generated model this translates directly into code
discipline: derive every part's dimensions from a small set of shared,
named scale variables (fuselage length, fuselage diameter, wingspan) rather
than hardcoding independent magic numbers per part. When each primitive's
size is a fraction of a shared reference dimension, relative proportions stay
coherent even as the model is tuned.

### 1.2 Smooth transitions and clean intersections between primitives

Where two primitives meet — wing root to fuselage, strut to wheel, nacelle to
pylon — an amateur model shows either a visible gap, a harsh unblended seam,
or overlapping faces that flicker under the camera (z-fighting). A polished
model either fillets/blends the joint or, at minimum, ensures one primitive
cleanly and fully penetrates the other with enough overlap that no coplanar
or near-coplanar faces exist at the seam.

Z-fighting itself is a well-understood, purely mathematical artifact: it
occurs when two surfaces are close enough in depth that the depth (z-)buffer
cannot reliably resolve which is nearer, so the renderer flickers between
them per pixel, "particularly prevalent with coplanar polygons, where two
faces occupy essentially the same space, with neither in front."
[Z-fighting — Wikipedia](https://en.wikipedia.org/wiki/Z-fighting) Standard
mitigations are (a) never place two unrelated surfaces exactly coincident —
always overlap primitives by a visible margin or leave a deliberate small
air-gap that reads as a panel line rather than an error, (b) increase depth
buffer precision and keep the camera's near-clipping plane as far out as the
scene allows, since "the closer the near clipping plane is, the higher the
depth precision," and (c) as a last resort, apply a polygon offset to push
one surface fractionally behind the other. [How to Fix Z-Fighting in 3D
Graphics](https://www.mava.org/3d-graphics/)

For real fillets/blends between primitives (rather than just avoiding
overlap artifacts), true boolean/CSG operations are the standard tool:
libraries such as `three-bvh-csg` perform fast ADDITION / SUBTRACTION /
INTERSECTION operations directly on Three.js geometry, with the caveat that
"all brush geometry must be two-manifold — or water tight with no triangle
interpenetration" for reliable results, and can merge shared materials into
single draw-call groups in the output.
[three-bvh-csg (GitHub)](https://github.com/gkjohnson/three-bvh-csg)

### 1.3 Silhouette cleanliness

A model should read correctly as a recognizable shape from many angles even
if all surface detail were removed — this is the "solid drawing" principle
from classical animation, one of the twelve foundational principles laid out
by Disney animators Ollie Johnston and Frank Thomas in *The Illusion of Life*
(1981): "a solid pose should read even in silhouette... you can get a
surprising amount of information from just the silhouette." [Twelve basic
principles of animation — Wikipedia](https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation)
The same idea is standard practice in game-asset production: hard-surface
props are checked against their intended in-scene camera distance specifically
"to evaluate proportions, screen coverage, and silhouette before investing
time in small details." [Polycount Wiki: Topology](http://wiki.polycount.com/wiki/Topology)

Practically, this means: no stray primitive clipping through the outer hull
and breaking the outline (a landing-gear strut poking through a wing's upper
surface, a misplaced antenna box floating off-model), no primitive scaled or
rotated so it silently pokes out the back of another part, and a final pass
that orbits the camera around the finished model checking the outline from
front, 3/4, side, top, and rear — not just the one angle used while building it.

### 1.4 Appropriate geometric detail density on curved primitives

Curved primitives (cylinders, cones, lathed profiles) are approximated by a
finite number of flat segments, and too few segments produces visible
faceting — flat-sided polygons where a smooth curve was intended. Three.js's
own `CylinderGeometry` illustrates the expected baseline: its `radialSegments`
parameter (the number of segmented faces around the circumference) defaults
to **32**, not some minimal value, precisely because that is the point at
which a circular cross-section reads as smoothly curved at normal viewing
distances. [CylinderGeometry — three.js docs](https://threejs.org/docs/pages/CylinderGeometry.html)

The professional habit is to scale segment count to the primitive's apparent
screen size and curvature importance: a large, prominent fuselage or engine
nacelle cylinder warrants full default-or-higher segmentation, while a tiny
bolt-like cylinder buried inside an assembly can safely use far fewer
segments with no visible cost. This mirrors the general game-asset principle
that "the best low-poly mesh is not necessarily the mesh with the fewest
polygons — it is the mesh in which each important polygon has a clear visual
or functional purpose." [Polycount Wiki: Topology](http://wiki.polycount.com/wiki/Topology)
Deliberately low segment counts are also a legitimate *stylistic* choice
(faceted "low-poly" look) as long as it's paired with **flat shading** rather
than smooth-shaded low-segment geometry, which instead produces a muddy,
unintentionally-wrong look — smooth shading is meant to hide facets, so
applying it to a deliberately low-facet mesh fights the intended read.
[Three.js Geometry Guide — LearnWithHasan](https://learnwithhasan.com/threejs-guide/geometry/)

### 1.5 Consistent surface normals and shading

Every visible face needs a normal that points outward and is consistent with
its neighbors, or the model shows dark/inverted patches, hard unwanted
creases, or patchy lighting that has nothing to do with the actual shape.
Three.js provides `computeVertexNormals()` to auto-derive smooth per-vertex
normals from face geometry, but this is known to produce incorrect results
on certain generated or imported topologies — vertex normals can diverge or
average incorrectly at seams, "which can give a weirdly smoothed appearance"
if the underlying vertex welding/indexing is wrong. [three.js forum:
flatShading on BufferGeometry](https://discourse.threejs.org/t/flatshading-on-buffergeometry-or-imported-model/24241)
The professional check is simple and cheap: after generating any custom or
merged geometry, visually orbit-inspect it under a single strong directional
light — inverted normals and bad seams are immediately obvious as this
lighting test, whereas they can be invisible under flat/ambient lighting.
Choosing `flatShading: true` deliberately (each face gets its own normal,
producing hard edges) versus the smooth default is a material-level decision
that should match the intended surface — hard-surface metal panels usually
want crisp per-face normals at real edges, curved fairings want smooth
per-vertex normals.

### 1.6 Symmetry handling

Aircraft (and most vehicles) are bilaterally symmetric, and hand-building
both left and right copies of every part independently is both slower and
guarantees eventual mismatches. Standard CG practice — codified as the
"Mirror modifier" workflow in Blender, 3ds Max, and Cinema 4D — is to build
one half only and generate its mirror image by reflecting geometry across a
shared symmetry plane, which "guarantees perfect symmetry, which is hard to
achieve manually," and (with clipping enabled) "prevents vertices from
crossing the mirror plane, so the two halves stick perfectly together without
gaps or overlaps." [Blender Mirror Modifier — Blender Base Camp](https://www.blenderbasecamp.com/blender-mirror-modifier-reflect-your-models/)
In a procedural/code context, the direct equivalent is: compute geometry and
placement transforms for one side (e.g., one wing, one main-gear leg, one
engine), then instantiate the mirrored copy by negating the relevant axis
(commonly a `scale.x = -1` or an explicit mirror matrix) rather than
re-deriving separate numbers for the other side. This also means any later
tuning pass only has to edit one set of numbers to keep both sides in sync.

### 1.7 Material and color consistency, and using materials to sell surface type

A model built entirely from one flat, unlit-looking color reads as a
placeholder, not a finished object — real surfaces differ in how they
scatter light (brushed metal vs. painted panel vs. glass vs. rubber), and a
believable model differentiates them with materials, not just different hex
colors. The modern standard for this is the metalness/roughness PBR workflow,
which traces to Brent Burley's 2012 SIGGRAPH paper "Physically Based Shading
at Disney," describing "a hybrid of physically-derived mathematics,
artist-friendly parameters, and empirically-backed resulting appearances"
that directly influenced the material models in Blender's Principled BSDF,
Unity's Standard shader, and Unreal Engine.
[Physically Based Shading at Disney (Burley, 2012, PDF)](https://media.disneyanimation.com/uploads/production/publication_asset/48/asset/s2012_pbs_disney_brdf_notes_v3.pdf)
In Three.js terms this means preferring `MeshStandardMaterial` /
`MeshPhysicalMaterial` (which implement this metalness/roughness model) over
flat unlit materials, and deliberately varying `metalness` and `roughness`
per part: near-0 roughness with high metalness for polished metal skin,
higher roughness for matte composite or painted panels, and dedicated
transmission/`ior` parameters (available on `MeshPhysicalMaterial`) for glass
canopies or windows rather than a plain transparent color. Consistency
matters as much as correctness — parts belonging to the same real-world
surface (e.g., every exposed metal panel across the whole model) should share
the same metalness/roughness values so the object doesn't visually fragment
into unrelated materials.

---

## 2. Landing Gear Geometry for Large Widebody Jet Aircraft

Landing gear is one of the most geometrically distinctive — and most often
under-modeled — parts of an airliner: multiple thick struts, multi-wheel
bogies, hydraulic actuators, and door panels, all tucked into specific bays
when retracted. The following is general, publicly documented
aviation-engineering knowledge, not specific to any single aircraft type
except where a named aircraft's figures are the best-sourced illustration of
a general pattern.

### 2.1 Strut/leg configuration: tricycle layout

Essentially all modern large jet transports use a **tricycle** undercarriage:
one nose gear leg well forward of the center of gravity, and two (or more)
main gear legs positioned under the wings/fuselage, aft of the center of
gravity. Wikipedia's summary of the arrangement: it "consists of two main
wheels (or wheel assemblies) under the wings and a third smaller wheel in the
nose," and this layout displaced the older tailwheel ("taildragger")
configuration on essentially all large aircraft because it is more stable on
the ground and easier to control at low speed.
[Landing gear — Wikipedia](https://en.wikipedia.org/wiki/Landing_gear)
On a widebody, the two "main" positions are not single wheels — each is a
**bogie**, a multi-wheel truck carried on the end of one strut. Narrowbody
jets typically use a simple twin-wheel leg per side, while "widebody
aircraft [use] multiple-axle bogies on main legs." [Landing gear —
Wikipedia](https://en.wikipedia.org/wiki/Landing_gear)

### 2.2 Wheel count and bogie arrangement for heavy aircraft

More wheels exist purely to spread the aircraft's weight over a larger
ground-contact footprint, keeping the load-per-wheel and pavement loading
within runway limits as aircraft have grown heavier: "as aircraft weights
have increased more wheels have been added and runway thickness has increased
to keep within the runway loading limit... the number of wheels included in
the bogie is a function of the gross design weight of the aircraft."
[Landing gear — Wikipedia](https://en.wikipedia.org/wiki/Landing_gear)
Bogies also improve touchdown dynamics: on a multi-wheel bogie, "first the
rear wheels of the bogie touch down, and, when the landing gear oleo is
compressed sufficiently, the front wheels of the bogie also touch down,"
smoothing the load transfer instead of a single hard impact.
[Landing Gear Bogies — Mentour Pilot](https://mentourpilot.com/landing-gear-bogies-a-humble-but-vital-innovation/)

Representative wheel counts for large widebody types, all following a
2-wheel nose gear plus multi-wheel main bogies pattern:

| Aircraft | Nose gear | Main gear | Total wheels |
|---|---|---|---|
| Boeing 747 | 2 wheels | 4 legs × 4-wheel bogie = 16 wheels (two wing-root legs + two body legs) | 18 |
| Boeing 777 | 2 wheels | 2 legs × 6-wheel bogie = 12 wheels | 14 |
| Airbus A380 | 2 wheels | 2 wing legs × 4-wheel bogie + 2 body legs × 6-wheel bogie = 20 wheels | 22 |

Sources: 747 configuration — "the remaining 16 tires are mounted on four
separate main landing gear units, each containing four wheels" [Why The
Boeing 747's Main Gear Needs 16 Tires — Simple
Flying](https://simpleflying.com/why-boeing-747-main-gear-16-tires/), and the
747's "four main landing gear legs, each with a four-wheel bogie... two on
the wing roots and two beneath the main fuselage" [Boeing 747 —
Wikipedia](https://en.wikipedia.org/wiki/Boeing_747). 777 configuration —
"two six-wheel bogies on the main landing gear (12 tires total)" [Why The
Boeing 777's Main Gear Needs 12 Tires — Simple
Flying](https://simpleflying.com/boeing-777s-main-gear-12-tires/). A380
configuration — "a total of 22 wheels: 2 on the nose gear and 20 across the
main landing gear (including two underwing bogies and two six-wheel body
gear assemblies)" [Why The Airbus A380's Main Landing Gear Needs 20 Tires —
Simple Flying](https://simpleflying.com/airbus-a380-main-landing-gear-20-tires/),
corroborated by Wikipedia's description of the A380's "four-wheel bogie under
each wing with two sets of six-wheel bogies under the fuselage." [Undercarriage
arrangements — Wikipedia](https://en.wikipedia.org/wiki/Undercarriage_arrangements)
For contrast, smaller widebodies use fewer, smaller bogies — the 787-10 has
notably fewer wheels than the similarly sized A350-1000, illustrating that
bogie size scales with design weight rather than being fixed by "widebody"
status alone. [Why Does the 787-10 Have Fewer Wheels Than the A350-1000? —
Simple Flying](https://simpleflying.com/why-boeing-787-10-dreamliner-fewer-wheels-airbus-a350-900/)

For a modeler, the practical takeaway is: nose gear = a single strut with a
simple 2-wheel axle (no bogie beam); main gear = a shorter, much thicker
strut terminating in a rectangular bogie beam that itself carries 4–6 wheels
in a 2-wide × 2-or-3-long pattern, with the bogie beam typically tilted
slightly nose-up in the extended/rolling position and leveling as the strut
compresses.

### 2.3 Retraction direction and stowage bay location

Nose gear on large jets almost universally retracts **forward** (toward the
nose), folding up into a bay directly beneath and just aft of the cockpit
floor. This detail is deliberate, not incidental: forward retraction means
that if hydraulic power is lost, aerodynamic drag/airflow during a
gravity-drop extension helps drive the gear the rest of the way down and
into its locked position — "the nose gear retracts forward towards the
cockpit, because in case of a gravity extension, the airflow, with the help
of aerodynamic forces, locks down the nose gear," acting as "a fail-safe
system as part of the safety mechanism on commercial airliners." [Why Do
Airliners' Nose Wheels Retract Forward? — Simple
Flying](https://simpleflying.com/why-nose-wheels-retract-forward/)

Main gear on widebodies retracts **inward and upward**, folding into wheel
wells at the wing root / lower fuselage keel area — legs mounted directly
under the wing (like the 747's wing-root legs) fold up into the wing-to-body
fairing, while additional body-mounted legs (like the 747's and A380's extra
fuselage-mounted bogies) fold up into dedicated bays in the belly, with
hydraulic actuation compressing "the springs, displaces the downlocks, and
allows gear retraction inward into the wheel well in the wing root next to
the fuselage keel." [A320 Landing Gear Retraction —
LinkedIn/Paras Jain](https://www.linkedin.com/pulse/a320-landing-gear-retraction-paras-jain-kcu9f)
For a modeler this means: nose-gear bay opening faces forward-down under the
cockpit; main-gear bays are large rectangular openings in the wing-root
fairing and/or lower fuselage sides, aft of mid-fuselage, sized to fully
swallow the bogie sideways/upward — not straight up into the wing itself,
since the wing's structural box and fuel tankage occupies that space.

### 2.4 Relative proportions — sizing gear against the fuselage

Landing gear needs to be tall enough to give the engines, wingtips, and tail
adequate clearance during takeoff rotation (nose-up pitch) and landing flare,
while not adding excess weight/drag: "aircraft with large engine fan
diameters, long fuselages, long wings... may use a tall landing gear
structure to provide ground clearance to the engine and sufficient clearance
during take-off... longer aircraft requiring taller landing gear to achieve
the take-off angle-of-attack." [Semi-levered shrink landing gear — USPTO
patent 11,827,342](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11827342)
The same document gives comparative underwing engine ground-clearance figures
for several widebodies at maximum takeoff weight: roughly 0.7–0.8 m
(A350-900 ≈ 0.74 m, A330-300 ≈ 0.69 m, 787-8 ≈ 0.71 m, 777-200LR ≈ 0.77 m) —
i.e., the lowest point of the engine nacelle sits well under a meter above
the runway even on a fully-loaded widebody, which is a useful sanity check
for engine-pylon-to-ground distance in a model. For the fuselage itself, a
747-400 at maximum weight is reported with roughly **1.9 m** of clearance
under the belly. [Ground height of today's wide-bodies —
Airliners.net](https://www.airliners.net/forum/viewtopic.php?t=1438971)
Against a fuselage cross-section on the order of 6–6.5 m across for a
747-class jet, that puts the *extended* main-gear leg length (strut + bogie,
floor-to-belly) at roughly a third to a half of the fuselage diameter — tall
enough to be visually prominent under the wing/belly, but clearly shorter
than the fuselage is wide. Practically: don't model gear legs as thin
toothpick-like struts dangling a token distance below the belly — they
should read as substantial, load-bearing members whose bogie sits roughly a
third to half a fuselage-diameter below the lower fuselage line, with the
strut itself being one of the thickest cylindrical members on the whole
model (comparable in diameter to a jet engine's smaller accessory ducting,
not to a thin landing strut on a light aircraft).

### 2.5 Visual distinguishing features: gear doors and strut fairings

Two features make retractable gear immediately readable in a rendered image:
**gear doors** and **strut/leg fairings**. Gear doors are hinged or sliding
panels that close over the wheel-well opening once the gear is retracted, so
the fuselage/wing outer surface looks unbroken in cruise — "landing gear
doors cover and protect the retracted landing gear when not in use," and
practical door assemblies are commonly built as "a pair of opposing hinged or
sliding doors and/or panels that move relative to landing components so as
to enclose or expose the landing component." [What to Know About Aircraft
Fairings](https://www.asap-aviationprocurement.com/blog/aircraft-fairings-and-their-types/)
On a gear-down (extended) model, these doors are the flat, often
slightly-larger-than-the-strut panels visible flanking the gear bay opening —
some stay open the whole time gear is down (main gear bay doors are commonly
left open in flight-down configuration and only close once gear is fully
retracted), which is why real reference photos of taxiing/landing widebodies
usually show visible open bay doors framing the gear leg.

Strut fairings are separate streamlined covers wrapped around the exposed
strut and its hydraulic/electrical lines to reduce drag and noise in the
brief period the gear is extended: "fixed undercarriages can be made more
aerodynamic through the use of streamlined struts and fairings to cover the
wheels and landing gear legs," and dedicated noise-reduction fairings are
built to "attach to the shock strut via existing hydraulic and electrical
brackets, extending from the door around the front of the shock strut and
around the side of the gear." [Landing gear with noise reduction fairing —
USPTO patent 8,490,914](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8490914)
Visually, this means a strut is rarely a single bare cylinder: expect a
slightly tapered or stepped fairing sleeve around the upper strut (the part
nearest the wing/fuselage, where it retracts into), an exposed lower oleo
(shock-absorber) section that is visibly a simpler plain cylinder (the
polished/chromed piston that telescopes in and out), and the bogie beam plus
axles below that carry the wheels. A row of hinge-mounted flat door panels
adjacent to the bay opening, plus a visible torque-link scissor mechanism on
the lower strut (which keeps the wheels aligned fore-aft without letting the
piston rotate), are the small details that read as "real landing gear" rather
than a generic cylinder-and-wheel stand-in.

---

## Sources

- [Polycount Wiki: Topology](http://wiki.polycount.com/wiki/Topology) — blockout-first workflow, proportions, silhouette/screen-coverage checks, "important polygon" principle
- [Z-fighting — Wikipedia](https://en.wikipedia.org/wiki/Z-fighting) — depth-buffer precision artifact definition and cause
- [How to Fix Z-Fighting in 3D Graphics — mava.org](https://www.mava.org/3d-graphics/) — practical mitigations (clip-plane placement, polygon offset)
- [three-bvh-csg (GitHub)](https://github.com/gkjohnson/three-bvh-csg) — CSG boolean operations for Three.js, manifold-geometry requirement, material merging
- [Twelve basic principles of animation — Wikipedia](https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation) — "solid drawing" / silhouette-readability principle, Johnston & Thomas, *The Illusion of Life* (1981)
- [CylinderGeometry — three.js docs](https://threejs.org/docs/pages/CylinderGeometry.html) — default `radialSegments` = 32 as the smooth-curve baseline
- [Three.js Geometry Guide — LearnWithHasan](https://learnwithhasan.com/threejs-guide/geometry/) — flat vs. smooth shading and intentional low-poly faceting
- [three.js forum: flatShading on BufferGeometry](https://discourse.threejs.org/t/flatshading-on-buffergeometry-or-imported-model/24241) — `computeVertexNormals()` pitfalls, smoothing artifacts
- [Blender Mirror Modifier — Blender Base Camp](https://www.blenderbasecamp.com/blender-mirror-modifier-reflect-your-models/) — mirror/symmetry workflow, clipping to avoid seams
- [Physically Based Shading at Disney (Burley, 2012, PDF)](https://media.disneyanimation.com/uploads/production/publication_asset/48/asset/s2012_pbs_disney_brdf_notes_v3.pdf) — origin of the metalness/roughness PBR material model
- [Landing gear — Wikipedia](https://en.wikipedia.org/wiki/Landing_gear) — tricycle configuration, bogie definition, wheel-count-vs-weight rationale, retraction/wheel-well generalities
- [Undercarriage arrangements — Wikipedia](https://en.wikipedia.org/wiki/Undercarriage_arrangements) — bogie/tandem evolution, A380 bogie description
- [Boeing 747 — Wikipedia](https://en.wikipedia.org/wiki/Boeing_747) — 747 main/nose gear wheel configuration
- [Why The Boeing 747's Main Gear Needs 16 Tires — Simple Flying](https://simpleflying.com/why-boeing-747-main-gear-16-tires/)
- [Why The Boeing 777's Main Gear Needs 12 Tires — Simple Flying](https://simpleflying.com/boeing-777s-main-gear-12-tires/)
- [Why The Airbus A380's Main Landing Gear Needs 20 Tires — Simple Flying](https://simpleflying.com/airbus-a380-main-landing-gear-20-tires/)
- [Why Does the 787-10 Have Fewer Wheels Than the A350-1000? — Simple Flying](https://simpleflying.com/why-boeing-787-10-dreamliner-fewer-wheels-airbus-a350-900/)
- [Landing Gear Bogies — A Humble But Vital Innovation! — Mentour Pilot](https://mentourpilot.com/landing-gear-bogies-a-humble-but-vital-innovation/)
- [Why Do Airliners' Nose Wheels Retract Forward? — Simple Flying](https://simpleflying.com/why-nose-wheels-retract-forward/)
- [A320 Landing Gear Retraction — Paras Jain, LinkedIn](https://www.linkedin.com/pulse/a320-landing-gear-retraction-paras-jain-kcu9f)
- [Semi-levered shrink landing gear — USPTO patent 11,827,342](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11827342) — gear-height-vs-rotation-clearance rationale, comparative engine ground-clearance figures
- [Ground height of today's wide-bodies — Airliners.net forum](https://www.airliners.net/forum/viewtopic.php?t=1438971) — reported 747-400 belly ground clearance (~1.9 m)
- [What to Know About Aircraft Fairings — ASAP Aviation Procurement](https://www.asap-aviationprocurement.com/blog/aircraft-fairings-and-their-types/) — gear door and fairing purpose/construction
- [Landing gear with noise reduction fairing — USPTO patent 8,490,914](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8490914) — strut fairing construction detail

General claims about hard-surface modeling craft (segment-density scaling by
screen prominence, per-part normal consistency checks under directional
lighting, shared-scale-variable proportioning in procedural code, and the
overall "blockout → detail" sequencing) reflect widely-established CG
production practice rather than any single citable source, consistent with
the Polycount and Three.js documentation cited above.


# Addendum: Wing Geometry Hard Numbers + Primitive-Construction Recipes

*Supplements §2 (Wing Geometry) with (A) absolute chord/thickness numbers and the planform conventions that reconcile the taper-ratio disagreement flagged in §2, (B) primitive/low-poly construction technique for swept, doubly-tapered, fuselage-faired wings, and (C) Three.js recipes for baking sweep and taper into primitives. Every figure traces to a public spec or public modeling/engineering source, cited inline.*

## A. Wing Geometry — Absolute Chord, Span, and Two Kinds of Taper

### A.1 Hard numbers (747-400 baseline unless noted)
| Parameter | Value | Source |
|---|---|---|
| Theoretical root chord (centreline) | 16.56 m | aircraftinvestigation.info |
| Reference root chord (Jane's) | 14.63 m (48 ft) | Jane's |
| Tip chord | 4.06 m (13 ft 4 in) | Jane's / aircraftinvestigation.info |
| Wingspan (no winglets) | 59.64 m (-100) → 64.44 m (-400) | aircraftinvestigation.info |
| Gross wing area | 511 m² (-100); 525–541 m² (-400, convention-dependent) | aircraftinvestigation.info (525) / Jane's (541.16) |
| Aspect ratio | 6.96 (-100) → 7.7–7.91 (-400) | Jane's (7.7) / aircraftinvestigation.info (7.91) |
| Quarter-chord sweep | 37°3′ (≈37.05°) Jane's; ~35.5° other design tables | Jane's; cf. §2 |
| Leading-edge sweep (silhouette) | ~37.5° | §2 [Wikipedia] |
| Dihedral (at rest) | 7° | Jane's / aircraftinvestigation.info |
| Incidence | 2° | Jane's / aircraftinvestigation.info |
| t/c — inboard / mid / outboard / avg | 13.44% / 7.8% / 8% / 10.7% | Jane's; avg aircraftinvestigation.info |
| Airfoil sections | Boeing "BAC" supercritical: root BAC 463–468, tip 469–474 | UIUC airfoil guide; PPRuNe airfoil thread |

### A.2 Why taper ratio is cited as both ~0.245 and ~0.278 (resolved)
A transport wing is defined as a **trapezoidal reference wing** whose edges extend straight to the aircraft centreline; that **notional centreline chord** is larger than the **exposed root chord** at the wing-fuselage junction. Taper ratio = tip ÷ *notional centreline* chord.
- Centreline chord 16.56 m: 4.06 / 16.56 = **0.245** (aircraftinvestigation.info).
- Jane's reference root 14.63 m: 4.06 / 14.63 = **0.278** (matches §2's ~0.275 family).
Both are correct — different root-chord definitions. **For a single-primitive wing, pick one root chord and derive tip as ~0.25–0.28× of it.** [lissys.uk — Piano Geometric Specs]

### A.3 Inboard trailing-edge extension ("Yehudi") — refinement to §2
§2's "no separate outboard 'kink' panel" is correct **about the leading edge and outboard wing** — the LE is one continuous straight sweep to the tip. Read it alongside one nuance: the **trailing edge** has an inboard extension, the **Yehudi** — an extra triangular area along the inboard TE that increases root chord/structural depth and houses the inboard main-gear mount. This is why a pure trapezoid from 16.56 m centreline chord × 4.06 m tip over full span overshoots the true ~525–541 m². [airliners.net — TE kink; lissys.uk]
- **Simplest correct primitive:** one straight-swept tapered panel per side (ignore Yehudi). Reads as a 747 in silhouette.
- **One step better:** wide inboard "glove" panel (near-constant large chord, little TE sweep) + tapered outboard panel whose LE aligns with the inboard LE — reproduces the visible TE crank near the inboard-engine station.

### A.4 Derived modeling ratios (arithmetic from the cited absolutes)
- **Span vs. fuselage length:** 64.44 / 70.66 = **0.91** → wing spans ~0.9× body length.
- **Root chord vs. length:** 14.63 / 70.66 ≈ **0.21** → root chord ≈ one-fifth of body length.
- **Two independent tapers (key point):** chord tapers 14.63→4.06 m (≈**3.6:1**); t/c *also* falls 13.44%→~8%. Absolute thickness therefore tapers 14.63×0.1344≈1.97 m at root → 4.06×0.08≈0.33 m at tip ≈ **6:1** — the wing thins *faster* than it narrows. Model both, or the tip reads as a plank.
- **Sweep offset:** over exposed semi-span ~(64.44−6.5)/2 ≈ 29 m, a 37.5° LE sweep pushes the tip LE aft by 29·tan37.5° ≈ **22 m**.
- **Dihedral rise:** at 7°, tip sits 29·tan7° ≈ **3.6 m** above the root plane.

## B. Primitive / Low-Poly Construction Technique

### B.1 Blockout the trapezoid first, from shared scale variables
Place root/tip chord lines at the A.1 numbers (as fractions of a shared `fuselageLength`), span ~0.9× length, and check the silhouette before refining — the blockout is the most important stage; anchor to real-world scale, not eyeballed per part. Derive tip chord, thickness, sweep offset, and dihedral rise from the *same* root/length variables so proportions stay coherent under later tuning. [Polycount — Topology]

### B.2 Build sweep + double taper into one primitive per side
A swept, tapered wing is a **frustum**, not a box: the tip section is a scaled-down, aft-shifted, thinner copy of the root. Two equivalent strategies: (1) a **tapered 4-sided frustum** (cylinder, 4 radial segments; unequal top/bottom radii give chord taper; a non-uniform flatten makes the aerofoil-ish lens); (2) a **sheared, per-station-scaled box** (shear bakes constant sweep; scale the tip cross-section down in chord *and* thickness for the double taper). Either way, apply **dihedral** (~7° about the fore-aft axis) and **incidence** (~2° about the spanwise axis) *after* shaping, then position and mirror.

### B.3 Fair the wing root into the belly — don't just intersect
The wing-fuselage seam is the most amateur-prone join; real aircraft cover it with a **wing-root fairing** (variable-radius blend). Cheapest first:
- **Overlap generously** — bury the root ~1–2 fuselage-radii in so no coplanar faces meet at the surface (hides the intersection, avoids z-fighting). [Z-fighting — Wikipedia]
- **Add a belly fillet primitive** — a stretched low-radius rounded box or squashed half-cylinder along the root/belly join, tapering fore and aft; reads as the fairing and covers the seam. [airplanes3d; Airfield Models]
- **Keep the fairing longer than the root chord**, extending aft past the trailing edge.

### B.4 Symmetry
Build one wing fully (shape + sweep + dihedral + fairing + engines), then mirror across the fuselage centreline (`scale.x = -1` or an explicit mirror matrix) rather than re-deriving numbers — guarantees perfect symmetry and confines later tuning to one side. [Blender Mirror Modifier]

## C. Three.js Recipes for Tapered/Swept Primitives

### C.1 `CylinderGeometry` radiusTop/radiusBottom — the built-in taper
`new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, …)` — unequal radii yield a frustum/cone. Correct for round tapered members (nacelles, tail cone, aft fuselage) and, with `radialSegments: 4` + a flatten, for a wing:
```js
const span = 29;                       // exposed semi-span (m)
const g = new THREE.CylinderGeometry(
  4.06 / 2,   // radiusTop ≈ half tip chord
  14.63 / 2,  // radiusBottom ≈ half root chord → chord taper
  span, 4, 1  // 4 radial segments = rectangular section
);
g.rotateY(Math.PI / 4);                // square-on the chord/thickness axes
g.scale(1, 1, 0.12);                   // flatten thickness → t/c ~13% at root end
```

### C.2 Bake sweep with a shear matrix; taper with per-station vertex scaling
A single affine scale cannot taper a box (it scales every station equally). Sweep, however, *is* a shear. Combine baked shear (sweep) with per-vertex chord+thickness scaling (double taper):
```js
const root = 14.63, tip = 4.06, thickRoot = 1.97, span = 29;
const sweepTan = Math.tan(THREE.MathUtils.degToRad(37.5));

// X = spanwise (0→span), Z = chordwise, Y = thickness.
const g = new THREE.BoxGeometry(span, thickRoot, root, 8, 1, 1);
g.translate(span / 2, 0, 0);           // root at x=0, tip at x=span

// 1) Bake constant sweep: shift chordwise (Z) aft as span (X) grows.
g.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, sweepTan, 0)); // zx = tanΛ

// 2) Double taper: scale each vertex's chord (Z) and thickness (Y) by span fraction.
const pos = g.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const t = THREE.MathUtils.clamp(pos.getX(i) / span, 0, 1); // 0 root → 1 tip
  pos.setZ(i, pos.getZ(i) * THREE.MathUtils.lerp(1, tip / root, t));
  pos.setY(i, pos.getY(i) * THREE.MathUtils.lerp(1, (tip * 0.08) / thickRoot, t)); // thins faster
}
pos.needsUpdate = true;
g.computeVertexNormals();
g.rotateX(THREE.MathUtils.degToRad(7)); // dihedral about fore-aft axis
```
`makeShear(xy,xz,yx,yz,zx,zy)` — the `zx` term does `z += tanΛ·x`, sweeping every chordwise station aft by the same angle; `applyMatrix4` bakes the transform into vertex coordinates. After any per-vertex edit, call `computeVertexNormals()` and orbit-inspect under one directional light to catch inverted/averaged normals.

### C.3 `ExtrudeGeometry` cautions under a primitives-only budget
Flexible but heavy for this job: `curveSegments`/`steps`/`bevelSegments` multiply triangle count fast (each doubling ~quadruples triangles); bevel/cap artifacts can produce near-coplanar or non-manifold faces that z-fight or break CSG (which needs two-manifold, watertight brushes). **Rule of thumb:** prefer `BoxGeometry`/`CylinderGeometry` + baked shear/taper for the wing; reserve `ExtrudeGeometry` for genuinely 2-D-profile parts (winglet plate, flap-track fairing) with `bevelEnabled: false` and low `steps`.

## Addendum Sources
- aircraftinvestigation.info — Boeing 747-400 (https://aircraftinvestigation.info/airplanes/Boeing_747-400.html) & 747-100 (https://aircraftinvestigation.info/airplanes/747-100.html)
- Jane's — Boeing 747-400 (https://janes.migavia.com/usa/boeing/boeing-747-400.html)
- lissys.uk — Piano, Ch.03 Geometric Specifications (https://lissys.uk/pug/c03.html)
- airliners.net — Kink on trailing edge, Airbus vs Boeing wings (https://www.airliners.net/forum/viewtopic.php?t=764529)
- UIUC — The Incomplete Guide to Airfoil Usage, M. Selig (https://m-selig.ae.illinois.edu/ads/aircraft.html)
- PPRuNe — NACA airfoil for 737 classic / 744 (https://www.pprune.org/tech-log/226843-what-naca-airfoil-737-classic-744-a.html)
- three.js docs — CylinderGeometry (https://threejs.org/docs/pages/CylinderGeometry.html), Matrix4 (https://threejs.org/docs/pages/Matrix4.html), BufferGeometry.applyMatrix4 (https://threejs.org/docs/#api/en/core/BufferGeometry.applyMatrix4), ExtrudeGeometry (https://threejs.org/docs/#api/en/geometries/ExtrudeGeometry)
- LearnWithHasan — Three.js Geometry Guide (https://learnwithhasan.com/threejs-guide/geometry/)
- airplanes3d — Modeling Wing Root Fairing 1 & 2 (https://airplanes3d.wordpress.com/2015/11/07/modeling-wing-root-fairing-1/, https://airplanes3d.wordpress.com/2015/11/14/modeling-wing-root-fairing-2/)
- Airfield Models — Fuselage-to-Wing Fairing (https://www.airfieldmodels.com/information_source/how_to_articles_for_model_builders/construction/wing_construction/13.htm)
- Polycount Wiki — Topology (http://wiki.polycount.com/wiki/Topology)
- three-bvh-csg (https://github.com/gkjohnson/three-bvh-csg); Z-fighting — Wikipedia (https://en.wikipedia.org/wiki/Z-fighting); Blender Mirror Modifier (https://www.blenderbasecamp.com/blender-mirror-modifier-reflect-your-models/)
