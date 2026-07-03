import { describe, expect, it } from 'vitest';
import {
  autoFrameDistance,
  bboxMetrics,
  CAMERA_SPEC_VERSION,
  computeCamera,
  FOV_DEG,
  FRAME_MARGIN,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  VIEWS,
} from './cameras.mjs';

// A 747-shaped bbox under the frozen orientation convention:
// nose +X (length 70), up +Y (height 20), wingspan Z (span 64).
const BBOX = { min: { x: -35, y: -10, z: -32 }, max: { x: 35, y: 10, z: 32 } };

describe('frozen camera spec', () => {
  it('freezes the spec version, render size, and nine views', () => {
    expect(CAMERA_SPEC_VERSION).toBe(1);
    expect(RENDER_WIDTH).toBe(1024);
    expect(RENDER_HEIGHT).toBe(768);
    expect(VIEWS).toHaveLength(9);
    expect(VIEWS.map((v) => v.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Frozen angle table — any change here is a spec break.
    expect(VIEWS.map((v) => [v.azimuthDeg, v.elevationDeg])).toEqual([
      [-90, 0], [90, 0], [0, 0], [180, 0], [0, 90], [-45, 20], [135, 20], [-60, -10], [-35, 12],
    ]);
  });

  it('computes bbox metrics', () => {
    const { center, size, radius } = bboxMetrics(BBOX);
    expect(center).toEqual({ x: 0, y: 0, z: 0 });
    expect(size).toEqual({ x: 70, y: 20, z: 64 });
    expect(radius).toBeCloseTo(0.5 * Math.hypot(70, 20, 64), 10);
  });

  it('auto-frame distance fits the bounding sphere in the vertical FOV', () => {
    const d = autoFrameDistance(10);
    expect(d).toBeCloseTo((10 * FRAME_MARGIN) / Math.sin((FOV_DEG / 2) * (Math.PI / 180)), 10);
    // The sphere subtends exactly the (margin-inflated) FOV at this distance.
    expect(2 * Math.asin((10 * FRAME_MARGIN) / d) * (180 / Math.PI)).toBeCloseTo(FOV_DEG, 6);
  });

  it('places the profile cameras on the Z axis and front/rear on X', () => {
    const left = computeCamera(VIEWS[0], BBOX);
    expect(left.position[0]).toBeCloseTo(0, 8);
    expect(left.position[2]).toBeLessThan(0); // port side = -Z
    const right = computeCamera(VIEWS[1], BBOX);
    expect(right.position[2]).toBeGreaterThan(0);
    const front = computeCamera(VIEWS[2], BBOX);
    expect(front.position[0]).toBeGreaterThan(0); // nose = +X
    expect(front.position[2]).toBeCloseTo(0, 8);
    const rear = computeCamera(VIEWS[3], BBOX);
    expect(rear.position[0]).toBeLessThan(0);
  });

  it('top-down view looks straight down with +X as screen-up', () => {
    const top = computeCamera(VIEWS[4], BBOX);
    expect(top.position[0]).toBeCloseTo(0, 6);
    expect(top.position[2]).toBeCloseTo(0, 6);
    expect(top.position[1]).toBeGreaterThan(0);
    expect(top.up).toEqual([1, 0, 0]);
  });

  it('elevated and low views respect the frozen elevations', () => {
    const elevated = computeCamera(VIEWS[5], BBOX);
    expect(elevated.position[1]).toBeGreaterThan(0);
    const low = computeCamera(VIEWS[7], BBOX);
    expect(low.position[1]).toBeLessThan(0);
  });

  it('the nose close-up targets the front-upper fuselage at reduced distance', () => {
    const closeup = computeCamera(VIEWS[8], BBOX);
    const full = computeCamera(VIEWS[5], BBOX);
    expect(closeup.target[0]).toBeCloseTo(0.3 * 70, 8);
    expect(closeup.target[1]).toBeCloseTo(0.1 * 20, 8);
    expect(closeup.distance).toBeCloseTo(full.distance * 0.42, 8);
  });

  it('is scale-invariant: a 100x model frames identically (relative)', () => {
    const big = {
      min: { x: -3500, y: -1000, z: -3200 },
      max: { x: 3500, y: 1000, z: 3200 },
    };
    const a = computeCamera(VIEWS[6], BBOX);
    const b = computeCamera(VIEWS[6], big);
    expect(b.distance / a.distance).toBeCloseTo(100, 6);
    for (let i = 0; i < 3; i++) {
      expect(b.position[i] / 100).toBeCloseTo(a.position[i], 6);
    }
  });

  it('rejects a degenerate bounding box', () => {
    const flat = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    expect(() => computeCamera(VIEWS[0], flat)).toThrow(/degenerate/);
  });
});
