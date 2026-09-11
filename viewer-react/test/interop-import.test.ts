/**
 * The interop decision table, tested without a DOM.
 *
 * The point of these is the *sniffing* — extensions lie, and every one of these
 * cases is something a real user drops on the globe. The importers themselves
 * are covered in `packages/story-schema/test/{kml,geojson}.test.ts`; here we
 * only prove we route to the right one and never throw at the UI.
 */
import { describe, expect, it } from 'vitest';
import { detectFormat } from '../src/interop/detectFormat.js';
import { importText, safeIdPrefix } from '../src/interop/importFile.js';
import { withImported, summarise } from '../src/interop/useImported.js';
import { fileStem } from '../src/interop/exportFile.js';
import type { Item, Story } from '@companion-atlas/story';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Trip</name>
  <Placemark><name>Harbour</name><Point><coordinates>-21.94,64.15,0</coordinates></Point></Placemark>
  <Placemark><name>Ridge</name><LineString><coordinates>-21.9,64.1 -21.8,64.2</coordinates></LineString></Placemark>
</Document></kml>`;

const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { title: 'Camp' }, geometry: { type: 'Point', coordinates: [-21.94, 64.15] } },
    {
      type: 'Feature',
      properties: { name: 'Zone', fill: '#ff0000' },
      geometry: { type: 'Polygon', coordinates: [[[-22, 64], [-21, 64], [-21, 65], [-22, 64]]] },
    },
  ],
});

describe('detectFormat', () => {
  it('reads KML from its root element, not its extension', () => {
    expect(detectFormat('trip.txt', KML)).toBe('kml');
    expect(detectFormat('trip.kml', KML)).toBe('kml');
  });

  it('reads GeoJSON from its type member even when saved as .json', () => {
    expect(detectFormat('places.json', GEOJSON)).toBe('geojson');
    expect(detectFormat('places.geojson', GEOJSON)).toBe('geojson');
  });

  it('separates an Atlas story from a FeatureCollection', () => {
    const story = '{"schema":"companion.atlas/story@1","id":"s1","title":"T","scenes":[]}';
    expect(detectFormat('thing.json', story)).toBe('story');
  });

  it('catches a KMZ by its zip magic even when named .kml', () => {
    const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(detectFormat('tour.kml', 'PKgarbage', zipHead)).toBe('kmz');
  });

  it('does not claim arbitrary XML is KML', () => {
    expect(detectFormat('data.xml', '<?xml version="1.0"?><rss><channel/></rss>')).toBe('unknown');
  });
});

describe('importText', () => {
  it('imports KML placemarks as canonical items', () => {
    const r = importText('trip.kml', KML);
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('kml');
    expect(r.items.map((i) => i.type).sort()).toEqual(['line', 'marker']);
  });

  it('imports GeoJSON including polygons', () => {
    const r = importText('places.geojson', GEOJSON);
    expect(r.error).toBeUndefined();
    expect(r.items.map((i) => i.type).sort()).toEqual(['marker', 'polygon']);
  });

  it('reports KMZ as an error naming the fix, not as a crash', () => {
    const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const r = importText('tour.kmz', 'PK', zipHead);
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/KMZ/i);
    expect(r.error).toMatch(/doc\.kml/i);
  });

  it('returns malformed JSON as a value, never a throw', () => {
    const r = importText('broken.geojson', '{"type":"FeatureCollection", oops}');
    expect(r.items).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it('gives each file its own id prefix so two imports cannot collide', () => {
    const a = importText('day-one.kml', KML);
    const b = importText('day-two.kml', KML);
    const overlap = a.items.filter((x) => b.items.some((y) => y.id === x.id));
    expect(overlap).toEqual([]);
  });
});

describe('safeIdPrefix', () => {
  it('produces NCName-safe prefixes, because these ids go back out as xsd:ID', () => {
    expect(safeIdPrefix('2019 trip (final).kml')).toMatch(/^[A-Za-z_][A-Za-z0-9._-]*$/);
    expect(safeIdPrefix('...kml')).toBe('import');
    expect(safeIdPrefix('123.kml')).toBe('import');
  });
});

describe('withImported', () => {
  const story = { schema: 'companion.atlas/story@1', id: 's', title: 'S', scenes: [] } as unknown as Story;
  const item = (id: string): Item =>
    ({ id, type: 'marker', position: { lat: 1, lon: 2 } }) as Item;

  it('returns the same object when there is nothing to merge', () => {
    expect(withImported(story, [])).toBe(story);
  });

  it('appends imported items to the story', () => {
    const merged = withImported(story, [item('a'), item('b')]);
    expect(merged?.items?.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('lets the later copy win when the same file is imported twice', () => {
    const withOne = withImported(story, [item('dup')]) as Story;
    const twice = withImported(withOne, [item('dup')]);
    expect(twice?.items?.filter((i) => i.id === 'dup')).toHaveLength(1);
  });
});

describe('summarise', () => {
  it('counts features and names failures', () => {
    expect(
      summarise([
        { fileName: 'a.kml', format: 'kml', items: [{ id: '1' } as Item, { id: '2' } as Item] },
        { fileName: 'b.kml', format: 'kml', items: [], error: 'nope' },
      ]),
    ).toBe('2 features from 1 file · 1 failed');
  });

  it('says so when a valid file simply had nothing in it', () => {
    expect(summarise([{ fileName: 'empty.geojson', format: 'geojson', items: [] }])).toMatch(/nothing locatable/);
  });
});

describe('fileStem', () => {
  it('makes a filesystem-safe name and never an empty one', () => {
    expect(fileStem('Reykjavík: Day One!', 'x')).toBe('reykjavik-day-one');
    expect(fileStem('///', 'atlas-story')).toBe('atlas-story');
    expect(fileStem(undefined, 'atlas-story')).toBe('atlas-story');
  });
});
