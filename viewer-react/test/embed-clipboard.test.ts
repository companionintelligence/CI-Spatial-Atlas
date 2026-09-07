/**
 * Copying, and every way it fails.
 *
 * This suite exists because the app's existing share button is
 * `void navigator.clipboard?.writeText(…)` inside a bare `try` — so on an
 * insecure origin (a LAN dev server on a phone or a headset, which is exactly
 * where an author tests an embed) and on a denied permission it does nothing,
 * says nothing, and leaves whatever was on the clipboard before. Each branch
 * below is one of those real conditions.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  copyMessage, copyShortcut, copyText, copyWithFallback, didCopy,
  type ClipboardLike, type FieldLike,
} from '../src/embed/clipboard.js';

const field = (): FieldLike & { focused: number; selected: number } => {
  const f = {
    focused: 0,
    selected: 0,
    focus() { f.focused += 1; },
    select() { f.selected += 1; },
  };
  return f;
};

const working = (): ClipboardLike & { written: string[] } => {
  const c = { written: [] as string[], writeText: async (t: string) => { c.written.push(t); } };
  return c;
};

describe('copyText', () => {
  it('uses the async clipboard when there is one', async () => {
    const clipboard = working();
    expect(await copyText('hello', { clipboard })).toBe('copied');
    expect(clipboard.written).toEqual(['hello']);
  });

  it('falls back to execCommand when there is no clipboard at all', async () => {
    // `navigator.clipboard` is undefined outside a secure context. This is the
    // only route that still works there.
    const legacyCopy = vi.fn(() => true);
    expect(await copyText('hello', { clipboard: null, legacyCopy })).toBe('copied-legacy');
    expect(legacyCopy).toHaveBeenCalledOnce();
  });

  it('falls back when the clipboard rejects, not only when it is missing', async () => {
    // A denied permission and an unfocused document both reject. From the
    // user's side that is the same problem, and execCommand often still works.
    const clipboard: ClipboardLike = { writeText: () => Promise.reject(new Error('NotAllowedError')) };
    const legacyCopy = vi.fn(() => true);
    expect(await copyText('hello', { clipboard, legacyCopy })).toBe('copied-legacy');
  });

  it('reports "manual" when nothing worked, rather than throwing or lying', async () => {
    const clipboard: ClipboardLike = { writeText: () => Promise.reject(new Error('no')) };
    expect(await copyText('hello', { clipboard, legacyCopy: () => false })).toBe('manual');
    expect(await copyText('hello', {})).toBe('manual');
  });

  it('survives an execCommand that throws', async () => {
    const legacyCopy = () => { throw new Error('boom'); };
    expect(await copyText('hello', { clipboard: null, legacyCopy })).toBe('manual');
  });

  it('knows which outcomes actually reached the clipboard', () => {
    expect(didCopy('copied')).toBe(true);
    expect(didCopy('copied-legacy')).toBe(true);
    expect(didCopy('manual')).toBe(false);
  });
});

describe('the whole flow, as the panel runs it', () => {
  it('confirms a copy by name, so one status line can serve two buttons', async () => {
    const status = await copyWithFallback({ text: '<iframe>', label: 'Embed code', clipboard: working() });
    expect(status.ok).toBe(true);
    expect(status.text).toBe('Embed code copied to your clipboard.');
  });

  it('leaves the text selected when the clipboard is blocked', async () => {
    // This is the whole point of the fallback. The status line says "press
    // ⌘C" — if the text were not selected, following that instruction would
    // copy something else, which is a worse lie than saying nothing.
    const f = field();
    const status = await copyWithFallback({
      text: 'snippet', label: 'Embed code', field: f, clipboard: null, platform: 'MacIntel',
    });
    expect(status.ok).toBe(false);
    expect(f.selected).toBeGreaterThan(0);
    expect(f.focused).toBeGreaterThan(0);
    expect(status.text).toContain('⌘C');
  });

  it('selects before asking execCommand to copy — the order execCommand needs', async () => {
    // `document.execCommand('copy')` copies the *current selection*. Calling it
    // without selecting first returns true and copies nothing, which is the
    // silent success this codebase keeps producing.
    const f = field();
    const order: string[] = [];
    f.select = () => { order.push('select'); };
    const status = await copyWithFallback({
      text: 'snippet',
      label: 'Link',
      field: f,
      clipboard: null,
      execCommand: (cmd) => { order.push(`exec:${cmd}`); return true; },
    });
    expect(order).toEqual(['select', 'exec:copy']);
    expect(status.outcome).toBe('copied-legacy');
  });

  it('does not try the legacy route when there is no field to select', async () => {
    const status = await copyWithFallback({
      text: 'x', label: 'Link', clipboard: null, execCommand: () => true,
    });
    expect(status.outcome).toBe('manual');
  });
});

describe('the shortcut named in the fallback', () => {
  it('follows the platform, because "press Ctrl+C" on a Mac reads as broken', () => {
    expect(copyShortcut('MacIntel')).toBe('⌘C');
    expect(copyShortcut('iPhone')).toBe('⌘C');
    expect(copyShortcut('Win32')).toBe('Ctrl+C');
    expect(copyShortcut('Linux x86_64')).toBe('Ctrl+C');
    expect(copyShortcut(undefined)).toBe('Ctrl+C');
  });

  it('says something for every outcome — a silent button is the bug', () => {
    for (const outcome of ['copied', 'copied-legacy', 'manual'] as const) {
      expect(copyMessage(outcome, 'Link').length).toBeGreaterThan(0);
    }
  });
});
