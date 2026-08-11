// Boeing-747 primitives-only candidate — terransoul-gemma track, iter 0 (cold start).
// New track: actor AND judge both gemma4:12b-it-qat over local Ollama (zero Anthropic
// API calls — see crates/brain/src/openai_agentic.rs and the --secondary-judge none
// flag on loop-runner-terransoul.mjs). Deliberately NOT seeded from any Claude-actor
// lineage (terransoul-fable5/terransoul-opus48*): those tracks' accumulated geometry
// was built by a different, paid actor, and inheriting it would conflate this track's
// score with that actor's capability rather than measuring gemma's own. Cold start
// mirrors the minimal frozen-contract primitives every other track's genesis used —
// a bare cylinder fuselage, a flat box wing, a flat box tail — nothing else.
export function buildPlane(THREE) {
  const group = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b4a6e });

  // Fuselage: single cylinder along +X (nose = +X per the frozen contract).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 24), grey);
  fuselage.rotation.z = -Math.PI / 2;
  group.add(fuselage);

  // Hump: iconic partial-length upper deck blended into the fuselage crown.
  const hump = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 3.2, 22), grey);
  hump.rotation.z = -Math.PI / 2;
  // Positioned to span from roughly x=-5 to x=15 (front third + cockpit area).
  // Center Y is set so that the smaller back radius blends with the fuselage crown at y=3.
  hump.position.set(5, 3.5, 0);
  group.add(hump);

  // Wings: Swept-back configuration with four pylon-mounted engines and dihedral.
  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, -1.5, 0); // Positioned slightly below fuselage center
  group.add(wingGroup);

  const createWingHalf = (side) => {
    // Root part of the wing: positioned to sweep BACK towards tail (-X)
    const rootGeo = new THREE.BoxGeometry(32, 0.6, 10);
    const root = new THREE.Mesh(rootGeo, dark);
    // For side=1 (Right), x decreases as z increases.
    // Root at forward-ish fuselage (x=8 with side=1 -> x=-8 with side=-1)
    // Actually let's just make them symmetric around X=0 or something if possible
    root.position.set(side * 5, -3.5, side * 8);
    root.rotation.x = Math.PI / 180 * 4; // Dihedral
    // Sweep back angle
    const sweepAngle = (side === 1) ? -Math.PI / 180 * 32 : Math.PI / 180 * 32;
    root.rotation.y = sweepAngle;
    wingGroup.add(root);

    // Tip part of the wing: further back and out
    const tipGeo = new THREE.BoxGeometry(35, 0.4, 7);
    const tip = new THREE.Mesh(tipGeo, dark);
    // x is much more negative for side=1 (towards tail)
    tip.position.set(side * -25, -4.5, side * 28);
    tip.rotation.x = Math.PI / 180 * 4; // Dihedral
    tip.rotation.y = sweepAngle;
    wingGroup.add(tip);

    // Engines: four per wing, two inboard/outboard
    const engineGeo = new THREE.CylinderGeometry(2.0, 1.6, 7, 8);
    const pylonGeo = new THREE.BoxGeometry(0.9, 1.4, 3.5);

    // Spacing for inboard and outboard engines along the wing
    const engineConfigs = [
      { xOffset: side * 2, zOffset: side * 8 },   // Inboard - closer to root
      { xOffset: side * -10, zOffset: side * 22 } // Outboard - further out/back
    ];

    engineConfigs.forEach(config => {
      // Position calculation relative to wingGroup (which is at roughly fuselage center)
      // We want them under the wings.
      const x = config.xOffset;
      const z = config.zOffset;

      // Engine nacelle
      const engine = new THREE.Mesh(engineGeo, dark);
      engine.rotation.z = Math.PI / 2; // Align with fuselage X axis
      engine.position.set(x, -6, z);
      wingGroup.add(engine);

      // Pylon connecting engine to wing (shifted slightly forward on the wing)
      const pylon = new THREE.Mesh(pylonGeo, dark);
      pylon.position.set(x + side * 2, -4.8, z); // Forward of the engine center
      wingGroup.add(pylon);
    });
  };

  createWingHalf(1);

  createWingHalf(-1);

  // Tail: a small vertical box with an accent color for livery coherence.
  const tail = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 0.6), new THREE.MeshStandardMaterial({ color: 0x1d4ed8 }));
  tail.position.set(-27, 7, 0);
  group.add(tail);

  // Landing gear (nose strut + 4 trucks under wing/body)
  const gearGroup = new THREE.Group();
  group.add(gearGroup);

  // Nose Gear: twin-wheel arrangement typical for large aircraft
  const noseStrutGeo = new THREE.CylinderGeometry(0.25, 0.18, 6);
  const noseStrut = new THREE.Mesh(noseStrutGeo, dark);
  noseStrut.position.set(20, -6, 0); // Strut center below fuselage bottom (-3)
  gearGroup.add(noseStrut);

  const wheelGeo = new THREE.SphereGeometry(0.45);
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(20, -9.5, i === 0 ? 0.7 : -0.7);
    gearGroup.add(w);
  }

  // Four Main Gear Bogies (two under body/wing root, two outer)
  const mainStrutGeo = new THREE.CylinderGeometry(0.33, 0.25, 7);
  const mainGearPositions = [
    { x: -14, z: 4 },   // Inboard Left
    { x: -14, z: -4 },  // Inboard Right
    { x: -11, z: 9 },   // Outboard Left
    { x: -11, z: -9 }   // Outboard Right
  ];

  mainGearPositions.forEach(pos => {
    const strut = new THREE.Mesh(mainStrutGeo, dark);
    strut.position.set(pos.x, -8, pos.z); 
    gearGroup.add(strut);

    // Each truck/bogie has 4 wheels (standard 2x2 layout)
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const w = new THREE.Mesh(wheelGeo, dark);
        w.position.set(pos.x, -12, pos.z + (i === 0 ? 0.8 : -0.8) + (j === 0 ? 0.4 : -0.4));
        gearGroup.add(w);
      }
    }
  });

  // Window and Door Lines - Rebalanced for realism
  const windowGroup = new THREE.Group();

  // Main deck: centered row along both sides
  // Fuselage radius 3, so at z=2.8 then y = sqrt(3^2 - 2.8^2) = sqrt(9 - 7.84) = sqrt(1.16) approx 1.07
  for (let i = 0; i < 50; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.1), dark);
      w.position.set(-24 + i * 1.0, 1.1, side * 2.8);
      windowGroup.add(w);
    });
  }

  // Upper-deck windows: on the hump surface (r~4 at front)
  // The hump is between x=-6 and x=16. Place them closer to the front of it.
  for (let i = 0; i < 15; i++) {
    [1, -1].forEach(side => {
      const wUpper = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.1), dark);
      wUpper.position.set(3 + i * 0.9, 6.0, side * 2.1); // Elevated and forward-ish on the hump
      windowGroup.add(wUpper);
    });
  }

  // Cockpit: wrap-around windshields - use thinner, more precise boxes
  const cw = (x, y, z, rot) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 0.1), dark);
    w.position.set(x, y, z);
    w.rotation.z = rot;
    return w;
  };
  // Front-facing windshields (slightly angled)
  windowGroup.add(cw(28.5, 2.0, 2.6, Math.PI / 180 * 10)); // Right side top profile
  windowGroup.add(cw(28.5, 2.0, -2.6, -Math.PI / 180 * 10)); // Left side top profile
  // Side windshields (more angled)
  windowGroup.add(cw(26, 2.3, 3.4, Math.PI / 180 * 30)); // Right side wrap
  windowGroup.add(cw(26, 2.3, -3.4, -Math.PI / 180 * 30)); // Left side wrap

  group.add(windowGroup);

  // Doors: clearly defined entry points
  const doorX = [7, -20];
  doorX.forEach(x => {
    [1, -1].forEach(side => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.0, 0.3), dark);
      d.position.set(x, 1.2, side * 2.6);
      group.add(d);
    });
  });

  return group;
}
