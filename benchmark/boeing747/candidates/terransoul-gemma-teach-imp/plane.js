// Boeing-747-400 high-fidelity module — expert refinement.
// Improvements: Tapered planform wings (Shape/Extrude), 18-wheel landing gear, 
// faired partial hump (<1/3 length), and correct engine pylon/nacelle geometry.
export function buildPlane(THREE) {
  const group = new THREE.Group();

  // --- Materials ---
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }); // Main white fuselage
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });   // Engines, wings, gear
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x0a2e5c, roughness: 0.3 });  // Tail/Livery blue
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.8 });

  // --- Constants (Proportions) ---
  const F_LEN = 70;       // Fuselage Length
  const F_RAD = 3;        // Fuselage Radius
  const W_SPAN = 64;      // Wingspan (~0.9x length for square plan box)
  const HUMP_LEN = 23;    // ~1/3 of fuselage

  // --- Fuselage ---
  const fuselageBody = new THREE.Mesh(new THREE.CylinderGeometry(F_RAD, F_RAD, F_LEN, 32), bodyMat);
  fuselageBody.rotation.z = -Math.PI / 2;
  group.add(fuselageBody);

  // Nose Cone (Tapered)
  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(F_RAD, 14, 32), bodyMat);
  noseCone.rotation.z = -Math.PI / 2;
  noseCone.position.x = F_LEN / 2 + 7; 
  group.add(noseCone);

  // Tail Cone
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(F_RAD, 0.5, 10, 32), bodyMat);
  tailCone.rotation.z = -Math.PI / 2;
  tailCone.position.x = -(F_LEN / 2) + 5;
  group.add(tailCone);

  // --- Upper Deck Hump (Partial Length, Faired) ---
  // Using a scaled sphere to create a smooth "lump" that blends into the crown
  const hump = new THREE.Mesh(new THREE.SphereGeometry(F_RAD * 0.8, 32, 16), bodyMat);
  hump.scale.set(HUMP_LEN / (F_RAD * 2), 1.2, 1.5); 
  hump.position.set(F_LEN / 4, F_RAD + 0.5, 0); // Positioned forward-biased
  group.add(hump);

  // --- Wings (Tapered Planform & Dihedral) ---
  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, -1, 0); // Lower-mid fuselage mount
  group.add(wingGroup);

  const createWingHalf = (side) => {
    const s = side === 1 ? 1 : -1;
    
    // Define tapered planform shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);                      // Root LE
    shape.lineTo(-32, 24 * s);               // Tip LE (Sweep)
    shape.lineTo(-35, 26 * s);               // Tip TE (Taper)
    shape.lineTo(-14, 0);                     // Root TE
    shape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false });
    const wingHalf = new THREE.Mesh(wingGeo, darkMat);
    
    // Rotate for Sweep (~37.5deg) and Dihedral (~7deg)
    wingHalf.rotation.y = s * (Math.PI / 180 * 37.5);
    wingHalf.rotation.x = Math.PI / 180 * 7;
    
    // Position: Sink root into fuselage belly slightly for craftsmanship overlap
    wingHalf.position.set(-2 * s, -0.5, 0);
    wingGroup.add(wingHalf);

    // Winglet (-400 Identity)
    const wingletGeo = new THREE.ExtrudeGeometry(new THREE.Shape({
      moveTo: (0,0), lineTo: (2, 3 * s), lineTo: (1, 6 * s), close: true
    }), { depth: 0.4, bevelEnabled: false });
    const winglet = new THREE.Mesh(wingletGeo, darkMat);
    winglet.position.set(-32 * s, 0, 24 * s);
    winglet.rotation.z = s * (Math.PI / 180 * 75); // Canted up
    wingGroup.add(winglet);

    // --- Engines (Four Underwing) ---
    const createEngine = (xOff, zOff) => {
      const engineGrp = new THREE.Group();
      
      // Nacelle: Open-ended cylinder with dark inlet and exhaust plug
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(2.4 * 0.6, 2.4 * 0.6, 7, 16), darkMat);
      nacelle.rotation.z = Math.PI / 2;
      
      const inlet = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.1, 8, 16), darkMat);
      inlet.position.x = -3.4; // Front of nacelle
      inlet.rotation.y = Math.PI / 2;

      const exhaust = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2, 8), darkMat);
      exhaust.position.x = 3.5;
      exhaust.rotation.z = -Math.PI / 2;

      engineGrp.add(nacelle, inlet, exhaust);

      // Pylon: Tapered wedge connecting wing underside to nacelle crown
      const pylonGeo = new THREE.BoxGeometry(1.5, 0.8, 4);
      const pylon = new THREE.Mesh(pylonGeo, darkMat);
      pylon.position.set(2, -1, 0); // Offset to overlap wing and nacelle
      engineGrp.add(pylon);

      // Position along swept leading edge: ~0.28 (inboard) and ~0.62 (outboard)
      const spanPos = (W_SPAN / 2);
      engineGrp.position.set(xOff * s, -5, zOff * s);
      return engineGrp;
    };

    // Inboard: ~14 units out | Outboard: ~30 units out
    wingGroup.add(createEngine(-8 * s, 9));
    wingGroup.add(createEngine(-20 * s, 18));
  };

  createWingHalf(1);  // Right
  createWingHalf(-1); // Left

  // --- Empennage (Tail) ---
  const tailBase = new THREE.Group();
  tailBase.position.set(-32, 0, 0);
  group.add(tailBase);

  // Vertical Fin (Swept & Tall)
  const vertFin = new THREE.Mesh(new THREE.BoxGeometry(6, 18, 0.8), accentMat);
  vertFin.position.set(-2, 9, 0);
  vertFin.rotation.z = -Math.PI / 180 * 35;
  tailBase.add(vertFin);

  // Horizontal Stabilizers (Swept)
  const hStabGeo = new THREE.BoxGeometry(14, 0.6, 6);
  const hStabL = new THREE.Mesh(hStabGeo, accentMat);
  hStabL.position.set(-9, 3, 5);
  hStabL.rotation.z = Math.PI / 180 * 35;
  tailBase.add(hStabL);

  const hStabR = new THREE.Mesh(hStabGeo, accentMat);
  hStabR.position.set(-9, 3, -5);
  hStabR.rotation.z = -Math.PI / 180 * 35;
  tailBase.add(hStabR);

  // --- Landing Gear (18 Wheels Total) ---
  const gearGroup = new THREE.Group();
  group.add(gearGroup);

  const wheelGeo = new THREE.SphereGeometry(0.4, 12, 12);
  const strutGeo = new THREE.CylinderGeometry(0.15, 0.15, 6);

  // Nose Gear (2 wheels)
  const noseStrut = new THREE.Mesh(strutGeo, darkMat);
  noseStrut.position.set(20, -6, 0);
  gearGroup.add(noseStrut);
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.position.set(20, -9, i === 0 ? 0.7 : -0.7);
    gearGroup.add(w);
  }

  // Main Gear (4 bogies x 4 wheels = 16)
  const mainPos = [
    { x: -15, z: 8 }, { x: -15, z: -8 },   // Wing root / Belly
    { x: -13, z: 12 }, { x: -13, z: -12 }  // Outer wing/Belly
  ];

  mainPos.forEach(pos => {
    const strut = new THREE.Mesh(strutGeo, darkMat);
    strut.position.set(pos.x, -8, pos.z);
    gearGroup.add(strut);
    // 4 wheels per bogie truck
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const w = new THREE.Mesh(wheelGeo, darkMat);
        w.position.set(pos.x, -10.5, pos.z + (i === 0 ? 0.9 : -0.9) + (j === 0 ? 0.4 : -0.4));
        gearGroup.add(w);
      }
    }
  });

  // --- Windows & Cockpit (Low-Deck Relationship) ---
  const winGroup = new THREE.Group();
  
  // Main Deck Row
  for (let i = 0; i < 45; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.1), glassMat);
      w.position.set(-30 + i * 1.35, 1.2, side * 2.8);
      winGroup.add(w);
    });
  }

  // Upper Deck Row (Hump)
  for (let i = 0; i < 14; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.1), glassMat);
      w.position.set(5 + i * 1.2, 4.2, side * 2.2);
      winGroup.add(w);
    });
  }

  // Cockpit (Low on nose, forward of hump)
  const cw = (x, y, z, rot) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.1), glassMat);
    w.position.set(x, y, z);
    w.rotation.z = rot;
    return w;
  };
  winGroup.add(cw(30, 2.5, 2.8, Math.PI / 180 * 15));
  winGroup.add(cw(30, 2.5, -2.8, -Math.PI / 180 * 15));
  // Side cockpit windows (angled)
  winGroup.add(cw(27, 2.8, 4, Math.PI / 180 * 45));
  winGroup.add(cw(27, 2.8, -4, -Math.PI / 180 * 45));

  group.add(winGroup);

  return group;
}