/**
 * The scene adapter's provider construction.
 *
 * Nothing here renders — providers are built and inspected, exactly as
 * `basemaps.test.ts` does. Three things are worth pinning down because getting
 * them wrong fails *silently* on a globe:
 *
 *   - the tiling scheme (Cesium defaults to geographic; the open web is Web
 *     Mercator, so the requests are well-formed and address nothing),
 *   - the credit reaching the provider at all, since attribution is a condition
 *     of use for almost every source in the catalog,
 *   - the time dimension quantising to the day, so a clock tick does not
 *     rebuild the provider and throw the tile cache away.
 */
import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import {
  ATLAS_LAYER_TAG,
  createImageryProvider,
  isAtlasManagedImagery,
  resolveColour,
  resolvedDimensions,
} from '../src/layers/cesium.js';
import { layerFromCatalog, LAYER_CATALOG } from '../src/layers/catalog.js';
import type { AtlasLayer } from '../src/layers/model.js';

const layer = (over: Partial<AtlasLayer> = {}): AtlasLayer => ({
  id: 'l',
  name: 'L',
  format: 'xyz',
  url: 'https://tiles.example/{z}/{x}/{y}.png',
  visible: true,
  opacity: 1,
  order: 0,
  options: { tilingScheme: 'web-mercator' },
  ...over,
});

describe('imagery providers', () => {
  it('builds an XYZ template on the Web Mercator pyramid', () => {
    // Cesium's own default is geographic, which addresses entirely different
    // tiles — well-formed requests, a blank globe, nothing logged.
    const p = createImageryProvider(layer());
    expect(p).toBeInstanceOf(Cesium.UrlTemplateImageryProvider);
    expect(p.tilingScheme).toBeInstanceOf(Cesium.WebMercatorTilingScheme);
  });

  it('honours an explicit geographic scheme', () => {
    const p = createImageryProvider(layer({ options: { tilingScheme: 'geographic' } }));
    expect(p.tilingScheme).toBeInstanceOf(Cesium.GeographicTilingScheme);
  });

  it('flips the Y axis for TMS', () => {
    // TMS counts rows from the south. `{reverseY}` is Cesium's spelling of the
    // flip; without the rewrite the tiles load and the world is upside down.
    const p = createImageryProvider(layer({ format: 'tms', url: 'https://t.example/{z}/{x}/{y}.png' }));
    expect((p as Cesium.UrlTemplateImageryProvider).url).toContain('{reverseY}');
    expect((p as Cesium.UrlTemplateImageryProvider).url).not.toContain('{y}');
  });

  it('passes WMTS its layer, matrix set and static dimensions', () => {
    const p = createImageryProvider(layer({
      format: 'wmts',
      url: 'https://g.example/wmts/L/default/{Time}/GMC/{TileMatrix}/{TileRow}/{TileCol}.jpg',
      options: { wmtsLayer: 'L', tileMatrixSet: 'GMC', mimeType: 'image/jpeg', dimensions: { Time: '2019-04-01' } },
    })) as Cesium.WebMapTileServiceImageryProvider;
    expect(p).toBeInstanceOf(Cesium.WebMapTileServiceImageryProvider);
    // Cesium 1.143 keeps `layer` and `tileMatrixSetID` private — building the
    // provider at all is the assertion for those, since it throws when either
    // is missing. `dimensions` is exposed, and is the one this app substitutes.
    expect(p.dimensions).toEqual({ Time: '2019-04-01' });
    expect(p.tilingScheme).toBeInstanceOf(Cesium.WebMercatorTilingScheme);
  });

  it('reads the WMS layer names out of the URL when the options do not carry them', () => {
    const p = createImageryProvider(layer({
      format: 'wms',
      url: 'https://ows.example/wms?service=WMS&request=GetMap&layers=OSM-WMS',
      options: { tilingScheme: 'geographic' },
    })) as Cesium.WebMapServiceImageryProvider;
    // Case preserved: OGC parameter *names* are case-insensitive, values are not.
    expect(p.layers).toBe('OSM-WMS');
  });

  it('carries the credit onto the provider', () => {
    // Not decoration: ODbL, CC BY-SA and the OSM tile policy all make the
    // credit a condition of use.
    const p = createImageryProvider(layer({
      attribution: { text: '© OpenStreetMap contributors', licence: 'ODbL 1.0', onScreen: true },
    }));
    expect(p.credit?.html).toContain('OpenStreetMap');
    expect(p.credit?.showOnScreen).toBe(true);
  });

  it('builds every raster entry in the catalog', () => {
    for (const entry of LAYER_CATALOG) {
      const l = layerFromCatalog(entry);
      if (l.format === 'geojson' || l.format === 'kml' || l.format === 'czml') continue;
      if (l.format === '3d-tiles' || l.format === 'gaussian-splat' || l.format === 'quantized-mesh') continue;
      const p = createImageryProvider(l);
      expect(p.credit?.html, entry.id).toContain(entry.attribution.text.slice(0, 12));
      expect(p.tilingScheme, entry.id).toBeInstanceOf(Cesium.WebMercatorTilingScheme);
    }
  });
});

describe('the time dimension', () => {
  const daily = layer({ options: { followsClock: true, dimensions: { Time: '2023-06-01' } } });

  it('quantises the clock to the day GIBS publishes', () => {
    expect(resolvedDimensions(daily, Date.UTC(2019, 3, 1, 13, 45))).toEqual({ Time: '2019-04-01' });
    // Same day, different instant → the same provider, so the tile cache
    // survives a scrub through the afternoon.
    expect(resolvedDimensions(daily, Date.UTC(2019, 3, 1, 23, 59))).toEqual({ Time: '2019-04-01' });
  });

  it('leaves a static dimension alone', () => {
    const fixed = layer({ options: { dimensions: { Time: '2012-01-01' } } });
    expect(resolvedDimensions(fixed, Date.UTC(2019, 3, 1))).toEqual({ Time: '2012-01-01' });
    expect(resolvedDimensions(layer(), Date.UTC(2019, 3, 1))).toBeUndefined();
  });
});

describe('theme colours and the imagery tag', () => {
  it('falls back when a CSS custom property cannot be resolved', () => {
    // No document in Node — and the same path runs in a browser where the
    // variable is simply not defined.
    const fallback = Cesium.Color.fromCssColorString('#72ddd4');
    expect(resolveColour('var(--atlas-coral)', fallback).equals(fallback)).toBe(true);
    expect(resolveColour('var(--nope, #ff0000)', fallback).equals(Cesium.Color.RED)).toBe(true);
    expect(resolveColour(undefined, fallback).equals(fallback)).toBe(true);
    expect(resolveColour('#00ff00', fallback).equals(Cesium.Color.LIME)).toBe(true);
  });

  it('recognises only the imagery layers this module owns', () => {
    // `CesiumStoryViewer`'s basemap swap clears "everything above index 0"; the
    // tag is what stops it taking the user's layers with it.
    const mine = new Cesium.ImageryLayer(createImageryProvider(layer()));
    const theirs = new Cesium.ImageryLayer(createImageryProvider(layer()));
    (mine as unknown as Record<string, unknown>)[ATLAS_LAYER_TAG] = 'l';
    expect(isAtlasManagedImagery(mine)).toBe(true);
    expect(isAtlasManagedImagery(theirs)).toBe(false);
  });
});
