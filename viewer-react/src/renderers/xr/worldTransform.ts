/**
 * The transform between Earth space and player space — the whole basis of the
 * immersive globe.
 *
 * Google Earth VR's central trick is that the *world* moves, not the person.
 * The player never leaves the origin of their room-scale reference space; every
 * "flight" is a change to a single transform applied to the planet. That is not
 * just an interaction style, it is what makes planet-scale rendering survive
 * WebXR at all:
 *
 *  - **Precision.** WebXR poses and GPU vertex maths are float32, which has ~7
 *    decimal digits. An ECEF coordinate is ~6.4e6 m, so a float32 there resolves
 *    to roughly half a metre — street level jitters visibly. Keeping the player
 *    at the origin means the *model-view* matrix (the only thing downcast to
 *    float32 on its way to the GPU) always has a small translation, because the
 *    ground under the viewer is always near the scene origin. All of the large
 *    numbers stay in `Matrix4`/`Vector3`, which are float64 in JS.
 *  - **Depth.** Near/far are chosen in player metres, so a globe held at arm's
 *    length and a street seen from head height both get a sane depth range
 *    without a logarithmic depth buffer.
 *
 * Everything here is pure — no three.js scene, no React — so the grab maths can
 * be unit-tested without a headset or a GPU (see `test/xr-world-transform.test.ts`).
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer/three';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** WGS84 equatorial radius, metres. Shared with the tiles renderer's ellipsoid. */
export const EARTH_RADIUS_M = WGS84_ELLIPSOID.radius.x;

export interface WorldTransform {
  /** Where the Earth's centre sits, in player space. */
  position: Vector3;
  /** Earth space → player space rotation. */
  quaternion: Quaternion;
  /** Player metres per Earth metre. 1 is life size; ~1e-7 is a globe in your hands. */
  scale: number;
}

/** A tracked hand or controller, in player space. */
export interface GrabPose {
  position: Vector3;
  quaternion: Quaternion;
}

// Module-level scratch. These functions run every frame, sometimes twice per
// frame per input source, and allocating Vector3s there is how an XR app starts
// dropping frames to GC.
const _m = new Matrix4();
const _m2 = new Matrix4();
const _v = new Vector3();
const _v2 = new Vector3();
const _e = new Vector3();
const _n = new Vector3();
const _u = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _cart = { lat: 0, lon: 0, height: 0 };

/**
 * Where the Earth sits when a session starts.
 *
 * Scale 1e-7 makes a globe ~1.3 m across — a body-scale object you can reach
 * around, which is the Google Earth VR framing. The position is the part that
 * matters and was wrong: leaving it at the origin centres that globe on the
 * player's own floor position, so it sits *between their feet*. The camera
 * starts at eye height looking level, and the top of the globe is barely knee
 * high, so an immersive session opened on an empty black room — the Earth was
 * there the whole time, 55 degrees below the view direction. Verified in an
 * emulated Quest 3 session: pitching the headset down brought it into frame.
 *
 * It now starts in front of the player at chest height, where a globe on a
 * stand would be — visible immediately, and within arm's reach for the grab
 * locomotion that is the whole interaction model.
 */
export function createWorldTransform(): WorldTransform {
  return {
    position: new Vector3(0, EYE_HEIGHT_M - 0.5, -GLOBE_DISTANCE_M),
    quaternion: new Quaternion(),
    scale: 1e-7,
  };
}

/** Standing eye height of the WebXR `local-floor` reference space, metres. */
const EYE_HEIGHT_M = 1.6;
/** How far in front of the player the globe floats, metres. */
const GLOBE_DISTANCE_M = 1.6;

export function copyWorldTransform(from: WorldTransform, to: WorldTransform): WorldTransform {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  to.scale = from.scale;
  return to;
}

/** Compose the transform into a `Matrix4` (Earth space → player space). */
export function toMatrix(t: WorldTransform, target: Matrix4): Matrix4 {
  return target.compose(t.position, t.quaternion, _s.setScalar(t.scale));
}

/** Read a `Matrix4` back into the transform. Assumes uniform scale. */
export function fromMatrix(m: Matrix4, t: WorldTransform): WorldTransform {
  m.decompose(t.position, t.quaternion, _s);
  t.scale = _s.x;
  // decompose() leaves a quaternion that has accumulated float error over many
  // frames of grabbing; renormalising here keeps it from slowly shearing.
  t.quaternion.normalize();
  return t;
}

/** ECEF metres → player space. */
export function earthToPlayer(t: WorldTransform, earth: Vector3, target: Vector3): Vector3 {
  return target.copy(earth).multiplyScalar(t.scale).applyQuaternion(t.quaternion).add(t.position);
}

/** Player space → ECEF metres. */
export function playerToEarth(t: WorldTransform, player: Vector3, target: Vector3): Vector3 {
  return target
    .copy(player)
    .sub(t.position)
    .applyQuaternion(_q.copy(t.quaternion).invert())
    .divideScalar(t.scale);
}

/** WGS84 degrees → ECEF metres, in the tiles renderer's frame (Z through the poles). */
export function geodeticToEarth(latDeg: number, lonDeg: number, height: number, target: Vector3): Vector3 {
  return WGS84_ELLIPSOID.getCartographicToPosition(latDeg * DEG2RAD, lonDeg * DEG2RAD, height, target);
}

/** ECEF metres → WGS84 degrees + ellipsoidal height. */
export function earthToGeodetic(earth: Vector3): { lat: number; lon: number; height: number } {
  WGS84_ELLIPSOID.getPositionToCartographic(earth, _cart);
  return { lat: _cart.lat * RAD2DEG, lon: _cart.lon * RAD2DEG, height: _cart.height };
}

/** Height above the ellipsoid, in Earth metres, of a point given in player space. */
export function playerHeight(t: WorldTransform, player: Vector3): number {
  playerToEarth(t, player, _v);
  return WGS84_ELLIPSOID.getPositionElevation(_v);
}

/**
 * Point the transform so that `lat`/`lon` faces `facing`, with the Earth's
 * centre placed at `centre` and drawn at `radius` player metres.
 *
 * This is the "globe on a table" framing the experience opens with: the
 * memories the person actually has are turned towards them, rather than
 * whatever hemisphere the identity orientation happens to show.
 */
export function frameGlobe(
  t: WorldTransform,
  opts: { lat: number; lon: number; centre: Vector3; facing: Vector3; radius: number },
): WorldTransform {
  const up = _v.copy(opts.facing).sub(opts.centre);
  if (up.lengthSq() < 1e-12) up.set(0, 0, 1);
  up.normalize();

  // North should read as "up the screen" as far as the framing allows, so take
  // world +Y and project out the part along the view axis. Looking down a pole
  // makes that degenerate, and any perpendicular will do there.
  const north = _v2.set(0, 1, 0).addScaledVector(up, -up.y);
  if (north.lengthSq() < 1e-6) north.set(0, 0, -1).addScaledVector(up, up.z);
  north.normalize();

  setOrientation(t, opts.lat, opts.lon, north, up);
  t.scale = opts.radius / EARTH_RADIUS_M;
  t.position.copy(opts.centre);
  return t;
}

/**
 * Stand the player on the ground at `lat`/`lon`: local up becomes player +Y and
 * `headingDeg` (0 = north) becomes the direction they are facing.
 */
export function frameSurface(
  t: WorldTransform,
  opts: { lat: number; lon: number; height?: number; at: Vector3; headingDeg?: number; scale?: number },
): WorldTransform {
  const heading = (opts.headingDeg ?? 0) * DEG2RAD;
  // Heading 0 faces -Z (the direction a seated user looks), increasing eastward.
  const north = _v2.set(Math.sin(heading), 0, -Math.cos(heading));
  setOrientation(t, opts.lat, opts.lon, north, _v.set(0, 1, 0));
  t.scale = opts.scale ?? 1;
  // Put the anchor point itself at `at`, rather than the Earth's centre.
  geodeticToEarth(opts.lat, opts.lon, opts.height ?? 0, _u);
  _u.multiplyScalar(t.scale).applyQuaternion(t.quaternion);
  t.position.copy(opts.at).sub(_u);
  return t;
}

/**
 * Rotate the transform so the east/north/up frame at `lat`/`lon` lines up with
 * the given player-space north and up. East is derived (north × up) so the
 * basis stays right-handed even if the caller's vectors are not exactly
 * perpendicular.
 */
function setOrientation(t: WorldTransform, lat: number, lon: number, north: Vector3, up: Vector3): void {
  WGS84_ELLIPSOID.getEastNorthUpAxes(lat * DEG2RAD, lon * DEG2RAD, _e, _n, _u);
  _m.makeBasis(_e, _n, _u).transpose(); // orthonormal, so transpose == inverse

  const dstUp = up.clone().normalize();
  const dstNorth = north.clone().addScaledVector(dstUp, -north.dot(dstUp)).normalize();
  const dstEast = dstNorth.clone().cross(dstUp).normalize();
  _m2.makeBasis(dstEast, dstNorth, dstUp);

  t.quaternion.setFromRotationMatrix(_m2.multiply(_m)).normalize();
}

/**
 * Build the frame a grab is measured against.
 *
 * One hand gives a rigid frame: the world sticks to the controller, so dragging
 * translates and twisting rotates. Two hands add the scale term for free — the
 * frame's position is the midpoint, its X axis runs hand-to-hand, and its
 * uniform scale is the distance between them. Feeding both cases through the
 * same `Matrix4` is what makes "pull your hands apart to zoom" fall out of the
 * same three lines as "drag with one hand".
 *
 * Returns `false` when there is nothing to grab with.
 *
 * `lockRoll` takes the roll term out: see the comment on the `up` vector below
 * for why that is a comfort setting rather than a taste one.
 */
export function grabFrame(hands: readonly GrabPose[], target: Matrix4, lockRoll = false): boolean {
  if (hands.length === 0) return false;
  if (hands.length === 1) {
    target.compose(hands[0]!.position, hands[0]!.quaternion, _s.setScalar(1));
    return true;
  }

  const a = hands[0]!;
  const b = hands[1]!;
  const span = _v.copy(b.position).sub(a.position);
  const distance = span.length();
  // Hands together is a singular frame; treat it as a one-handed grab so the
  // world does not explode as the span crosses zero.
  if (distance < 1e-4) {
    target.compose(a.position, a.quaternion, _s.setScalar(1));
    return true;
  }

  const east = span.divideScalar(distance);
  // Roll about the hand-to-hand axis comes from the average of the two grips,
  // so rolling both wrists rolls the world (as it does in Earth VR).
  //
  // Earth VR can afford that because the viewer is always standing on
  // something: the horizon it rolls is one they can put their feet back on.
  // Atlas has no such invariant — the same wrists roll a planet held at arm's
  // length — and an unbidden horizon roll has no vestibular counterpart at all,
  // which is why `lockRoll` (on by default) takes the wrists out of it and
  // keeps player +Y as up.
  const up = _v2.set(0, 1, 0);
  if (!lockRoll) up.applyQuaternion(_q.copy(a.quaternion).slerp(b.quaternion, 0.5));
  up.addScaledVector(east, -up.dot(east));
  if (up.lengthSq() < 1e-6) {
    // Hands stacked vertically, so +Y *is* the grab axis. Fall back to another
    // axis: re-projecting +Y (what this used to do) is the same degenerate
    // vector again, and a zero-length up makes the basis — and with it the
    // world — flip about wherever the hands happen to be.
    up.set(0, 0, 1).addScaledVector(east, -east.z);
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(east, -east.x);
  }
  up.normalize();
  const north = _u.copy(east).cross(up).multiplyScalar(-1);

  _m2.makeBasis(east, north, up);
  _q.setFromRotationMatrix(_m2);
  target.compose(_v.copy(a.position).add(b.position).multiplyScalar(0.5), _q, _s.setScalar(distance));
  return true;
}

/**
 * Apply one frame of grabbing: whatever rigid-plus-scale motion took the grab
 * frame from `grabStart` to `grabNow` is applied to the world as it stood when
 * the grab began.
 *
 * Deriving from the *start* rather than integrating per-frame deltas matters:
 * an integrated version accumulates rounding every frame, so a long slow drag
 * ends up somewhere the hands never went, and releasing and re-grabbing is the
 * only way to get the world square again.
 */
export function applyGrab(
  t: WorldTransform,
  worldStart: Matrix4,
  grabStart: Matrix4,
  grabNow: Matrix4,
): WorldTransform {
  _m.copy(grabStart).invert().premultiply(grabNow).multiply(worldStart);
  return fromMatrix(_m, t);
}

/**
 * Change scale while holding one player-space point over the same place on
 * Earth — the pivot the zoom happens around (the point between the hands, or
 * whatever is under the mouse).
 */
export function setScaleAbout(t: WorldTransform, scale: number, pivot: Vector3): WorldTransform {
  playerToEarth(t, pivot, _v);
  t.scale = scale;
  earthToPlayer(t, _v, _v2);
  t.position.add(_v.copy(pivot).sub(_v2));
  return t;
}

/**
 * One-handed grab as a trackball spin about the globe's own centre.
 *
 * `applyGrab` applies the hand's rigid delta, which is the right model when the
 * player is *inside* the world — drag and you pull yourself across the surface,
 * the Google Earth VR flying idiom. It is the wrong one when the whole planet
 * is a graspable object in front of you: dragging then shoves the globe
 * sideways and it never comes back. Measured in an emulated session, three
 * ordinary drags walked the centre from 1.33 m to 1.71 m from the head, with
 * the rotation untouched the whole time — a few more and the globe is out of
 * arm's reach and can no longer be grabbed at all.
 *
 * At object scale the hand therefore spins the planet instead: the rotation
 * that carries the grab-start direction (centre → hand) onto the current one,
 * applied about the centre, which stays put. That is a desk globe, and it is
 * what "grab the world and drag it" means when the world fits between your
 * hands.
 */
export function applyOrbitGrab(
  t: WorldTransform,
  worldStart: WorldTransform,
  centre: Vector3,
  grabStart: Vector3,
  grabNow: Vector3,
): WorldTransform {
  _e.copy(grabStart).sub(centre);
  _n.copy(grabNow).sub(centre);
  if (_e.lengthSq() < 1e-8 || _n.lengthSq() < 1e-8) return t;
  _e.normalize();
  _n.normalize();

  // setFromUnitVectors handles the antiparallel case; guard only the identity.
  _q.setFromUnitVectors(_e, _n);

  t.scale = worldStart.scale;
  t.position.copy(centre);
  t.quaternion.copy(worldStart.quaternion).premultiply(_q).normalize();
  return t;
}

/** Spin the world about a player-space axis through a player-space pivot. */
export function rotateAbout(t: WorldTransform, pivot: Vector3, axis: Vector3, angle: number): WorldTransform {
  _q.setFromAxisAngle(axis, angle);
  t.quaternion.premultiply(_q).normalize();
  // `pivot` is allowed to be `t.position` (the flat-window trackball uses the
  // globe's own centre). Copy it before mutating `t.position`; otherwise
  // `sub(pivot)` also zeros the pivot and the final `add(pivot)` cannot restore
  // the centre, sending the globe to the origin after the first drag.
  _v2.copy(pivot);
  t.position.sub(_v2).applyQuaternion(_q).add(_v2);
  return t;
}

export interface WorldLimits {
  /** Smallest allowed scale — how far out you may zoom (the whole planet). */
  minScale: number;
  /** Largest allowed scale — 1 is life size. */
  maxScale: number;
  /** Closest the viewer may get to the ellipsoid, in Earth metres. */
  minHeight: number;
}

export const DEFAULT_LIMITS: WorldLimits = {
  // 6.4e6 m * 3e-9 ≈ 2 cm: the planet as a marble, which is about as far as the
  // framing stays legible.
  minScale: 3e-9,
  maxScale: 1.5,
  // Two metres above the ellipsoid — standing height, and low enough that a
  // rooftop-level view still works.
  minHeight: 2,
};

/**
 * Keep a grab inside the limits. Applied after every manipulation, so the same
 * rules hold whether the motion came from controllers, a mouse or a fly-to.
 *
 * `head` is the viewer's position in player space; without the height clamp a
 * two-handed zoom drops the viewer straight through the planet, which in a
 * headset is both disorienting and unrecoverable (there is no "up" to grab).
 */
export function clampWorld(t: WorldTransform, head: Vector3, limits: WorldLimits, pivot?: Vector3): WorldTransform {
  const scale = Math.min(limits.maxScale, Math.max(limits.minScale, t.scale));
  if (scale !== t.scale) setScaleAbout(t, scale, pivot ?? head);

  playerToEarth(t, head, _v);
  const height = WGS84_ELLIPSOID.getPositionElevation(_v);
  if (height < limits.minHeight) {
    WGS84_ELLIPSOID.getPositionToNormal(_v, _v2);
    _v2.applyQuaternion(t.quaternion); // local up, in player space
    t.position.addScaledVector(_v2, -(limits.minHeight - height) * t.scale);
  }
  return t;
}

/**
 * The depth range to use from where the viewer currently is, in player metres.
 *
 * Planet scale and human scale in one scene is the classic depth-buffer killer,
 * and the scaffold's `near: 1, far: 1e13` is the shape of it. Rather than reach
 * for a logarithmic depth buffer (which costs fill rate and interacts badly
 * with WebXR's per-eye projections), derive the range from where the viewer
 * actually is.
 *
 * `far` is the horizon: past the tangent point nothing on the planet is
 * visible, whatever the altitude, so twice that always covers the visible limb
 * — 13 m while holding the globe, ~10 km standing on a street.
 *
 * `near` is the one that has to be right. Depth precision goes as z²/near, so a
 * near plane pinned at 2 cm makes terrain a kilometre away fight with itself;
 * but a near plane chosen for the terrain clips the viewer's own hands, which
 * live 30–60 cm from the head. Tracking altitude and capping at 10 cm keeps
 * both true.
 */
export function depthRange(t: WorldTransform, head: Vector3): { near: number; far: number } {
  const height = Math.max(0, playerHeight(t, head)) * t.scale; // player metres above ground
  const radius = EARTH_RADIUS_M * t.scale;
  const horizon = Math.sqrt(Math.max(0, 2 * radius * height + height * height));
  const near = Math.min(Math.max(height * 0.05, 0.02), 0.1);
  // `head.length()` keeps the globe in view even when it has been pushed off to
  // one side; the constant covers the in-scene UI panels, which sit in player
  // space a couple of metres out.
  return { near, far: Math.max(2 * horizon + head.length() + 10, near * 64) };
}
