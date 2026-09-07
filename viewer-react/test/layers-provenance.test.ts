/**
 * Provenance: whose layer is this, and what happens when the user takes it away.
 *
 * Every case below is a bug that shipped, and all of them come from one missing
 * distinction. The stack knew what it was holding but not *where each row came
 * from*, so "is this in the stack right now" had to stand in for three different
 * questions it cannot answer:
 *
 *  - **Is the CZML path allowed to draw this tileset?** Asked of the live stack,
 *    the answer flipped to "yes" the instant the user removed the row, so
 *    `storyToCzml` remounted the tileset the layer scene had just torn down. The
 *    layer came back on the globe with no panel row, no toggle, no opacity
 *    control and no way to remove it again.
 *  - **Should a save keep this story layer?** Answered "always", so Remove was
 *    absent from every save and every export: the row vanished from the panel
 *    and was back the next time the document opened.
 *  - **Is this row the user's to keep?** Never asked, so one visit to a shared
 *    story grafted its sources onto the user's account-scoped stack for ever and
 *    folded them into saves of entirely unrelated stories.
 *
 * None of the three produces an error, a log line or a failed render — the globe
 * simply shows the wrong thing — so a test is the only thing that can catch a
 * regression. Everything here is pure: `useLayers` holds nothing but the
 * `useState` and the two effects, and the rules it calls live in `model.ts` and
 * `story.ts` precisely so they can be exercised without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { Story as StorySchema, type Story } from '@companion-atlas/story';
import {
  adoptStoryLayer,
  claimedSourceUrls,
  isStoryLayer,
  isUserLayer,
  normaliseOrder,
  removeLayer,
  type AtlasLayer,
} from '../src/layers/model.js';
import { adoptStoryLayers, toStoryLayers, withStoryLayers } from '../src/layers/story.js';
import { readLayers, writeLayers, type LayerStorage } from '../src/layers/store.js';
import { importText } from '../src/interop/importFile.js';

const TILESET = 'https://tiles.example/city/tileset.json';
const FIRES = 'https://example.org/fires/2019.geojson';

/** A story as it comes off the wire: parsed, not a hopeful object literal. */
const storyWith = (layers: unknown[]): Story =>
  StorySchema.parse({
    schema: 'companion.atlas/story@1',
    id: 'story-under-test',
    title: 'Provenance',
    scenes: [{ id: 's1', title: 'Opening' }],
    layers,
  });

const SHARED = storyWith([
  // A kind the panel cannot own: no URL to fetch, no stack position. It must
  // survive every save, because its absence from the stack proves nothing.
  { id: 'statue', kind: 'model', uri: 'https://example.org/statue.glb' },
  { id: 'city-tiles', kind: '3d-tiles', name: 'City', uri: TILESET },
  {
    id: 'fires-2019',
    kind: 'geojson',
    format: 'geojson',
    name: 'Fire perimeters',
    uri: FIRES,
    attribution: { text: 'NIFC', licence: 'Public domain' },
  },
]);

const userLayer = (over: Partial<AtlasLayer> = {}): AtlasLayer => ({
  id: 'mine',
  name: 'Mine',
  format: 'xyz',
  url: 'https://tiles.example/mine/{z}/{x}/{y}.png',
  visible: true,
  opacity: 1,
  order: 0,
  ...over,
});

/** An in-memory `localStorage`, so the persistence rule is exercised through the
 *  real store rather than through a mock of it. */
function memoryStorage(): LayerStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe('adopting a story\'s layers', () => {
  it('stamps the document\'s id on them and leaves the user\'s own alone', () => {
    const stack = adoptStoryLayers([userLayer()], SHARED.layers, { storyId: SHARED.id });

    expect(stack.filter(isStoryLayer).map((l) => l.name)).toEqual(['City', 'Fire perimeters']);
    expect(stack.filter(isStoryLayer).every((l) => l.fromStoryId === 'story-under-test')).toBe(true);
    // The `model` layer never reaches the panel — it is an entity `czml.ts`
    // places, not a source with a stack position.
    expect(stack.map((l) => l.url)).not.toContain('https://example.org/statue.glb');
    expect(stack.filter(isUserLayer).map((l) => l.id)).toEqual(['mine']);
  });

  it('treats layers with no document id as the user\'s own', () => {
    // This is the dropped-`.story.json` path. The user brought the file
    // deliberately, so its layers are theirs: persisted, and not tombstoned on
    // removal (nothing would re-add them).
    const stack = adoptStoryLayers([], SHARED.layers);
    expect(stack.every(isUserLayer)).toBe(true);
  });

  it('returns the same array when the story has no layers to add', () => {
    // Identity, not equality: this runs on every change of the open document's
    // reference, and a fresh array would re-persist the stack and re-run every
    // memo hanging off it.
    const stack = [userLayer()];
    expect(adoptStoryLayers(stack, undefined, { storyId: 'x' })).toBe(stack);
    expect(adoptStoryLayers(stack, [], { storyId: 'x' })).toBe(stack);
  });
});

describe('only the user\'s layers are the user\'s to keep', () => {
  it('does not write a visited story\'s layers into the account bucket', () => {
    // The bug: one visit to a shared story grafted its sources onto the stack
    // for ever — the stack is "the sources I keep going back to", scoped to the
    // account, and a borrowed layer is not one of those. Worse, `toStory` then
    // folded them into saves of entirely different stories.
    const storage = memoryStorage();
    const stack = adoptStoryLayers([userLayer()], SHARED.layers, { storyId: SHARED.id });

    // Exactly what the hook's write effect does.
    writeLayers('acct-1', stack.filter(isUserLayer), storage);

    expect(readLayers('acct-1', storage).map((l) => l.id)).toEqual(['mine']);
    expect(storage.dump()['atlas.layers.v1:acct-1']).not.toContain(TILESET);
  });

  it('keeps a source the user added, even when a story mentions it too', () => {
    // Dedupe keeps the user's row. It must stay *theirs* — stamping the story's
    // id on it would quietly stop persisting a layer the user typed in.
    const mine = userLayer({ id: 'my-city', url: TILESET, format: '3d-tiles' });
    const stack = adoptStoryLayers([mine], SHARED.layers, { storyId: SHARED.id });
    const row = stack.find((l) => l.url === TILESET)!;
    expect(isUserLayer(row)).toBe(true);
  });
});

describe('a removed story layer stays removed', () => {
  it('is not re-adopted the next time the document is merged', () => {
    // The merge re-runs whenever the open story's reference changes — which a
    // parent re-render is enough to cause. Without the tombstone, Remove was
    // undone by the next render.
    const adopted = adoptStoryLayers([], SHARED.layers, { storyId: SHARED.id });
    const cityId = adopted.find((l) => l.url === TILESET)!.id;
    const afterRemove = removeLayer(adopted, cityId);
    const dismissed = new Set([TILESET]);

    const remerged = adoptStoryLayers(afterRemove, SHARED.layers, { storyId: SHARED.id, dismissed });
    expect(remerged.map((l) => l.url)).not.toContain(TILESET);
    expect(remerged.map((l) => l.url)).toContain(FIRES);
  });

  it('keeps the CZML path standing down, which is what stops it reappearing', () => {
    // The regression this guards is specific and was introduced by the wiring
    // itself: `storyToCzml` mounts a story's 3d-tiles/gaussian-splat layers, and
    // the renderer suppresses the ones the stack is drawing. Derived from the
    // live stack alone, removal un-claimed the URL in the same commit that tore
    // the layer's own tileset down — flicker, then the tileset was back with no
    // row to operate it. A removal has to claim the URL just as loudly as a
    // drawn layer does.
    const adopted = adoptStoryLayers([], SHARED.layers, { storyId: SHARED.id });
    expect(claimedSourceUrls(adopted)).toContain(TILESET);

    const cityId = adopted.find((l) => l.url === TILESET)!.id;
    const afterRemove = removeLayer(adopted, cityId);
    expect(claimedSourceUrls(afterRemove)).not.toContain(TILESET); // the old, broken answer
    expect(claimedSourceUrls(afterRemove, [TILESET])).toContain(TILESET);
  });
});

describe('outbound: what a save carries', () => {
  it('drops a layer the user removed, and keeps what the panel cannot own', () => {
    const adopted = adoptStoryLayers([], SHARED.layers, { storyId: SHARED.id });
    const firesId = adopted.find((l) => l.url === FIRES)!.id;
    const saved = withStoryLayers(SHARED, removeLayer(adopted, firesId))!;

    expect(saved.layers?.map((l) => l.id)).toEqual(['statue', 'city-tiles']);
    // The `model` entry is untouched — it was never in the stack, so its absence
    // is not a decision the user made.
    expect(saved.layers?.[0]).toEqual(SHARED.layers?.[0]);
    expect(() => StorySchema.parse(saved)).not.toThrow();
  });

  it('drops the last one too', () => {
    // The old short-circuit was `if (layers.length === 0) return story`, so
    // removing the *final* layer left every one of them in the document —
    // "remove all" was the one case that saved nothing at all.
    const saved = withStoryLayers(SHARED, [])!;
    expect(saved.layers?.map((l) => l.id)).toEqual(['statue']);
  });

  it('still hands back the same object when it has nothing to change', () => {
    // The Cesium viewer rebuilds its CZML data source on a new story reference,
    // so a fresh object per call is a visible flicker on a globe nobody touched.
    // Identity survives exactly where the merge is a no-op *by reference* — an
    // empty stack against a document with nothing the panel owns, and the plain
    // empty case. A stack with rows in it always re-serialises those rows, so it
    // legitimately produces a new document; the callers memoise on the stack for
    // that reason.
    const empty = storyWith([]);
    expect(withStoryLayers(empty, [])).toBe(empty);
    expect(withStoryLayers(null, [])).toBeNull();

    const entitiesOnly = storyWith([{ id: 'statue', kind: 'model', uri: 'https://example.org/statue.glb' }]);
    expect(withStoryLayers(entitiesOnly, [])).toBe(entitiesOnly);
  });

  it('writes one entry per URL when the user already had the story\'s source', () => {
    // Dedupe keeps the user's row and used to discard the story's id with it, so
    // on save the story's own entry matched nothing, was kept as "unmatched",
    // and the user's copy appended after it: two layers, one `uri`, two ids.
    // `czml.ts` deduplicates tilesets by URL so 3D content survived, but a
    // duplicated imagery or GeoJSON layer is drawn twice by our reader and by
    // any foreign tool.
    const mine = userLayer({ id: 'my-fires', url: FIRES, format: 'geojson' });
    const stack = adoptStoryLayers([mine], SHARED.layers, { storyId: SHARED.id });
    const saved = withStoryLayers(SHARED, stack)!;

    const uris = saved.layers?.map((l) => l.uri) ?? [];
    expect(uris.filter((u) => u === FIRES)).toHaveLength(1);
    // Replaced in place under the story's own id, so a re-saved document's diff
    // stays readable.
    expect(saved.layers?.map((l) => l.id)).toEqual(['statue', 'city-tiles', 'fires-2019']);
  });

  it('refuses to take an id that is already in the stack', () => {
    // Two rows sharing an id collide as React keys and every edit hits both —
    // strictly worse than the duplicate-on-export the adoption avoids.
    const stack = normaliseOrder([
      userLayer({ id: 'fires-2019', url: 'https://elsewhere.example/other.geojson', format: 'geojson' }),
      userLayer({ id: 'my-fires', url: FIRES, format: 'geojson' }),
    ]);
    const incoming = adoptStoryLayers(stack, SHARED.layers, { storyId: SHARED.id });
    expect(incoming.filter((l) => l.id === 'fires-2019')).toHaveLength(1);
    expect(incoming.find((l) => l.url === FIRES)?.id).toBe('my-fires');
  });

  it('leaves an unrelated story\'s layers alone (`adoptStoryLayer` in isolation)', () => {
    const stack = [userLayer()];
    const added = adoptStoryLayer(stack, userLayer({ id: 'other', url: FIRES, format: 'geojson' }));
    expect(added.map((l) => l.id)).toEqual(['mine', 'other']);
  });
});

describe('export → import round trip', () => {
  it('brings the layers back, with their attributions', () => {
    // This app's own export format was readable in one direction only: dropping
    // a `.story.json` on the globe reduced it to entities, and the layers — plus
    // the credit lines a licence obliges the document to carry — were discarded
    // at parse time with nothing said.
    const stack = adoptStoryLayers([], SHARED.layers, { storyId: SHARED.id });
    const downloaded = JSON.stringify(withStoryLayers(SHARED, stack));

    const file = importText('trip.story.json', downloaded);
    expect(file.format).toBe('story');
    expect(file.error).toBeUndefined();
    expect(file.layers?.map((l) => l.uri)).toEqual([
      'https://example.org/statue.glb',
      TILESET,
      FIRES,
    ]);

    // …and they are usable: fed back to the stack they are the user's own, since
    // dropping the file was a deliberate act.
    const reopened = adoptStoryLayers([], file.layers);
    expect(reopened.map((l) => l.url)).toEqual([TILESET, FIRES]);
    expect(reopened.every(isUserLayer)).toBe(true);
    expect(reopened.find((l) => l.url === FIRES)?.attribution).toEqual({
      text: 'NIFC',
      licence: 'Public domain',
    });
  });

  it('reports nothing when the document has neither layers nor entities', () => {
    const bare = JSON.stringify(storyWith([]));
    expect(importText('bare.story.json', bare).layers).toEqual([]);
  });
});

describe('the schema keeps ours to itself', () => {
  it('never writes `fromStoryId` into a story document', () => {
    // Zod strips unknown top-level keys on parse, so a field invented up there
    // would survive in memory and vanish on the first server round trip — the
    // worst kind of bug, because it only shows up after a save.
    const stack = adoptStoryLayers([], SHARED.layers, { storyId: SHARED.id });
    const written = JSON.stringify(toStoryLayers(stack));
    expect(written).not.toContain('fromStoryId');
  });

  it('never reads a story tag back out of storage', () => {
    // Storage holds only the user's layers, so anything in it is theirs. A
    // leftover tag from an older build would produce a row the write effect then
    // refuses to persist — a layer that disappears on the next unrelated change.
    const storage = memoryStorage();
    storage.setItem('atlas.layers.v1:acct-1', JSON.stringify({
      v: 1,
      layers: [{ ...userLayer(), fromStoryId: 'some-old-story' }],
    }));
    expect(readLayers('acct-1', storage).every(isUserLayer)).toBe(true);
  });
});
