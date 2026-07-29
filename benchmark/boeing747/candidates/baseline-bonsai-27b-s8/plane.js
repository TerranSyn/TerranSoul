export function buildPlane(THREE) {
  const {
    Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry,
    ConeGeometry, TorusGeometry, CapsuleGeometry, LatheGeometry,
    ExtrudeGeometry, MeshStandardMaterial, Vector3, Quaternion
  } = THREE;

  const fuse = new Group();

  // --- Livery helpers ---
  const white = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
  const grey  = new MeshStandardMaterial({ color: 0x888888, roughness: 0.7, metalness: 0.0 });
  const dark  = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.0 });
  const skin  = new MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0.0 });
  const gear  = new MeshStandardMaterial({ color: 0x666666, roughness: 0.8, metalness: 0.3 });
  const engine = new MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.4 });
  const door  = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.0 });

  // --- 1) Fuselage body (ExtrudeGeometry with upper-deck hump cross-section) ---
  const crossSec = new THREE.Path();
  const cs = [
    {x:0, y:0},    // top centre
    {x:0, y:0.42}, // top-right
    {x:0, y:0.65}, // upper-deck hump right-top
    {x:0, y:0.65}, // upper-deck right
    {x:0, y:0.55}, // lower-deck right
    {x:0, y:0.38}, // bottom-right
    {x:0, y:0.25}, // bottom centre
    {x:0, y:0.38}, // bottom-left
    {x:0, y:0.55}, // lower-deck left
    {x:0, y:0.65}, // upper-deck left
    {x:0, y:0.65}, // upper-deck hump left-top
    {x:0, y:0.42}, // top-left
    {x:0, y:0}     // close
  ];
  crossSec.setFromPoints(cs);
  const fusePath = new THREE.Path();
  fusePath.moveTo(0, 0, 0);
  fusePath.lineTo(62, 0, 0);
  fusePath.moveTo(62, 0, 0);
  fusePath.lineTo(68, 0.2, 0);
  fusePath.moveTo(68, 0.2, 0);
  fusePath.lineTo(70, 0, 0);
  fusePath.moveTo(70, 0, 0);
  fusePath.lineTo(73, 0, 0);
  fusePath.moveTo(73, 0, 0);
  fusePath.lineTo(78, 0.15, 0);
  fusePath.moveTo(78, 0.15, 0);
  fusePath.lineTo(80, 0, 0);
  fusePath.moveTo(80, 0, 0);
  fusePath.lineTo(83, 0.05, 0);
  fusePath.moveTo(83, 0.05, 0);
  fusePath.lineTo(86, 0, 0);
  fusePath.moveTo(86, 0, 0);
  fusePath.lineTo(92, 0, 0);
  fusePath.moveTo(92, 0, 0);
  fusePath.lineTo(96, 0, 0);
  fusePath.moveTo(96, 0, 0);
  fusePath.lineTo(102, 0, 0);

  const fuseGeo = new ExtrudeGeometry(fusePath, crossSec, 10, 8, true, true, true);
  const fuselage = new Mesh(fuseGeo, white);
  fuse.add(fuselage);

  // Nose cone cap
  const noseCone = new Mesh(ConeGeometry(0.6, 2.8, 32), white);
  noseCone.position.set(-1.8, 0, 0);
  fuse.add(noseCone);

  // Nose tip cap
  const noseTip = new Mesh(ConeGeometry(0.08, 0.5, 16), white);
  noseTip.position.set(-1.9, 0, 0);
  fuse.add(noseTip);

  // --- 2) Upper-deck hump (capsule) ---
  const humpGeo = new CapsuleGeometry(0.75, 1.1, 16, 8);
  const hump = new Mesh(humpGeo, white);
  hump.position.set(32, 0.35, 0);
  fuse.add(hump);

  // Upper-deck windows (dark rectangles)
  const winGeo = new BoxGeometry(0.45, 0.08, 0.12);
  const winMat = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (let i = 0; i < 10; i++) {
    const w = new Mesh(winGeo, winMat);
    w.position.set(28 + i * 4.2, 0.6, 0.05);
    fuse.add(w);
  }
  for (let i = 0; i < 10; i++) {
    const w = new Mesh(winGeo, winMat);
    w.position.set(28 + i * 4.2, 0.6, -0.05);
    fuse.add(w);
  }

  // --- 3) Lower-deck windows ---
  const lowWinGeo = new BoxGeometry(0.4, 0.06, 0.1);
  const lowWinMat = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (let i = 0; i < 22; i++) {
    const w = new Mesh(lowWinGeo, lowWinMat);
    w.position.set(24 + i * 3.5, 0, 0.04);
    fuse.add(w);
  }
  for (let i = 0; i < 22; i++) {
    const w = new Mesh(lowWinGeo, lowMat = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
    w.position.set(24 + i * 3.5, 0, -0.04);
    fuse.add(w);
  }

  // --- 4) Door lines ---
  const doorGeo = new BoxGeometry(0.6, 0.04, 0.3);
  const doorMat = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const d = new Mesh(doorGeo, doorMat);
    d.position.set(36, 0, 0);
    d.rotation.y = i * 0.6;
    fuse.add(d);
  }

  // --- 5) Wings (swept + dihedral) ---
  const wingRoot = new Mesh(BoxGeometry(0.55, 2.8, 0.7), white);
  wingRoot.position.set(26, 0, 0);
  fuse.add(wingRoot);

  // Wing upper surface
  const wingTop = new Mesh(BoxGeometry(0.5, 2.6, 0.5), white);
  wingTop.position.set(26, 0.15, 0);
  fuse.add(wingTop);

  // Wing lower surface
  const wingBot = new Mesh(BoxGeometry(0.5, 2.6, 0.5), white);
  wingBot.position.set(26, -0.15, 0);
  fuse.add(wingBot);

  // Wing tip
  const wingTip = new Mesh(BoxGeometry(0.15, 0.25, 0.3), white);
  wingTip.position.set(26, 0, 1.4);
  fuse.add(wingTip);

  // Wing root fairing
  const wingRootFair = new Mesh(BoxGeometry(0.7, 0.7, 0.2), white);
  wingRootFair.position.set(26, 0, 0);
  fuse.add(wingRootFair);

  // Wing sweep + dihedral via rotation
  const sweepDeg = 37.5;
  const dihedralDeg = 9;
  wingRoot.rotation.y = -sweepDeg * Math.PI / 180;
  wingRoot.rotation.x = dihedralDeg * Math.PI / 180;

  // --- 6) Engines (cylinders under wings) ---
  const engineGeo = new CylinderGeometry(0.35, 2.2, 24);
  const engineMat = new MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.4 });

  // Engine positions: two under each wing
  const engPositions = [
    {x: 26, y: -0.5, z: 0.8},
    {x: 26, y: -0.5, z: -0.8},
    {x: 26, y: -0.5, z: 1.4},
    {x: 26, y: -0.5, z: -1.4}
  ];

  const engines = [];
  engPositions.forEach((p, i) => {
    const eng = new Mesh(engineGeo, engineMat);
    eng.position.set(p.x, p.y, p.z);
    eng.rotation.y = -sweepDeg * Math.PI / 180;
    eng.rotation.x = dihedralDeg * Math.PI / 180;
    fuse.add(eng);
    engines.push(eng);
  });

  // Engine nacelle covers (cylinders)
  const nacelleGeo = new CylinderGeometry(0.45, 0.6, 16);
  const nacelleMat = new MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.3 });
  engPositions.forEach((p, i) => {
    const nac = new Mesh(nacelleGeo, nacelleMat);
    nac.position.set(p.x, p.y, p.z);
    nac.rotation.y = -sweepDeg * Math.PI / 180;
    nac.rotation.x = dihedralDeg * Math.PI / 180;
    fuse.add(nac);
  });

  // Engine intake ports
  const intakeGeo = new CylinderGeometry(0.12, 0.2, 10);
  const intakeMat = new MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  engPositions.forEach((p, i) => {
    const intake = new Mesh(intakeGeo, intakeMat);
    intake.position.set(p.x, p.y, p.z + 0.2);
    intake.rotation.y = -sweepDeg * Math.PI / 180;
    intake.rotation.x = dihedralDeg * Math.PI / 180;
    fuse.add(intake);
  });

  // --- 7) Wing root fairings ---
  const wingRootFairingGeo = new CylinderGeometry(0.3, 0.9, 12);
  const wingRootFairingMat = new MeshStandardMaterial({ color: 0x333333, roughness: 0.4 });
  const wingRootFairings = [];
  [0.8, -0.8].forEach(z => {
    const fairing = new Mesh(wingRootFairingGeo, wingRootFairingMat);
    fairing.position.set(26, 0, z);
    fairing.rotation.y = -sweepDeg * Math.PI / 180;
    fairing.rotation.x = dihedralDeg * Math.PI / 180;
    fuse.add(fairing);
    wingRootFairings.push(fairing);
  });

  // --- 8) Vertical stabilizer ---
  const vertStabGeo = new BoxGeometry(1.0, 5.5, 0.7);
  const vertStabMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const verticalStab = new Mesh(vertStabGeo, vertStabMat);
  verticalStab.position.set(93, 0.5, 0);
  fuse.add(verticalStab);

  // Stabilizer fin on top
  const stabFin = new Mesh(BoxGeometry(0.8, 1.2, 0.5), white);
  stabFin.position.set(93, 1.4, 0);
  fuse.add(stabFin);

  // Stabilizer window
  const stabWin = new Mesh(BoxGeometry(0.5, 0.15, 0.1), dark);
  stabWin.position.set(93, 1.0, 0);
  fuse.add(stabWin);

  // --- 9) Horizontal stabilizers ---
  const horizStabGeo = new BoxGeometry(2.5, 0.4, 0.35);
  const horizStabMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const horizStabs = [];
  [-0.4, 0.4].forEach(z => {
    const hs = new Mesh(horizStabGeo, horizStabMat);
    hs.position.set(88, 0.3, z);
    fuse.add(hs);
    horizStabs.push(hs);
  });

  // Horizontal stabilizer windows
  const hsWin = new Mesh(BoxGeometry(0.6, 0.08, 0.1), dark);
  [-0.4, 0.4].forEach(z => {
    const win = new Mesh(hsWin, dark);
    win.position.set(88, 0.3, z);
    fuse.add(win);
  });

  // --- 10) Nose strut (two wheels) ---
  const strutGeo = new CylinderGeometry(0.08, 1.2, 16);
  const strutMat = new MeshStandardMaterial({ color: 0x666666, roughness: 0.8 });
  const strut = new Mesh(strutGeo, strutMat);
  strut.position.set(0.8, -0.5, 0);
  fuse.add(strut);

  const strutWheelGeo = new CapsuleGeometry(0.12, 0.25, 12, 8);
  const strutWheelMat = new MeshStandardMaterial({ color: 0x555555, roughness: 0.7 });
  const strutWheels = [];
  [-0.15, 0.15].forEach(z => {
    const wheel = new Mesh(strutWheelGeo, strutWheelMat);
    wheel.position.set(0.8, -0.5, z);
    fuse.add(wheel);
    strutWheels.push(wheel);
  });

  // Strut top bracket
  const strutBracket = new Mesh(BoxGeometry(0.25, 0.08, 0.15), grey);
  strutBracket.position.set(0.8, -0.65, 0);
  fuse.add(strutBracket);

  // --- 11) Main landing gear (four trucks) ---
  const mainGearStruts = [];
  const mainGearWheels = [];
  const gearPositions = [
    {x: 34, y: -0.6, z: 0.5},
    {x: 34, y: -0.6, z: -0.5},
    {x: 44, y: -0.6, z: 0.5},
    {x: 44, y: -0.6, z: -0.5}
  ];

  gearPositions.forEach((p, i) => {
    // Main strut
    const strut = new Mesh(CylinderGeometry(0.12, 1.0, 16), strutMat);
    strut.position.set(p.x, -0.7, p.z);
    fuse.add(strut);
    mainGearStruts.push(strut);

    // Wheel
    const wheel = new Mesh(CapsuleGeometry(0.15, 0.35, 12, 8), strutWheelMat);
    wheel.position.set(p.x, -0.85, p.z);
    fuse.add(wheel);
    mainGearWheels.push(wheel);
  });

  // Gear trusses (cylinders connecting struts)
  const trussGeo = new CylinderGeometry(0.04, 0.4, 8);
  const trussMat = new MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
  const trusses = [];
  // Between gears at same Z, different X
  [-0.5, 0.5].forEach(z => {
    const truss = new Mesh(trussGeo, trussMat);
    truss.position.set(39, -0.7, z);
    truss.rotation.x = Math.PI / 2;
    fuse.add(truss);
    trusses.push(truss);
  });

  // Between gears at same X, different Z
  [34, 44].forEach(x => {
    const truss = new Mesh(trussGeo, trussMat);
    truss.position.set(x, -0.7, 0);
    truss.rotation.z = -Math.PI / 2;
    fuse.add(truss);
    trusses.push(truss);
  });

  // Gear bracket at top of struts
  const gearBracket = new Mesh(BoxGeometry(0.3, 0.08, 0.15), grey);
  gearBracket.position.set(34, -0.65, 0);
  fuse.add(gearBracket);

  // --- 12) Tail fin / lower tail section ---
  const tailLower = new Mesh(BoxGeometry(0.6, 1.0, 0.4), white);
  tailLower.position.set(96, 0.2, 0);
  fuse.add(tailLower);

  // Tail window
  const tailWin = new Mesh(BoxGeometry(0.4, 0.12, 0.1), dark);
  tailWin.position.set(96, 0.3, 0);
  fuse.add(tailWin);

  // --- 13) Nose door ---
  const noseDoor = new Mesh(BoxGeometry(0.8, 0.2, 0.3), doorMat);
  noseDoor.position.set(-0.5, 0.05, 0);
  fuse.add(noseDoor);

  // Engine cowling lines (dark strips)
  const cowlingLineGeo = new BoxGeometry(0.5, 0.06, 0.15);
  const cowlingLineMat = new MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const cowlingLines = [];
  [0.8, -0.8].forEach(z => {
    const line = new Mesh(cowlingLineGeo, cowlingLineMat);
    line.position.set(26, -0.1, z);
    line.rotation.y = -sweepDeg * Math.PI / 180;
    line.rotation.x = dihedralDeg * Math.PI / 180;
    fuse.add(line);
    cowlingLines.push(line);
  });

  // Wing leading edge lines
  const leadEdgeGeo = new BoxGeometry(0.3, 0.04, 0.4);
  const leadEdgeMat = new MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const leadEdges = [];
  [-0.8, 0.8].forEach(z => {
    const edge = new Mesh(leadEdgeGeo, leadEdgeMat);
    edge.position.set(26, 0.05, z);
    edge.rotation.y = -sweepDeg * Math.PI / 180;
    edge.rotation.x = dihedralDeg * Math.PI / 180;
    fuse.add(edge);
    leadEdges.push(edge);
  });

  // Fuselage structural lines
  const fuselageLine = new Mesh(BoxGeometry(0.04, 0.02, 0.1), dark);
  for (let x = 10; x <= 90; x += 5) {
    const line = new Mesh(BoxGeometry(0.02, 0.01, 0.05), dark);
    line.position.set(x, 0, 0);
    fuse.add(line);
  }

  // Wake / trailing edge lines
  const wakeLine = new Mesh(BoxGeometry(0.02, 0.01, 0.05), dark);
  for (let x = 90; x <= 98; x += 3) {
    const line = new Mesh(BoxGeometry(0.02, 0.01, 0.05), dark);
    line.position.set(x, 0, 0);
    fuse.add(line);
  }

  return fuse;
}