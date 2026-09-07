/**
 * The authored deck: everything about building and ordering `Scene[]` that is
 * not React and not storage.
 *
 * Atlas could already *render* a story's scenes — `buildDeck`, `Presenter`,
 * `SceneLayout` and the Markdown renderer have all been in place — and it could
 * already capture a camera pose. What it could not do was let anyone write one
 * down. This module is the missing middle: the list a user builds, the rules
 * for changing it, and the check that says whether it can still be exported.
 *
 * ## Order is authorial, and nothing here may re-sort it
 *
 * `deriveModel` sorts scenes by time because the time machine is a clock and a
 * clock has one direction. `buildDeck` deliberately does NOT, and the comment
 * there says why: a story that opens on the ending and goes back six years is a
 * flashback, and sorting silently rewrites it into a prologue. Every operation
 * below preserves array position for the same reason — the only thing that ever
 * moves a scene is the user moving it. This is also why the layer stack's
 * `order` field has no analogue here: `Scene` has no ordering key at all,
 * array position *is* the order, and inventing a numeric one would create a
 * second source of truth for something the schema already answers.
 *
 * ## Why the scene type is the canonical `Scene`, not a view-model
 *
 * `layers/model.ts` keeps an `AtlasLayer` view-model and converts to `Layer` on
 * the way out, because a layer carries app-only state (probe results, catalog
 * provenance, dismissals) that has nowhere to live in the schema. A scene
 * carries none: `title`, `narrative`, `time`, `camera`, `itemIds`, `layout`,
 * `transition` and `audioUrl` are all schema fields already, and the deck the
 * presenter steps through is literally `Scene[]`. Wrapping it would mean a
 * conversion on every read — `buildDeck`, `sceneLayout`, `sceneTimeMs`,
 * `validateScene` — to buy nothing.
 *
 * Pure and DOM-free on purpose, like the `xr-*` and `layers-*` modules: the
 * ordering, patching and validation rules are the part that can be wrong in a
 * way a screenshot would not show, so they are the part that gets tested.
 */
import {
  Scene as SceneSchema,
  type Camera,
  type Scene,
} from '@companion-atlas/story';
import { SCENE_LAYOUTS, type SceneLayout } from '../ui/sceneDeck.js';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * The prefix on every id this store mints.
 *
 * A scene id is not private bookkeeping: it is written into the exported
 * document, it is what `indexOfScene` resumes a presentation on, and
 * `AtlasApp` uses it as the focused-entity id while presenting. So it has to be
 * unique against the *open document's* ids, not just against the other scenes
 * in this deck — a fresh scene that happened to be called `scene-1` would, on
 * export, replace a hand-written story's own first scene instead of appending
 * after it, and the author would watch their opening page be overwritten by
 * someone else's.
 *
 * Hence a namespaced prefix plus a random suffix rather than the counter
 * `nextItemId` uses. A drawn item's counter is safe because the drawing tools
 * always know every id in the story they are drawing on; this deck is
 * account-scoped (see `persist.ts`) and outlives the document it was started
 * against, so at creation time there is no complete id set to count against.
 */
export const SCENE_ID_PREFIX = 'atlas-scene-';

/**
 * True for an id this store minted.
 *
 * Honest about what it means: it identifies ids *we* allocated, which is not
 * the same as "the user authored this scene". A scene adopted from an open
 * document (see `adoptStoryScenes` in `./story.ts`) keeps the document's own id
 * so the export merge can replace it in place — it is fully editable and it
 * will not match this test. Use it to avoid collisions, and to label a row in
 * the editor; never as an ownership check that gates an edit.
 */
export const isAuthoredSceneId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith(SCENE_ID_PREFIX);

/** Same source of randomness as `layers/model.ts`, and the same fallback for a
 *  context with no `crypto` (Node's older test runners, a worker). */
function randomSuffix(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(4));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * A fresh scene id, guaranteed not to be in `taken`.
 *
 * The retry loop is not defensive padding: `randomSuffix` falls back to
 * `Math.random` where there is no `crypto`, and a test that stubs it (or a
 * runtime that seeds it poorly) can repeat. A duplicate id is not a cosmetic
 * problem — it makes two rows share a React key, makes `indexOfScene` resolve
 * the wrong slide, and makes the export merge drop one of the two scenes.
 */
export function makeSceneId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let id = `${SCENE_ID_PREFIX}${randomSuffix()}`;
  // Bounded, so a stubbed generator that always returns the same value cannot
  // hang the editor; after that, lengthen instead of looping.
  for (let n = 0; used.has(id) && n < 8; n++) id = `${SCENE_ID_PREFIX}${randomSuffix()}`;
  while (used.has(id)) id = `${SCENE_ID_PREFIX}${randomSuffix()}${randomSuffix()}`;
  return id;
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/** The fields a caller may seed a new scene with. Everything is optional: an
 *  empty scene is a legitimate starting point, and `buildDeck` already titles
 *  an untitled one "Scene N". */
export interface SceneInit {
  /** Supply one only to re-create a specific scene (an undo, a test). Normally
   *  left out so `makeSceneId` allocates. */
  id?: string;
  title?: string;
  /** Markdown. The schema's `narrative`; `caption` is the legacy spelling and
   *  is never written by this store. */
  narrative?: string;
  /** ISO-8601 instant. */
  time?: string;
  camera?: Camera | null;
  itemIds?: readonly string[];
  layout?: SceneLayout;
  audioUrl?: string;
  transition?: Scene['transition'];
}

/**
 * Build a scene.
 *
 * Absent fields are *absent*, not empty strings: `Scene` treats every one of
 * them as optional, and writing `title: ''` into an export produces a document
 * whose scene claims to have a title and shows nothing. The trim-then-drop rule
 * below is the same one the editor will apply when a user clears a field.
 */
export function createScene(init: SceneInit = {}, taken: Iterable<string> = []): Scene {
  const scene: Scene = { id: init.id ?? makeSceneId(taken) };
  return patchScene(scene, {
    title: init.title ?? null,
    narrative: init.narrative ?? null,
    time: init.time ?? null,
    camera: init.camera ?? null,
    itemIds: init.itemIds ?? null,
    layout: init.layout ?? null,
    audioUrl: init.audioUrl ?? null,
    transition: init.transition ?? null,
  });
}

/**
 * "Capture this view" → a scene.
 *
 * This is the function the whole feature was missing. `captureCamera()` has
 * produced a correct canonical `Camera` for as long as the drawing toolbar has
 * existed and there has been nowhere to put it; here is the somewhere.
 *
 * Returns `null` for a camera that cannot be flown to, rather than a scene with
 * a broken pose. This is a *pre-flight* check, and that is the point: the value
 * `captureCamera()` hands over has never been through zod, and it will not be
 * until the story is exported — so without this the failure surfaces at save
 * time, long after the user pressed the button, as a scene that silently
 * refuses to be written. Refusing at creation lets the caller say "try again
 * once the globe has settled", which is the actual remedy.
 */
export function sceneFromCamera(camera: Camera | null | undefined, init: SceneInit = {}, taken: Iterable<string> = []): Scene | null {
  if (!hasUsableLocation(camera)) return null;
  return createScene({ ...init, camera }, taken);
}

/**
 * The memory-shaped input `sceneFromMemory` needs.
 *
 * Structurally the subset of `AtlasMemory` that matters, taken as a parameter
 * rather than imported — the same choice `DeckMemory` makes in `sceneDeck.ts`,
 * and for the same reason: this module stays free of the view-model and stays
 * testable without building one.
 */
export interface SceneSourceMemory {
  id: string;
  title?: string;
  narrative?: string;
  /** Epoch ms. */
  timeMs?: number;
  lat?: number;
  lon?: number;
  place?: string;
}

/**
 * The framing an authored scene gets when it has to derive a camera from a
 * memory's position.
 *
 * Deliberately the same numbers `scenesFromMemories` uses for the projected
 * deck. A user who presents an unauthored archive and then authors a scene
 * about one of its memories must not see the globe frame it differently — that
 * reads as the scene having been given a camera it was not given.
 */
export const MEMORY_SCENE_RANGE_M = 90_000;
export const MEMORY_SCENE_PITCH_DEG = -40;
export const MEMORY_SCENE_FLY_MS = 2200;

/**
 * A scene about the memory the user is looking at.
 *
 * Pre-filling is the point: most scenes are written *about* something already
 * on screen, and an editor that opens blank makes the author retype a title and
 * a date the app already knows. The memory's id goes into `itemIds` so the
 * scene highlights it — that is also what `sceneBackground` reads to give the
 * slide the memory's own photo instead of a flat tint.
 *
 * `init.camera` wins when the caller passes one, because "add a scene here"
 * from a live globe means *this* view, not a computed overhead shot of the pin.
 * The derived camera is only the fallback for a memory selected from a list.
 */
export function sceneFromMemory(memory: SceneSourceMemory, init: SceneInit = {}, taken: Iterable<string> = []): Scene {
  const derived: Camera | null =
    memory.lat != null && memory.lon != null && Number.isFinite(memory.lat) && Number.isFinite(memory.lon)
      ? { lon: memory.lon, lat: memory.lat, range: MEMORY_SCENE_RANGE_M, pitch: MEMORY_SCENE_PITCH_DEG, durationMs: MEMORY_SCENE_FLY_MS }
      : null;
  const camera = init.camera !== undefined ? init.camera : derived;
  const time =
    init.time ??
    (memory.timeMs != null && Number.isFinite(memory.timeMs) ? new Date(memory.timeMs).toISOString() : undefined);

  return createScene(
    {
      ...init,
      title: init.title ?? memory.title ?? memory.place,
      narrative: init.narrative ?? memory.narrative,
      ...(time ? { time } : {}),
      camera,
      // A scene the user did not pick entities for still points at the memory it
      // is about; an explicit `itemIds` from the caller overrides it.
      itemIds: init.itemIds ?? [memory.id],
    },
    taken,
  );
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * A change to one scene.
 *
 * `null` means **clear the field** and `undefined`/absent means **leave it
 * alone**. The distinction is load-bearing on both sides: an editor binding a
 * text input has to be able to say "the user emptied this" without that being
 * confused with "this control was not part of the change", and a cleared field
 * must be *removed* from the scene rather than set to `''` — an exported scene
 * carrying `narrative: ''` claims to have narration and renders an empty card.
 */
export interface ScenePatch {
  title?: string | null;
  narrative?: string | null;
  /** ISO-8601 instant. */
  time?: string | null;
  camera?: Camera | null;
  itemIds?: readonly string[] | null;
  layout?: SceneLayout | null;
  audioUrl?: string | null;
  transition?: Scene['transition'] | null;
}

const LAYOUTS = new Set<string>(SCENE_LAYOUTS);

/** Trim, and treat an all-whitespace value as cleared. A title of three spaces
 *  is not a title, and it defeats `buildDeck`'s `title?.trim() || 'Scene N'`
 *  fallback by being truthy before the trim ever happens. */
const text = (v: string | null | undefined): string | undefined => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : undefined;
};

/**
 * Apply a patch to a scene, returning a new object.
 *
 * Returns the SAME object when nothing changed. That is not micro-optimisation:
 * the deck the presenter renders is derived from this array, and a new scene
 * object per keystroke would rebuild every slide's parsed Markdown and its
 * background lookup on every character typed.
 */
export function patchScene(scene: Scene, patch: ScenePatch): Scene {
  const next: Record<string, unknown> = { ...scene };
  let changed = false;

  const set = (key: string, value: unknown) => {
    const had = key in next;
    if (value === undefined) {
      if (had) { delete next[key]; changed = true; }
      return;
    }
    if (!had || next[key] !== value) { next[key] = value; changed = true; }
  };

  if ('title' in patch) set('title', text(patch.title));
  if ('narrative' in patch) {
    set('narrative', text(patch.narrative));
    // The legacy spelling must not survive an edit. `sceneNarrative` reads
    // `narrative ?? caption`, so a scene adopted from an Earth-2 document that
    // kept its `caption` would ignore everything the user then typed — the
    // field would look uneditable, with nothing to explain it.
    if ('caption' in next) { delete next.caption; changed = true; }
  }
  if ('time' in patch) set('time', text(patch.time));
  if ('camera' in patch) set('camera', patch.camera ?? undefined);
  if ('audioUrl' in patch) set('audioUrl', text(patch.audioUrl));
  if ('transition' in patch) set('transition', patch.transition ?? undefined);

  if ('layout' in patch) {
    const l = patch.layout;
    // An unrecognised layout is dropped rather than stored. `sceneLayout`
    // already falls back for one, so storing it would be invisible until the
    // day the export reached a stricter reader.
    set('layout', typeof l === 'string' && LAYOUTS.has(l) ? l : undefined);
  }

  if ('itemIds' in patch) {
    const ids = patch.itemIds ? [...patch.itemIds].filter((i) => typeof i === 'string' && i) : [];
    if (ids.length === 0) {
      set('itemIds', undefined);
    } else if (!sameIds(scene.itemIds, ids)) {
      next.itemIds = ids;
      changed = true;
    }
    // The legacy `items` spelling shadows nothing (`sceneHighlightIds` prefers
    // `itemIds`) but would be exported alongside a contradicting list.
    if ('items' in next) { delete next.items; changed = true; }
    // `mediaIds` is the third spelling and the one that bites: it is what
    // `sceneHighlightIds` falls through to LAST, so on a patch that *clears*
    // the list — `itemIds: null`, i.e. the editor's "use none" — removing only
    // `itemIds` uncovers it again and the background the author just detached
    // reappears, with the control looking broken. Both legacy lists go on the
    // first edit, for the same reason: after this, `itemIds` is the whole
    // answer.
    if ('mediaIds' in next) { delete next.mediaIds; changed = true; }
  }

  return changed ? (next as Scene) : scene;
}

const sameIds = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------
// List operations — every one of them order-preserving
// ---------------------------------------------------------------------------

/** Insert, or replace in place by id. Position is the author's order, so a
 *  replace never moves the scene — the same contract `upsertItem` keeps for
 *  drawn geometry, where position is draw order. */
export function upsertScene(scenes: readonly Scene[], scene: Scene): Scene[] {
  const at = scenes.findIndex((s) => s.id === scene.id);
  if (at < 0) return [...scenes, scene];
  if (scenes[at] === scene) return [...scenes];
  const out = [...scenes];
  out[at] = scene;
  return out;
}

/** Apply a patch to one scene by id. Returns the same array when the patch
 *  changed nothing, so a no-op edit does not re-render the deck. */
export function updateScene(scenes: readonly Scene[], id: string, patch: ScenePatch): Scene[] {
  const at = scenes.findIndex((s) => s.id === id);
  if (at < 0) return scenes as Scene[];
  const next = patchScene(scenes[at], patch);
  if (next === scenes[at]) return scenes as Scene[];
  const out = [...scenes];
  out[at] = next;
  return out;
}

export function removeScene(scenes: readonly Scene[], id: string): Scene[] {
  const out = scenes.filter((s) => s.id !== id);
  return out.length === scenes.length ? (scenes as Scene[]) : out;
}

export function findScene(scenes: readonly Scene[], id: string | null | undefined): Scene | null {
  return (id ? scenes.find((s) => s.id === id) : undefined) ?? null;
}

export const indexOfSceneId = (scenes: readonly Scene[], id: string | null | undefined): number =>
  id ? scenes.findIndex((s) => s.id === id) : -1;

/**
 * Move a scene one step through the deck. `+1` is *later* in the story.
 *
 * A swap with the neighbour rather than arithmetic on any ordering field,
 * because there is no ordering field — array position is the order (see the
 * file header). Clamped at both ends rather than wrapping: a "move down" on the
 * last scene that silently sent it to the front would be indistinguishable from
 * the button not working, which is the same reason `stepIndex` refuses to wrap.
 */
export function moveScene(scenes: readonly Scene[], id: string, delta: 1 | -1): Scene[] {
  const from = indexOfSceneId(scenes, id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= scenes.length) return scenes as Scene[];
  const out = [...scenes];
  out[from] = scenes[to];
  out[to] = scenes[from];
  return out;
}

/**
 * Move a scene to an explicit position — what a drag-and-drop reorder lands on.
 *
 * The index is clamped into range rather than rejected: a drag that ends past
 * the last row means "put it last", and refusing it would leave the scene where
 * it was with no feedback. Removing before inserting is what makes the target
 * index mean the position in the *final* list, which is what the drop indicator
 * the user is looking at was showing them.
 */
export function moveSceneToIndex(scenes: readonly Scene[], id: string, index: number): Scene[] {
  const from = indexOfSceneId(scenes, id);
  if (from < 0 || scenes.length === 0) return scenes as Scene[];
  const to = Math.min(scenes.length - 1, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0));
  if (from === to) return scenes as Scene[];
  const out = [...scenes];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/** Drop duplicate ids, first occurrence winning. First rather than last because
 *  position is authorial: keeping the later copy would silently move the scene
 *  to the duplicate's place in the deck. */
export function dedupeScenes(scenes: readonly Scene[]): Scene[] {
  const seen = new Set<string>();
  const out: Scene[] = [];
  for (const s of scenes) {
    if (!s || typeof s.id !== 'string' || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** One reason a scene would not survive being exported. `field` is the schema
 *  path (`camera.lon`, `time`) so an editor can put the message beside the
 *  control that caused it rather than at the top of the panel. */
export interface SceneProblem {
  sceneId: string;
  field?: string;
  message: string;
}

/**
 * Whether a camera can actually be flown to.
 *
 * Two things the schema does not answer, in a value that has not reached the
 * schema yet:
 *
 * **Non-finite.** Cesium reports a NaN pose during the first frame and
 * mid-`flyTo` before the position resolves against terrain, so this is
 * reachable from the capture button rather than only from a hand-edited file.
 * `z.number()` does reject NaN, so such a camera would eventually be caught —
 * but only at export, by which time the user has written a scene around it.
 *
 * **Out of range.** `lat: 500` is a perfectly good `z.number()`. Cesium accepts
 * it and puts the camera somewhere that does not exist, which presents as a
 * black screen with nothing logged.
 */
export function hasUsableLocation(camera: Camera | null | undefined): boolean {
  if (!camera) return false;
  const lon = camera.location?.lon ?? camera.lon;
  const lat = camera.location?.lat ?? camera.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  return Math.abs(lat as number) <= 90 && Math.abs(lon as number) <= 360;
}

/**
 * Everything wrong with one scene, from the schema's point of view.
 *
 * The check is `Scene.safeParse`, not a hand-written shape test, for the same
 * reason `coerceItems` uses `Item.safeParse`: this value is going to be spliced
 * into a `Story` and handed to `Story.parse` on the way to memory, to a
 * download and to the KML exporter. Anything that would throw there has to be
 * catchable here, while the user is still looking at the field that caused it.
 * A scene that cannot be exported is worse than one that cannot be created —
 * the second is a disabled button, the first is a save that fails after the
 * work is done.
 *
 * The camera check is additional to the schema rather than duplicated from it:
 * an out-of-range coordinate is a valid `z.number()` and an invalid place. See
 * `hasUsableLocation`.
 */
export function validateScene(scene: unknown): SceneProblem[] {
  const id = (scene as { id?: unknown })?.id;
  const sceneId = typeof id === 'string' ? id : '';
  const problems: SceneProblem[] = [];

  if (!sceneId) {
    problems.push({ sceneId, field: 'id', message: 'A scene needs an id.' });
  }

  const parsed = SceneSchema.safeParse(scene);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || undefined;
      if (field === 'id' && !sceneId) continue; // already said, in plainer words
      problems.push({ sceneId, ...(field ? { field } : {}), message: issue.message });
    }
    return problems;
  }

  const camera = parsed.data.camera;
  if (camera && !hasUsableLocation(camera)) {
    problems.push({
      sceneId,
      field: 'camera',
      message: 'The captured view has no usable position — capture it again once the globe has settled.',
    });
  }
  return problems;
}

/** True when the scene would survive `Story.parse` and render. */
export const isExportableScene = (scene: unknown): scene is Scene => validateScene(scene).length === 0;

/**
 * Every problem in the deck, including the ones no single scene can see.
 *
 * A duplicate id is the one that only exists at list level, and it is not
 * theoretical: two scenes sharing an id give two rows the same React key, make
 * `indexOfScene` resume a presentation on the wrong slide, and make the export
 * merge keep one and drop the other with nothing said.
 */
export function validateScenes(scenes: readonly Scene[]): SceneProblem[] {
  const problems: SceneProblem[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    problems.push(...validateScene(scene));
    if (typeof scene?.id === 'string' && scene.id) {
      if (seen.has(scene.id)) {
        problems.push({ sceneId: scene.id, field: 'id', message: `Two scenes share the id "${scene.id}".` });
      }
      seen.add(scene.id);
    }
  }
  return problems;
}

/**
 * The subset of a deck that can safely be written into a document.
 *
 * Used by the export merge. Dropping one broken scene and saving the rest beats
 * letting `Story.parse` throw and losing the whole save: the user's other work
 * — drawn shapes, layers, the scrapbook — is in that same document, and a
 * failed save takes all of it. The editor is where a broken scene gets pointed
 * at, via `validateScenes`, before the user ever presses Save.
 */
export function exportableScenes(scenes: readonly Scene[]): Scene[] {
  return dedupeScenes(scenes).filter(isExportableScene);
}
