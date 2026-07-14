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

  // Wings: one flat box straight through the fuselage (no sweep, no taper).
  const wings = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 55), dark);
  group.add(wings);

  // Tail: a small vertical box.
  const tail = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 0.6), dark);
  tail.position.set(-27, 7, 0);
  group.add(tail);

  // Window and Door Lines
  const windowGroup = new THREE.Group();
  for (let i = 0; i < 15; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.1), grey);
    w.position.set(-24 + i * 1.8, 1.5, 2.9); // Main deck windows row
    windowGroup.add(w);
  }
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 0.7), grey);
  cockpit.position.set(26, 1, 2.8); // Cockpit windows
  windowGroup.add(cockpit);
  group.add(windowGroup);

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 0.2), dark);
  door.position.set(5, 0, 3.0); // Door hint
  group.add(door);

  return group;
}
