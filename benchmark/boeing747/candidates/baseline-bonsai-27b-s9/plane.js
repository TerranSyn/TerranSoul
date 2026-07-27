export function buildPlane(THREE) {
  const {
    Group,
    Mesh,
    MeshStandardMaterial,
    BoxGeometry,
    CylinderGeometry,
    SphereGeometry,
    ConeGeometry,
    TorusGeometry,
    CapsuleGeometry,
    LatheGeometry,
    ExtrudeGeometry,
    Vector3,
    Geometry,
    Transform,
    Matrix3,
  } = THREE;

  const g = new Group();

  // === LIVERY COLORS ===
  const liveryWhite = new MeshStandardMaterial({ color: 0xFAFAFA, roughness: 0.15, metalness: 0.2 });
  const liveryBlue = new MeshStandardMaterial({ color: 0x0033AA, roughness: 0.1, metalness: 0.15 });
  const liveryDarkBlue = new MeshStandardMaterial({ color: 0x002299, roughness: 0.1, metalness: 0.15 });
  const liveryGray = new MeshStandardMaterial({ color: 0x6B7080, roughness: 0.2, metalness: 0.1 });
  const liveryDarkGray = new MeshStandardMaterial({ color: 0x3A3D45, roughness: 0.15, metalness: 0.2 });
  const liveryLightGray = new MeshStandardMaterial({ color: 0xE0E0E8, roughness: 0.2, metalness: 0.1 });
  const liveryEngine = new MeshStandardMaterial({ color: 0x0044AA, roughness: 0.15, metalness: 0.2 });
  const liveryGear = new MeshStandardMaterial({ color: 0x888888, roughness: 0.25, metalness: 0.3 });
  const liveryWindow = new MeshStandardMaterial({ color: 0x1A2540, roughness: 0.05, metalness: 0.1 });
  const liveryDoor = new MeshStandardMaterial({ color: 0x555555, roughness: 0.2, metalness: 0.1 });
  const liveryRim = new MeshStandardMaterial({ color: 0x999999, roughness: 0.2, metalness: 0.3 });

  // === HELPER: create capsule mesh ===
  function makeCapsule(length, radius, material, scale = 1) {
    const geo = new CapsuleGeometry(length, radius, 16, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create lathe mesh ===
  function makeLathe(height, radius, innerRadius, material, scale = 1) {
    const points = [
      { t: 0, r: innerRadius },
      { t: 0.2, r: innerRadius },
      { t: 0.4, r: innerRadius },
      { t: 0.6, r: innerRadius },
      { t: 0.8, r: innerRadius },
      { t: 1, r: innerRadius },
    ];
    const geo = new LatheGeometry(height, radius, innerRadius, points, 12, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create extruded profile ===
  function makeExtruded(width, depth, height, topShape, material, scale = 1) {
    const points = [
      { x: -width / 2, z: -depth / 2, y: 0 },
      { x: -width / 2, z: depth / 2, y: 0 },
      { x: width / 2, z: depth / 2, y: 0 },
      { x: width / 2, z: -depth / 2, y: 0 },
    ];
    const geo = new ExtrudeGeometry(points, topShape, 3, 4);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create box with rounded edges ===
  function makeRoundedBox(length, width, height, cornerRadius, material, scale = 1) {
    const geo = new BoxGeometry(length, width, height);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    // We'll use scale to approximate rounding via geometry scaling
    return mesh;
  }

  // === HELPER: create cylinder with rounded ends ===
  function makeRoundedCylinder(length, radius, material, scale = 1) {
    const geo = new CylinderGeometry(radius, radius, length, 16, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create cone ===
  function makeCone(height, radius, material, scale = 1) {
    const geo = new ConeGeometry(radius, radius * 0.3, height, 16, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create torus ring ===
  function makeTorusRing(majorRadius, minorRadius, material, scale = 1) {
    const geo = new TorusGeometry(majorRadius, minorRadius, 8, 16);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create sphere ===
  function makeSphere(radius, material, scale = 1) {
    const geo = new SphereGeometry(radius, 16, 12);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create box ===
  function makeBox(length, width, height, material, scale = 1) {
    const geo = new BoxGeometry(length, width, height);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create capsule ===
  function createCapsule(length, radius, material, scale = 1) {
    const geo = new CapsuleGeometry(length, radius, 16, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create lathe ===
  function createLathe(height, outerRadius, innerRadius, points, material, scale = 1) {
    const geo = new LatheGeometry(height, outerRadius, innerRadius, points, 12, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create extrude ===
  function createExtrude(points, topShape, extrudeCount, loops, material, scale = 1) {
    const geo = new ExtrudeGeometry(points, topShape, extrudeCount, loops);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create cone ===
  function createCone(height, topRadius, bottomRadius, material, scale = 1) {
    const geo = new ConeGeometry(bottomRadius, topRadius, height, 16, 8);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create torus ===
  function createTorus(majorRadius, minorRadius, material, scale = 1) {
    const geo = new TorusGeometry(majorRadius, minorRadius, 8, 16);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create sphere ===
  function createSphere(radius, material, scale = 1) {
    const geo = new SphereGeometry(radius, 16, 12);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // === HELPER: create box ===
  function createBox(length, width, height, material, scale = 1) {
    const geo = new BoxGeometry(length, width, height);
    const mesh = new Mesh(geo, material);
    mesh.scale.set(scale, scale, scale);
    return mesh;
  }

  // Scale factor for 747 (real world ~70.7m long, ~27.4m wide)
  const scale = 0.025; // 1 unit = 40 meters
  const baseScale = scale;
  const fuselageScale = scale * 0.95;

  // === FUSELAGE ===
  // Main fuselage body - oval cross section
  const fuselageWidth = 12; // ~300m real (scaled)
  const fuselageDepth = 5;  // ~125m real (scaled)
  const fuselageLength = 32; // ~800m real (scaled)

  // Cross-section points for oval profile
  const crossSectionPoints = [
    { x: -fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
    { x: -fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
  ];

  // Top shape for extrusion - a complex oval profile
  const topPoints = [
    { x: -fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
    { x: -fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
  ];

  const mainFuselage = createExtrude(
    crossSectionPoints,
    topPoints,
    3,
    4,
    liveryWhite,
    fuselageScale
  );
  mainFuselage.position.set(0, 0, 0);
  g.add(mainFuselage);

  // Upper deck hump - additional extrusion above main fuselage
  const humpPoints = [
    { x: -fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
    { x: -fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
  ];

  const humpTopPoints = [
    { x: -fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
    { x: -fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: fuselageDepth / 2, y: 0 },
    { x: fuselageWidth / 2, z: -fuselageDepth / 2, y: 0 },
  ];

  const humpGeometry = createExtrude(
    humpPoints,
    humpTopPoints,
    3,
    4,
    liveryBlue,
    fuselageScale * 0.7
  );
  humpGeometry.position.set(0, fuselageDepth / 2 + 0.3, 0);
  g.add(humpGeometry);

  // Nose cone - lathe geometry
  const noseHeight = 4;
  const noseOuterRadius = fuselageWidth / 2;
  const noseInnerRadius = fuselageDepth / 2;
  const nosePoints = [
    { t: 0, r: noseOuterRadius },
    { t: 0.2, r: noseOuterRadius },
    { t: 0.4, r: noseOuterRadius },
    { t: 0.6, r: noseOuterRadius },
    { t: 0.8, r: noseOuterRadius },
    { t: 1, r: noseInnerRadius },
  ];

  const nose = createLathe(noseHeight, noseOuterRadius, noseInnerRadius, nosePoints, liveryWhite, fuselageScale);
  nose.position.set(fuselageLength / 2, 0, 0);
  g.add(nose);

  // Tail section - narrower extrusion
  const tailWidth = fuselageWidth * 0.7;
  const tailDepth = fuselageDepth * 0.8;
  const tailLength = 6;

  const tailPoints = [
    { x: -tailWidth / 2, z: -tailDepth / 2, y: 0 },
    { x: -tailWidth / 2, z: tailDepth / 2, y: 0 },
    { x: tailWidth / 2, z: tailDepth / 2, y: 0 },
    { x: tailWidth / 2, z: -tailDepth / 2, y: 0 },
  ];

  const tailTopPoints = [
    { x: -tailWidth / 2, z: -tailDepth / 2, y: 0 },
    { x: -tailWidth / 2, z: tailDepth / 2, y: 0 },
    { x: tailWidth / 2, z: tailDepth / 2, y: 0 },
    { x: tailWidth / 2, z: -tailDepth / 2, y: 0 },
  ];

  const tailSection = createExtrude(
    tailPoints,
    tailTopPoints,
    3,
    4,
    liveryWhite,
    fuselageScale
  );
  tailSection.position.set(fuselageLength, 0, 0);
  g.add(tailSection);

  // Tail fin (vertical stabilizer) - lathe geometry
  const finHeight = 8;
  const finWidth = 2;
  const finDepth = 1;
  const finPoints = [
    { t: 0, r: 0 },
    { t: 0.1, r: finWidth / 2 },
    { t: 0.2, r: finWidth },
    { t: 0.3, r: finWidth },
    { t: 0.4, r: finWidth },
    { t: 0.5, r: finWidth },
    { t: 0.6, r: finWidth },
    { t: 0.7, r: finWidth },
    { t: 0.8, r: finWidth },
    { t: 0.9, r: finWidth },
    { t: 1, r: 0 },
  ];

  const verticalFin = createLathe(
    finHeight,
    finWidth,
    finDepth,
    finPoints,
    liveryWhite,
    fuselageScale
  );
  verticalFin.position.set(fuselageLength + 0.5, 0, 0);
  g.add(verticalFin);

  // Horizontal stabilizers
  const hStabLength = 4;
  const hStabDepth = 1;
  const hStabHeight = 0.5;
  const hStabPoints = [
    { x: -hStabLength / 2, z: -hStabDepth / 2, y: 0 },
    { x: -hStabLength / 2, z: hStabDepth / 2, y: 0 },
    { x: hStabLength / 2, z: hStabDepth / 2, y: 0 },
    { x: hStabLength / 2, z: -hStabDepth / 2, y: 0 },
  ];

  const topHStab = createExtrude(
    hStabPoints,
    hStabPoints,
    3,
    4,
    liveryWhite,
    fuselageScale
  );
  topHStab.position.set(fuselageLength + 0.5, finHeight / 2 + 0.2, 0);
  g.add(topHStab);

  const bottomHStab = createExtrude(
    hStabPoints,
    hStabPoints,
    3,
    4,
    liveryWhite,
    fuselageScale
  );
  bottomHStab.position.set(fuselageLength + 0.5, -finHeight / 2 - 0.2, 0);
  g.add(bottomHStab);

  // === WINGS ===
  const wingSweepAngle = -37.5 * (Math.PI / 180); // -37.5 degrees
  const wingDihedralAngle = 2.5 * (Math.PI / 180); // 2.5 degrees dihedral
  const wingSpan = 22; // ~550m real
  const wingChord = 3;
  const wingHeight = 1.5;

  // Main wing - create a swept rectangle with dihedral
  const wingPoints = [
    { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
    { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
    { x: wingSpan / 2, z: wingChord / 2, y: 0 },
    { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
  ];

  const wingTopPoints = [
    { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
    { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
    { x: wingSpan / 2, z: wingChord / 2, y: 0 },
    { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
  ];

  const wingGeometry = createExtrude(
    wingPoints,
    wingTopPoints,
    wingHeight,
    4,
    liveryBlue,
    fuselageScale
  );
  wingGeometry.rotation.z = wingSweepAngle;
  wingGeometry.rotation.x = wingDihedralAngle;
  wingGeometry.position.set(0, wingHeight / 2, 0);
  g.add(wingGeometry);

  // Wing leading edge ridge
  const leadingEdge = createExtrude(
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    wingHeight,
    4,
    liveryBlue,
    fuselageScale * 0.8
  );
  leadingEdge.rotation.z = wingSweepAngle;
  leadingEdge.rotation.x = wingDihedralAngle;
  leadingEdge.position.set(0, wingHeight / 2, 0);
  g.add(leadingEdge);

  // Wing trailing edge
  const trailingEdge = createExtrude(
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    wingHeight,
    4,
    liveryBlue,
    fuselageScale * 0.8
  );
  trailingEdge.rotation.z = wingSweepAngle;
  trailingEdge.rotation.x = wingDihedralAngle;
  trailingEdge.position.set(0, wingHeight / 2, 0);
  g.add(trailingEdge);

  // Wing root (near fuselage)
  const wingRoot = createExtrude(
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    wingHeight,
    4,
    liveryBlue,
    fuselageScale * 0.8
  );
  wingRoot.rotation.z = wingSweepAngle;
  wingRoot.rotation.x = wingDihedralAngle;
  wingRoot.position.set(0, wingHeight / 2, 0);
  g.add(wingRoot);

  // Wing tip - capsule shape
  const wingTip = createCapsule(2, 0.5, liveryBlue, fuselageScale);
  wingTip.position.set(wingSpan / 2, wingHeight / 2, 0);
  wingTip.rotation.z = wingSweepAngle;
  wingTip.rotation.x = wingDihedralAngle;
  g.add(wingTip);

  // Wing root cap
  const wingRootCap = createCapsule(1.5, 0.4, liveryBlue, fuselageScale);
  wingRootCap.position.set(-wingSpan / 2, wingHeight / 2, 0);
  wingRootCap.rotation.z = wingSweepAngle;
  wingRootCap.rotation.x = wingDihedralAngle;
  g.add(wingRootCap);

  // === ENGINES ===
  const engineCount = 4;
  const engineSpacing = wingSpan / 4;
  const engineHeight = 0.8;
  const engineRadius = 0.6;
  const engineNacelleLength = 1.5;

  for (let i = 0; i < engineCount; i++) {
    const engineGroup = new Group();

    // Engine nacelle - capsule shape
    const nacelle = createCapsule(engineNacelleLength, engineRadius * 0.8, liveryEngine, fuselageScale);
    nacelle.rotation.z = wingSweepAngle;
    nacelle.rotation.x = wingDihedralAngle;
    nacelle.position.set(-wingSpan / 2 + engineSpacing * (i + 1), wingHeight / 2 - 0.5, 0);
    engineGroup.add(nacelle);

    // Engine intake (front)
    const intake = createCone(0.3, engineRadius * 0.7, engineRadius, liveryEngine, fuselageScale);
    intake.rotation.z = wingSweepAngle;
    intake.rotation.x = wingDihedralAngle;
    intake.position.set(-wingSpan / 2 + engineSpacing * (i + 1) - 0.15, wingHeight / 2 - 0.5, 0);
    engineGroup.add(intake);

    // Engine exhaust (back)
    const exhaust = createCone(0.3, engineRadius * 0.7, engineRadius, liveryEngine, fuselageScale);
    exhaust.rotation.z = wingSweepAngle;
    exhaust.rotation.x = wingDihedralAngle;
    exhaust.position.set(-wingSpan / 2 + engineSpacing * (i + 1) + 0.15, wingHeight / 2 - 0.5, 0);
    engineGroup.add(exhaust);

    // Nacelle ring
    const ring = createTorus(1, 0.1, liveryEngine, fuselageScale);
    ring.rotation.z = wingSweepAngle;
    ring.rotation.x = wingDihedralAngle;
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-wingSpan / 2 + engineSpacing * (i + 1), wingHeight / 2 - 0.5, 0);
    engineGroup.add(ring);

    g.add(engineGroup);
  }

  // === WING ROOT COVER ===
  const wingRootCover = createExtrude(
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    [
      { x: -wingSpan / 2, z: -wingChord / 2, y: 0 },
      { x: -wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: wingChord / 2, y: 0 },
      { x: wingSpan / 2, z: -wingChord / 2, y: 0 },
    ],
    wingHeight,
    4,
    liveryBlue,
    fuselageScale * 0.8
  );
  wingRootCover.rotation.z = wingSweepAngle;
  wingRootCover.rotation.x = wingDihedralAngle;
  wingRootCover.position.set(0, wingHeight / 2, 0);
  g.add(wingRootCover);

  // === NOSE STRUT ===
  const noseStrutGroup = new Group();

  // Nose strut strut
  const strut = createCylinder(3, 0.15, liveryGear, fuselageScale);
  strut.rotation.x = Math.PI / 2;
  strut.position.set(0, 0.5, 0);
  noseStrutGroup.add(strut);

  // Nose wheel
  const noseWheel = createSphere(0.25, liveryGear, fuselageScale);
  noseWheel.rotation.x = Math.PI / 2;
  noseWheel.position.set(0, 0.5, 0);
  noseStrutGroup.add(noseWheel);

  // Nose wheel rim
  const noseWheelRim = createTorus(0.25, 0.05, liveryGear, fuselageScale);
  noseWheelRim.rotation.x = Math.PI / 2;
  noseWheelRim.rotation.z = Math.PI / 2;
  noseWheelRim.position.set(0, 0.5, 0);
  noseStrutGroup.add(noseWheelRim);

  g.add(noseStrutGroup);

  // === MAIN LANDING GEAR ===
  // Four main gear trucks
  const gearTrucks = [
    { x: -5, z: -1.5 },
    { x: -5, z: 1.5 },
    { x: 5, z: -1.5 },
    { x: 5, z: 1.5 },
  ];

  for (const gear of gearTrucks) {
    const gearGroup = new Group();

    // Gear strut
    const strut = createCylinder(2.5, 0.1, liveryGear, fuselageScale);
    strut.rotation.x = Math.PI / 2;
    strut.position.set(gear.x, 0.25, gear.z);
    gearGroup.add(strut);

    // Gear wheel
    const wheel = createSphere(0.35, liveryGear, fuselageScale);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(gear.x, 0.25, gear.z);
    gearGroup.add(wheel);

    // Wheel rim
    const rim = createTorus(0.35, 0.05, liveryGear, fuselageScale);
    rim.rotation.x = Math.PI / 2;
    rim.rotation.z = Math.PI / 2;
    rim.position.set(gear.x, 0.25, gear.z);
    gearGroup.add(rim);

    // Gear box
    const gearbox = createBox(1.2, 0.8, 0.6, liveryGear, fuselageScale);
    gearbox.position.set(gear.x, 0.25, gear.z);
    gearGroup.add(gearbox);

    g.add(gearGroup);
  }

  // === WINDOW LINES ===
  // Main fuselage windows
  const windowPositions = [
    { x: 2, z: -1.5 },
    { x: 2, z: 1.5 },
    { x: 5, z: -1.5 },
    { x: 5, z: 1.5 },
    { x: 8, z: -1.5 },
    { x: 8, z: 1.5 },
    { x: 11, z: -1.5 },
    { x: 11, z: 1.5 },
    { x: 14, z: -1.5 },
    { x: 14, z: 1.5 },
    { x: 17, z: -1.5 },
    { x: 17, z: 1.5 },
    { x: 20, z: -1.5 },
    { x: 20, z: 1.5 },
    { x: 23, z: -1.5 },
    { x: 23, z: 1.5 },
    { x: 26, z: -1.5 },
    { x: 26, z: 1.5 },
    { x: 29, z: -1.5 },
    { x: 29, z: 1.5 },
    { x: 31, z: -1.5 },
    { x: 31, z: 1.5 },
  ];

  for (const win of windowPositions) {
    const winGroup = new Group();

    // Window
    const win = createBox(0.4, 0.15, 0.6, liveryWindow, fuselageScale);
    win.position.set(win.x, fuselageDepth / 2 + 0.5, 0);
    winGroup.add(win);

    // Window frame
    const frame = createBox(0.5, 0.18, 0.7, liveryRim, fuselageScale);
    frame.position.set(win.x, fuselageDepth / 2 + 0.5, 0);
    winGroup.add(frame);

    g.add(winGroup);
  }

  // Upper deck windows
  const humpWindowPositions = [
    { x: 10, z: -1.2 },
    { x: 10, z: 1.2 },
    { x: 12, z: -1.2 },
    { x: 12, z: 1.2 },
    { x: 14, z: -1.2 },
    { x: 14, z: 1.2 },
    { x: 16, z: -1.2 },
    { x: 16, z: 1.2 },
    { x: 18, z: -1.2 },
    { x: 18, z: 1.2 },
  ];

  for (const win of humpWindowPositions) {
    const winGroup = new Group();

    const win = createBox(0.4, 0.15, 0.6, liveryWindow, fuselageScale);
    win.position.set(win.x, fuselageDepth / 2 + 1.5, 0);
    winGroup.add(win);

    const frame = createBox(0.5, 0.18, 0.7, liveryRim, fuselageScale);
    frame.position.set(win.x, fuselageDepth / 2 + 1.5, 0);
    winGroup.add(frame);

    g.add(winGroup);
  }

  // === DOOR LINES ===
  const doorPositions = [
    { x: 4, z: -1.8 },
    { x: 4, z: 1.8 },
    { x: 18, z: -1.8 },
    { x: 18, z: 1.8 },
  ];

  for (const door of doorPositions) {
    const doorGroup = new Group();

    const doorBox = createBox(0.6, 0.25, 0.8, liveryDoor, fuselageScale);
    doorBox.position.set(door.x, fuselageDepth / 2 + 0.5, 0);
    doorGroup.add(doorBox);

    // Door handle
    const handle = createBox(0.1, 0.05, 0.05, liveryDoor, fuselageScale);
    handle.position.set(door.x, fuselageDepth / 2 + 0.5, 0.4);
    doorGroup.add(handle);

    g.add(doorGroup);
  }

  // === TAIL WINDOW ===
  const tailWinGroup = new Group();
  const tailWin = createBox(0.4, 0.15, 0.6, liveryWindow, fuselageScale);
  tailWin.position.set(fuselageLength + 0.3, fuselageDepth / 2 + 0.5, 0);
  tailWinGroup.add(tailWin);
  tailWinGroup.add(createBox(0.5, 0.18, 0.7, liveryRim, fuselageScale));
  tailWinGroup.add(createBox(0.5, 0.18, 0.7, liveryRim, fuselageScale));
  g.add(tailWinGroup);

  // === FUSELAGE UNDERDECK STRIPS ===
  // Add some underbelly panel lines
  const underBelly = new Group();

  for (let i = 0; i < 5; i++) {
    const strip = createBox(2, 0.05, fuselageDepth + 1, liveryDarkGray, fuselageScale);
    strip.position.set(2 + i * 4, 0, 0);
    underBelly.add(strip);
  }

  g.add(underBelly);

  // === FUSELAGE RIBS ===
  const ribs = new Group();

  for (let i = 0; i < 10; i++) {
    const rib = createBox(0.05, fuselageDepth + 1, fuselageWidth + 1, liveryDarkGray, fuselageScale);
    rib.position.set(2 + i * 4, 0, 0);
    ribs.add(rib);
  }

  g.add(ribs);

  // === TAIL FINE DECORATION ===
  const tailDeco = createBox(0.3, 0.1, 0.5, liveryDarkGray, fuselageScale);
  tailDeco.position.set(fuselageLength + 0.3, fuselageDepth / 2 + 0.5, 0);
  g.add(tailDeco);

  return g;
}