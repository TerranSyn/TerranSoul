// Boeing-747 primitives-only candidate — terransoul-gemma track, iter 2 (expert refinement).
// Improvements: Fixed wing attachment (root overlap), corrected fuselage proportions (~11:1 ratio),
// added pylons for engines, refined hump geometry, and improved empennage sweep/scale.
export function buildPlane(THREE) {
  const group = new THREE.Group();

  // --- Materials ---
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); // Main white fuselage
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });   // Engines, wings, gear
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8 });  // Tail/Livery blue
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x333333, transparent: true, opacity: 0.8 });

  // --- Fuselage (Proportions: Length ~70, Diameter ~6 -> Ratio ~11.6:1) ---
  const fuselageBody = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 70, 32), bodyMat);
  fuselageBody.rotation.z = -Math.PI / 2; // Align along X axis
  group.add(fuselageBody);

  // Nose Cone (Tapered)
  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(3, 12, 32), bodyMat);
  noseCone.rotation.z = -Math.PI / 2;
  noseCone.position.x = 36; 
  group.add(noseCone);

  // Tail Cone (Tapered)
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(3, 0.5, 8, 32), bodyMat);
  tailCone.rotation.z = -Math.PI / 2;
  tailCone.position.x = -36;
  group.add(tailCone);

  // --- Upper Deck Hump (Small, forward-biased) ---
  const humpBase = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 5.8), bodyMat);
  humpBase.position.set(12, 3.2, 0); // Sits on top of front third
  group.add(humpBase);
  
  const humpFront = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 16), bodyMat);
  humpFront.scale.set(1.4, 0.9, 1); // Flattened for aerodynamic look
  humpFront.position.set(18, 3.5, 0);
  group.add(humpFront);

  // --- Wings (Fixed Attachment & Sweep) ---
  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, -0.2, 0); // Center of fuselage
  group.add(wingGroup);

  const createWingHalf = (side) => {
    const sideSign = side === 1 ? 1 : -1;
    
    // Wing Root: Wide enough to overlap the fuselage diameter (6 units wide)
    // Geometry is tapered: root chord ~14, tip chord ~8.
    const wingRootGeo = new THREE.BoxGeometry(32, 0.7, 14); 
    const wingRoot = new THREE.Mesh(wingRootGeo, darkMat);
    
    // Positioned so the root overlaps the fuselage center (x=0)
    // Offset slightly back to account for sweep and forward-center of gravity
    wingRoot.position.set(-8 * sideSign, -3, 12 * sideSign);
    
    const sweep = (Math.PI / 180) * 37;   // ~37 deg sweep
    const dihedral = (Math.PI / 180) * 7; // ~7 deg upward angle
    wingRoot.rotation.y = sideSign * sweep;
    wingRoot.rotation.x = dihedral;
    
    wingGroup.add(wingRoot);

    // Wing Tip: Extended further out
    const tipGeo = new THREE.BoxGeometry(18, 0.6, 9);
    const wingTip = new THREE.Mesh(tipGeo, darkMat);
    wingTip.position.set(-24 * sideSign, -3.5, 24 * sideSign);
    wingTip.rotation.y = sideSign * sweep;
    wingTip.rotation.x = dihedral;
    wingGroup.add(wingTip);

    // Engines (4 total: 2 per wing)
    const engineGeo = new THREE.CylinderGeometry(1.8, 1.6, 6, 12);
    const pylonGeo = new THREE.BoxGeometry(0.8, 1.2, 3.5);

    // Inboard and Outboard positions relative to wing root/tip
    const configs = [
      { xOff: -4 * sideSign, zOff: 9 },   // Inboard
      { xOff: -16 * sideSign, zOff: 18 }  // Outboard
    ];

    configs.forEach(cfg => {
      // Nacelle
      const engine = new THREE.Mesh(engineGeo, darkMat);
      engine.rotation.z = Math.PI / 2;
      engine.position.set(cfg.xOff, -6.5, cfg.zOff * sideSign);
      wingGroup.add(engine);

      // Pylon (Connects engine to wing)
      const pylon = new THREE.Mesh(pylonGeo, darkMat);
      pylon.position.set(cfg.xOff + (1.5 * sideSign), -4.8, cfg.zOff * sideSign);
      wingGroup.add(pylon);
    });
  };

  createWingHalf(1);  // Right Wing
  createWingHalf(-1); // Left Wing

  // --- Empennage (Tail Section) ---
  const tailBase = new THREE.Group();
  tailBase.position.set(-32, 0, 0);
  group.add(tailBase);

  // Vertical Fin (Tall and Swept)
  const vertFin = new THREE.Mesh(new THREE.BoxGeometry(7, 15, 0.8), accentMat);
  vertFin.position.set(-2, 8, 0);
  vertFin.rotation.z = -Math.PI / 180 * 30; // Swept back
  tailBase.add(vertFin);

  // Horizontal Stabilizers (Swept)
  const hStabGeo = new THREE.BoxGeometry(14, 0.6, 5);
  const hStabL = new THREE.Mesh(hStabGeo, accentMat);
  hStabL.position.set(-9, 3, 4);
  hStabL.rotation.z = Math.PI / 180 * 35; // Swept back
  tailBase.add(hStabL);

  const hStabR = new THREE.Mesh(hStabGeo, accentMat);
  hStabR.position.set(-9, 3, -4);
  hStabR.rotation.z = -Math.PI / 180 * 35; // Swept back
  tailBase.add(hStabR);

  // --- Landing Gear (Bogies) ---
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
    { x: -14, z: 6 }, { x: -14, z: -6 },
    { x: -12, z: 10 }, { x: -12, z: -10 }
  ];

  mainPos.forEach(pos => {
    const strut = new THREE.Mesh(strutGeo, darkMat);
    strut.position.set(pos.x, -7, pos.z);
    gearGroup.add(strut);
    // 4 wheels per bogie truck
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
  
  // Main Deck Row (Longer for 747 scale)
  for (let i = 0; i < 50; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.1), glassMat);
      w.position.set(-32 + i * 1.3, 1.2, side * 2.8);
      winGroup.add(w);
    });
  }

  // Upper Deck Row (Hump)
  for (let i = 0; i < 15; i++) {
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
  winGroup.add(cw(32, 2.5, 2.8, Math.PI / 180 * 15));
  winGroup.add(cw(32, 2.5, -2.8, -Math.PI / 180 * 15));
  winGroup.add(cw(29, 2.8, 3.5, Math.PI / 180 * 45));
  winGroup.add(cw(29, 2.8, -3.5, -Math.PI / 180 * 45));

  group.add(winGroup);

  return group;
}