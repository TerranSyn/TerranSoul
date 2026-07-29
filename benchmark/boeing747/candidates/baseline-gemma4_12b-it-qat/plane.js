/**
 * Builds a realistic Boeing 747-8 style airliner using only primitive geometries.
 * Orientation: Nose (+X), Up (+Y), Wings (Z-axis).
 */
export function buildPlane(THREE) {
  const group = new THREE.Group();

  // Materials
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.8, roughness: 0.2 }); // White/Silver fuselage
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.3 }); // Grey wings
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 1.0, roughness: 0.2 }); // Dark engines
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x003399, metalness: 0.5, roughness: 0.5 });   // Blue livery accent
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

  // --- FUSELAGE ---
  // Main body (Cylinder for roundness)
  const fuselageBody = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 70, 32),
    bodyMat
  );
  fuselageBody.rotation.z = Math.PI / 2; // Align cylinder length with X axis
  group.add(fuselageBody);

  // Nose Cone (Sphere/Cone)
  const noseCone = new THREE.Mesh(
    new THREE.SphereGeometry(4, 32, 32),
    bodyMat
  );
  noseCone.position.x = 35;
  noseCone.scale.set(1, 0.8, 0.8);
  group.add(noseCone);

  // Tail Cone (Cylinder/Cone)
  const tailCone = new THREE.Mesh(
    new THREE.ConeGeometry(4, 15, 32),
    bodyMat
  );
  tailCone.position.x = -40;
  tailCone.rotation.z = Math.PI / 2;
  group.add(tailCone);

  // Upper Deck Hump (The iconic 747 feature)
  const hump = new THREE.Mesh(
    new THREE.SphereGeometry(3, 32, 32),
    bodyMat
  );
  hump.position.set(-5, 4.5, 0);
  hump.scale.set(15, 1, 1);
  group.add(hump);

  // --- WINGS ---
  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, -1, 0);
  group.add(wingGroup);

  // Main Wings (Swept and Dihedral)
  const createWingSide = (side) => {
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(25, 0.5, 18),
      wingMat
    );
    // Sweep back (~37 degrees) and slight dihedral up
    w.position.x = -15 * side;
    w.rotation.y = (Math.PI / 6) * side; // Sweep
    w.rotation.z = 0.05 * side;           // Dihedral
    return w;
  };

  const leftWing = createWingSide(-1);
  const rightWing = createWingSide(1);
  wingGroup.add(leftWing, rightWing);

  // --- ENGINES ---
  const engineGroup = new THREE.Group();
  wingGroup.add(engineGroup);

  const createEngine = (side) => {
    const e = new THREE.Group();
    const nacelle = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 8, 16),
      engineMat
    );
    nacelle.rotation.z = Math.PI / 2;
    e.add(nacelle);

    const intake = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 0.5, 16),
      engineMat
    );
    intake.rotation.z = Math.PI / 2;
    intake.position.x = 4;
    e.add(intake);

    // Position engines under the swept wings
    e.position.set(-18 * side, -3, 6 * side);
    return e;
  };

  engineGroup.add(createEngine(-1)); // Left engine
  engineGroup.add(createEngine(1));  // Right engine

  // --- TAIL SECTION ---
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-32, 0, 0);
  group.add(tailGroup);

  // Vertical Stabilizer (Fin)
  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(1, 15, 6),
    tailMat
  );
  fin.position.set(0, 7, 0);
  tailGroup.add(fin);

  // Horizontal Stabilizers
  const hStab = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.3, 4),
    wingMat
  );
  hStab.position.set(0, -2, 0);
  tailGroup.add(hStab);

  // --- LANDING GEAR ---
  const gearGroup = new THREE.Group();
  group.add(gearGroup);

  const createGear = (x, z) => {
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 5),
      engineMat
    );
    strut.position.set(x, -4, z);
    strut.rotation.z = Math.PI / 2;

    const wheel = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 16),
      engineMat
    );
    wheel.position.set(x, -6.5, z);
    return { strut, wheel };
  };

  // Nose Gear
  const nose = createGear(20, 0);
  gearGroup.add(nose.strut);
  gearGroup.add(nose.wheel);

  // Main Gears (4 trucks)
  const mainGears = [
    [10, 5], [10, -5], [-5, 6], [-5, -6]
  ];
  mainGears.forEach(pos => {
    const g = createGear(pos[0], pos[1]);
    gearGroup.add(g.strut);
    gearGroup.add(g.wheel);
  });

  // --- DETAILS (Windows) ---
  const windowLine = new THREE.Mesh(
    new THREE.BoxGeometry(65, 0.2, 4.1),
    windowMat
  );
  windowLine.position.set(30, 0, 0);
  group.add(windowLine);

  return group;
}