/**
 * Grab locomotion — the interaction Google Earth VR is built on.
 *
 * Squeeze (or pull the trigger, or pinch, with hands) and the planet is stuck to
 * your hand: move your hand and it moves, twist and it turns. Grab with both
 * hands and pulling them apart zooms, because a two-handed grab frame carries a
 * scale term. All of it is one operation — "whatever motion took the grab frame
 * from where it was to where it is, do that to the world" — which is why one
 * hand, two hands, translation, rotation and zoom need no separate modes.
 *
 * The maths lives in `worldTransform.ts` and is unit-tested; this file is the
 * plumbing that feeds it WebXR poses (and, so the same path is usable and
 * testable without a headset, mouse input).
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Matrix4, Object3D, PerspectiveCamera, Quaternion, Ray, Sphere, Vector2, Vector3 } from 'three';
import {
  applyGrab,
  applyOrbitGrab,
  fromMatrix,
  clampWorld,
  copyWorldTransform,
  createWorldTransform,
  depthRange,
  EARTH_RADIUS_M,
  grabFrame,
  rotateAbout,
  setScaleAbout,
  toMatrix,
  type GrabPose,
  type WorldLimits,
  type WorldTransform,
} from './worldTransform.js';
import {
  anyInputActive,
  createSnapTurnState,
  createWorldMotion,
  DEFAULT_COMFORT,
  measureMotion,
  rollExcess,
  SNAP_TURN_RAD,
  snapTurnTick,
  type ComfortSettings,
  type MotionSample,
  type WorldMotion,
} from './comfort.js';

/** An eased move to a new framing — what "take me to this memory" runs. */
export interface WorldFlight {
  from: WorldTransform;
  to: WorldTransform;
  /** `performance.now()` when it started. */
  start: number;
  seconds: number;
}

/** Shared, mutable handle on the globe — read every frame, never re-rendered. */
export interface WorldHandle {
  transform: WorldTransform;
  limits: WorldLimits;
  /** Player-space head position, refreshed each frame for anything that needs it. */
  head: Vector3;
  /** How many hands are currently holding the world (0, 1 or 2). */
  hands: number;
  /** In-progress fly-to, cancelled by any input at all (see `cancelFlight`). */
  flight: WorldFlight | null;
  /**
   * Pixels the mouse has travelled during the current flat-screen drag. A drag
   * that ends on a pin still fires a click, so pin selection reads this to tell
   * "I picked this memory" from "I spun the globe past it".
   */
  dragged: number;
  /**
   * How fast the world is sweeping across the viewer's field, refreshed each
   * frame. The comfort layer reads it; nothing writes it but the frame loop.
   */
  motion: WorldMotion;
  /**
   * Live comfort settings. Kept on the handle rather than passed as props
   * because the things that consume them run inside `useFrame`, and a toggle
   * must take effect on the next frame rather than the next render.
   */
  comfort: ComfortSettings;
  /**
   * Hands whose trigger belongs to a UI surface this frame, by handedness.
   *
   * The trigger is the only select button, and three things want it: the wrist
   * menu, the comfort panel, and the sky grab. The sky grab used to take it
   * whenever the hand happened to sit off the globe's silhouette — which is
   * exactly where a hand holding a panel is — so pressing a menu row also
   * started a time scrub. A panel claims its hand before the sky grab reads
   * input (both run ahead of it by frame priority), and the sky grab skips any
   * hand in here.
   */
  uiHands: Set<XRHandedness>;
}

/**
 * Stop an in-progress fly-to where it stands. Returns whether there was one —
 * the caller usually wants to know whether it just interrupted something.
 */
export function cancelFlight(world: WorldHandle): boolean {
  if (!world.flight) return false;
  world.flight = null;
  return true;
}

/**
 * Ease the world from where it is to `to`.
 *
 * Scale is interpolated geometrically. Linearly, a flight from a globe in your
 * hands to a street corner spends its first frame covering most of the seven
 * orders of magnitude and the rest crawling — the classic "zoom that lurches".
 */
function advanceFlight(world: WorldHandle, now: number): void {
  const flight = world.flight;
  if (!flight) return;
  const raw = Math.min(1, (now - flight.start) / (flight.seconds * 1000));
  const k = raw * raw * (3 - 2 * raw); // smoothstep: no jolt at either end
  world.transform.position.lerpVectors(flight.from.position, flight.to.position, k);
  world.transform.quaternion.slerpQuaternions(flight.from.quaternion, flight.to.quaternion, k);
  world.transform.scale = flight.from.scale * (flight.to.scale / flight.from.scale) ** k;
  if (raw >= 1) world.flight = null;
}

const _mat = new Matrix4();
const _grabNow = new Matrix4();
const _handNow = new Vector3();
const _handStart = new Vector3();
const _quatScratch = new Quaternion();
const _scaleScratch = new Vector3();
const _worldStartT = createWorldTransform();
const _worldCentre = new Vector3();
/**
 * How far outside the surface the head must be before a one-handed grab spins
 * the planet rather than dragging it. Expressed as a multiple of the rendered
 * radius so it holds at every zoom: the question is "am I looking at the
 * planet, or standing on it?", not any absolute size. A fixed metre threshold
 * got this wrong — after a two-handed zoom the globe can be metres across with
 * the viewer just above the ground, where spinning the whole Earth under a
 * hand is nothing like the pan across the surface the moment calls for.
 */
const ORBIT_MIN_HEAD_DISTANCE = 1.15;
const _pos = new Vector3();
const _pos2 = new Vector3();
const _quat = new Quaternion();
const _ray = new Ray();
const _sphere = new Sphere();
const _ndc = new Vector2();
const _right = new Vector3();
const _up = new Vector3();
const _axis = new Vector3();
const _drag = new Vector3();
const _forward = new Vector3();
const _deltaQuat = new Quaternion();
const _prevQuat = new Quaternion();
/** Player +Y: snap turn is about the room's vertical, never the world's. */
const TURN_AXIS = new Vector3(0, 1, 0);

/**
 * The thumbstick, as one number.
 *
 * `axes[2]` is the thumbstick X of the xr-standard mapping and `axes[0]` the
 * touchpad's; controllers that have only a stick report it in `axes[0]`
 * instead. Take whichever the device actually has, from whichever hand is
 * pushing hardest, so snap turn works on either controller without the viewer
 * having to know which one it was bound to.
 */
function readTurnAxis(session: XRSession): number {
  let strongest = 0;
  for (const source of session.inputSources) {
    const axes = source.gamepad?.axes;
    if (!axes || axes.length === 0) continue;
    const value = (axes.length >= 4 ? axes[2] : axes[0]) ?? 0;
    if (Math.abs(value) > Math.abs(strongest)) strongest = value;
  }
  return strongest;
}

/** Sources currently pinching, so the pinch has hysteresis instead of chattering. */
const pinching = new WeakSet<XRInputSource>();
const PINCH_CLOSE = 0.025;
const PINCH_OPEN = 0.04;

function isSqueezing(source: XRInputSource): boolean {
  const buttons = source.gamepad?.buttons;
  if (!buttons) return false;
  // xr-standard mapping: 0 = trigger, 1 = squeeze. Grabbing is the grip, and
  // the grip only — the trigger has to stay free to point at a memory and
  // select it, which is also how Earth VR splits them. Controllers without a
  // grip fall back to the trigger, since otherwise they cannot grab at all.
  const grip = buttons[1] ?? buttons[0];
  return !!grip && (grip.pressed || grip.value > 0.6);
}

/**
 * The pinch point for a tracked hand: thumb tip to index tip. Returns null when
 * the hand is open, so the caller can treat hands and controllers alike.
 */
function handPinch(source: XRInputSource, frame: XRFrame, space: XRSpace, target: Vector3): boolean {
  const hand = source.hand;
  if (!hand) return false;
  const thumb = hand.get('thumb-tip');
  const index = hand.get('index-finger-tip');
  if (!thumb || !index) return false;
  const thumbPose = frame.getJointPose?.(thumb, space);
  const indexPose = frame.getJointPose?.(index, space);
  if (!thumbPose || !indexPose) return false;

  _pos.set(thumbPose.transform.position.x, thumbPose.transform.position.y, thumbPose.transform.position.z);
  _pos2.set(indexPose.transform.position.x, indexPose.transform.position.y, indexPose.transform.position.z);
  const gap = _pos.distanceTo(_pos2);
  const was = pinching.has(source);
  const now = gap < (was ? PINCH_OPEN : PINCH_CLOSE);
  if (now) pinching.add(source);
  else pinching.delete(source);
  if (!now) return false;

  target.copy(_pos).add(_pos2).multiplyScalar(0.5);
  return true;
}

/**
 * Two reusable slots for the grabbing hands. Reading poses is a per-frame job in
 * the hot path of a 90 Hz renderer, so nothing here allocates.
 */
const poseSlots: GrabPose[] = [
  { position: new Vector3(), quaternion: new Quaternion() },
  { position: new Vector3(), quaternion: new Quaternion() },
];

function fillPose(slot: GrabPose, source: XRInputSource, frame: XRFrame, space: XRReferenceSpace): boolean {
  if (source.hand) {
    // For hands the grab point is the pinch itself, not the wrist — that is
    // where the person believes they are holding the world.
    if (!handPinch(source, frame, space, slot.position)) return false;
    const wrist = frame.getPose(source.gripSpace ?? source.targetRaySpace, space);
    const o = wrist?.transform.orientation;
    slot.quaternion.set(o?.x ?? 0, o?.y ?? 0, o?.z ?? 0, o?.w ?? 1);
    return true;
  }

  if (!isSqueezing(source)) return false;
  const grip = source.gripSpace ? frame.getPose(source.gripSpace, space) : undefined;
  if (!grip) return false;
  slot.position.set(grip.transform.position.x, grip.transform.position.y, grip.transform.position.z);
  slot.quaternion.set(
    grip.transform.orientation.x,
    grip.transform.orientation.y,
    grip.transform.orientation.z,
    grip.transform.orientation.w,
  );
  return true;
}

/**
 * Collect the poses of everything currently grabbing, in player space.
 *
 * Left hand first, so a two-handed grab keeps a stable frame; taking them in
 * `inputSources` order instead lets the hand-to-hand axis flip between frames,
 * which spins the world 180° for no reason the wearer can see.
 *
 * Exported for `test/xr-grab-input.test.ts`: this is the one part of the
 * locomotion path that only a headset exercises, so it is tested against a
 * stand-in session rather than left to a device nobody has to hand.
 */
export function readGrabPoses(
  session: XRSession,
  frame: XRFrame,
  space: XRReferenceSpace,
  origin: Object3D | undefined,
  out: GrabPose[],
): GrabPose[] {
  out.length = 0;
  for (const wanted of ['left', 'right', 'none'] as const) {
    for (const source of session.inputSources) {
      if (source.handedness !== wanted || out.length === 2) continue;
      const slot = poseSlots[out.length]!;
      if (!fillPose(slot, source, frame, space)) continue;
      // Poses arrive in the session's reference space. When the app has moved
      // the XR origin they need the origin's transform on top; Atlas never
      // moves it (the world moves instead), but honouring it keeps this correct
      // if that ever changes.
      if (origin) {
        origin.updateMatrixWorld();
        slot.position.applyMatrix4(origin.matrixWorld);
        slot.quaternion.premultiply(origin.getWorldQuaternion(_quat));
      }
      out.push(slot);
    }
  }
  return out;
}

/** The head, in player space — read from the frame so it is this frame's pose. */
function readHead(frame: XRFrame | undefined, space: XRReferenceSpace | undefined, camera: Object3D, target: Vector3): Vector3 {
  const pose = frame && space ? frame.getViewerPose(space) : undefined;
  if (pose) return target.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
  return target.setFromMatrixPosition(camera.matrixWorld);
}

/** Start an eased move to a new framing (see `advanceFlight`). */
export function flyTo(world: WorldHandle, to: WorldTransform, seconds = 1.4): void {
  world.flight = {
    from: copyWorldTransform(world.transform, createWorldTransform()),
    to,
    start: performance.now(),
    seconds,
  };
}

export interface LocomotionOptions {
  /** The XR origin, when the app has one. Poses are expressed relative to it. */
  origin?: () => Object3D | undefined;
  /** Called when a grab starts or ends, for hint UI. */
  onHandsChanged?: (hands: number) => void;
}

/**
 * Drive the globe: read grabs, apply them, keep the viewer above ground, and
 * push the result onto the scene group and the camera's depth range.
 *
 * Runs at a negative frame priority so the world is settled before anything
 * that reads it (the tiles renderer's LOD pass, the pin layer) runs at 0.
 */
export function useGlobeLocomotion(world: WorldHandle, group: { current: Object3D | null }, opts: LocomotionOptions = {}): void {
  const grab = useRef({ hands: 0, worldStart: new Matrix4(), grabStart: new Matrix4() });
  const poses = useRef<GrabPose[]>([]);
  const depth = useRef({ near: 0, far: 0 });
  const snap = useRef(createSnapTurnState());
  // Last frame's world pose, for measuring how fast it is moving. Seeded on the
  // first frame so the session does not open with a spurious velocity.
  const previous = useRef<MotionSample & { seeded: boolean }>({
    position: new Vector3(),
    quaternion: new Quaternion(),
    scale: 1,
    seeded: false,
  });
  const { onHandsChanged } = opts;

  useFrame((state, delta, frame) => {
    // One frame, one claim. Cleared here at priority -100, before the panels
    // re-assert it and before the sky grab (-90) reads it, so a hand that has
    // moved off a panel stops being claimed on the very next frame.
    world.uiHands.clear();

    const xr = state.gl.xr;
    const session = xr.getSession?.() ?? undefined;
    const space = xr.getReferenceSpace?.() ?? undefined;
    readHead(frame, space, state.camera, world.head);
    const comfort = world.comfort ?? DEFAULT_COMFORT;

    const held = poses.current;
    if (session && frame && space) readGrabPoses(session, frame, space, opts.origin?.(), held);
    else held.length = 0;

    if (held.length > 0 && grabFrame(held, _grabNow, comfort.levelHorizon)) {
      // Re-anchor whenever the number of hands changes: going from one hand to
      // two redefines the frame completely, and carrying the old start matrix
      // across snaps the planet across the room.
      if (grab.current.hands !== held.length) {
        grab.current.hands = held.length;
        grab.current.grabStart.copy(_grabNow);
        toMatrix(world.transform, grab.current.worldStart);
      }
      // Touching the world always wins over an animation still playing.
      world.flight = null;
      // One hand on an object-scale globe spins it about its own centre; a
      // rigid drag would walk the planet out of reach and never rotate it (see
      // applyOrbitGrab). Two hands keep the rigid model, because that is what
      // makes pull-apart-to-zoom and the two-handed re-frame work.
      // Orbit only while the whole planet reads as an object in front of the
      // player; once they are down near the surface a grab should pull them
      // across it instead.
      _worldCentre.setFromMatrixPosition(grab.current.worldStart);
      const renderedRadius = grab.current.worldStart.elements[0] * EARTH_RADIUS_M;
      const headDistance = world.head.distanceTo(_worldCentre);
      const holdingTheGlobe = headDistance > renderedRadius * ORBIT_MIN_HEAD_DISTANCE;
      if (held.length === 1 && holdingTheGlobe) {
        _grabNow.decompose(_handNow, _quatScratch, _scaleScratch);
        grab.current.grabStart.decompose(_handStart, _quatScratch, _scaleScratch);
        fromMatrix(grab.current.worldStart, _worldStartT);
        applyOrbitGrab(world.transform, _worldStartT, _worldStartT.position, _handStart, _handNow);
      } else {
        applyGrab(world.transform, grab.current.worldStart, grab.current.grabStart, _grabNow);
      }
    } else {
      if (grab.current.hands !== 0) grab.current.hands = 0;
      // Any button, trigger or stick stops a fly-to. Grabbing already did; this
      // covers everything else, because someone who wants a 1.4-second ride
      // across seven orders of magnitude to stop will reach for whatever is
      // under their fingers, not for the one control that happens to be bound.
      if (world.flight && session && anyInputActive(session.inputSources)) cancelFlight(world);
      advanceFlight(world, performance.now());
    }

    if (world.hands !== grab.current.hands) {
      world.hands = grab.current.hands;
      onHandsChanged?.(world.hands);
    }

    // Snap turn. The player never moves in this app — the world does — so a
    // view rotation is the world turning the other way about the room's
    // vertical, through the head. Doing it that way also leaves the room grid
    // and the panels where they are, which is what makes them a rest frame.
    if (comfort.snapTurn && session) {
      const step = snapTurnTick(snap.current, readTurnAxis(session));
      if (step !== 0) {
        cancelFlight(world);
        rotateAbout(world.transform, world.head, TURN_AXIS, -step * SNAP_TURN_RAD);
        // Re-anchor an in-progress grab, exactly as a change of hand count
        // does: `applyGrab` rebuilds from the start matrices every frame and
        // would otherwise wipe the turn on the next one.
        if (grab.current.hands > 0) {
          grab.current.grabStart.copy(_grabNow);
          toMatrix(world.transform, grab.current.worldStart);
        }
        // And hide the turn from the roll cap below, for the same reason.
        //
        // The cap measures this frame's delta and strips whatever twists about
        // the view axis. A yaw about the room's vertical contains a twist of
        // roughly `step * sin(pitch)` — at a 15 degree glance down at the globe
        // that is about 7.8 degrees, where the cap allows 0.6 rad/s * dt, about
        // 0.38 degrees at 90 Hz. So the cap ate most of every snap turn and,
        // because it removes rather than defers, left the difference behind as
        // permanent horizon tilt: measured 12.9 degrees after one turn at a 30
        // degree pitch, 58.5 after six. Both settings are on by default, so
        // this was the default path.
        //
        // A snap turn is a deliberate discrete rotation, not motion the eye
        // needs protecting from. Advancing the baseline means the cap sees the
        // frame as still, and the turn arrives whole.
        previous.current.quaternion.copy(world.transform.quaternion);
      }
    }

    // Cap how fast the horizon may roll (see `rollExcess`). Applied to whatever
    // moved the world — grab, snap turn or fly-to — because the eye does not
    // care which of them tilted it.
    if (comfort.levelHorizon && previous.current.seeded) {
      state.camera.getWorldDirection(_forward);
      _deltaQuat.copy(world.transform.quaternion).multiply(_prevQuat.copy(previous.current.quaternion).invert());
      const excess = rollExcess(_deltaQuat, _forward, delta);
      if (excess !== 0) rotateAbout(world.transform, world.head, _forward, -excess);
    }

    clampWorld(world.transform, world.head, world.limits);

    const g = group.current;
    if (g) {
      g.position.copy(world.transform.position);
      g.quaternion.copy(world.transform.quaternion);
      g.scale.setScalar(world.transform.scale);
    }

    // Depth follows the viewer (see `depthRange`). Only push it when it has
    // moved materially: in XR every change costs a `session.updateRenderState`,
    // which does not take effect until the next frame anyway.
    const { near, far } = depthRange(world.transform, world.head);
    const camera = state.camera as PerspectiveCamera;
    if (Math.abs(Math.log(near / (depth.current.near || 1))) > 0.1 || Math.abs(Math.log(far / (depth.current.far || 1))) > 0.1) {
      depth.current = { near, far };
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }

    // Last, so what the comfort layer reads is the world as it will actually be
    // drawn this frame — after the clamps and the roll cap, not before them.
    const prev = previous.current;
    if (prev.seeded) {
      measureMotion(prev, world.transform, world.head.distanceTo(world.transform.position), delta, world.motion);
    }
    prev.position.copy(world.transform.position);
    prev.quaternion.copy(world.transform.quaternion);
    prev.scale = world.transform.scale;
    prev.seeded = true;
  }, -100);
}

/**
 * Flat-screen fallback controls.
 *
 * `?renderer=xr` has to be usable — and verifiable — in an ordinary browser
 * window, and a headset is not always the thing in front of you. Drag grabs the
 * ground under the cursor and turns the planet under it; the wheel zooms toward
 * whatever is under the cursor. Both drive exactly the same `WorldTransform`
 * and the same clamps as the controller path, so what you check on a desktop is
 * the same state machine that runs in the headset.
 */
export function useFlatGlobeControls(world: WorldHandle, enabled = true): void {
  const { gl, camera, size } = useThree();
  const drag = useRef<{ id: number; x: number; y: number; distance: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    /** Where the pointer ray meets the globe, and how far away that is. */
    const pick = (x: number, y: number, target: Vector3): number => {
      _ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
      _ray.origin.setFromMatrixPosition(camera.matrixWorld);
      _ray.direction.set(_ndc.x, _ndc.y, 0.5).unproject(camera).sub(_ray.origin).normalize();
      _sphere.center.copy(world.transform.position);
      _sphere.radius = EARTH_RADIUS_M * world.transform.scale;
      if (_ray.intersectSphere(_sphere, target)) return target.distanceTo(_ray.origin);
      // Off the limb: fall back to the point on the ray closest to the centre,
      // so dragging past the edge still does something predictable.
      _ray.closestPointToPoint(_sphere.center, target);
      return target.distanceTo(_ray.origin);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      cancelFlight(world);
      world.dragged = 0;
      const distance = pick(e.offsetX, e.offsetY, _pos);
      drag.current = { id: e.pointerId, x: e.offsetX, y: e.offsetY, distance };
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.offsetX - d.x;
      const dy = e.offsetY - d.y;
      d.x = e.offsetX;
      d.y = e.offsetY;
      world.dragged += Math.hypot(dx, dy);

      // Convert the pixel drag into a player-space displacement at the depth of
      // the grabbed point, then find the rotation about the Earth's centre that
      // moves that point by it. That is what keeps the ground under the cursor.
      const fov = ((camera as PerspectiveCamera).fov ?? 60) * (Math.PI / 180);
      const perPixel = (2 * Math.tan(fov / 2) * d.distance) / size.height;
      camera.matrixWorld.extractBasis(_right, _up, _axis);
      _drag.copy(_right).multiplyScalar(-dx * perPixel).addScaledVector(_up, dy * perPixel);

      pick(e.offsetX, e.offsetY, _pos);
      const arm = _pos2.copy(_pos).sub(world.transform.position);
      const radius = arm.length();
      if (radius < 1e-6 || _drag.lengthSq() < 1e-18) return;
      _axis.copy(arm).cross(_drag);
      if (_axis.lengthSq() < 1e-24) return;
      rotateAbout(world.transform, world.transform.position, _axis.normalize(), _drag.length() / radius);
      clampWorld(world.transform, world.head, world.limits);
    };

    const onUp = (e: PointerEvent) => {
      if (drag.current?.id !== e.pointerId) return;
      drag.current = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    // Same contract as the controllers: any input stops a fly-to. On a flat
    // screen the keyboard is the third one, after the pointer and the wheel.
    const onKey = () => cancelFlight(world);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFlight(world);
      pick(e.offsetX, e.offsetY, _pos);
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      setScaleAbout(world.transform, world.transform.scale * factor, _pos);
      clampWorld(world.transform, world.head, world.limits, _pos);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [enabled, gl, camera, size.width, size.height, world]);
}
