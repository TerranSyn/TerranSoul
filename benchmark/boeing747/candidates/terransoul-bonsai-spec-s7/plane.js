export function buildPlane(THREE) {
  const G = THREE;
  const g = new G.Group();

  // --- 1. FUSELAGE (spine along Z) ---
  const fuselLen = 64, fuselR = 3;
  const fuselage = new G.CylinderGeometry(fuselR, fuselR, fuselLen, 20);
  fuselage.translate(0, 0, -fuselLen / 2); // centre of fuselage at origin
  const fuselageMat = new G.MeshStandardMaterial({ color: 0x999999 });
  const fuselageMesh = new G.Mesh(fuselage, fuselageMat);
  g.add(fuselageMesh);

  // rounded nose cone at +Z
  const noseCone = new G.ConeGeometry(2.5, 1.5, 16);
  noseCone.translate(0, 0, fuselLen / 2 - 1.5 / 2);
  const noseMat = new G.MeshStandardMaterial({ color: 0x999999 });
  const noseMesh = new G.Mesh(noseCone, noseMat);
  g.add(noseMesh);

  // --- 2. UPPER-DECK HUMP ---
  const humpLen = 14, humpR = fuselR + 0.8;
  const humpGeo = new G.CylinderGeometry(humpR, humpR, humpLen / 2, 16);
  humpGeo.translate(0, fuselR + 0.4, -fuselLen / 2 + 5); // just behind nose, on top
  const humpMesh = new G.Mesh(humpGeo, fuselageMat);
  g.add(humpMesh);

  // --- 3. WINGS (two, tapered, swept, dihedral) ---
  function makeWing(side) {
    const rootY = 0;
    const rootZ = -2; // slightly aft of centre
    const halfSpan = 30;
    const sweepBack = 22;
    const dihedralUp = 3;

    // root box (overlaps fuselage)
    const rootGeo = new G.BoxGeometry(1.8, 0.5, 3);
    rootGeo.translate(0, rootY, rootZ);
    rootGeo.scale(1, 1, 1);

    // wing span box (extends along X, swept along -Z)
    const spanGeo = new G.BoxGeometry(halfSpan * 2, 0.5, 4);
    spanGeo.translate(0, rootY + dihedralUp / 2, rootZ + 2);
    spanGeo.scale(side, 1, 1);

    // tilt dihedral: rotate around X axis so tips are higher
    const dihedralRad = dihedralUp / (halfSpan * 2) * Math.PI / 2; // small angle
    spanGeo.rotateX(dihedralRad);

    const wingMesh = new G.Mesh(rootGeo, fuselageMat);
    g.add(wingMesh);
    const wingSpanMesh = new G.Mesh(spanGeo, fuselageMat);
    g.add(wingSpanMesh);
  }
  makeWing(1);
  makeWing(-1);

  // --- 4. ENGINES (4 nacelles) ---
  function makeEngine(inboardOffset, outboardOffset, wingSide) {
    const pylonLen = 2;
    const pylonGeo = new G.CylinderGeometry(0.3, 0.3, pylonLen, 8);
    pylonGeo.translate(0, -fuselageMesh.position.y - 0.5, -fuselageMesh.position.z + wingSide * 10);
    const pylonMesh = new G.Mesh(pylonGeo, fuselageMat);
    g.add(pylonMesh);

    const nacelles = [inboardOffset, outboardOffset];
    for (const off of nacelles) {
      const nacGeo = new G.CylinderGeometry(1.3, 1.3, 6, 12);
      nacGeo.translate(off, -fuselageMesh.position.y - 0.5 - pylonLen / 2, -fuselageMesh.position.z + wingSide * 10 + 1);
      const nacMesh = new G.Mesh(nacGeo, fuselageMat);
      g.add(nacMesh);
    }
  }
  makeEngine(-6, 6, 1);
  makeEngine(-6, 6, -1);

  // --- 5. TAIL (empennage) ---
  // vertical fin
  const finGeo = new G.BoxGeometry(0.8, 11, 2);
  finGeo.translate(0, fuselageMesh.position.y + fuselageMesh.position.y + fuselageMesh.position.y * 0.5, -fuselageMesh.position.z - fuselageMesh.position.z / 2);
  // correct: place at rear centre, on top of fuselage
  const finPosZ = -fuselageMesh.position.z - fuselageMesh.position.z / 2;
  const finGeo2 = new G.BoxGeometry(0.8, 11, 2);
  finGeo2.translate(0, fuselageMesh.position.y + 3.5, -fuselageMesh.position.z - fuselageMesh.position.z / 2);
  const finMesh = new G.Mesh(finGeo2, fuselageMat);
  g.add(finMesh);

  // horizontal stabilizers (mini wings)
  function makeStab(side) {
    const stabGeo = new G.BoxGeometry(10, 0.4, 2);
    stabGeo.translate(0, fuselageMesh.position.y + 3.5, -fuselageMesh.position.z - fuselageMesh.position.z / 2);
    stabGeo.scale(side, 1, 1);
    const stabMesh = new G.Mesh(stabGeo, fuselageMat);
    g.add(stabMesh);
  }
  makeStab(1);
  makeStab(-1);

  // --- 6. LANDING GEAR ---
  function makeGear(zOffset) {
    const gearGeo = new G.CylinderGeometry(0.4, 0.4, 2, 8);
    gearGeo.translate(0, -fuselageMesh.position.y - 3, zOffset);
    const gearMesh = new G.Mesh(gearGeo, fuselageMat);
    g.add(gearMesh);
  }
  makeGear(-fuselageMesh.position.z / 2 + 2);   // nose gear
  makeGear(-fuselageMesh.position.z + wingSide * 10); // wing gears (left)
  makeGear(-fuselageMesh.position.z - wingSide * 10); // wing gears (right)

  return g;
}