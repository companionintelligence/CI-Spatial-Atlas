import * as Cesium from 'cesium';
import type { Camera, GeoPoint, Item, TimeSpec } from '@companion-atlas/story';
import {
  addVertex,
  cancelDraft,
  canFinish,
  COMMIT_ON_CLICK_MODES,
  createDraft,
  editableVertices,
  finishDraft,
  isDrawingMode,
  isMeasureMode,
  setHover,
  setMode as setDraftMode,
  snapshot,
  undoVertex,
  type AuthoringMode,
  type DraftSnapshot,
  type DraftState,
} from './draft.js';
import { cameraFromPose, poseFromCamera } from './camera.js';
import { historyIntent, typingInFormField, withinDoubleClick } from './gesture.js';
import {
  addDraftEntities,
  addItemEntities,
  addSelectionHandles,
  createAuthoringDataSource,
  MEASURE_COLOR,
  removeByPrefix,
  updateDraftEntities,
  updateMeasureEntities,
  type DraftEntities,
} from './entities.js';
import {
  measurementOf,
  type Measurement,
  type MeasureMode,
  type MeasureUnits,
} from './measure.js';
import {
  createHistory,
  currentItems,
  describeAction,
  record,
  redo as redoHistory,
  resetHistory,
  sameSummary,
  summarize,
  undo as undoHistory,
  type HistoryActionKind,
  type HistoryState,
  type HistorySummary,
} from './history.js';
import { DRAFT_VERTEX_PREFIX, MOVE_HANDLE_ID, VERTEX_PREFIX, parsePickedId } from './ids.js';
import { pickEntityId, pickEntityPosition, pickGlobePoint } from './pick.js';
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
 * ## Disabled is not destroyed
 *
 * `setEnabled(false)` and `destroy()` are not two strengths of the same thing.
 * Closing the draw toolbar used to run the effect cleanup and therefore
 * `destroy()`, which removes the `CustomDataSource` — so every finished shape
 * vanished off the globe the moment the panel closed. The items were still in
 * React state and came back when the toolbar re-opened, which made it worse
 * rather than better: the user watched their work disappear and had no reason
 * to believe it would return. So the controller now lives as long as the
 * viewer, and `enabled` gates only input and the draft preview.
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
  /** Fired when the retained measurement is taken, replaced or cleared. Never
   *  carries an `Item` — a measurement is not one. See `measure.ts`. */
  onMeasure?: (measurement: Measurement | null) => void;
  /** Fired when undo/redo availability changes, so a toolbar can enable its
   *  buttons. Only when the ANSWER changes, not on every recorded action. */
  onHistory?: (summary: HistorySummary) => void;
  /** Which units the on-globe measurement label is written in. One setting for
   *  the whole feature — see `measure.ts`. */
  units?: MeasureUnits;
  /** Free-draw or click-points. See `measure.ts`. */
  measureMode?: MeasureMode;
  /** Seed style for the first shape. */
  style?: Partial<AuthoringStyle>;
  /** Id prefix for new items — `draw-polygon-1` by default. */
  idPrefix?: string;
  /** Extra ids new shapes must not collide with (the loaded story's). */
  reservedIds?: () => Iterable<string>;
  /** Stamped onto every shape, so drawn geometry sits on the story's timeline
   *  rather than defaulting to the whole span. */
  timeFor?: () => TimeSpec | undefined;
  /** Whether input is live at construction. See `setEnabled` — a disabled
   *  controller still owns and draws its shapes, it just cannot be drawn on. */
  enabled?: boolean;
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
  /**
   * Arm or disarm *input*, without touching what is already drawn.
   *
   * This is the whole difference between closing the draw toolbar and throwing
   * the user's work away. `destroy()` removes the `CustomDataSource` and every
   * shape in it; disabling only stops the handlers from acting, drops the shape
   * in progress and hides the selection handles. The committed shapes stay on
   * the globe, because from the user's side they are finished work that happens
   * not to have a toolbar open over it — closing a panel that says "Draw" is
   * not a request to erase drawings.
   *
   * The handlers stay registered rather than being torn off and re-attached:
   * a `ScreenSpaceEventHandler` built and destroyed on every toggle is exactly
   * the leak `destroy()` documents, and one that survives a remount
   * double-handles every click.
   */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;

  setMode(mode: AuthoringMode): void;
  getMode(): AuthoringMode;
  /**
   * Commit the shape in progress. Returns the item, or null with a warning
   * delivered through `onDraft`.
   *
   * Returns null in `measure` mode **and takes the measurement instead** — the
   * gesture that finishes a line and the gesture that finishes a measurement are
   * the same double-click, so they share an entry point, and this is the one
   * place the two diverge. Read `getMeasurement()` for the result.
   */
  finish(opts?: { allowSelfIntersecting?: boolean }): Item | null;
  /**
   * Stage a vertex without a click — how the address box places a pin.
   *
   * Goes through the same `addVertex` the pointer does, so a single-vertex mode
   * still holds exactly one point and every rule about what a draft may contain
   * is stated once. Returns false when the mode is not drawing or the
   * coordinate is not finite.
   */
  placePoint(point: { lat: number; lon: number }): boolean;
  /** Escape: drop the shape in progress, keep the tool. */
  cancel(): void;
  /** Backspace: take the last vertex back of the shape IN PROGRESS. Unrelated
   *  to `undo()` below — see the header of `history.ts`. */
  undoVertex(): void;
  getDraft(): DraftSnapshot;

  /** The measurement retained from the last completed measure gesture, or null.
   *  Never an `Item`, never in the story, never persisted. */
  getMeasurement(): Measurement | null;
  /** Drop the retained measurement and its geometry off the globe. */
  clearMeasurement(): void;
  setUnits(units: MeasureUnits): void;
  getUnits(): MeasureUnits;
  /** Free-draw or click-points — see `measure.ts`. Switching mode mid-reading
   *  cancels whatever is in progress: a path with some vertices placed freely
   *  and others snapped to pins would have no honest way to show which is
   *  which, so a mode change starts the reading over rather than mixing them. */
  setMeasureMode(mode: MeasureMode): void;
  getMeasureMode(): MeasureMode;

  /**
   * Step the committed item list back / forward one action.
   *
   * Returns whether anything actually moved, which is what lets the key handler
   * leave Ctrl+Z to the browser when this controller has nothing to undo.
   */
  undo(): boolean;
  redo(): boolean;
  getHistory(): HistorySummary;

  setStyle(patch: Partial<AuthoringStyle>): void;
  getStyle(): AuthoringStyle;
  /** `note` text for the next placed note. */
  setNoteText(text: string): void;
  getNoteText(): string;
  /**
   * The name the next committed marker carries — in practice the address a
   * reverse lookup found for the staged point.
   *
   * Separate from `noteText` because they are different fields on different
   * item types, and because an empty one is fatal for a note and merely means
   * "unnamed" for a marker.
   */
  setPlaceLabel(label: string): void;
  getPlaceLabel(): string;

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

  const {
    onChange, onSelect, onDraft, onMeasure, onHistory,
    idPrefix = 'draw', renderItems = true,
  } = options;

  let destroyed = false;
  /** Input gate. `false` means every handler below returns early; it says
   *  nothing about what is drawn — see `setEnabled`. */
  let enabled = options.enabled !== false;
  let draft: DraftState = createDraft('idle');
  let style: AuthoringStyle = mergeStyle(DEFAULT_STYLE, options.style ?? {});
  let noteText = '';
  /** The address the staged marker will be named after. Cleared whenever the
   *  point it described goes away, so a pin can never inherit the previous
   *  pin's street. */
  let placeLabel = '';
  let items: Item[] = [];
  let selection: AuthoringSelection | null = null;
  let draftEntities: DraftEntities | null = null;
  /** The last completed measurement. Session-lived, never an `Item`, never
   *  written anywhere — see the header of `measure.ts` for why it survives a
   *  tool change and why it dies with the session. */
  let measurement: Measurement | null = null;
  let units: MeasureUnits = options.units ?? 'metric';
  let measureMode: MeasureMode = options.measureMode ?? 'free';
  /** Undo/redo over the committed items. Starts empty and is re-based by
   *  `setItems` — see `resetHistory`. */
  let history: HistoryState = createHistory([]);
  let historySummary: HistorySummary = summarize(history);

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

  /** Every input path starts here. Three separate reasons to ignore an event —
   *  the controller is gone, the tools are disarmed, or the viewer was torn
   *  down under us — and they read identically at the call site. */
  const inert = (): boolean => destroyed || !enabled || viewer.isDestroyed();

  // -------------------------------------------------------------------------
  // Emitting
  // -------------------------------------------------------------------------

  const emitDraft = (): void => onDraft?.(snapshot(draft));

  const emitChange = (change: AuthoringChange): void => onChange?.(items, change);

  /** Fire `onHistory` only when the answer to "can I undo?" actually moved.
   *  Recording an action while five are already stacked changes nothing the
   *  toolbar renders, and firing anyway would re-render it on every vertex
   *  drag release for no visible difference. */
  const emitHistory = (): void => {
    const next = summarize(history);
    if (sameSummary(historySummary, next)) return;
    historySummary = next;
    onHistory?.(next);
  };

  /**
   * Record one committed action.
   *
   * Called AFTER `items` has already moved, and reads the live value rather
   * than taking it as an argument — a signature that let a caller record a
   * different array from the one it just installed is a signature that will
   * eventually be handed one.
   */
  const remember = (kind: HistoryActionKind, itemType?: string, coalesceKey?: string): void => {
    history = record(history, items, { kind, label: describeAction(kind, itemType), coalesceKey });
    emitHistory();
  };

  const syncMeasure = (): void => {
    if (destroyed || viewer.isDestroyed()) return;
    updateMeasureEntities(ds, measurement, units);
    nudge(viewer);
  };

  const setMeasurement = (next: Measurement | null): void => {
    // `null → null` happens on every Escape with nothing measured; firing for it
    // would make a consumer re-render for a keystroke that did nothing.
    if (measurement === null && next === null) return;
    measurement = next;
    syncMeasure();
    onMeasure?.(next);
  };

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
    // The measure tool's rubber band is drawn in the measure colour, not in the
    // style the shape tools are set to. Otherwise a user who had picked teal
    // would watch a teal dashed line appear under the measure tool and
    // reasonably conclude they were drawing one.
    draftEntities = isMeasureMode(draft.mode)
      ? addDraftEntities(ds, MEASURE_COLOR, 0.12)
      : addDraftEntities(ds, style.color, style.fillOpacity);
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

  /**
   * Finish a measurement.
   *
   * Deliberately a sibling of `commit`, not a branch inside it: the two share a
   * gesture and share nothing else. This one allocates no id, stamps no
   * `source`, never touches `items`, and therefore cannot reach `onChange`,
   * `writeItems`, the history, or `mergeAuthoredItems`. Keeping the item path
   * and the measurement path physically separate is what makes "a measurement
   * never ends up in an export" a property of the code rather than a promise.
   *
   * The tool stays armed and the draft resets, because measuring is something
   * people do in runs — check this distance, then that one — and having to
   * re-arm between readings would be the same friction as re-drawing.
   */
  const commitMeasurement = (): Measurement | null => {
    if (destroyed) return null;
    const next = measurementOf(draft.vertices);
    if (!next) {
      draft = { ...draft, warning: 'A measurement needs at least two points.' };
      emitDraft();
      return null;
    }
    setMeasurement(next);
    draft = createDraft('measure');
    lastVertexWindow = null;
    syncDraft();
    return next;
  };

  const commit = (opts?: { allowSelfIntersecting?: boolean }): Item | null => {
    if (destroyed) return null;
    const mode = draft.mode;
    // Measuring finishes on the same double-click and the same Enter, and must
    // not fall through to anything that allocates an id.
    if (isMeasureMode(mode)) {
      commitMeasurement();
      return null;
    }
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
      title: placeLabel.trim() || undefined,
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
    // The name belonged to the point that has just become an item. Leaving it
    // set would name the next pin after the last pin's street.
    placeLabel = '';
    // Same reasoning, for the same "placed in runs" tool: leaving text set
    // would let the first note's words get silently reused as the second
    // pin's, placed right after it. The React-visible copy of `noteText` is
    // cleared by `useAuthoring`'s `onChange` handler, which is the one place
    // that already knows a committed item's type — clearing it here keeps
    // this controller's OWN state correct even before that round-trips back.
    if (mode === 'note') noteText = '';

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
    // History before `onChange`, so a consumer that reads `getHistory()` from
    // inside its change handler (the React binding does exactly this) sees the
    // step that produced the items it was just handed.
    remember('create', result.item.type);
    emitChange({ kind: 'add', id: result.item.id });
    return result.item;
  };

  const finishFailureMessage = (d: DraftState): string => {
    const need = d.mode === 'polygon' ? 3 : d.mode === 'line' ? 2 : 1;
    return `A ${d.mode} needs at least ${need} point${need === 1 ? '' : 's'} — ${d.vertices.length} placed.`;
  };

  /**
   * Install the item list a history step points at.
   *
   * Returns false when the step did not move, which is how the key handler
   * decides whether it may claim Ctrl+Z.
   *
   * The selection is reconciled rather than preserved blindly. An undo can make
   * the selected item vanish (undoing its creation) or change shape (undoing a
   * drag), and a stale `selection.item` is not a cosmetic problem: the vertex
   * handles are drawn from it and are live drag targets, so handles left over a
   * shape that no longer exists write to a ghost. A restored item is NOT
   * auto-selected — the shape reappearing is the feedback, and selecting it
   * would put drag handles under a pointer the user has not moved.
   */
  const applyHistory = (next: HistoryState): boolean => {
    if (next === history) return false;
    history = next;
    items = currentItems(history);
    if (selection?.kind === 'item') {
      const item = findItem(items, selection.id);
      selection = item ? { ...selection, item } : null;
      // Re-arm the tool with the restored shape's style, exactly as clicking it
      // would. Without this, undoing a restyle leaves the swatch lit on the
      // colour that was just taken away — the shape is teal again and the panel
      // still says orange, and the next shape drawn comes out orange.
      if (item) style = mergeStyle(style, styleOf(item));
      redrawItems();
      // Emitted unconditionally, NOT through `setSelection`. Its identity guard
      // compares kind and id only, so an undo that changed the selected item's
      // geometry or style without changing its id would be suppressed — and the
      // panel would stay bound to a version of the shape that no longer exists.
      onSelect?.(selection);
    } else {
      redrawItems();
    }
    emitHistory();
    // `replace`, not `update`: an undo can move any number of items at once, so
    // there is no single id to name.
    emitChange({ kind: 'replace' });
    return true;
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
    if (inert()) return;

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
        case 'measure':
          // A retained measurement is scenery. Clicking through it must not
          // deselect the shape being worked on — the measurement is very often
          // drawn right across the thing it was taken about — and it must not
          // become a selection of its own, because it is not an item and every
          // control the selection panel offers (delete, restyle, drag) would be
          // a control that does nothing.
          break;
      }
      return;
    }

    // A click while measuring places a measurement point and nothing else.
    // `commit()` refuses measure mode above, so this cannot allocate an id.

    // The second click of a double-click lands here before LEFT_DOUBLE_CLICK
    // does. Drop it — see DOUBLE_CLICK_PIXELS.
    if (withinDoubleClick(lastVertexWindow, e.position)) return;

    // "Click points": the vertex comes from whatever pin is under the cursor,
    // not from the terrain beneath it — see `measure.ts`. A click that misses
    // every pin does nothing rather than quietly falling back to a terrain
    // point, which would make the mode toggle meaningless: the very next
    // reading could mix an exact pin position with an eyeballed one with no
    // way to tell which was which from the number on screen.
    if (isMeasureMode(draft.mode) && measureMode === 'points') {
      const pinned = pickEntityPosition(viewer, e.position);
      if (!pinned) return;
      lastVertexWindow = Cesium.Cartesian2.clone(e.position);
      draft = addVertex(draft, pinned);
      syncDraft();
      return;
    }

    const hit = pickGlobePoint(viewer, e.position);
    // A click that missed the globe entirely (the sky occupies half the
    // viewport at story-opening zoom) is ignored rather than producing a
    // vertex at NaN.
    if (!hit) return;

    lastVertexWindow = Cesium.Cartesian2.clone(e.position);
    draft = addVertex(draft, hit.point);

    // A note is done in one click — its text was typed before the click, so
    // there is nothing left to confirm. A marker is not: it stages, so the
    // author can read back where it landed (and what address that is) and press
    // Finish, or click again to move it.
    if (COMMIT_ON_CLICK_MODES.includes(draft.mode)) {
      commit();
      return;
    }
    syncDraft();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => {
    if (inert() || !isDrawingMode(draft.mode)) return;
    // The two LEFT_CLICKs that precede this have already been de-duplicated,
    // so the draft holds exactly the vertices the user placed.
    commit();
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  handler.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
    if (inert()) return;

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
    if (inert() || isDrawingMode(draft.mode)) return;
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

  /**
   * End a drag — and record it as exactly ONE history entry.
   *
   * This is where the granularity question is answered, and it is answered by
   * *when* rather than by coalescing. `MOUSE_MOVE` above rewrites `items` on
   * every pointer sample and deliberately records nothing; the entry is written
   * here, once, on release. So the state one step back in history is the state
   * before the drag began — which is what "undo that drag" has to mean, and
   * which no amount of merging after the fact could reconstruct as reliably.
   *
   * It is also why `emitChange` has always fired here rather than per sample:
   * the React binding writes `localStorage` on every change, and a drag that
   * fired per sample would write it sixty times a second.
   */
  const endDrag = (): void => {
    if (!drag) return;
    const kind = drag.kind;
    drag = null;
    releaseCamera();
    if (selection?.kind === 'item') {
      remember(kind === 'vertex' ? 'vertex' : 'move', selection.item?.type);
      emitChange({ kind: 'update', id: selection.id });
    }
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
    // `inert()` is the "only while the authoring surface is armed" gate: a
    // disarmed controller must not eat the app's Ctrl+Z, and `typingInFormField`
    // is the "never while focus is in a text field" one — the browser's own undo
    // owns a text field. Both are checked before anything else, for every key.
    if (inert()) return;
    if (typingInFormField(event.target)) return;

    // Undo/redo. `preventDefault` ONLY when something actually moved: with an
    // empty history this controller has no claim on the keystroke, and
    // swallowing it would leave the user pressing Ctrl+Z at a page where
    // nothing at all responds.
    const intent = historyIntent(event);
    if (intent) {
      const moved = intent === 'undo' ? api.undo() : api.redo();
      if (moved) event.preventDefault();
      return;
    }

    if (event.key === 'Escape') {
      if (isDrawingMode(draft.mode) && draft.vertices.length > 0) {
        draft = cancelDraft(draft);
        lastVertexWindow = null;
        syncDraft();
      } else if (measurement && isMeasureMode(draft.mode)) {
        // Only while the measure tool is armed. Escape has to stay predictable
        // for someone who measured half an hour ago, armed the polygon tool and
        // is now pressing Escape to abandon a shape — that keystroke is about
        // the shape, and clearing a measurement they had left up on purpose
        // would be an unrelated loss.
        setMeasurement(null);
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
    setEnabled(next) {
      if (destroyed || next === enabled) return;
      enabled = next;
      if (!enabled) {
        // Everything transient goes; everything committed stays. A drag in
        // flight is ended rather than abandoned, because `endDrag` is what puts
        // the four camera flags back — leaving them off would freeze the globe
        // with no visible cause and no armed tool to explain it.
        endDrag();
        draft = createDraft('idle');
        lastVertexWindow = null;
        // Handles are live drag targets, so a selected shape must give them up
        // even though the shape itself stays drawn.
        setSelection(null, { emit: true });
        // A measurement goes with the tools, and this is the one thing it does
        // NOT survive. Finished shapes stay because they are the user's work;
        // a measurement is a reading taken while working, and leaving one
        // floating over a globe with no toolbar to explain or clear it is
        // exactly the stray-annotation confusion `measure.ts` is written to
        // avoid. History is kept — disarming is not a reason to lose the ability
        // to undo, and re-arming and pressing Ctrl+Z has to still work.
        setMeasurement(null);
      }
      syncDraft();
      syncCursor();
      syncDoubleClickSuppression();
    },
    isEnabled: () => enabled,

    setMode(mode) {
      if (destroyed || draft.mode === mode) return;
      // Arming a tool that cannot receive a click would draw a live preview
      // over a globe that ignores it. Disabled means idle, and stays idle.
      if (!enabled && isDrawingMode(mode)) return;
      draft = setDraftMode(draft, mode);
      lastVertexWindow = null;
      // Drop the preview entities so the next `ensureDraftEntities` builds them
      // for the tool now armed. They are created once and reused, so without
      // this a switch from the polygon tool to measure would keep drawing the
      // rubber band in the polygon's colour — the shape would be right and the
      // colour would be lying about which tool is live.
      clearDraftEntities();
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

    setPlaceLabel(label) { placeLabel = label; },
    getPlaceLabel: () => placeLabel,

    placePoint(point) {
      if (destroyed || !isDrawingMode(draft.mode)) return false;
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return false;
      const before = draft.vertices.length;
      draft = addVertex(draft, { lat: point.lat, lon: point.lon });
      // `addVertex` rejects a non-finite point by returning the same draft, and
      // for a single-vertex mode a replacement leaves the count unchanged — so
      // identity, not length, is what says whether anything happened.
      if (draft.vertices.length === before && before > 0 && draft.vertices[0]?.lat !== point.lat) return false;
      lastVertexWindow = null;
      syncDraft();
      return true;
    },

    cancel() {
      if (destroyed) return;
      draft = cancelDraft(draft);
      placeLabel = '';
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

    getMeasurement: () => (measurement ? { ...measurement, points: [...measurement.points] } : null),

    clearMeasurement() {
      if (destroyed) return;
      setMeasurement(null);
    },

    setUnits(next) {
      if (destroyed || next === units) return;
      units = next;
      // Redraw the label immediately. A units toggle that changed the panel but
      // left "1.24 km" written on the globe would be two answers to one
      // question, and the one on the globe is the one being looked at.
      syncMeasure();
    },
    getUnits: () => units,

    setMeasureMode(next) {
      if (destroyed || next === measureMode) return;
      measureMode = next;
      // A path with some vertices placed freely and others snapped to a pin's
      // exact position would have no honest way to show which is which on
      // screen — start the reading over rather than let the two blend.
      if (isMeasureMode(draft.mode) && draft.vertices.length > 0) {
        draft = cancelDraft(draft);
        lastVertexWindow = null;
        syncDraft();
      }
    },
    getMeasureMode: () => measureMode,

    undo() {
      if (destroyed) return false;
      return applyHistory(undoHistory(history));
    },

    redo() {
      if (destroyed) return false;
      return applyHistory(redoHistory(history));
    },

    getHistory: () => ({ ...historySummary }),

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
      // A list the user did not author in this session — hydration from
      // storage, a story load, a scope change on sign-in — is a new baseline,
      // not an undoable step. Undoing back *through* a story load would restore
      // a different document's shapes; back through a scope change, another
      // account's. See the header of `history.ts`.
      history = resetHistory(history, items);
      emitHistory();
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
      const item = findItem(items, id);
      if (!item) return false;
      items = removeItem(items, id);
      setSelection(null, { emit: true });
      redrawItems();
      // The reason this whole feature exists: before history, this line was the
      // end of that shape. There was no undo of any kind over committed items,
      // so a mis-aimed Delete key destroyed a minute's work permanently.
      remember('delete', item.type);
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
      // Coalesced per item. The fill-opacity slider fires on every pixel of
      // travel and there is no release event this controller can see, so
      // without a key here one drag of that slider would fill the entire
      // fifty-step history with a shape getting 5% more opaque — and the undo
      // the user actually wanted would be off the end of it. The time window in
      // `record` is what keeps "restyle, pause, restyle again" as two steps.
      remember('restyle', next.type, `restyle:${next.id}`);
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
