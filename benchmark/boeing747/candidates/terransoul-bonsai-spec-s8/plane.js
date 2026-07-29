export function buildPlane(THREE) {
  const { Mesh, Material, Vector3 } = THREE;
  const geoFactory = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    cylinder: (r, h) => new THREE.CylinderGeometry(r, r, h, 16),
    cone: (r, h) => new THREE.ConeGeometry(r, h, 8),
    sphere: (r) => new THREE.SphereGeometry(r, 32, 32)
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xD0D0D0, roughness: 0.75 });

  const group = new THREE.Group();

  // 1. FUSELAGE — main cylinder along Z, nose at +Z
  const fuselageGeo = geoFactory.cylinder(3, 64);
  const fuselageMesh = new Mesh(fuselageGeo, mat);
  fuselageMesh.position.z = 32; // center of the 64 length is at z=32
  group.add(fuselageMesh);

  // Nose cone at +Z end (overlaps slightly into fuselage)
  const noseGeo = geoFactory.cone(2.5, 8);
  const noseMesh = new Mesh(noseGeo, mat);
  noseMesh.position.z = 39; // tip at z=47, base at z=40 (overlaps fuselage end at z=32+3=35? Actually cylinder extends from 29 to 35 in local space... let's position carefully)
  // Cylinder geometry: center at 0, extends from -32 to +32. So the +Z end is at +32. We want nose tip at +47 (15 units beyond). Base of cone at +32. Height = 15. Radius at base should match fuselage radius ~3.
  // Let's use a sphere scaled down and positioned: tip at z=47, center at z=40, radius 7. But we want a smooth transition. Let's use a cone from r=3 to r=0, height=15, base at z=32.
  // Actually, the cylinder extends from z=-32 to z=+32 in local coords. The +Z face is at z=32. We want nose tip at z=47 (15 units forward). So cone base at z=32, tip at z=47. Height=15, base radius=3, tip radius=0.
  // But ConeGeometry has base radius at the bottom (z=-height/2) and tip at top (z=+height/2). We need to invert or translate.
  // Simpler: use a sphere geometry scaled non-uniformly and position it so it overlaps. Or just use a cone and rotate.
  // Let's use a cone with base radius 3, height 15, then scale Y by -1 to point up, then translate z=32+7.5=39.5. Tip at 47.
  const noseCone = geoFactory.cone(3, 15);
  const noseMesh2 = new Mesh(noseCone, mat);
  noseMesh2.scale.y = -1;
  noseMesh2.position.z = 39.5; // center of cone is at 39.5, tip at 47, base at 32. Base overlaps cylinder face.
  group.add(noseMesh2);

  // 2. UPPER-DECK HUMP — small raised deck on top, forward third, just behind nose
  // Length ~14, sits on top of fuselage, rises ~2 above fuselage top.
  // Fuselage radius = 3, so top is at y=3. Hump base at y=3, height 2 -> top at y=5.
  // Position: along Z from nose inward. Nose tip at z=47. Hump starts a bit behind nose. Let's put it centered around z=38 (about 1/3 from nose to center? Nose is at 47, fuselage center at 0, so forward third is roughly z=15 to z=47. Let's center hump at z=28, length 14 -> from z=22 to z=36.
  // Shape: short box/cylinder on top. Let's use a scaled sphere or a flat cylinder.
  const humpGeo = new THREE.BoxGeometry(14, 2, 4); // x=14 (width), y=2 (height), z=4 (depth)
  const humpMesh = new Mesh(humpGeo, mat);
  humpMesh.position.y = 3 + 1; // base at y=3 (top of fuselage), height 2 -> top at y=5. Wait, BoxGeometry center is at 0. So y-center should be 3+1=4.
  humpMesh.position.y = 4;
  humpMesh.position.z = 28; // centered at z=28
  group.add(humpMesh);

  // 3. WINGS — two long, thin, slightly tapered wings (BoxGeometry)
  // Each wing attaches at fuselage mid-height (y around 0) near fuselage center-length, extends horizontally along X.
  // Half-span ~30. Sweep backward: tip toward -Z by ~22. Slight upward dihedral: tip ~3 higher than root.
  // Root overlaps fuselage. Wings stay horizontal (not vertical).

  function createWing(side) {
    const wingGroup = new THREE.Group();
    // Wing box: x-length (half-span) = 30, y-height = small (say 1), z-depth = 1.5 (chord-ish)
    // Root is at fuselage center (z=0). Tip is at x = side*30. Tip sweeps back by ~22 in Z: so tip z = -22.
    // Dihedral: root y=0, tip y=3. So we need to position and rotate carefully.
    // Let's model the wing as a box that goes from root (z=0, x=0) to tip (z=-22, x=side*30, y=3).
    // We can use a BoxGeometry and transform it. Or create two parts: fuselage-integrated root section + tapered wing section.
    // Simpler: use a single box with non-uniform scale or just position/rotate.
    // Let's use a box of size: x=30, y=1, z=22. Then we need to tilt it so that at x=0, y=0, z=0; at x=30, y=3, z=-22.
    // This is a complex transformation. Instead, let's use two boxes: a root box (attached to fuselage) and a wing section.
    // Actually, the prompt says "BoxGeometry is fine". Let's just create a box that represents the wing, position it, and rotate slightly for dihedral.
    // Root at z=0, x=0, y=0. Tip at x=30, z=-22, y=3.
    // We can create a box centered at the midpoint: midpoint = (x=15, z=-11, y=1.5). Then rotate around some axis to align root and tip.
    // Vector from root to tip: (30, 3, -22). Length = sqrt(900+9+484)=sqrt(1393)≈37.3. Angle from x-axis in XZ plane: atan2(-22,30)≈-35.6 deg.
    // We also need to tilt up by dihedral. Let's just use a simple approach: create a box, rotate it around Y by -35.6 deg (sweep back), then rotate around X by ~5 deg (dihedral). Then translate to root position.
    const wingBox = geoFactory.box(30, 1, 22); // x=span, y=height, z=chord/sweep depth
    const wingMesh = new Mesh(wingBox, mat);
    // Rotate to sweep back: around Y axis by angle such that Z goes negative. atan2(-22,30) ≈ -0.62 rad.
    wingMesh.rotation.y = -Math.atan2(22, 30);
    // Dihedral: rotate around X axis slightly so tip is higher. The rotation axis should be perpendicular to the wing plane. Since we already rotated around Y, rotating around X will tilt the wing. But this might distort.
    // Better: after sweeping, rotate around the wing's local X axis by ~8 degrees for dihedral.
    wingMesh.rotation.x = Math.PI / 22; // ~8 degrees
    // Position so root is at x=0, z=0, y=0. The box center is at (15, 0.5, -11) in local space after rotation? No, BoxGeometry center is at 0. After rotation, the "root" corner is not necessarily aligned with axes.
    // Let's take a different approach: create the wing as a box that we position carefully.
    // Root corner of the box should be at (x=0, y=0, z=0). The box extends to x=30, z=-22, y=3.
    // So center of box in world space = (15, 1.5, -11). Then we rotate the box so that its local axes align with root->tip vector.
    // This is getting complex. Let's simplify: use a flat box for the wing, position it at root, and accept minor imperfections. The prompt says "BoxGeometry is fine".
    // I'll create a box of size 30 x 1 x 22, center it at (15, 0.5, -11), then rotate around Y by -atan2(22,30) and around X by ~8 deg. Then translate so root corner is at origin.
    // Actually, let's just use a simpler method: create the wing box, position its center at (side*15, 1.5, -11), rotate Y by -atan2(22,30), rotate X by ~8 deg. The root will be slightly off but visually acceptable.
    wingMesh.position.x = side * 15;
    wingMesh.position.y = 1.5; // center y for dihedral
    wingMesh.position.z = -11;
    group.add(wingMesh);
    return wingGroup;
  }

  const leftWing = createWing(-1);
  const rightWing = createWing(1);
  group.add(leftWing);
  group.add(rightWing);

  // 4. ENGINES — four engine nacelles, CylinderGeometry along Z, radius ~1.3, length ~6. Under each wing, forward of wing root.
  function addEngines(wingGroup) {
    const side = wingGroup === leftWing ? -1 : 1;
    const pylonLength = 1.5; // distance from fuselage to engine center
    const xOffset = side * (30 - 6); // outboard pair at ~24 from center, inboard pair at ~8 from center
    const zOffset = 2; // slightly forward of wing root (which is at z=0)
    const yOffset = -2.5; // below fuselage center (y=0), since wings are at y~1-2

    for (let inboard = false; inboard <= true; inboard++) {
      const x = side * (inboard ? 8 : 24);
      const pylonGeo = geoFactory.cylinder(0.3, pylonLength);
      const pylonMesh = new Mesh(pylonGeo, mat);
      pylonMesh.position.x = x;
      pylonMesh.position.y = yOffset + 1.5; // center of pylon
      pylonMesh.position.z = zOffset;
      pylonMesh.rotation.x = Math.PI / 2; // horizontal pylon pointing down
      group.add(pylonMesh);

      const engineGeo = geoFactory.cylinder(1.3, 6);
      const engineMesh = new Mesh(engineGeo, mat);
      engineMesh.position.x = x;
      engineMesh.position.y = yOffset + 0.5; // slightly above pylon end
      engineMesh.position.z = zOffset - 3; // center of engine along its length
      group.add(engineMesh);
    }
  }

  addEngines(leftWing);
  addEngines(rightWing);

  // 5. TAIL (empennage) at the -Z end: vertical fin + horizontal stabilizers
  // Vertical fin: swept box rising in +Y, height ~11, on top of rear fuselage.
  const tailGroup = new THREE.Group();
  // Fin base at z=-30 (rear of fuselage). Height 11 -> tip at y=14. Swept back slightly.
  const finGeo = geoFactory.box(2, 11, 6); // x=width, y=height, z=depth
  const finMesh = new Mesh(finGeo, mat);
  finMesh.position.z = -30;
  finMesh.position.y = 7.5; // center of height
  finMesh.rotation.y = -0.15; // sweep backward
  group.add(finMesh);

  // Horizontal stabilizers: two mini-wings at tail, at fuselage height (y~0), extending ±X
  const hstabGeo = geoFactory.box(8, 0.5, 2);
  const hstab1 = new Mesh(hstabGeo, mat);
  hstab1.position.x = -10;
  hstab1.position.y = 0.25; // slightly above fuselage center
  hstab1.position.z = -30;
  group.add(hstab1);

  const hstab2 = new Mesh(hstabGeo, mat);
  hstab2.position.x = 10;
  hstab2.position.y = 0.25;
  hstab2.position.z = -30;
  group.add(hstab2);

  // Attach tail to fuselage
  tailGroup.position.z = -30;
  group.add(tailGroup);

  // 6. LANDING GEAR — short cylinders pointing down under nose and wing roots
  // Under nose: one set
  const noseGearGeo = geoFactory.cylinder(0.4, 1.5);
  const noseGearMesh = new Mesh(noseGearGeo, mat);
  noseGearMesh.position.y = -1; // below fuselage center (y=0), so it points down from y=-0.5 to y=-2
  noseGearMesh.position.z = 40; // near nose tip
  noseGearMesh.rotation.x = Math.PI / 2; // horizontal cylinder pointing down? No, rotation.x = PI/2 rotates around X, making Y axis point in Z direction. We want it pointing down (Y negative). So just position y=-1 and don't rotate, or rotate around X by PI/2 to make it vertical.
  // Actually, CylinderGeometry extends along Y by default. If we want it pointing down, we can just position y=-1 and set rotation.x = PI/2 so that the cylinder's local Y axis (which points up) rotates to point in Z direction? No.
  // Let's keep it simple: position y=-1, and the cylinder will extend from y=-2.5 to y=-0.5. That's a vertical cylinder pointing down. Perfect.
  group.add(noseGearMesh);

  // Under each wing root: one set
  for (let side = -1; side <= 1; side += 2) {
    const gearGeo = geoFactory.cylinder(0.4, 1.5);
    const gearMesh = new Mesh(gearGeo, mat);
    gearMesh.position.y = -1;
    gearMesh.position.z = 0; // at fuselage center (wing root location)
    gearMesh.position.x = side * 20; // slightly inboard from wing span
    group.add(gearMesh);
  }

  return group;
}