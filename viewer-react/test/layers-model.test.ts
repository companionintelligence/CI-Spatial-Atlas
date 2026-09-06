/**
 * The layer model: stacking order, the time-availability filter, search, and
 * the round trip through the canonical Story schema.
 *
 * All of it is pure data, which is the point — the ordering rules and the
 * availability window are the parts a rendering bug would hide, so they are
 * kept out of the React component and tested without a DOM (the pattern the
 * `xr-*` suites follow).
 */
import { describe, expect, it } from 'vitest';
import { Layer as LayerSchema } from '@companion-atlas/story';
import {
  appendLayer,
  clampOpacity,
  describeAvailability,
  isAvailableAt,
  layerKind,
  layersOutsideWindow,
  lowerLayer,
  makeLayerId,
  matchesQuery,
  moveLayerToIndex,
  normaliseOrder,
  raiseLayer,
  removeLayer,
  searchLayers,
  setLayerOpacity,
  sortLayers,
  stackTopFirst,
  toggleLayer,
  visibleLayersAt,
  type AtlasLayer,
} from '../src/layers/model.js';
import { fromStoryLayer, fromStoryLayers, toStoryLayer, toStoryLayers } from '../src/layers/story.js';

const layer = (id: string, over: Partial<AtlasLayer> = {}): AtlasLayer => ({
  id,
  name: id,
  format: 'xyz',
  url: `https://tiles.example/${id}/{z}/{x}/{y}.png`,
  visible: true,
  opacity: 1,
  order: 0,
  ...over,
});

const ids = (ls: readonly AtlasLayer[]) => ls.map((l) => l.id);

describe('stacking order', () => {
  it('sorts bottom-first and lists top-first', () => {
    const stack = [layer('c', { order: 2 }), layer('a', { order: 0 }), layer('b', { order: 1 })];
    expect(ids(sortLayers(stack))).toEqual(['a', 'b', 'c']);
    expect(ids(stackTopFirst(stack))).toEqual(['c', 'b', 'a']);
  });

  it('breaks ties deterministically rather than by array position', () => {
    // Two layers claiming the same order is a real state: a hand-edited store,
    // or two catalog adds in one render. If the tie broke on position the
    // imagery stack would swap on every re-render and visibly flicker.
    const a = [layer('x', { order: 3 }), layer('y', { order: 3 })];
    const b = [layer('y', { order: 3 }), layer('x', { order: 3 })];
    expect(ids(sortLayers(a))).toEqual(ids(sortLayers(b)));
  });

  it('densifies sparse and duplicate orders', () => {
    const stack = normaliseOrder([layer('a', { order: 9 }), layer('b', { order: 9 }), layer('c', { order: -4 })]);
    expect(stack.map((l) => l.order)).toEqual([0, 1, 2]);
    expect(ids(stack)).toEqual(['c', 'a', 'b']);
  });

  it('appends on top', () => {
    let stack = appendLayer([], layer('a'));
    stack = appendLayer(stack, layer('b'));
    expect(ids(stackTopFirst(stack))).toEqual(['b', 'a']);
    expect(stack.find((l) => l.id === 'b')?.order).toBe(1);
  });

  it('raises an existing layer instead of adding the same source twice', () => {
    // Two identical tile sources do not draw twice as brightly, they fight over
    // the same pixels — `czml.ts` deduplicates tilesets by URL for this reason.
    const first = layer('a', { url: 'https://tiles.example/same/{z}/{x}/{y}.png', visible: false });
    const second = layer('b', { url: 'https://tiles.example/same/{z}/{x}/{y}.png' });
    let stack = appendLayer([], first);
    stack = appendLayer(stack, layer('other', { url: 'https://tiles.example/other/{z}/{x}/{y}.png' }));
    stack = appendLayer(stack, second);
    expect(ids(stack)).toEqual(['other', 'a']);
    expect(stack.find((l) => l.id === 'a')?.visible).toBe(true);
  });

  it('moves one step up and down, and stops at the ends', () => {
    const stack = normaliseOrder([layer('a'), layer('b'), layer('c')].map((l, i) => ({ ...l, order: i })));
    expect(ids(sortLayers(raiseLayer(stack, 'a')))).toEqual(['b', 'a', 'c']);
    expect(ids(sortLayers(lowerLayer(stack, 'c')))).toEqual(['a', 'c', 'b']);
    // Already at the top / bottom: a no-op, not a wrap-around.
    expect(ids(sortLayers(raiseLayer(stack, 'c')))).toEqual(['a', 'b', 'c']);
    expect(ids(sortLayers(lowerLayer(stack, 'a')))).toEqual(['a', 'b', 'c']);
    expect(ids(sortLayers(raiseLayer(stack, 'missing')))).toEqual(['a', 'b', 'c']);
  });

  it('drops a layer at a position in the panel list (drag reorder)', () => {
    const stack = [layer('a', { order: 0 }), layer('b', { order: 1 }), layer('c', { order: 2 })];
    // Panel order is c, b, a. Moving 'a' to index 0 puts it on top.
    expect(ids(stackTopFirst(moveLayerToIndex(stack, 'a', 0)))).toEqual(['a', 'c', 'b']);
    expect(ids(stackTopFirst(moveLayerToIndex(stack, 'c', 99)))).toEqual(['b', 'a', 'c']);
  });

  it('closes the gap left by a removal', () => {
    const stack = removeLayer([layer('a', { order: 0 }), layer('b', { order: 1 }), layer('c', { order: 2 })], 'b');
    expect(stack.map((l) => [l.id, l.order])).toEqual([['a', 0], ['c', 1]]);
  });

  it('toggles and clamps opacity without touching neighbours', () => {
    const stack = [layer('a'), layer('b')];
    expect(toggleLayer(stack, 'a').map((l) => l.visible)).toEqual([false, true]);
    expect(setLayerOpacity(stack, 'b', 2.5)[1]!.opacity).toBe(1);
    expect(setLayerOpacity(stack, 'b', -1)[1]!.opacity).toBe(0);
    expect(clampOpacity('0.4' as unknown)).toBeCloseTo(0.4);
    expect(clampOpacity(undefined)).toBe(1); // unparseable falls back to opaque
  });

  it('makes readable, unique ids', () => {
    const a = makeLayerId('Sentinel-2 cloudless 2023');
    expect(a.startsWith('sentinel-2-cloudless-2023-')).toBe(true);
    expect(a).not.toBe(makeLayerId('Sentinel-2 cloudless 2023'));
    expect(makeLayerId('***')).toMatch(/^layer-/);
  });
});

describe('time availability', () => {
  const T2023 = Date.UTC(2023, 5, 1);
  const T1998 = Date.UTC(1998, 5, 1);
  const mosaic = layer('s2', {
    availability: { start: '2023-01-01T00:00:00Z', stop: '2023-12-31T23:59:59Z' },
  });

  it('includes a layer inside its window and excludes it outside', () => {
    expect(isAvailableAt(mosaic, T2023)).toBe(true);
    expect(isAvailableAt(mosaic, T1998)).toBe(false);
    expect(isAvailableAt(mosaic, Date.UTC(2024, 0, 2))).toBe(false);
  });

  it('treats an open-ended window as still true', () => {
    const since2000 = layer('gibs', { availability: { start: '2000-02-24T00:00:00Z' } });
    expect(isAvailableAt(since2000, Date.UTC(2025, 0, 1))).toBe(true);
    expect(isAvailableAt(since2000, Date.UTC(1999, 0, 1))).toBe(false);
  });

  it('is always true with no window, or with no clock', () => {
    expect(isAvailableAt(layer('plain'), T1998)).toBe(true);
    expect(isAvailableAt(mosaic, null)).toBe(true);
    expect(isAvailableAt(mosaic, Number.NaN)).toBe(true);
  });

  it('treats an unparseable bound as unbounded, never as "never"', () => {
    // A layer that silently stops drawing because someone typed 2019-13-01 is
    // the worst failure here: there is nothing on screen to ask about.
    const broken = layer('broken', { availability: { start: '2019-13-01', stop: 'yesterday' } });
    expect(isAvailableAt(broken, T2023)).toBe(true);
  });

  it('reports which switched-on layers the clock excludes', () => {
    const stack = [mosaic, layer('osm'), { ...mosaic, id: 's2-hidden', visible: false }];
    expect(ids(layersOutsideWindow(stack.filter((l) => l.visible), T1998))).toEqual(['s2']);
    expect(layersOutsideWindow(stack, T2023)).toEqual([]);
  });

  it('draws only what is visible and in-window, in stacking order', () => {
    const stack = [
      layer('bottom', { order: 0 }),
      { ...mosaic, order: 1 },
      layer('off', { order: 2, visible: false }),
    ];
    expect(ids(visibleLayersAt(stack, T2023))).toEqual(['bottom', 's2']);
    expect(ids(visibleLayersAt(stack, T1998))).toEqual(['bottom']);
  });

  it('describes a window for the panel badge', () => {
    expect(describeAvailability(mosaic.availability)).toBe('2023-01-01 → 2023-12-31');
    expect(describeAvailability({ start: '2000-02-24T00:00:00Z' })).toBe('from 2000-02-24');
    expect(describeAvailability(undefined)).toBeNull();
  });
});

describe('search', () => {
  const stack = [
    layer('osm', { name: 'OpenStreetMap', attribution: { text: '© OpenStreetMap contributors' } }),
    layer('quakes', { name: 'Earthquakes, past 24 hours', format: 'geojson', url: 'https://earthquake.usgs.gov/feed.geojson' }),
    layer('sp', { name: 'São Paulo drone scan', format: '3d-tiles', url: 'https://scans.example/sp/tileset.json' }),
  ];

  it('matches name, kind label, host and attribution', () => {
    expect(ids(searchLayers(stack, 'openstreet'))).toEqual(['osm']);
    expect(ids(searchLayers(stack, 'geojson'))).toEqual(['quakes']);
    expect(ids(searchLayers(stack, 'usgs.gov'))).toEqual(['quakes']);
    expect(ids(searchLayers(stack, '3d tiles'))).toEqual(['sp']);
  });

  it('narrows on every term and ignores diacritics', () => {
    expect(ids(searchLayers(stack, 'sao paulo'))).toEqual(['sp']);
    expect(ids(searchLayers(stack, 'past hours'))).toEqual(['quakes']);
    expect(ids(searchLayers(stack, 'past nonsense'))).toEqual([]);
    expect(ids(searchLayers(stack, '   '))).toEqual(ids(stackTopFirst(stack)));
  });

  it('keeps panel order in the results', () => {
    const ordered = [layer('a', { order: 0, name: 'tile a' }), layer('b', { order: 1, name: 'tile b' })];
    expect(ids(searchLayers(ordered, 'tile'))).toEqual(['b', 'a']);
    expect(matchesQuery(ordered[0]!, 'TILE')).toBe(true);
  });
});

describe('story round trip', () => {
  const rich: AtlasLayer = {
    id: 'gibs-modis',
    name: 'MODIS Terra true colour',
    format: 'wmts',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/L/default/{Time}/GMC/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    visible: false,
    opacity: 0.42,
    order: 3,
    attribution: { text: 'NASA GIBS', licence: 'NASA open data', onScreen: true },
    availability: { start: '2000-02-24T00:00:00Z' },
    options: { wmtsLayer: 'L', tileMatrixSet: 'GMC', followsClock: true, tilingScheme: 'web-mercator' },
    catalogId: 'gibs-modis-truecolor',
  };

  it('survives the canonical Zod schema unchanged', () => {
    // The load-bearing claim: Zod strips unknown *top-level* keys, so anything
    // the schema does not define has to travel inside `style`. If this ever
    // fails, a saved story is quietly losing the user's layer settings.
    const parsed = LayerSchema.parse(toStoryLayer(rich));
    const back = fromStoryLayer(parsed);
    expect(back).toEqual(rich);
  });

  it('serialises to the schema kind, not to the wire format', () => {
    expect(toStoryLayer(rich).kind).toBe('imagery');
    expect(layerKind('kml')).toBe('geojson');
    expect(toStoryLayer({ ...rich, format: 'quantized-mesh' }).kind).toBe('terrain');
  });

  it('reads a layer authored by another tool', () => {
    const foreign = LayerSchema.parse({ id: 'hike', kind: 'geojson', uri: 'https://example.org/trails/alps.kml' });
    const read = fromStoryLayer(foreign, 4);
    // The URL beats the kind: `geojson` is also what a KML layer serialises as.
    expect(read?.format).toBe('kml');
    expect(read?.name).toBe('Alps');
    expect(read?.visible).toBe(true); // authored into the story on purpose
    expect(read?.opacity).toBe(1);
    expect(read?.order).toBe(4);
  });

  it('accepts the older `end` spelling of the availability stop', () => {
    const old = LayerSchema.parse({
      id: 'fires',
      kind: 'imagery',
      uri: 'https://example.org/{z}/{x}/{y}.png',
      availability: { start: '2019-08-01T00:00:00Z', end: '2019-09-01T00:00:00Z' },
    });
    expect(fromStoryLayer(old)?.availability).toEqual({
      start: '2019-08-01T00:00:00Z',
      stop: '2019-09-01T00:00:00Z',
    });
  });

  it('ignores the kinds the layer manager does not own', () => {
    // `model` and `pin` are single placed entities that `czml.ts` renders from
    // `items`; a row that could be reordered or dimmed would be a lie.
    expect(fromStoryLayer(LayerSchema.parse({ id: 'm', kind: 'model', uri: 'https://x/y.glb' }))).toBeNull();
    expect(fromStoryLayer(LayerSchema.parse({ id: 'p', kind: 'pin' }))).toBeNull();
    // Nothing to fetch is nothing to draw.
    expect(fromStoryLayer(LayerSchema.parse({ id: 'i', kind: 'imagery' }))).toBeNull();
  });

  it('reads a whole story array, dropping what it cannot own', () => {
    const story = [
      { id: 'a', kind: 'imagery', uri: 'https://a.example/{z}/{x}/{y}.png' },
      { id: 'p', kind: 'pin' },
      { id: 'b', kind: '3d-tiles', uri: 'https://b.example/tileset.json' },
      // A duplicate id would collide as a React key and every edit would hit
      // both rows; the later one wins, as if the story had been appended to.
      { id: 'a', kind: 'imagery', uri: 'https://a2.example/{z}/{x}/{y}.png' },
    ].map((l) => LayerSchema.parse(l));
    const read = fromStoryLayers(story);
    expect(ids(read)).toEqual(['b', 'a']);
    expect(read.map((l) => l.order)).toEqual([0, 1]);
    expect(read.find((l) => l.id === 'a')?.url).toBe('https://a2.example/{z}/{x}/{y}.png');
    expect(fromStoryLayers(undefined)).toEqual([]);
  });

  it('fills in the provider defaults a story never carried', () => {
    // A story authored elsewhere says nothing about tiling schemes, and taking
    // Cesium's default (geographic) for a {z}/{x}/{y} source is the documented
    // blank-globe bug. Reading a layer back therefore *adds* the default rather
    // than leaving the field absent.
    const bare = LayerSchema.parse({ id: 'osm', kind: 'imagery', uri: 'https://a.example/{z}/{x}/{y}.png' });
    expect(fromStoryLayer(bare)?.options).toEqual({ tilingScheme: 'web-mercator' });
  });

  it('round-trips a whole stack', () => {
    const stack = normaliseOrder([
      rich,
      layer('osm', { order: 1, options: { tilingScheme: 'web-mercator' } }),
    ]);
    expect(fromStoryLayers(toStoryLayers(stack).map((l) => LayerSchema.parse(l)))).toEqual(stack);
  });
});
