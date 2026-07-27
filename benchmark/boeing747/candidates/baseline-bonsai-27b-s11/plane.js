export function buildPlane(THREE) {
  const { Mesh, MeshStandardMaterial, Vector3 } = THREE;

  function createGroup() {
    const group = new THREE.Group();

    // === COLORS ===
    const white = new THREE.Color(0xf5f5f5);
    const blue = new THREE.Color(0x002096);
    const red = new THREE.Color(0xDC143C);
    const gray = new THREE.Color(0x888888);
    const silver = new THREE.Color(0xc8c8c8);
    const black = new THREE.Color(0x111111);
    const orange = new THREE.Color(0xff8c00);
    const lightGray = new THREE.Color(0xe8e8e8);
    const darkGray = new THREE.Color(0x555555);

    // === FUSELAGE ===
    // Main fuselage (slender, ~70m proportioned)
    const fuselageGeo = new THREE.CapsuleGeometry(0.75, 14, 28);
    const fuselageMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    group.add(fuselage);

    // Iconic partial-length upper-deck hump
    const humpGeo = new THREE.CapsuleGeometry(1.1, 0.35, 5);
    const humpMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
    const hump = new THREE.Mesh(humpGeo, humpMat);
    hump.position.set(0, 0.75, -1.5);
    group.add(hump);

    // Upper deck windows
    for (let i = -1; i <= 1; i++) {
      const winGeo = new THREE.BoxGeometry(0.04, 0.1, 0.06);
      const winMat = new THREE.MeshStandardMaterial({ color: lightGray, roughness: 0.5 });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(0, 0.95, -1.5 + i * 0.45);
      group.add(win);
    }

    // Lower deck windows
    for (let i = -1; i <= 1; i++) {
      const winGeo = new THREE.BoxGeometry(0.04, 0.1, 0.06);
      const winMat = new THREE.MeshStandardMaterial({ color: lightGray, roughness: 0.5 });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(0, -0.05, -1.5 + i * 0.45);
      group.add(win);
    }

    // Additional windows along the main fuselage
    for (let i = -4; i <= 4; i++) {
      const winGeo = new THREE.BoxGeometry(0.04, 0.1, 0.06);
      const winMat = new THREE.MeshStandardMaterial({ color: lightGray, roughness: 0.5 });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(0, 0.25, -4 + i * 0.8);
      group.add(win);
    }

    // Door lines
    const doorGeo = new THREE.BoxGeometry(0.35, 0.02, 0.12);
    const doorMat = new THREE.MeshStandardMaterial({ color: black, roughness: 0.6 });
    const door1 = new THREE.Mesh(doorGeo, doorMat);
    door1.position.set(-3, 0, 0);
    group.add(door1);
    const door2 = new THREE.Mesh(doorGeo, doorMat);
    door2.position.set(0.5, 0, 0);
    group.add(door2);

    // === WINGS ===
    const wingAngle = 0.4; // dihedral
    const sweepAngle = 0.63; // sweep (~36 degrees)

    function createWing() {
      const wingGroup = new THREE.Group();
      // Main wing body
      const wingGeo = new THREE.BoxGeometry(0.45, 0.07, 11);
      const wingMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wingGroup.add(wing);

      // Wingtip
      const tipGeo = new THREE.BoxGeometry(0.06, 0.04, 2);
      const tip = new THREE.Mesh(tipGeo, wingMat);
      tip.position.set(0, 0.04, 5.5);
      wingGroup.add(tip);

      // Winglet
      const wingletGeo = new THREE.BoxGeometry(0.08, 0.05, 2.5);
      const winglet = new THREE.Mesh(wingletGeo, wingMat);
      winglet.position.set(0, 0.06, 6);
      wingGroup.add(winglet);

      // Wing windows
      for (let i = -1; i <= 1; i++) {
        const winGeo = new THREE.BoxGeometry(0.04, 0.1, 0.05);
        const winMat = new THREE.MeshStandardMaterial({ color: lightGray, roughness: 0.5 });
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set(0, 0.06, i * 3);
        wingGroup.add(win);
      }

      // Engine mount on wing
      const mountGeo = new THREE.BoxGeometry(0.1, 0.04, 0.1);
      const mountMat = new THREE.MeshStandardMaterial({ color: gray, roughness: 0.5 });
      const mount = new THREE.Mesh(mountGeo, mountMat);
      mount.position.set(0, -0.04, 2.5);
      wingGroup.add(mount);

      return wingGroup;
    }

    // Right wing
    const rightWing = createWing();
    rightWing.rotateY(sweepAngle);
    rightWing.rotateX(wingAngle);
    rightWing.position.set(0, 0.55, 2.5);
    group.add(rightWing);

    // Left wing
    const leftWing = createWing();
    leftWing.rotateY(-sweepAngle);
    leftWing.rotateX(wingAngle);
    leftWing.position.set(0, 0.55, -2.5);
    group.add(leftWing);

    // === ENGINES ===
    function createEngine() {
      const engineGroup = new THREE.Group();
      // Nacelle
      const nacelleGeo = new THREE.CapsuleGeometry(0.22, 0.2, 2.2);
      const nacelleMat = new THREE.MeshStandardMaterial({ color: gray, roughness: 0.4 });
      const nacelle = new THREE.Mesh(nacelleGeo, nacelleMat);
      engineGroup.add(nacelle);

      // Engine intake
      const intakeGeo = new THREE.ConeGeometry(0.12, 0.18, 0.8);
      const intakeMat = new THREE.MeshStandardMaterial({ color: gray, roughness: 0.6 });
      const intake = new THREE.Mesh(intakeGeo, intakeMat);
      intake.rotation.x = Math.PI / 2;
      intake.rotation.z = -Math.PI / 2;
      intake.position.set(0, -0.15, -0.5);
      engineGroup.add(intake);

      // Engine exhaust
      const exhaustGeo = new THREE.ConeGeometry(0.1, 0.15, 0.6);
      const exhaustMat = new THREE.MeshStandardMaterial({ color: gray, roughness: 0.6 });
      const exhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.rotation.z = -Math.PI / 2;
      exhaust.position.set(0, -0.15, 0.8);
      engineGroup.add(exhaust);

      // Engine mount bolts
      for (let i = 0; i < 4; i++) {
        const boltGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.05, 8);
        const boltMat = new THREE.MeshStandardMaterial({ color: silver, roughness: 0.3 });
        const bolt = new THREE.Mesh(boltGeo, boltMat);
        const angle = (i / 4) * Math.PI * 2;
        bolt.rotation.y = angle;
        bolt.position.set(0, -0.2, 0);
        engineGroup.add(bolt);
      }

      return engineGroup;
    }

    // Forward right engine
    const fwdRightEngine = createEngine();
    fwdRightEngine.position.set(0, -0.5, 3);
    group.add(fwdRightEngine);

    // Forward left engine
    const fwdLeftEngine = createEngine();
    fwdLeftEngine.position.set(0, -0.5, -3);
    group.add(fwdLeftEngine);

    // Aft right engine
    const aftRightEngine = createEngine();
    aftRightEngine.position.set(0, -0.5, 0.5);
    group.add(aftRightEngine);

    // Aft left engine
    const aftLeftEngine = createEngine();
    aftLeftEngine.position.set(0, -0.5, -0.5);
    group.add(aftLeftEngine);

    // === TAIL ===
    // Vertical stabilizer
    const vertStabGeo = new THREE.BoxGeometry(0.35, 2.2, 0.6);
    const vertStabMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
    const vertStab = new THREE.Mesh(vertStabGeo, vertStabMat);
    vertStab.position.set(-15, 1.1, 0);
    group.add(vertStab);

    // Upper vertical stabilizer
    const upperVertStabGeo = new THREE.BoxGeometry(0.25, 1.3, 0.5);
    const upperVertStab = new THREE.Mesh(upperVertStabGeo, vertStabMat);
    upperVertStab.position.set(-15, 2.4, 0);
    group.add(upperVertStab);

    // Horizontal stabilizers
    const hStabGeo = new THREE.BoxGeometry(0.9, 0.2, 0.6);
    const hStabMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
    const hStab1 = new THREE.Mesh(hStabGeo, hStabMat);
    hStab1.position.set(-15, 0.8, 0.3);
    group.add(hStab1);
    const hStab2 = new THREE.Mesh(hStabGeo, hStabMat);
    hStab2.position.set(-15, 0.8, -0.3);
    group.add(hStab2);

    // Lower horizontal stabilizer
    const lowerHStab = new THREE.Mesh(hStabGeo, hStabMat);
    lowerHStab.position.set(-15, 0.8, 0);
    group.add(lowerHStab);

    // Red tail accent
    const tailAccentGeo = new THREE.BoxGeometry(0.2, 0.3, 0.6);
    const tailAccentMat = new THREE.MeshStandardMaterial({ color: red, roughness: 0.3 });
    const tailAccent = new THREE.Mesh(tailAccentGeo, tailAccentMat);
    tailAccent.position.set(-15, 0.7, 0);
    group.add(tailAccent);

    // === LANDING GEAR ===
    // Nose strut
    const noseStrutGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.85, 16);
    const strutMat = new THREE.MeshStandardMaterial({ color: silver, roughness: 0.4 });
    const noseStrut = new THREE.Mesh(noseStrutGeo, strutMat);
    noseStrut.position.set(0, -0.45, 5);
    group.add(noseStrut);

    // Nose wheels
    const noseWheelGeo = new THREE.SphereGeometry(0.06, 12, 12);
    const noseWheelMat = new THREE.MeshStandardMaterial({ color: black, roughness: 0.6 });
    const noseWheel1 = new THREE.Mesh(noseWheelGeo, noseWheelMat);
    noseWheel1.position.set(-0.08, -0.45, 5);
    group.add(noseWheel1);
    const noseWheel2 = new THREE.Mesh(noseWheelGeo, noseWheelMat);
    noseWheel2.position.set(0.08, -0.45, 5);
    group.add(noseWheel2);

    // Nose wheel brakes
    const noseBrakeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.15, 16);
    const brakeMat = new THREE.MeshStandardMaterial({ color: orange, roughness: 0.4 });
    const noseBrake1 = new THREE.Mesh(noseBrakeGeo, brakeMat);
    noseBrake1.position.set(-0.08, -0.45, 5);
    group.add(noseBrake1);
    const noseBrake2 = new THREE.Mesh(noseBrakeGeo, brakeMat);
    noseBrake2.position.set(0.08, -0.45, 5);
    group.add(noseBrake2);

    // Main gear trucks (four trucks)
    function createMainGearTruck() {
      const truckGroup = new THREE.Group();
      const truckGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 16);
      const truckMat = new THREE.MeshStandardMaterial({ color: silver, roughness: 0.4 });
      const truck = new THREE.Mesh(truckGeo, truckMat);
      truckGroup.add(truck);

      // Wheel
      const wheelGeo = new THREE.SphereGeometry(0.08, 12, 12);
      const wheelMat = new THREE.MeshStandardMaterial({ color: black, roughness: 0.6 });
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(0, 0.08, 0);
      truckGroup.add(wheel);

      // Brake
      const brakeGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16);
      const brakeMat = new THREE.MeshStandardMaterial({ color: orange, roughness: 0.4 });
      const brake = new THREE.Mesh(brakeGeo, brakeMat);
      brake.position.set(0, 0.1, 0);
      truckGroup.add(brake);

      return truckGroup;
    }

    const mainGear1 = createMainGearTruck();
    mainGear1.position.set(0, -0.45, -8);
    group.add(mainGear1);

    const mainGear2 = createMainGearTruck();
    mainGear2.position.set(0, -0.45, 8);
    group.add(mainGear2);

    const mainGear3 = createMainGearTruck();
    mainGear3.position.set(0, -0.45, -16);
    group.add(mainGear3);

    const mainGear4 = createMainGearTruck();
    mainGear4.position.set(0, -0.45, 16);
    group.add(mainGear4);

    // === FUSELAGE DETAILS ===
    // Livery stripes
    const stripeGeo = new THREE.BoxGeometry(0.01, 0.02, 14);
    const stripeMat = new THREE.MeshStandardMaterial({ color: blue, roughness: 0.3 });
    const stripe1 = new THREE.Mesh(stripeGeo, stripeMat);
    stripe1.position.set(0, 0.25, 0);
    group.add(stripe1);

    const stripe2 = new THREE.Mesh(stripeGeo, stripeMat);
    stripe2.position.set(0, 1.0, -1);
    group.add(stripe2);

    const stripe3 = new THREE.Mesh(stripeGeo, stripeMat);
    stripe3.position.set(0, 0.75, -14);
    stripe3.material.color.set(red);
    group.add(stripe3);

    // Engine mount lines on fuselage
    const mountLineGeo = new THREE.BoxGeometry(0.02, 0.01, 0.15);
    const mountLineMat = new THREE.MeshStandardMaterial({ color: gray, roughness: 0.5 });
    const mountLine1 = new THREE.Mesh(mountLineGeo, mountLineMat);
    mountLine1.position.set(0, 0.2, 3);
    group.add(mountLine1);
    const mountLine2 = new THREE.Mesh(mountLineGeo, mountLineMat);
    mountLine2.position.set(0, 0.2, -3);
    group.add(mountLine2);

    // Wingtip ailerons
    function createAileron() {
      const aileronGroup = new THREE.Group();
      const aileronGeo = new THREE.BoxGeometry(0.08, 0.04, 2);
      const aileronMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
      const aileron = new THREE.Mesh(aileronGeo, aileronMat);
      aileronGroup.add(aileron);
      return aileronGroup;
    }

    const rightAileron = createAileron();
    rightAileron.rotateY(-sweepAngle);
    rightAileron.rotateX(wingAngle);
    rightAileron.position.set(0, 0.04, 6);
    group.add(rightAileron);

    const leftAileron = createAileron();
    leftAileron.rotateY(sweepAngle);
    leftAileron.rotateX(wingAngle);
    leftAileron.position.set(0, 0.04, -6);
    group.add(leftAileron);

    // Wingtip flaps
    function createFlap() {
      const flapGroup = new THREE.Group();
      const flapGeo = new THREE.BoxGeometry(0.1, 0.06, 1.5);
      const flapMat = new THREE.MeshStandardMaterial({ color: white, roughness: 0.25 });
      const flap = new THREE.Mesh(flapGeo, flapMat);
      flapGroup.add(flap);
      return flapGroup;
    }

    const rightFlap = createFlap();
    rightFlap.rotateY(-sweepAngle);
    rightFlap.rotateX(wingAngle);
    rightFlap.position.set(0, 0.04, 6);
    group.add(rightFlap);

    const leftFlap = createFlap();
    leftFlap.rotateY(sweepAngle);
    leftFlap.rotateX(wingAngle);
    leftFlap.position.set(0, 0.04, -6);
    group.add(leftFlap);

    return group;
  }

  return createGroup();
}