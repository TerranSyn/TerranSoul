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
  const grey = new THREE.MeshStandardMaterial({ color: 0xd8dde3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b7280 });

  // Fuselage: single cylinder along +X (nose = +X per the frozen contract).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 24), grey);
  fuselage.rotation.z = -Math.PI / 2;
  group.add(fuselage);

  // Wings: Swept-back configuration with four pylon-mounted engines and dihedral.
  const wingGroup = new THREE.Group();
  group.add(wingGroup);
  const createWingHalf = (side) => {
    const half = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 35), dark);
    half.position.set(side * 8, -1.2, side * 15);
    half.rotation.x = Math.PI / 180 * 3; // Dihedral
    half.rotation.z = -Math.PI / 180 * 30; // Sweep back
    half.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2; // Align span with Z axis
    wingGroup.add(half);
  };
  createWingHalf(1);
  createWingHalf(-1);
  const engineGeo = new THREE.CylinderGeometry(2, 1.5, 5, 8);
  [18, 36].forEach((zDist, idx) => {
    [1, -1].forEach(side => {
      const engine = new THREE.Mesh(engineGeo, dark);
      engine.rotation.z = Math.PI / 2; // Align with fuselage X axis
      engine.position.set(side * (idx === 0 ? 14 : 26), -5.0, side * zDist);
      wingGroup.add(engine);

      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 1.8), dark);
      pylon.position.set(side * (idx === 0 ? 14 : 26), -4.2, side * zDist);
      wingGroup.add(pylon);
    });
  });

  // Tail: a small vertical box.
  const tail = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 0.6), dark);
  tail.position.set(-27, 7, 0);
  group.add(tail);

  // Window and Door Lines
  const windowGroup = new THREE.Group();
  // Main deck - consistent row along both sides, on surface of cylinder (y^2 + z^2 ~ 9)
  for (let i = 0; i < 35; i++) {
    [1, -1].forEach(side => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.2), dark);
      w.position.set(-20 + i * 1.2, 1.7, side * 2.6); // Positioned on both sides
      windowGroup.add(w);
    });
  }
  // Upper-deck windows - smaller, higher, and only in the front hump area
  for (let i = 0; i < 8; i++) {
    [1, -1].forEach(side => {
      const wUpper = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.2), dark);
      wUpper.position.set(10 + i * 2, 2.4, side * 1.8); // More visible on both sides, slightly higher/further out
      windowGroup.add(wUpper);
    });
  }
  // Cockpit - clearer windshield shape at front (+X)
  const cp = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 0.5), dark);
  cp.position.set(27, 1.8, 2.4); // Aligned with main deck row but larger
  windowGroup.add(cp);

  group.add(windowGroup);

  // Doors - large markings for front and rear cargo/passengers on both sides
  const doors = [8, -20];
  doors.forEach(x => {
    [1, -1].forEach(side => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.5, 0.3), dark);
      d.position.set(x, 0.5, side * 2.6); // Positioned on both sides
      group.add(d);
    });
  });

  return group;
}
