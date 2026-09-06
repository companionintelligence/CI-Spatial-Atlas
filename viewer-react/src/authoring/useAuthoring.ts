import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Cesium from 'cesium';
import type { Camera, Item, Story } from '@companion-atlas/story';
import { createAuthoringController, type AuthoringController } from './controller.js';
import { createDraft, snapshot, type AuthoringMode, type DraftSnapshot } from './draft.js';
import { describeCamera } from './camera.js';
import { DEFAULT_STYLE, mergeStyle, type AuthoringStyle } from './style.js';
import { authoredItems, storyIds, type AuthoringSelection } from './store.js';
import type { AuthoringToolbarProps } from './Toolbar.js';

/**
 * The React binding: controller lifecycle + the state the toolbar renders.
 *
 * Same shape as `layers/useLayers.ts` — the hook owns the React state and the
 * imperative object owns the globe, and the two are joined in one place so a
 * consumer never has to think about the order in which a Cesium viewer becomes
 * available.
 *
 * ## The viewer arrives late, and can leave
 *
 * `CesiumStoryViewer` hands its viewer over a frame or more after mount
 * (Resium assigns `cesiumElement` on a later tick) and hands `null` back on
 * unmount. So the controller is created in an effect keyed on the viewer, and
 * every call the toolbar can make goes through a ref that is simply absent
 * before it exists. No queueing, no "not ready" error — pressing a tool button
 * one frame early is a no-op, and the button is disabled for that frame anyway
 * because there is nothing to draw on.
 *
 * ## Who owns `items`
 *
 * React does. The controller reports every change through `onChange` and the
 * hook mirrors it into state; the state is what `AtlasApp` merges into the
 * story. The reverse direction (`setItems`) exists for loading a saved story,
 * and is guarded against the obvious loop: an array the controller itself just
 * emitted is never pushed back into it.
 */

export interface UseAuthoringOptions {
  /** The story being edited — used only for id collision avoidance, and to
   *  re-adopt shapes drawn in a previous session. */
  story?: Story | null;
  /** Turn the whole feature off without unmounting the consumer. */
  enabled?: boolean;
  /** Seed style. */
  style?: Partial<AuthoringStyle>;
  /** Notified whenever the drawn set changes, for persistence. */
  onItemsChange?: (items: Item[]) => void;
  /** Notified when the user picks something — including memory pins and places,
   *  so the app's existing selection state can follow one model. */
  onSelect?: (selection: AuthoringSelection | null) => void;
  /** Pass `false` when the drawn items are merged into the rendered story and
   *  drawn by its CZML instead — see `AuthoringControllerOptions.renderItems`,
   *  which explains why the two must not both be on. */
  renderItems?: boolean;
}

export interface AuthoringControl {
  /** Whether the globe is ready to be drawn on. */
  ready: boolean;
  mode: AuthoringMode;
  setMode: (mode: AuthoringMode) => void;
  draft: DraftSnapshot;
  style: AuthoringStyle;
  /** Applies to the armed tool AND to the current selection, so one control
   *  serves "what I am about to draw" and "what I just clicked". */
  setStyle: (patch: Partial<AuthoringStyle>) => void;
  noteText: string;
  setNoteText: (text: string) => void;
  selection: AuthoringSelection | null;
  select: (selection: AuthoringSelection | null) => void;
  items: Item[];
  setItems: (items: Item[]) => void;
  finish: () => void;
  cancel: () => void;
  undoVertex: () => void;
  deleteSelected: () => void;
  /** Read the live camera. Returns the value AND stores it as `camera`. */
  captureCamera: () => Camera | null;
  camera: Camera | null;
  flyToCamera: (camera: Camera) => void;
  /** Spread straight into `<AuthoringToolbar {...toolbarProps} />`. */
  toolbarProps: AuthoringToolbarProps;
}

export function useAuthoring(
  viewer: Cesium.Viewer | null,
  options: UseAuthoringOptions = {},
): AuthoringControl {
  const { story = null, enabled = true } = options;

  const [mode, setModeState] = useState<AuthoringMode>('idle');
  const [draft, setDraft] = useState<DraftSnapshot>(() => snapshot(createDraft('idle')));
  const [style, setStyleState] = useState<AuthoringStyle>(() => mergeStyle(DEFAULT_STYLE, options.style ?? {}));
  const [noteText, setNoteTextState] = useState('');
  const [selection, setSelectionState] = useState<AuthoringSelection | null>(null);
  const [items, setItemsState] = useState<Item[]>([]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [ready, setReady] = useState(false);

  const controllerRef = useRef<AuthoringController | null>(null);
  /** The last array the controller emitted. Compared by identity so the sync
   *  effect below never hands the controller back the array it just produced —
   *  which would rebuild every entity on every draw. */
  const emittedRef = useRef<Item[] | null>(null);

  // Latest callbacks without re-creating the controller (which would tear down
  // the layer and the handlers) every time the consumer re-renders.
  const onItemsChangeRef = useRef(options.onItemsChange);
  onItemsChangeRef.current = options.onItemsChange;
  const onSelectRef = useRef(options.onSelect);
  onSelectRef.current = options.onSelect;
  const storyRef = useRef(story);
  storyRef.current = story;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !enabled) {
      setReady(false);
      return;
    }
    const controller = createAuthoringController(viewer, {
      style,
      renderItems: options.renderItems,
      reservedIds: () => storyIds(storyRef.current),
      onChange: (next, change) => {
        emittedRef.current = next;
        setItemsState(next);
        onItemsChangeRef.current?.(next);
        // A change that replaced the selected item's geometry leaves the stale
        // copy in `selection.item`; re-read it so a style panel bound to the
        // selection is never a step behind.
        if (change.id) {
          setSelectionState((current) =>
            current?.kind === 'item' && current.id === change.id
              ? controller.getSelection()
              : current,
          );
        }
      },
      onSelect: (next) => {
        setSelectionState(next);
        // Selecting a shape re-arms the tool with its style (the controller
        // does this internally); mirror it so the toolbar shows the truth.
        setStyleState(controller.getStyle());
        onSelectRef.current?.(next);
      },
      onDraft: setDraft,
    });
    controllerRef.current = controller;
    setReady(true);
    // Adopt anything already drawn (a reloaded story, or a viewer remount).
    const existing = emittedRef.current ?? authoredItems(storyRef.current);
    if (existing.length > 0) {
      controller.setItems(existing);
      setItemsState(existing);
    }
    setModeState(controller.getMode());

    return () => {
      controllerRef.current = null;
      setReady(false);
      controller.destroy();
    };
    // `style` is intentionally absent: it seeds the controller once, and every
    // later change goes through `setStyle` below. Including it would destroy
    // and rebuild the whole drawing layer on every colour click.
    // `renderItems` IS a dependency — changing which layer owns the drawing has
    // to rebuild it, or the shapes would be left drawn by nobody (or by both).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, enabled, options.renderItems]);

  const setMode = useCallback((next: AuthoringMode) => {
    controllerRef.current?.setMode(next);
    setModeState(controllerRef.current?.getMode() ?? next);
  }, []);

  const setStyle = useCallback((patch: Partial<AuthoringStyle>) => {
    const controller = controllerRef.current;
    if (!controller) {
      setStyleState((s) => mergeStyle(s, patch));
      return;
    }
    // Restyle the selection when there is one — `restyleSelected` already
    // folds the patch into the tool's style, so this is not two writes.
    if (!controller.restyleSelected(patch)) controller.setStyle(patch);
    setStyleState(controller.getStyle());
  }, []);

  const setNoteText = useCallback((text: string) => {
    controllerRef.current?.setNoteText(text);
    setNoteTextState(text);
  }, []);

  const select = useCallback((next: AuthoringSelection | null) => {
    controllerRef.current?.select(next);
    setSelectionState(controllerRef.current?.getSelection() ?? next);
  }, []);

  const setItems = useCallback((next: Item[]) => {
    emittedRef.current = next;
    controllerRef.current?.setItems(next);
    setItemsState(next);
  }, []);

  const finish = useCallback(() => { controllerRef.current?.finish(); }, []);
  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setModeState(controllerRef.current?.getMode() ?? 'idle');
  }, []);
  const undoVertex = useCallback(() => { controllerRef.current?.undoVertex(); }, []);
  const deleteSelected = useCallback(() => { controllerRef.current?.deleteSelected(); }, []);

  const captureCamera = useCallback((): Camera | null => {
    const next = controllerRef.current?.captureCamera() ?? null;
    if (next) setCamera(next);
    return next;
  }, []);

  const flyToCamera = useCallback((next: Camera) => { controllerRef.current?.flyToCamera(next); }, []);

  // `mode` can change from inside the controller too — finishing a polygon
  // drops back to `idle` — so mirror it whenever the draft snapshot moves.
  useEffect(() => { setModeState(draft.mode); }, [draft.mode]);

  const toolbarProps = useMemo<AuthoringToolbarProps>(() => ({
    mode,
    onMode: setMode,
    draft,
    onFinish: finish,
    onCancel: cancel,
    onUndoVertex: undoVertex,
    style,
    onStyle: setStyle,
    noteText,
    onNoteText: setNoteText,
    selection,
    onDelete: deleteSelected,
    onCaptureCamera: () => { captureCamera(); },
    capturedCamera: camera ? `Captured · ${describeCamera(camera)}` : null,
    open: enabled,
  }), [
    mode, setMode, draft, finish, cancel, undoVertex, style, setStyle,
    noteText, setNoteText, selection, deleteSelected, captureCamera, camera, enabled,
  ]);

  return {
    ready,
    mode, setMode,
    draft,
    style, setStyle,
    noteText, setNoteText,
    selection, select,
    items, setItems,
    finish, cancel, undoVertex, deleteSelected,
    captureCamera, camera, flyToCamera,
    toolbarProps,
  };
}
