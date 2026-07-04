// Boeing 747 — Three.js primitives only. Actor: Claude Opus 4.8 (inside TerranSoul).
// Iteration 1 of the TerranSoul self-improve loop. Orientation contract: nose +X,
// up +Y, wings span Z. Primitives only (Box/Cylinder/Sphere/Cone/Capsule/…).
//
// Design intent per the frozen rubric: slender ~70 m fuselage (ogive nose,
// upswept tail cone), iconic partial-length upper-deck hump ending ~1/3 back,
// four underwing pylon-mounted nacelles forward of the leading edge, swept
// (~37.5°) wings with dihedral + taper, tall swept vertical stabilizer + swept
// tailplane, two-wheel nose gear + four main-gear bogies, cabin-pane/door lines, and
// a coherent white/grey/blue livery. Every part is parented into the group.

export function buildPlane(THREE) {
  const group = new THREE.Group();

  // ── palette (MeshStandardMaterial) ──────────────────────────────────────────
  const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.12, ...opts });
  const WHITE = mat(0xf2f4f7);        // upper fuselage / tail
  const BELLY = mat(0xb9c0c8);        // lower fuselage / grey belly
  const BLUE = mat(0x1f4e8c);         // cheatline + tail livery
  const DARK = mat(0x2a2f36, { roughness: 0.35 }); // cabin-panes / inlets
  const ALU = mat(0x9aa3ad, { metalness: 0.35, roughness: 0.4 }); // nacelles/struts
  const TIRE = mat(0x1a1c1f, { roughness: 0.85, metalness: 0.02 });
  const HUB = mat(0x8b929b, { metalness: 0.4 });

  const add = (mesh, x, y, z, rx, ry, rz) => {
    mesh.position.set(x || 0, y || 0, z || 0);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    group.add(mesh);
    return mesh;
  };
  // A cylinder whose axis lies along +X (default cylinder axis is +Y → rotate -90° about Z).
  const tubeX = (rTop, rBottom, len, material, segs = 32) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, segs), material);

  const R = 3.15;            // fuselage radius (~6.3 m diameter)
  const BODY_LEN = 50;       // constant mid-section length
  const bodyCX = 0;          // fuselage centred on origin along X

  // ── fuselage: constant tube + ogive nose + upswept tail cone ────────────────
  add(tubeX(R, R, BODY_LEN, WHITE), bodyCX, 0, 0, 0, 0, -Math.PI / 2);

  // nose: tapering ogive forward of the tube, rounded tip
  const noseLen = 9;
  const noseX = BODY_LEN / 2 + noseLen / 2;
  add(tubeX(0.5, R, noseLen, WHITE), noseX, 0, 0, 0, 0, -Math.PI / 2);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), WHITE), noseX + noseLen / 2, 0, 0);

  // tail cone: taper to a point and sweep UP (classic 747 upswept rear)
  const tailLen = 13;
  const tailX = -(BODY_LEN / 2 + tailLen / 2);
  add(tubeX(0.7, R, tailLen, WHITE), tailX, 1.7, 0, 0, 0, -Math.PI / 2 - 0.16);

  // grey belly: a slightly larger lower half-tone via a thin lower cylinder
  add(tubeX(R * 1.001, R * 1.001, BODY_LEN + 4, BELLY), bodyCX, -0.02, 0, 0, 0, -Math.PI / 2)
    .scale.set(1, 0.6, 1); // flatten to read as a lower belly band

  // blue cheatline down the side (thin box strip both sides at cabin-pane level)
  for (const z of [R - 0.02, -(R - 0.02)]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(BODY_LEN + noseLen, 0.5, 0.06), BLUE), 2, 0.7, z);
  }

  // cabin-pane line: a row of small dark cabin-panes each side
  for (let i = 0; i < 34; i++) {
    const x = BODY_LEN / 2 - 3 - i * 1.35;
    for (const z of [R - 0.03, -(R - 0.03)]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.04), DARK), x, 1.15, z);
    }
  }
  // a couple of doors (slightly larger dark panels)
  for (const x of [16, 4, -10, -22]) {
    for (const z of [R - 0.02, -(R - 0.02)]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.05), DARK), x, 0.9, z);
    }
  }

  // ── upper-deck hump: partial-length, starts at cockpit, faired down ~1/3 back ─
  const humpLen = 17;
  const humpX = BODY_LEN / 2 - humpLen / 2 + 1.5; // front third of the body
  const hump = add(tubeX(1.7, 2.05, humpLen, WHITE), humpX, R * 0.72, 0, 0, 0, -Math.PI / 2);
  hump.scale.set(1, 1, 0.85);
  // fair the front of the hump into the crown with a sphere (cockpit lobe)
  add(new THREE.Mesh(new THREE.SphereGeometry(1.8, 20, 16), WHITE), humpX + humpLen / 2, R * 0.7, 0)
    .scale.set(1.1, 1.0, 0.85);
  // blend the rear of the hump down with a cone-ish taper
  add(tubeX(0.2, 1.9, 4.5, WHITE), humpX - humpLen / 2 - 1.5, R * 0.62, 0, 0, 0, -Math.PI / 2 + 0.25);
  // cockpit cabin-panes on the hump front
  for (const z of [1.3, -1.3, 0]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.06), DARK), humpX + humpLen / 2 - 0.2, R * 0.95, z);
  }
  // upper-deck cabin-panes
  for (let i = 0; i < 9; i++) {
    const x = humpX + humpLen / 2 - 3 - i * 1.4;
    for (const z of [1.55, -1.55]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.38, 0.05), DARK), x, R * 0.9, z);
    }
  }

  // ── wings: swept ~37.5°, dihedral, taper (span along Z) ──────────────────────
  const SWEEP = 0.655;   // ~37.5° sweep
  const DIHED = 0.11;    // ~6.3° dihedral
  // tapered planform via ExtrudeGeometry (root chord wide, tip chord narrow)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(6, 0);       // root leading edge (forward = +X)
  wingShape.lineTo(-5, 0);      // root trailing edge
  wingShape.lineTo(-9, 30);     // tip trailing edge (swept back with span)
  wingShape.lineTo(-6.5, 30);   // tip leading edge (short tip chord)
  wingShape.lineTo(6, 0);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.55, bevelEnabled: false });
  wingGeo.translate(0, 0, 0);
  // right wing (+Z)
  const wingR = new THREE.Mesh(wingGeo, WHITE);
  add(wingR, 2, -0.4, R - 0.3, Math.PI / 2 - DIHED, 0, 0); // rotate planform into XZ plane + dihedral
  // left wing (−Z) mirrored
  const wingL = new THREE.Mesh(wingGeo.clone(), WHITE);
  wingL.scale.z = -1;
  add(wingL, 2, -0.4, -(R - 0.3), Math.PI / 2 + DIHED, 0, 0);

  // ── engines: four underwing nacelles on pylons, forward of the leading edge ──
  const nacelle = (z) => {
    // z is spanwise position; nacelles sit below + ahead of the wing
    const wingYAt = -0.4 + Math.tan(DIHED) * Math.abs(z); // follow dihedral rise
    const x = 3.5 - Math.tan(SWEEP) * (Math.abs(z) - R) * 0.18; // forward of the swept LE
    const y = wingYAt - 2.1;
    // pylon
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.5), ALU), x - 0.4, y + 1.3, z);
    // nacelle cowl
    add(tubeX(1.05, 1.15, 4.2, ALU), x, y, z, 0, 0, -Math.PI / 2);
    // dark inlet ring + fan face at the front
    add(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 12, 24), DARK), x + 2.2, y, z, 0, Math.PI / 2, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), DARK), x + 2.0, y, z)
      .scale.set(0.3, 1, 1);
    // exhaust cone
    add(tubeX(0.4, 0.9, 1.2, HUB), x - 2.4, y, z, 0, 0, -Math.PI / 2);
  };
  // inboard + outboard on each wing
  nacelle(9); nacelle(17);
  nacelle(-9); nacelle(-17);

  // ── empennage: swept vertical stabilizer + swept horizontal stabilizers ──────
  // vertical fin (tall, swept) — an extruded swept planform in the XY plane
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(-7, 0);
  finShape.lineTo(-9, 9);
  finShape.lineTo(-5.5, 9);
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.5, bevelEnabled: false });
  finGeo.translate(0, 0, -0.25);
  add(new THREE.Mesh(finGeo, BLUE), tailX - 2, 2.6, 0);
  // horizontal stabilizers (swept, span along Z), one each side
  const hs = new THREE.Shape();
  hs.moveTo(2.5, 0);
  hs.lineTo(-3, 0);
  hs.lineTo(-5, 11);
  hs.lineTo(-3.5, 11);
  hs.lineTo(2.5, 0);
  const hsGeo = new THREE.ExtrudeGeometry(hs, { depth: 0.4, bevelEnabled: false });
  add(new THREE.Mesh(hsGeo, WHITE), tailX - 1, 2.4, 0.3, Math.PI / 2 - 0.08, 0, 0);
  const hsL = new THREE.Mesh(hsGeo.clone(), WHITE);
  hsL.scale.z = -1;
  add(hsL, tailX - 1, 2.4, -0.3, Math.PI / 2 + 0.08, 0, 0);

  // ── landing gear: two-wheel nose strut + four main bogies ────────────────────
  const wheel = (x, y, z) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 20), TIRE);
    add(w, x, y, z, Math.PI / 2, 0, 0); // roll axis along Z
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.52, 12), HUB), x, y, z, Math.PI / 2, 0, 0);
  };
  const strut = (x, z, len) => add(new THREE.Mesh(new THREE.BoxGeometry(0.4, len, 0.4), ALU), x, -R - len / 2 + 0.3, z);
  // nose gear (two wheels), retract-down under the forward fuselage
  strut(BODY_LEN / 2 - 4, 0, 2.2);
  wheel(BODY_LEN / 2 - 4, -R - 1.6, 0.5);
  wheel(BODY_LEN / 2 - 4, -R - 1.6, -0.5);
  // main gear: two body bogies + two wing bogies, each a 4-wheel truck
  const bogie = (x, z) => {
    strut(x, z, 3.2);
    for (const dx of [-0.9, 0.9]) {
      for (const dz of [-0.6, 0.6]) wheel(x + dx, -R - 2.9, z + dz);
    }
  };
  bogie(-6, 2.4); bogie(-6, -2.4);   // body gear
  bogie(-2, 7.5); bogie(-2, -7.5);   // wing gear

  return group;
}
