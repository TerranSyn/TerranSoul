// RIG-VALIDATION STUB — deliberately crude (a cylinder fuselage + box wings).
// NOT a real benchmark attempt; exists only to prove the rig + judge pipeline
// end-to-end. A low score on this stub is the expected, correct outcome.
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

  return group;
}
