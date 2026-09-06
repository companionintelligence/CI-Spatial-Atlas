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
 */
import { useEffect, useRef, useState } from 'react';

export interface FileDropState {
  /** True while a drag carrying files is over the window. */
  dragging: boolean;
}

export function useFileDrop(onFiles: (files: File[]) => void): FileDropState {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  // Keep the latest callback without re-binding listeners every render.
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    /** Only react to drags that actually carry files — dragging selected text
     *  or an image out of another panel should not arm the overlay. */
    const carriesFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
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
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) handler.current(files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return { dragging };
}
