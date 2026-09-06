import * as Cesium from 'cesium';
import type { Camera, GeoPoint, Item, TimeSpec } from '@companion-atlas/story';
import {
  addVertex,
  cancelDraft,
  canFinish,
  createDraft,
  editableVertices,
  finishDraft,
  isDrawingMode,
  setHover,
  setMode as setDraftMode,
  snapshot,
  undoVertex,
  type AuthoringMode,
  type DraftSnapshot,
  type DraftState,
} from './draft.js';
import { cameraFromPose, poseFromCamera } from './camera.js';
import { typingInFormField, withinDoubleClick } from './gesture.js';
import {
  addDraftEntities,
  addItemEntities,
  addSelectionHandles,
  createAuthoringDataSource,
  removeByPrefix,
  updateDraftEntities,
  type DraftEntities,
} from './entities.js';
import { DRAFT_VERTEX_PREFIX, MOVE_HANDLE_ID, VERTEX_PREFIX, parsePickedId } from './ids.js';
import { pickEntityId, pickGlobePoint } from './pick.js';
import {
  applyStyle,
  DEFAULT_STYLE,
  mergeStyle,
  styleOf,
  type AuthoringStyle,
} from './style.js';
import {
  findItem,
  moveItem,
  nextItemId,
  removeItem,
  setVertex,
  upsertItem,
  type AuthoringSelection,
} from './store.js';

/**
 * The authoring controller — drawing, editing and deleting on a Cesium globe.
 *
 * ## It never owns a viewer
 *
 * `createAuthoringController` takes a live `Cesium.Viewer` and gives it back
 * untouched on `destroy()`. It does not construct one, does not keep one alive,
 * and treats a destroyed viewer as a no-op rather than an error — because the
 * viewer belongs to `CesiumStoryViewer`, whose React lifecycle can tear it down
 * at any point, including *before* a controller created in a later effect gets
 * its cleanup.
 *
 * `destroy()` therefore has to be exact, and it is the only place anything is
 * released. Everything this controller acquires:
 *
 *   - the `ScreenSpaceEventHandler` (a leaked one survives a React remount and
 *     silently double-handles every click — two vertices per click, and no
 *     error anywhere to explain it),
 *   - the window `keydown` / `pointerup` / `pointercancel` listeners,
 *   - the `CustomDataSource` and every entity in it,
 *   - the viewer's own `LEFT_DOUBLE_CLICK` action, restored to the function
 *     Cesium installed,
 *   - the four `screenSpaceCameraController` flags a vertex drag turns off,
 *   - the cursor class on the widget container.
 *
 * ## What it does not do
 *
 * No React state, no UI. Selection is reported through `onSelect` and pushed
 * back in through `select()`, because the globe already had two "selected"
 * concepts (`focusedId` for a memory pin, `focusedPlace` for a named Place) and
 * a third owned in here would guarantee two highlights lit at once. The
 * consumer decides what a selection means.
 */

export interface AuthoringChange {
  kind: 'add' | 'update' | 'remove' | 'replace';
  /** The item this change concerns; absent for a wholesale `replace`. */
  id?: string;
}

export interface AuthoringControllerOptions {
  /** Fired whenever the authored item list changes. Never fired by
   *  `setItems()` — that is the consumer telling us, not the other way round. */
  onChange?: (items: Item[], change: AuthoringChange) => void;
  /** Fired when the user picks something on the globe, or clears the pick. */
  onSelect?: (selection: AuthoringSelection | null) => void;
  /** Fired as the draft changes, for the toolbar's vertex count and warning. */
  onDraft?: (draft: DraftSnapshot) => void;
  /** Seed style for the first shape. */
  style?: Partial<AuthoringStyle>;
  /** Id prefix for new items — `draw-polygon-1` by default. */
  idPrefix?: string;
  /** Extra ids new shapes must not collide with (the loaded story's). */
  reservedIds?: () => Iterable<string>;
  /** Stamped onto every shape, so drawn geometry sits on the story's timeline
   *  rather than defaulting to the whole span. */
  timeFor?: () => TimeSpec | undefined;
  /**
   * Whether this controller DRAWS the committed items, or only edits them.
   *
   * Defaults to `true`, and that is the safe answer — but it is a real choice,
   * because there are now two things on this globe that can render a `line` or
   * a `polygon`. `renderers/globeCzml.ts` keeps `polyline`/`polygon` packets
   * for the story's CZML data source, so an item that has been merged into the
   * story with `mergeAuthoredItems` AND is held by this controller is drawn
   * twice: two coincident surfaces that z-fight, and two pick targets where the
   * user sees one shape.
   *
   * So pick one owner:
   *
   *   - `true` (default) — keep drawn items in React state and merge them into
   *     the story only when saving, downloading or exporting. The drawing layer
   *     is the only thing rendering them, they appear the instant they are
   *     drawn, and nothing has to re-derive CZML on every vertex drag.
   *   - `false` — merge into the rendered story and let CZML draw them. One
   *     renderer, at the cost of a full `storyToCzml` on every edit. Note that
   *     `keepForGlobe` only passes a `marker`/`note` packet through when the
   *     item's id is in its passthrough set, so this mode needs those ids
   *     included or placed items will silently not appear.
   *
   * Selection handles are drawn either way — they come from the item geometry
   * this controller holds, not from whatever is rendering the shape.
   */
  renderItems?: boolean;
}

export interface AuthoringController {
  setMode(mode: AuthoringMode): void;
  getMode(): AuthoringMode;
  /** Commit the shape in progress. Returns the item, or null with a warning
   *  delivered through `onDraft`. */
  finish(opts?: { allowSelfIntersecting?: boolean }): Item | null;
  /** Escape: drop the shape in progress, keep the tool. */
  cancel(): void;
  /** Backspace: take the last vertex back. */
  undoVertex(): void;
  getDraft(): DraftSnapshot;

  setStyle(patch: Partial<AuthoringStyle>): void;
  getStyle(): AuthoringStyle;
  /** `note` text for the next placed note. */
  setNoteText(text: string): void;
  getNoteText(): string;

  /** Adopt an external item list. Idempotent, and never fires `onChange`. */
  setItems(items: Item[]): void;
  getItems(): Item[];

  select(selection: AuthoringSelection | null): void;
  getSelection(): AuthoringSelection | null;
  /** Delete the selected drawn item. Returns false when nothing was deleted. */
  deleteSelected(): boolean;
  /** Restyle the selected drawn item, writing canonical style fields. */
  restyleSelected(patch: Partial<AuthoringStyle>): boolean;

  /** Read the live viewer camera as a canonical `Camera`. Usable at any time,
   *  in any mode — it has nothing to do with drawing. */
  captureCamera(opts?: { durationMs?: number }): Camera | null;
  /** Fly to a stored `Camera`. The inverse of `captureCamera`. */
  flyToCamera(camera: Camera, opts?: { durationSeconds?: number }): boolean;

  destroy(): void;
}

/** Ask for one frame. `requestRenderMode` is off today (see the long note in
 *  `CesiumStoryViewer`), so this is groundwork — and required the moment it is
 *  turned on, because a plain property set on an entity is invisible to it. */
function nudge(viewer: Cesium.Viewer | null): void {
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
}

export function createAuthoringController(
  viewer: Cesium.Viewer,
  options: AuthoringControllerOptions = {},
): AuthoringController {
  if (!viewer || viewer.isDestroyed()) {
    throw new Error('createAuthoringController needs a live Cesium.Viewer');
  }

  const { onChange, onSelect, onDraft, idPrefix = 'draw', renderItems = true } = options;

  let destroyed = false;
  let draft: DraftState = createDraft('idle');
  let style: AuthoringStyle = mergeStyle(DEFAULT_STYLE, options.style ?? {});
  let noteText = '';
  let items: Item[] = [];
  let selection: AuthoringSelection | null = null;
  let draftEntities: DraftEntities | null = null;

  /** Where the last committed vertex was on screen — the double-click guard. */
  let lastVertexWindow: Cesium.Cartesian2 | null = null;
  /** An in-progress drag of a handle. */
  let drag:
    | { kind: 'vertex'; index: number }
    | { kind: 'move'; last: GeoPoint }
    | null = null;
  /** The camera-controller flags a drag switches off, so they can be put back
   *  exactly as they were rather than forced to `true`. */
  let cameraFlags: { rotate: boolean; translate: boolean; tilt: boolean; look: boolean } | null = null;

  const ds = createAuthoringDataSource();
  const dsAdded = viewer.dataSources.add(ds);
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  /**
   * Cesium's `Viewer` installs its own `LEFT_DOUBLE_CLICK` action that tracks
   * the picked entity (flying the camera to it and locking on). Double-clicking
   * to close a polygon would therefore also fly the camera away from the shape
   * being closed. It is suppressed only while a drawing tool is armed and put
   * back verbatim afterwards, so the app's ordinary behaviour is untouched.
   */
  const viewerHandler = viewer.screenSpaceEventHandler;
  const stockDoubleClick = viewerHandler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  let doubleClickSuppressed = false;

  const container = viewer.container as HTMLElement | undefined;

  // -------------------------------------------------------------------------
  // Emitting
  // -------------------------------------------------------------------------

  const emitDraft = (): void => onDraft?.(snapshot(draft));

  const emitChange = (change: AuthoringChange): void => onChange?.(items, change);

  const sameSelection = (a: AuthoringSelection | null, b: AuthoringSelection | null): boolean =>
    a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

  // -------------------------------------------------------------------------
  // Drawing the layer
  // -------------------------------------------------------------------------

  /** Rebuild every committed item. Cheap enough to do wholesale: the drawing
   *  layer holds shapes a person made by hand, which is tens, not the hundreds
   *  of memory pins that forced `CesiumStoryViewer` to repaint incrementally. */
  const redrawItems = (): void => {
    if (destroyed || viewer.isDestroyed()) return;
    removeByPrefix(ds, 'authoring:');
    removeByPrefix(ds, 'authoring-outline:');
    // De-duplicate by id before adding. `EntityCollection.add` THROWS on a
    // duplicate id, and a throw here would abort the loop and leave the layer
    // half-drawn — `CesiumStoryViewer` guards the memory pins the same way, for
    // the same reason. Our own writes go through `upsertItem` and cannot
    // collide; an array handed in through `setItems` can.
    if (renderItems) {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        addItemEntities(ds, item, selection?.kind === 'item' && selection.id === item.id);
      }
    }
    redrawHandles();
    nudge(viewer);
  };

  const redrawHandles = (): void => {
    removeByPrefix(ds, VERTEX_PREFIX);
    const move = ds.entities.getById(MOVE_HANDLE_ID);
    if (move) ds.entities.remove(move);
    // Handles only while idle. Drawing over a selected shape's handles would
    // make every new vertex a pick target for the drag code instead.
    if (selection?.kind !== 'item' || isDrawingMode(draft.mode)) return;
    const item = findItem(items, selection.id);
    if (item) addSelectionHandles(ds, item);
  };

  const ensureDraftEntities = (): void => {
    if (draftEntities || destroyed) return;
    draftEntities = addDraftEntities(ds, style.color, style.fillOpacity);
  };

  const clearDraftEntities = (): void => {
    if (!draftEntities) return;
    ds.entities.remove(draftEntities.line);
    ds.entities.remove(draftEntities.fill);
    draftEntities = null;
    removeByPrefix(ds, DRAFT_VERTEX_PREFIX);
  };

  const syncDraft = (): void => {
    if (destroyed || viewer.isDestroyed()) return;
    if (!isDrawingMode(draft.mode)) {
      clearDraftEntities();
    } else {
      ensureDraftEntities();
      if (draftEntities) updateDraftEntities(ds, draftEntities, draft);
    }
    emitDraft();
    nudge(viewer);
  };

  const syncCursor = (): void => {
    if (!container) return;
    container.classList.toggle('atlas-drawing', isDrawingMode(draft.mode));
  };

  const syncDoubleClickSuppression = (): void => {
    const shouldSuppress = isDrawingMode(draft.mode);
    if (shouldSuppress === doubleClickSuppressed) return;
    if (viewerHandler.isDestroyed()) return;
    if (shouldSuppress) {
      viewerHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    } else if (stockDoubleClick) {
      viewerHandler.setInputAction(stockDoubleClick, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    }
    doubleClickSuppressed = shouldSuppress;
  };

  // -------------------------------------------------------------------------
  // Committing
  // -------------------------------------------------------------------------

  const reservedIds = (): string[] => [
    ...items.map((i) => i.id),
    ...(options.reservedIds ? Array.from(options.reservedIds()) : []),
  ];

  const commit = (opts?: { allowSelfIntersecting?: boolean }): Item | null => {
    if (destroyed) return null;
    const mode = draft.mode;
    if (!canFinish(draft)) {
      // Not an error — the user pressed Enter early. Say what is missing.
      draft = { ...draft, warning: finishFailureMessage(draft) };
      emitDraft();
      return null;
    }
    const type = mode === 'note' ? 'note' : mode === 'marker' ? 'marker' : mode;
    const result = finishDraft(draft, {
      id: nextItemId(type as Item['type'], reservedIds(), idPrefix),
      style,
      text: noteText,
      time: options.timeFor?.(),
      allowSelfIntersecting: opts?.allowSelfIntersecting,
    });

    // Clear the double-click guard whichever way this went. A refused commit
    // (a self-intersecting ring, a note with no text yet) leaves the user about
    // to click the same spot again once they have fixed it, and a stale guard
    // would silently swallow that click.
    lastVertexWindow = null;

    if (!result.ok) {
      draft = { ...draft, warning: result.message };
      emitDraft();
      return null;
    }

    items = upsertItem(items, result.item);

    // Asymmetric on purpose. A marker or a note is a single click and people
    // place them in runs, so the tool stays armed and nothing is selected —
    // a selection would put drag handles under the next click. A line or a
    // polygon is a deliberate multi-step shape, and the thing you want the
    // instant it closes is to look at it and style it, so it finishes into
    // `idle` with itself selected.
    if (mode === 'line' || mode === 'polygon') {
      draft = createDraft('idle');
      setSelection({ kind: 'item', id: result.item.id, item: result.item }, { emit: true });
    } else {
      draft = cancelDraft(draft);
    }

    redrawItems();
    syncDraft();
    syncCursor();
    syncDoubleClickSuppression();
    emitChange({ kind: 'add', id: result.item.id });
    return result.item;
  };

  const finishFailureMessage = (d: DraftState): string => {
    const need = d.mode === 'polygon' ? 3 : d.mode === 'line' ? 2 : 1;
    return `A ${d.mode} needs at least ${need} point${need === 1 ? '' : 's'} — ${d.vertices.length} placed.`;
  };

  const setSelection = (next: AuthoringSelection | null, { emit }: { emit: boolean }): void => {
    const changed = !sameSelection(selection, next);
    selection = next;
    redrawItems();
    if (changed && emit) onSelect?.(next);
  };

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
    if (destroyed || viewer.isDestroyed()) return;

    if (!isDrawingMode(draft.mode)) {
      // Idle: a click is a selection. Every layer's entity ids are prefixed, so
      // one pick answers "was that a drawn shape, a memory pin, a place, or
      // nothing at all".
      const rawId = pickEntityId(viewer, e.position);
      // The prefix tells us which layer owns the hit. The fallback covers the
      // `renderItems: false` wiring, where a drawn shape is rendered by the
      // story's CZML data source under its BARE item id — without it, clicking
      // your own polygon in that mode would read as "clicked nothing" and
      // deselect.
      const target =
        parsePickedId(rawId) ??
        (rawId && findItem(items, rawId) ? ({ kind: 'item', id: rawId } as const) : null);
      if (!target) {
        setSelection(null, { emit: true });
        return;
      }
      switch (target.kind) {
        case 'item': {
          const item = findItem(items, target.id);
          // Selecting a shape re-arms the tool with THAT shape's style, so the
          // next thing drawn matches what was just clicked rather than
          // whatever the toolbar last had.
          if (item) style = mergeStyle(style, styleOf(item));
          setSelection({ kind: 'item', id: target.id, item: item ?? undefined }, { emit: true });
          break;
        }
        case 'memory':
        case 'place':
          setSelection({ kind: target.kind, id: target.id }, { emit: true });
          break;
        case 'vertex':
        case 'move':
        case 'draft':
          // A handle: the drag path owns it, and a click on it must not
          // deselect the shape it belongs to.
          break;
      }
      return;
    }

    // The second click of a double-click lands here before LEFT_DOUBLE_CLICK
    // does. Drop it — see DOUBLE_CLICK_PIXELS.
    if (withinDoubleClick(lastVertexWindow, e.position)) return;

    const hit = pickGlobePoint(viewer, e.position);
    // A click that missed the globe entirely (the sky occupies half the
    // viewport at story-opening zoom) is ignored rather than producing a
    // vertex at NaN.
    if (!hit) return;

    lastVertexWindow = Cesium.Cartesian2.clone(e.position);
    draft = addVertex(draft, hit.point);

    // Marker and note are done in one click.
    if (draft.mode === 'marker' || draft.mode === 'note') {
      commit();
      return;
    }
    syncDraft();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => {
    if (destroyed || !isDrawingMode(draft.mode)) return;
    // The two LEFT_CLICKs that precede this have already been de-duplicated,
    // so the draft holds exactly the vertices the user placed.
    commit();
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  handler.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
    if (destroyed || viewer.isDestroyed()) return;

    if (drag) {
      const hit = pickGlobePoint(viewer, e.endPosition);
      if (!hit || selection?.kind !== 'item') return;
      const item = findItem(items, selection.id);
      if (!item) return;
      const next =
        drag.kind === 'vertex'
          ? setVertex(item, drag.index, hit.point)
          : moveItem(item, hit.point.lon - drag.last.lon, hit.point.lat - drag.last.lat);
      if (drag.kind === 'move') drag = { kind: 'move', last: hit.point };
      if (next !== item) {
        items = upsertItem(items, next);
        selection = { ...selection, item: next };
        redrawItems();
      }
      return;
    }

    if (!isDrawingMode(draft.mode)) return;
    const hit = pickGlobePoint(viewer, e.endPosition);
    const before = draft;
    draft = setHover(draft, hit?.point ?? null);
    // `setHover` returns the same object when nothing moved, which is what
    // keeps a pointer at rest from re-rendering the toolbar 60 times a second.
    if (draft !== before) syncDraft();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
    if (destroyed || viewer.isDestroyed() || isDrawingMode(draft.mode)) return;
    if (selection?.kind !== 'item') return;
    const target = parsePickedId(pickEntityId(viewer, e.position));
    if (!target) return;

    if (target.kind === 'vertex') {
      drag = { kind: 'vertex', index: target.index };
    } else if (target.kind === 'move') {
      const hit = pickGlobePoint(viewer, e.position);
      if (!hit) return;
      drag = { kind: 'move', last: hit.point };
    } else {
      return;
    }

    // Freeze the camera for the duration. Without this, dragging a vertex also
    // rotates the globe underneath it and the vertex chases the cursor across
    // a moving surface — the handle appears to run away from the pointer.
    // The previous values are captured rather than assumed, so a scene that had
    // already disabled tilt keeps it disabled afterwards.
    const cc = viewer.scene.screenSpaceCameraController;
    cameraFlags = { rotate: cc.enableRotate, translate: cc.enableTranslate, tilt: cc.enableTilt, look: cc.enableLook };
    cc.enableRotate = false;
    cc.enableTranslate = false;
    cc.enableTilt = false;
    cc.enableLook = false;
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  const endDrag = (): void => {
    if (!drag) return;
    drag = null;
    releaseCamera();
    if (selection?.kind === 'item') emitChange({ kind: 'update', id: selection.id });
  };

  const releaseCamera = (): void => {
    if (!cameraFlags || viewer.isDestroyed()) { cameraFlags = null; return; }
    const cc = viewer.scene.screenSpaceCameraController;
    cc.enableRotate = cameraFlags.rotate;
    cc.enableTranslate = cameraFlags.translate;
    cc.enableTilt = cameraFlags.tilt;
    cc.enableLook = cameraFlags.look;
    cameraFlags = null;
  };

  handler.setInputAction(endDrag, Cesium.ScreenSpaceEventType.LEFT_UP);

  /**
   * The same thing again, on `window`.
   *
   * Cesium's `LEFT_UP` only fires for a mouse-up over the canvas. Drag a vertex
   * out over the toolbar (or off the window entirely) and release, and that
   * event never arrives: the drag stays armed and — much worse — the camera
   * stays frozen, so the globe silently stops responding to the mouse with no
   * visible cause. `pointerup` on the window is the backstop, and `endDrag` is
   * idempotent, so the two firing in sequence for an ordinary in-canvas release
   * costs nothing.
   */
  const onWindowPointerUp = (): void => endDrag();
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  const onKeyDown = (event: KeyboardEvent): void => {
    if (destroyed || viewer.isDestroyed()) return;
    if (typingInFormField(event.target)) return;

    if (event.key === 'Escape') {
      if (isDrawingMode(draft.mode) && draft.vertices.length > 0) {
        draft = cancelDraft(draft);
        lastVertexWindow = null;
        syncDraft();
      } else if (selection) {
        setSelection(null, { emit: true });
      } else {
        return;
      }
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter') {
      if (!isDrawingMode(draft.mode)) return;
      event.preventDefault();
      commit();
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (isDrawingMode(draft.mode) && draft.vertices.length > 0) {
        // Backspace still navigates back in some browsers when nothing has
        // focus. Losing a half-drawn shape to a browser navigation is not a
        // recoverable mistake.
        event.preventDefault();
        draft = undoVertex(draft);
        lastVertexWindow = null;
        syncDraft();
        return;
      }
      if (selection?.kind === 'item') {
        event.preventDefault();
        api.deleteSelected();
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  const api: AuthoringController = {
    setMode(mode) {
      if (destroyed || draft.mode === mode) return;
      draft = setDraftMode(draft, mode);
      lastVertexWindow = null;
      // Arming a tool clears the selection: the handles would otherwise sit
      // under the first click of the new shape and swallow it.
      if (isDrawingMode(mode) && selection) setSelection(null, { emit: true });
      syncDraft();
      syncCursor();
      syncDoubleClickSuppression();
      redrawHandles();
    },
    getMode: () => draft.mode,

    finish: (opts) => commit(opts),

    cancel() {
      if (destroyed) return;
      draft = cancelDraft(draft);
      lastVertexWindow = null;
      syncDraft();
    },

    undoVertex() {
      if (destroyed) return;
      draft = undoVertex(draft);
      lastVertexWindow = null;
      syncDraft();
    },

    getDraft: () => snapshot(draft),

    setStyle(patch) {
      if (destroyed) return;
      style = mergeStyle(style, patch);
      // The preview is drawn in the tool's colour, so a colour change mid-shape
      // shows immediately rather than only on the committed result.
      if (draftEntities) {
        clearDraftEntities();
        syncDraft();
      }
    },
    getStyle: () => ({ ...style }),

    setNoteText(text) { noteText = text; },
    getNoteText: () => noteText,

    setItems(next) {
      if (destroyed) return;
      items = [...next];
      // A selection whose item has gone (deleted elsewhere, or a story swap) is
      // dropped rather than left pointing at nothing — stale handles on a shape
      // that no longer exists are draggable and write to a ghost.
      if (selection?.kind === 'item') {
        const item = findItem(items, selection.id);
        selection = item ? { ...selection, item } : null;
      }
      redrawItems();
    },
    getItems: () => [...items],

    select(next) {
      if (destroyed) return;
      const resolved =
        next?.kind === 'item' ? { ...next, item: findItem(items, next.id) ?? undefined } : next;
      setSelection(resolved, { emit: true });
    },
    getSelection: () => (selection ? { ...selection } : null),

    deleteSelected() {
      if (destroyed || selection?.kind !== 'item') return false;
      const id = selection.id;
      if (!findItem(items, id)) return false;
      items = removeItem(items, id);
      setSelection(null, { emit: true });
      redrawItems();
      emitChange({ kind: 'remove', id });
      return true;
    },

    restyleSelected(patch) {
      if (destroyed || selection?.kind !== 'item') return false;
      const item = findItem(items, selection.id);
      if (!item) return false;
      const next = applyStyle(item, patch);
      if (next === item) return false;
      items = upsertItem(items, next);
      selection = { ...selection, item: next };
      style = mergeStyle(style, patch);
      redrawItems();
      emitChange({ kind: 'update', id: next.id });
      return true;
    },

    captureCamera(opts) {
      if (destroyed || viewer.isDestroyed()) return null;
      const cam = viewer.camera;
      const carto = cam.positionCartographic;
      return cameraFromPose(
        {
          longitude: carto.longitude,
          latitude: carto.latitude,
          height: carto.height,
          heading: cam.heading,
          pitch: cam.pitch,
          roll: cam.roll,
        },
        { durationMs: opts?.durationMs },
      );
    },

    flyToCamera(camera, opts) {
      if (destroyed || viewer.isDestroyed()) return false;
      const pose = poseFromCamera(camera);
      if (!pose) return false;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(pose.longitude, pose.latitude, pose.height),
        orientation: { heading: pose.heading, pitch: pose.pitch, roll: pose.roll },
        duration: opts?.durationSeconds ?? (camera.durationMs != null ? camera.durationMs / 1000 : undefined),
      });
      return true;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      // `handler.destroy()` removes its own canvas listeners. Calling it on an
      // already-destroyed handler throws, which would abort the rest of this
      // cleanup and leak everything below it.
      if (!handler.isDestroyed()) handler.destroy();
      releaseCamera();
      drag = null;
      // Put Cesium's own double-click action back exactly as it was.
      if (doubleClickSuppressed && stockDoubleClick && !viewerHandler.isDestroyed()) {
        viewerHandler.setInputAction(stockDoubleClick, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      }
      doubleClickSuppressed = false;
      container?.classList.remove('atlas-drawing');
      // `dataSources.add` resolves on a microtask while `remove` is synchronous,
      // so a controller created and destroyed in the same tick (React 18
      // StrictMode does exactly this) would otherwise have its layer pushed in
      // *after* the removal and left on the globe forever.
      void dsAdded
        .then((added) => {
          if (!viewer.isDestroyed()) viewer.dataSources.remove(added ?? ds, true);
        })
        .catch(() => {
          if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
        });
    },
  };

  // Draw whatever was seeded, and tell the toolbar where it is starting from.
  emitDraft();

  return api;
}

/** Re-exported so a consumer importing only the controller gets the vertex
 *  helper the toolbar's "delete point" affordance needs. */
export { editableVertices };
