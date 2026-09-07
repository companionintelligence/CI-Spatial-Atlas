/**
 * Persistence for the layer stack.
 *
 * The interesting cases are all the ones where the stored value is *not* what
 * this version of the app wrote: a hand-edited key, a truncated write, an older
 * shape. `useScrapbook` sets the precedent — tolerate the input, never throw at
 * mount — and the reason is blunt: a parse error during hydration is a white
 * screen, while a dropped layer is a layer the user adds again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLayers,
  coerceLayer,
  keyFor,
  readLayers,
  writeLayers,
  type LayerStorage,
} from '../src/layers/store.js';
import type { AtlasLayer } from '../src/layers/model.js';

/** A localStorage stand-in: the suite runs in Node, where there isn't one. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  } satisfies LayerStorage & { map: Map<string, string> };
}

const layer = (id: string, over: Partial<AtlasLayer> = {}): AtlasLayer => ({
  id,
  name: id,
  format: 'xyz',
  url: `https://tiles.example/${id}/{z}/{x}/{y}.png`,
  visible: true,
  opacity: 1,
  order: 0,
  options: { tilingScheme: 'web-mercator' },
  ...over,
});

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => { storage = fakeStorage(); });

describe('round trip', () => {
  it('writes and reads back an identical stack', () => {
    const stack = [
      layer('osm', { order: 0, opacity: 0.5, visible: false, attribution: { text: '© OpenStreetMap contributors', licence: 'ODbL 1.0' } }),
      layer('s2', { order: 1, format: 'wmts', url: 'https://eox.example/wmts/{TileMatrix}/{TileRow}/{TileCol}.jpg', availability: { start: '2023-01-01T00:00:00Z', stop: '2023-12-31T23:59:59Z' }, options: { tilingScheme: 'web-mercator', wmtsLayer: 'x' } }),
    ];
    writeLayers('acct-1', stack, storage);
    expect(readLayers('acct-1', storage)).toEqual(stack);
  });

  it('scopes to the account', () => {
    writeLayers('alice', [layer('a')], storage);
    writeLayers('bob', [layer('b')], storage);
    expect(readLayers('alice', storage).map((l) => l.id)).toEqual(['a']);
    expect(readLayers('bob', storage).map((l) => l.id)).toEqual(['b']);
    expect(keyFor('alice')).not.toBe(keyFor('bob'));
    expect(keyFor(null)).not.toContain(':');
  });

  it('inherits the signed-out stack the first time an account reads, but not after', () => {
    // Layers added before signing in should not look like they were thrown
    // away; layers deliberately deleted afterwards must not come back.
    writeLayers(null, [layer('anon')], storage);
    expect(readLayers('alice', storage).map((l) => l.id)).toEqual(['anon']);
    writeLayers('alice', [], storage);
    expect(readLayers('alice', storage)).toEqual([]);
  });

  it('renumbers the draw order on the way out', () => {
    writeLayers('acct-1', [layer('a', { order: 7 }), layer('b', { order: 2 })], storage);
    expect(readLayers('acct-1', storage).map((l) => [l.id, l.order])).toEqual([['b', 0], ['a', 1]]);
  });

  it('clears one account without touching another', () => {
    writeLayers('alice', [layer('a')], storage);
    writeLayers('bob', [layer('b')], storage);
    clearLayers('alice', storage);
    expect(readLayers('alice', storage)).toEqual([]);
    expect(readLayers('bob', storage).map((l) => l.id)).toEqual(['b']);
  });
});

describe('a stored value this version did not write', () => {
  it('survives invalid JSON', () => {
    // A write cut short by a quota error, or someone in the devtools.
    const s = fakeStorage({ [keyFor('acct-1')]: '{"v":1,"layers":[{"id":"a",' });
    expect(readLayers('acct-1', s)).toEqual([]);
  });

  it('survives a value that is not an object at all', () => {
    for (const raw of ['null', '42', '"hello"', 'true']) {
      expect(readLayers('acct-1', fakeStorage({ [keyFor('acct-1')]: raw }))).toEqual([]);
    }
  });

  it('accepts a bare array as well as the current envelope', () => {
    const s = fakeStorage({
      [keyFor('acct-1')]: JSON.stringify([{ id: 'a', name: 'A', format: 'xyz', url: 'https://x/{z}/{x}/{y}.png' }]),
    });
    expect(readLayers('acct-1', s).map((l) => l.id)).toEqual(['a']);
  });

  it('drops only the entries it cannot save', () => {
    const s = fakeStorage({
      [keyFor('acct-1')]: JSON.stringify({
        v: 1,
        layers: [
          { id: 'good', name: 'Good', format: 'xyz', url: 'https://x/{z}/{x}/{y}.png' },
          null,
          'not a layer',
          { id: 'no-url', format: 'xyz' },
          { id: 'unknown-format', format: 'shapefile', url: 'https://x/y.shp' },
          { id: 'also-good', format: 'geojson', uri: 'https://x/y.geojson' },
        ],
      }),
    });
    // `uri` is the Story schema's spelling of `url`, so a story export someone
    // pasted into the key still reads.
    expect(readLayers('acct-1', s).map((l) => l.id)).toEqual(['good', 'also-good']);
  });

  it('repairs the fields it can', () => {
    const repaired = coerceLayer({
      format: 'xyz',
      url: '  https://x.example/roads/{z}/{x}/{y}.png ',
      opacity: '3',
      order: 'seven',
      attribution: { text: '  © Someone ', licence: 42 },
      availability: { start: '2020-01-01', end: '2021-01-01' },
    }, 4);
    expect(repaired?.url).toBe('https://x.example/roads/{z}/{x}/{y}.png');
    expect(repaired?.opacity).toBe(1); // clamped, not NaN
    expect(repaired?.order).toBe(4); // fell back to its position
    expect(repaired?.name).toBe('Roads'); // derived from the path
    expect(repaired?.id).toMatch(/^roads-/); // minted, and readable
    expect(repaired?.visible).toBe(true); // absent means visible
    expect(repaired?.attribution).toEqual({ text: '© Someone' }); // the bad licence dropped, the credit kept
    expect(repaired?.availability).toEqual({ start: '2020-01-01', stop: '2021-01-01' }); // `end` folded into `stop`
  });

  it('de-duplicates ids', () => {
    // Two rows with one id would collide as React keys and every edit would hit
    // both of them.
    const s = fakeStorage({
      [keyFor('acct-1')]: JSON.stringify([
        { id: 'a', format: 'xyz', url: 'https://one/{z}/{x}/{y}.png' },
        { id: 'a', format: 'xyz', url: 'https://two/{z}/{x}/{y}.png' },
      ]),
    });
    const read = readLayers('acct-1', s);
    expect(read).toHaveLength(1);
    expect(read[0]!.url).toBe('https://two/{z}/{x}/{y}.png');
  });
});

describe('storage that is not there', () => {
  it('reads empty and writes nothing when there is no storage', () => {
    expect(readLayers('acct-1', null)).toEqual([]);
    expect(() => writeLayers('acct-1', [layer('a')], null)).not.toThrow();
    expect(() => clearLayers('acct-1', null)).not.toThrow();
  });

  it('shrugs off a quota error rather than taking the panel down', () => {
    // Private mode, or a full origin. The session still works; only the
    // persistence is lost.
    const angry: LayerStorage = {
      getItem: () => { throw new DOMException('denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
      removeItem: vi.fn(),
    };
    expect(readLayers('acct-1', angry)).toEqual([]);
    expect(() => writeLayers('acct-1', [layer('a')], angry)).not.toThrow();
  });
});
