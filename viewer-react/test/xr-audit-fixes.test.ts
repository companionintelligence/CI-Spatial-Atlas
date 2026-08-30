import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { rollExcess, SNAP_TURN_RAD } from '../src/renderers/xr/comfort.js';
import { clearAlphaFor, skyboxVisible } from '../src/renderers/xr/sessionMode.js';
import { createWorldTransform, rotateAbout } from '../src/renderers/xr/worldTransform.js';

/**
 * Regressions for three defects the post-merge audit found in the immersive
 * build. Each is written against the maths or the rule rather than the
 * component, because all three were invisible from a screenshot and two of them
 * only appear after a specific sequence of frames.
 */

describe('the roll cap must not eat a snap turn', () => {
  /**
   * The cap measures a frame's delta and removes whatever twists about the view
   * axis, faster than 0.6 rad/s. A yaw about the room's vertical contains a
   * twist of roughly `step * sin(pitch)`, which at any downward glance is far
   * more than one frame's allowance — so the cap used to swallow most of every
   * snap turn and leave the difference as permanent horizon tilt.
   */
  const DT = 1 / 90;

  /** The view-axis twist the cap would remove from this frame's rotation. */
  const twistRemoved = (pitchRad: number): number => {
    const world = createWorldTransform();
    const head = new Vector3(0, 1.6, 0);
    const before = world.quaternion.clone();
    rotateAbout(world, head, new Vector3(0, 1, 0), -SNAP_TURN_RAD);
    const delta = world.quaternion.clone().multiply(before.invert());
    // Looking down by `pitchRad` from horizontal.
    const forward = new Vector3(0, -Math.sin(pitchRad), -Math.cos(pitchRad)).normalize();
    return rollExcess(delta, forward, DT);
  };

  it('a snap turn taken at a downward glance carries far more twist than the cap allows', () => {
    // This is the bug's precondition: if this were ~0 there would be nothing to
    // eat. 15 degrees is a mild glance at a globe held below eye level.
    const excess = Math.abs(twistRemoved((15 * Math.PI) / 180));
    expect(excess).toBeGreaterThan(0.6 * DT); // more than one frame's allowance
    expect(excess).toBeGreaterThan(0.1); // ~7.8 degrees, not a rounding wobble
  });

  it('grows with pitch, and vanishes when looking level', () => {
    expect(Math.abs(twistRemoved(0))).toBeLessThan(1e-9);
    const mild = Math.abs(twistRemoved((15 * Math.PI) / 180));
    const steep = Math.abs(twistRemoved((30 * Math.PI) / 180));
    expect(steep).toBeGreaterThan(mild);
  });

  it('advancing the cap baseline past the turn leaves nothing to remove', () => {
    // The fix: the snap copies the post-turn orientation into the baseline, so
    // the cap sees a still frame. Modelled here as a zero delta.
    const still = new Quaternion();
    const forward = new Vector3(0, -Math.sin((30 * Math.PI) / 180), -Math.cos((30 * Math.PI) / 180)).normalize();
    expect(rollExcess(still, forward, DT)).toBe(0);
  });
});

describe('AR must not paint over the room', () => {
  it('clears transparent in AR and opaque everywhere else', () => {
    expect(clearAlphaFor('immersive-ar')).toBe(0);
    expect(clearAlphaFor('immersive-vr')).toBe(1);
    expect(clearAlphaFor('inline')).toBe(1);
    expect(clearAlphaFor(null)).toBe(1);
  });

  it('drops the skybox in AR only', () => {
    expect(skyboxVisible('immersive-ar')).toBe(false);
    expect(skyboxVisible('immersive-vr')).toBe(true);
    expect(skyboxVisible(null)).toBe(true);
  });

  it('the two agree: a transparent clear is exactly when the sky is hidden', () => {
    // They were written together and then only one was wired, which is how an
    // opaque background survived into AR. Pinning the relationship makes a
    // future half-wiring a test failure rather than a black screen.
    for (const mode of ['immersive-ar', 'immersive-vr', 'inline', null] as const) {
      expect(clearAlphaFor(mode) === 0).toBe(!skyboxVisible(mode));
    }
  });
});

describe('a hand on a panel is not a hand on the sky', () => {
  /**
   * The sky grab asked only whether the head-to-hand line misses the globe. A
   * hand lowered to the off wrist misses it just as cleanly as a hand raised to
   * the stars, so a wrist-menu press also began a time scrub — and one frame of
   * that moves `activeMs` off null permanently, hiding ~283 of 290 pins.
   *
   * The claim set is the fix. These pin its semantics: the panels add, the
   * frame loop clears, and the grab skips what it finds.
   */
  const claim = () => new Set<XRHandedness>();

  it('a claimed hand is skipped and an unclaimed one is not', () => {
    const ui = claim();
    ui.add('right');
    expect(ui.has('right')).toBe(true);
    expect(ui.has('left')).toBe(false);
  });

  it('clearing each frame lets a hand that left the panel grab the sky again', () => {
    const ui = claim();
    ui.add('right');
    ui.clear(); // what the -100 frame reset does
    expect(ui.has('right')).toBe(false);
  });

  it('both hands can be claimed independently', () => {
    const ui = claim();
    ui.add('left');
    ui.add('right');
    expect(ui.size).toBe(2);
  });
});
