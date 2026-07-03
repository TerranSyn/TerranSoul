// FROZEN camera specification for the Boeing 747 primitives vision benchmark.
//
// This module is the single source of truth for the NINE repeatable camera
// angles. It is imported BOTH by the browser rig page (rig.html, served over
// the local static server) and by node-side vitest tests, so it must stay
// pure ESM with zero dependencies (no three.js, no node built-ins).
//
// Coordinate convention (part of the frozen candidate contract):
//   +X = nose direction, +Y = up, wings span the Z axis.
//   Candidates are auto-framed from their bounding box, so absolute position
//   and scale do not matter — only orientation does.
//
// DO NOT EDIT once benchmark runs have been recorded: every recorded result
// references CAMERA_SPEC_VERSION. Changing anything here invalidates
// cross-iteration comparability.

export const CAMERA_SPEC_VERSION = 1;

/** Render size (pixels), fixed for every view. */
export const RENDER_WIDTH = 1024;
export const RENDER_HEIGHT = 768;

/** Vertical field of view in degrees, fixed for every view. */
export const FOV_DEG = 35;

/** Bounding-sphere framing margin (1.0 = sphere exactly fits vertically). */
export const FRAME_MARGIN = 1.05;

/** Fixed scene constants (kept here so rig + docs share one source). */
export const SCENE_BACKGROUND = '#eef2f7';
export const HEMI_LIGHT = { sky: '#ffffff', ground: '#b0b8c0', intensity: 0.9 };
/** Directional light direction (normalized in the rig) and intensity. */
export const DIR_LIGHT = { direction: [1, 1.2, 0.8], intensity: 2.2 };

/**
 * The nine frozen views.
 * azimuthDeg: rotation around +Y measured from +X (nose) toward +Z.
 *   With nose = +X and up = +Y: camera at azimuth +90 sees the aircraft's
 *   RIGHT (starboard) side; azimuth -90 sees the LEFT (port) side.
 * elevationDeg: angle above (+) / below (-) the horizontal plane.
 * distanceFactor: multiplier on the auto-framed distance (1 = full frame).
 * targetOffsetFactor: offset of the look-at point from the bbox center,
 *   expressed as fractions of the bbox size per axis.
 * up: camera up vector override (needed for the top-down view).
 */
export const VIEWS = [
  { id: 1, key: 'left-profile', name: 'Left (port) side profile, nose pointing left of frame', azimuthDeg: -90, elevationDeg: 0 },
  { id: 2, key: 'right-profile', name: 'Right (starboard) side profile, nose pointing right of frame', azimuthDeg: 90, elevationDeg: 0 },
  { id: 3, key: 'front', name: 'Head-on front view (looking at the nose)', azimuthDeg: 0, elevationDeg: 0 },
  { id: 4, key: 'rear', name: 'Head-on rear view (looking at the tail)', azimuthDeg: 180, elevationDeg: 0 },
  { id: 5, key: 'top-down', name: 'Top-down planform view, nose toward top of frame', azimuthDeg: 0, elevationDeg: 90, up: [1, 0, 0] },
  { id: 6, key: 'front-34-left', name: 'Front three-quarter view from the left, elevated 20 degrees', azimuthDeg: -45, elevationDeg: 20 },
  { id: 7, key: 'rear-34-right', name: 'Rear three-quarter view from the right, elevated 20 degrees', azimuthDeg: 135, elevationDeg: 20 },
  { id: 8, key: 'low-front-left', name: 'Low front-left view, 10 degrees below center (landing-gear view)', azimuthDeg: -60, elevationDeg: -10 },
  { id: 9, key: 'nose-hump-closeup', name: 'Close framing on the nose and upper-deck hump from the front-left', azimuthDeg: -35, elevationDeg: 12, distanceFactor: 0.42, targetOffsetFactor: [0.30, 0.10, 0] },
];

const DEG = Math.PI / 180;

/**
 * Derive bbox center / size / bounding-sphere radius from a plain bbox
 * ({ min: {x,y,z}, max: {x,y,z} }).
 */
export function bboxMetrics(bbox) {
  const size = {
    x: bbox.max.x - bbox.min.x,
    y: bbox.max.y - bbox.min.y,
    z: bbox.max.z - bbox.min.z,
  };
  const center = {
    x: (bbox.min.x + bbox.max.x) / 2,
    y: (bbox.min.y + bbox.max.y) / 2,
    z: (bbox.min.z + bbox.max.z) / 2,
  };
  const radius = 0.5 * Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
  return { center, size, radius };
}

/**
 * Auto-framed camera distance: the model's bounding sphere (radius r,
 * inflated by FRAME_MARGIN) fits inside the vertical field of view.
 * Frozen formula — sphere fit uses sin, guaranteeing the whole sphere is
 * inside the frustum regardless of aspect (aspect 1024/768 > 1, so the
 * vertical FOV is the binding constraint).
 */
export function autoFrameDistance(radius, fovDeg = FOV_DEG, margin = FRAME_MARGIN) {
  return (radius * margin) / Math.sin((fovDeg / 2) * DEG);
}

/**
 * Compute the frozen camera pose for one view given the candidate bbox.
 * Returns plain arrays so the result is usable from both node and browser.
 */
export function computeCamera(view, bbox) {
  const { center, size, radius } = bboxMetrics(bbox);
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new Error(`camera spec: degenerate bounding box (radius=${radius})`);
  }
  const off = view.targetOffsetFactor || [0, 0, 0];
  const target = [
    center.x + off[0] * size.x,
    center.y + off[1] * size.y,
    center.z + off[2] * size.z,
  ];
  const dist = autoFrameDistance(radius) * (view.distanceFactor ?? 1);
  const az = view.azimuthDeg * DEG;
  const el = view.elevationDeg * DEG;
  const dir = [
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az),
  ];
  const position = [
    target[0] + dist * dir[0],
    target[1] + dist * dir[1],
    target[2] + dist * dir[2],
  ];
  return {
    position,
    target,
    up: view.up || [0, 1, 0],
    fov: FOV_DEG,
    distance: dist,
  };
}
