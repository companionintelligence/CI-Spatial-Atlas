import { describe, expect, it } from 'vitest';
import { Item as ItemSchema, Story as StorySchema, type Item, type Story } from '@companion-atlas/story';
import {
  authoredItems,
  deleteVertex,
  findItem,
  isEditable,
  mergeAuthoredItems,
  moveItem,
  nextItemId,
  removeItem,
  setVertex,
  storyIds,
  upsertItem,
  vertexCount,
} from '../src/authoring/store.js';
import {
  DRAFT_LINE_ID,
  ITEM_PREFIX,
  MOVE_HANDLE_ID,
  itemEntityId,
  outlineEntityId,
  parsePickedId,
  vertexEntityId,
} from '../src/authoring/ids.js';

/**
 * The item list, the selection model's id vocabulary, and the merge back into
 * a `Story`.
 *
 * The merge is the part with teeth: `AtlasApp` holds the loaded story in state
 * and hands the same object to `CesiumStoryViewer`, whose CZML is memoised on
 * story identity. A merge that mutated in place would leave the globe rendering
 * geometry that no longer exists until something unrelated forced a re-render —
 * the "my edit only appears after I switch basemaps" bug. So every assertion
 * about the merge also checks that the input was left alone.
 */

const p = (lon: number, lat: number, height?: number) =>
  height == null ? { lon, lat } : { lon, lat, height };

const marker = (id: string, lon = 0, lat = 0): Item => ({
  id, type: 'marker', position: p(lon, lat), source: { kind: 'manual' },
});

const line = (id: string, ...pts: { lon: number; lat: number }[]): Item => ({
  id, type: 'line', positions: pts, source: { kind: 'manual' },
});

const baseStory = (items: Item[] = []): Story => ({
  schema: 'companion.atlas/story@1',
  id: 'story-1',
  title: 'Test',
  scenes: [{ id: 's1' }],
  items,
});

describe('entity id vocabulary', () => {
  it('round-trips an item id', () => {
    expect(parsePickedId(itemEntityId('draw-line-1'))).toEqual({ kind: 'item', id: 'draw-line-1' });
  });

  it('survives an id that itself contains a colon', () => {
    // `split(':')[1]` would return "line" here. Every parse is indexOf-based.
    expect(parsePickedId(itemEntityId('ci:memory:44'))).toEqual({ kind: 'item', id: 'ci:memory:44' });
  });

  it('keeps the sibling prefixes apart', () => {
    // `authoring:`, `authoring-outline:` and `authoring-vertex:` all begin
    // "authoring"; the colon in ITEM_PREFIX is what separates them.
    expect(ITEM_PREFIX).toBe('authoring:');
    expect(parsePickedId(vertexEntityId(3))).toEqual({ kind: 'vertex', index: 3 });
    expect(parsePickedId(MOVE_HANDLE_ID)).toEqual({ kind: 'move' });
    expect(parsePickedId(DRAFT_LINE_ID)).toEqual({ kind: 'draft' });
  });

  it('maps a polygon outline back to the polygon it belongs to', () => {
    // Clicking the edge of an outline-only area has to select the area — a
    // fully transparent fill is not pickable at all.
    expect(parsePickedId(outlineEntityId('draw-polygon-2'))).toEqual({ kind: 'item', id: 'draw-polygon-2' });
  });

  it('speaks the memory and place layers’ prefixes too', () => {
    expect(parsePickedId('mem:evt-9')).toEqual({ kind: 'memory', id: 'evt-9' });
    expect(parsePickedId('place:adler')).toEqual({ kind: 'place', id: 'adler' });
  });

  it('returns null for anything it does not own', () => {
    expect(parsePickedId('document')).toBeNull();
    expect(parsePickedId('')).toBeNull();
    expect(parsePickedId(null)).toBeNull();
    expect(parsePickedId('authoring:')).toBeNull();
    expect(parsePickedId('authoring-vertex:nope')).toBeNull();
  });
});

describe('id allocation', () => {
  it('is type-prefixed and human-readable', () => {
    expect(nextItemId('polygon', [])).toBe('draw-polygon-1');
  });

  it('never reuses an id an undo freed', () => {
    // draw-line-2 may already be written into a Scene.itemIds somewhere.
    expect(nextItemId('line', ['draw-line-1', 'draw-line-3'])).toBe('draw-line-2');
    expect(nextItemId('line', ['draw-line-1', 'draw-line-2', 'draw-line-3'])).toBe('draw-line-4');
  });

  it('avoids colliding with the story, not just with other drawings', () => {
    // A duplicate id makes EntityCollection.add throw and blanks the layer.
    const story = baseStory([marker('draw-marker-1')]);
    expect(nextItemId('marker', storyIds(story))).toBe('draw-marker-2');
  });

  it('collects ids from every entity form a story carries', () => {
    const story: Story = {
      ...baseStory([marker('a')]),
      media: [{ id: 'b', kind: 'image', uri: 'https://x/1.jpg' }],
      layers: [{ id: 'c', kind: 'imagery' }],
    };
    expect(storyIds(story).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('list operations', () => {
  it('appends a new item and replaces an existing one IN PLACE', () => {
    // Draw order is paint order; a replace that moved the item to the end would
    // silently change which shape is on top.
    const items = [marker('a'), marker('b'), marker('c')];
    const replaced = upsertItem(items, marker('b', 9, 9));
    expect(replaced.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(replaced[1]).toMatchObject({ position: { lon: 9, lat: 9 } });
    expect(upsertItem(items, marker('d')).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(items).toHaveLength(3); // input untouched
  });

  it('removes and finds by id', () => {
    const items = [marker('a'), marker('b')];
    expect(removeItem(items, 'a').map((i) => i.id)).toEqual(['b']);
    expect(findItem(items, 'b')?.id).toBe('b');
    expect(findItem(items, 'nope')).toBeNull();
    expect(findItem(items, null)).toBeNull();
  });
});

describe('editing geometry', () => {
  it('moves a whole shape and keeps every height', () => {
    const item = line('l', p(0, 0, 100), p(1, 1, 200));
    const moved = moveItem(item, 2, -1);
    if (moved.type !== 'line') throw new Error('narrowing');
    expect(moved.positions).toEqual([p(2, -1, 100), p(3, 0, 200)]);
    expect(ItemSchema.parse(moved)).toBeTruthy();
  });

  it('carries a polygon’s holes along with its outer ring', () => {
    const item: Item = {
      id: 'p',
      type: 'polygon',
      positions: [p(0, 0), p(4, 0), p(4, 4), p(0, 4)],
      holes: [[p(1, 1), p(2, 1), p(2, 2)]],
    };
    const moved = moveItem(item, 10, 0);
    if (moved.type !== 'polygon') throw new Error('narrowing');
    expect(moved.positions[0]).toEqual(p(10, 0));
    // Leaving the hole behind is how "why is there a hole in the sea next to
    // my parcel" happens.
    expect(moved.holes?.[0]?.[0]).toEqual(p(11, 1));
  });

  it('is a no-op for a zero delta, by identity', () => {
    const item = marker('m');
    expect(moveItem(item, 0, 0)).toBe(item);
  });

  it('drags one vertex without disturbing the rest', () => {
    const item = line('l', p(0, 0), p(1, 1), p(2, 2));
    const next = setVertex(item, 1, p(5, 5));
    if (next.type !== 'line') throw new Error('narrowing');
    expect(next.positions).toEqual([p(0, 0), p(5, 5), p(2, 2)]);
    // A drag that outlived its shape must not resurrect a vertex.
    expect(setVertex(item, 7, p(5, 5))).toBe(item);
  });

  it('moves a marker through the same vertex-0 path the drag code uses', () => {
    const next = setVertex(marker('m'), 0, p(3, 4));
    expect(next).toMatchObject({ position: { lon: 3, lat: 4 } });
  });

  it('deletes a vertex, and refuses when the shape could not survive it', () => {
    const triangle: Item = { id: 'p', type: 'polygon', positions: [p(0, 0), p(1, 0), p(1, 1)] };
    // A triangle losing a vertex is an item that fails GeoPath.min(3) on save.
    expect(deleteVertex(triangle, 0)).toBeNull();

    const quad: Item = { id: 'p', type: 'polygon', positions: [p(0, 0), p(1, 0), p(1, 1), p(0, 1)] };
    const trimmed = deleteVertex(quad, 0);
    expect(trimmed).not.toBeNull();
    expect(ItemSchema.parse(trimmed)).toBeTruthy();
  });

  it('counts handles, and knows what the tools can edit', () => {
    expect(vertexCount(line('l', p(0, 0), p(1, 1), p(2, 2)))).toBe(3);
    expect(vertexCount(marker('m'))).toBe(1);
    expect(isEditable(marker('m'))).toBe(true);
    expect(isEditable({ id: 't', type: 'tileset', tileset: 'https://x/tileset.json' })).toBe(false);
  });
});

describe('merging back into a Story', () => {
  it('replaces by id and appends the rest, in draw order', () => {
    const story = baseStory([marker('imported'), marker('draw-marker-1')]);
    const merged = mergeAuthoredItems(story, [marker('draw-marker-1', 5, 5), marker('draw-line-1', 1, 1)]);
    expect(merged.items?.map((i) => i.id)).toEqual(['imported', 'draw-marker-1', 'draw-line-1']);
    expect(merged.items?.[1]).toMatchObject({ position: { lon: 5, lat: 5 } });
  });

  it('never mutates the story it was given', () => {
    const story = baseStory([marker('a')]);
    const before = JSON.stringify(story);
    mergeAuthoredItems(story, [marker('b')]);
    expect(JSON.stringify(story)).toBe(before);
  });

  it('produces a document that still validates', () => {
    const story = baseStory([]);
    const merged = mergeAuthoredItems(story, [
      line('draw-line-1', p(0, 0), p(1, 1)),
      marker('draw-marker-1'),
    ]);
    expect(() => StorySchema.parse(merged)).not.toThrow();
    expect(Date.parse(merged.updatedAt!)).not.toBeNaN();
  });

  it('is the identity when there is nothing drawn', () => {
    const story = baseStory([marker('a')]);
    expect(mergeAuthoredItems(story, [])).toBe(story);
  });

  it('re-adopts only the shapes a person drew', () => {
    // Editing an imported boundary silently forks it away from the source it
    // can still be re-imported from, so imports stay read-only.
    const story = baseStory([
      { id: 'kml-1', type: 'polygon', positions: [p(0, 0), p(1, 0), p(1, 1)], source: { kind: 'import' } },
      marker('draw-marker-1'),
    ]);
    expect(authoredItems(story).map((i) => i.id)).toEqual(['draw-marker-1']);
    expect(authoredItems(null)).toEqual([]);
  });
});
