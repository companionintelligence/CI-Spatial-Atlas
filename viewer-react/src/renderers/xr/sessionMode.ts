/**
 * Which sky, if any, the session should draw.
 *
 * In `immersive-ar` the headset composites the scene over the room's real
 * camera feed, so anything that fills the background — the starfield, the sun
 * and moon, the night shell — is not atmosphere but an occluder: it paints out
 * the passthrough the mode exists to show. The globe should hang in the user's
 * actual room instead.
 *
 * Kept as a pure function so the rule is testable without a headset, a session
 * or a renderer.
 */
export type XRMode = 'immersive-ar' | 'immersive-vr' | 'inline' | null | undefined;

export function skyboxVisible(mode: XRMode): boolean {
  return mode !== 'immersive-ar';
}

/**
 * AR also needs the canvas itself to be see-through. R3F clears to an opaque
 * colour by default, which produces a black rectangle where the room should be
 * — the single most common way an otherwise-correct AR scene ships broken.
 */
export function clearAlphaFor(mode: XRMode): number {
  return mode === 'immersive-ar' ? 0 : 1;
}
