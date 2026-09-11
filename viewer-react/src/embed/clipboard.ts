/**
 * Copying, and what to do when copying is not available.
 *
 * `navigator.clipboard` is not a thing you may assume. It is undefined outside
 * a secure context — which includes the `http://<lan-ip>:4174` a developer uses
 * to test this app from a phone or a headset, exactly where an author would try
 * the embed snippet — and `writeText` *rejects* when the document is not
 * focused or the permission is denied. Atlas's existing share button does
 * `void navigator.clipboard?.writeText(…)` inside a `try`, so in every one of
 * those cases it silently does nothing: the user clicks, sees no change, and
 * pastes whatever was on the clipboard before.
 *
 * So the outcome is a value, not an exception, and the caller must render it.
 * The legacy `document.execCommand('copy')` path is kept because it is the only
 * thing that works in an insecure context, and it is injected rather than
 * called directly so the decision is testable with no DOM.
 */

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export interface CopyDeps {
  /** `navigator.clipboard`, or null/undefined where there is none. */
  clipboard?: ClipboardLike | null;
  /**
   * Selects the text and runs `document.execCommand('copy')`, returning whether
   * the browser reported success. Only reached when the async API is missing or
   * refused.
   */
  legacyCopy?: (() => boolean) | null;
}

export type CopyOutcome =
  /** On the clipboard, via the async API. */
  | 'copied'
  /** On the clipboard, via `execCommand` — same result, different route. */
  | 'copied-legacy'
  /** Nothing was copied. The text must be presented for manual copying. */
  | 'manual';

/** True when the text reached the clipboard by either route. */
export const didCopy = (outcome: CopyOutcome): boolean => outcome !== 'manual';

/**
 * Try to put `text` on the clipboard. Never throws.
 *
 * Note the order: the async API first (it works cross-browser in a secure
 * context and does not disturb the selection), `execCommand` only as a
 * fallback. Note also that a *rejection* falls through to the fallback rather
 * than being reported as failure — a denied permission and a missing API are
 * the same problem from the user's side, and `execCommand` often still works
 * under both.
 */
export async function copyText(text: string, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const { clipboard, legacyCopy } = deps;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return 'copied';
    } catch {
      /* fall through to the legacy path */
    }
  }
  if (typeof legacyCopy === 'function') {
    try {
      if (legacyCopy()) return 'copied-legacy';
    } catch {
      /* fall through to manual */
    }
  }
  return 'manual';
}

/**
 * The visible confirmation. Every branch says something — a copy button whose
 * only feedback is a state you cannot see is the same as no feedback.
 *
 * `label` names what was copied ("Link", "Embed code") so one status line can
 * serve both controls without the reader guessing which one it refers to.
 */
export function copyMessage(outcome: CopyOutcome, label: string, platform?: string): string {
  switch (outcome) {
    case 'copied':
    case 'copied-legacy':
      return `${label} copied to your clipboard.`;
    case 'manual':
      return `${label} selected — your browser blocked the clipboard, so press ${copyShortcut(platform)} to copy.`;
  }
}

/** The part of a text field this module needs. Narrowed to two methods so the
 *  whole flow below can be exercised with no DOM. */
export interface FieldLike {
  focus(): void;
  select(): void;
}

export interface CopyRequest {
  text: string;
  /** Names what was copied, for the status line: "Link", "Embed code". */
  label: string;
  /** The field holding the text — selected when the clipboard is unreachable. */
  field?: FieldLike | null;
  clipboard?: ClipboardLike | null;
  /** `document.execCommand`, injected. */
  execCommand?: ((command: string) => boolean) | null;
  /** `navigator.platform`, for the ⌘C/Ctrl+C hint. */
  platform?: string;
}

export interface CopyStatus {
  text: string;
  /** True when the text reached the clipboard; false when the user must act. */
  ok: boolean;
  outcome: CopyOutcome;
}

/**
 * The whole copy flow, as one value-returning function.
 *
 * It lives here rather than inside the component because the interesting part
 * is what happens when copying *fails*, and that is precisely what a component
 * test cannot reach: the failure needs a browser with no clipboard. As a pure
 * function over injected dependencies it is exercised directly — including the
 * part that matters most, that a blocked clipboard still leaves the text
 * selected so the shortcut the status line names actually does something.
 */
export async function copyWithFallback(req: CopyRequest): Promise<CopyStatus> {
  const { text, label, field, clipboard, execCommand, platform } = req;
  const select = () => { field?.focus(); field?.select(); };
  const outcome = await copyText(text, {
    clipboard,
    legacyCopy: field && typeof execCommand === 'function'
      ? () => { select(); return execCommand('copy'); }
      : null,
  });
  if (outcome === 'manual') select();
  return { text: copyMessage(outcome, label, platform), ok: didCopy(outcome), outcome };
}

/**
 * The keyboard shortcut to name in the fallback message.
 *
 * Told from the platform string rather than the user agent's browser name:
 * getting this wrong ("press Ctrl+C" on a Mac) is the kind of small lie that
 * makes a fallback feel broken. Defaults to the Ctrl form, which is right
 * everywhere except Apple hardware.
 */
export function copyShortcut(platform?: string): string {
  const p = (platform ?? '').toLowerCase();
  return /mac|iphone|ipad|ipod/.test(p) ? '⌘C' : 'Ctrl+C';
}
