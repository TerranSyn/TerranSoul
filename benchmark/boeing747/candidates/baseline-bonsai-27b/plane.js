export function buildPlane(THREE) {
  const { Mesh, MeshStandardMaterial, BoxGeometry, CylinderGeometry,
    SphereGeometry, ConeGeometry, TorusGeometry, CapsuleGeometry, ExtrudeGeometry } = THREE;

  const group = new THREE.Group();

  // ── Livery palette ──────────────────────────────────────────────
  const C = {
    white:   new THREE.Color(0xffffff),
    navy:    new THREE.Color(0x001f3f),
    darkB:   new THREE.Color(0x154565),
    skyB:    new THREE.Color(0x1a567a),
    silver:  new THREE.Color(0xc0c0c0),
    black:   new THREE.Color(0x000000),
    gray:    new THREE.Color(0x888888),
    red:     new THREE.Color(0xff3333),
    yellow:  new THREE.Color(0xffcc00),
    green:   new THREE.Color(0x00aa00),
    gray2:   new THREE.Color(0x777777),
  };

  // ── Helpers ─────────────────────────────────────────────────────
  const mat = (c, opts = {}) => new MeshStandardMaterial({
    color: c, ...opts,
  });

  const mesh = (geo, c, opts = {}) => {
    const m = new Mesh(geo, mat(c, opts));
    return m;
  };

  const vec3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ── Nose ────────────────────────────────────────────────────────
  const noseG = new ConeGeometry(0.4, 2.8, 32, 8);
  const nose = mesh(noseG, C.navy, { roughness: 0.15, metalness: 0.2 });
  nose.position.set(34, 0.3, 0);
  group.add(nose);

  // Nose lights
  const nlG = new CapsuleGeometry(0.04, 0.08, 16, 8, 8);
  const nl1 = mesh(nlG, C.yellow, { roughness: 0.1 });
  nl1.position.set(34.2, 0.35, -0.05);
  group.add(nl1);
  const nl2 = mesh(nlG, C.yellow, { roughness: 0.1 });
  nl2.position.set(34.2, 0.35, 0.05);
  group.add(nl2);

  // ── Fuselage ────────────────────────────────────────────────────
  const fusG = new CapsuleGeometry(2.5, 58, 64, 128, 32);
  fusG.translate(0, 0.45, 0);
  const fuselage = mesh(fusG, C.white, { roughness: 0.25, metalness: 0.05 });
  fuselage.position.set(0, 0, 0);
  group.add(fuselage);

  // Upper-deck hump (partial-length)
  const humpG = new CapsuleGeometry(1.8, 14, 32, 64, 16);
  humpG.scale(1.15, 1, 1);
  humpG.translate(-7, 0.85, 0);
  const hump = mesh(humpG, C.white, { roughness: 0.2, metalness: 0.08 });
  hump.position.set(0, 0, 0);
  group.add(hump);

  // Under-fuselage shadow strip
  const lowerG = new CapsuleGeometry(2.2, 58, 64, 128, 32);
  lowerG.scale(1, 1, 1);
  lowerG.translate(0, -0.15, 0);
  const lower = mesh(lowerG, C.darkB, { roughness: 0.4, metalness: 0 });
  lower.position.set(0, 0, 0);
  lower.visible = false;

  // Tail section
  const tailG = new CapsuleGeometry(1.8, 18, 32, 64, 16);
  tailG.scale(1, 1, 1);
  tailG.translate(0, 0.45, 0);
  const tail = mesh(tailG, C.white, { roughness: 0.25, metalness: 0.05 });
  tail.position.set(40, 0, 0);
  group.add(tail);

  // Tail fin base
  const finBaseG = new BoxGeometry(1.2, 0.4, 1.2);
  const finBase = mesh(finBaseG, C.darkB, { roughness: 0.3 });
  finBase.position.set(40, 0.6, 0);
  group.add(finBase);

  // ── Vertical stabilizer ────────────────────────────────────────
  const vertG = new BoxGeometry(1.4, 15, 1.4);
  const vert = mesh(vertG, C.white, { roughness: 0.25, metalness: 0.05 });
  vert.position.set(40, 0.5, 0);
  group.add(vert);

  // Tail fin top
  const finTopG = new BoxGeometry(0.6, 3, 0.6);
  const finTop = mesh(finTopG, C.navy, { roughness: 0.15, metalness: 0.2 });
  finTop.position.set(40, 12.5, 0);
  group.add(finTop);

  // ── Horizontal stabilizers ──────────────────────────────────────
  const hStabG = new BoxGeometry(22, 0.25, 1.2);
  const hStab = mesh(hStabG, C.white, { roughness: 0.25, metalness: 0.05 });
  hStab.position.set(40, 1.15, 0);
  group.add(hStab);

  // ── Wings ───────────────────────────────────────────────────────
  // Wing root
  const wRootG = new BoxGeometry(1.2, 0.12, 12);
  const wRoot = mesh(wRootG, C.white, { roughness: 0.25, metalness: 0.05 });
  wRoot.position.set(-6, 0.45, 0);
  group.add(wRoot);

  // Right wing
  const wG = new BoxGeometry(32, 0.14, 9);
  const wing = mesh(wG, C.white, { roughness: 0.25, metalness: 0.05 });
  wing.position.set(-6, 0.45, 0);
  wing.rotation.x = 0.65; // dihedral ~37.5°
  wing.rotation.z = 0.65; // sweep ~37.5°
  wing.position.z = 6.5;
  group.add(wing);

  // Wing trailing edge flap line
  const flapG = new BoxGeometry(0.04, 0.06, 10);
  const flap = mesh(flapG, C.darkB, { roughness: 0.4 });
  flap.position.set(-6, 0.45, 6.5);
  flap.rotation.x = 0.65;
  flap.rotation.z = 0.65;
  group.add(flap);

  // Left wing
  const wing2 = wing.clone();
  wing2.position.z = -6.5;
  wing2.rotation.z = -0.65;
  group.add(wing2);

  const flap2 = flap.clone();
  flap2.position.z = -6.5;
  flap2.rotation.z = -0.65;
  group.add(flap2);

  // Wing leading edge
  const leadG = new BoxGeometry(0.04, 0.04, 34);
  const lead = mesh(leadG, C.darkB, { roughness: 0.4 });
  lead.position.set(-6, 0.45, 0);
  lead.rotation.x = 0.65;
  lead.rotation.z = 0.65;
  group.add(lead);
  const lead2 = lead.clone();
  lead2.position.z = -6.5;
  lead2.rotation.z = -0.65;
  group.add(lead2);

  // ── Engines ─────────────────────────────────────────────────────
  const engG = new CapsuleGeometry(0.7, 4.2, 32, 16, 10);
  const eng = mesh(engG, C.white, { roughness: 0.2, metalness: 0.12 });
  eng.position.set(-6, 0.45, 6.5);
  eng.rotation.z = 0.65;
  eng.rotation.x = 0.65;
  group.add(eng);

  // Engine nacelle detail
  const engG2 = new CapsuleGeometry(0.5, 2.5, 16, 8, 6);
  const engG2Mat = mat(C.darkB, { roughness: 0.3 });
  const engDetail = mesh(engG2, engG2Mat);
  engDetail.position.copy(eng.position);
  engDetail.rotation.copy(eng.rotation);
  engDetail.position.z = 0.5;
  group.add(engDetail);

  const eng2 = eng.clone();
  eng2.position.z = -6.5;
  eng2.rotation.z = -0.65;
  group.add(eng2);

  const engDetail2 = engDetail.clone();
  engDetail2.position.z = -0.5;
  group.add(engDetail2);

  // Engine exhaust ports
  const exG = new CapsuleGeometry(0.2, 0.4, 16, 8, 4);
  const ex = mesh(exG, C.black, { roughness: 0.2 });
  ex.position.set(-6, 0.45, 6.5);
  ex.rotation.z = 0.65;
  ex.rotation.x = 0.65;
  ex.position.y = -0.2;
  group.add(ex);
  const ex2 = ex.clone();
  ex2.position.z = -6.5;
  ex2.rotation.z = -0.65;
  group.add(ex2);

  // ── Landing gear ────────────────────────────────────────────────
  // Nose strut
  const strutG = new CylinderGeometry(0.08, 0.08, 3, 16);
  const strut = mesh(strutG, C.silver, { roughness: 0.4, metalness: 0.7 });
  strut.position.set(0, 0.15, 0);
  group.add(strut);

  // Nose wheels
  const nwG = new SphereGeometry(0.06, 16, 16);
  const nw1 = mesh(nwG, C.black, { roughness: 0.3 });
  nw1.position.set(0, 0.04, 0.08);
  group.add(nw1);
  const nw2 = mesh(nwG, C.black, { roughness: 0.3 });
  nw2.position.set(0, 0.04, -0.08);
  group.add(nw2);

  // Main gear trucks
  const mgG = new CylinderGeometry(0.14, 0.14, 1.4, 16);
  const mgPos = [
    vec3(-8, 0.12, 0),
    vec3(-8, 0.12, 4),
    vec3(-8, 0.12, -4),
    vec3(-8, 0.12, -8),
  ];
  const mainGears = [];
  for (const p of mgPos) {
    const g = mesh(mgG, C.silver, { roughness: 0.4, metalness: 0.7 });
    g.position.copy(p);
    group.add(g);
    mainGears.push(g);
  }

  // Main wheels
  const mwG = new SphereGeometry(0.06, 16, 16);
  for (const g of mainGears) {
    const w1 = mesh(mwG, C.black, { roughness: 0.3 });
    w1.position.set(g.position.x, g.position.y, g.position.z + 0.06);
    group.add(w1);
    const w2 = mesh(mwG, C.black, { roughness: 0.3 });
    w2.position.set(g.position.x, g.position.y, g.position.z - 0.06);
    group.add(w2);
  }

  // ── Windows ─────────────────────────────────────────────────────
  const winG = new BoxGeometry(0.28, 0.14, 0.04);
  // Lower fuselage windows
  for (let i = -12; i <= 10; i += 2.8) {
    const w = mesh(winG, C.gray, { roughness: 0.4 });
    w.position.set(i, 0.4, 0);
    group.add(w);
  }
  // Hump windows
  for (let i = -14; i <= 4; i += 2.8) {
    const w = mesh(winG, C.gray, { roughness: 0.4 });
    w.position.set(i, 0.85, 0);
    group.add(w);
  }
  // Tail windows
  for (let i = 38; i <= 42; i += 2.8) {
    const w = mesh(winG, C.gray, { roughness: 0.4 });
    w.position.set(i, 0.45, 0);
    group.add(w);
  }

  // ── Doors ───────────────────────────────────────────────────────
  const doorG = new BoxGeometry(0.75, 0.55, 0.12);
  const door = mesh(doorG, C.darkB, { roughness: 0.3 });
  door.position.set(-14, 0.35, 0);
  group.add(door);

  // Door handle line
  const dhG = new BoxGeometry(0.02, 0.25, 0.05);
  const dh = mesh(dhG, C.gray, { roughness: 0.5 });
  dh.position.set(-14, 0.45, 0);
  group.add(dh);

  // ── Window/door lines ───────────────────────────────────────────
  const lineG = new BoxGeometry(0.02, 0.02, 1.5);
  // Fuselage vertical line
  const vLine = mesh(lineG, C.darkB, { roughness: 0.6 });
  vLine.position.set(0, 0.4, 0);
  group.add(vLine);

  // Wing sweep line
  const sLine = mesh(lineG, C.darkB, { roughness: 0.6 });
  sLine.position.set(-6, 0.45, 0);
  sLine.rotation.x = 0.65;
  sLine.rotation.z = 0.65;
  sLine.position.z = 5;
  group.add(sLine);
  const sLine2 = sLine.clone();
  sLine2.position.z = -5;
  sLine2.rotation.z = -0.65;
  group.add(sLine2);

  // ── Engine fairings (top) ──────────────────────────────────────
  const fG = new BoxGeometry(1.2, 0.1, 5);
  const f = mesh(fG, C.white, { roughness: 0.25, metalness: 0.05 });
  f.position.set(-6, 0.45, 6.5);
  f.rotation.z = 0.65;
  f.rotation.x = 0.65;
  f.position.y = 0.7;
  group.add(f);
  const f2 = f.clone();
  f2.position.z = -6.5;
  f2.rotation.z = -0.65;
  group.add(f2);

  // ── Wing tip flaps ──────────────────────────────────────────────
  const tipG = new BoxGeometry(0.12, 0.1, 1.5);
  const tip = mesh(tipG, C.darkB, { roughness: 0.4 });
  tip.position.set(-6, 0.45, 6.5);
  tip.rotation.x = 0.65;
  tip.rotation.z = 0.65;
  tip.position.x = -32;
  group.add(tip);
  const tip2 = tip.clone();
  tip2.position.z = -6.5;
  tip2.rotation.z = -0.65;
  group.add(tip2);

  // ── Tail fin window lines ──────────────────────────────────────
  const twG = new BoxGeometry(0.04, 0.04, 10);
  const tw = mesh(twG, C.darkB, { roughness: 0.6 });
  tw.position.set(40, 0.5, 0);
  group.add(tw);
  const tw2 = mesh(twG, C.darkB, { roughness: 0.6 });
  tw2.position.set(40, 0.5, 0);
  tw2.rotation.x = Math.PI / 2;
  group.add(tw2);

  // ── Engine ring (toroidal) ─────────────────────────────────────
  const ringG = new TorusGeometry(0.6, 0.08, 16, 8);
  const ring = mesh(ringG, C.darkB, { roughness: 0.4 });
  ring.position.set(-6, 0.45, 6.5);
  ring.rotation.z = 0.65;
  ring.rotation.x = 0.65;
  group.add(ring);
  const ring2 = ring.clone();
  ring2.position.z = -6.5;
  ring2.rotation.z = -0.65;
  group.add(ring2);

  // ── Landing gear lock pins ──────────────────────────────────────
  const lpG = new CapsuleGeometry(0.03, 0.12, 8, 8, 4);
  const lp = mesh(lpG, C.darkB, { roughness: 0.5 });
  lp.position.set(-8, 0.12, 0);
  group.add(lp);

  return group;
}