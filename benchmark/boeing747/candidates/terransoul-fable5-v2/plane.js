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
// Next targets: nose taper, aft tail cone, root-to-tip thickness taper.
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0xd8dde3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b7280 });

  // Fuselage: single cylinder along +X (nose = +X per the frozen contract).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 24), grey);
  fuselage.rotation.z = -Math.PI / 2;
  group.add(fuselage);

  // Wings (iter 7): real 747 planform — two swept tapered surfaces built like
  // the tail stabs (planform drawn chordwise-x / spanwise-y, extruded to
  // thickness, rolled about X so the span lands on +-Z with the thickness
  // pointing up). Leading edge swept ~37.5 deg (0.767 aft per unit span),
  // root chord 15 (LE x=9.5 just aft of the hump fade, TE x=-5.5) tapering to
  // 3.5 at the tip, semi-span 27.5 -> span ~55 ~ 0.9x the 60-long body,
  // ~6.9 deg dihedral. Low-mounted: root underside y=-2.3 buried in the lower
  // lobe (hull half-width there ~1.9) with both roots meeting on the
  // centerline, so each surface emerges from the belly with no gap.
  const WING_DIHEDRAL = 0.12; // ~6.9 deg
  const WING_SWEEP = 0.767; // tan ~37.5 deg — LE aft-shift per unit span
  const WING_ROOT_LE = 9.5;
  const WING_ROOT_Y = -2.3;
  const WING_SEMISPAN = 27.5;
  const wingLEx = (s) => WING_ROOT_LE - WING_SWEEP * s; // local leading-edge x
  const wingUnderY = (s) => WING_ROOT_Y + Math.sin(WING_DIHEDRAL) * s; // local underside y
  for (const side of [1, -1]) {
    const wingShape = new THREE.Shape();
    wingShape.moveTo(WING_ROOT_LE, 0); // root leading edge
    wingShape.lineTo(wingLEx(WING_SEMISPAN), side * WING_SEMISPAN); // tip LE
    wingShape.lineTo(wingLEx(WING_SEMISPAN) - 3.5, side * WING_SEMISPAN); // tip TE
    wingShape.lineTo(-5.5, 0); // root trailing edge
    wingShape.closePath();
    const wing = new THREE.Mesh(
      new THREE.ExtrudeGeometry(wingShape, { depth: 1.0, bevelEnabled: false }),
      dark
    );
    wing.rotation.x = -Math.PI / 2 + side * WING_DIHEDRAL;
    wing.position.y = WING_ROOT_Y;
    group.add(wing);
  }

  // Engines: four underslung pylon-mounted nacelles (747 layout), restaggered
  // along the swept leading edge — inboard pair at 40% semi-span, outboard at
  // 69% — each hung below the LOCAL wing underside (which rises with the
  // dihedral) with the inlet poking ~3 ahead of the local leading edge and a
  // darker open inlet face.
  const nacelleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad });
  const inletMat = new THREE.MeshStandardMaterial({ color: 0x22262c });
  for (const side of [1, -1]) {
    for (const s of [11, 19]) {
      const le = wingLEx(s);
      const under = wingUnderY(s);
      const z = side * s * Math.cos(WING_DIHEDRAL);

      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.5, 20), nacelleMat);
      nacelle.rotation.z = -Math.PI / 2;
      nacelle.position.set(le + 0.7, under - 1.35, z);
      group.add(nacelle);

      const inlet = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 20), inletMat);
      inlet.rotation.z = -Math.PI / 2;
      inlet.position.set(le + 2.9, under - 1.35, z);
      group.add(inlet);

      // Pylon spans from just inside the wing (top y = under+0.1) down past
      // the nacelle crown, so both ends stay embedded — nothing floats.
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 0.35), dark);
      pylon.position.set(le - 0.6, under - 0.85, z);
      group.add(pylon);
    }
  }

  // Empennage (iter 6): the old unswept rectangle fin becomes a real 747
  // tail. Vertical stabilizer: tall (tip y=11.4, ~8.4 above the crown, the
  // 747's ~10m-over-70m ratio), leading edge swept ~38 deg, near-vertical
  // trailing edge kept 0.1 ahead of the aft rim so its face never goes
  // coplanar with the tail cap, root chord buried ~0.8 into the crown so
  // nothing floats.
  const finShape = new THREE.Shape();
  finShape.moveTo(-19.5, 2.2); // root leading edge
  finShape.lineTo(-26.8, 11.4); // tip leading edge — swept back ~38 deg
  finShape.lineTo(-29.6, 11.4); // tip trailing edge
  finShape.lineTo(-29.9, 2.2); // root trailing edge, just ahead of the rim
  finShape.closePath();
  const fin = new THREE.Mesh(
    new THREE.ExtrudeGeometry(finShape, { depth: 0.5, bevelEnabled: false }),
    dark
  );
  fin.position.z = -0.25;
  group.add(fin);
  // Low-mounted swept horizontal stabilizers with dihedral: planform drawn
  // chordwise-x / spanwise-y, extruded to thickness, then rolled about X by
  // -90deg +- dihedral so the span lands on -+Z with tips rising and the
  // thickness pointing up. Span 17 (~31% of the wingspan, the 747 ratio);
  // both roots meet on the centerline deep inside the hull (half-width at
  // y=-0.6 is ~2.94), so each surface emerges from the skin with no gap, and
  // tip trailing edges reach x=-30.6, just past the tail like the reference
  // planform.
  const TAIL_DIHEDRAL = 0.14; // ~8 deg
  for (const side of [1, -1]) {
    const stabShape = new THREE.Shape();
    stabShape.moveTo(-23.4, 0); // root leading edge
    stabShape.lineTo(-28.8, side * 8.5); // tip leading edge — swept ~32 deg
    stabShape.lineTo(-30.6, side * 8.5); // tip trailing edge
    stabShape.lineTo(-28.9, 0); // root trailing edge
    stabShape.closePath();
    const stab = new THREE.Mesh(
      new THREE.ExtrudeGeometry(stabShape, { depth: 0.35, bevelEnabled: false }),
      dark
    );
    stab.rotation.x = -Math.PI / 2 + side * TAIL_DIHEDRAL;
    stab.position.y = -0.77;
    group.add(stab);
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
  const hump = new THREE.Mesh(new THREE.CapsuleGeometry(2.0, 8, 8, 24), grey);
  hump.rotation.z = -Math.PI / 2;
  hump.scale.set(1, 1.54, 1);
  hump.position.set(20.2, 2.1, 0);
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
