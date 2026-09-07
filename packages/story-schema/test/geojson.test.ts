import { describe, it, expect } from 'vitest';
import { geoJsonToItems, geoJsonToStory, storyToCzml, validateStory } from '../src/index.js';
import type { Item } from '../src/index.js';
import geometry from './fixtures/geometry.geojson.json';

const byId = (items: Item[], id: string): Item => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id} in ${items.map((i) => i.id).join(', ')}`);
  return found;
};

describe('geoJsonToItems — every geometry type', () => {
  const items = geoJsonToItems(geometry);

  it('maps each of the seven geometry types onto canonical items', () => {
    // Point, MultiPoint(2), LineString, MultiLineString(2), Polygon,
    // MultiPolygon(2), GeometryCollection(point + line) = 11.
    // The null-geometry attribute row contributes nothing.
    expect(items.map((i) => `${i.id}:${i.type}`)).toEqual([
      'praca:marker',
      'gj_1:marker',
      'gj_1-1:marker',
      'gj_2:line',
      'gj_3:line',
      'gj_3-1:line',
      'gj_4:polygon',
      'gj_5:polygon',
      'gj_5-1:polygon',
      'gj_6:marker',
      'gj_6-1:line',
    ]);
  });

  it('reads [lon, lat, height] in that order — not lat first', () => {
    const praca = byId(items, 'praca');
    // Praça do Comércio is at 38.7°N, 9.1°W. Swapped, it lands off Somalia.
    expect(praca.type).toBe('marker');
    expect((praca as Extract<Item, { type: 'marker' }>).position).toEqual({ lat: 38.7077, lon: -9.1366, height: 12 });
  });

  it('maps properties onto title/description/tags/time', () => {
    const praca = byId(items, 'praca');
    expect(praca.title).toBe('Praça do Comércio');
    expect(praca.description).toBe('Where the walk started.');
    expect(praca.tags).toEqual(['lisbon', 'square']);
    expect(praca.time).toEqual({ at: '2026-05-09T09:00:00Z' });
    // `name` is the fallback title key, and a start/end pair becomes an interval.
    expect(byId(items, 'gj_2').time).toEqual({ start: '2026-05-09T10:00:00Z', end: '2026-05-09T10:45:00Z' });
  });

  it('honours simplestyle stroke/fill properties', () => {
    const tram = byId(items, 'gj_2') as Extract<Item, { type: 'line' }>;
    expect(tram.color).toBe('#ffcc00');
    expect(tram.width).toBe(4);

    const castelo = byId(items, 'gj_4') as Extract<Item, { type: 'polygon' }>;
    expect(castelo.fillColor).toBe('#33cc99');
    expect(castelo.fillOpacity).toBe(0.35);
    expect(castelo.outlineColor).toBe('#116644');
    expect(castelo.outlineWidth).toBe(2);

    // "3c9" — the `#`-less CSS shorthand plenty of producers emit.
    expect((byId(items, 'gj_1') as Extract<Item, { type: 'marker' }>).color).toBe('#3c9');
  });

  it('splits a Polygon into outer ring + holes and drops the closing vertex', () => {
    const castelo = byId(items, 'gj_4') as Extract<Item, { type: 'polygon' }>;
    // The fixture ring has 5 positions; the 5th repeats the 1st.
    expect(castelo.positions).toHaveLength(4);
    expect(castelo.positions[0]).not.toEqual(castelo.positions[castelo.positions.length - 1]);
    expect(castelo.holes).toHaveLength(1);
    expect(castelo.holes![0]).toHaveLength(4);
  });

  it('keeps fill-opacity 0 rather than treating it as absent', () => {
    // 0 is "outline only", not "unset" — a `||` default would silently fill it.
    expect((byId(items, 'gj_5') as Extract<Item, { type: 'polygon' }>).fillOpacity).toBe(0);
  });

  it('flattens a GeometryCollection into one item per member', () => {
    expect(byId(items, 'gj_6').type).toBe('marker');
    expect(byId(items, 'gj_6-1').type).toBe('line');
    expect(byId(items, 'gj_6').title).toBe('Mixed bag');
  });
});

describe('geoJsonToItems — shapes other than a FeatureCollection', () => {
  it('accepts a bare geometry with no Feature wrapper', () => {
    const items = geoJsonToItems({ type: 'LineString', coordinates: [[1, 2], [3, 4]] });
    expect(items).toHaveLength(1);
    expect((items[0] as Extract<Item, { type: 'line' }>).positions).toEqual([
      { lat: 2, lon: 1 },
      { lat: 4, lon: 3 },
    ]);
  });

  it('skips malformed features instead of failing the whole import', () => {
    const items = geoJsonToItems({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ['x', 'y'] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[1, 2]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Sphere', coordinates: [1, 2] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('marker');
  });

  it('returns [] for a document that is not GeoJSON at all', () => {
    expect(geoJsonToItems(null)).toEqual([]);
    expect(geoJsonToItems({ hello: 'world' })).toEqual([]);
  });
});

describe('geoJsonToStory', () => {
  const story = geoJsonToStory(geometry);

  it('produces a story that validates against the canonical schema', () => {
    expect(validateStory(story).valid).toBe(true);
    expect(story.title).toBe('Lisbon field notes');
    expect(story.scenes).toEqual([]);
    expect(story.provenance?.kind).toBe('import');
  });

  it('leaves the clock to be derived rather than inventing a timeline', () => {
    expect(story.timeline).toBeUndefined();
  });

  it('renders the imported geometry through the CZML path', () => {
    const { czml } = storyToCzml(story);
    const line = czml.find((p) => p.id === 'gj_2');
    expect((line?.polyline as { width: number }).width).toBe(4);

    const polygon = czml.find((p) => p.id === 'gj_4');
    const poly = polygon?.polygon as { holes?: { cartographicDegrees: number[][] }; material: unknown };
    expect(poly.holes?.cartographicDegrees).toHaveLength(1);
    // #33cc99 at 0.35 → rgba(51, 204, 153, 89).
    expect(poly.material).toEqual({ solidColor: { color: { rgba: [51, 204, 153, 89] } } });

    // fill-opacity 0 must reach Cesium as `fill: false`, not as a default fill.
    expect((czml.find((p) => p.id === 'gj_5')?.polygon as { fill: boolean }).fill).toBe(false);
  });
});
