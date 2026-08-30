/**
 * Comfort — how much of the viewer's visual field is allowed to move, and how
 * fast.
 *
 * Simulator sickness in a headset is not a matter of taste, and Atlas's core
 * interaction is the provocative one: the *world* moves while the person sits
 * still, which is optical flow with no matching vestibular signal. Three things
 * are known to make that survivable, and all three are implemented here as pure
 * functions so the thresholds can be argued with in a test rather than in a
 * headset:
 *
 *  - **Keep a rest frame.** Something in the field of view must stay put and
 *    agree with the inner ear. A starfield that turns with the planet removes
 *    the last static reference, which is why `steadyStars` holds it still (and
 *    fades it out) the moment the world turns.
 *  - **Cut the periphery.** Peripheral flow drives vection far more strongly
 *    than the centre, so narrowing the field of view during motion — Google
 *    Earth VR's "Tunnel Vision" — removes most of the provocation for a small
 *    loss of view. The periphery it exposes is the *room*, in `local-floor`
 *    space, so the thing the eye falls back on is where the body actually is.
 *  - **Never rotate the view continuously.** Yaw is the worst axis; smooth
 *    turning is the control every comfort guide names first. Snap turn moves in
 *    discrete steps with nothing to integrate.
 *
 * Everything here is free of three.js scene state and React so it can be
 * unit-tested (see `test/xr-comfort.test.ts`).
 */
import type { Quaternion, Vector3 } from 'three';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ComfortSettings {
  /** Narrow the field of view and show the room grid while the world moves. */
  tunnel: boolean;
  /** Hold the starfield still, and fade it out, while the world turns. */
  steadyStars: boolean;
  /** Thumbstick left/right turns the view in discrete 30° steps. */
  snapTurn: boolean;
  /** No roll from the wrists, and a cap on how fast the horizon may roll. */
  levelHorizon: boolean;
}

/**
 * On, all of it.
 *
 * A comfort feature that defaults off protects nobody: the person who most
 * needs it is the one putting a headset on for the first time, who has no idea
 * the setting exists and no vocabulary for what went wrong. The people who can
 * tell they don't need it are exactly the people who can find the panel.
 */
export const DEFAULT_COMFORT: ComfortSettings = {
  tunnel: true,
  steadyStars: true,
  snapTurn: true,
  levelHorizon: true,
};

export const COMFORT_STORAGE_KEY = 'atlas.xr.comfort.v1';

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage` throws outright in some privacy modes, so never touch it bare. */
function safeStorage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Read stored settings, defaulting anything missing to on.
 *
 * Per-key rather than a whole-object parse: a stored blob written by an older
 * build has no entry for a toggle added since, and spreading it over the
 * defaults would leave a new comfort feature switched off for every returning
 * viewer — the one population that would never think to look for it.
 */
export function loadComfort(store: KeyValue | null = safeStorage()): ComfortSettings {
  const out = { ...DEFAULT_COMFORT };
  if (!store) return out;
  try {
    const raw = store.getItem(COMFORT_STORAGE_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return out;
    for (const key of Object.keys(out) as (keyof ComfortSettings)[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') out[key] = value;
    }
  } catch {
    // Corrupt or unreadable storage is not worth a broken session.
  }
  return out;
}

export function saveComfort(settings: ComfortSettings, store: KeyValue | null = safeStorage()): void {
  if (!store) return;
  try {
    store.setItem(COMFORT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Full or blocked storage: the session still works, it just won't be remembered.
  }
}

// ---------------------------------------------------------------------------
// How fast the world is moving in the viewer's field
// ---------------------------------------------------------------------------

export interface MotionSample {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
}

export interface WorldMotion {
  /** How fast the world is turning in player space, rad/s. */
  angular: number;
  /** Apparent sweep from translation, rad/s at the viewer's distance from it. */
  sweep: number;
  /** Zoom rate, e-folds per second. */
  zoom: number;
  /** The single figure the comfort features threshold on, rad/s. */
  vection: number;
}

export function createWorldMotion(): WorldMotion {
  return { angular: 0, sweep: 0, zoom: 0, vection: 0 };
}

/**
 * Zoom counts, but not as much as turning: pulling the planet towards you is
 * radial flow, which provokes far less than the rotational kind. One e-fold per
 * second is treated as worth ~34°/s of rotation.
 */
const ZOOM_TO_RAD = 0.6;

/**
 * Translation only matters as the angle it sweeps: a globe shifted 10 cm at
 * arm's length crosses a lot of the field, and the same shift seen from orbit
 * crosses none of it. The floor stops a viewer standing on the surface — where
 * the world centre is 6400 km away — from reading as motionless.
 */
const MIN_SWEEP_DISTANCE = 0.25;

/**
 * A frame gap this long is a stall, not motion: a backgrounded tab, a tile
 * upload, a breakpoint. Treating one as velocity slams the tunnel shut on the
 * frame the app comes back.
 */
const MAX_FRAME_SECONDS = 0.25;

export function measureMotion(
  prev: MotionSample,
  next: MotionSample,
  headDistance: number,
  dt: number,
  out: WorldMotion,
): WorldMotion {
  if (!(dt > 0) || dt > MAX_FRAME_SECONDS) {
    out.angular = 0;
    out.sweep = 0;
    out.zoom = 0;
    out.vection = 0;
    return out;
  }
  out.angular = next.quaternion.angleTo(prev.quaternion) / dt;
  out.sweep = next.position.distanceTo(prev.position) / Math.max(headDistance, MIN_SWEEP_DISTANCE) / dt;
  const ratio = prev.scale > 0 && next.scale > 0 ? next.scale / prev.scale : 1;
  out.zoom = Math.abs(Math.log(ratio)) / dt;
  out.vection = out.angular + out.sweep + ZOOM_TO_RAD * out.zoom;
  return out;
}

/**
 * Where the comfort features start and finish ramping in.
 *
 * 0.25 rad/s is ~14°/s. Below that the field is drifting rather than sweeping
 * and nothing needs to happen; by 0.8 rad/s (~46°/s) the response is at full
 * strength, which is well under the rate an ordinary one-handed spin reaches.
 */
export const VECTION_ONSET = 0.25;
export const VECTION_FULL = 0.8;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0 while the world is effectively still, 1 once it is properly moving. */
export function motionAmount(vection: number): number {
  return smoothstep(VECTION_ONSET, VECTION_FULL, vection);
}

/**
 * Move `current` towards `target` at a fixed rate — a fade, not a snap.
 *
 * Rate rather than an exponential because the interesting property is "how long
 * does it take to get there", and that has to be assertable. Rising and falling
 * rates differ: a tunnel that arrives late is useless, and one that leaves in a
 * hurry flickers on every small correction.
 */
export function approach(
  current: number,
  target: number,
  dt: number,
  riseSeconds: number,
  fallSeconds: number,
): number {
  if (!(dt > 0)) return current;
  const seconds = target > current ? riseSeconds : fallSeconds;
  if (!(seconds > 0)) return target;
  const step = dt / seconds;
  const gap = target - current;
  if (Math.abs(gap) <= step) return target;
  return current + Math.sign(gap) * step;
}

export const TUNNEL_RISE_S = 0.18;
export const TUNNEL_FALL_S = 0.55;
export const STAR_RISE_S = 0.12;
export const STAR_FALL_S = 0.6;

// ---------------------------------------------------------------------------
// Starfield
// ---------------------------------------------------------------------------

/**
 * How dim the stars have to be before they may be re-aligned with the world.
 *
 * The stars are locked to the celestial sphere, which is right when nothing is
 * moving and catastrophic when something is: carrying the world's rotation
 * means a one-handed spin turns the entire visual field, background included,
 * with no rest frame left anywhere. So they hold still through the motion — but
 * then they are wrong, and re-aligning them is a jump. Do it while they are
 * under 5% brightness and nobody can see the jump happen.
 */
export const STAR_HIDDEN = 0.95;

export function starfieldFollowsWorld(dim: number): boolean {
  return dim >= STAR_HIDDEN || dim <= 1e-3;
}

// ---------------------------------------------------------------------------
// Comfort tunnel
// ---------------------------------------------------------------------------

/** Half-angle of the clear centre with the tunnel fully open — i.e. off. */
export const TUNNEL_OPEN_RAD = 1.25;
/** Half-angle of the clear centre at full effect: ~31°, a generous keyhole. */
export const TUNNEL_NARROW_RAD = 0.55;
/** How wide the soft edge is. A hard rim is its own distraction. */
export const TUNNEL_FEATHER_RAD = 0.35;

export function tunnelInnerAngle(amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  return TUNNEL_OPEN_RAD + (TUNNEL_NARROW_RAD - TUNNEL_OPEN_RAD) * t;
}

// ---------------------------------------------------------------------------
// Snap turn
// ---------------------------------------------------------------------------

export const SNAP_TURN_RAD = (30 * Math.PI) / 180;
/** Push past this to turn… */
export const SNAP_ENGAGE = 0.7;
/** …and back inside this before the stick will turn again. */
export const SNAP_RELEASE = 0.35;

export interface SnapTurnState {
  /** Which way the stick is currently latched: -1 left, 1 right, 0 free. */
  engaged: -1 | 0 | 1;
}

export function createSnapTurnState(): SnapTurnState {
  return { engaged: 0 };
}

/**
 * One step per push, never a stream.
 *
 * Discrete is the whole point — continuous yaw is the single most reliably
 * sickening control in VR, and Earth VR's own SIGGRAPH talk calls out
 * "nauseating rotations" as the thing they had to design around. Holding the
 * stick over therefore does nothing after the first step; the person has to
 * release it past the deadband and push again.
 */
export function snapTurnTick(state: SnapTurnState, axis: number): -1 | 0 | 1 {
  const direction = axis > SNAP_ENGAGE ? 1 : axis < -SNAP_ENGAGE ? -1 : 0;
  if (Math.abs(axis) < SNAP_RELEASE) state.engaged = 0;
  if (direction === 0 || state.engaged === direction) return 0;
  state.engaged = direction;
  return direction;
}

// ---------------------------------------------------------------------------
// Horizon roll
// ---------------------------------------------------------------------------

/**
 * How fast the horizon may roll, rad/s (~34°/s).
 *
 * Roll is the axis with no natural counterpart — a seated person's inner ear
 * knows perfectly well they are not tumbling — and Earth VR gets away with
 * wrist-driven roll only because the viewer's feet are always on a surface.
 * Atlas has no such invariant, so the rate is capped instead.
 */
export const MAX_ROLL_RATE = 0.6;

/** Wrap to (-π, π] so a twist near half a turn doesn't read as a huge rate. */
export function normalizeAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/**
 * The rotation about `axis` contained in `q` — the twist half of a swing–twist
 * decomposition. `axis` must be unit length.
 */
export function twistAngle(q: Quaternion, axis: Vector3): number {
  const projected = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  return normalizeAngle(2 * Math.atan2(projected, q.w));
}

/**
 * How much of this frame's rotation about the view axis is over the cap, in
 * radians — what the caller has to rotate back to keep the horizon in hand.
 *
 * Only the twist about the direction the viewer is looking is limited. Yaw and
 * pitch stay rigidly attached to the hand, because that coupling is what makes
 * a grab feel like holding something; roll is the part that has no defence.
 */
export function rollExcess(
  delta: Quaternion,
  forward: Vector3,
  dt: number,
  maxRate = MAX_ROLL_RATE,
): number {
  if (!(dt > 0)) return 0;
  const twist = twistAngle(delta, forward);
  const limit = maxRate * dt;
  if (Math.abs(twist) <= limit) return 0;
  return twist - Math.sign(twist) * limit;
}

// ---------------------------------------------------------------------------
// Interrupting a fly-to
// ---------------------------------------------------------------------------

export interface GamepadLike {
  buttons?: readonly { pressed?: boolean; value?: number }[];
  axes?: readonly number[];
}

export interface InputSourceLike {
  gamepad?: GamepadLike | null;
}

export const INPUT_DEADZONE = 0.3;

/**
 * Is anyone touching anything?
 *
 * A fly-to crosses up to seven orders of magnitude in 1.4 s. Uncancellable,
 * that is a passive ride nobody consented to and cannot stop — the definition
 * of the motion people take a headset off over. Any button, any trigger, any
 * stick counts, because in the moment someone wants it to stop they will grab
 * whatever is under their fingers.
 */
export function anyInputActive(sources: Iterable<InputSourceLike>, deadzone = INPUT_DEADZONE): boolean {
  for (const source of sources) {
    const pad = source?.gamepad;
    if (!pad) continue;
    for (const button of pad.buttons ?? []) {
      if (button?.pressed || (button?.value ?? 0) > 0.5) return true;
    }
    for (const axis of pad.axes ?? []) {
      if (Math.abs(axis) > deadzone) return true;
    }
  }
  return false;
}
