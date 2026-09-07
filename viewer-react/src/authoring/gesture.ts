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

/** The shape of a `KeyboardEvent` this module actually reads. Duck-typed for
 *  the same reason `typingInFormField` is: the rule is worth a test, and a test
 *  should not need a DOM to construct a keystroke. */
export interface KeyChord {
  key?: unknown;
  ctrlKey?: unknown;
  metaKey?: unknown;
  shiftKey?: unknown;
  altKey?: unknown;
  /** The element the keystroke was aimed at, if there is one. */
  target?: unknown;
}

/**
 * Does this keystroke mean undo, redo, or neither?
 *
 * Pulled out of the controller because every clause below is a decision with a
 * failure mode, and all of them are invisible until someone hits the exact
 * combination:
 *
 *  - **Text fields are excluded.** The listener lives on `window` (a Cesium
 *    canvas is not focusable, so a listener on it would never fire), which
 *    means it sees Ctrl+Z typed into the toolbar's note field. The browser's
 *    own undo owns a text field, and stealing it there to un-delete a polygon
 *    somewhere else on the globe would be startling and unrecoverable — the
 *    typing is gone and the shape is back.
 *  - **Alt disqualifies.** On several European keyboard layouts AltGr reports
 *    as `ctrlKey && altKey`, so `AltGr+z` (a real character on those layouts)
 *    would otherwise read as undo.
 *  - **Ctrl and Cmd are both accepted**, because this app runs on both and a
 *    user should not have to know which one this particular panel wanted.
 *  - **`Ctrl+Y` is redo, but `Cmd+Y` is not.** Ctrl+Y is the Windows
 *    convention and costs nothing to honour; on macOS Cmd+Y is the browser's
 *    own History window, and taking it would break something the user expects
 *    from every other page.
 *  - **`event.key` is lower-cased** — with Shift held, a browser reports `Z`,
 *    so a case-sensitive comparison silently makes redo do nothing.
 *
 * Returning `null` (rather than a boolean per combination) is what lets the
 * caller leave a keystroke it does not want entirely alone, `preventDefault`
 * included.
 */
export function historyIntent(event: KeyChord | null | undefined): 'undo' | 'redo' | null {
  if (!event || typeof event.key !== 'string') return null;
  if (typingInFormField(event.target)) return null;
  if (event.altKey === true) return null;

  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  if (!ctrl && !meta) return null;

  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey === true ? 'redo' : 'undo';
  if (key === 'y' && ctrl && !meta) return 'redo';
  return null;
}
