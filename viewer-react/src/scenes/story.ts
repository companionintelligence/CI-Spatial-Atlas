/**
 * The one bridge between the authored deck and a `Story` document.
 *
 * ## Read this before wiring it anywhere
 *
 * `withAuthoredScenes` is for **export only**: saving to Companion Memory,
 * downloading, sharing, KML/JSON export, and the story the `Presenter` builds
 * its deck from. Its result must never be handed to `deriveModel` or to
 * `CesiumStoryViewer`.
 *
 * The reason is a live trap in `model/atlasModel.ts`. `deriveModel` builds the
 * globe's memory list like this: when `story.scenes.length > 0` it maps
 * **scenes** into memories, and only when there are none does it fall back to
 * projecting the story's located entities. So the moment an authored scene
 * reaches the rendered story, a user who has written three scenes about a
 * 500-memory archive watches their globe collapse to three pins — no error, no
 * warning, just their archive gone. The globe would then be showing the deck
 * instead of the world the deck is about.
 *
 * This is the same shape of hazard the drawing tools already solved, and the
 * same answer: the authoring surface renders its own work (there, a
 * `CustomDataSource`; here, the presenter's own deck), and the merge into the
 * document happens once, on the way out. `mergeAuthoredItems` is the precedent
 * to follow, not a second pattern to invent.
 */
import type { Scene, Story, Timeline } from '@companion-atlas/story';
import { sceneTimeMs } from '../ui/sceneDeck.js';
import { exportableScenes } from './model.js';

/** How the deck relates to the document it is being merged into. */
export interface AuthoredSceneOptions {
  /**
   * The id of the document this deck's scenes were adopted from, if any — see
   * `adoptStoryScenes`. Only when this matches `story.id` may an absence be
   * read as a deletion.
   */
  adoptedFrom?: string | null;
}

/**
 * Fold the authored deck into a story, for save/download/export.
 *
 * ## Two documents, two right answers
 *
 * **A Memory archive** (`memoryToStory` output, an import, the common case)
 * carries `scenes: []`. There is nothing to reconcile: the deck simply becomes
 * the story's scenes, in the order the author put them in.
 *
 * **A `?story=` document being edited** already has scenes of its own, and they
 * are the property of whoever wrote it. The deck is account-scoped (it outlives
 * this document — see `persist.ts`), so a scene the deck does not mention is
 * usually not a statement about that scene at all; it just means the deck was
 * started somewhere else. Dropping unmatched scenes on that assumption would
 * delete a stranger's story the first time a user with a saved deck opened it.
 * So unmatched scenes are carried through, matched ones are replaced in place —
 * which also keeps the diff of a re-saved document small — and the rest append.
 *
 * ## Except when the deck IS this document's
 *
 * Once the user has adopted the open document's scenes into the deck
 * (`adoptStoryScenes`), the deck is the document's deck, and two things follow
 * that do not hold otherwise: an absence is a **deletion**, and the **deck's
 * order wins**. The second matters as much as the first — reorder is half of
 * what an editor is for, and a merge that walked the document's array would
 * quietly discard every drag the user made, leaving Save looking like it had
 * worked. `adoptedFrom === story.id` is the only condition under which either
 * happens, and it is stored alongside the deck so both survive a reload.
 * `withStoryLayers` reached the same conclusion from the other direction — it
 * had to learn that "keep everything unmatched" made Remove a button with no
 * durable effect.
 *
 * A broken edit costs the edit, not the scene: an adopted scene the user has
 * since made unexportable falls back to the document's own copy rather than
 * vanishing from the document, because the deck is the only place the edit
 * lives and the document is not.
 *
 * Returns the story unchanged (same object identity) when the merge would not
 * change the scene array. The presenter rebuilds its whole deck — parsed
 * Markdown, background lookups, transitions — when the story reference changes,
 * so handing back a fresh object every render would be visible.
 */
export function withAuthoredScenes(
  story: Story | null,
  scenes: readonly Scene[],
  opts: AuthoredSceneOptions = {},
): Story | null {
  if (!story) return story;

  const existing = story.scenes ?? [];
  const adopted = !!opts.adoptedFrom && opts.adoptedFrom === story.id;
  // Anything that cannot survive `Story.parse` is dropped here rather than
  // allowed to throw at the boundary. A save carries the drawn shapes, the
  // layers and the scrapbook too, and a single malformed scene must not take
  // all of that down with it; the editor is where a broken scene is pointed at.
  const usable = new Map(exportableScenes(scenes).map((s) => [s.id, s]));

  const merged = adopted
    ? mergeAdopted(existing, scenes, usable)
    : mergeAlongside(existing, usable);

  if (sameScenes(existing, merged)) return story;
  return { ...story, scenes: merged, ...withRoomFor(story.timeline, merged) };
}

/** The deck is this document's: its order is the document's order, and an id it
 *  no longer holds has been deleted. Walks the raw deck rather than the
 *  filtered one so a scene the user has temporarily broken keeps its position
 *  (falling back to the document's copy) instead of jumping to the end. */
function mergeAdopted(
  existing: readonly Scene[],
  deck: readonly Scene[],
  usable: ReadonlyMap<string, Scene>,
): Scene[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const merged: Scene[] = [];
  const emitted = new Set<string>();
  for (const scene of deck) {
    const id = scene?.id;
    if (typeof id !== 'string' || !id || emitted.has(id)) continue;
    const use = usable.get(id) ?? byId.get(id);
    if (!use) continue; // a new scene that cannot be exported yet: not added
    emitted.add(id);
    merged.push(use);
  }
  return merged;
}

/** The deck is the user's own and this document is somebody else's: keep every
 *  scene the document brought, replace by id where the two genuinely refer to
 *  the same scene, and append the rest in the author's order. */
function mergeAlongside(existing: readonly Scene[], usable: ReadonlyMap<string, Scene>): Scene[] {
  const remaining = new Map(usable);
  const merged: Scene[] = [];
  for (const scene of existing) {
    const replacement = remaining.get(scene.id);
    if (replacement) {
      merged.push(replacement);
      remaining.delete(scene.id);
    } else {
      merged.push(scene);
    }
  }
  merged.push(...remaining.values());
  return merged;
}

/** Reference-equal, element for element. Enough to answer "did the merge change
 *  anything?", because every scene kept here is either the caller's own object
 *  or one that came straight out of the deck. */
function sameScenes(a: readonly Scene[], b: readonly Scene[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * Widen the story's clock so it actually contains the scenes now in it.
 *
 * A story that carries no `timeline` needs nothing: `timelineBounds` derives
 * the window from scene and entity times, so a new scene is included the moment
 * it exists. One that *does* carry a timeline is the problem — the clock is
 * fixed at whatever the document was written with, the presenter scrubs to each
 * slide's time, and Cesium clamps a scrub outside the window. A scene dated
 * before the story's start would present with the clock silently parked on the
 * start date instead, which reads as "the time machine ignored my scene".
 *
 * Only ever widens, and only writes the close key the document already used
 * (`stop`, or the legacy `end`) so a re-saved document's diff stays honest.
 */
function withRoomFor(timeline: Timeline | undefined, scenes: readonly Scene[]): { timeline?: Timeline } {
  if (!timeline) return {};
  const times = scenes.map((s) => sceneTimeMs(s.time)).filter((t): t is number => t != null);
  if (times.length === 0) return {};

  const startMs = Date.parse(timeline.start);
  const closeKey = timeline.stop != null ? 'stop' : 'end';
  const closeIso = timeline.stop ?? timeline.end;
  const stopMs = closeIso ? Date.parse(closeIso) : NaN;

  const min = Math.min(...times);
  const max = Math.max(...times);
  const widenStart = Number.isFinite(startMs) && min < startMs;
  const widenStop = Number.isFinite(stopMs) && max > stopMs;
  if (!widenStart && !widenStop) return {};

  return {
    timeline: {
      ...timeline,
      ...(widenStart ? { start: new Date(min).toISOString() } : {}),
      ...(widenStop ? { [closeKey]: new Date(max).toISOString() } : {}),
    } as Timeline,
  };
}

/**
 * Take a document's own scenes into the deck so the user can edit them.
 *
 * Ids are kept verbatim, which is the whole point: it is what makes the export
 * merge replace each scene *in place* rather than append a near-duplicate after
 * the original. It is also why `isAuthoredSceneId` is false for these — they
 * are editable, but their ids belong to the document, not to this store.
 *
 * Deliberately explicit rather than automatic. Adoption is what turns an
 * absence into a deletion (see `withAuthoredScenes`), and an account-scoped
 * deck that silently adopted every document it was pointed at would accumulate
 * scenes from stories the user only glanced at — and then, on the next save,
 * delete whichever ones it had since dropped.
 */
export function adoptStoryScenes(story: Story | null | undefined): Scene[] {
  return exportableScenes(story?.scenes ?? []);
}
