import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Cesium from 'cesium';
import type { Camera, Item, Story } from '@companion-atlas/story';
import { createAuthoringController, type AuthoringController } from './controller.js';
import { createDraft, snapshot, type AuthoringMode, type DraftSnapshot } from './draft.js';
import { describeCamera } from './camera.js';
import { geocode, reverseGeocode, type GeoPlace } from '../memory/geocode.js';
import { createHistory, summarize, type HistorySummary } from './history.js';
import type { Measurement, MeasureMode, MeasureUnits } from './measure.js';
import { DEFAULT_STYLE, mergeStyle, type AuthoringStyle } from './style.js';
import { storyIds, type AuthoringSelection } from './store.js';
import { hydrateItems, readItems, writeItems, type AuthoringStorage } from './persist.js';
import type { AuthoringToolbarProps } from './Toolbar.js';

/** Stable across renders, so a caller who never passes `hiddenCategories`
 *  does not retrigger the live-sync effect below on every render. */
const EMPTY_HIDDEN: ReadonlySet<Item['type']> = new Set();

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
 * ## `enabled` disarms, it does not unmount
 *
 * `enabled` is deliberately NOT a dependency of the controller effect. It was
 * once, and the cleanup that ran on every toggle called `destroy()`, which
 * removes the drawing layer and every shape in it: closing the draw toolbar
 * wiped the globe. The items survived in state and reappeared when Draw was
 * re-armed, which is the worst of both — the user sees their work deleted and
 * has no reason to trust that it came back by design.
 *
 * So the controller is created once per viewer and lives as long as it does,
 * and `enabled` is pushed in through `setEnabled` to gate input and the draft
 * preview. `destroy()` still runs on viewer teardown, where it must: a leaked
 * `ScreenSpaceEventHandler` survives a React remount and double-handles every
 * click, which shows up as two vertices per click and nothing in the console.
 *
 * ## Who owns `items`
 *
 * React does. The controller reports every change through `onChange` and the
 * hook mirrors it into state; the state is what `AtlasApp` merges into the
 * story. The reverse direction (`setItems`) exists for loading a saved story,
 * and is guarded against the obvious loop: an array the controller itself just
 * emitted is never pushed back into it.
 *
 * ## Persistence
 *
 * Every change is written straight to `localStorage` from the same place that
 * mirrors it into state — never from an effect on `[items, scope]`. That is not
 * a style preference: on a scope change the effect ordering would hand the
 * *previous* account's items to the new account's key before the re-render that
 * loads the new one, silently copying one person's shapes into another's
 * bucket. Writing where the change happens means a write only ever describes a
 * change the user just made, under the scope in force when they made it.
 */

export interface UseAuthoringOptions {
  /** The story being edited — used only for id collision avoidance, and to
   *  re-adopt shapes drawn in a previous session. */
  story?: Story | null;
  /** Arms the tools. `false` disarms input and drops the shape in progress;
   *  it does NOT remove what is already drawn — see the note above. */
  enabled?: boolean;
  /** Persistence bucket — the account id (the connected memory's URL, as
   *  `useLayers` uses it). `null` is the signed-out bucket, which still
   *  persists; nothing is inherited across scopes. See `persist.ts`. */
  scope?: string | null;
  /** Injected in tests. `undefined` means localStorage; an explicit `null`
   *  means do not persist at all. */
  storage?: AuthoringStorage | null;
  /** Seed style. */
  style?: Partial<AuthoringStyle>;
  /** Notified whenever the drawn set changes — on a draw, an edit, a delete,
   *  and on hydration from storage. Persistence is handled in here (see
   *  `scope`); this is for the app routing the same items into Save. */
  onItemsChange?: (items: Item[]) => void;
  /** Notified when the user picks something — including memory pins and places,
   *  so the app's existing selection state can follow one model. */
  onSelect?: (selection: AuthoringSelection | null) => void;
  /** Pass `false` when the drawn items are merged into the rendered story and
   *  drawn by its CZML instead — see `AuthoringControllerOptions.renderItems`,
   *  which explains why the two must not both be on. */
  renderItems?: boolean;
  /**
   * Which units measurements are reported in. Seeds the setting; the toolbar's
   * own toggle takes over from there.
   *
   * Deliberately NOT persisted alongside the drawn shapes. `persist.ts`'s bucket
   * is scoped to the connected account and holds *content*; a display preference
   * is neither, and threading one through a scope that resolves after an auth
   * round trip would mean the first render of every session shows the wrong
   * units and then flips. A per-session default is honest about what it is.
   */
  units?: MeasureUnits;
  /** Free-draw or click-points. Same per-session-only reasoning as `units`. */
  measureMode?: MeasureMode;
  /** Notified when a measurement is taken, replaced or cleared. It is never an
   *  `Item` and never reaches the story — see `measure.ts`. */
  onMeasure?: (measurement: Measurement | null) => void;
  /** Item types to leave off the globe — the top-nav visibility toggle. Unlike
   *  `units`/`measureMode`, this is not a seed: it is owned entirely outside
   *  this hook (by whatever renders the toggle's checkboxes) and pushed to the
   *  live controller on every change, the same way `enabled` is. */
  hiddenCategories?: ReadonlySet<Item['type']>;
}

export interface AuthoringControl {
  /** Whether a controller is mounted on a live viewer. Note this is about the
   *  globe, not about `enabled`: a disarmed controller is still `ready`, and
   *  still drawing the shapes it holds. */
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
  /** Take back the last point of the shape IN PROGRESS. Not `undo` — see the
   *  header of `history.ts`. */
  undoVertex: () => void;
  deleteSelected: () => void;

  /** The retained measurement, or null. Never an `Item`, never in `items`,
   *  never merged into a story. */
  measurement: Measurement | null;
  clearMeasurement: () => void;
  units: MeasureUnits;
  setUnits: (units: MeasureUnits) => void;
  measureMode: MeasureMode;
  setMeasureMode: (mode: MeasureMode) => void;

  /** Step the committed items back / forward one authoring action. */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What the next undo would take back, e.g. `"delete area"`. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** Read the live camera. Returns the value AND stores it as `camera`. */
  /** Stage the pin at a coordinate, with no click. */
  placePoint: (point: { lat: number; lon: number }) => boolean;
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
  const { story = null, enabled = true, scope = null, hiddenCategories = EMPTY_HIDDEN } = options;

  const [mode, setModeState] = useState<AuthoringMode>('idle');
  const [draft, setDraft] = useState<DraftSnapshot>(() => snapshot(createDraft('idle')));
  const [style, setStyleState] = useState<AuthoringStyle>(() => mergeStyle(DEFAULT_STYLE, options.style ?? {}));
  const [noteText, setNoteTextState] = useState('');
  const [selection, setSelectionState] = useState<AuthoringSelection | null>(null);
  const [items, setItemsState] = useState<Item[]>([]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [ready, setReady] = useState(false);
  const [measurement, setMeasurementState] = useState<Measurement | null>(null);
  const [units, setUnitsState] = useState<MeasureUnits>(options.units ?? 'metric');
  const [measureMode, setMeasureModeState] = useState<MeasureMode>(options.measureMode ?? 'free');
  const [historyState, setHistoryState] = useState<HistorySummary>(() => summarize(createHistory([])));
  /** The address of the staged pin, and what the lookup is doing. `idle` before
   *  a point exists; `none` when the lookup came back with nothing, which is a
   *  real answer (mid-ocean) and not an error. */
  const [placeLabel, setPlaceLabelState] = useState('');
  const [placeState, setPlaceState] = useState<'idle' | 'looking' | 'found' | 'none'>('idle');
  const [addressResults, setAddressResults] = useState<GeoPlace[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);

  const controllerRef = useRef<AuthoringController | null>(null);
  /** The last array the controller emitted. Compared by identity so the sync
   *  effect below never hands the controller back the array it just produced —
   *  which would rebuild every entity on every draw. */
  const emittedRef = useRef<Item[] | null>(null);
  /** The items as of *now*, readable from an effect that must not re-run when
   *  they change. The creation effect re-adopts this on a viewer remount, so a
   *  remount is not a data loss. */
  const itemsRef = useRef<Item[]>(items);
  itemsRef.current = items;
  /** Whether the user has changed the drawn set since it was hydrated. It is
   *  the difference between "adopt the story's shapes too" and "what I hold IS
   *  the set" — without it, a viewer remount would resurrect a shape the story
   *  carries and the user has since deleted. */
  const dirtyRef = useRef(false);
  /** `enabled` is read at construction but is not a dependency — see the note
   *  at the top. The ref is what keeps the two facts from contradicting: a
   *  controller built while the toolbar is closed starts disarmed. */
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Storage is read once per scope and written on every change; keeping the
  // injected instance out of the deps means a caller passing an object literal
  // cannot cause a re-read loop (the same guard `useLayers` uses).
  const storageRef = useRef(options.storage);
  storageRef.current = options.storage;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Latest callbacks without re-creating the controller (which would tear down
  // the layer and the handlers) every time the consumer re-renders.
  const onItemsChangeRef = useRef(options.onItemsChange);
  onItemsChangeRef.current = options.onItemsChange;
  const onSelectRef = useRef(options.onSelect);
  onSelectRef.current = options.onSelect;
  const onMeasureRef = useRef(options.onMeasure);
  onMeasureRef.current = options.onMeasure;
  /** Read at construction only, like `enabled` — every later change goes
   *  through `setUnits` on the live controller. Making it a dependency would
   *  destroy the drawing layer to change a label from metres to feet. */
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  /** Read at construction only, like `enabled` — every later change goes
   *  through `setHiddenCategories` on the live controller, below. */
  const hiddenCategoriesRef = useRef(hiddenCategories);
  hiddenCategoriesRef.current = hiddenCategories;
  const storyRef = useRef(story);
  storyRef.current = story;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) {
      setReady(false);
      return;
    }
    const controller = createAuthoringController(viewer, {
      style,
      enabled: enabledRef.current,
      units: unitsRef.current,
      measureMode: measureModeRef.current,
      renderItems: options.renderItems,
      hiddenCategories: hiddenCategoriesRef.current,
      reservedIds: () => storyIds(storyRef.current),
      onChange: (next, change) => {
        emittedRef.current = next;
        itemsRef.current = next;
        dirtyRef.current = true;
        setItemsState(next);
        // Persist from here rather than from an effect on `[items, scope]`:
        // this fires only for a change the user actually made, under the scope
        // that was in force when they made it.
        writeItems(scopeRef.current, next, storageRef.current);
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
        // A note just placed: the text that named it belongs to that note
        // now, not to whichever one gets placed next in the same run — see
        // `commit()`'s own reset of its internal copy, for the same reason.
        // `setNoteTextState` directly, not the `setNoteText` wrapper below:
        // that also writes back into the controller, which has already reset
        // itself, and this closure runs inside the controller-creation effect,
        // before `setNoteText` exists as a binding.
        if (change.kind === 'add' && change.id && next.find((item) => item.id === change.id)?.type === 'note') {
          setNoteTextState('');
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
      onMeasure: (next) => {
        setMeasurementState(next);
        onMeasureRef.current?.(next);
      },
      // Fires only when the ANSWER changes (the controller compares before
      // emitting), so this does not re-render the toolbar on every recorded
      // action once undo is already available.
      onHistory: setHistoryState,
    });
    controllerRef.current = controller;
    setReady(true);
    // Adopt anything already drawn. Until the user has touched the set, that is
    // the story's own shapes with whatever we hydrated merged on top; once they
    // have, what we hold IS the set — re-merging the story here would undo a
    // deletion every time the viewer remounts.
    const existing = dirtyRef.current
      ? itemsRef.current
      : hydrateItems(storyRef.current, itemsRef.current);
    if (existing.length > 0) {
      emittedRef.current = existing;
      itemsRef.current = existing;
      controller.setItems(existing);
      setItemsState(existing);
    }
    setModeState(controller.getMode());
    // A remount takes the CustomDataSource with it, so the measurement's
    // geometry is genuinely gone — the panel must not go on reporting a reading
    // for a line that is no longer on the globe. History is re-based by the
    // `setItems` above and read back here rather than assumed.
    setMeasurementState(null);
    setHistoryState(controller.getHistory());

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
    // `enabled` is NOT, and must never become one: its cleanup is `destroy()`,
    // which takes the drawing layer and every finished shape with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, options.renderItems]);

  // Arm/disarm the live controller. Split from creation on purpose: this is the
  // toggle that used to tear the whole layer down. `ready` is a dependency so a
  // controller created while the toolbar is already open still gets the state
  // it was constructed with re-asserted, which costs nothing (`setEnabled` is a
  // no-op when the value has not moved).
  useEffect(() => {
    controllerRef.current?.setEnabled(enabled);
  }, [enabled, ready]);

  // Same reasoning, same shape: pushed to the live controller rather than a
  // construction-time seed, because the toggle that owns this value lives
  // entirely outside this hook and can flip at any time.
  useEffect(() => {
    controllerRef.current?.setHiddenCategories(hiddenCategories);
  }, [hiddenCategories, ready]);

  /**
   * Hydrate from storage whenever the scope resolves or changes.
   *
   * The account id arrives after the auth round trip, so this runs at least
   * twice in a normal session — the same reason `useLayers` and `useScrapbook`
   * re-read on their scope.
   *
   * Stored shapes are merged ON TOP of the ones the loaded story already
   * carries, and win on an id collision: both describe the same drawn shape,
   * and the stored copy is the one that may hold edits made after the last
   * save. Anything in the story that was never drawn in this browser survives
   * the merge rather than being replaced by an empty bucket.
   */
  useEffect(() => {
    const next = hydrateItems(storyRef.current, readItems(scope, storageRef.current));
    // A new scope means a new set, edited or not: whatever the user did under
    // the previous account is that account's, and is already written there.
    dirtyRef.current = false;
    // Nothing to adopt and nothing held: leave state alone rather than handing
    // the controller a fresh empty array and rebuilding the layer for it.
    if (next.length === 0 && itemsRef.current.length === 0) return;
    emittedRef.current = next;
    itemsRef.current = next;
    controllerRef.current?.setItems(next);
    setItemsState(next);
    // Hydration changes the drawn set, so anything routing items into Save has
    // to hear about it. Safe to fire even if the consumer answers with
    // `setItems`: that path never loops back through `onItemsChange`.
    onItemsChangeRef.current?.(next);
    // `story` is read through a ref: a story that loads after the first read
    // does not re-run hydration, because the controller effect adopts its
    // authored items itself and re-reading here would clobber a shape the user
    // drew in the meantime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

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
    itemsRef.current = next;
    dirtyRef.current = true;
    controllerRef.current?.setItems(next);
    setItemsState(next);
    // Loading a saved story replaces the drawn set, so the bucket has to follow
    // it — otherwise the next reload would resurrect the shapes it replaced.
    writeItems(scopeRef.current, next, storageRef.current);
  }, []);

  const finish = useCallback(() => { controllerRef.current?.finish(); }, []);
  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setModeState(controllerRef.current?.getMode() ?? 'idle');
  }, []);
  const undoVertex = useCallback(() => { controllerRef.current?.undoVertex(); }, []);
  const deleteSelected = useCallback(() => { controllerRef.current?.deleteSelected(); }, []);

  // Undo/redo go through the controller rather than being reimplemented over
  // React state, for the same reason `items` does: the controller is what holds
  // the Cesium entities, the selection and the history, and a second copy of
  // any of the three would be a second copy to keep in step.
  const undo = useCallback(() => { controllerRef.current?.undo(); }, []);
  const redo = useCallback(() => { controllerRef.current?.redo(); }, []);

  const clearMeasurement = useCallback(() => { controllerRef.current?.clearMeasurement(); }, []);

  const setUnits = useCallback((next: MeasureUnits) => {
    controllerRef.current?.setUnits(next);
    // Mirrored into React state whether or not a controller exists yet: the
    // toolbar's toggle has to reflect the press even one frame before the
    // viewer arrives, or it reads as a dead control.
    setUnitsState(next);
  }, []);

  const setMeasureMode = useCallback((next: MeasureMode) => {
    controllerRef.current?.setMeasureMode(next);
    setMeasureModeState(next);
  }, []);

  /** Put the pin at a coordinate without a click — the address box's route in. */
  const placePoint = useCallback((point: { lat: number; lon: number }): boolean =>
    controllerRef.current?.placePoint(point) ?? false, []);

  /**
   * Name the staged pin. Mirrored into the controller so the value is on the
   * item the *next* commit produces, rather than being React state the commit
   * path would have to reach back into.
   */
  const setPlaceLabel = useCallback((label: string) => {
    setPlaceLabelState(label);
    controllerRef.current?.setPlaceLabel(label);
  }, []);

  /** Look an address up. Results are offered, never auto-placed: picking the
   *  wrong Springfield should cost a click, not a mystery pin. */
  const searchAddress = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) { setAddressResults([]); return; }
    setAddressBusy(true);
    try {
      setAddressResults(await geocode(q, { limit: 5 }));
    } finally {
      setAddressBusy(false);
    }
  }, []);

  /** Place one of those results and adopt its label as the pin's name. */
  const useAddress = useCallback((place: GeoPlace) => {
    if (!placePoint({ lat: place.lat, lon: place.lon })) return;
    setPlaceLabel(place.label);
    setPlaceState('found');
    setAddressResults([]);
  }, [placePoint, setPlaceLabel]);

  const captureCamera = useCallback((): Camera | null => {
    const next = controllerRef.current?.captureCamera() ?? null;
    if (next) setCamera(next);
    return next;
  }, []);

  const flyToCamera = useCallback((next: Camera) => { controllerRef.current?.flyToCamera(next); }, []);

  // `mode` can change from inside the controller too — finishing a polygon
  // drops back to `idle` — so mirror it whenever the draft snapshot moves.
  useEffect(() => { setModeState(draft.mode); }, [draft.mode]);

  /**
   * Ask what is at the staged pin, whenever the pin moves.
   *
   * Keyed on the rounded coordinate rather than on the draft object: the draft
   * is a fresh object on every hover frame, and a lookup per frame would be a
   * request per frame at a public geocoder. Five decimal places is about a
   * metre — finer than anyone can click and finer than any address is.
   *
   * A label the author has already accepted from the address box is not
   * overwritten: they picked that row on purpose, and the reverse lookup for
   * the same coordinate often answers with something blunter.
   */
  const staged = draft.point;
  const stagedKey = staged ? `${staged.lat.toFixed(5)},${staged.lon.toFixed(5)}` : null;
  const adoptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stagedKey || !staged || mode !== 'marker') {
      // The pin is gone — so is anything we knew about it.
      if (!stagedKey) { setPlaceState('idle'); setPlaceLabelState(''); adoptedRef.current = null; }
      return;
    }
    if (adoptedRef.current === stagedKey) return;
    adoptedRef.current = stagedKey;

    const ac = new AbortController();
    setPlaceState('looking');
    void reverseGeocode(staged.lat, staged.lon, { signal: ac.signal }).then((place) => {
      if (ac.signal.aborted) return;
      if (place) {
        setPlaceLabelState(place.label);
        controllerRef.current?.setPlaceLabel(place.label);
        setPlaceState('found');
      } else {
        setPlaceLabelState('');
        controllerRef.current?.setPlaceLabel('');
        setPlaceState('none');
      }
    });
    return () => ac.abort();
    // `staged` is read through the key, which is what changes meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedKey, mode]);

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
    placeLabel,
    placeState,
    onPlaceLabel: setPlaceLabel,
    addressResults,
    addressBusy,
    onSearchAddress: (q: string) => { void searchAddress(q); },
    onUseAddress: useAddress,
    selection,
    onDelete: deleteSelected,
    onCaptureCamera: () => { captureCamera(); },
    capturedCamera: camera ? `Captured · ${describeCamera(camera, units)}` : null,
    measurement,
    onClearMeasurement: clearMeasurement,
    units,
    onUnits: setUnits,
    measureMode,
    onMeasureMode: setMeasureMode,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    undoLabel: historyState.undoLabel,
    redoLabel: historyState.redoLabel,
    onUndo: undo,
    onRedo: redo,
    open: enabled,
  }), [
    mode, setMode, draft, finish, cancel, undoVertex, style, setStyle,
    noteText, setNoteText, selection, deleteSelected, captureCamera, camera, enabled,
    measurement, clearMeasurement, units, setUnits, measureMode, setMeasureMode, historyState, undo, redo,
    placeLabel, placeState, setPlaceLabel, addressResults, addressBusy, searchAddress, useAddress,
  ]);

  return {
    ready,
    placePoint,
    mode, setMode,
    draft,
    style, setStyle,
    noteText, setNoteText,
    selection, select,
    items, setItems,
    finish, cancel, undoVertex, deleteSelected,
    measurement, clearMeasurement, units, setUnits, measureMode, setMeasureMode,
    undo, redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    undoLabel: historyState.undoLabel,
    redoLabel: historyState.redoLabel,
    captureCamera, camera, flyToCamera,
    toolbarProps,
  };
}
