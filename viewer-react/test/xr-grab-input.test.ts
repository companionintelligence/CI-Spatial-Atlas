/**
 * The WebXR-facing half of grab locomotion, against a stand-in session.
 *
 * Everything here is what only a headset would otherwise exercise: which button
 * counts as a grab, which hand comes first, where a pinch is, and what happens
 * to a pose when the XR origin has been moved. Getting any of it wrong produces
 * a globe that lurches or spins for no visible reason — the kind of bug that is
 * miserable to find while wearing the device.
 */
import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { readGrabPoses } from '../src/renderers/xr/useGlobeLocomotion.js';
import { applyGrab, createWorldTransform, grabFrame, toMatrix } from '../src/renderers/xr/worldTransform.js';

type Pose = { position: [number, number, number]; orientation?: [number, number, number, number] };

/** Minimal stand-ins for the WebXR objects `readGrabPoses` touches. */
function makeSource(opts: {
  handedness: XRHandedness;
  buttons?: number[];
  grip?: Pose;
  hand?: { thumb: Pose; index: Pose; wrist?: Pose };
}) {
  const gripSpace = { id: `${opts.handedness}-grip` };
  const source = {
    handedness: opts.handedness,
    gripSpace,
    targetRaySpace: { id: `${opts.handedness}-ray` },
    gamepad: opts.buttons ? { buttons: opts.buttons.map((v) => ({ pressed: v > 0.9, value: v })) } : undefined,
    hand: opts.hand ? new Map<string, object>([['thumb-tip', { id: 'thumb' }], ['index-finger-tip', { id: 'index' }]]) : undefined,
    __poses: opts,
  };
  return source as unknown as XRInputSource;
}

const transform = (p: Pose) => ({
  transform: {
    position: { x: p.position[0], y: p.position[1], z: p.position[2] },
    orientation: {
      x: p.orientation?.[0] ?? 0,
      y: p.orientation?.[1] ?? 0,
      z: p.orientation?.[2] ?? 0,
      w: p.orientation?.[3] ?? 1,
    },
  },
});

function makeFrame(sources: XRInputSource[]) {
  const find = (space: object) =>
    sources.find((s) => {
      const raw = s as unknown as { gripSpace: object; targetRaySpace: object };
      return raw.gripSpace === space || raw.targetRaySpace === space;
    }) as unknown as { __poses: Parameters<typeof makeSource>[0] } | undefined;

  return {
    getPose: (space: object) => {
      const src = find(space);
      const pose = src?.__poses.grip ?? src?.__poses.hand?.wrist;
      return pose ? transform(pose) : undefined;
    },
    getJointPose: (joint: { id: string }) => {
      for (const s of sources) {
        const raw = s as unknown as { hand?: Map<string, { id: string }>; __poses: Parameters<typeof makeSource>[0] };
        if (!raw.hand) continue;
        for (const value of raw.hand.values()) {
          if (value !== joint) continue;
          const pose = joint.id === 'thumb' ? raw.__poses.hand!.thumb : raw.__poses.hand!.index;
          return transform(pose);
        }
      }
      return undefined;
    },
  } as unknown as XRFrame;
}

const session = (sources: XRInputSource[]) => ({ inputSources: sources }) as unknown as XRSession;
const SPACE = {} as XRReferenceSpace;

describe('reading grabs from a WebXR session', () => {
  it('grabs on the grip, not the trigger', () => {
    // The trigger has to stay free for pointing at memories.
    const trigger = makeSource({ handedness: 'right', buttons: [1, 0], grip: { position: [0.2, 1.2, -0.3] } });
    expect(readGrabPoses(session([trigger]), makeFrame([trigger]), SPACE, undefined, [])).toHaveLength(0);

    const grip = makeSource({ handedness: 'right', buttons: [0, 1], grip: { position: [0.2, 1.2, -0.3] } });
    const held = readGrabPoses(session([grip]), makeFrame([grip]), SPACE, undefined, []);
    expect(held).toHaveLength(1);
    expect(held[0]!.position.toArray()).toEqual([0.2, 1.2, -0.3]);
  });

  it('falls back to the trigger on a controller with no grip button', () => {
    const source = makeSource({ handedness: 'right', buttons: [1], grip: { position: [0, 1, -0.5] } });
    expect(readGrabPoses(session([source]), makeFrame([source]), SPACE, undefined, [])).toHaveLength(1);
  });

  it('always reports the left hand first, whatever order the session lists', () => {
    const right = makeSource({ handedness: 'right', buttons: [0, 1], grip: { position: [0.3, 1.2, -0.4] } });
    const left = makeSource({ handedness: 'left', buttons: [0, 1], grip: { position: [-0.3, 1.2, -0.4] } });
    const held = readGrabPoses(session([right, left]), makeFrame([right, left]), SPACE, undefined, []);
    expect(held.map((h) => h.position.x)).toEqual([-0.3, 0.3]);
  });

  it('takes a hand grab from the pinch point, and only while pinched', () => {
    const open = makeSource({
      handedness: 'right',
      hand: { thumb: { position: [0.2, 1.2, -0.3] }, index: { position: [0.3, 1.2, -0.3] } },
    });
    expect(readGrabPoses(session([open]), makeFrame([open]), SPACE, undefined, [])).toHaveLength(0);

    const pinched = makeSource({
      handedness: 'right',
      hand: {
        thumb: { position: [0.2, 1.2, -0.3] },
        index: { position: [0.21, 1.2, -0.3] },
        wrist: { position: [0.2, 1.1, -0.2] },
      },
    });
    const held = readGrabPoses(session([pinched]), makeFrame([pinched]), SPACE, undefined, []);
    expect(held).toHaveLength(1);
    // Midway between the finger tips, not at the wrist.
    expect(held[0]!.position.x).toBeCloseTo(0.205, 6);
  });

  it('brings poses across the XR origin transform', () => {
    const origin = new Group();
    origin.position.set(10, 0, 0);
    origin.updateMatrixWorld();
    const source = makeSource({ handedness: 'right', buttons: [0, 1], grip: { position: [0.2, 1.2, -0.3] } });
    const held = readGrabPoses(session([source]), makeFrame([source]), SPACE, origin, []);
    expect(held[0]!.position.x).toBeCloseTo(10.2, 6);
  });

  it('drives the world transform end to end', () => {
    // The whole chain a headset would run: session → poses → grab frame → world.
    const world = createWorldTransform();
    world.position.set(0, 1.5, -1);
    const worldStart = toMatrix(world, new Matrix4());

    const down = (x: number) => makeSource({ handedness: 'right', buttons: [0, 1], grip: { position: [x, 1.2, -0.4] } });
    const start = new Matrix4();
    const now = new Matrix4();

    const a = down(0.1);
    expect(grabFrame(readGrabPoses(session([a]), makeFrame([a]), SPACE, undefined, []), start)).toBe(true);
    const b = down(0.4);
    expect(grabFrame(readGrabPoses(session([b]), makeFrame([b]), SPACE, undefined, []), now)).toBe(true);

    applyGrab(world, worldStart, start, now);
    expect(world.position.x).toBeCloseTo(0.3, 9);
    expect(world.quaternion.angleTo(new Quaternion())).toBeCloseTo(0, 9);
  });

  it('ignores an input source whose grip has no pose this frame', () => {
    const source = makeSource({ handedness: 'right', buttons: [0, 1] }); // squeezing, but untracked
    expect(readGrabPoses(session([source]), makeFrame([source]), SPACE, undefined, [])).toHaveLength(0);
  });

  it('never reports more than two hands', () => {
    const sources = (['left', 'right', 'none', 'none'] as XRHandedness[]).map((handedness, i) =>
      makeSource({ handedness, buttons: [0, 1], grip: { position: [i * 0.1, 1.2, -0.4] } }),
    );
    expect(readGrabPoses(session(sources), makeFrame(sources), SPACE, undefined, [])).toHaveLength(2);
  });
});

/** Guard the scratch-vector reuse: two poses must not alias one Vector3. */
describe('pose slots', () => {
  it('keeps the two hands distinct', () => {
    const left = makeSource({ handedness: 'left', buttons: [0, 1], grip: { position: [-0.2, 1, -0.3] } });
    const right = makeSource({ handedness: 'right', buttons: [0, 1], grip: { position: [0.2, 1, -0.3] } });
    const held = readGrabPoses(session([left, right]), makeFrame([left, right]), SPACE, undefined, []);
    expect(held[0]!.position).not.toBe(held[1]!.position);
    expect(held[0]!.position.distanceTo(held[1]!.position)).toBeCloseTo(0.4, 9);
    expect(new Vector3().subVectors(held[1]!.position, held[0]!.position).x).toBeCloseTo(0.4, 9);
  });
});
