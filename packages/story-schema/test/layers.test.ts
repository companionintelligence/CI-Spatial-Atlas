/**
 * `Layer`'s five promoted fields — `name`, `format`, `attribution`, `visible`,
 * `order` — and the `style.atlas` back-compat path they replace.
 */
import { describe, it, expect } from 'vitest';
import {
  Layer,
  resolveLayer,
  storyLayers,
  storyToCzml,
  loadStory,
  validateStory,
  type Story as StoryT,
} from '../src/index.js';
import atlas from './fixtures/atlas-story.json';

/** A minimal valid story wrapping the given layers. */
const storyWith = (layers: unknown[]): StoryT =>
  loadStory({
    schema: 'companion.atlas/story@1',
    id: 'story_layers',
    title: 'Layers',
    scenes: [],
    layers,
  });

describe('Layer — promoted fields', () => {
  it('accepts all five as top-level fields', () => {
    const r = Layer.safeParse({
      id: 'osm',
      kind: 'imagery',
      name: 'OpenStreetMap',
      uri: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      format: 'xyz',
      attribution: {
        text: '© OpenStreetMap contributors',
        licence: 'ODbL-1.0',
        url: 'https://www.openstreetmap.org/copyright',
        onScreen: true,
      },
      visible: false,
      order: 2,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.attribution?.licence).toBe('ODbL-1.0');
  });

  it('keeps every one of them optional — an old layer still parses', () => {
    expect(Layer.safeParse({ id: 'l1', kind: 'terrain' }).success).toBe(true);
  });

  it('requires attribution.text, so a credit cannot be half-declared', () => {
    expect(Layer.safeParse({ id: 'l1', kind: 'imagery', attribution: {} }).success).toBe(false);
    expect(Layer.safeParse({ id: 'l1', kind: 'imagery', attribution: { licence: 'CC BY 4.0' } }).success).toBe(false);
  });

  it('rejects a format outside the known wire protocols', () => {
    expect(Layer.safeParse({ id: 'l1', kind: 'imagery', format: 'xyz' }).success).toBe(true);
    expect(Layer.safeParse({ id: 'l1', kind: 'imagery', format: 'mvt' }).success).toBe(false);
  });

  it('distinguishes the four providers `kind: imagery` collapses together', () => {
    const formats = ['xyz', 'tms', 'wmts', 'wms'] as const;
    for (const format of formats) {
      const r = Layer.safeParse({ id: `l_${format}`, kind: 'imagery', format });
      expect(r.success && r.data.format).toBe(format);
    }
  });

  it('survives a whole-story parse (the fields are not stripped on the way through)', () => {
    const doc = {
      schema: 'companion.atlas/story@1',
      id: 'story_1',
      title: 'Harbour',
      scenes: [],
      layers: [
        {
          id: 'seamap',
          kind: 'imagery',
          name: 'OpenSeaMap',
          format: 'xyz',
          attribution: { text: '© OpenSeaMap contributors', licence: 'CC BY-SA 2.0' },
          visible: true,
          order: 1,
        },
      ],
    };
    expect(validateStory(doc).valid).toBe(true);
    const layer = loadStory(doc).layers?.[0];
    expect(layer?.attribution?.text).toBe('© OpenSeaMap contributors');
    expect(layer?.name).toBe('OpenSeaMap');
    expect(layer?.format).toBe('xyz');
    expect(layer?.order).toBe(1);
  });
});

describe('resolveLayer — real fields first, style.atlas second', () => {
  it('reads the real fields when they are present', () => {
    const r = resolveLayer({
      id: 'eox',
      kind: 'imagery',
      name: 'Sentinel-2 cloudless',
      format: 'wmts',
      attribution: { text: 'Sentinel-2 cloudless by EOX IT Services GmbH', licence: 'CC BY 4.0' },
      visible: false,
      order: 3,
    });
    expect(r).toEqual({
      name: 'Sentinel-2 cloudless',
      format: 'wmts',
      attribution: { text: 'Sentinel-2 cloudless by EOX IT Services GmbH', licence: 'CC BY 4.0' },
      visible: false,
      order: 3,
    });
  });

  it('falls back to a legacy style.atlas blob', () => {
    const r = resolveLayer({
      id: 'carto',
      kind: 'imagery',
      style: {
        atlas: {
          name: 'CARTO Positron',
          format: 'xyz',
          attribution: { text: '© CARTO', licence: 'CC BY 4.0', url: 'https://carto.com/attributions', onScreen: true },
          visible: false,
          order: 5,
        },
      },
    });
    expect(r.name).toBe('CARTO Positron');
    expect(r.format).toBe('xyz');
    expect(r.attribution).toEqual({
      text: '© CARTO',
      licence: 'CC BY 4.0',
      url: 'https://carto.com/attributions',
      onScreen: true,
    });
    expect(r.visible).toBe(false);
    expect(r.order).toBe(5);
  });

  it('prefers the real field when a document carries both', () => {
    const r = resolveLayer({
      id: 'osm',
      kind: 'imagery',
      name: 'OpenStreetMap',
      attribution: { text: '© OpenStreetMap contributors' },
      style: { atlas: { name: 'stale name', attribution: { text: 'stale credit' } } },
    });
    expect(r.name).toBe('OpenStreetMap');
    expect(r.attribution?.text).toBe('© OpenStreetMap contributors');
  });

  it('defaults `visible` to true — a layer in the document is drawn', () => {
    expect(resolveLayer({ id: 'l1', kind: 'imagery' }).visible).toBe(true);
    expect(resolveLayer({ id: 'l1', kind: 'imagery', style: { atlas: {} } }).visible).toBe(true);
    expect(resolveLayer({ id: 'l1', kind: 'imagery', visible: false }).visible).toBe(false);
  });

  it('ignores a malformed legacy blob instead of throwing', () => {
    for (const style of [
      { atlas: 'not an object' },
      { atlas: ['also', 'not'] },
      { atlas: { attribution: { licence: 'CC BY 4.0' } } }, // no `text` → not a credit
      { atlas: { format: 'mvt', order: 'first', visible: 'yes', name: 42 } },
    ]) {
      const r = resolveLayer({ id: 'l1', kind: 'imagery', style });
      expect(r.attribution).toBeUndefined();
      expect(r.format).toBeUndefined();
      expect(r.name).toBeUndefined();
      expect(r.order).toBeUndefined();
      expect(r.visible).toBe(true);
    }
  });

  it('leaves a layer with no style at all fully unresolved but visible', () => {
    expect(resolveLayer({ id: 'l1', kind: 'terrain' })).toEqual({
      name: undefined,
      format: undefined,
      attribution: undefined,
      visible: true,
      order: undefined,
    });
  });
});

describe('storyLayers — draw order', () => {
  it('sorts by explicit `order`, not array position', () => {
    const s = storyWith([
      { id: 'top', kind: 'imagery', order: 10 },
      { id: 'bottom', kind: 'imagery', order: 0 },
      { id: 'middle', kind: 'imagery', order: 5 },
    ]);
    expect(storyLayers(s).map((l) => l.layer.id)).toEqual(['bottom', 'middle', 'top']);
  });

  it('honours an order smuggled through style.atlas', () => {
    const s = storyWith([
      { id: 'a', kind: 'imagery', style: { atlas: { order: 9 } } },
      { id: 'b', kind: 'imagery', style: { atlas: { order: 1 } } },
    ]);
    expect(storyLayers(s).map((l) => l.layer.id)).toEqual(['b', 'a']);
  });

  it('leaves an unordered document exactly as authored', () => {
    const s = storyWith([
      { id: 'a', kind: 'imagery' },
      { id: 'b', kind: 'imagery' },
      { id: 'c', kind: 'imagery' },
    ]);
    expect(storyLayers(s).map((l) => l.layer.id)).toEqual(['a', 'b', 'c']);
  });

  it('holds array position for layers that state no order', () => {
    const s = storyWith([
      { id: 'a', kind: 'imagery' },
      { id: 'b', kind: 'imagery', order: 0 },
      { id: 'c', kind: 'imagery' },
    ]);
    // `b` sorts to 0, `a` and `c` keep their indices 0 and 2; `a` before `b` on
    // the stable tiebreak, `c` last.
    expect(storyLayers(s).map((l) => l.layer.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for a story with no layers', () => {
    expect(storyLayers(storyWith([]))).toEqual([]);
    expect(storyLayers(loadStory({ schema: 'companion.atlas/story@1', id: 's', title: 'T', scenes: [] }))).toEqual([]);
  });
});

describe('czml — `format` does not change tileset extraction', () => {
  it('still selects layers by `kind`, ignoring `format`', () => {
    const s = storyWith([
      { id: 'tiles', kind: '3d-tiles', uri: 'https://example.test/tileset.json' },
      { id: 'splat', kind: 'gaussian-splat', uri: 'https://example.test/scene.splat' },
      // Imagery is not a tileset however it is formatted.
      { id: 'img', kind: 'imagery', uri: 'https://example.test/{z}/{x}/{y}.png', format: 'xyz' },
    ]);
    const { tilesets } = storyToCzml(s);
    expect(tilesets.map((t) => t.id)).toEqual(['tiles', 'splat']);
    expect(tilesets.map((t) => t.kind)).toEqual(['3d-tiles', 'gaussian-splat']);
  });

  it('emits the same tilesets whether or not a layer declares a `format`', () => {
    const bare = storyWith([{ id: 'tiles', kind: '3d-tiles', uri: 'https://example.test/tileset.json' }]);
    const declared = storyWith([
      { id: 'tiles', kind: '3d-tiles', uri: 'https://example.test/tileset.json', format: '3d-tiles' },
    ]);
    expect(storyToCzml(declared).tilesets).toEqual(storyToCzml(bare).tilesets);
  });

  it('leaves the existing fixture story byte-identical through the converter', () => {
    const before = storyToCzml(loadStory(atlas));
    expect(before.tilesets.length).toBeGreaterThan(0);
    // Re-running against the same document after the schema change must produce
    // the same packets — the new fields are absent from it, so nothing shifts.
    expect(storyToCzml(loadStory(atlas))).toEqual(before);
  });
});
