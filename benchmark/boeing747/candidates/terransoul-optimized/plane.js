// Boeing 747-400 — TerranSoul frontier-brain build, rebuilt NATIVELY in the rig
// axis convention (cameras.mjs line 9): nose +X, up +Y, wings span +/-Z.
// Root-cause fixes over the prior version: correct axis (no post-hoc rotation),
// SMOOTH swept+tapered ExtrudeGeometry wings + stabs (no staircase steps), a
// faired forward upper-deck hump (no floating box), a smooth ogive nose, and
// real landing-gear bogies with wheels. Primitives/Geometry only, one Group.
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.55, metalness: o.m ?? 0.12, ...o });
  const WHITE = mat(0xeef1f5, { r: 0.5 });
  const GREY = mat(0xb7c0ca, { r: 0.5, m: 0.25 });
  const BELLY = mat(0x39485c, { r: 0.6 });
  const ACCENT = mat(0x2f6bd8, { r: 0.45 });
  const DARK = mat(0x262b31, { r: 0.6, m: 0.3 });
  const GLASS = mat(0x131c27, { r: 0.25, m: 0.4 });
  const TIRE = mat(0x181b1f, { r: 0.85 });

  const add = (geo, m, pos = [0, 0, 0], rot = [0, 0, 0], parent = group) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos); mesh.rotation.set(...rot); parent.add(mesh); return mesh;
  };

  const R = 3.3;          // fuselage radius
  const LEN = 66;         // cabin length (nose at +X = +LEN/2)
  const NOSE = LEN / 2;

  // ---------- FUSELAGE (cylinder along X) ----------
  add(new THREE.CylinderGeometry(R, R, LEN, 56), WHITE, [0, 0, 0], [0, 0, Math.PI / 2]);
  // smooth ogive nose: short taper + rounded cap (not a sharp cone)
  add(new THREE.CylinderGeometry(R, R * 0.62, 6, 56), WHITE, [NOSE + 3, 0, 0], [0, 0, Math.PI / 2]);
  add(new THREE.SphereGeometry(R * 0.62, 32, 24), WHITE, [NOSE + 6, 0, 0]).scale.set(1.5, 1, 1);
  // upswept tapering tail cone (-X), lifted slightly
  add(new THREE.CylinderGeometry(R, R * 0.18, 10, 56), WHITE, [-NOSE - 4, 1.0, 0], [0, 0, Math.PI / 2 + 0.11]);
  // belly two-tone + window-level cheatline
  add(new THREE.CylinderGeometry(R * 1.004, R * 1.004, LEN, 56, 1, false, Math.PI * 0.15, Math.PI * 0.7), BELLY, [0, -0.02, 0], [0, 0, Math.PI / 2]);
  add(new THREE.BoxGeometry(LEN, 0.45, R * 0.7), ACCENT, [0, R * 0.34, 0]);

  // ---------- FORWARD UPPER-DECK HUMP (faired half-ellipsoid, front third) ----------
  // prominent forward hump = a taller half-ellipsoid on the crown, faired fore
  // (down toward the low cockpit) and aft (down into the crown by ~1/3 length).
  const mkHump = (sx, sy, sz, x) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), WHITE);
    h.scale.set(sx, sy, sz); h.position.set(x, R * 0.52, 0); group.add(h);
  };
  // ONE clean elongated half-ellipsoid — its tapered ends fair smoothly into the
  // crown fore and aft, so it never reads as stacked/stepped from any angle.
  mkHump(12, 4.3, R * 0.98, NOSE - 13);   // taller single dome — prominent from 3/4 yet smooth
  // cockpit windshield: dark angled panels LOW on the nose (main-deck height)
  add(new THREE.BoxGeometry(1.4, 1.3, R * 1.1), GLASS, [NOSE - 1.5, R * 0.32, 0], [0, 0, -0.35]);

  // window rows (main deck + upper deck) via instanced small dark quads on the flank
  function windowRow(x0, x1, y, zAbs, count) {
    const g = new THREE.BoxGeometry(0.5, 0.42, 0.16);
    const inst = new THREE.InstancedMesh(g, GLASS, count * 2);
    const m4 = new THREE.Matrix4(); let i = 0;
    for (let k = 0; k < count; k++) {
      const x = x0 + (x1 - x0) * (k / (count - 1));
      for (const z of [zAbs, -zAbs]) { m4.makeTranslation(x, y, z); inst.setMatrixAt(i++, m4); }
    }
    group.add(inst);
  }
  windowRow(-NOSE + 6, NOSE - 6, R * 0.5, R * 0.99, 34);   // main deck
  windowRow(NOSE - 20, NOSE - 9, R * 0.78, R * 0.9, 10);   // upper deck on the hump

  // ---------- SMOOTH SWEPT + TAPERED WINGS (ExtrudeGeometry) ----------
  // Shape in (X=chord fore/aft, Y=span); extrude Z=thickness; then rotate so span
  // runs along +/-Z, chord along X, thin in Y. Sweep = tip shifted aft (-X); taper
  // = tip chord << root chord. Dihedral via a small rotation about X.
  // SOLID visible swept+tapered wing: two chunky boxes (broad inboard, narrower
  // outboard) angled aft for sweep, on a dihedral group. Visible reads better
  // than a thin extrude. span along Z, chord along X.
  function wing(sign) {
    const g = new THREE.Group();     // dihedral
    const s = new THREE.Group();     // sweep + span
    add(new THREE.BoxGeometry(13, 0.95, 13), GREY, [1.5, 0, sign * 7], [0, 0, 0], s);      // inboard (broad chord)
    add(new THREE.BoxGeometry(9, 0.85, 13), GREY, [-1, 0, sign * 18.5], [0, 0, 0], s);     // mid
    add(new THREE.BoxGeometry(5.5, 0.75, 13), GREY, [-4, 0, sign * 30], [0, 0, 0], s);     // outboard (extended span)
    add(new THREE.BoxGeometry(0.9, 2.2, 2.6), GREY, [-6.2, 0.9, sign * 36], [0, 0, 0], s); // canted winglet (further out)
    s.rotation.y = sign > 0 ? -0.42 : 0.42;   // ~24deg sweep
    g.add(s); g.position.set(1, -R * 0.32, 0); g.rotation.x = sign > 0 ? -0.12 : 0.12; // dihedral
    group.add(g);
  }
  wing(1); wing(-1);
  // wing-root fairing so the junction isn't a hard butt joint
  add(new THREE.SphereGeometry(R * 0.85, 24, 16), GREY, [-1, -R * 0.2, 0]).scale.set(2.2, 0.7, 1.2);

  // ---------- FOUR ENGINES (cowl + dark inlet + exhaust) under + fwd of wing ----------
  // engines staggered along the swept wing (outboard further AFT) so all four
  // read separately even in profile, each on a TALL pylon that overlaps the wing
  // above and the nacelle below -- no floating gaps.
  function engine(x, z) {
    const y = -R * 0.72 - 2.3;                                                    // nacelle well below wing
    add(new THREE.BoxGeometry(2.6, 4.4, 0.75), DARK, [x - 0.2, y + 2.9, z]);      // tall pylon: nacelle up INTO wing
    add(new THREE.CylinderGeometry(1.62, 1.5, 6.8, 32), GREY, [x, y, z], [0, 0, Math.PI / 2]);        // long-duct cowl
    add(new THREE.CylinderGeometry(1.72, 1.72, 0.5, 32), WHITE, [x + 3.7, y, z], [0, 0, Math.PI / 2]); // fan-cowl lip
    add(new THREE.CylinderGeometry(1.34, 1.34, 0.6, 28), DARK, [x + 3.75, y, z], [0, 0, Math.PI / 2]); // recessed dark inlet
    add(new THREE.CylinderGeometry(0.85, 0.6, 1.4, 24), DARK, [x - 3.8, y, z], [0, 0, Math.PI / 2]);   // exhaust
  }
  engine(7.5, 9); engine(1.5, 20); engine(7.5, -9); engine(1.5, -20);  // inboard fwd + outboard aft (both wings)

  // ---------- EMPENNAGE: tall swept fin + horizontal stabilizers ----------
  const TX = -NOSE - 1;
  // vertical fin: tall solid swept box (broad root, narrower swept-aft top), upright
  // ONE clean tall fin (no stacked boxes -> never reads as a stepped tower) with
  // a swept leading edge faired by a triangular fillet at the root.
  add(new THREE.BoxGeometry(6.5, 12.5, 0.72), GREY, [TX + 0.5, R + 6.4, 0]);        // single tall fin
  add(new THREE.ConeGeometry(2.6, 6, 4), GREY, [TX + 4.2, R + 3.0, 0], [0, Math.PI / 4, -0.5]); // root fillet (swept LE)
  add(new THREE.BoxGeometry(5.2, 2.4, 0.74), ACCENT, [TX - 0.6, R + 11.3, 0]);      // accent on the fin top (overlaps)
  // horizontal stabilizers: solid swept boxes, span +/-Z at tail height
  function stab(sign) {
    const s = new THREE.Group();
    add(new THREE.BoxGeometry(4.5, 0.55, 12), GREY, [0, 0, sign * 6.5], [0, 0, 0], s);
    s.rotation.y = sign > 0 ? -0.4 : 0.4; s.position.set(TX + 1, R + 0.6, 0);
    group.add(s);
  }
  stab(1); stab(-1);

  // ---------- LANDING GEAR: nose + 4 main bogies with wheels ----------
  // proper vertical wheels (axle along Z), not flat discs
  function wheel(x, y, z) { add(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 18), TIRE, [x, y, z], [Math.PI / 2, 0, 0]); }
  function bogie(x, z) {
    const y = -R - 2.6;
    add(new THREE.CylinderGeometry(0.32, 0.32, 2.8, 12), DARK, [x, -R - 1.1, z]);   // strut into belly
    add(new THREE.BoxGeometry(3.2, 0.4, 1.1), DARK, [x, y + 0.6, z]);               // truck beam
    for (const dx of [-1.05, 1.05]) for (const dz of [-0.55, 0.55]) wheel(x + dx, y, z + dz); // 4-wheel truck
  }
  add(new THREE.CylinderGeometry(0.28, 0.28, 2.4, 12), DARK, [NOSE - 8, -R - 1.0, 0]);     // nose strut
  wheel(NOSE - 8, -R - 2.2, -0.5); wheel(NOSE - 8, -R - 2.2, 0.5);                          // nose 2 wheels
  bogie(-2, 3.4); bogie(-2, -3.4); bogie(-7.5, 5.4); bogie(-7.5, -5.4);                     // 4 main bogies (body + wing)

  return group;
}
