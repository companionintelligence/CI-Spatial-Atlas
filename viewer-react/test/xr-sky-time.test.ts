/**
 * The arithmetic behind "grab the sky and drag the sun".
 *
 * Three things here are worth testing and nothing else in the feature is:
 * unwrapping the drag angle (get it wrong and the date jumps a day every time
 * the hand crosses due north), the revolution → date-step overload in both
 * directions, and the window that decides which memories are "then". The rest
 * of the gesture is three.js poses, which a unit test cannot honestly claim to
 * exercise.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  advanceSkyDrag,
  angleAround,
  beginSkyDrag,
  clampToSpan,
  DAY_MS,
  memoriesInWindow,
  MEMORY_WINDOW_MS,
  orthonormalBasis,
  skyDateSteps,
  skyDragTime,
  skyTurns,
  subsolarPoint,
  sunDirectionEarth,
  TAU,
  TURN_YEAR_MS,
  wrapAngle,
} from '../src/renderers/xr/skyTime.js';

const ANCHOR = Date.UTC(2018, 5, 21, 12, 0, 0); // 2018-06-21T12:00:00Z, a solstice
const HOUR = 3_600_000;

/** Sweep a drag through `total` radians in `steps` samples, as a hand would. */
function sweep(drag: ReturnType<typeof beginSkyDrag>, from: number, total: number, steps = 90) {
  for (let i = 1; i <= steps; i++) {
    // Feed *wrapped* angles, which is all a real atan2 can ever produce — the
    // unwrapping is the thing under test.
    advanceSkyDrag(drag, wrapAngle(from + (total * i) / steps));
  }
  return drag;
}

describe('wrapAngle', () => {
  it('folds into (-π, π]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 12);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(wrapAngle(TAU + 0.25)).toBeCloseTo(0.25, 12);
    expect(wrapAngle(-TAU - 0.25)).toBeCloseTo(-0.25, 12);
  });

  it('takes the short way across the seam', () => {
    // 170° → -170° is a 20° step forward, not a 340° step back. This is the
    // whole reason a drag can cross due north without losing a day.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    expect((wrapAngle(to - from) * 180) / Math.PI).toBeCloseTo(20, 9);
  });
});

describe('drag angle → time of day', () => {
  it('starts exactly where it was anchored', () => {
    const drag = beginSkyDrag(ANCHOR, 1.234);
    expect(skyDragTime(drag)).toBe(ANCHOR);
    expect(skyDateSteps(drag)).toBe(0);
  });

  it('advances six hours for a quarter turn the way the sun travels', () => {
    // The sun's apparent motion is *negative* about the north pole (the Earth
    // spins the other way), so dragging the sky with it is a negative angle.
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, -TAU / 4);
    expect(skyDragTime(drag) - ANCHOR).toBeCloseTo(6 * HOUR, 0);
    expect(skyDateSteps(drag)).toBe(0);
  });

  it('runs the clock backwards when the sky is dragged the other way', () => {
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, TAU / 4);
    expect(skyDragTime(drag) - ANCHOR).toBeCloseTo(-6 * HOUR, 0);
  });

  it('comes back to the anchor when the drag is reversed', () => {
    const drag = beginSkyDrag(ANCHOR, 0);
    sweep(drag, 0, -TAU * 0.8);
    sweep(drag, -TAU * 0.8, TAU * 0.8);
    expect(skyDragTime(drag)).toBeCloseTo(ANCHOR, 0);
    expect(skyDateSteps(drag)).toBe(0);
  });

  it('survives an angle that never leaves (-π, π]', () => {
    // Two and a bit revolutions, sampled finely: the accumulated angle has to
    // keep growing even though every sample is wrapped.
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, -TAU * 2.25, 400);
    expect(skyTurns(drag)).toBeCloseTo(2.25, 6);
  });
});

describe('the revolution → date overload', () => {
  it('makes one full turn worth exactly one day', () => {
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, -TAU, 180);
    expect(skyDragTime(drag) - ANCHOR).toBeCloseTo(DAY_MS, 0);
  });

  it('steps the date once the turn is through', () => {
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, -TAU * 1.01, 180);
    expect(skyDateSteps(drag)).toBe(1);
    expect(new Date(skyDragTime(drag)).getUTCDate()).toBe(22);
  });

  it('does not step before the turn completes', () => {
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, -TAU * 0.99, 180);
    expect(skyDateSteps(drag)).toBe(0);
    // The calendar has still rolled over — the anchor was midday, so 0.99 of a
    // revolution lands at a quarter to noon the next day. A "date step" counts
    // revolutions of the sky, not midnights; the clock and the step counter are
    // deliberately two different readings.
    expect(new Date(skyDragTime(drag)).getUTCDate()).toBe(22);
    expect(skyTurns(drag)).toBeCloseTo(0.99, 6);
  });

  it('steps backwards when dragged backwards', () => {
    const drag = sweep(beginSkyDrag(ANCHOR, 0), 0, TAU * 1.5, 270);
    // Truncated toward zero: a turn and a half back is yesterday, not the day
    // before yesterday.
    expect(skyDateSteps(drag)).toBe(-1);
    expect(skyDragTime(drag) - ANCHOR).toBeCloseTo(-1.5 * DAY_MS, 0);
    expect(new Date(skyDragTime(drag)).getUTCDate()).toBe(20);
  });

  it('covers a year per turn on the two-handed gear', () => {
    const drag = sweep(beginSkyDrag(ANCHOR, 0, TURN_YEAR_MS), 0, -TAU * 1.01, 180);
    expect(skyDragTime(drag) - ANCHOR).toBeCloseTo(1.01 * 365 * DAY_MS, 0);
    expect(skyDateSteps(drag)).toBe(1);
    expect(new Date(skyDragTime(drag)).getUTCFullYear()).toBe(2019);
  });
});

describe('clampToSpan', () => {
  const start = Date.UTC(2015, 0, 1);
  const stop = Date.UTC(2022, 0, 1);

  it('holds a drag inside the archive', () => {
    expect(clampToSpan(start - DAY_MS * 400, start, stop)).toBe(start);
    expect(clampToSpan(stop + DAY_MS * 400, start, stop)).toBe(stop);
    expect(clampToSpan(start + DAY_MS, start, stop)).toBe(start + DAY_MS);
  });

  it('leaves a degenerate span alone rather than collapsing it', () => {
    expect(clampToSpan(1234, 5, 5)).toBe(1234);
    expect(clampToSpan(NaN, start, stop)).toBe(start);
  });
});

describe('memoriesInWindow', () => {
  const at = (id: string, iso: string) => ({ id, timeMs: Date.parse(iso) });
  const memories = [
    at('a', '2016-03-01T00:00:00Z'),
    at('b', '2018-06-18T09:00:00Z'),
    at('c', '2018-06-21T18:00:00Z'),
    // Positioned relative to MEMORY_WINDOW_MS rather than to a hardcoded number
    // of days: the window is a tuned product value (see its justification in
    // skyTime.ts) and these fixtures drifted out of step with it once already.
    at('d', '2018-06-27T23:00:00Z'), // 6.5 days after the centre — inside
    at('e', '2018-07-05T00:00:00Z'), // 13.5 days after — also inside at ±30d
    at('f', '2021-11-02T00:00:00Z'),
  ];

  it('keeps only what happened around the instant, in order', () => {
    const inside = memoriesInWindow(memories, ANCHOR);
    // Everything within MEMORY_WINDOW_MS of the anchor, chronologically.
    expect(inside.map((m) => m.id)).toEqual(['b', 'c', 'd', 'e']);
    // and the far-flung ones stay out
    expect(inside.map((m) => m.id)).not.toContain('a');
    expect(inside.map((m) => m.id)).not.toContain('f');
  });

  it('includes the exact edges of the window', () => {
    const edge = [
      at('early', new Date(ANCHOR - MEMORY_WINDOW_MS).toISOString()),
      at('late', new Date(ANCHOR + MEMORY_WINDOW_MS).toISOString()),
      at('past', new Date(ANCHOR + MEMORY_WINDOW_MS + 1000).toISOString()),
    ];
    expect(memoriesInWindow(edge, ANCHOR).map((m) => m.id)).toEqual(['early', 'late']);
  });

  it('narrows and widens with the window', () => {
    expect(memoriesInWindow(memories, ANCHOR, DAY_MS).map((m) => m.id)).toEqual(['c']);
    expect(memoriesInWindow(memories, ANCHOR, 4000 * DAY_MS)).toHaveLength(6);
  });

  it('shows everything when there is no instant to centre on', () => {
    expect(memoriesInWindow(memories, NaN)).toHaveLength(6);
  });
});

describe('the sun', () => {
  it('is over the tropic of Cancer at the June solstice', () => {
    const { lat, lon } = subsolarPoint(ANCHOR);
    expect(lat).toBeGreaterThan(23.2);
    expect(lat).toBeLessThan(23.6);
    // Noon UTC puts it on the Greenwich meridian, give or take the equation of
    // time (a couple of minutes at the solstice).
    expect(Math.abs(lon)).toBeLessThan(1.5);
  });

  it('is over the tropic of Capricorn at the December solstice', () => {
    expect(subsolarPoint(Date.UTC(2018, 11, 21, 12, 0, 0)).lat).toBeCloseTo(-23.4, 0);
  });

  it('crosses the equator at the equinoxes', () => {
    expect(Math.abs(subsolarPoint(Date.UTC(2018, 2, 20, 16, 15, 0)).lat)).toBeLessThan(0.4);
    expect(Math.abs(subsolarPoint(Date.UTC(2018, 8, 23, 1, 54, 0)).lat)).toBeLessThan(0.4);
  });

  it('travels 15° of longitude an hour, westward', () => {
    const a = subsolarPoint(ANCHOR).lon;
    const b = subsolarPoint(ANCHOR + 3 * HOUR).lon;
    expect(wrapAngle(((b - a) * Math.PI) / 180) * (180 / Math.PI)).toBeCloseTo(-45, 0);
  });

  it('gives a unit ECEF direction that agrees with the subsolar point', () => {
    const dir = sunDirectionEarth(ANCHOR, new Vector3());
    expect(dir.length()).toBeCloseTo(1, 9);
    const { lat, lon } = subsolarPoint(ANCHOR);
    expect((Math.asin(dir.z) * 180) / Math.PI).toBeCloseTo(lat, 6);
    expect((Math.atan2(dir.y, dir.x) * 180) / Math.PI).toBeCloseTo(lon, 6);
  });

  it('carries the day round once every 24 hours', () => {
    const a = sunDirectionEarth(ANCHOR, new Vector3());
    const b = sunDirectionEarth(ANCHOR + 12 * HOUR, new Vector3());
    // Half a day puts the sun over the far side: the equatorial components flip.
    expect(a.x * b.x + a.y * b.y).toBeLessThan(0);
  });
});

describe('measuring the drag about the earth s axis', () => {
  it('builds a right-handed basis for any axis', () => {
    for (const axis of [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0.3, -0.8, 0.5)]) {
      const u = new Vector3();
      const v = new Vector3();
      orthonormalBasis(axis, u, v);
      const a = axis.clone().normalize();
      expect(u.length()).toBeCloseTo(1, 9);
      expect(v.length()).toBeCloseTo(1, 9);
      expect(u.dot(a)).toBeCloseTo(0, 9);
      expect(v.dot(a)).toBeCloseTo(0, 9);
      expect(u.clone().cross(v).dot(a)).toBeCloseTo(1, 9);
    }
  });

  it('reports a rotation about that axis as an equal change in angle', () => {
    // A tilted pole, because the globe is never upright for long.
    const axis = new Vector3(0.2, 0.9, -0.35).normalize();
    const u = new Vector3();
    const v = new Vector3();
    orthonormalBasis(axis, u, v);

    const hand = new Vector3(1, 0.4, -0.6).normalize();
    const before = angleAround(hand, u, v);
    const turned = hand.clone().applyQuaternion(new Quaternion().setFromAxisAngle(axis, 0.7));
    expect(wrapAngle(angleAround(turned, u, v) - before)).toBeCloseTo(0.7, 9);
  });

  it('drives a drag end-to-end: a hand swept about the pole moves the clock', () => {
    const axis = new Vector3(0, 0, 1);
    const u = new Vector3();
    const v = new Vector3();
    orthonormalBasis(axis, u, v);

    const hand = new Vector3(0.9, 0.1, 0.42).normalize();
    const drag = beginSkyDrag(ANCHOR, angleAround(hand, u, v));
    // Sixteen small steps the sun's way — a half turn, so twelve hours.
    for (let i = 1; i <= 16; i++) {
      const turned = hand.clone().applyQuaternion(new Quaternion().setFromAxisAngle(axis, (-Math.PI * i) / 16));
      advanceSkyDrag(drag, angleAround(turned, u, v));
    }
    expect(skyDragTime(drag) - ANCHOR).toBeCloseTo(12 * HOUR, 0);
  });
});
