// Boeing-747 primitives-only candidate — terransoul-gemma track, iter 3 (expert refinement).
// Improvements: Fixed wing-to-fuselage structural overlap, corrected engine pylon geometry,
// refined hump to a deck-style profile, and implemented high-fidelity landing gear bogies.
export function buildPlane(THREE) {
  const group = new THREE.Group();

  // --- Materials ---
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); // Main fuselage white
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x34495e });   // Engines, wings, gear (slate grey)
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 }); // Tail/Livery (deep navy)
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85 });

  // --- Fuselage (Proportions: Length ~70, Diameter ~6.3 -> Ratio ~11:1) ---
  const fuselageBody = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 70, 32), bodyMat);
  fuselageBody.rotation.z = -Math.PI / 2; // Align along X axis
  group.add(fuselageBody);

  // Nose Cone (Tapered)
  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(3.15, 14, 32), bodyMat);
  noseCone.rotation.z = -Math.PI / 2;
  noseCone.position.x = 37; 
  group.add(noseCone);

  // Tail Cone (Tapered)
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 0.6, 8, 32), bodyMat);
  tailCone.rotation.z = -Math.PI / 2;
  tailCone.position.x = -37;
  group.add(tailCone);

  // --- Upper Deck Hump (Deck-style profile) ---
  // Instead of a sphere, we use an elongated box to represent the "hump" deck
  const hump = new THREE.Mesh(new THREE.BoxGeometry(12, 2.5, 6), bodyMat);
  hump.position.set(14, 3.15, 0); // Sits perfectly on top of the fuselage
  group.add(hump);

  // --- Wings (Structural Overlap & Correct Sweep) ---
  const wingGroup = new THREE.Group();
  wingGroup.position.set(-2, -0.5, 0); // Positioned slightly back from center
  group.add(wingGroup);

  const createWingHalf = (side) => {
    const s = side === 1 ? 1 : -1;
    
    // Wing Root: Must overlap the fuselage diameter (6.3 units wide)
    // We use a large root box to ensure it "plugs" into the cylinder geometry
    const wingRootGeo = new THREE.BoxGeometry(25, 0.8, 12); 
    const wingRoot = new THREE.Mesh(wingRootGeo, darkMat);
    
    // Positioned so root overlaps fuselage center (x=0) and z-axis extends beyond radius
    wingRoot.position.set(-10 * s, -3.15, 12 * s);
    
    const sweep = (Math.PI / 180) * 37.5;   // ~37.5 deg sweep
    const dihedral = (Math.PI / 180) * 7;  // ~7 deg upward angle
    wingRoot.rotation.y = s * sweep;
    wingRoot.rotation.x = dihedral;
    
    wingGroup.add(wingRoot);

    // Wing Tip: Extended further out for wingspan
    const tipGeo = new THREE.BoxGeometry(18, 0.7, 9);
    const wingTip = new THREE.Mesh(tipGeo, darkMat);
    wingTip.position.set(-32 * s, -3.5, 24 * s);
    wingTip.rotation.y = s * sweep;
    wingTip.rotation.x = dihedral;
    wingGroup.add(wingTip);

    // Engines (4 total: 2 per wing)
    const engineGeo = new THREE.CylinderGeometry(1.8, 1.6, 6, 12);
    const pylonGeo = new THREE.BoxGeometry(0.9, 1.3, 3.5);

    // Inboard and Outboard positions relative to wing root/tip
    const configs = [
      { xOff: -4 * s, zOff: 8 },   // Inboard
      { xOff: -16 * s, zOff: 18 }  // Outboard
    ];

    configs.forEach(cfg => {
      // Nacelle (Engine)
      const engine = new THREE.Mesh(engineGeo, darkMat);
      engine.rotation.z = Math.PI / 2;
      engine.position.set(cfg.xOff, -6.5, cfg.zOff * s);
      wingGroup.add(engine);

      // Pylon (Connects engine to wing)
      const pylon = new THREE.Mesh(pylonGeo, darkMat);
      pylon.position.set(cfg.xOff + (1.2 * s), -4.8, cfg.zOff * s);
      wingGroup.add(pylon);
    });
  };

  createWingHalf(1);  // Right Wing
  createWingHalf(-1); // Left Wing

  // --- Empennage (Tail Section) ---
  const tailBase = new THREE.Group();
  tailBase.position.set(-34, 0, 0);
  group.add(tailBase);

  // Vertical Fin (Tall and Swept)
  const vertFin = new THREE.Mesh(new THREE.BoxGeometry(8, 16, 0.8), accentMat);
  vertFin.position.set(-2, 9, 0);
  vertFin.rotation.z = -Math.PI / 180 * 35; // Swept back
  tailBase.add(vertFin);

  // Horizontal Stabilizers (Swept)
  const hStabGeo = new THREE.BoxGeometry(14, 0.7, 6);
  const hStabL = new THREE.Mesh(hStabGeo, accentMat);
  hStabL.position.set(-10, 3, 5);
  hStabL.rotation.z = Math.PI / 180 * 35; // Swept back
  tailBase.add(hStabL);

  const hStabR = new THREE.Mesh(hStabGeo, accentMat);
  hStabR.position.set(-10, 3, -5);
  hStabR.rotation.z = -Math.PI / 180 * 35; // Swept back
  tailBase.add(hStabR);

  // --- Landing Gear (High-Fidelity Bogies) ---
  const gearGroup = new THREE.Group();
  group.add(gearGroup);

  const wheelGeo = new THREE.SphereGeometry(0.4, 12, 12);
  const strutGeo = new THREE.CylinderGeometry(0.2, 0.2, 6);

  // Nose Gear (Dual Wheel)
  const noseStrut = new THREE.Mesh(strutGeo, darkMat);
  noseStrut.position.set(18, -5, 0);
  gearGroup.add(noseStrut);
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.position.set(18, -8.5, i === 0 ? 0.6 : -0.6);
    gearGroup.add(w);
  }

  // Main Gear Bogies (4 trucks)
  const mainPos = [
    { x: -14, z: 7 }, { x: -14, z: -7 },
    { x: -12, z: 11 }, { x: -12, z: -11 }
  ];

  mainPos.forEach(pos => {
    const strut = new THREE.Mesh(strutGeo, darkMat);
    strut.position.set(pos.x, -7, pos.z);
    gearGroup.add(strut);
    // 4 wheels per bogie truck for the "heavy" 747 look
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const w = new THREE.Mesh(wheelGeo, darkMat);
        w.position.set(pos.x, -10, pos.z + (i === 0 ? 0.8 : -0.8) + (j === 0 ? 0.4 : -0.4));
        gearGroup.add(w);
      }
    }
  });

  // --- Windows & Details ---
  const winGroup = new THREE.Group();
  
  // Main Deck Row
  for (let i = 0; i < 52; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.1), glassMat);
      w.position.set(-33 + i * 1.3, 1.2, side * 2.8);
      winGroup.add(w);
    });
  }

  // Upper Deck Row (Hump)
  for (let i = 0; i < 16; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.1), glassMat);
      w.position.set(8 + i * 0.8, 4.2, side * 2.2);
      winGroup.add(w);
    });
  }

  // Cockpit Windshields (Angled)
  const cw = (x, y, z, rot) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.1), glassMat);
    w.position.set(x, y, z);
    w.rotation.z = rot;
    return w;
  };
  winGroup.add(cw(33, 2.5, 2.8, Math.PI / 180 * 15));
  winGroup.add(cw(33, 2.5, -2.8, -Math.PI / 180 * 15));
  winGroup.add(cw(30, 2.8, 3.5, Math.PI / 180 * 45));
  winGroup.add(cw(30, 2.8, -3.5, -Math.PI / 180 * 45));

  group.add(winGroup);

  return group;
}