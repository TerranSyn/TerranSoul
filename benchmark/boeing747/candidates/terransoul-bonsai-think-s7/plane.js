export function buildPlane(THREE) {
  const group = new THREE.Group();
  const color = THREE.Color(0x888888);
  const mat = new THREE.MeshBasicMaterial({ color: color });

  // 1. FUSELAGE: Cylinder along Z (nose at +Z, tail at -Z)
  const fuselageGeo = new THREE.CylinderGeometry(3, 3, 64, 32);
  const fuselage = new THREE.Mesh(fuselageGeo, mat);
  fuselage.position.set(0, 0, 0);
  group.add(fuselage);

  // Rounded nose at +Z end
  const noseGeo = new THREE.SphereGeometry(3, 16, 16);
  const nose = new THREE.Mesh(noseGeo, mat);
  nose.position.set(0, 0, 32);
  group.add(nose);

  // 2. UPPER-DECK HUMP: small raised deck in forward third
  const humpGeo = new THREE.BoxGeometry(6, 2, 14);
  const hump = new THREE.Mesh(humpGeo, mat);
  hump.position.set(0, 4, 23);
  group.add(hump);

  // 3. WINGS: two long thin wings, attached at mid-height near center
  const wingGeo = new THREE.BoxGeometry(30, 0.5, 0.5);

  // Right wing: root at X=0 (overlaps fuselage), tip at X=30, Z=-22, dihedral ~3
  const rightWing = new THREE.Mesh(wingGeo, mat);
  rightWing.position.set(15, 1.5, -11);
  rightWing.rotation.z = 0.1; // ~5.74° dihedral
  group.add(rightWing);

  // Left wing: root at X=0, tip at X=-30, Z=-22, dihedral ~3
  const leftWing = new THREE.Mesh(wingGeo, mat);
  leftWing.position.set(-15, 1.5, -11);
  leftWing.rotation.z = -0.1; // ~-5.74° dihedral
  group.add(leftWing);

  // 4. ENGINES: four nacelles under each wing
  const engineGeo = new THREE.CylinderGeometry(1.3, 1.3, 6, 16);

  const enginePositions = [
    { x: 15, y: -2, z: 1 },  // inboard right
    { x: 25, y: -2, z: 1 },  // outboard right
    { x: -15, y: -2, z: 1 }, // inboard left
    { x: -25, y: -2, z: 1 }, // outboard left
  ];
  enginePositions.forEach(pos => {
    const engine = new THREE.Mesh(engineGeo, mat);
    engine.position.set(pos.x, pos.y, pos.z);
    group.add(engine);
  });

  // Short pylons connecting wing to engines
  const pylonGeo = new THREE.BoxGeometry(0.5, 2, 0.5);
  enginePositions.forEach(pos => {
    const pylon = new THREE.Mesh(pylonGeo, mat);
    pylon.position.set(pos.x, pos.y + 1, pos.z);
    group.add(pylon);
  });

  // 5. TAIL: vertical fin + horizontal stabilizers at -Z end
  // Tall vertical fin on rear fuselage
  const finGeo = new THREE.BoxGeometry(2, 11, 2);
  const fin = new THREE.Mesh(finGeo, mat);
  fin.position.set(0, 8, -32);
  group.add(fin);

  // Mini-wings extending ±X at tail, at fuselage height
  const stabGeo = new THREE.BoxGeometry(10, 0.5, 0.5);
  const leftStab = new THREE.Mesh(stabGeo, mat);
  leftStab.position.set(-5, 0, -32);
  group.add(leftStab);
  const rightStab = new THREE.Mesh(stabGeo, mat);
  rightStab.position.set(5, 0, -32);
  group.add(rightStab);

  // 6. LANDING GEAR: short cylinders pointing down
  const gearGeo = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);

  // Under nose
  const noseGear = new THREE.Mesh(gearGeo, mat);
  noseGear.position.set(0, -1, 32);
  group.add(noseGear);

  // Under each wing root
  const rightGear = new THREE.Mesh(gearGeo, mat);
  rightGear.position.set(15, -1, 0);
  group.add(rightGear);

  const leftGear = new THREE.Mesh(gearGeo, mat);
  leftGear.position.set(-15, -1, 0);
  group.add(leftGear);

  return group;
}