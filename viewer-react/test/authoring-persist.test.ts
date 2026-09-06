import { beforeEach, describe, expect, it } from 'vitest';
import { Story as StorySchema, type Item } from '@companion-atlas/story';
import {
  clearItems,
  coerceItems,
  hydrateItems,
  keyFor,
  readItems,
  writeItems,
  type AuthoringStorage,
} from '../src/authoring/persist.js';
import { mergeAuthoredItems } from '../src/authoring/store.js';

/**
 * Persistence for drawn shapes.
 *
 * Two defects live behind this file. The first is the one the user reports:
 * drawn items were `useState<Item[]>([])` and a reload threw them away. The
 * second is the one they never see until it bites — a stored value that this
 * version of the app did not write. It has three plausible origins (an older
 * release, a write truncated by a quota error, a human with devtools open) and
 * only one of them is well-formed, so every read has to survive all three:
 * a throw during hydration is a white screen, while a dropped shape is a shape
 * the user draws again.
 *
 * The third axis is scope. These items are merged into `exportStory` and can be
 * written into whichever Companion Memory is connected, so one account's
 * shapes reaching another account's story is not a cosmetic bug — hence the
 * deliberate absence of the anonymous-bucket inheritance `layers/store.ts` has.
 */

/** A localStorage stand-in: the suite runs in Node, where there isn't one. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  } satisfies AuthoringStorage & { map: Map<string, string> };
}

const p = (lon: number, lat: number) => ({ lon, lat });

const polygon = (id = 'draw-polygon-1', over: Record<string, unknown> = {}): Item =>
  ({
    id,
    type: 'polygon',
    positions: [p(0, 0), p(1, 0), p(1, 1)],
    fillColor: '#72ddd4',
    fillOpacity: 0.3,
    outlineColor: '#72ddd4',
    outlineWidth: 3,
    source: { kind: 'manual' },
    ...over,
  }) as Item;

const marker = (id = 'draw-marker-1', over: Record<string, unknown> = {}): Item =>
  ({ id, type: 'marker', position: p(2, 2), source: { kind: 'manual' }, ...over }) as Item;

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => { storage = fakeStorage(); });

describe('round trip', () => {
  it('writes and reads back an identical set, in draw order', () => {
    // Draw order is meaningful — later shapes paint over earlier ones — so this
    // is an ordered comparison, not a set one.
    const drawn = [polygon(), marker(), polygon('draw-polygon-2', { title: 'Site B' })];
    writeItems('memory-a', drawn, storage);
    expect(readItems('memory-a', storage)).toEqual(drawn);
  });

  it('survives the trip back into a Story', () => {
    // The point of persisting: what comes back has to be exportable. If a
    // stored shape cannot pass `Story.parse` then Save and Download fail on a
    // document the user cannot see anything wrong with.
    writeItems(null, [polygon(), marker()], storage);
    const story = {
      id: 's1',
      title: 'Test',
      schema: 'companion.atlas/story@1',
      scenes: [],
      items: [],
    };
    const merged = mergeAuthoredItems(story as never, readItems(null, storage));
    expect(StorySchema.safeParse(merged).success).toBe(true);
    expect(merged.items?.map((i) => i.id)).toEqual(['draw-polygon-1', 'draw-marker-1']);
  });

  it('persists an empty set rather than forgetting the key', () => {
    // Deleting your last shape is a deliberate act. Removing the key instead
    // would make it indistinguishable from "never drew anything", and any
    // future fallback would happily resurrect what was deleted.
    writeItems('memory-a', [polygon()], storage);
    writeItems('memory-a', [], storage);
    expect(storage.map.has(keyFor('memory-a'))).toBe(true);
    expect(readItems('memory-a', storage)).toEqual([]);
  });

  it('reads nothing for a scope that has never been written', () => {
    expect(readItems('memory-a', storage)).toEqual([]);
  });
});

describe('a stored value this version did not write', () => {
  it('returns an empty set for unparseable JSON instead of throwing', () => {
    // A quota error can truncate a write mid-string. Hydration must not be the
    // thing that takes the app down.
    storage.map.set(keyFor('memory-a'), '{"v":1,"items":[{"id":"draw-line-1"');
    expect(() => readItems('memory-a', storage)).not.toThrow();
    expect(readItems('memory-a', storage)).toEqual([]);
  });

  it('keeps the valid shapes and drops the corrupt ones', () => {
    storage.map.set(
      keyFor('memory-a'),
      JSON.stringify({
        v: 1,
        items: [
          polygon(),
          { id: 'draw-line-9', type: 'line', positions: [p(0, 0)] }, // GeoPath.min(2)
          { id: 'draw-marker-9', type: 'marker' }, // no position
          { type: 'marker', position: p(1, 1) }, // no id
          'not an item',
          null,
          marker(),
        ],
      }),
    );
    // Everything dropped here would have failed `Story.parse` on the way out.
    expect(readItems('memory-a', storage).map((i) => i.id)).toEqual([
      'draw-polygon-1',
      'draw-marker-1',
    ]);
  });

  it('drops a field the schema does not know', () => {
    // Canonicalisation, not tolerance: what comes back out of here is merged
    // into a Story and serialised, so a stray property from an older release
    // (or a devtools paste) must not ride along into a saved document.
    const [item] = coerceItems([{ ...(polygon() as object), strokeColour: 'chartreuse' }]);
    expect(item).not.toHaveProperty('strokeColour');
    expect((item as { fillColor?: string }).fillColor).toBe('#72ddd4');
  });

  it('accepts a bare array, which is what an older draft and a paste both look like', () => {
    storage.map.set(keyFor('memory-a'), JSON.stringify([polygon()]));
    expect(readItems('memory-a', storage).map((i) => i.id)).toEqual(['draw-polygon-1']);
  });

  it('drops a duplicate id, keeping the first occurrence in place', () => {
    // Two entities with one id makes `EntityCollection.add` throw, which aborts
    // the redraw loop and blanks the whole drawing layer.
    const items = coerceItems([polygon('dup', { title: 'first' }), marker('mid'), polygon('dup', { title: 'second' })]);
    expect(items.map((i) => i.id)).toEqual(['dup', 'mid']);
    expect(items[0]?.title).toBe('first');
  });

  it('stamps a missing provenance as manual so the shape stays editable', () => {
    // `authoredItems()` decides a shape is the user's own by `source.kind`.
    // Without this, a hand-edited entry comes back as read-only geometry the
    // user drew themselves and can no longer touch.
    const [item] = coerceItems([{ id: 'draw-marker-1', type: 'marker', position: p(1, 1) }]);
    expect(item?.source?.kind).toBe('manual');
    // An explicit provenance is left alone — an imported shape that was saved
    // into the story must not start claiming it was hand-drawn.
    const [imported] = coerceItems([
      { id: 'geo-1', type: 'marker', position: p(1, 1), source: { kind: 'import' } },
    ]);
    expect(imported?.source?.kind).toBe('import');
  });
});

describe('scope', () => {
  it('keeps one account’s shapes out of another’s', () => {
    writeItems('memory-alice', [polygon('alice-shape')], storage);
    writeItems('memory-bob', [polygon('bob-shape')], storage);
    expect(readItems('memory-alice', storage).map((i) => i.id)).toEqual(['alice-shape']);
    expect(readItems('memory-bob', storage).map((i) => i.id)).toEqual(['bob-shape']);
    expect(keyFor('memory-alice')).not.toBe(keyFor('memory-bob'));
  });

  it('does not hand the signed-out bucket to an account', () => {
    // The deliberate difference from `layers/store.ts`, which does inherit.
    // A layer stack is a list of sources; these are *content*, and they end up
    // merged into whatever story gets saved into the connected memory. Two
    // people sharing a browser must not sign each other's annotations.
    writeItems(null, [polygon('drawn-while-signed-out')], storage);
    expect(readItems('memory-alice', storage)).toEqual([]);
    // …and the anonymous bucket is untouched, so disconnecting brings it back.
    expect(readItems(null, storage).map((i) => i.id)).toEqual(['drawn-while-signed-out']);
  });

  it('gives the signed-out bucket its own unscoped key', () => {
    expect(keyFor(null)).not.toContain(':');
    expect(keyFor('memory-a')).toContain(':');
  });

  it('clears one scope without touching another', () => {
    writeItems('memory-alice', [polygon('a')], storage);
    writeItems('memory-bob', [polygon('b')], storage);
    clearItems('memory-alice', storage);
    expect(readItems('memory-alice', storage)).toEqual([]);
    expect(readItems('memory-bob', storage).map((i) => i.id)).toEqual(['b']);
  });
});

describe('storage that refuses to work', () => {
  it('treats a full quota as a failed save, not a crash', () => {
    // A private window, a full origin, or storage disabled by policy. The
    // shapes are still on the globe and still in `exportStory` for this
    // session; the reload is what loses them, and that is not worth an
    // exception thrown through React.
    const throwing: AuthoringStorage = {
      getItem: () => { throw new DOMException('denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
      removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
    };
    expect(() => writeItems('memory-a', [polygon()], throwing)).not.toThrow();
    expect(readItems('memory-a', throwing)).toEqual([]);
    expect(() => clearItems('memory-a', throwing)).not.toThrow();
  });

  it('does nothing at all when there is no storage (Node, SSR, a worker)', () => {
    expect(readItems('memory-a', null)).toEqual([]);
    expect(() => writeItems('memory-a', [polygon()], null)).not.toThrow();
    expect(() => clearItems('memory-a', null)).not.toThrow();
  });
});

describe('hydration', () => {
  const storyWith = (items: Item[]) =>
    ({ id: 's1', title: 'Test', schema: 'companion.atlas/story@1', scenes: [], items }) as never;

  it('adds the stored bucket to what the story already carries', () => {
    const fromStory = polygon('draw-polygon-1', { title: 'saved with the story' });
    const drawnSince = marker('draw-marker-7');
    expect(hydrateItems(storyWith([fromStory]), [drawnSince]).map((i) => i.id)).toEqual([
      'draw-polygon-1',
      'draw-marker-7',
    ]);
  });

  it('lets the stored copy win an id collision, in place', () => {
    // Same shape, two versions: the story holds what was saved, the bucket
    // holds the edit made after the save. Draw order is the story's, so the
    // winner takes the loser's position rather than jumping to the end.
    const merged = hydrateItems(
      storyWith([polygon('draw-polygon-1', { title: 'as saved' }), marker('draw-marker-1')]),
      [polygon('draw-polygon-1', { title: 'edited since' })],
    );
    expect(merged.map((i) => i.id)).toEqual(['draw-polygon-1', 'draw-marker-1']);
    expect(merged[0]?.title).toBe('edited since');
  });

  it('ignores story items nobody drew', () => {
    // Only `source.kind === 'manual'` is editable geometry. An imported
    // boundary stays where the importer put it — adopting it here would fork it
    // away from the source it can still be re-imported from.
    const imported = { ...(marker('geo-1') as object), source: { kind: 'import' } } as Item;
    expect(hydrateItems(storyWith([imported]), []).map((i) => i.id)).toEqual([]);
  });

  it('is just the stored bucket when no story has loaded yet', () => {
    expect(hydrateItems(null, [marker('draw-marker-1')]).map((i) => i.id)).toEqual(['draw-marker-1']);
    expect(hydrateItems(null, [])).toEqual([]);
  });
});
