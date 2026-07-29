export function buildPlane(THREE) {
  const { Mesh, MeshStandardMaterial, Vector3, Quaternion, Color, Group, Geometry, Position } = THREE;

  const plane = new Group();

  // Livery colors
  const colors = {
    fuselage: new Color(0x223344),
    fuselageLight: new Color(0x667788),
    fuselageDark: new Color(0x112233),
    engine: new Color(0x334455),
    gear: new Color(0x445566),
    window: new Color(0x8899aa),
    door: new Color(0x223344),
    verticalStab: new Color(0x556677),
    horizontalStab: new Color(0x556677),
    landingGear: new Color(0x667788)
  };

  // Create materials
  const createMaterial = (color) => new MeshStandardMaterial({ color, roughness: 0.8 });

  // Fuselage with hump using ExtrudeGeometry
  const fuselagePath = [
    new Vector3(-10, 0), new Vector3(-10, 2),
    new Vector3(-8, 2), new Vector3(-8, 8),
    new Vector3(-6, 8), new Vector3(-6, 10),
    new Vector3(-4, 10), new Vector3(-4, 10),
    new Vector3(-2, 10), new Vector3(-2, 10),
    new Vector3(0, 10), new Vector3(2, 10),
    new Vector3(4, 10), new Vector3(6, 10),
    new Vector3(8, 10), new Vector3(10, 10),
    new Vector3(10, 8), new Vector3(10, 2),
    new Vector3(10, 0), new Vector3(-10, 0)
  ];

  const fuselageGeo = new Geometry.ExtrudeGeometry(fuselagePath, 37, 32);
  const fuselageMesh = new Mesh(fuselageGeo, createMaterial(colors.fuselage));
  fuselageMesh.rotation.y = -Math.PI / 2; // Align with +X axis
  plane.add(fuselageMesh);

  // Upper deck windows
  const windowGeo = new Geometry.BoxGeometry(0.6, 0.6, 0.6);
  for (let i = -3; i <= 3; i += 2) {
    for (let j = -1; j <= 1; j += 2) {
      const win = new Mesh(windowGeo, createMaterial(colors.window));
      win.position.set(-3 + i * 3, 8.5, j * 3);
      win.rotation.y = -Math.PI / 2; // Face outward
      plane.add(win);
    }
  }

  // Door lines
  const doorGeo = new Geometry.BoxGeometry(1, 0.2, 0.2);
  const doorMesh = new Mesh(doorGeo, createMaterial(colors.door));
  doorMesh.position.set(-15, 5, 0);
  doorMesh.rotation.y = -Math.PI / 2;
  plane.add(doorMesh);

  // Wing roots
  const wingRootGeo = new Geometry.CapsuleGeometry(4, 20);
  const wingRootMaterial = createMaterial(colors.fuselage);

  // Left wing root
  const wingRootLeft = new Mesh(wingRootGeo, wingRootMaterial);
  wingRootLeft.rotation.z = Math.PI / 180 * 37.5; // 37.5 degree sweep
  wingRootLeft.rotation.x = Math.PI / 180 * 15; // 15 degree dihedral
  wingRootLeft.position.set(-15, -5, 0);
  plane.add(wingRootLeft);

  // Right wing root
  const wingRootRight = new Mesh(wingRootGeo, wingRootMaterial);
  wingRootRight.rotation.z = -Math.PI / 180 * 37.5; // 37.5 degree sweep
  wingRootRight.rotation.x = Math.PI / 180 * 15; // 15 degree dihedral
  wingRootRight.position.set(-15, -5, 0);
  plane.add(wingRootRight);

  // Wing surfaces (simplified)
  const wingSurfaceGeo = new Geometry.CapsuleGeometry(3, 15);
  const wingSurfaceMaterial = createMaterial(colors.fuselage);

  const wingSurfaceLeft = new Mesh(wingSurfaceGeo, wingSurfaceMaterial);
  wingSurfaceLeft.rotation.z = Math.PI / 180 * 37.5;
  wingSurfaceLeft.rotation.x = Math.PI / 180 * 15;
  wingSurfaceLeft.position.set(-12, -4, 0);
  plane.add(wingSurfaceLeft);

  const wingSurfaceRight = new Mesh(wingSurfaceGeo, wingSurfaceMaterial);
  wingSurfaceRight.rotation.z = -Math.PI / 180 * 37.5;
  wingSurfaceRight.rotation.x = Math.PI / 180 * 15;
  wingSurfaceRight.position.set(-12, -4, 0);
  plane.add(wingSurfaceRight);

  // Engines
  const engineGeo = new Geometry.CapsuleGeometry(3, 8);
  const engineMaterial = createMaterial(colors.engine);

  const enginePositions = [
    { x: -18, z: -5 },
    { x: -18, z: 5 },
    { x: -28, z: -5 },
    { x: -28, z: 5 }
  ];

  enginePositions.forEach(pos => {
    const engine = new Mesh(engineGeo, engineMaterial);
    engine.position.set(pos.x, -7, pos.z);
    plane.add(engine);
  });

  // Tail section
  const vertStabGeo = new Geometry.CapsuleGeometry(2, 14);
  const vertStabMaterial = createMaterial(colors.verticalStab);
  const vertStab = new Mesh(vertStabGeo, vertStabMaterial);
  vertStab.position.set(22, 6, 0);
  plane.add(vertStab);

  const horizStabGeo = new Geometry.CapsuleGeometry(3, 5);
  const horizStabMaterial = createMaterial(colors.horizontalStab);
  const horizStab = new Mesh(horizStabGeo, horizStabMaterial);
  horizStab.position.set(22, 14, -5);
  horizStab.rotation.z = -Math.PI / 180 * 30;
  plane.add(horizStab);

  // Landing gear
  const gearMaterial = createMaterial(colors.landingGear);

  // Nose strut
  const noseStrutGeo = new Geometry.CylinderGeometry(0.5, 0.5, 9, 16);
  const noseStrut = new Mesh(noseStrutGeo, gearMaterial);
  noseStrut.position.set(-1, 0, 0);
  plane.add(noseStrut);

  // Nose wheels
  const noseWheelGeo = new Geometry.CapsuleGeometry(1.2, 1);
  const noseWheel1 = new Mesh(noseWheelGeo, gearMaterial);
  const noseWheel2 = new Mesh(noseWheelGeo, gearMaterial);
  noseWheel1.position.set(-1, -1, -1);
  noseWheel2.position.set(-1, -1, 1);
  plane.add(noseWheel1, noseWheel2);

  // Main gear
  const mainGearGeo = new Geometry.CylinderGeometry(1.5, 1.5, 3, 16);
  const mainGear = new Mesh(mainGearGeo, gearMaterial);
  mainGear.position.set(0, -9, 0);
  plane.add(mainGear);

  // Main gear wheels
  const mainWheelGeo = new Geometry.CapsuleGeometry(1.2, 1);
  const mainWheel1 = new Mesh(mainWheelGeo, gearMaterial);
  const mainWheel2 = new Mesh(mainWheelGeo, gearMaterial);
  const mainWheel3 = new Mesh(mainWheelGeo, gearMaterial);
  const mainWheel4 = new Mesh(mainWheelGeo, gearMaterial);
  mainWheel1.position.set(-3, -9, -3);
  mainWheel2.position.set(-3, -9, 3);
  mainWheel3.position.set(3, -9, -3);
  mainWheel4.position.set(3, -9, 3);
  plane.add(mainWheel1, mainWheel2, mainWheel3, mainWheel4);

  // Add subtle fuselage shading lines using thin boxes
  const shadingGeo = new Geometry.BoxGeometry(0.1, 1, 0.1);
  const shadingMaterial = createMaterial(colors.fuselageDark);

  for (let i = -10; i <= 10; i += 5) {
    const shade = new Mesh(shadingGeo, shadingMaterial);
    shade.position.set(-10 + i * 2, 5, 0);
    shade.rotation.y = -Math.PI / 2;
    plane.add(shade);
  }

  return plane;
}