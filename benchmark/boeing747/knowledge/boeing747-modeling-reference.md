# Boeing 747 — primitive-modeling design reference (AGI-pure)

Human-curated reference material for the actor's `--design-reference` RAG. These
are REAL, publicly-documented Boeing 747 facts + GENERAL Three.js primitive
technique — NOT the target/anchor plane's geometry and NOT judge-gaming. Sources:
Wikipedia 747-400, flugzeuginfo, airlinerspotter, Codrops "The Aviator".

## Real 747-400 facts (public specifications)
- Length 70.67 m, wingspan 64.44 m → **length ≈ 1.10× wingspan** (fuselage reads LONG).
- Fuselage diameter ~6.5 m → **fuselage length : diameter ≈ 10.9 : 1** (a long slender tube).
- Wing sweep **37.5°** (quarter-chord ~37°); wing **dihedral 7°**; wings **tapered** (root chord ≫ tip chord).
- **Four** underwing turbofan engines — two per wing, slung **below and forward** of the wing on pylons; inboard pair nearer the body, outboard pair further out.
- Forward **upper-deck hump**: a raised deck on TOP of the FORWARD fuselage, extending ~7.11 m rearward from just behind the cockpit. It is SMALL relative to the fuselage — never a full sphere, never wider/taller than the fuselage.
- Empennage: one **tall swept vertical fin** + two swept **horizontal stabilizers** at the tail.
- Landing gear: steerable nose gear + **four main-gear bogies** under the wing/body.

## Per-criterion modeling technique (general, primitives only)
- **RIG AXIS CONVENTION (critical — get this first):** the render cameras expect **nose along +X, up +Y, wings spanning ±Z** (`lib/cameras.mjs` line 9). Build the fuselage length along **X** (nose at +X), engines/wings out along ±Z. A plane authored on the wrong axis (e.g. fuselage along Z) renders head-on where a profile is expected and scores ~40/100 for orientation ALONE, regardless of quality.
- **silhouette_747 / fuselage_proportions**: fuselage = one long CylinderGeometry along the **+X** length axis, ~11× longer than its diameter; add a tapered nose (+X) and a tapered upswept tail cone (−X). Keep it slender.
- **wing_geometry**: each wing = a thin, tapered shape whose ROOT **overlaps the fuselage** at mid-height and near mid-length; extend it HORIZONTALLY outward (span direction), rotate to sweep it BACK ~37° and give ~7° upward dihedral. NEVER leave a wing detached from the body; NEVER rotate a wing to vertical.
- **engines_four_underwing**: FOUR nacelles (cylinders), two under EACH wing, mounted below + forward of the wing on short pylons; make the front inlet visible. Inboard + outboard.
- **upper_deck_hump**: a short raised deck (half-cylinder or low rounded box) on TOP of the forward fuselage, faired in fore and aft; small — about the size documented above.
- **empennage**: a tall swept fin standing up at the tail + two small swept horizontal stabilizers extending sideways at fuselage height.
- **landing_gear**: a nose-gear strut + several main-gear struts/wheels under the wing roots and body, pointing down (visible from below/rear views).
- **craftsmanship**: use enough radial segments on cylinders so surfaces read smooth; every part must OVERLAP/TOUCH its neighbour so the model reads as ONE solid joined aircraft (no floating or disconnected primitives); keep materials/scale consistent.
- **window_door_lines**: a straight cheatline + a regular row of small windows along the main deck, plus a short window row on the upper deck; a few door panels.
- **livery_coherence**: one consistent scheme (e.g. light crown, darker belly, a single cheatline) applied cleanly.

## General Three.js primitive technique
Build each component (fuselage, wings, engines, tail, gear) as its own primitive,
position it with `position.set(x,y,z)` and rotate for sweep/dihedral, and add all
of them to ONE parent `THREE.Group` that is returned. Parts are joined by making
their geometry OVERLAP at the seams — not by leaving gaps.
