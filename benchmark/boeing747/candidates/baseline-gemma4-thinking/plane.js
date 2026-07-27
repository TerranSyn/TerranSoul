export function buildPlane(THREE) {
  const group = new THREE.Group();

  // --- Materials ---
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White fuselage
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x333333 });   // Dark grey tail
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x666666 });  // Grey engines
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });     // Light grey wings
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x222222 });     // Black landing gear

  // --- Fuselage (LatheGeometry for the iconic hump) ---
  // Profile points: [Radius, Length]
  const profilePoints = [
    [0, 0],      // Nose tip
    [1.5, 5],    // Nose curve
    [6, 12],     // Cockpit base
    [7.5, 25],   // Upper deck hump peak
    [6.8, 45],   // Mid fuselage
    [6.2, 60],   // Rear fuselage
    [3, 70]      // Tail connection
  ];

  const curvePoints = profilePoints.map(p => new THREE.Vector3(p[0], p[1], 0));
  const curve = new THREE.CatmullRomCurve3(curvePoints);
  const fuselageGeo = new THREE.LatheGeometry(curve, 32);
  const fuselage = new THREE.Mesh(fuselageGeo, bodyMat);
  // Rotate to align length with +X axis (Lathe is usually Y-up)
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);

  // --- Wings ---
  const wingSpan = 60;
  const wingSweep = (37 * Math.PI) / 180; // ~37 degrees sweep back
  const wingDihedral = (3 * Math.PI) / 180; // Slight upward tilt

  // Left Wing
  const leftWingGeo = new THREE.BoxGeometry(2, 1.5, wingSpan);
  const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
  leftWing.position.set(20, -2, 0); // Positioned at mid-fuselage
  leftWing.rotation.y = wingSweep;
  leftWing.rotation.x = wingDihedral;
  group.add(leftWing);

  // Right Wing
  const rightWingGeo = new THREE.BoxGeometry(2, 1.5, wingSpan);
  const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
  rightWing.position.set(20, -2, 0);
  rightWing.rotation.y = -wingSweep;
  rightWing.rotation.x = -wingDihedral;
  group.add(rightWing);

  // --- Tail (Vertical Stabilizer) ---
  const tailFinGeo = new THREE.ConeGeometry(4, 15, 8);
  const tailFin = new THREE.Mesh(tailFinGeo, tailMat);
  tailFin.position.set(60, 12, 0);
  tailFin.rotation.z = Math.PI / 2; // Pointing up and back
  group.add(tailFin);

  // --- Tail (Horizontal Stabilizers) ---
  const horizStabGeo = new THREE.BoxGeometry(1, 0.5, 15);
  const hStabLeft = new THREE.Mesh(horizStabGeo, tailMat);
  hStabLeft.position.set(62, -2, 7);
  group.add(hStabLeft);

  const hStabRight = new THREE.Mesh(horizStabGeo, tailMat);
  hStabRight.position.set(62, -2, -7);
  group.add(hStabRight);

  // --- Engines (4 total) ---
  const createEngine = () => {
    const engineGroup = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(1.5, 1.5, 6, 8);
    const intakeGeo = new THREE.SphereGeometry(1.6, 8, 8);
    
    const body = new THREE.Mesh(bodyGeo, engineMat);
    body.rotation.x = Math.PI / 2; // Align cylinder length with X
    
    const intake = new THREE.Mesh(intakeGeo, engineMat);
    intake.position.set(3, 0, 0); // Front of the cylinder
    
    engineGroup.add(body);
    engineGroup.add(intake);
    return engineGroup;
  };

  const engines = [
    { x: 25, z: 18 },  // Left Inner
    { x: 25, z: -18 }, // Right Inner
    { x: 30, z: 24 },  // Left Outer
    { x: 30, z: -24 }  // Right Outer
  ];

  engines.forEach(pos => {
    const engine = createEngine();
    engine.position.set(pos.x, -5, pos.z);
    group.add(engine);
  });

  // --- Landing Gear ---
  // Nose Gear
  const noseStrutGeo = new THREE.CylinderGeometry(0.3, 0.3, 6, 8);
  const noseStrut = new THREE.Mesh(noseStrutGeo, gearMat);
  noseStrut.position.set(12, -7, 0);
  group.add(noseStrut);

  // Main Gear (Simplified trucks)
  const mainGearPos = [
    { x: 35, z: 14 },
    { x: 35, z: -14 }
  ];
  mainGearPos.forEach(pos => {
    const strut = new THREE.Mesh(noseStrutGeo, gearMat);
    strut.position.set(pos.x, -8, pos.z);
    group.add(strut);
    
    // Wheels
    const wheelGeo = new THREE.BoxGeometry(1, 0.5, 1);
    const wheel = new THREE.Mesh(wheelGeo, gearMat);
    wheel.position.set(pos.x, -10, pos.z);
    group.add(wheel);
  });

  // --- Livery Details (Window Line) ---
  const windowLineGeo = new THREE.BoxGeometry(40, 0.2, 6.5);
  const windowLine = new THREE.Mesh(windowLineGeo, bodyMat);
  windowLine.position.set(15, 3, 0);
  group.add(windowLine);

  return group;
}