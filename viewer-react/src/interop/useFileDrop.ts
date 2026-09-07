/**
 * Window-level drag-and-drop for map files.
 *
 * The drop target is the whole window rather than a bordered rectangle: the
 * thing a person wants to drop a `.kml` onto is the globe, and the globe fills
 * the app. A small drop zone would mean aiming at a box while the obvious
 * target sits behind it.
 *
 * Two behaviours that are easy to get wrong and are the reason this is a hook
 * rather than two inline handlers:
 *
 *  - `dragenter`/`dragleave` fire for every element the pointer crosses, so a
 *    naive boolean flickers off as the cursor moves between children. Counting
 *    enters against leaves is the standard fix.
 *  - The browser's default drop behaviour is to *navigate to the file*, blowing
 *    away the app. Both `dragover` and `drop` must call `preventDefault()`, on
 *    the window, or a near-miss drop still destroys unsaved state.
 *
 * The binding lives in `attachFileDrop` rather than inline in the effect so it
 * can be tested: this workspace's suites run in node with no DOM, and the
 * behaviour that matters here — *whether anything is bound at all* — is
 * invisible to a test that can only look at rendered markup.
 */
import { useEffect, useRef, useState } from 'react';

export interface FileDropState {
  /** True while a drag carrying files is over the window. */
  dragging: boolean;
}

/** Just enough of `window` to bind to. Narrowed so a test can pass a stub —
 *  `window` itself satisfies it. */
export interface DropTarget {
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
}

/** A listener as the DOM types want it, from one written against `DragEvent`.
 *  The cast is unavoidable: `addEventListener` is typed for `Event`, and every
 *  drag listener in the file only ever receives a `DragEvent`. */
const asListener = (fn: (e: DragEvent) => void) => fn as (e: Event) => void;

export interface FileDropHandlers {
  onFiles: (files: File[]) => void;
  /** Called when the overlay should arm or disarm. */
  onDragging: (dragging: boolean) => void;
}

/**
 * Bind the four drag listeners; returns the unbind.
 *
 * Callers that want the feature **off** must not call this at all — see the
 * note in `useFileDrop`. There is deliberately no `enabled` flag here, because
 * a flag would make "off" mean "bound but inert", which is the wrong thing.
 */
export function attachFileDrop(target: DropTarget, handlers: FileDropHandlers): () => void {
  let depth = 0;

  /** Only react to drags that actually carry files — dragging selected text
   *  or an image out of another panel should not arm the overlay. */
  const carriesFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onEnter = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    depth += 1;
    handlers.onDragging(true);
  };

  const onOver = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    // Required, every time: without it the drop never fires and the browser
    // navigates instead.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const onLeave = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) handlers.onDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    handlers.onDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) handlers.onFiles(files);
  };

  const bound: [string, (e: Event) => void][] = [
    ['dragenter', asListener(onEnter)],
    ['dragover', asListener(onOver)],
    ['dragleave', asListener(onLeave)],
    ['drop', asListener(onDrop)],
  ];
  for (const [type, fn] of bound) target.addEventListener(type, fn);
  return () => { for (const [type, fn] of bound) target.removeEventListener(type, fn); };
}

/**
 * @param enabled  When false, **nothing is bound**, rather than the drop being
 *   swallowed in the callback. That distinction is the whole point inside an
 *   `<iframe>`: importing is off in embed mode, and a listener that still
 *   called `preventDefault()` would arm a "drop a file here" overlay over
 *   someone else's page and then eat the drop — the host's own drag handling,
 *   and the browser's, would both stop working across the frame's rectangle for
 *   no benefit to anyone.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true): FileDropState {
  const [dragging, setDragging] = useState(false);
  // Keep the latest callback without re-binding listeners every render.
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    // A previously-armed overlay must also come down, or turning the feature
    // off mid-drag would leave it on screen with nothing listening.
    if (!enabled) { setDragging(false); return; }
    return attachFileDrop(window, {
      onFiles: (files) => handler.current(files),
      onDragging: setDragging,
    });
  }, [enabled]);

  return { dragging };
}
