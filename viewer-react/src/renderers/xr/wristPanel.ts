/**
 * How big the wrist panel is, where it hangs off the hand, and when it is worth
 * drawing at all.
 *
 * Split out of `WristMenu.tsx` because it is the part that was wrong, and the
 * part that is arithmetic rather than scene graph. Measured in a live emulated
 * session, the panel was 0.477 m wide read from 0.307 m away: **75.7° across and
 * 52.1° tall**, a slab over the left half of the view, with the rows a comical
 * 4.13° each. Two independent mistakes compounded — the panel was sized for a
 * reading distance it never had, and then lifted 0.2 m up the grip's own axis,
 * which walks it *towards the face* rather than leaving it on the hand.
 *
 * The three numbers this file exists to hold to:
 *
 *  - **Distance.** Published VR guidance puts comfortable UI at 0.5–2 m, below
 *    which vergence and accommodation disagree. Anything held in a hand lives
 *    under that floor by definition, so the honest target is "as far as a hand
 *    goes" — a measured 0.46 m to the grip, 0.45 m to the panel above it — not
 *    0.31 m, which is closer than most people can focus comfortably at all.
 *  - **Legibility.** A row wants ≥1.5° of visual angle and is comfortable near
 *    2°. That is a floor on how small the panel can get *for a given amount of
 *    text*, and it is why shrinking alone could not fix this: at the old 58
 *    characters per row, a hand-sized 0.22 m panel puts rows at 1.3°.
 *  - **Bulk.** What was actually wrong. 75.7° is most of a person's comfortable
 *    field; a panel you consult should be closer to a tablet held to read.
 *    `PANEL_MAX_DEG` is the ceiling the test holds it under; it lands at 27.5°.
 *
 * Those three cannot all be free. Fixing distance and bulk sets the angular
 * budget, and the budget buys 43 characters per row instead of 58 — which is
 * what `memoryLabel` in `memoryIndex.ts` had to give up a field for. See
 * `test/xr-wrist-panel.test.ts`.
 */

/**
 * Panel width in player metres — a small tablet, held.
 *
 * Fixed, and this is the second half of the size bug: the panel used to fix its
 * *height* and take its width from the card's aspect, so a panel with fewer
 * rows came out *wider*. The six-row panel the bundled sample story produces
 * worked out at 0.76 m across, against 0.48 m for a full page of 290 memories.
 * A list grows down, so height is the free dimension.
 */
export const PANEL_WIDTH = 0.22;

/**
 * The card's canvas width in px. With `labelCard`'s metrics (a 26 px row) this
 * is the knob that trades characters per row against angular row height: the
 * panel is always `PANEL_PX / 26` rows wide, whatever it is scaled to. 420 puts
 * rows at 1.73° from the hand and leaves 388 px of text — 43 characters, which
 * carries 90% of a real archive's `title · date` labels whole.
 */
export const PANEL_PX = 420;

/** Gap between the top of the hand and the bottom edge, so fingers cover no row. */
export const HAND_CLEARANCE = 0.02;

/**
 * What the panel is read from: a resting off hand measures 0.46 m from the eye
 * and the panel floats just above it, so 0.45 m. Only the design arithmetic and
 * its test use this — the live scene measures the real pose every frame — but
 * getting it wrong is exactly how the panel ended up sized for a distance it
 * never had.
 *
 * The lift that puts it there is *derived* (`panelLift`) and applied straight
 * up in world space, not along the grip's own axis. That distinction is the
 * whole distance bug: a controller held naturally tilts forward, so its +Y runs
 * up **and back**, and a fixed 0.2 m along it did not raise the panel above the
 * hand so much as swing it into the viewer's face — 0.31 m from the eye, from a
 * hand that was 0.46 m away.
 */
export const READING_DISTANCE = 0.45;

/** Legibility floor and comfortable target for one row, in degrees. */
export const ROW_DEG = { floor: 1.5, comfortable: 2.0 };
/** How wide the whole panel may get before it stops being a held thing. */
export const PANEL_MAX_DEG = 32;

/** Angular size of something `size` metres across, seen from `distance`. */
export function subtendDeg(size: number, distance: number): number {
  if (!(distance > 0)) return 0;
  return (2 * Math.atan(size / 2 / distance) * 180) / Math.PI;
}

/** Panel height for a card of this aspect (width / height). */
export function panelHeight(aspect: number): number {
  return aspect > 0 ? PANEL_WIDTH / aspect : PANEL_WIDTH;
}

/** How far above the grip the panel's centre goes, given its height. */
export function panelLift(height: number): number {
  return HAND_CLEARANCE + height / 2;
}

/**
 * Show the panel when the hand it rides is glanced at, hide it when it is not —
 * with a gap between the two thresholds, because a single one makes a panel
 * that blinks whenever a hand drifts across the boundary.
 *
 * Gaze rather than wrist roll, which is the other convention it could have
 * followed: the panel already turns to face the head every frame, so its
 * readability never depended on wrist rotation, and gaze is the one signal that
 * means the same thing for a controller and for a tracked hand.
 *
 * Measured against the *grip* rather than the panel, because that is the thing
 * a viewer aims their eyes at and it does not wander as rows come and go. An
 * off hand at rest sits 37° off the gaze axis and a glance down at it is under
 * 10°, so the pair has to live inside that band: looking ahead at the globe
 * puts the list away, looking at the hand brings it back.
 */
export const GLANCE_DEG = { on: 22, off: 32 };

/** Whether the panel should be up this frame, given where the hand is relative to the gaze. */
export function glanceVisible(shown: boolean, angleDeg: number): boolean {
  return shown ? angleDeg <= GLANCE_DEG.off : angleDeg <= GLANCE_DEG.on;
}

/** Seconds for the panel to fade all the way in or out. */
export const FADE_SECONDS = 0.14;

/** Step a 0–1 opacity towards `target`, reaching it in `FADE_SECONDS`. */
export function fadeTowards(current: number, target: number, delta: number): number {
  const step = FADE_SECONDS > 0 ? delta / FADE_SECONDS : 1;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return target;
}
