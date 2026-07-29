// Boeing-747 primitives-only candidate — terransoul-gemma track, iter 1.
// Cold start: bare cylinder fuselage, flat box wing, flat box tail — nothing else.
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b4a6e });

  // --- Fuselage (pointed ogive nose + continuous body + upswept tail cone) ---
  const fuselageRadius = 3.1;
  const fuselageLength = 72;
  const fuselageCenter = new THREE.Vector3(0, 0, 0);

  // Nose: smooth pointed cap (half-ellipsoid for rounded tip, no flat end)
  const noseGeo = new THREE.SphereGeometry(fuselageRadius * 1.4, 24, 24);
  const nose = new THREE.Mesh(noseGeo, grey);
  nose.scale.set(0.35, 1.0, 1.0); // Tapered point at the very front (+X)
  nose.position.set(fuselageLength / 2 - 3, fuselageCenter.y, fuselageCenter.z);
  group.add(nose);

  // Main body: cylinder for the long central tube
  const bodyGeo = new THREE.CylinderGeometry(
    fuselageRadius, fuselageRadius, fuselageLength - 6, 24
  );
  const body = new THREE.Mesh(bodyGeo, grey);
  body.rotation.z = -Math.PI / 2; // Align along +X (nose to tail)
  group.add(body);

  // Tail cone: upswept, tapered aft section that merges into a long fin base
  const tailRadiusTop = fuselageRadius * 0.95;
  const tailRadiusBottom = fuselageRadius * 0.65;
  const tailLength = 18;
  const tailConeGeo = new THREE.ConeGeometry(
    tailRadiusTop, tailRadiusBottom, tailLength, 24
  );
  const tailCone = new THREE.Mesh(tailConeGeo, grey);
  tailCone.rotation.z = -Math.PI / 2; // Along +X axis, pointing aft
  // Slight upsweep: rotate slightly upward around Y so the nose of the cone points up
  tailCone.rotation.x = Math.PI / 180 * 6;
  tailCone.position.set(
    fuselageLength / 2 - tailRadiusTop, fuselageCenter.y, fuselageCenter.z
  );
  group.add(tailCone);

  // --- Upper-deck hump (blended into the crown, no step/seam) ---
  const humpGeo = new THREE.SphereGeometry(fuselageRadius * 1.6, 48, 32);
  const hump = new THREE.Mesh(humpGeo, grey);
  // Scale to form a rounded lobe: ~4.5 wide, ~4.2 high, ~5.0 deep
  hump.scale.set(2.25, 2.1, 2.5);
  // Position so it sits atop the fuselage crown, starting at the cockpit region
  hump.position.set(fuselageLength / 2 - 28, fuselageRadius + 2.6, 0);
  group.add(hump);

  // --- Wings (swept-back, dihedral, tapered root-to-tip, with belly fairing) ---
  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, -1.8, 0); // Slightly below fuselage center
  group.add(wingGroup);

  function createWingHalf(side) {
    // Wing root: low-mounted, faired into a belly fairing
    const rootGeo = new THREE.BoxGeometry(36, 0.5, 12);
    const root = new THREE.Mesh(rootGeo, dark);
    root.position.set(side * 4, -3.8, side * 7);
    root.rotation.x = Math.PI / 180 * 7; // Dihedral ~7°
    root.rotation.y = -Math.PI / 180 * 37.5; // Sweep-back ~37.5°
    wingGroup.add(root);

    // Wing tip: further back, outboard, tapering
    const tipGeo = new THREE.BoxGeometry(42, 0.4, 8);
    const tip = new THREE.Mesh(tipGeo, dark);
    tip.position.set(side * -32, -4.6, side * 30);
    tip.rotation.x = Math.PI / 180 * 7; // Same dihedral
    tip.rotation.y = -Math.PI / 180 * 37.5; // Same sweep
    wingGroup.add(tip);

    // Belly fairing at root (smooth transition between fuselage and wing)
    const bellyFairingGeo = new THREE.BoxGeometry(14, 0.6, 16);
    const bellyFairing = new THREE.Mesh(bellyFairingGeo, grey);
    bellyFairing.position.set(side * 2, -1.9, side * 3);
    wingGroup.add(bellyFairing);

    // Four engines per wing (two inboard/outboard), each on a pylon, UNDER and FORWARD of the wing
    const engineConfigs = [
      { xOffset: side * 0, zOffset: side * 6 },   // Inboard
      { xOffset: side * -14, zOffset: side * 24 } // Outboard
    ];

    for (const cfg of engineConfigs) {
      // Nacelle: long, rounded cylinder; inlet face is open/darker
      const nacelleGeo = new THREE.CylinderGeometry(2.0, 1.6, 8.5, 16);
      const nacelle = new THREE.Mesh(nacelleGeo, dark);
      nacelle.rotation.z = Math.PI / 2; // Pointing along fuselage X axis
      nacelle.position.set(cfg.xOffset, -7.5, cfg.zOffset);
      wingGroup.add(nacelle);

      // Pylon: connects engine to wing root (shifted forward on the wing)
      const pylonGeo = new THREE.BoxGeometry(1.0, 1.6, 4);
      const pylon = new THREE.Mesh(pylonGeo, dark);
      pylon.position.set(cfg.xOffset - side * 2, -5.8, cfg.zOffset);
      wingGroup.add(pylon);
    }
  }

  createWingHalf(1);
  createWingHalf(-1);

  // --- Tail: tall swept vertical fin + horizontal stabilizers ---
  const finRadius = fuselageRadius * 0.35;
  const finHeight = fuselageRadius * 4.5;
  const finGeo = new THREE.ConeGeometry(finRadius, finRadius * 0.12, finHeight, 24);
  const verticalFin = new THREE.Mesh(finGeo, dark);
  verticalFin.rotation.z = -Math.PI / 2; // Along +X axis
  verticalFin.position.set(fuselageLength / 2 - finRadius, fuselageCenter.y + finRadius * 1.2, 0);
  verticalFin.rotation.x = Math.PI / 180 * 15; // Upswept to ~15°
  group.add(verticalFin);

  // Horizontal stabilizer: low and swept back
  const horizGeo = new THREE.BoxGeometry(16, 0.4, 2.2);
  const horizontalStab = new THREE.Mesh(horizGeo, dark);
  horizontalStab.rotation.z = -Math.PI / 2; // Along +X axis
  horizontalStab.position.set(fuselageLength / 2 - 14, fuselageCenter.y - 1.5, 0);
  horizontalStab.rotation.x = Math.PI / 180 * (-3); // Slight downwash
  group.add(horizontalStab);

  // --- Landing gear (5-group arrangement: nose strut + 2 wing bogies + 2 body bogies) ---
  const gearGroup = new THREE.Group();
  group.add(gearGroup);

  // Nose gear: twin-wheel arrangement
  const noseStrutGeo = new THREE.CylinderGeometry(0.25, 0.18, 6);
  const noseStrut = new THREE.Mesh(noseStrutGeo, dark);
  noseStrut.position.set(fuselageLength / 2 - 4, fuselageCenter.y - fuselageRadius - 1, 0);
  gearGroup.add(noseStrut);

  const wheelGeo = new THREE.SphereGeometry(0.45);
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(
      fuselageLength / 2 - 4,
      fuselageCenter.y - fuselageRadius - 3.5,
      (i === 0 ? 0.7 : -0.7) * 0.8
    );
    gearGroup.add(w);
  }

  // Four main gear bogies: two under wing root, two outer on body
  const mainGearPositions = [
    { x: fuselageLength / 2 - 38, z: 4 },   // Inboard Left (under wing)
    { x: fuselageLength / 2 - 38, z: -4 },  // Inboard Right (under wing)
    { x: fuselageLength / 2 - 35, z: 9 },   // Outboard Left (on body)
    { x: fuselageLength / 2 - 35, z: -9 }  // Outboard Right (on body)
  ];

  for (const pos of mainGearPositions) {
    const strutGeo = new THREE.CylinderGeometry(0.33, 0.25, 7);
    const strut = new THREE.Mesh(strutGeo, dark);
    strut.position.set(pos.x, fuselageCenter.y - fuselageRadius - 1, pos.z);
    gearGroup.add(strut);

    // Each bogie has 4 wheels (2x2 layout)
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const w = new THREE.Mesh(wheelGeo, dark);
        w.position.set(
          pos.x,
          fuselageCenter.y - fuselageRadius - 4.5,
          pos.z + (i === 0 ? 0.8 : -0.8) + (j === 0 ? 0.4 : -0.4)
        );
        gearGroup.add(w);
      }
    }
  }

  // --- Windows and doors — main deck row with door breaks, upper-deck row on hump ---
  const windowGroup = new THREE.Group();
  group.add(windowGroup);

  // Main-deck windows: single continuous row at mid-fuselage height
  for (let i = 0; i < 50; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(
        new THREE.BoxGeometry(0.71, 0.4, 0.05), dark
      );
      w.position.set(
        fuselageLength / 2 - 28 + i * 1.0,
        fuselageCenter.y + fuselageRadius * 0.35,
        side * (fuselageRadius - 0.5)
      );
      windowGroup.add(w);
    });
  }

  // Upper-deck windows: short row on the hump
  for (let i = 0; i < 12; i++) {
    [1, -1].forEach(side => {
      const wUpper = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.4, 0.1), dark
      );
      wUpper.position.set(
        fuselageLength / 2 - 30 + i * 0.9,
        fuselageCenter.y + fuselageRadius + 3.8,
        side * (fuselageRadius + 0.6)
      );
      windowGroup.add(wUpper);
    });
  }

  // Cockpit windshields: wrap-around, slightly angled
  const cw = (x, y, z, rot) => {
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2.5, 0.1), dark
    );
    w.position.set(x, y, z);
    w.rotation.z = rot;
    return w;
  };

  windowGroup.add(cw(fuselageLength / 2 + 2, fuselageCenter.y + fuselageRadius + 1.5, fuselageRadius - 0.5, Math.PI / 180 * 10));
  windowGroup.add(cw(fuselageLength / 2 + 2, fuselageCenter.y + fuselageRadius + 1.5, -(fuselageRadius - 0.5), -Math.PI / 180 * 10));
  windowGroup.add(cw(
    fuselageLength / 2 + 3, fuselageCenter.y + fuselageRadius + 2.3, fuselageRadius + 0.5, Math.PI / 180 * 30
  ));
  windowGroup.add(cw(
    fuselageLength / 2 + 3, fuselageCenter.y + fuselageRadius + 2.3, -(fuselageRadius + 0.5), -Math.PI / 180 * 30
  ));

  // Doors: clearly defined entry points interrupting the window rhythm
  const doorX = [fuselageLength / 2 - 26, fuselageLength / 2 - 5];
  doorX.forEach(x => {
    [1, -1].forEach(side => {
      const d = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 2.0, 0.3), dark
      );
      d.position.set(x, fuselageCenter.y + fuselageRadius * 0.6, side * (fuselageRadius - 0.5));
      group.add(d);
    });
  });

  return group;
}