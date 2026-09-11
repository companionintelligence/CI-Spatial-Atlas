import type { GeoPoint, Item, Story } from '@companion-atlas/story';
import { MIN_VERTICES, editableVertices } from './draft.js';
import { removeVertex, replaceVertex, translatePath, wrapLon } from './geometry.js';

/**
 * The authored-item collection, and how it gets back into a `Story`.
 *
 * Pure list operations over canonical `Item`s. No React state, no Cesium
 * entities, no localStorage — the controller and `AtlasApp` both hold a plain
 * `Item[]` and these functions move it from one value to the next, which is
 * what lets "drag vertex 3 of the polygon two metres east" be a unit test.
 */

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * One selection model for three kinds of thing.
 *
 * The globe already had two independent "selected" concepts before any of this
 * existed — `focusedId` for a memory pin and `focusedPlace` for a named Place —
 * and adding a third for drawn items would guarantee two of them are lit at
 * once. So the controller reports selection as a tagged value and owns none of
 * it: `AtlasApp` decides what a selection means (fly to it, open the inspector,
 * arm the delete button) and pushes the answer back in with `select()`.
 *
 * `kind` is the entity-id prefix the viewer already uses on the globe
 * (`mem:`, `place:`), plus `item` for the drawing layer's own `authoring:`
 * prefix. Keeping the vocabulary identical means the click handler is a switch
 * over a prefix rather than three parallel lookups.
 */
export interface AuthoringSelection {
  kind: 'item' | 'memory' | 'place';
  /** The bare id, with the entity prefix already stripped. */
  id: string;
  /** Present only for `kind: 'item'` — the live item, so a consumer does not
   *  have to search the array to render a style panel. */
  item?: Item;
  /** Present while a vertex handle is being dragged. */
  vertexIndex?: number;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * Allocate an id for a new drawn item.
 *
 * Type-prefixed and sequential (`draw-polygon-3`) rather than a UUID, because
 * these ids are read by humans: they appear in `Scene.itemIds`, in a KML
 * `<Placemark id>`, and in the URL when a story is shared. A counter scoped to
 * the *existing* ids also means the sequence survives an undo — deleting
 * `draw-line-2` and drawing again gives `draw-line-3`, never a second
 * `draw-line-2` that would collide with an id already written into a scene.
 *
 * `existing` is every id in the story, not just the drawn ones: a drawn shape
 * and an imported memory sharing an id makes `EntityCollection.add` throw and
 * blanks the whole layer (`CesiumStoryViewer` guards the same hazard by
 * de-duplicating memory pins).
 */
export function nextItemId(type: Item['type'], existing: Iterable<string>, prefix = 'draw'): string {
  const taken = new Set(existing);
  let n = 1;
  let id = `${prefix}-${type}-${n}`;
  while (taken.has(id)) id = `${prefix}-${type}-${++n}`;
  return id;
}

/** Every id a story already uses, across both entity forms. */
export function storyIds(story: Story | null | undefined, extra: Item[] = []): string[] {
  const ids: string[] = [];
  for (const i of story?.items ?? []) ids.push(i.id);
  for (const m of story?.media ?? []) ids.push(m.id);
  for (const l of story?.layers ?? []) ids.push(l.id);
  for (const i of extra) ids.push(i.id);
  return ids;
}

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/** Insert or replace by id, preserving position for a replace. Order is the
 *  draw order and it is meaningful — later shapes paint over earlier ones. */
export function upsertItem(items: Item[], item: Item): Item[] {
  const at = items.findIndex((i) => i.id === item.id);
  if (at < 0) return [...items, item];
  const out = [...items];
  out[at] = item;
  return out;
}

export function removeItem(items: Item[], id: string): Item[] {
  return items.filter((i) => i.id !== id);
}

export function findItem(items: Item[], id: string | null | undefined): Item | null {
  return (id ? items.find((i) => i.id === id) : undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Editing one item's geometry
// ---------------------------------------------------------------------------

/** Move a whole item by a delta in degrees. Returns the same object when the
 *  item has no geometry to move, so an unnecessary re-render/entity rebuild is
 *  skipped by reference check. */
export function moveItem(item: Item, dLon: number, dLat: number): Item {
  if (!Number.isFinite(dLon) || !Number.isFinite(dLat) || (dLon === 0 && dLat === 0)) return item;
  switch (item.type) {
    case 'line':
      return { ...item, positions: translatePath(item.positions, dLon, dLat) };
    case 'polygon':
      return {
        ...item,
        positions: translatePath(item.positions, dLon, dLat),
        // Holes travel with their outer ring. Moving one and not the other is
        // how a "why is there a hole in the sea next to my parcel" bug happens.
        ...(item.holes?.length ? { holes: item.holes.map((h) => translatePath(h, dLon, dLat)) } : {}),
      };
    case 'marker':
    case 'note':
    case 'photo':
    case 'video':
    case 'model':
      return { ...item, position: translatePoint(item.position, dLon, dLat) };
    case 'splat':
    case 'tileset':
      return item.position ? { ...item, position: translatePoint(item.position, dLon, dLat) } : item;
    default:
      return item;
  }
}

function translatePoint(p: GeoPoint, dLon: number, dLat: number): GeoPoint {
  return { ...p, lon: wrapLon(p.lon + dLon), lat: Math.max(-90, Math.min(90, p.lat + dLat)) };
}

/** Drag one vertex to a new position. Out-of-range indices are a no-op — a
 *  drag that outlives the shape it started on must not resurrect a vertex. */
export function setVertex(item: Item, index: number, point: GeoPoint): Item {
  switch (item.type) {
    case 'line':
    case 'polygon': {
      const positions = replaceVertex(item.positions, index, point);
      return positions === item.positions ? item : { ...item, positions };
    }
    case 'marker':
    case 'note':
    case 'photo':
    case 'video':
    case 'model':
      return index === 0 ? { ...item, position: point } : item;
    case 'splat':
    case 'tileset':
      return index === 0 && item.position ? { ...item, position: point } : item;
    default:
      return item;
  }
}

/**
 * Delete one vertex from a line/polygon.
 *
 * Returns `null` when the shape cannot survive it — a two-vertex line or a
 * three-vertex polygon losing one is not "a smaller shape", it is an item that
 * fails `GeoPath.min(2)`/`.min(3)` on the next save. The caller deletes the
 * whole item instead, which is what the user meant.
 */
export function deleteVertex(item: Item, index: number): Item | null {
  if (item.type !== 'line' && item.type !== 'polygon') return item;
  const min = MIN_VERTICES[item.type];
  if (item.positions.length <= min) return null;
  const positions = removeVertex(item.positions, index, min);
  return positions === item.positions ? item : { ...item, positions };
}

/** How many handles this item shows. */
export function vertexCount(item: Item): number {
  return editableVertices(item).length;
}

// ---------------------------------------------------------------------------
// Back into the Story
// ---------------------------------------------------------------------------

/**
 * Merge authored items into a story's `items[]`.
 *
 * Replace-by-id, then append in draw order — so re-merging an edited item
 * updates it in place rather than growing a duplicate, and `Scene.itemIds`
 * pointing at it keeps working.
 *
 * Nothing is mutated: `AtlasApp` holds the loaded story in state and hands the
 * same object to `CesiumStoryViewer`, whose `useMemo(() => storyToCzml(story))`
 * is keyed on identity. Mutating `story.items` in place would leave the CZML
 * memoised against geometry that no longer exists — the classic "my edit only
 * appears after I switch basemaps" bug.
 *
 * `updatedAt` is stamped because a story that has been edited and one that has
 * not are different documents, and the save path (`saveStoryToMemory`) has no
 * other way to tell.
 */
export function mergeAuthoredItems(story: Story, authored: Item[]): Story {
  if (authored.length === 0) return story;
  const byId = new Map(authored.map((i) => [i.id, i]));
  const merged: Item[] = [];
  for (const existing of story.items ?? []) {
    const replacement = byId.get(existing.id);
    if (replacement) {
      merged.push(replacement);
      byId.delete(existing.id);
    } else {
      merged.push(existing);
    }
  }
  for (const item of authored) {
    const remaining = byId.get(item.id);
    if (remaining) merged.push(remaining);
  }
  return { ...story, items: merged, updatedAt: new Date().toISOString() };
}

/**
 * Pull the drawn items back out of a story.
 *
 * `source.kind === 'manual'` is the marker `finishDraft` stamps. Used when a
 * saved story is re-opened: the shapes the user drew become editable again,
 * while imported geometry stays read-only — which is the honest default, since
 * editing an imported boundary silently forks it away from the source it can
 * still be re-imported from.
 */
export function authoredItems(story: Story | null | undefined): Item[] {
  return (story?.items ?? []).filter((i) => i.source?.kind === 'manual');
}

/** The geometry types the drawing tools can edit. Anything else in a story is
 *  selectable but not draggable. */
export function isEditable(item: Item): boolean {
  return item.type === 'marker' || item.type === 'note' || item.type === 'line' || item.type === 'polygon';
}
