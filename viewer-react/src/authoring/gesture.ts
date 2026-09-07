/**
 * The two input rules that decide what a click means. Pure, and duck-typed
 * rather than DOM-typed, so they can be tested in node beside the rest of the
 * drawing logic — they are small enough to look obviously correct and both have
 * a failure mode that is invisible until someone tries to draw something.
 */

/** Anything with screen coordinates: a `Cesium.Cartesian2`, a `MouseEvent`. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Two clicks this close together, in PIXELS, are one gesture.
 *
 * Cesium delivers a double-click as `LEFT_CLICK`, `LEFT_CLICK`,
 * `LEFT_DOUBLE_CLICK` — three events, not one — so the gesture that finishes a
 * polygon first tries to add two more vertices.
 *
 * Geometric de-duplication cannot catch this on its own. At street zoom one
 * pixel is roughly half a metre, so a hand that moved two pixels between the
 * two clicks produces two genuinely different `GeoPoint`s and the shape ends
 * with a spurious 1 m segment — and any epsilon large enough to swallow that
 * would also swallow two deliberate adjacent vertices at the same zoom. Screen
 * space is the frame the gesture actually happened in, so that is where it is
 * measured.
 *
 * Six pixels is comfortably inside the ~5 px an OS itself allows for a
 * double-click, and comfortably outside anything a user could mean as two
 * distinct vertices.
 */
export const DOUBLE_CLICK_PIXELS = 6;

/** Is `b` close enough to `a` to be the second half of a double-click? A null
 *  `a` means "nothing has been placed yet", which is never a double-click. */
export function withinDoubleClick(
  a: ScreenPoint | null | undefined,
  b: ScreenPoint,
  tolerance = DOUBLE_CLICK_PIXELS,
): boolean {
  if (!a || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/**
 * Is this keystroke destined for a text field?
 *
 * The drawing shortcuts live on `window`, because a Cesium canvas is not
 * focusable and a key listener on it would never fire. That means Backspace,
 * Enter and Escape are intercepted everywhere — including inside the toolbar's
 * own note-text input, where Backspace must delete a character rather than
 * undoing the last vertex of a shape somewhere else on the globe.
 *
 * Duck-typed: anything with a `tagName` will do, which is what makes this
 * testable without a DOM.
 */
export function typingInFormField(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
