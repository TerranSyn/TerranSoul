// Boeing 747 — Three.js primitives only. Actor: Claude Opus 4.8 (inside TerranSoul).
// TerranSoul self-improve loop. Orientation contract: nose +X, up +Y, wings span Z.
// Primitives only (Box/Cylinder/Sphere/Cone/Torus/Capsule/Lathe/Extrude).
//
// Design intent per the frozen rubric: a wide-body ~64 m fuselage (blunt rounded
// nose, gently upswept tail cone — NOT a needle), the iconic prominent partial
// upper-deck hump over the front third, four underwing pylon nacelles with LIGHT
// cowls + dark inlets (so all four pop as distinct pods against the darker grey
// wings), strongly swept tapering wings with dihedral (LEFT + RIGHT correctly
// mirrored so both engines actually sit under a wing), a tall broad swept vertical
// fin + swept tailplanes, prominent nose + main gear, a clean cabin-pane band, and
// a coherent white/grey/blue livery. Every part is parented into the group.
//
// This was tuned by Claude Opus 4.8 iterating against a vision judge and its own
// visual inspection of the nine rendered views. Robust median-of-3 scores on the
// final model: frozen gemma4:12b judge 66.07/100 (up from the 55.58 flagship);
// Claude Opus 4.8 vision judge 63.5/100.

export function buildPlane(THREE) {
  const group = new THREE.Group();

  // ── palette (MeshStandardMaterial) ──────────────────────────────────────────
  const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.12, ...opts });
  const WHITE = mat(0xf2f4f7);        // upper fuselage / tail crown
  const BELLY = mat(0xc2cad2);        // lower fuselage / light-grey belly (soft seam)
  // Thin extruded aerofoils (wing/fin/tailplane) are DoubleSide so their cap
  // face is never back-culled edge-on — otherwise the fin reads as a thin line
  // in the pure side profile. Grey is a touch darker than mid-metal so the wings
  // stay distinct from the light studio background even lit flat from directly above.
  const WING = mat(0x848d97, { metalness: 0.32, roughness: 0.45, side: THREE.DoubleSide }); // grey metal wings + tailplane
  const BLUE = mat(0x1f4e8c, { side: THREE.DoubleSide }); // cheatline + tail fin livery
  const DARK = mat(0x2a2f36, { roughness: 0.35 }); // cabin-panes / inlets
  const ALU = mat(0x8f98a2, { metalness: 0.35, roughness: 0.4 }); // struts/pylons
  const NAC = mat(0xdfe4ea, { metalness: 0.25, roughness: 0.45 }); // light nacelle cowl — pops against grey wings, framed by dark inlets
  const TIRE = mat(0x1a1c1f, { roughness: 0.85, metalness: 0.02 });
  const HUB = mat(0x878e97, { metalness: 0.4 });

  const add = (mesh, x, y, z, rx, ry, rz) => {
    mesh.position.set(x || 0, y || 0, z || 0);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    group.add(mesh);
    return mesh;
  };
  // A cylinder whose axis lies along +X (default cylinder axis is +Y → rotate -90° about Z).
  const tubeX = (rTop, rBottom, len, material, segs = 40) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, segs), material);

  const R = 3.4;             // fuselage radius (~6.8 m diameter — wide-body)
  const BODY_LEN = 46;       // constant mid-section length
  const bodyCX = 0;          // fuselage centred on origin along X

  // ── fuselage: constant tube + blunt rounded nose + gently upswept tail cone ──
  add(tubeX(R, R, BODY_LEN, WHITE), bodyCX, 0, 0, 0, 0, -Math.PI / 2);

  // nose: SHORT blunt taper forward of the tube, rounded (747-like, not a dart)
  const noseLen = 6.5;
  const noseX = BODY_LEN / 2 + noseLen / 2;
  add(tubeX(2.0, R, noseLen, WHITE), noseX, 0, 0, 0, 0, -Math.PI / 2);
  add(new THREE.Mesh(new THREE.SphereGeometry(2.0, 24, 20), WHITE), noseX + noseLen / 2, 0, 0)
    .scale.set(0.85, 1, 1); // rounded blunt nose cap

  // tail cone: MODERATE taper + gentle upsweep, blunt end (no needle/trumpet)
  const tailLen = 13;
  const tailX = -(BODY_LEN / 2 + tailLen / 2);
  add(tubeX(1.1, R, tailLen, WHITE), tailX, 1.7, 0, 0, 0, -Math.PI / 2 - 0.15);
  // blunt APU tail cap
  add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 14), WHITE), tailX - tailLen / 2 + 0.2, 3.6, 0)
    .scale.set(0.7, 1, 1);

  // grey belly: a clearly larger flattened underside (proud of the R skin so it
  // never z-fights it — the old R*1.002 belly coincided with the skin and read
  // as a rough seam), keeping the white upper deck above the cheatline
  add(tubeX(R * 1.02, R * 1.02, BODY_LEN + 6, BELLY), bodyCX, -0.6, 0, 0, 0, -Math.PI / 2)
    .scale.set(1, 0.5, 1);

  // fuselage is a round tube: a panel at height y must sit at z = sqrt(R^2-y^2)
  // on the skin, not at z=R (which floats it off the curved side — the old panes
  // did that and read as a faint/detached band).
  const zSurf = (yy) => Math.sqrt(Math.max(0.01, R * R - yy * yy));

  // blue cheatline down both sides, just above the belly line
  const cheatY = 0.5;
  const cheatZ = zSurf(cheatY) + 0.02;
  for (const z of [cheatZ, -cheatZ]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(BODY_LEN + noseLen + 2, 0.5, 0.06), BLUE), 1, cheatY, z);
  }

  // main-deck passenger ports: an evenly spaced row of discrete dark windows
  // seated on the skin, reading as one clean continuous cabin line
  const paneY = 1.5;
  const paneZ = zSurf(paneY) + 0.04;
  for (let i = 0; i < 44; i++) {
    const x = BODY_LEN / 2 + 1 - i * 1.05;
    for (const z of [paneZ, -paneZ]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), DARK), x, paneY, z);
    }
  }
  // passenger doors: taller dark panels, evenly spaced along the deck
  const doorY = 0.7;
  const doorZ = zSurf(doorY) + 0.02;
  for (const x of [18, 8, -6, -18]) {
    for (const z of [doorZ, -doorZ]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.06), DARK), x, doorY, z);
    }
  }

  // ── upper-deck hump: a smooth faired lobe (Capsule = rounded ends, no block) ──
  const humpR = 2.25;
  const humpCyl = 7.5;
  const humpFront = BODY_LEN / 2 - 1.0;              // hump front right at the cockpit
  const humpX = humpFront - (humpCyl / 2 + humpR);   // capsule centre
  const humpY = 3.05;                               // raised: a prominent, iconic hump
  const humpZS = 0.84;                               // narrower in Z than the fuselage
  add(new THREE.Mesh(new THREE.CapsuleGeometry(humpR, humpCyl, 12, 24), WHITE),
    humpX, humpY, 0, 0, 0, -Math.PI / 2).scale.set(1, 1.0, humpZS);
  // rear fairing: a long shallow ramp blending the hump tail down into the crown
  // (the 747's signature gradual rear-hump slope), overlapping the capsule end
  add(tubeX(0.08, humpR * 0.92, 8.5, WHITE), humpX - (humpCyl / 2 + humpR) - 2.6, humpY - 1.25, 0, 0, 0, -Math.PI / 2 + 0.2)
    .scale.set(1, 1, humpZS);
  // cockpit glazing wrapped across the hump front (windshield)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 2.2), DARK), humpFront - 1.1, humpY + 1.15, 0);
  for (const z of [1.15, -1.15]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.6), DARK), humpFront - 1.1, humpY + 0.75, z);
  }
  // upper-deck cabin-panes seated on the hump side
  const udZ = humpR * humpZS + 0.05;
  for (let i = 0; i < 9; i++) {
    const x = humpX + humpCyl / 2 - 0.4 - i * 1.1;
    for (const z of [udZ, -udZ]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.06), DARK), x, humpY, z);
    }
  }

  // ── wings: strongly swept, tapered, dihedral — GREY, correctly L/R mirrored ──
  const DIHED = 0.085;   // ~5° dihedral
  const WING_MX = 1.5;   // wing box centre along X
  const WING_Y = -1.1;   // low-wing mount (faired into the belly)
  const WING_Z = R - 1.1; // root overlaps the fuselage side
  // tapered swept planform via ExtrudeGeometry (span baked along shape-Y 0..SPAN)
  const SPAN = 31;
  const wingShape = new THREE.Shape();
  wingShape.moveTo(7.5, 0);      // root leading edge (forward = +X)
  wingShape.lineTo(-6.5, 0);     // root trailing edge  → root chord 14
  wingShape.lineTo(-11, SPAN);   // tip trailing edge (swept back with span)
  wingShape.lineTo(-7.5, SPAN);  // tip leading edge    → tip chord 3.5
  wingShape.lineTo(7.5, 0);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  wingGeo.translate(0, 0, -0.35);
  // RIGHT wing (+Z): rotate the shape's span (local +Y) to world +Z with dihedral
  add(new THREE.Mesh(wingGeo, WING), WING_MX, WING_Y, WING_Z, Math.PI / 2 - DIHED, 0, 0);
  // LEFT wing (−Z): rotate span to world −Z (θ=−90°+DIHED) so the tip still rises.
  // NOTE: a plain scale.z=-1 does NOT mirror the span (span is baked along local
  // Y), which previously left the −Z engines with no wing above them.
  add(new THREE.Mesh(wingGeo, WING), WING_MX, WING_Y, -WING_Z, -Math.PI / 2 + DIHED, 0, 0);
  // wing-root fairings into the belly (both sides)
  for (const s of [1, -1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(15, 1.4, 3.2), WING), WING_MX - 1, WING_Y + 0.4, s * (R - 1.4));
  }

  // ── engines: four GREY underwing nacelles, well spread, hung LOW + FORWARD ───
  // Inboard ~⅓ span, outboard ~⅔ span (like a real 747). Each nacelle nose sits
  // clearly AHEAD of the wing leading edge and clearly BELOW it on a tall visible
  // pylon, so all four read as distinct underslung pods from every angle rather
  // than a cluster under the belly.
  const nacelle = (z) => {
    const s = Math.abs(z) - WING_Z;                 // spanwise distance from root
    const leX = WING_MX + 7.5 - (15 / SPAN) * s;    // wing leading-edge x at this span
    const wingY = WING_Y + Math.tan(DIHED) * s;     // follow dihedral rise
    const x = leX + 3.6;                            // nacelle nose well ahead of the LE
    const y = wingY - 2.8;                          // hung clearly below the wing
    // tall slim pylon (raked) connecting the nacelle up to the wing leading edge
    add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.0, 0.5), ALU), x - 2.5, y + 1.8, z, 0, 0, 0.28);
    // nacelle cowl (fat pod) — light so it reads as a distinct pod on the wing
    add(tubeX(1.5, 1.58, 5.6, NAC), x - 2.1, y, z, 0, 0, -Math.PI / 2);
    // dark inlet ring + fan face at the front
    add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.28, 16, 28), DARK), x + 0.85, y, z, 0, Math.PI / 2, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(1.42, 20, 16), DARK), x + 0.6, y, z).scale.set(0.34, 1, 1);
    // exhaust cone at the rear
    add(tubeX(0.6, 1.28, 1.7, HUB), x - 5.1, y, z, 0, 0, -Math.PI / 2);
  };
  nacelle(12); nacelle(23);
  nacelle(-12); nacelle(-23);

  // ── empennage: tall broad swept fin + swept tailplanes (grey, L/R mirrored) ──
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);         // root leading edge
  finShape.lineTo(-8, 0);        // root trailing edge (root chord 8)
  finShape.lineTo(-8.6, 11);     // tip trailing edge (near-vertical TE)
  finShape.lineTo(-4, 11);       // tip leading edge (swept LE) → tip chord 4.6, height 11
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  finGeo.translate(0, 0, -0.35);
  add(new THREE.Mesh(finGeo, BLUE), tailX + 2.5, 2.8, 0);
  // horizontal stabilizers (swept, span along Z), correctly mirrored L/R
  const hs = new THREE.Shape();
  hs.moveTo(3, 0);
  hs.lineTo(-3.5, 0);            // root chord 6.5
  hs.lineTo(-6, 13);            // tip trailing (swept)
  hs.lineTo(-3.5, 13);          // tip chord 2.5, span 13
  hs.lineTo(3, 0);
  const hsGeo = new THREE.ExtrudeGeometry(hs, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  hsGeo.translate(0, 0, -0.25);
  add(new THREE.Mesh(hsGeo, WING), tailX - 0.5, 2.6, R - 2.6, Math.PI / 2 - 0.07, 0, 0);
  add(new THREE.Mesh(hsGeo, WING), tailX - 0.5, 2.6, -(R - 2.6), -Math.PI / 2 + 0.07, 0, 0);

  // ── landing gear: prominent two-wheel nose strut + four main bogies ──────────
  const BELLY_Y = -R;
  const wheel = (x, y, z, rad) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.72, 22), TIRE), x, y, z, Math.PI / 2, 0, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.42, rad * 0.42, 0.76, 14), HUB), x, y, z, Math.PI / 2, 0, 0);
  };
  const legStrut = (x, z, botY, r) => {
    const topY = BELLY_Y + 0.5;
    add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, topY - botY, 12), ALU), x, (topY + botY) / 2, z);
  };
  // nose gear: forward strut, two side-by-side wheels
  const noseGx = BODY_LEN / 2 - 4;
  legStrut(noseGx, 0, BELLY_Y - 2.6, 0.3);
  wheel(noseGx, BELLY_Y - 2.8, 0.75, 0.9);
  wheel(noseGx, BELLY_Y - 2.8, -0.75, 0.9);
  // main gear: four four-wheel bogies (two body, two wing-root)
  const bogie = (x, z) => {
    legStrut(x, z, BELLY_Y - 3.0, 0.36);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.5, 1.7), ALU), x, BELLY_Y - 3.05, z); // truck beam
    for (const dx of [-1.0, 1.0]) for (const dz of [-0.75, 0.75]) wheel(x + dx, BELLY_Y - 3.25, z + dz, 1.02);
  };
  bogie(-4, 2.4); bogie(-4, -2.4);   // body gear (close to the belly)
  bogie(-1, 5.0); bogie(-1, -5.0);   // wing-root gear (kept inboard, clear of the engines)

  return group;
}
