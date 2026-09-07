import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Camera, Scene, Story } from '@companion-atlas/story';
import {
  createScene,
  moveScene,
  moveSceneToIndex,
  removeScene as removeFromDeck,
  sceneFromCamera,
  sceneFromMemory,
  updateScene as patchInDeck,
  upsertScene,
  validateScenes,
  type SceneInit,
  type SceneProblem,
  type ScenePatch,
  type SceneSourceMemory,
} from './model.js';
import { readScenes, writeScenes, type SceneStorage } from './persist.js';
import { adoptStoryScenes, withAuthoredScenes } from './story.js';

/**
 * The authored deck as a React value: state, persistence, and the operations
 * the editor needs, in one object.
 *
 * Same shape as `useLayers` and `useAuthoring`, deliberately, so the
 * composition root reads consistently: everything interesting lives in the pure
 * modules next door and this owns only the `useState` and one effect. That
 * split is what lets the ordering, patching, validation and storage rules be
 * tested in node with no DOM — the pattern the `xr-*` and `layers-*` suites
 * follow — and it means a non-React surface could drive the same model.
 *
 * ## Where the writes happen, and why not in an effect
 *
 * Every mutation persists from the mutation itself, never from an effect on
 * `[scenes, scope]`. `useAuthoring` documents the failure that rule exists to
 * prevent, and it applies identically here: on a scope change the effect
 * ordering hands the *previous* account's scenes to the new account's key
 * before the re-render that loads the new one, silently copying one person's
 * narration into another's bucket. Writing where the change happens means a
 * write only ever describes a change the user just made, under the scope that
 * was in force when they made it.
 *
 * The mutations therefore compute the next array from a ref and call
 * `setScenes(next)` rather than passing an updater. React invokes an updater
 * twice under StrictMode, so an updater is the wrong place for a side effect —
 * the same reason `useLayers.remove` reads its outgoing row through a ref.
 */

export interface SceneControl {
  /** The deck, in the author's order. Never re-sorted — see `model.ts`. */
  scenes: Scene[];
  count: number;
  /** The id of the document whose scenes this deck adopted, or `null`. Only
   *  while this matches the open story does deleting a scene from the deck
   *  delete it from that document's export. */
  adoptedFrom: string | null;
  /** Append a blank scene (or one seeded from `init`) and return it. */
  create: (init?: SceneInit) => Scene;
  /**
   * "Capture this view" → a new scene at the end of the deck.
   *
   * Returns `null` — and adds nothing — for a camera with no usable position,
   * which is what `captureCamera()` yields during the first frame and mid-flight
   * before the pose resolves against terrain. A scene holding that camera
   * presents as a black screen, so refusing it is the honest answer and lets
   * the caller say "try again once the globe has settled".
   */
  createFromCamera: (camera: Camera | null | undefined, init?: SceneInit) => Scene | null;
  /** A scene about the memory the user is looking at, with its title, time and
   *  position pre-filled. Pass `init.camera` to use the live view instead of
   *  the framing derived from the memory's position. */
  createFromMemory: (memory: SceneSourceMemory, init?: SceneInit) => Scene;
  /** Change one scene. `null` on a field clears it; absent leaves it alone. */
  update: (id: string, patch: ScenePatch) => void;
  remove: (id: string) => void;
  /** One step through the deck. `+1` is later in the story. */
  move: (id: string, delta: 1 | -1) => void;
  /** Drop a scene at a position (drag reorder). */
  moveTo: (id: string, index: number) => void;
  /** Replace the deck wholesale — loading a saved story, an undo. */
  setScenes: (scenes: readonly Scene[]) => void;
  clear: () => void;
  /**
   * Take the open document's own scenes into the deck so they can be edited.
   *
   * Explicit on purpose: adoption is what makes a later deletion durable in
   * that document's export, so it must be something the user asked for rather
   * than something that happened because they opened a link.
   */
  adopt: (story: Story | null | undefined) => void;
  /** Everything in the deck that would not survive an export, with the field
   *  that caused it. Empty means the deck is safe to save. */
  problems: SceneProblem[];
  /**
   * Fold the deck into a story — the ONLY way authored scenes may leave this
   * hook.
   *
   * Call it on every path out of the app (save, download, share, export) and on
   * the story the `Presenter` builds its deck from. Never on the story handed
   * to `deriveModel` or `CesiumStoryViewer`: see the header of `./story.ts` for
   * the globe-collapsing trap that would spring.
   */
  toStory: (story: Story | null) => Story | null;
}

export interface UseScenesOptions {
  /** Injected in tests. `undefined` means localStorage; an explicit `null`
   *  means do not persist at all. */
  storage?: SceneStorage | null;
}

/**
 * @param scope Account id (the connected memory's URL, as `useLayers` and the
 *   drawing tools use it). `null` = signed out, which gets its own bucket
 *   rather than no persistence — and inherits nothing from any other, because
 *   narration is content, not a list of sources. See `persist.ts`.
 */
export function useScenes(scope: string | null, opts: UseScenesOptions = {}): SceneControl {
  const [scenes, setScenesState] = useState<Scene[]>([]);
  const [adoptedFrom, setAdoptedFrom] = useState<string | null>(null);

  /** The deck as of *now*, readable from a callback that must not be rebuilt
   *  every time it changes — and the value each mutation derives the next deck
   *  from, so two mutations in one tick chain instead of racing. */
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const adoptedRef = useRef(adoptedFrom);
  adoptedRef.current = adoptedFrom;
  // Storage is read once per scope and written on every change; keeping the
  // injected instance out of the deps means a caller passing an object literal
  // cannot cause a re-read loop (the same guard `useLayers` uses).
  const storageRef = useRef(opts.storage);
  storageRef.current = opts.storage;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  /** Commit a new deck: state, ref and storage, in that order, under the scope
   *  in force right now. Every mutation below goes through here so there is one
   *  place that can get the write wrong. */
  const commit = useCallback((next: Scene[], nextAdopted?: string | null) => {
    scenesRef.current = next;
    setScenesState(next);
    const adopted = nextAdopted === undefined ? adoptedRef.current : nextAdopted;
    if (nextAdopted !== undefined) {
      adoptedRef.current = nextAdopted;
      setAdoptedFrom(nextAdopted);
    }
    writeScenes(scopeRef.current, { scenes: next, adoptedFrom: adopted }, storageRef.current);
  }, []);

  /**
   * Hydrate whenever the scope resolves or changes.
   *
   * The account id arrives after the auth round trip, so this runs at least
   * twice in a normal session — the same reason `useLayers` and `useScrapbook`
   * re-read on their scope. A wholesale replace is correct here in a way it is
   * not for layers: whatever the user wrote under the previous account is that
   * account's, is already written there, and must not follow them.
   */
  useEffect(() => {
    // `undefined` means "use localStorage"; an explicit `null` means "do not
    // persist at all", which is how a test opts out.
    const bucket = readScenes(scope, storageRef.current);
    scenesRef.current = bucket.scenes;
    adoptedRef.current = bucket.adoptedFrom;
    setScenesState(bucket.scenes);
    setAdoptedFrom(bucket.adoptedFrom);
  }, [scope]);

  const create = useCallback((init: SceneInit = {}) => {
    const scene = createScene(init, scenesRef.current.map((s) => s.id));
    commit(upsertScene(scenesRef.current, scene));
    return scene;
  }, [commit]);

  const createFromCamera = useCallback((camera: Camera | null | undefined, init: SceneInit = {}) => {
    const scene = sceneFromCamera(camera, init, scenesRef.current.map((s) => s.id));
    if (!scene) return null;
    commit(upsertScene(scenesRef.current, scene));
    return scene;
  }, [commit]);

  const createFromMemory = useCallback((memory: SceneSourceMemory, init: SceneInit = {}) => {
    const scene = sceneFromMemory(memory, init, scenesRef.current.map((s) => s.id));
    commit(upsertScene(scenesRef.current, scene));
    return scene;
  }, [commit]);

  const update = useCallback((id: string, patch: ScenePatch) => {
    const next = patchInDeck(scenesRef.current, id, patch);
    // `updateScene` returns the same array for a no-op edit; committing it
    // anyway would write to storage on every keystroke that changed nothing.
    if (next !== scenesRef.current) commit(next);
  }, [commit]);

  const remove = useCallback((id: string) => {
    const next = removeFromDeck(scenesRef.current, id);
    if (next !== scenesRef.current) commit(next);
  }, [commit]);

  const move = useCallback((id: string, delta: 1 | -1) => {
    const next = moveScene(scenesRef.current, id, delta);
    if (next !== scenesRef.current) commit(next);
  }, [commit]);

  const moveTo = useCallback((id: string, index: number) => {
    const next = moveSceneToIndex(scenesRef.current, id, index);
    if (next !== scenesRef.current) commit(next);
  }, [commit]);

  const setScenes = useCallback((next: readonly Scene[]) => {
    commit([...next]);
  }, [commit]);

  const clear = useCallback(() => {
    // The adoption is cleared with the deck. Keeping it would leave a bucket
    // that holds no scenes but still claims a document's — and `withAuthoredScenes`
    // would then read that as "the user deleted every scene in this story".
    commit([], null);
  }, [commit]);

  const adopt = useCallback((story: Story | null | undefined) => {
    if (!story) return;
    const incoming = adoptStoryScenes(story);
    // Adopted scenes keep the document's ids, so this is an upsert rather than
    // a concatenation: adopting twice (a re-render, a second click) must not
    // produce two copies of every scene.
    const next = incoming.reduce<Scene[]>(upsertScene, scenesRef.current);
    commit(next, story.id);
  }, [commit]);

  const problems = useMemo(() => validateScenes(scenes), [scenes]);

  // Memoised on the deck alone, so `toStory` produces a new story object only
  // when the deck actually changed — the presenter rebuilds its whole deck on a
  // new story reference, and doing that per render would be visible.
  const toStory = useCallback(
    (story: Story | null) => withAuthoredScenes(story, scenes, { adoptedFrom }),
    [scenes, adoptedFrom],
  );

  return {
    scenes,
    count: scenes.length,
    adoptedFrom,
    create,
    createFromCamera,
    createFromMemory,
    update,
    remove,
    move,
    moveTo,
    setScenes,
    clear,
    adopt,
    problems,
    toStory,
  };
}
