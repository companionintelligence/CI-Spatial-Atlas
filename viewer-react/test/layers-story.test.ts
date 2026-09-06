/**
 * The layer ↔ story bridge, in both directions.
 *
 * This suite exists because both halves of the bridge failed *silently* for as
 * long as nothing called them: a user added four layers, exported the story and
 * got a document with none of them (an absent `layers` array is a valid story,
 * so nothing complained), and a story that arrived carrying layers rendered
 * none. Neither direction produces an error to notice, so the only thing that
 * can catch a regression is a test that pushes a real stack through a real
 * `Story` and looks at what comes back.
 *
 * Everything below therefore round-trips through the *published* Zod schemas
 * rather than through plain objects. Zod strips unknown keys, and that is
 * exactly the mechanism that would eat a field this code writes in the wrong
 * place — parsing is the assertion.
 */
import { describe, expect, it } from 'vitest';
import { Layer as LayerSchema, Story as StorySchema, type Layer, type Story } from '@companion-atlas/story';
import {
  fromStoryLayer,
  fromStoryLayers,
  toStoryLayer,
  toStoryLayers,
  withStoryLayers,
} from '../src/layers/story.js';
import { normaliseOrder, type AtlasLayer } from '../src/layers/model.js';

const OSM_CREDIT = {
  text: '© OpenStreetMap contributors',
  licence: 'ODbL-1.0',
  url: 'https://www.openstreetmap.org/copyright',
  onScreen: true,
};

const stack: AtlasLayer[] = normaliseOrder([
  {
    id: 'osm-standard',
    name: 'OpenStreetMap',
    format: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    visible: true,
    opacity: 0.6,
    order: 0,
    attribution: OSM_CREDIT,
    options: { tilingScheme: 'web-mercator', maximumLevel: 19 },
    catalogId: 'osm-standard',
  },
  {
    id: 'fires-2019',
    name: 'Fire perimeters, Aug 2019',
    format: 'geojson',
    url: 'https://example.org/fires/2019.geojson',
    // Off, but still in the document: "in the story" and "currently drawn" are
    // different questions, and losing the answer to the second is what made a
    // re-opened story light up every layer the author had switched off.
    visible: false,
    opacity: 1,
    order: 1,
    attribution: { text: 'NIFC', licence: 'Public domain' },
    availability: { start: '2019-08-01T00:00:00Z', stop: '2019-09-01T00:00:00Z' },
    options: { clampToGround: true },
  },
]);

/** A minimal but *real* story — parsed, so it is the document a server or a
 *  downloaded file would hold, not a hopeful object literal. */
const storyWith = (layers: unknown[]): Story =>
  StorySchema.parse({
    schema: 'companion.atlas/story@1',
    id: 'story-under-test',
    title: 'Layer bridge',
    scenes: [{ id: 's1', title: 'Opening' }],
    layers,
  });

/** What a save actually does to a document: JSON out, JSON in, re-validated. */
const throughTheWire = (s: Story): Story => StorySchema.parse(JSON.parse(JSON.stringify(s)));

describe('outbound: stack → story', () => {
  it('writes the schema\'s own fields, not a private style bag', () => {
    // The five fields below used to be smuggled through `style.atlas` because
    // the schema had nowhere to put them. It does now, and writing them where
    // the schema defines them is what lets any other tool — a validator, a
    // server, a different renderer — see them at all.
    const [osm] = toStoryLayers(stack);
    expect(osm).toMatchObject({
      id: 'osm-standard',
      kind: 'imagery',
      name: 'OpenStreetMap',
      format: 'xyz',
      uri: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      visible: true,
      order: 0,
      opacity: 0.6,
      attribution: OSM_CREDIT,
    });
    // Only what the schema still has no field for is left in the bag.
    expect(osm!.style?.atlas).toEqual({
      options: { tilingScheme: 'web-mercator', maximumLevel: 19 },
      catalogId: 'osm-standard',
    });
  });

  it('carries the attribution through a save, because a credit is a licence condition', () => {
    // The failure this guards is not cosmetic: nearly every source in the
    // catalog is attribution-conditioned (ODbL, CC BY, CC BY-SA), so a story
    // that carries a layer and drops its credit is a story that cannot lawfully
    // be published. Inside `style` the credit was one lossy round-trip from
    // vanishing with nothing logged; this asserts it survives the wire.
    const saved = throughTheWire(storyWith(toStoryLayers(stack)));
    expect(saved.layers?.[0]?.attribution).toEqual(OSM_CREDIT);
    expect(saved.layers?.[1]?.attribution).toEqual({ text: 'NIFC', licence: 'Public domain' });
  });

  it('folds the stack into a story without evicting what the panel does not own', () => {
    // `fromStoryLayers` deliberately drops `model`/`pin` layers (they are placed
    // entities `czml.ts` renders from `items`, not stack rows). If saving
    // assigned `story.layers` wholesale from the panel, those would be deleted
    // on every save — the same silent data loss as the missing-layers bug, only
    // pointed the other way.
    const original = storyWith([
      { id: 'statue', kind: 'model', uri: 'https://example.org/statue.glb' },
      { id: 'osm-standard', kind: 'imagery', uri: 'https://old.example/{z}/{x}/{y}.png', name: 'Stale copy' },
    ]);
    const saved = withStoryLayers(original, stack)!;

    expect(saved.layers?.map((l) => l.id)).toEqual(['statue', 'osm-standard', 'fires-2019']);
    // The layer the panel owns is replaced in place — position preserved, so a
    // saved story's diff stays readable — and the new one appends.
    expect(saved.layers?.[1]?.uri).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(saved.layers?.[0]).toEqual(original.layers?.[0]);
    // And the merged document is still a valid story, not just a valid object.
    expect(() => StorySchema.parse(saved)).not.toThrow();
  });

  it('returns the same story object when there is nothing to fold in', () => {
    // Identity, not equality: the Cesium viewer rebuilds its CZML data source
    // whenever the story reference changes, so a fresh object per render would
    // be visible as a flicker on a globe nobody touched.
    const s = storyWith([]);
    expect(withStoryLayers(s, [])).toBe(s);
    expect(withStoryLayers(null, stack)).toBeNull();
  });
});

describe('inbound: story → stack', () => {
  it('round-trips name, order, visibility, opacity and attribution', () => {
    const read = fromStoryLayers(throughTheWire(storyWith(toStoryLayers(stack))).layers);
    expect(read).toEqual(stack);

    // Spelled out as well as compared, so a failure says which field died.
    expect(read.map((l) => l.name)).toEqual(['OpenStreetMap', 'Fire perimeters, Aug 2019']);
    expect(read.map((l) => l.order)).toEqual([0, 1]);
    expect(read.map((l) => l.visible)).toEqual([true, false]);
    expect(read.map((l) => l.opacity)).toEqual([0.6, 1]);
    expect(read.map((l) => l.attribution?.text)).toEqual(['© OpenStreetMap contributors', 'NIFC']);
    expect(read[0]?.attribution?.licence).toBe('ODbL-1.0');
    expect(read[1]?.availability).toEqual({ start: '2019-08-01T00:00:00Z', stop: '2019-09-01T00:00:00Z' });
  });

  it('still loads a document written the old way, through `style.atlas`', () => {
    // Stories written before the schema grew these fields are already out there
    // — saved in Companion Memory, downloaded as files — and they carry the
    // whole of it in the bag. Dropping the legacy read would silently rename
    // every layer to a slug off its URL, un-hide the hidden ones, flatten the
    // stack order, and lose the credit lines.
    const legacy = throughTheWire(storyWith([
      {
        id: 'gibs-modis',
        kind: 'imagery',
        uri: 'https://gibs.example/wmts/{TileMatrix}/{TileRow}/{TileCol}.jpg',
        opacity: 0.42,
        style: {
          atlas: {
            name: 'MODIS Terra true colour',
            format: 'wmts',
            visible: false,
            order: 7,
            attribution: { text: 'NASA GIBS', licence: 'NASA open data', onScreen: true },
            options: { wmtsLayer: 'L', tileMatrixSet: 'GMC' },
            catalogId: 'gibs-modis-truecolor',
          },
        },
      },
    ]));

    const [read] = fromStoryLayers(legacy.layers);
    expect(read).toMatchObject({
      id: 'gibs-modis',
      name: 'MODIS Terra true colour',
      format: 'wmts',
      visible: false,
      opacity: 0.42,
      attribution: { text: 'NASA GIBS', licence: 'NASA open data', onScreen: true },
      catalogId: 'gibs-modis-truecolor',
    });
    // `order` re-densifies to 0 for a one-layer stack; the legacy 7 is what fed
    // the sort, which is all it was ever for.
    expect(read?.order).toBe(0);
  });

  it('lets the schema field win when a migrated document carries both', () => {
    // A story saved by this version and then edited by an older one — or the
    // other way round — can hold both copies. The top-level field is the one a
    // validator and a foreign tool can see, so it is the one that is true.
    const both = LayerSchema.parse({
      id: 'mixed',
      kind: 'imagery',
      uri: 'https://example.org/{z}/{x}/{y}.png',
      name: 'Current name',
      visible: false,
      order: 3,
      attribution: { text: 'Current credit' },
      style: { atlas: { name: 'Stale name', visible: true, order: 9, attribution: { text: 'Stale credit' } } },
    });
    expect(fromStoryLayer(both)).toMatchObject({
      name: 'Current name',
      visible: false,
      order: 3,
      attribution: { text: 'Current credit' },
    });
  });

  it('trusts an explicit `format` over what the URL looks like', () => {
    // The whole reason the schema gained `format`: `kind: 'imagery'` spans four
    // incompatible tile protocols and an endpoint that speaks WMS does not
    // announce it in a path a sniffer can read. Guessing wrong is the documented
    // blank-globe failure — well-formed requests for tiles that do not exist.
    const wms = LayerSchema.parse({
      id: 'wms',
      kind: 'imagery',
      format: 'wms',
      uri: 'https://example.org/geoserver/ows?service=WMS&request=GetMap&layers=topo',
    });
    expect(fromStoryLayer(wms)?.format).toBe('wms');

    // …but a format the schema knows and Atlas cannot draw must fall through to
    // the sniffer rather than index the format table with a string that is not
    // in it. (Today the two enums match; they are two declarations in two
    // packages and will not always.)
    const unknownFormat = {
      id: 'gpkg',
      kind: 'imagery',
      format: 'geopackage',
      uri: 'https://example.org/{z}/{x}/{y}.png',
    } as unknown as Layer;
    expect(fromStoryLayer(unknownFormat)?.format).toBe('xyz'); // sniffed, not indexed
  });

  it('drops a credit that has no line to display', () => {
    // An attribution with no `text` is not a credit, and carrying it would put
    // an empty badge in the panel that reads as a rendering bug.
    const empty = LayerSchema.parse({
      id: 'nocredit',
      kind: 'imagery',
      uri: 'https://example.org/{z}/{x}/{y}.png',
      style: { atlas: { attribution: { licence: 'CC BY 4.0' } } },
    });
    expect(fromStoryLayer(empty)?.attribution).toBeUndefined();
  });

  it('keeps a foreign tool\'s layer intact when it is the only thing that says anything', () => {
    const foreign = toStoryLayer({
      id: 'hike',
      name: 'Alpine traverse',
      format: 'kml',
      url: 'https://example.org/trails/alps.kml',
      visible: true,
      opacity: 1,
      order: 0,
      attribution: { text: 'Trail data © the club' },
    });
    // KML has no schema kind of its own and serialises as `geojson`; without
    // the top-level `format` the reader would have to guess from the extension.
    expect(foreign.kind).toBe('geojson');
    expect(foreign.format).toBe('kml');
    expect(fromStoryLayer(LayerSchema.parse(foreign))?.format).toBe('kml');
  });
});
