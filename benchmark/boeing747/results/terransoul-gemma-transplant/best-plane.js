// Boeing-747 primitives-only candidate — iterative self-improve loop.
// Iter 3: added window_door_lines detail (weakest judged feature, 0.43/10).
// Iter 4: added landing gear (weakest judged feature, 0/10 on the claude
// track): two-wheel nose strut + four 4-wheel main bogies in the 747 layout —
// body pair near the centerline, wing pair outboard — struts reaching the
// belly / wing underside, wheel axles along Z, matching the gear-down side
// reference.
// Iter 5: added the partial-length upper-deck hump (weakest judged feature,
// 0.71/10 on the claude track): a lengthwise-stretched capsule lobe embedded
// in the crown, running from the cockpit back to ~1/3 of the fuselage, with a
// dark wrap-around cockpit band on its brow and a second row of upper-deck
// panes on its flanks. The old floating visor block and flat-nose panes are
// replaced by these.
// Iter 6: rebuilt the empennage (weakest judged feature, 3/10 on the claude
// track — unswept rectangle fin, zero horizontal stabilizers): tall swept
// tapered vertical stabilizer (ExtrudeGeometry trapezoid, ~38 deg LE sweep,
// near-vertical TE, root buried in the crown) plus low-mounted swept tapered
// horizontal stabilizers with ~8 deg dihedral spanning ~31% of the wingspan.
// Iter 7: rebuilt the wings (weakest judged feature, 3/10 on the claude
// track — "single rectangular unswept, untapered slab"): the flat box becomes
// two swept tapered dihedraled surfaces (same ExtrudeGeometry trapezoid
// pattern as the tail stabs), ~37.5 deg LE sweep, root chord 15 -> tip 3.5,
// span ~55 (~0.9x body), ~6.9 deg dihedral, low-mounted with roots buried in
// the lower lobe. The four nacelles restagger along the swept leading edge at
// the LOCAL wing height, so profile views show two staggered engines per side
// instead of one stacked block; wing-pair gear struts shortened to re-embed
// in the new lower wing underside.
// Iter 8: root-cause fix for wire-thin flight surfaces — the five
// ExtrudeGeometry surfaces (wings, fin, tailplanes) rendered with their cap
// faces MISSING in this harness: every planform face was invisible, leaving
// only the thin extrude walls (wings absent from the top view, fin a bare
// pole, nacelles seemingly floating — gemma weakest engines_four_underwing
// 4.56, claude weakest empennage 2.8). All five surfaces are rebuilt as
// sheared 4-sided CylinderGeometry frustums (diamond airfoil cross-section,
// chord+thickness taper, identical planforms); pylons deepened so they
// re-embed through the thinner diamond wing.
// Iter 9: engines_four_underwing (gemma weakest, 5.67 — "boxy blocks",
// "floating", "only two visible"; claude notes agree). Root cause: nacelles
// ~20% undersized and hung so high the outboard pair sat ABOVE the belly
// line (bottom y=-2.53 vs hull bottom -3), hiding inside the fuselage
// silhouette in profile so only the dark pylon boxes read. Nacelles resized
// to the real cowl ratio (r 1.45, len 5.6), dropped to 1.9 below the local
// underside (inboard bottom -4.33, outboard -3.38 — both clear the belly),
// inlet disc enlarged, a tapered exhaust plug added, and the pylon deepened
// into a 3.4x1.8 wedge embedded nacelle-crown-to-wing so the hang gap is
// visibly bridged.
// Next targets: nose taper, aft tail cone.
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0xf9fafb });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b7280 });

  // Fuselage: single cylinder along +X (nose = +X per the frozen contract).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 24), grey);
  fuselage.rotation.z = -Math.PI / 2;
  group.add(fuselage);

  // Lifting-surface builder (iter 8): ONE 4-sided CylinderGeometry frustum
  // per surface. With radialSegments=4 the cross-section is a diamond whose
  // vertices sit on local +-X and +-Z, so local X is a sharp-edged chord
  // (airfoil LE/TE read) and radiusBottom->radiusTop tapers chord AND
  // thickness root->tip. A manual basis matrix maps local X -> streamwise
  // chord (1,0,0), local Y -> the swept+dihedraled root->tip span line, and
  // local Z -> the thickness axis (X cross Y, length = thickness/chord
  // ratio; that ordering keeps det>0 so faces stay outward). The shear keeps
  // every cross-section streamwise, so from above the silhouette is exactly
  // the intended swept tapered trapezoid.
  const addSurface = (rootX, rootY, rootZ, tipX, tipY, tipZ, rootChord, tipChord, tRatio) => {
    const root = new THREE.Vector3(rootX, rootY, rootZ);
    const tip = new THREE.Vector3(tipX, tipY, tipZ);
    const span = new THREE.Vector3().subVectors(tip, root);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(tipChord / 2, rootChord / 2, span.length(), 4, 1),
      dark
    );
    const chordDir = new THREE.Vector3(1, 0, 0);
    const spanDir = span.clone().normalize();
    const thickDir = new THREE.Vector3().crossVectors(chordDir, spanDir).setLength(tRatio);
    mesh.matrixAutoUpdate = false;
    mesh.matrix
      .makeBasis(chordDir, spanDir, thickDir)
      .setPosition(root.add(tip).multiplyScalar(0.5));
    group.add(mesh);
  };

  // Wings: same 747 planform as iter 7 — root chord 15 (LE x=9.5 just aft of
  // the hump fade, TE x=-5.5) tapering to 3.5 at the tip, LE swept ~37.5 deg,
  // semi-span 27.5 -> span ~55 ~ 0.9x the 60-long body, ~6.9 deg dihedral.
  // Thickness = 9% of chord (1.35 root -> 0.32 tip); the mid-chord axis runs
  // root (2.0, -1.625, +-0.4) -> tip so the root underside stays at y=-2.3
  // buried in the lower lobe and the local underside keeps tracking
  // wingUnderY (pylons and the wing-pair gear struts stay embedded). Root
  // caps sit at z=+-0.4 deep inside the hull; tip caps read as squared
  // wingtips.
  const WING_DIHEDRAL = 0.12; // ~6.9 deg
  const WING_SWEEP = 0.767; // tan ~37.5 deg — LE aft-shift per unit span
  const WING_ROOT_LE = 9.5;
  const WING_ROOT_Y = -2.3;
  const WING_SEMISPAN = 27.5;
  const wingLEx = (s) => WING_ROOT_LE - WING_SWEEP * s; // local leading-edge x
  const wingUnderY = (s) => WING_ROOT_Y + Math.sin(WING_DIHEDRAL) * s; // local underside y
  for (const side of [1, -1]) {
    addSurface(
      WING_ROOT_LE - 7.5, WING_ROOT_Y + 0.675, side * 0.4,
      wingLEx(WING_SEMISPAN) - 1.75, wingUnderY(WING_SEMISPAN) + 0.16,
      side * WING_SEMISPAN * Math.cos(WING_DIHEDRAL),
      15, 3.5, 0.09
    );
  }

  // Engines (iter 9): four underslung pylon-mounted nacelles (747 layout) on
  // the swept leading edge — inboard pair at 40% semi-span, outboard at 69%.
  // Nacelles sized to the real cowl/fuselage ratio (r 1.45 vs hull r 3) and
  // dropped 1.9 below the LOCAL wing underside so both staggered engines per
  // side hang clear below the belly line (y=-3) in profile views; the inlet
  // lip pokes ~3.5 ahead of the local leading edge with a recessed darker
  // inlet disc, and a tapered dark exhaust plug closes the aft end. Each
  // hangs on a deep pylon wedge whose bottom is buried in the nacelle crown
  // and whose top is buried in the wing's diamond thickness aft of the LE
  // (top y = under+0.5, below the local top skin at the pylon's aft edge at
  // both span stations) — the hang gap is visibly bridged, nothing floats.
  const nacelleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad });
  const inletMat = new THREE.MeshStandardMaterial({ color: 0x22262c });
  for (const side of [1, -1]) {
    for (const s of [11, 19]) {
      const le = wingLEx(s);
      const under = wingUnderY(s);
      const z = side * s * Math.cos(WING_DIHEDRAL);

      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 5.6, 20), nacelleMat);
      nacelle.rotation.z = -Math.PI / 2;
      nacelle.position.set(le + 0.7, under - 1.9, z);
      group.add(nacelle);

      const inlet = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.3, 20), inletMat);
      inlet.rotation.z = -Math.PI / 2;
      inlet.position.set(le + 3.45, under - 1.9, z);
      group.add(inlet);

      // Exhaust plug: tapers rearward (rotation maps geometry top -> +X, so
      // radiusTop is the forward face butted 0.3 into the nacelle barrel).
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.55, 1.4, 16), dark);
      exhaust.rotation.z = -Math.PI / 2;
      exhaust.position.set(le - 2.5, under - 1.9, z);
      group.add(exhaust);

      const pylon = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8, 0.45), dark);
      pylon.position.set(le - 0.5, under - 0.4, z);
      group.add(pylon);
    }
  }

  // Empennage (iter 6): the old unswept rectangle fin becomes a real 747
  // tail. Vertical stabilizer: tall (tip y=11.4, ~8.4 above the crown, the
  // 747's ~10m-over-70m ratio), leading edge swept ~38 deg, near-vertical
  // trailing edge kept 0.1 ahead of the aft rim so its face never goes
  // coplanar with the tail cap, root chord buried ~0.8 into the crown so
  // nothing floats.
  // Same planform as iter 6 (root chord x=-19.5..-29.9 buried ~0.8 into the
  // crown, tip chord 2.8 at y=11.4, LE swept ~38 deg, TE just ahead of the
  // aft rim), rebuilt as a single sheared diamond frustum spanning +Y,
  // thickness 7.5% of chord (0.78 root -> 0.21 tip, well inside the crown
  // half-width ~2.04 at y=2.2).
  addSurface(-24.7, 2.2, 0, -28.2, 11.4, 0, 10.4, 2.8, 0.075);
  // Low-mounted swept horizontal stabilizers with ~8 deg dihedral: same
  // planform as iter 6 — root chord 5.5 (x=-23.4..-28.9) buried on the
  // centerline (hull half-width at y=-0.6 is ~2.94), tip chord 1.8 with the
  // tip trailing edge reaching x=-30.6 just past the tail, span ~31% of the
  // wingspan (the 747 ratio), tips rising sin(0.14)*8.5 ~ 1.19.
  for (const side of [1, -1]) {
    addSurface(-26.15, -0.6, side * 0.3, -29.7, 0.59, side * 8.72, 5.5, 1.8, 0.09);
  }

  // Landing gear (747 layout): two-wheel nose strut plus FOUR main bogies —
  // body pair near the centerline (hull bottom y=-2.4 at z=±1.8) and wing pair
  // outboard buried into the new wing (local underside y~-1.64 at z=5.5, top
  // y~-0.64, so strut tops at -0.8 sit inside the thickness). Each bogie: strut + beam
  // + four wheels (2 axles x 2). Strut tops embed into the hull/wing; wheels
  // overlap the beams so nothing floats. Wheel axles run along Z.
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1c2025 });
  const makeWheel = (r, w) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), tyreMat);
    wheel.rotation.x = Math.PI / 2;
    return wheel;
  };
  // Nose gear: strut under the nose (~12% aft of the tip), two wheels astride it.
  const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.9, 10), strutMat);
  noseStrut.position.set(23, -3.65, 0);
  group.add(noseStrut);
  for (const z of [-0.24, 0.24]) {
    const wheel = makeWheel(0.45, 0.32);
    wheel.position.set(23, -4.6, z);
    group.add(wheel);
  }
  // Main gear: bogie beams sit at y=-4.9; body pair slightly aft of the wing
  // pair like the real aircraft.
  const BOGIE_Y = -4.9;
  const bogies = [
    { x: -4.5, z: -1.8, top: -2.1 },
    { x: -4.5, z: 1.8, top: -2.1 },
    { x: -1.5, z: -5.5, top: -0.8 },
    { x: -1.5, z: 5.5, top: -0.8 },
  ];
  for (const b of bogies) {
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, b.top - BOGIE_Y, 10),
      strutMat
    );
    strut.position.set(b.x, (b.top + BOGIE_Y) / 2, b.z);
    group.add(strut);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.56), strutMat);
    beam.position.set(b.x, BOGIE_Y, b.z);
    group.add(beam);

    for (const dx of [-0.8, 0.8]) {
      for (const dz of [-0.45, 0.45]) {
        const wheel = makeWheel(0.55, 0.38);
        wheel.position.set(b.x + dx, BOGIE_Y, b.z + dz);
        group.add(wheel);
      }
    }
  }

  // Cabin glazing (window_door_lines): dark panes embedded just proud of the
  // hull so they read from every angle without z-fighting. Hull cross-section
  // is y^2 + z^2 = 9, so pane centers sit at |z| ~ 2.88 for the y=0.9 line.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1f242b });
  const doorXs = [25, 12.5, 0, -12.5, -25];
  for (const side of [1, -1]) {
    // Evenly spaced main-deck passenger windows, skipping the door slots.
    for (let wx = -25; wx <= 25.5; wx += 1.7) {
      if (doorXs.some((dx) => Math.abs(wx - dx) < 0.9)) continue;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.12), glassMat);
      pane.position.set(wx, 0.9, side * 2.88);
      group.add(pane);
    }
    // Door hints: taller rectangles breaking the line at five even stations.
    for (const dx of doorXs) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.12), glassMat);
      door.position.set(dx, 0.75, side * 2.86);
      group.add(door);
    }
  }
  // Upper-deck hump (747 signature): a capsule lobe laid along +X, stretched
  // 1.54x lengthwise so its cap ends fair gently into the crown instead of
  // ending in abrupt hemispheres. Cross-section center y=2.1, radius 2 ->
  // crest y=4.1 (~37% above the r=3 hull crown) and the lobe emerges from the
  // hull above y~2.24, giving the 747 double-bubble front cross-section. The
  // visible blister spans x~11.3..29.1: it starts at the cockpit and blends
  // down right at one third of the 60-long fuselage. Bottom (y=0.1) and
  // flanks stay buried in the hull, so nothing floats.
  const hump = new THREE.Mesh(new THREE.CapsuleGeometry(2.0, 10, 8, 24), grey);
  hump.rotation.z = -Math.PI / 2;
  hump.scale.set(1, 1.7, 1);
  hump.position.set(21.8, 2.1, 0);
  group.add(hump);
  // Cockpit glazing: a dark band concentric with the hump brow. Radius 1.7
  // sits just under the hump skin at the band's aft edge and emerges ~0.26
  // proud at its front edge, so it reads as the wrap-around 747 windshield on
  // the upper lobe from front, side, and quarter views, while staying fully
  // inside the main hull lower down (hull half-width at y=2.1 is ~2.14).
  const cockpitBand = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.6, 24), glassMat);
  cockpitBand.rotation.z = -Math.PI / 2;
  cockpitBand.position.set(28.2, 2.1, 0);
  group.add(cockpitBand);
  // Upper-deck panes: a short second dash line on the hump flanks, kept to
  // the capsule's cylindrical span (x~14..26.4) and clearly above the
  // main-deck line. Hump half-width at y=2.6 is ~1.94, so pane centers at
  // z=+-1.95 poke just proud of the lobe skin like the main-deck ones.
  for (const side of [1, -1]) {
    for (let wx = 15.2; wx <= 25.4; wx += 1.7) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.12), glassMat);
      pane.position.set(wx, 2.6, side * 1.95);
      group.add(pane);
    }
  }

  return group;
}
