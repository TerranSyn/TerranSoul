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
