import type { Camera } from '@companion-atlas/story';
import type { MeasureUnits } from './measure.js';

/**
 * "Capture this view" — the pure half.
 *
 * Cesium's camera and the canonical `Camera` disagree about units, and the
 * disagreement is invisible: both are plain numbers, both are called `heading`,
 * and a story written with radians renders as a camera pointing somewhere
 * plausible but wrong. So the conversion lives in one tested function rather
 * than inline at the call site.
 *
 *   Cesium                              canonical `Camera`
 *   ------------------------------      ------------------------------
 *   camera.positionCartographic         lon / lat / height
 *     .longitude / .latitude  RADIANS   DEGREES
 *     .height                 METRES    metres (ellipsoid), unchanged
 *   camera.heading            RADIANS   DEGREES, 0 = north, clockwise
 *   camera.pitch              RADIANS   DEGREES, negative = looking down
 *   camera.roll               RADIANS   DEGREES
 *
 * The unit choice is not arbitrary and is not ours to change: the fixtures in
 * `packages/story-schema/test/fixtures` carry `"heading": 200, "pitch": -35`,
 * and KML's `<LookAt>` — which `kml-export.ts` has to produce — is defined in
 * degrees. Radians in a story would round-trip through KML as a camera pointing
 * three degrees off north.
 *
 * Pitch keeps Cesium's sign convention, which happens to match KML's `<tilt>`
 * inverted: Cesium's -90° (straight down) is KML's tilt 0. That conversion
 * belongs to the exporter, not here — this module's job is to state the pose in
 * the schema's units and nothing more.
 */

/** A camera pose in Cesium's units. The one shape this module converts. */
export interface CameraPose {
  /** Radians. */
  longitude: number;
  /** Radians. */
  latitude: number;
  /** Metres above the ellipsoid. */
  height: number;
  /** Radians. */
  heading: number;
  /** Radians. */
  pitch: number;
  /** Radians. */
  roll: number;
}

const DEG = 180 / Math.PI;

/**
 * Rounding, so a captured camera is a value a human can read and a diff can
 * show.
 *
 * Cesium's camera is a float64 pose recomputed every frame; capturing it raw
 * gives `-21.942617893471268`, and two captures of what looks like the same
 * view differ in the eleventh decimal. Seven decimal places of longitude is
 * about 1 cm — far finer than a camera pose means anything at — and it makes
 * "did this scene's camera change?" answerable by eye and by `===`.
 */
const LONLAT_DP = 7;
const ANGLE_DP = 2;
const HEIGHT_DP = 1;

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  // `+ 0` collapses `-0`, which JSON.stringify writes as `-0` and which then
  // fails a naive equality check against a re-captured `0`.
  return Math.round(n * f) / f + 0;
};

/** Fold heading into [0, 360). Cesium reports it in [0, 2π) already, but a pose
 *  assembled by hand (a test, an XR controller) may not have. */
export function normalizeHeadingDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Clamp pitch to the range a camera can actually hold. Beyond ±90 the pose is
 *  a gimbal flip, and Cesium's `setView` silently reinterprets it as a
 *  different orientation — a scene that "looks up" would fly to a view facing
 *  backwards. */
export function clampPitchDeg(deg: number): number {
  if (!Number.isFinite(deg)) return -45;
  return Math.max(-90, Math.min(90, deg));
}

/**
 * A Cesium camera pose → a canonical `Camera`.
 *
 * Returns `null` rather than a broken value when the pose is not finite. That
 * happens for real: reading the camera during the first frame, or while a
 * `flyTo` is mid-flight and the position has not yet been resolved against
 * terrain, yields NaN, and a `Camera` with a NaN longitude fails `Camera`'s own
 * `refine` ("camera needs a location") only if lon/lat are *missing* — NaN
 * passes the check and lands in the story, where it renders as a black screen.
 */
export function cameraFromPose(
  pose: CameraPose,
  opts: { durationMs?: number; range?: number } = {},
): Camera | null {
  const { longitude, latitude, height, heading, pitch, roll } = pose;
  if (![longitude, latitude, height, heading, pitch, roll].every((n) => Number.isFinite(n))) return null;

  const camera: Camera = {
    lon: round(longitude * DEG, LONLAT_DP),
    lat: round(latitude * DEG, LONLAT_DP),
    height: round(height, HEIGHT_DP),
    heading: round(normalizeHeadingDeg(heading * DEG), ANGLE_DP),
    pitch: round(clampPitchDeg(pitch * DEG), ANGLE_DP),
    roll: round(roll * DEG, ANGLE_DP),
  };
  if (Number.isFinite(opts.range)) camera.range = round(opts.range as number, HEIGHT_DP);
  if (Number.isFinite(opts.durationMs)) camera.durationMs = Math.max(0, Math.round(opts.durationMs as number));
  return camera;
}

/**
 * The inverse: a canonical `Camera` → a Cesium pose, for flying back to it.
 *
 * Accepts both spellings the schema allows — the Earth-2 flat form
 * (`lon`/`lat`/`height`) and the Atlas nested form (`location` + `range`) —
 * because a story can carry either and a "fly to this scene" that only
 * understood one would silently do nothing on half the corpus.
 *
 * Defaults matter here. A `Camera` may legally carry only `lon`/`lat`: with no
 * height the camera would be placed *at the ellipsoid surface*, inside the
 * terrain, and the user would see the inside of a mountain. 1.8e6 m is the
 * framing `AtlasApp.flyTo` already uses for a memory, so a camera-less scene
 * and a height-less camera land the same way.
 */
export function poseFromCamera(camera: Camera | null | undefined): CameraPose | null {
  if (!camera) return null;
  const loc = camera.location;
  const lon = loc?.lon ?? camera.lon;
  const lat = loc?.lat ?? camera.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const height = loc?.height ?? camera.height ?? camera.range ?? DEFAULT_HEIGHT_M;
  return {
    longitude: (lon as number) / DEG,
    latitude: (lat as number) / DEG,
    height: Number.isFinite(height) ? (height as number) : DEFAULT_HEIGHT_M,
    heading: normalizeHeadingDeg(camera.heading ?? 0) / DEG,
    pitch: clampPitchDeg(camera.pitch ?? -90) / DEG,
    roll: (camera.roll ?? 0) / DEG,
  };
}

/** The framing `AtlasApp.flyTo` uses for a memory, reused so a story with no
 *  camera height does not put the viewer underground. */
export const DEFAULT_HEIGHT_M = 1_800_000;

/**
 * A one-line human summary of a captured camera, for the toolbar's
 * confirmation. Degrees with a compass letter, because "heading 287.4" tells
 * nobody anything and "WNW" tells them where they were looking.
 *
 * `units` because this line shares a panel with the measurement readout and the
 * metric/imperial toggle. It used to hard-code metres and kilometres, so an
 * author who picked Imperial got "Measured 3280 ft" and, three rows above it,
 * "Captured · … · 850 m" — two unit systems in one panel, with the switch they
 * had just pressed visibly unable to reach the second one.
 */
export function describeCamera(camera: Camera | null, units: MeasureUnits = 'metric'): string {
  if (!camera) return 'No view to capture yet';
  const lon = camera.location?.lon ?? camera.lon ?? 0;
  const lat = camera.location?.lat ?? camera.lat ?? 0;
  const h = camera.location?.height ?? camera.height ?? 0;
  return `${lat.toFixed(4)}, ${lon.toFixed(4)} · ${formatAltitude(h, units)} · ${compass(camera.heading ?? 0)}`;
}

/**
 * Altitude, in the units the panel is set to.
 *
 * Deliberately NOT `formatLength`: that one is for a measured distance along the
 * ground and switches to kilometres at 1 km, which would print a camera 1.8 km
 * up as "1.80 km" where the existing readout says "1800 m". The rung here stays
 * where it was (10 km) so an altitude a user recognises does not change format
 * under them; only the *unit system* is new.
 */
function formatAltitude(metres: number, units: MeasureUnits): string {
  if (units === 'imperial') {
    const feet = Math.round(metres / METRES_PER_FOOT);
    return feet >= 10_000 ? `${Math.round(feet / FEET_PER_MILE)} mi` : `${feet} ft`;
  }
  return metres >= 10_000 ? `${Math.round(metres / 1000)} km` : `${Math.round(metres)} m`;
}

const METRES_PER_FOOT = 0.3048;
const FEET_PER_MILE = 5280;

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Degrees → a 16-point compass label. */
export function compass(headingDeg: number): string {
  const d = normalizeHeadingDeg(headingDeg);
  return POINTS[Math.round(d / 22.5) % 16]!;
}
