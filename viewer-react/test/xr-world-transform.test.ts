import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  applyGrab,
  clampWorld,
  createWorldTransform,
  DEFAULT_LIMITS,
  depthRange,
  earthToGeodetic,
  earthToPlayer,
  EARTH_RADIUS_M,
  frameGlobe,
  frameSurface,
  geodeticToEarth,
  grabFrame,
  playerHeight,
  playerToEarth,
  setScaleAbout,
  toMatrix,
  type WorldTransform,
} from '../src/renderers/xr/worldTransform.js';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const SF = { lat: 37.7749, lon: -122.4194 };

describe('geodetic conversion', () => {
  it('round-trips lat/lon/height', () => {
    const p = geodeticToEarth(SF.lat, SF.lon, 1234, new Vector3());
    const g = earthToGeodetic(p);
    // Height is exact — it is what the "don't sink through the planet" clamp
    // reads. Latitude comes back through the tiles renderer's Newton solve for
    // the closest surface point, which settles a few metres out at some
    // latitudes, so this only claims what it can: a position readout, not a
    // survey.
    expect(g.height).toBeCloseTo(1234, 3);
    expect(Math.abs(g.lat - SF.lat) * 111_320).toBeLessThan(10);
    expect(Math.abs(g.lon - SF.lon) * 111_320).toBeLessThan(10);
  });

  it('puts the poles on the Z axis and 0/0 on X', () => {
    const north = geodeticToEarth(90, 0, 0, new Vector3());
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.y).toBeCloseTo(0, 6);
    expect(north.z).toBeGreaterThan(6e6);

    const origin = geodeticToEarth(0, 0, 0, new Vector3());
    expect(origin.x).toBeCloseTo(EARTH_RADIUS_M, 6);
  });
});

describe('framing', () => {
  it('frameGlobe faces the anchor at the viewer, at the requested radius', () => {
    const t = createWorldTransform();
    const centre = v(0, 1.4, -1);
    const head = v(0, 1.6, 0);
    frameGlobe(t, { ...SF, centre, facing: head, radius: 0.5 });

    expect(t.position.distanceTo(centre)).toBeCloseTo(0, 9);
    expect(EARTH_RADIUS_M * t.scale).toBeCloseTo(0.5, 6);

    // The anchor should sit on the near side of the globe with its *surface
    // normal* aimed at the viewer. (Normal, not radius: on an ellipsoid the two
    // differ by up to 0.19°, and the normal is what "facing you" means.)
    const ground = earthToPlayer(t, geodeticToEarth(SF.lat, SF.lon, 0, new Vector3()), new Vector3());
    const aloft = earthToPlayer(t, geodeticToEarth(SF.lat, SF.lon, 1e6, new Vector3()), new Vector3());
    const normal = aloft.sub(ground).normalize();
    expect(normal.dot(head.clone().sub(centre).normalize())).toBeCloseTo(1, 9);
    // On the near side, at (very nearly) the requested radius — a touch under,
    // because 37°N sits inside the equatorial radius.
    expect(ground.distanceTo(centre)).toBeGreaterThan(0.49);
    expect(ground.distanceTo(centre)).toBeLessThan(0.5);
    expect(ground.distanceTo(head)).toBeLessThan(centre.distanceTo(head));
  });

  it('frameSurface stands the viewer on the ground facing north', () => {
    const t = createWorldTransform();
    const at = v(0, 0, 0);
    frameSurface(t, { ...SF, at, scale: 1 });

    const anchor = earthToPlayer(t, geodeticToEarth(SF.lat, SF.lon, 0, new Vector3()), new Vector3());
    expect(anchor.distanceTo(at)).toBeLessThan(1e-6);

    // 100 m due north of the anchor must land 100 m along -Z, and up must be +Y.
    const north = earthToPlayer(t, geodeticToEarth(SF.lat + 100 / 111_320, SF.lon, 0, new Vector3()), new Vector3());
    expect(north.z).toBeLessThan(-99);
    expect(Math.abs(north.x)).toBeLessThan(1);

    const up = earthToPlayer(t, geodeticToEarth(SF.lat, SF.lon, 100, new Vector3()), new Vector3());
    expect(up.y).toBeCloseTo(100, 3);
  });

  it('reports the viewer height above the ellipsoid', () => {
    const t = createWorldTransform();
    frameSurface(t, { ...SF, at: v(0, 0, 0), scale: 1 });
    expect(playerHeight(t, v(0, 1.7, 0))).toBeCloseTo(1.7, 3);
  });
});

describe('grab locomotion', () => {
  const worldAt = (scale: number) => {
    const t = createWorldTransform();
    frameGlobe(t, { ...SF, centre: v(0, 1.4, -1), facing: v(0, 1.6, 0), radius: EARTH_RADIUS_M * scale });
    return t;
  };

  it('one hand drags the world rigidly', () => {
    const t = worldAt(1e-7);
    const before: WorldTransform = {
      position: t.position.clone(),
      quaternion: t.quaternion.clone(),
      scale: t.scale,
    };

    const start = new Matrix4();
    const now = new Matrix4();
    grabFrame([{ position: v(0.2, 1.2, -0.6), quaternion: new Quaternion() }], start);
    grabFrame([{ position: v(0.5, 1.2, -0.6), quaternion: new Quaternion() }], now);

    applyGrab(t, toMatrix(before, new Matrix4()), start, now);

    expect(t.scale).toBeCloseTo(before.scale, 12);
    expect(t.quaternion.angleTo(before.quaternion)).toBeCloseTo(0, 9);
    expect(t.position.x - before.position.x).toBeCloseTo(0.3, 9);
    expect(t.position.y - before.position.y).toBeCloseTo(0, 9);
  });

  it('one hand twisting turns the world about the hand', () => {
    const t = worldAt(1e-7);
    const worldStart = toMatrix(t, new Matrix4());
    const grip = v(0, 1.4, -1); // grabbing at the globe's centre
    const turn = new Quaternion().setFromAxisAngle(v(0, 1, 0), Math.PI / 2);

    const start = new Matrix4();
    const now = new Matrix4();
    grabFrame([{ position: grip, quaternion: new Quaternion() }], start);
    grabFrame([{ position: grip, quaternion: turn }], now);
    applyGrab(t, worldStart, start, now);

    // Grabbing exactly at the centre means the globe spins in place.
    expect(t.position.distanceTo(grip)).toBeCloseTo(0, 6);
    expect(t.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1);
  });

  it('two hands pulling apart scale about the midpoint', () => {
    const t = worldAt(1e-7);
    const worldStart = toMatrix(t, new Matrix4());
    const scaleBefore = t.scale;

    const mid = v(0, 1.4, -1);
    const q = new Quaternion();
    const start = new Matrix4();
    const now = new Matrix4();
    grabFrame(
      [
        { position: mid.clone().add(v(-0.15, 0, 0)), quaternion: q },
        { position: mid.clone().add(v(0.15, 0, 0)), quaternion: q },
      ],
      start,
    );
    grabFrame(
      [
        { position: mid.clone().add(v(-0.3, 0, 0)), quaternion: q },
        { position: mid.clone().add(v(0.3, 0, 0)), quaternion: q },
      ],
      now,
    );

    // What is under the midpoint before the zoom must still be there after it.
    const under = playerToEarth(t, mid, new Vector3());
    applyGrab(t, worldStart, start, now);

    expect(t.scale / scaleBefore).toBeCloseTo(2, 6);
    expect(earthToPlayer(t, under, new Vector3()).distanceTo(mid)).toBeLessThan(1e-6);
  });

  it('keeps the pivot fixed when scaling directly', () => {
    const t = worldAt(1e-7);
    const pivot = v(0.1, 1.5, -0.7);
    const under = playerToEarth(t, pivot, new Vector3());
    setScaleAbout(t, t.scale * 37, pivot);
    expect(earthToPlayer(t, under, new Vector3()).distanceTo(pivot)).toBeLessThan(1e-6);
  });

  it('grabFrame reports nothing to grab with when no hands are down', () => {
    expect(grabFrame([], new Matrix4())).toBe(false);
  });
});

describe('limits', () => {
  it('stops the viewer sinking through the planet', () => {
    const t = createWorldTransform();
    const head = v(0, 1.6, 0);
    // Stand at the anchor, i.e. with the viewer's feet a metre *below* the ground.
    frameSurface(t, { ...SF, at: v(0, 2.6, 0), scale: 1 });
    expect(playerHeight(t, head)).toBeLessThan(DEFAULT_LIMITS.minHeight);

    clampWorld(t, head, DEFAULT_LIMITS);
    expect(playerHeight(t, head)).toBeCloseTo(DEFAULT_LIMITS.minHeight, 3);
  });

  it('clamps zoom to the configured range', () => {
    const t = createWorldTransform();
    const head = v(0, 1.6, 0);
    frameGlobe(t, { ...SF, centre: v(0, 1.4, -1), facing: head, radius: 0.5 });

    t.scale = DEFAULT_LIMITS.maxScale * 1000;
    clampWorld(t, head, DEFAULT_LIMITS);
    expect(t.scale).toBeCloseTo(DEFAULT_LIMITS.maxScale, 9);

    t.scale = DEFAULT_LIMITS.minScale / 1000;
    clampWorld(t, head, DEFAULT_LIMITS);
    expect(t.scale).toBeCloseTo(DEFAULT_LIMITS.minScale, 12);
  });
});

describe('depth range', () => {
  it('stays human-scale with the globe in reach', () => {
    const t = createWorldTransform();
    const head = v(0, 1.6, 0);
    frameGlobe(t, { ...SF, centre: v(0, 1.4, -1), facing: head, radius: 0.5 });
    const { near, far } = depthRange(t, head);
    expect(near).toBeLessThanOrEqual(0.1);
    expect(far).toBeGreaterThan(2);
    expect(far).toBeLessThan(100);
  });

  it('reaches the horizon at street level without a 1e13 far plane', () => {
    const t = createWorldTransform();
    const head = v(0, 1.7, 0);
    frameSurface(t, { ...SF, at: v(0, 0, 0), scale: 1 });
    const { near, far } = depthRange(t, head);
    // Horizon from 1.7 m is ~4.7 km.
    expect(far).toBeGreaterThan(8_000);
    expect(far).toBeLessThan(30_000);
    // Never so far forward that the viewer's own hands get clipped.
    expect(near).toBeLessThanOrEqual(0.1);
  });
});
