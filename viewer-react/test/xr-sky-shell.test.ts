import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { projectionFar, skyRadius, SKY_FRACTION_OF_FAR } from '../src/renderers/xr/skyShell.js';

/**
 * Both sky bugs so far were a shell hung at a distance the live far plane does
 * not reach, and both were invisible in a screenshot: the objects were present,
 * visible and correctly positioned, and drew nothing. These tests pin the two
 * properties that would have caught them.
 */
describe('projectionFar', () => {
  it('recovers the far plane a projection matrix is enforcing', () => {
    for (const [near, far] of [[0.1, 1000], [0.035, 13.72], [1, 1e6]] as const) {
      const cam = new PerspectiveCamera(75, 1.6, near, far);
      cam.updateProjectionMatrix();
      // Relative, not absolute: at far = 1e6 an exact comparison fails on a
      // 6e-10 relative error that is pure float noise.
      expect(projectionFar(cam.projectionMatrix.elements) / far).toBeCloseTo(1, 6);
    }
  });

  it('reads the matrix rather than the camera property, which lags it', () => {
    // The depth range is only pushed into the matrix when it moves materially,
    // so `camera.far` routinely runs ahead of what actually clips. Trusting the
    // property put the sun and moon at 6.2 m inside a nominal 13.7 m far plane
    // and still clipped them, at an NDC z of 1.018.
    const cam = new PerspectiveCamera(75, 1.6, 0.035, 13.72);
    cam.updateProjectionMatrix();
    cam.far = 2000; // changed, but never committed to the matrix
    expect(cam.far).toBe(2000);
    expect(projectionFar(cam.projectionMatrix.elements)).toBeCloseTo(13.72, 2);
  });

  it('falls back to a usable radius for a degenerate matrix', () => {
    // An infinite-far projection makes the denominator vanish; a sky at
    // Infinity or NaN is worse than a sky at an arbitrary finite distance.
    expect(projectionFar([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 0])).toBe(1000);
  });
});

describe('skyRadius', () => {
  it('stays inside the frustum at every scale the world reaches', () => {
    // The far plane spans five orders of magnitude between holding the globe in
    // your hands and standing on a street, and the sky must be unclipped at
    // both ends.
    for (const far of [13.72, 1000, 1e6]) {
      const cam = new PerspectiveCamera(75, 1.6, far / 1000, far);
      cam.updateProjectionMatrix();
      const r = skyRadius(cam);
      expect(r).toBeLessThan(far);
      expect(r / far).toBeCloseTo(SKY_FRACTION_OF_FAR, 6);
    }
  });

  it('never collapses to zero when the far plane is tiny', () => {
    const cam = new PerspectiveCamera(75, 1.6, 0.001, 0.01);
    cam.updateProjectionMatrix();
    expect(skyRadius(cam)).toBeGreaterThanOrEqual(1);
  });
});
