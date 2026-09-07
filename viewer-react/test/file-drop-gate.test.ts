/**
 * The window-level file drop, and what "off" has to mean.
 *
 * `attachFileDrop` binds `dragover` and `drop` on the *window* and calls
 * `preventDefault()` on both — it has to, or a near-miss drop navigates the
 * browser to the file and takes the app with it. Inside an `<iframe>` that same
 * listener is hostile: importing is off in embed mode, so it would arm a "drop
 * a file here" overlay over somebody else's page and then swallow the drop,
 * leaving the host's own drag handling dead across the frame's rectangle with
 * nothing to show for it.
 *
 * Gating the *callback* would not have fixed that — the listeners, and the
 * `preventDefault`, would still be there. So `useFileDrop(onFiles, false)` does
 * not call this function at all, and the function itself has no `enabled` flag
 * to get that wrong with.
 *
 * Bound against a stub target rather than `window`: this workspace's suites run
 * in node with no DOM, and a stub is what lets the test ask the question that
 * matters — *what got bound* — rather than only what a rendered overlay says.
 */
import { describe, expect, it, vi } from 'vitest';
import { attachFileDrop, type DropTarget } from '../src/interop/useFileDrop.js';

interface Rec extends DropTarget {
  listeners: Map<string, (e: Event) => void>;
  fire: (type: string, e: unknown) => void;
}

const recorder = (): Rec => {
  const listeners = new Map<string, (e: Event) => void>();
  return {
    listeners,
    addEventListener: (t, fn) => { listeners.set(t, fn); },
    removeEventListener: (t, fn) => { if (listeners.get(t) === fn) listeners.delete(t); },
    fire: (t, e) => listeners.get(t)?.(e as Event),
  };
};

/** A DragEvent stand-in. `types` is what `carriesFiles` reads. */
const drag = (opts: { files?: unknown[]; types?: string[] } = {}) => {
  const e = {
    defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; },
    dataTransfer: { types: opts.types ?? ['Files'], files: opts.files ?? [], dropEffect: 'none' },
  };
  return e;
};

describe('what gets bound', () => {
  it('binds exactly the four drag events', () => {
    const t = recorder();
    attachFileDrop(t, { onFiles: () => {}, onDragging: () => {} });
    expect([...t.listeners.keys()].sort()).toEqual(['dragenter', 'dragleave', 'dragover', 'drop']);
  });

  it('unbinds all four — an embed toggled on and off leaves nothing behind', () => {
    const t = recorder();
    const off = attachFileDrop(t, { onFiles: () => {}, onDragging: () => {} });
    off();
    expect([...t.listeners.keys()]).toEqual([]);
  });
});

describe('while it is bound', () => {
  it('preventDefaults the dragover, without which the drop never fires', () => {
    const t = recorder();
    attachFileDrop(t, { onFiles: () => {}, onDragging: () => {} });
    const e = drag();
    t.fire('dragover', e);
    expect(e.defaultPrevented).toBe(true);
    expect(e.dataTransfer.dropEffect).toBe('copy');
  });

  it('preventDefaults the drop, and delivers the files', () => {
    const t = recorder();
    const onFiles = vi.fn();
    attachFileDrop(t, { onFiles, onDragging: () => {} });
    const file = { name: 'a.geojson' };
    const e = drag({ files: [file] });
    t.fire('drop', e);
    expect(e.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('counts enters against leaves so the overlay does not flicker', () => {
    const t = recorder();
    const onDragging = vi.fn();
    attachFileDrop(t, { onFiles: () => {}, onDragging });
    t.fire('dragenter', drag());   // over the app
    t.fire('dragenter', drag());   // over a child inside it
    t.fire('dragleave', drag());   // leaving the child, still over the app
    expect(onDragging.mock.calls.map((c) => c[0])).toEqual([true, true]);
    t.fire('dragleave', drag());   // now actually out
    expect(onDragging).toHaveBeenLastCalledWith(false);
  });

  it('ignores a drag that carries no files', () => {
    const t = recorder();
    const onDragging = vi.fn();
    attachFileDrop(t, { onFiles: () => {}, onDragging });
    const e = drag({ types: ['text/plain'] });
    t.fire('dragenter', e);
    t.fire('dragover', e);
    expect(onDragging).not.toHaveBeenCalled();
    // And crucially the host page keeps its own default drag behaviour.
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not call back for an empty drop', () => {
    const t = recorder();
    const onFiles = vi.fn();
    attachFileDrop(t, { onFiles, onDragging: () => {} });
    t.fire('drop', drag({ files: [] }));
    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe('once it is unbound', () => {
  it('leaves the dragover alone — the whole reason "off" means unbound', () => {
    const t = recorder();
    attachFileDrop(t, { onFiles: () => {}, onDragging: () => {} })();
    const e = drag();
    t.fire('dragover', e);
    t.fire('drop', e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('delivers nothing', () => {
    const t = recorder();
    const onFiles = vi.fn();
    attachFileDrop(t, { onFiles, onDragging: () => {} })();
    t.fire('drop', drag({ files: [{ name: 'a.kml' }] }));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
