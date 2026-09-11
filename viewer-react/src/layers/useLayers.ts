import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendLayer,
  claimedSourceUrls,
  isStoryLayer,
  isUserLayer,
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
import { adoptStoryLayers, toStoryLayers, withStoryLayers } from './story.js';
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
  /**
   * Add layers a Story brought with it, without dropping the user's own.
   *
   * @param storyId Provenance. Pass the id of the document the layers came from
   *   when they belong to it (a `?story=` load, a story reconstructed from
   *   Companion Memory) — those rows are the story's, are not persisted into the
   *   user's own stack, and stay removed once removed. Omit it for layers the
   *   user brought deliberately, such as a dropped `.story.json`: those are
   *   theirs to keep.
   */
  mergeStoryLayers: (layers: readonly Layer[] | undefined, storyId?: string) => void;
  /**
   * Every source URL the stack speaks for: the ones it is drawing, plus the
   * story-supplied ones the user has removed.
   *
   * The Cesium renderer needs this and cannot derive it. `storyToCzml` mounts a
   * story's `3d-tiles`/`gaussian-splat` layers itself, and the layer scene mounts
   * the same ones from the stack, so one of the two has to stand down or every
   * such tileset is mounted twice — two coincident surfaces z-fighting, two sets
   * of tile requests. Keying that hand-off on the live stack alone made removal
   * impossible: the moment the row went away the URL was un-claimed, the CZML
   * path remounted the tileset, and it was back on the globe with no panel row,
   * no toggle and no opacity control. A removal is a claim too.
   */
  claimedUrls: ReadonlySet<string>;
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

  // The live stack, for the handlers that need to look at it without becoming a
  // new function every time it changes.
  const layersRef = useRef(layers);
  layersRef.current = layers;

  /**
   * Story-supplied source URLs the user has removed.
   *
   * A removal has to be remembered rather than inferred, because the two things
   * that would otherwise undo it both run again after it: the inbound merge
   * re-reads `story.layers` whenever the open document's reference changes and
   * would re-adopt the row, and the renderer re-derives its "the stack owns this
   * tileset" set from the live stack and would remount what nobody is drawing
   * any more. Keyed by URL because that is the key both of those speak — the
   * renderer matches tilesets on URL since the layer model regenerates ids, and
   * `adoptStoryLayer` dedupes on it.
   *
   * A ref as well as state: the merge callback must keep a stable identity (it
   * is an effect dependency in the app), so it cannot close over the state.
   *
   * Deliberately session-scoped, not persisted. The stored stack holds only the
   * user's own layers, so a reload re-opens the story and re-adopts what it
   * carries — which is the honest answer to "this document says it has this
   * layer", and leaves a removal as a statement about this session's globe
   * rather than a permanent grudge against a URL.
   */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;

  const dismiss = useCallback((urls: readonly string[]) => {
    if (!urls.length) return;
    setDismissed((prev) => {
      if (urls.every((u) => prev.has(u))) return prev;
      return new Set([...prev, ...urls]);
    });
  }, []);

  /** Adding a URL back by hand is the user overruling their own removal. */
  const revive = useCallback((url: string) => {
    setDismissed((prev) => (prev.has(url) ? new Set([...prev].filter((u) => u !== url)) : prev));
  }, []);

  // The account id arrives after the auth round trip, so (re)hydrate when the
  // scope resolves — the same reason `useScrapbook` re-reads on its scope.
  useEffect(() => {
    // `undefined` means "use localStorage"; an explicit `null` means "do not
    // persist at all", which is how a test opts out.
    const stored = readLayers(scope, storageRef.current);
    setLayers((prev) => {
      // Layers adopted from the open story are not in *any* bucket (see the
      // write effect), so a wholesale replace at sign-in would wipe them off the
      // globe and nothing would put them back: the inbound merge only re-runs
      // when the document changes, and signing in does not change the document.
      const adopted = prev.filter(isStoryLayer);
      return adopted.length ? adopted.reduce((acc, l) => appendLayer(acc, l), stored) : stored;
    });
  }, [scope]);

  useEffect(() => {
    // Only the user's own layers are persisted. The stack is account-scoped —
    // "the sources I keep going back to" — and a story's layers are the story's:
    // writing them here grafted every visited document's sources onto the user's
    // stack for ever, and `toStory` then folded them into saves of entirely
    // different stories. They cost nothing to lose, because opening the document
    // adopts them again.
    writeLayers(scope, layers.filter(isUserLayer), storageRef.current);
  }, [layers, scope]);

  const addFromCatalog = useCallback((entry: CatalogEntry) => {
    const layer = layerFromCatalog(entry);
    revive(layer.url);
    setLayers((ls) => appendLayer(ls, layer));
    return layer;
  }, [revive]);

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
    if (result.ok) {
      revive(result.layer.url);
      setLayers((ls) => appendLayer(ls, result.layer));
    }
    return result;
  }, [fetchImpl, revive]);

  // The rule itself lives in `story.ts`, pure and tested; this only supplies the
  // session state it needs. `dismissedRef`, not `dismissed`, because this
  // callback is an effect dependency in the app — a new identity per removal
  // would re-run the merge and immediately re-adopt what was just removed.
  const mergeStoryLayers = useCallback((storyLayers: readonly Layer[] | undefined, storyId?: string) => {
    setLayers((ls) => adoptStoryLayers(ls, storyLayers, {
      ...(storyId ? { storyId } : {}),
      dismissed: dismissedRef.current,
    }));
  }, []);

  const remove = useCallback((id: string) => {
    // Read the outgoing row through the ref rather than inside the `setLayers`
    // updater: an updater has to stay pure (React invokes it twice under
    // StrictMode) and this one has a side effect to record.
    const going = layersRef.current.find((l) => l.id === id);
    // Only a story's layers need a tombstone: nothing re-adds a layer the user
    // typed in, and remembering it would suppress that URL if a story later
    // offered it — punishing the user for a removal they made in another context.
    if (going && isStoryLayer(going)) dismiss([going.url]);
    setLayers((ls) => removeFromStack(ls, id));
  }, [dismiss]);
  const toggle = useCallback((id: string) => setLayers((ls) => toggleInStack(ls, id)), []);
  const setVisible = useCallback((id: string, v: boolean) => setLayers((ls) => setLayerVisible(ls, id, v)), []);
  const setOpacity = useCallback((id: string, o: number) => setLayers((ls) => setOpacityInStack(ls, id, o)), []);
  const rename = useCallback((id: string, name: string) => setLayers((ls) => renameInStack(ls, id, name)), []);
  const raise = useCallback((id: string) => setLayers((ls) => raiseLayer(ls, id)), []);
  const lower = useCallback((id: string) => setLayers((ls) => lowerLayer(ls, id)), []);
  const moveTo = useCallback((id: string, i: number) => setLayers((ls) => moveLayerToIndex(ls, id, i)), []);
  const clear = useCallback(() => {
    // "Remove all" is a removal of each row, so every story-supplied one earns
    // its tombstone — otherwise the next merge (or the next render that hands
    // the renderer a new story object) puts the document's layers straight back
    // and the button looks like it half-worked.
    dismiss(layersRef.current.filter(isStoryLayer).map((l) => l.url));
    setLayers([]);
  }, [dismiss]);

  const stack = useMemo(() => stackTopFirst(layers), [layers]);
  const claimedUrls = useMemo(() => claimedSourceUrls(layers, dismissed), [layers, dismissed]);
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
    addByUrl, addFromCatalog, mergeStoryLayers, claimedUrls, storyLayers, toStory,
    remove, toggle, setVisible, setOpacity, rename, raise, lower, moveTo, clear,
    busy,
  };
}
