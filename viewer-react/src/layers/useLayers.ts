import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendLayer,
  layersOutsideWindow,
  lowerLayer,
  moveLayerToIndex,
  raiseLayer,
  removeLayer as removeFromStack,
  renameLayer as renameInStack,
  setLayerOpacity as setOpacityInStack,
  setLayerVisible,
  stackTopFirst,
  toggleLayer as toggleInStack,
  type AtlasLayer,
  type LayerFormat,
} from './model.js';
import { layerFromCatalog, type CatalogEntry } from './catalog.js';
import { readLayers, writeLayers, type LayerStorage } from './store.js';
import { draftLayer, probeLayerFormat, sniffLayerFormat, type LayerDraftResult } from './sniff.js';
import { fromStoryLayers, toStoryLayers, withStoryLayers } from './story.js';
import type { Layer, Story } from '@companion-atlas/story';

/**
 * The layer stack as a React value: state, persistence and the operations the
 * panel needs, in one object.
 *
 * Everything interesting lives in the pure modules next door — this only owns
 * the `useState` and the two effects. That split is what lets the ordering,
 * sniffing, storage and availability rules be tested without a DOM (the pattern
 * the `xr-*` suites follow), and it means a non-React surface (the XR wrist
 * menu, a headless export) can use the same model.
 */

export interface AddLayerOptions {
  /** `undefined`/'auto' sniffs from the URL, then from the response. */
  format?: LayerFormat | 'auto';
  name?: string;
  /** Skip the network probe (tests, and the catalog's one-click adds). */
  probe?: boolean;
}

export interface LayerControl {
  /** Draw order, bottom first — what the scene adapter consumes. */
  layers: AtlasLayer[];
  /** Panel order, topmost first. */
  stack: AtlasLayer[];
  count: number;
  /** Switched on but excluded by the current clock time. */
  outsideWindow: AtlasLayer[];
  /** The clock time the stack is being judged against, or null if untimed. */
  timeMs: number | null;
  addByUrl: (url: string, opts?: AddLayerOptions) => Promise<LayerDraftResult>;
  addFromCatalog: (entry: CatalogEntry) => AtlasLayer;
  /** Add layers a Story brought with it, without dropping the user's own. */
  mergeStoryLayers: (layers: readonly Layer[] | undefined) => void;
  /**
   * The stack in canonical schema shape — the outbound half of the story
   * bridge. Hand this to anything that writes a `Story.layers` itself; prefer
   * `toStory` when you have the whole story, because that one also keeps the
   * layer kinds this manager does not own.
   */
  storyLayers: Layer[];
  /**
   * Fold the stack into a story at save/export time.
   *
   * Must be called on every path that leaves the app — saving to memory,
   * downloading, sharing — or the export is silently layer-less: a user adds
   * four layers, exports, and gets a document with none of them, no error
   * anywhere, because an absent `layers` array is a valid story.
   */
  toStory: (story: Story | null) => Story | null;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  setVisible: (id: string, visible: boolean) => void;
  setOpacity: (id: string, opacity: number) => void;
  rename: (id: string, name: string) => void;
  raise: (id: string) => void;
  lower: (id: string) => void;
  /** Drop a layer at a position in the panel's top-first list (drag reorder). */
  moveTo: (id: string, topFirstIndex: number) => void;
  clear: () => void;
  /** True when a probe is in flight, so the Add button can say so. */
  busy: boolean;
}

export interface UseLayersOptions {
  /** Current clock time, for the availability filter. */
  timeMs?: number | null;
  /** Injected in tests. */
  storage?: LayerStorage | null;
  fetchImpl?: typeof fetch;
}

/**
 * @param scope Account id (the OIDC subject, say). `null` = signed out, which
 *   gets its own bucket rather than no persistence — see `store.ts`.
 */
export function useLayers(scope: string | null, opts: UseLayersOptions = {}): LayerControl {
  const { timeMs = null, storage, fetchImpl } = opts;
  const [layers, setLayers] = useState<AtlasLayer[]>([]);
  const [busy, setBusy] = useState(false);
  // Storage is read once per scope and written on every change; keep the
  // injected instance out of the effect deps so a caller passing an object
  // literal cannot cause a re-read loop.
  const storageRef = useRef(storage);
  storageRef.current = storage;

  // The account id arrives after the auth round trip, so (re)hydrate when the
  // scope resolves — the same reason `useScrapbook` re-reads on its scope.
  useEffect(() => {
    // `undefined` means "use localStorage"; an explicit `null` means "do not
    // persist at all", which is how a test opts out.
    setLayers(readLayers(scope, storageRef.current));
  }, [scope]);

  useEffect(() => {
    writeLayers(scope, layers, storageRef.current);
  }, [layers, scope]);

  const addFromCatalog = useCallback((entry: CatalogEntry) => {
    const layer = layerFromCatalog(entry);
    setLayers((ls) => appendLayer(ls, layer));
    return layer;
  }, []);

  /**
   * Add a layer the user typed a URL for.
   *
   * The probe only happens when the URL genuinely does not say what it is — a
   * request to a third party is egress, and this repo does not make one to
   * confirm something it can already read off the path.
   */
  const addByUrl = useCallback(async (url: string, o: AddLayerOptions = {}): Promise<LayerDraftResult> => {
    const explicit = o.format && o.format !== 'auto' ? o.format : undefined;
    let format: LayerFormat | 'auto' | undefined = explicit ?? 'auto';
    if (!explicit && o.probe !== false && url.trim() && !sniffLayerFormat(url)) {
      setBusy(true);
      try {
        const probed = await probeLayerFormat(url.trim(), fetchImpl ? { fetchImpl } : {});
        if (probed) format = probed;
      } finally {
        setBusy(false);
      }
    }
    const result = draftLayer({ url, ...(o.name ? { name: o.name } : {}), ...(format ? { format } : {}) });
    if (result.ok) setLayers((ls) => appendLayer(ls, result.layer));
    return result;
  }, [fetchImpl]);

  const mergeStoryLayers = useCallback((storyLayers: readonly Layer[] | undefined) => {
    const incoming = fromStoryLayers(storyLayers);
    if (!incoming.length) return;
    // Append rather than replace: the user's own stack is theirs, and a story
    // opening should add its layers on top, not delete what they collected.
    // `appendLayer` deduplicates on (format, url), so re-opening the same story
    // raises its layers instead of stacking a second identical copy.
    setLayers((ls) => incoming.reduce((acc, l) => appendLayer(acc, l), ls));
  }, []);

  const remove = useCallback((id: string) => setLayers((ls) => removeFromStack(ls, id)), []);
  const toggle = useCallback((id: string) => setLayers((ls) => toggleInStack(ls, id)), []);
  const setVisible = useCallback((id: string, v: boolean) => setLayers((ls) => setLayerVisible(ls, id, v)), []);
  const setOpacity = useCallback((id: string, o: number) => setLayers((ls) => setOpacityInStack(ls, id, o)), []);
  const rename = useCallback((id: string, name: string) => setLayers((ls) => renameInStack(ls, id, name)), []);
  const raise = useCallback((id: string) => setLayers((ls) => raiseLayer(ls, id)), []);
  const lower = useCallback((id: string) => setLayers((ls) => lowerLayer(ls, id)), []);
  const moveTo = useCallback((id: string, i: number) => setLayers((ls) => moveLayerToIndex(ls, id, i)), []);
  const clear = useCallback(() => setLayers([]), []);

  const stack = useMemo(() => stackTopFirst(layers), [layers]);
  // Memoised on `layers` alone, so `toStory` only produces a new story object
  // when the stack actually changed — the Cesium viewer rebuilds its CZML data
  // source on a new story reference, and doing that per render would be visible.
  const storyLayers = useMemo(() => toStoryLayers(layers), [layers]);
  const toStory = useCallback((s: Story | null) => withStoryLayers(s, layers), [layers]);
  const outsideWindow = useMemo(
    () => layersOutsideWindow(layers.filter((l) => l.visible), timeMs),
    [layers, timeMs],
  );

  return {
    layers, stack, count: layers.length, outsideWindow, timeMs,
    addByUrl, addFromCatalog, mergeStoryLayers, storyLayers, toStory,
    remove, toggle, setVisible, setOpacity, rename, raise, lower, moveTo, clear,
    busy,
  };
}
