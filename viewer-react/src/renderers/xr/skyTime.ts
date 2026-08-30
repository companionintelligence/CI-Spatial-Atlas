/**
 * Time as the second axis of the immersive globe — the maths only.
 *
 * The gesture this serves is Google Earth VR's: hold your hand up against the
 * sky, close it, and drag. The sun follows your hand, so the time of day
 * follows it too; keep dragging past a full revolution and the date steps. It
 * beats a floating slider because the thing being manipulated is visible and
 * already in the scene — you are moving the sun, not a widget that stands for
 * the sun.
 *
 * Everything here is pure, because the parts that are easy to get wrong are all
 * arithmetic: unwrapping an angle across the ±π seam, keeping a drag reversible,
 * and putting the sun where it actually was on a Tuesday in 2017. The scene
 * plumbing (which hand, which frame, what to draw) lives in `SkyGrab.tsx`.
 */
import { Vector3 } from 'three';

export const DAY_MS = 86_400_000;
export const TAU = Math.PI * 2;

/**
 * How much archive time one full revolution of the sky covers.
 *
 * One hand is the day gear — a revolution is a day, which is what makes the
 * overload read as "the sun went all the way round, so it is tomorrow". Two
 * hands is the year gear, borrowing the idiom the globe grab already
 * establishes (one hand turns the planet, two hands do the big operation), so
 * eight years of archive is reachable without 2,900 revolutions.
 */
export const TURN_DAY_MS = DAY_MS;
export const TURN_YEAR_MS = 365 * DAY_MS;

/**
 * Half-width of the window of memories shown around the active instant.
 *
 * Measured against the real archive (290 located memories over 6.8 years)
 * rather than guessed. Sampling every day of the span and counting what falls
 * inside the window:
 *
 *   ±7 days   56% of days show nothing,  1.6 pins on an average day
 *   ±14 days  43% show nothing,          3.3
 *   ±30 days  32% show nothing,          7.0   ← this
 *   ±90 days  20% show nothing,         20.7
 *
 * A fifth of days have nothing within three months of them, so no window makes
 * the globe never-empty — a life has gaps in it. ±30 days is where a typical
 * day is a handful of pins you can actually read rather than one lonely dot,
 * without widening so far that "then" stops meaning anything.
 */
export const MEMORY_WINDOW_MS = 30 * DAY_MS;

const _axis = new Vector3();
const _seed = new Vector3();

/** Fold an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const x = (a + Math.PI) % TAU;
  return (x <= 0 ? x + TAU : x) - Math.PI;
}

/**
 * A right-handed basis (u, v) spanning the plane perpendicular to `axis`.
 *
 * The drag is measured about the Earth's own spin axis rather than about the
 * player's vertical, because that is the axis the sun actually travels around:
 * measure in any other plane and the sun slides out from under the hand as soon
 * as the globe is tipped. `axis` need not be normalised; `u` and `v` come back
 * unit-length with `u × v = axis`.
 */
export function orthonormalBasis(axis: Vector3, u: Vector3, v: Vector3): void {
  const a = _axis.copy(axis).normalize();
  // Seed from whichever cardinal is least parallel to the axis, so the cross
  // product never collapses when the pole happens to point at the player's up.
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const seed = ax <= ay && ax <= az ? _seed.set(1, 0, 0) : ay <= az ? _seed.set(0, 1, 0) : _seed.set(0, 0, 1);
  u.copy(seed).cross(a).normalize();
  v.copy(a).cross(u).normalize();
}

/** Where `dir` sits in the (u, v) plane, as an angle about their shared axis. */
export function angleAround(dir: Vector3, u: Vector3, v: Vector3): number {
  return Math.atan2(dir.dot(v), dir.dot(u));
}

export interface SkyDrag {
  /** The instant the drag started from — the origin every offset is measured from. */
  anchorMs: number;
  /** Last raw angle, kept so the next sample can be unwrapped against it. */
  lastAngle: number;
  /**
   * Signed angle accumulated since the anchor, unwrapped, so it keeps growing
   * past ±π instead of snapping back. This is the whole reason a drag can pass
   * a revolution at all.
   */
  angle: number;
  /** Archive time covered by one full revolution (see TURN_DAY_MS). */
  msPerTurn: number;
}

export function beginSkyDrag(anchorMs: number, angle: number, msPerTurn = TURN_DAY_MS): SkyDrag {
  return { anchorMs, lastAngle: angle, angle: 0, msPerTurn };
}

/**
 * Fold one new sample into the drag. Mutates and returns the same object: this
 * runs once per hand per frame at headset framerate, and the alternative is a
 * fresh object 90 times a second for the GC to collect mid-session.
 */
export function advanceSkyDrag(drag: SkyDrag, angle: number): SkyDrag {
  drag.angle += wrapAngle(angle - drag.lastAngle);
  drag.lastAngle = angle;
  return drag;
}

/**
 * Revolutions the sky has been dragged through, signed.
 *
 * Negated, and that sign is the physics rather than a preference: advancing
 * time spins the Earth eastward, which carries the sun *backwards* around the
 * pole in the player's view. Dragging the sky the way the sun appears to
 * travel — westward, a negative angle about the north pole — therefore has to
 * mean "later". Without the negation the sun runs away from the hand holding
 * it, which is exactly the tell that direct manipulation has been faked.
 */
export function skyTurns(drag: SkyDrag): number {
  return -drag.angle / TAU;
}

/** The instant a drag has reached. */
export function skyDragTime(drag: SkyDrag): number {
  return drag.anchorMs + skyTurns(drag) * drag.msPerTurn;
}

/**
 * Whole revolutions completed, signed and truncated toward zero — the date
 * steps of the overload. Half a turn forward is still today; a turn and a half
 * back is yesterday, not the day before.
 */
export function skyDateSteps(drag: SkyDrag): number {
  // `|| 0` normalises the -0 that `trunc` hands back for any backward drag
  // short of a full turn. A step count of "negative zero" is nobody's idea of
  // a step count, and it leaks straight into a readout as "-0 days".
  return Math.trunc(skyTurns(drag)) || 0;
}

/** Keep a scrubbed instant inside the archive it is scrubbing. */
export function clampToSpan(ms: number, startMs: number, stopMs: number): number {
  if (!Number.isFinite(ms)) return startMs;
  if (!(stopMs > startMs)) return ms;
  return Math.min(stopMs, Math.max(startMs, ms));
}

/**
 * The memories inside the active window, chronologically.
 *
 * The VR path shows every located memory at once — 290 of them, from eight
 * different years, stacked over the same few street corners. That is the whole
 * reason the pin layer needs a hard label cap. Once time is a real axis the
 * window does the work instead: what you see is what was happening then.
 */
export function memoriesInWindow<T extends { timeMs: number }>(
  memories: readonly T[],
  centreMs: number,
  halfWindowMs = MEMORY_WINDOW_MS,
): T[] {
  if (!Number.isFinite(centreMs)) return [...memories];
  const half = Math.abs(halfWindowMs);
  return memories
    .filter((m) => Number.isFinite(m.timeMs) && Math.abs(m.timeMs - centreMs) <= half)
    .sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Where the sun is straight overhead at `ms`.
 *
 * The low-precision solar position (Astronomical Almanac's, via the usual
 * J2000 series): about a hundredth of a degree, which is several orders of
 * magnitude better than a terminator drawn on a globe you are holding in your
 * hands needs. Deliberately not Cesium's — the immersive renderer has no Cesium
 * in it (ADR-0001), and pulling one in for a sun vector would be absurd.
 */
export function subsolarPoint(ms: number): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  // Days since J2000.0. ΔT is ignored: ~70 s of it moves the subsolar point
  // 0.3 km.
  const n = ms / DAY_MS + 2440587.5 - 2451545.0;
  const meanLon = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * rad;
  const ecliptic = (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * n) * rad;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic)) / rad;
  // Greenwich mean sidereal time, in degrees.
  const gmst = (18.697374558 + 24.06570982441908 * n) * 15;

  let lon = (rightAscension - gmst) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: declination / rad, lon };
}

/**
 * Sub-lunar point — where the Moon is directly overhead at `ms`.
 *
 * A cut-down ELP: mean longitude plus the evection, the main equation of centre
 * and the variation, which is the smallest set that keeps the Moon within about
 * half a degree of truth. That is far tighter than it needs to be for a disc a
 * viewer sees against a starfield, but the cheap alternative — a circular orbit
 * — drifts by several degrees within a month, and this globe is scrubbed across
 * eight years, so the Moon would visibly detach from where it belongs relative
 * to the terminator the sun is already drawing.
 *
 * Same conventions as `subsolarPoint`: degrees, longitude wrapped to ±180.
 */
export function sublunarPoint(ms: number): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  const n = ms / DAY_MS + 2440587.5 - 2451545.0;

  const meanLon = 218.316 + 13.176396 * n;      // L'
  const meanAnomaly = (134.963 + 13.064993 * n) * rad;  // M'
  const meanDistance = (93.272 + 13.229350 * n) * rad;  // F
  const elongation = (297.850 + 12.190749 * n) * rad;   // D
  const sunAnomaly = (357.528 + 0.9856003 * n) * rad;   // M

  // Ecliptic longitude/latitude, main periodic terms only.
  const lonEcl =
    (meanLon +
      6.289 * Math.sin(meanAnomaly) +
      1.274 * Math.sin(2 * elongation - meanAnomaly) + // evection
      0.658 * Math.sin(2 * elongation) +               // variation
      -0.186 * Math.sin(sunAnomaly)) * rad;
  const latEcl = 5.128 * Math.sin(meanDistance) * rad;

  const obliquity = (23.439 - 0.0000004 * n) * rad;
  const sinLat = Math.sin(latEcl);
  const cosLat = Math.cos(latEcl);

  const declination = Math.asin(
    sinLat * Math.cos(obliquity) + cosLat * Math.sin(obliquity) * Math.sin(lonEcl),
  );
  const rightAscension =
    Math.atan2(
      Math.sin(lonEcl) * Math.cos(obliquity) - Math.tan(latEcl) * Math.sin(obliquity),
      Math.cos(lonEcl),
    ) / rad;
  const gmst = (18.697374558 + 24.06570982441908 * n) * 15;

  let lon = (rightAscension - gmst) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: declination / rad, lon };
}

/** Unit vector from the Earth's centre toward the Moon, in Earth (ECEF) space. */
export function moonDirectionEarth(ms: number, target: Vector3): Vector3 {
  const { lat, lon } = sublunarPoint(ms);
  const rad = Math.PI / 180;
  const c = Math.cos(lat * rad);
  return target.set(c * Math.cos(lon * rad), c * Math.sin(lon * rad), Math.sin(lat * rad));
}

/**
 * Illuminated fraction of the Moon's disc, 0 (new) to 1 (full).
 *
 * Derived from the sun–Moon elongation rather than a separate phase clock, so
 * the lit side always faces the sun the scene is already lighting the Earth
 * with. A moon lit from the wrong side next to a visibly day-lit planet is the
 * kind of detail that reads as wrong long before anyone works out why.
 */
export function moonIllumination(ms: number): number {
  const rad = Math.PI / 180;
  const n = ms / DAY_MS + 2440587.5 - 2451545.0;
  const elongation = (297.850 + 12.190749 * n) * rad;
  return (1 - Math.cos(elongation)) / 2;
}

/**
 * Unit vector from the Earth's centre toward the sun, in Earth (ECEF) space —
 * the same frame `worldTransform` puts the globe in, poles on Z and 0°/0° on X.
 */
export function sunDirectionEarth(ms: number, target: Vector3): Vector3 {
  const { lat, lon } = subsolarPoint(ms);
  const rad = Math.PI / 180;
  const c = Math.cos(lat * rad);
  return target.set(c * Math.cos(lon * rad), c * Math.sin(lon * rad), Math.sin(lat * rad));
}
