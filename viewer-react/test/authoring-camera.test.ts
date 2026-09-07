import { describe, expect, it } from 'vitest';
import { Camera as CameraSchema } from '@companion-atlas/story';
import {
  cameraFromPose,
  clampPitchDeg,
  compass,
  DEFAULT_HEIGHT_M,
  describeCamera,
  normalizeHeadingDeg,
  poseFromCamera,
  type CameraPose,
} from '../src/authoring/camera.js';

/**
 * "Capture this view."
 *
 * The entire risk in this feature is a unit mix-up that nothing catches.
 * Cesium's camera reports radians; the canonical `Camera` is in degrees (the
 * repo's own fixtures carry `"heading": 200, "pitch": -35`, and KML's `<LookAt>`
 * is defined in degrees). Both are plain numbers called `heading`, so a story
 * written in radians validates, saves, exports, and renders as a camera
 * pointing three degrees off north with nobody able to say why.
 */

const rad = (deg: number) => (deg * Math.PI) / 180;

const pose = (over: Partial<CameraPose> = {}): CameraPose => ({
  longitude: rad(-21.9426),
  latitude: rad(64.1466),
  height: 1800,
  heading: rad(200),
  pitch: rad(-35),
  roll: 0,
  ...over,
});

describe('Cesium pose → canonical Camera', () => {
  it('converts radians to degrees on every angle', () => {
    const camera = cameraFromPose(pose());
    expect(camera).not.toBeNull();
    expect(camera).toMatchObject({
      lon: -21.9426,
      lat: 64.1466,
      height: 1800,
      heading: 200,
      pitch: -35,
      roll: 0,
    });
  });

  it('produces a value the schema accepts', () => {
    expect(() => CameraSchema.parse(cameraFromPose(pose()))).not.toThrow();
  });

  it('rounds to a precision a human can read and a diff can show', () => {
    // A raw float64 camera pose gives -21.942617893471268 and two captures of
    // the same view differ in the eleventh decimal, so "did this scene's camera
    // change?" stops being answerable.
    const camera = cameraFromPose(pose({ longitude: rad(-21.94261789347126) }));
    expect(String(camera!.lon)).toBe('-21.9426179');
    expect(String(camera!.heading)).toBe('200');
  });

  it('never emits -0, which JSON writes out and equality then trips over', () => {
    const camera = cameraFromPose(pose({ roll: -1e-12, longitude: -1e-12 }));
    expect(Object.is(camera!.roll, -0)).toBe(false);
    expect(Object.is(camera!.lon, -0)).toBe(false);
  });

  it('returns null rather than a NaN camera', () => {
    // Reading the camera on the first frame, or mid-flyTo before the position
    // resolves against terrain, yields NaN — and NaN passes `z.number()`, so a
    // NaN camera would validate and then render a black screen.
    expect(cameraFromPose(pose({ height: Number.NaN }))).toBeNull();
    expect(cameraFromPose(pose({ heading: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('carries an optional range and duration through', () => {
    const camera = cameraFromPose(pose(), { durationMs: 3500, range: 4200 });
    expect(camera).toMatchObject({ durationMs: 3500, range: 4200 });
  });
});

describe('angle normalisation', () => {
  it('folds heading into [0, 360)', () => {
    expect(normalizeHeadingDeg(-90)).toBe(270);
    expect(normalizeHeadingDeg(450)).toBe(90);
    expect(normalizeHeadingDeg(360)).toBe(0);
    expect(normalizeHeadingDeg(Number.NaN)).toBe(0);
  });

  it('clamps pitch to ±90, because beyond it Cesium reinterprets the pose', () => {
    expect(clampPitchDeg(-120)).toBe(-90);
    expect(clampPitchDeg(120)).toBe(90);
    expect(clampPitchDeg(-35)).toBe(-35);
  });
});

describe('canonical Camera → Cesium pose', () => {
  it('round-trips a captured camera', () => {
    const captured = cameraFromPose(pose())!;
    const back = poseFromCamera(captured)!;
    expect(back.longitude).toBeCloseTo(rad(-21.9426), 9);
    expect(back.latitude).toBeCloseTo(rad(64.1466), 9);
    expect(back.height).toBe(1800);
    expect(back.heading).toBeCloseTo(rad(200), 9);
    expect(back.pitch).toBeCloseTo(rad(-35), 9);
  });

  it('reads the Atlas nested spelling as well as the Earth-2 flat one', () => {
    // Both are legal in the schema and both appear in the fixtures; a reader
    // that understood one would silently do nothing on half the corpus.
    const nested = poseFromCamera({ location: { lat: 64.1466, lon: -21.9426, height: 900 }, pitch: -40 })!;
    expect(nested.height).toBe(900);
    expect(nested.pitch).toBeCloseTo(rad(-40), 9);
  });

  it('does not put the camera inside the terrain when no height is given', () => {
    // A `Camera` may legally carry only lon/lat. Height 0 is the ellipsoid
    // surface — i.e. the inside of a mountain.
    expect(poseFromCamera({ lon: 0, lat: 0 })!.height).toBe(DEFAULT_HEIGHT_M);
    // …and an orbit `range` is a usable stand-in when there is one.
    expect(poseFromCamera({ lon: 0, lat: 0, range: 4200 })!.height).toBe(4200);
  });

  it('refuses a camera with no location at all', () => {
    expect(poseFromCamera(null)).toBeNull();
    expect(poseFromCamera({ heading: 90 })).toBeNull();
  });
});

describe('human readout', () => {
  it('names the compass point rather than the number', () => {
    expect(compass(0)).toBe('N');
    expect(compass(90)).toBe('E');
    expect(compass(200)).toBe('SSW');
    expect(compass(359)).toBe('N');
    expect(compass(-90)).toBe('W');
  });

  it('summarises a capture in one line, switching units at 10 km', () => {
    expect(describeCamera(cameraFromPose(pose())!)).toBe('64.1466, -21.9426 · 1800 m · SSW');
    expect(describeCamera(cameraFromPose(pose({ height: 1.8e6 }))!)).toContain('1800 km');
    expect(describeCamera(null)).toMatch(/No view/);
  });
});
