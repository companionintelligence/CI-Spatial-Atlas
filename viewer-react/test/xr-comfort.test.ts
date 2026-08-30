/**
 * The comfort layer's maths.
 *
 * These are the thresholds that decide whether someone can wear this for ten
 * minutes, and they are the kind of thing that is impossible to argue about
 * from inside a headset — "it felt worse" is not a measurement. So the rules
 * are pure functions and the arguing happens here: how fast the world has to be
 * moving before the tunnel closes, how many degrees a snap turn is, how much
 * roll a wrist is allowed to impart, and what it takes to stop a fly-to.
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  anyInputActive,
  approach,
  COMFORT_STORAGE_KEY,
  createSnapTurnState,
  createWorldMotion,
  DEFAULT_COMFORT,
  loadComfort,
  measureMotion,
  motionAmount,
  rollExcess,
  saveComfort,
  SNAP_TURN_RAD,
  snapTurnTick,
  starfieldFollowsWorld,
  TUNNEL_NARROW_RAD,
  TUNNEL_OPEN_RAD,
  tunnelInnerAngle,
  twistAngle,
  VECTION_FULL,
  VECTION_ONSET,
  type ComfortSettings,
  type MotionSample,
} from '../src/renderers/xr/comfort.js';
import { cancelFlight, flyTo, type WorldHandle } from '../src/renderers/xr/useGlobeLocomotion.js';
import {
  createWorldTransform,
  DEFAULT_LIMITS,
  grabFrame,
  rotateAbout,
  type GrabPose,
} from '../src/renderers/xr/worldTransform.js';

const sample = (position: Vector3, quaternion: Quaternion, scale: number): MotionSample => ({
  position,
  quaternion,
  scale,
});

function fakeStore(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(COMFORT_STORAGE_KEY, seed);
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('comfort settings', () => {
  it('defaults every toggle on', () => {
    expect(Object.values(DEFAULT_COMFORT).every(Boolean)).toBe(true);
    expect(loadComfort(fakeStore())).toEqual(DEFAULT_COMFORT);
  });

  it('round-trips a deliberate opt-out', () => {
    const store = fakeStore();
    const chosen: ComfortSettings = { ...DEFAULT_COMFORT, tunnel: false };
    saveComfort(chosen, store);
    expect(loadComfort(store)).toEqual(chosen);
  });

  it('defaults a toggle the stored blob has never heard of to on', () => {
    // The trap this guards: a returning viewer whose stored settings predate a
    // comfort feature must not silently get the new one switched off.
    const store = fakeStore(JSON.stringify({ tunnel: false }));
    const loaded = loadComfort(store);
    expect(loaded.tunnel).toBe(false);
    expect(loaded.steadyStars).toBe(true);
    expect(loaded.snapTurn).toBe(true);
    expect(loaded.levelHorizon).toBe(true);
  });

  it('ignores junk rather than opening a session with no comfort at all', () => {
    expect(loadComfort(fakeStore('not json'))).toEqual(DEFAULT_COMFORT);
    expect(loadComfort(fakeStore('null'))).toEqual(DEFAULT_COMFORT);
    expect(loadComfort(fakeStore(JSON.stringify({ tunnel: 'yes please' })))).toEqual(DEFAULT_COMFORT);
    expect(loadComfort(null)).toEqual(DEFAULT_COMFORT);
  });
});

describe('measuring how fast the world is moving', () => {
  const still = () => sample(new Vector3(0, 1.5, -1.2), new Quaternion(), 1e-7);

  it('reads a rotation as an angular rate', () => {
    const out = createWorldMotion();
    const next = sample(new Vector3(0, 1.5, -1.2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2), 1e-7);
    measureMotion(still(), next, 1.2, 0.1, out);
    expect(out.angular).toBeCloseTo(2, 6);
    expect(out.sweep).toBeCloseTo(0, 9);
  });

  it('reads translation as the angle it sweeps, not as metres', () => {
    const out = createWorldMotion();
    const shifted = sample(new Vector3(0, 1.5, -1.1), new Quaternion(), 1e-7);
    measureMotion(still(), shifted, 1, 0.1, out);
    expect(out.sweep).toBeCloseTo(1, 6);

    // The same shift seen from ten times further away sweeps a tenth as much.
    measureMotion(still(), shifted, 10, 0.1, out);
    expect(out.sweep).toBeCloseTo(0.1, 6);
  });

  it('counts zoom, at a discount', () => {
    const out = createWorldMotion();
    const zoomed = sample(new Vector3(0, 1.5, -1.2), new Quaternion(), 1e-7 * Math.exp(0.1));
    measureMotion(still(), zoomed, 1.2, 0.1, out);
    expect(out.zoom).toBeCloseTo(1, 6);
    expect(out.vection).toBeCloseTo(0.6, 6);
  });

  it('reads a stalled frame as stillness, not as a lurch', () => {
    // A backgrounded tab or a long tile upload produces one enormous delta. Left
    // alone it slams the tunnel shut on the frame the app comes back.
    const out = createWorldMotion();
    const far = sample(new Vector3(5, 1.5, -1.2), new Quaternion(), 1e-7);
    measureMotion(still(), far, 1.2, 2, out);
    expect(out.vection).toBe(0);
    measureMotion(still(), far, 1.2, 0, out);
    expect(out.vection).toBe(0);
  });
});

describe('thresholding', () => {
  it('does nothing to a world that is merely drifting', () => {
    expect(motionAmount(0)).toBe(0);
    expect(motionAmount(VECTION_ONSET)).toBe(0);
    expect(motionAmount(VECTION_ONSET * 0.9)).toBe(0);
  });

  it('is at full strength well below the rate of an ordinary spin', () => {
    expect(motionAmount(VECTION_FULL)).toBe(1);
    expect(motionAmount(3)).toBe(1);
    // ~46°/s. A one-handed drag across the globe runs several times this.
    expect(VECTION_FULL).toBeLessThan(1);
  });

  it('ramps smoothly in between, with no step to catch the eye', () => {
    const mid = motionAmount((VECTION_ONSET + VECTION_FULL) / 2);
    expect(mid).toBeCloseTo(0.5, 6);
    let previous = 0;
    for (let v = 0; v <= 1.2; v += 0.02) {
      const amount = motionAmount(v);
      expect(amount).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = amount;
    }
  });
});

describe('fading', () => {
  it('takes the stated time to arrive, and arrives exactly', () => {
    expect(approach(0, 1, 0.09, 0.18, 0.55)).toBeCloseTo(0.5, 9);
    expect(approach(0.5, 1, 0.09, 0.18, 0.55)).toBe(1);
    expect(approach(1, 0, 0.055, 0.18, 0.55)).toBeCloseTo(0.9, 9);
  });

  it('fades out more slowly than it fades in', () => {
    const rise = approach(0, 1, 0.05, 0.18, 0.55);
    const fall = 1 - approach(1, 0, 0.05, 0.18, 0.55);
    expect(rise).toBeGreaterThan(fall);
  });

  it('never moves on a zero or negative frame', () => {
    expect(approach(0.4, 1, 0, 0.18, 0.55)).toBe(0.4);
    expect(approach(0.4, 1, -0.1, 0.18, 0.55)).toBe(0.4);
  });
});

describe('the starfield as a rest frame', () => {
  it('tracks the celestial sphere while nothing is moving', () => {
    expect(starfieldFollowsWorld(0)).toBe(true);
  });

  it('holds still through the visible part of the fade', () => {
    // This is the whole fix: while the stars can be seen, they do not turn with
    // the world, so a one-handed orbit leaves something in the field that is
    // still.
    expect(starfieldFollowsWorld(0.05)).toBe(false);
    expect(starfieldFollowsWorld(0.5)).toBe(false);
    expect(starfieldFollowsWorld(0.9)).toBe(false);
  });

  it('re-aligns only once it is too dim to see it happen', () => {
    expect(starfieldFollowsWorld(0.96)).toBe(true);
    expect(starfieldFollowsWorld(1)).toBe(true);
  });
});

describe('the tunnel', () => {
  it('narrows as the amount rises, and is wide open at zero', () => {
    expect(tunnelInnerAngle(0)).toBeCloseTo(TUNNEL_OPEN_RAD, 9);
    expect(tunnelInnerAngle(1)).toBeCloseTo(TUNNEL_NARROW_RAD, 9);
    expect(tunnelInnerAngle(0.5)).toBeLessThan(tunnelInnerAngle(0.25));
  });

  it('clamps rather than inverting on an out-of-range amount', () => {
    expect(tunnelInnerAngle(-1)).toBeCloseTo(TUNNEL_OPEN_RAD, 9);
    expect(tunnelInnerAngle(4)).toBeCloseTo(TUNNEL_NARROW_RAD, 9);
  });

  it('still leaves a usable view at full strength', () => {
    // ~31° half-angle: a keyhole, not a pinhole. A tunnel nobody can see
    // through gets switched off, and then it protects nobody.
    expect(TUNNEL_NARROW_RAD).toBeGreaterThan(0.45);
  });
});

describe('snap turn', () => {
  it('is thirty degrees', () => {
    expect((SNAP_TURN_RAD * 180) / Math.PI).toBeCloseTo(30, 9);
  });

  it('fires once per push, however long the stick is held', () => {
    const state = createSnapTurnState();
    expect(snapTurnTick(state, 1)).toBe(1);
    expect(snapTurnTick(state, 1)).toBe(0);
    expect(snapTurnTick(state, 1)).toBe(0);
    expect(snapTurnTick(state, 0.9)).toBe(0);
  });

  it('needs the stick back past the deadband before it will turn again', () => {
    const state = createSnapTurnState();
    expect(snapTurnTick(state, 1)).toBe(1);
    expect(snapTurnTick(state, 0.5)).toBe(0); // released, but not far enough
    expect(snapTurnTick(state, 1)).toBe(0);
    expect(snapTurnTick(state, 0.1)).toBe(0); // now it is
    expect(snapTurnTick(state, 1)).toBe(1);
  });

  it('ignores a stick resting off centre', () => {
    const state = createSnapTurnState();
    expect(snapTurnTick(state, 0.4)).toBe(0);
    expect(snapTurnTick(state, -0.4)).toBe(0);
  });

  it('turns the other way on a deliberate flick across', () => {
    const state = createSnapTurnState();
    expect(snapTurnTick(state, 1)).toBe(1);
    expect(snapTurnTick(state, -1)).toBe(-1);
  });

  it('moves the view in exact 30° steps and nothing else', () => {
    // What the frame loop does with the step: the player never moves, so a view
    // rotation is the world turning the other way about the room's vertical.
    const world = createWorldTransform();
    world.position.set(0, 1.5, -1.2);
    const head = new Vector3(0, 1.6, 0);
    const azimuth = () => Math.atan2(world.position.x - head.x, world.position.z - head.z);
    const before = azimuth();
    const scale = world.scale;

    const state = createSnapTurnState();
    rotateAbout(world, head, new Vector3(0, 1, 0), -snapTurnTick(state, 1) * SNAP_TURN_RAD);
    expect(((azimuth() - before) * 180) / Math.PI).toBeCloseTo(-30, 6);

    snapTurnTick(state, 0);
    rotateAbout(world, head, new Vector3(0, 1, 0), -snapTurnTick(state, 1) * SNAP_TURN_RAD);
    expect(((azimuth() - before) * 180) / Math.PI).toBeCloseTo(-60, 6);

    // Turning must not move the viewer or change the zoom.
    expect(world.position.distanceTo(head)).toBeCloseTo(new Vector3(0, 1.5, -1.2).distanceTo(head), 9);
    expect(world.scale).toBe(scale);
  });
});

describe('horizon roll', () => {
  const forward = new Vector3(0, 0, -1);

  it('reads the twist about the view axis and nothing else', () => {
    const roll = new Quaternion().setFromAxisAngle(forward, 0.4);
    expect(twistAngle(roll, forward)).toBeCloseTo(0.4, 9);

    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.9);
    expect(twistAngle(yaw, forward)).toBeCloseTo(0, 9);
  });

  it('leaves a gentle roll alone', () => {
    // 0.3 rad/s, half the cap.
    const delta = new Quaternion().setFromAxisAngle(forward, 0.3 / 60);
    expect(rollExcess(delta, forward, 1 / 60)).toBe(0);
  });

  it('trims a fast one back to the cap', () => {
    const delta = new Quaternion().setFromAxisAngle(forward, Math.PI / 2);
    const excess = rollExcess(delta, forward, 0.1);
    // Everything above 0.6 rad/s comes back off.
    expect(excess).toBeCloseTo(Math.PI / 2 - 0.06, 9);
    expect(Math.PI / 2 - excess).toBeCloseTo(0.06, 9);
  });

  it('caps in both directions', () => {
    const delta = new Quaternion().setFromAxisAngle(forward, -1);
    expect(rollExcess(delta, forward, 0.1)).toBeCloseTo(-1 + 0.06, 9);
  });

  it('never touches yaw or pitch, which is what keeps a grab feeling rigid', () => {
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2);
    expect(rollExcess(yaw, forward, 0.1)).toBe(0);
    const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.2);
    expect(rollExcess(pitch, forward, 0.1)).toBe(0);
  });
});

describe('two-handed grab frame', () => {
  const hands = (roll: number): GrabPose[] => {
    const twist = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll);
    return [
      { position: new Vector3(-0.2, 1.2, -0.5), quaternion: twist.clone() },
      { position: new Vector3(0.2, 1.2, -0.5), quaternion: twist.clone() },
    ];
  };
  const upOf = (m: Matrix4) => {
    const up = new Vector3();
    m.extractBasis(new Vector3(), new Vector3(), up);
    return up.normalize();
  };

  it('rolls the world from the wrists when the lock is off', () => {
    const frame = new Matrix4();
    expect(grabFrame(hands(Math.PI / 3), frame, false)).toBe(true);
    const up = upOf(frame);
    expect(up.y).toBeCloseTo(Math.cos(Math.PI / 3), 6);
    expect(Math.abs(up.z)).toBeGreaterThan(0.5);
  });

  it('keeps the horizon level when the lock is on', () => {
    // worldTransform.ts's wrist-average roll is the line this defends: Earth VR
    // can afford it because the viewer is standing on something, and Atlas
    // cannot.
    const frame = new Matrix4();
    expect(grabFrame(hands(Math.PI / 3), frame, true)).toBe(true);
    const up = upOf(frame);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(1, 6);
    expect(up.z).toBeCloseTo(0, 6);
  });

  it('still zooms and turns with the lock on', () => {
    // Only the twist about the hand-to-hand axis goes; the span, and so the
    // scale term that makes pull-apart-to-zoom work, is untouched.
    const wide = new Matrix4();
    grabFrame(
      [
        { position: new Vector3(-0.4, 1.2, -0.5), quaternion: new Quaternion() },
        { position: new Vector3(0.4, 1.2, -0.5), quaternion: new Quaternion() },
      ],
      wide,
      true,
    );
    const scale = new Vector3();
    wide.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(0.8, 6);
  });

  it('survives hands stacked vertically, where +Y is the grab axis itself', () => {
    const frame = new Matrix4();
    const stacked: GrabPose[] = [
      { position: new Vector3(0, 1, -0.5), quaternion: new Quaternion() },
      { position: new Vector3(0, 1.4, -0.5), quaternion: new Quaternion() },
    ];
    expect(grabFrame(stacked, frame, true)).toBe(true);
    const up = upOf(frame);
    expect(Number.isFinite(up.x + up.y + up.z)).toBe(true);
    expect(up.length()).toBeCloseTo(1, 6);
  });
});

describe('interrupting a fly-to', () => {
  const world = (): WorldHandle => ({
    transform: createWorldTransform(),
    limits: DEFAULT_LIMITS,
    head: new Vector3(0, 1.6, 0),
    hands: 0,
    flight: null,
    dragged: 0,
    motion: createWorldMotion(),
    comfort: { ...DEFAULT_COMFORT },
  });

  it('cancels an in-progress flight, once', () => {
    const w = world();
    flyTo(w, createWorldTransform());
    expect(w.flight).not.toBeNull();
    expect(cancelFlight(w)).toBe(true);
    expect(w.flight).toBeNull();
    expect(cancelFlight(w)).toBe(false);
  });

  it('counts any button as a reason to stop', () => {
    expect(anyInputActive([{ gamepad: { buttons: [{ pressed: true, value: 1 }] } }])).toBe(true);
    // A trigger part-pulled is still someone asking for it to stop.
    expect(anyInputActive([{ gamepad: { buttons: [{ pressed: false, value: 0.8 }] } }])).toBe(true);
  });

  it('counts a pushed stick, but not a resting one', () => {
    expect(anyInputActive([{ gamepad: { axes: [0, 0, 0.9, 0] } }])).toBe(true);
    expect(anyInputActive([{ gamepad: { axes: [0.05, -0.02] } }])).toBe(false);
  });

  it('is quiet when nothing is being touched', () => {
    expect(anyInputActive([])).toBe(false);
    expect(anyInputActive([{ gamepad: null }, {}])).toBe(false);
    expect(anyInputActive([{ gamepad: { buttons: [{ pressed: false, value: 0 }], axes: [0, 0, 0, 0] } }])).toBe(false);
  });
});
