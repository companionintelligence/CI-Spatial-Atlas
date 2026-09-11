/**
 * "What is this URL, and can we draw it?"
 *
 * Two things are worth pinning down here. The first is the sniffing table: a
 * WMTS template mounted as XYZ produces well-formed requests for tiles that do
 * not exist, so the globe stays blank with nothing logged — the failure mode
 * `basemaps.ts` documents, and the reason the sniffer refuses to guess when the
 * URL is ambiguous. The second is the *wording* of a rejection: every failure
 * has to say what was wrong and what to try, and a test is the only thing that
 * stops those decaying back into "invalid URL".
 */
import { describe, expect, it, vi } from 'vitest';
import {
  draftLayer,
  nameFromUrl,
  probeLayerFormat,
  sniffLayerFormat,
  sniffLayerFormatFromBody,
  sniffLayerFormatFromContentType,
} from '../src/layers/sniff.js';
import { LAYER_CATALOG, catalogByCategory, layerFromCatalog, searchCatalog } from '../src/layers/catalog.js';
import { FORMAT_META, isLayerFormat } from '../src/layers/model.js';

describe('sniffing a format from a URL', () => {
  const cases: Array<[string, string | null]> = [
    // Raster templates
    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'xyz'],
    ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', 'xyz'],
    ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 'xyz'],
    ['https://example.org/tiles/{z}/{x}/{-y}.png', 'tms'],
    ['https://example.org/tms/{z}/{x}/{y}.png', 'tms'],
    ['https://example.org/cache/tilemapresource.xml', 'tms'],
    // OGC services, by path and by parameter
    ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/{TileMatrix}/{TileRow}/{TileCol}.jpg', 'wmts'],
    ['https://example.org/service?SERVICE=WMTS&REQUEST=GetTile&LAYER=x', 'wmts'],
    ['https://example.org/geoserver/ows?service=WMS&request=GetMap&layers=topp:states', 'wms'],
    ['https://ows.terrestris.de/osm/wms', 'wms'],
    ['https://example.org/wmts/1.0.0/WMTSCapabilities.xml', 'wmts'],
    // Documents
    ['https://scans.example/lighthouse/tileset.json', '3d-tiles'],
    ['https://terrain.example/world/layer.json', 'quantized-mesh'],
    ['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', 'geojson'],
    ['https://example.org/data/features.json', 'geojson'],
    ['https://example.org/trails/alps.kml', 'kml'],
    ['https://example.org/trails/alps.kmz', 'kml'],
    ['https://example.org/flight.czml', 'czml'],
    ['https://example.org/scan.splat', 'gaussian-splat'],
    // Refusals to guess
    ['https://example.org/data/mystery.json', null],
    ['https://example.org/photo.png', null],
    ['https://example.org/shapes.topojson', null],
    ['', null],
  ];

  for (const [url, expected] of cases) {
    it(`${expected ?? 'declines to guess'}: ${url || '(empty)'}`, () => {
      expect(sniffLayerFormat(url)).toBe(expected);
    });
  }

  it('is case-insensitive about OGC parameter names but not about values', () => {
    expect(sniffLayerFormat('https://x.example/ows?Service=WmTs&Request=GetTile')).toBe('wmts');
  });
});

describe('sniffing from the response', () => {
  it('trusts only the MIME types that actually settle it', () => {
    expect(sniffLayerFormatFromContentType('application/geo+json; charset=utf-8')).toBe('geojson');
    expect(sniffLayerFormatFromContentType('application/vnd.google-earth.kml+xml')).toBe('kml');
    // `application/json` is legal for GeoJSON, a tileset and a terrain layer
    // manifest alike, so it settles nothing — the body decides.
    expect(sniffLayerFormatFromContentType('application/json')).toBeNull();
    expect(sniffLayerFormatFromContentType(null)).toBeNull();
  });

  it('tells the three JSON manifests apart by their required members', () => {
    expect(sniffLayerFormatFromBody('{"asset":{"version":"1.1"},"geometricError":240,"root":{}}')).toBe('3d-tiles');
    expect(sniffLayerFormatFromBody('{"tilejson":"2.2.0","tiles":["https://x/{z}/{x}/{y}.png"]}')).toBe('xyz');
    expect(sniffLayerFormatFromBody('{"tiles":["{z}/{x}/{y}.terrain"],"format":"quantized-mesh-1.0"}')).toBe('quantized-mesh');
    expect(sniffLayerFormatFromBody('{"type":"FeatureCollection","features":[]}')).toBe('geojson');
    expect(sniffLayerFormatFromBody('[{"id":"document","version":"1.0"}]')).toBe('czml');
    expect(sniffLayerFormatFromBody('{"hello":"world"}')).toBeNull();
  });

  it('probes with a GET and classifies the body', async () => {
    // A GET rather than a HEAD: plenty of static-file hosts answer HEAD with
    // 403/405 while serving GET perfectly, and reporting those as unreachable
    // would block URLs that work.
    const fetchImpl = vi.fn(async () => new Response('{"type":"FeatureCollection","features":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(probeLayerFormat('https://x.example/mystery.json', { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toBe('geojson');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null rather than throwing when the probe fails', async () => {
    // CORS, offline, or a server that simply refuses: a probe failure must not
    // be the reason a user cannot add their own data.
    const boom = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(probeLayerFormat('https://x.example/mystery.json', { fetchImpl: boom as unknown as typeof fetch }))
      .resolves.toBeNull();
    const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(probeLayerFormat('https://x.example/gone.json', { fetchImpl: notFound as unknown as typeof fetch }))
      .resolves.toBeNull();
  });
});

describe('validating before adding', () => {
  const failure = (url: string, format?: Parameters<typeof draftLayer>[0]['format']) => {
    const r = draftLayer(format ? { url, format } : { url });
    if (r.ok) throw new Error(`expected "${url}" to be rejected`);
    return r;
  };

  it('never answers with a bare "invalid URL"', () => {
    // Every rejection has to name the mismatch and show a URL that would work.
    for (const [url, format] of [
      ['', undefined],
      ['tiles/{z}/{x}/{y}.png', undefined],
      ['ftp://example.org/tiles/{z}/{x}/{y}.png', undefined],
      ['https://example.org/mystery.json', undefined],
      ['https://example.org/photo.png', undefined],
      ['https://example.org/shapes.topojson', undefined],
      ['https://example.org/tiles.png', 'xyz'],
      ['https://example.org/{z}/{x}/{y}.png', 'wms'],
      ['https://example.org/{z}/{x}/{y}.png', '3d-tiles'],
      ['https://example.org/{z}/{x}/{y}.png', 'quantized-mesh'],
      ['https://example.org/{z}/{x}/{y}.png', 'geojson'],
    ] as const) {
      const r = failure(url, format);
      // The problem may be short ("No URL yet."); the suggestion never is,
      // because it is the half that tells the user what to do next.
      expect(r.problem.length, url).toBeGreaterThan(8);
      expect(r.suggestion.length, url).toBeGreaterThan(40);
      expect(r.problem.toLowerCase()).not.toBe('invalid url');
    }
  });

  it('explains a tile template with no placeholders', () => {
    const r = failure('https://example.org/tiles.png', 'xyz');
    expect(r.problem).toContain('{z}/{x}/{y}');
    expect(r.suggestion).toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });

  it('refuses an {s} template with no subdomains', () => {
    // Otherwise the hostname is literally "{s}", and every request fails DNS.
    const r = failure('https://{s}.tile.example/{z}/{x}/{y}.png', 'xyz');
    expect(r.problem).toContain('{s}');
    expect(r.suggestion).toContain('abc');
  });

  it('names the specific thing WMS and WMTS are missing', () => {
    expect(failure('https://example.org/geoserver/ows?service=WMS&request=GetMap').problem).toContain('name which layers');
    const wmts = failure('https://gibs.example/wmts/x/{TileMatrix}/{TileRow}/{TileCol}.jpg');
    expect(wmts.problem).toContain('layer identifier');
    expect(wmts.suggestion).toContain('WMTSCapabilities.xml');
  });

  it('points TopoJSON and single images somewhere useful', () => {
    expect(failure('https://example.org/shapes.topojson').suggestion).toContain('topo2geo');
    expect(failure('https://example.org/photo.png').problem).toContain('single image');
  });

  it('accepts a good URL and reports how it was classified', () => {
    const r = draftLayer({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layer.format).toBe('xyz');
    expect(r.sniffed).toBe(true);
    expect(r.layer.options?.tilingScheme).toBe('web-mercator');
    // Cesium defaults to a geographic scheme, which addresses entirely
    // different tiles; the model's default is reality's, not the library's.
    expect(r.layer.visible).toBe(true);
    expect(r.layer.opacity).toBe(1);
    expect(r.warnings.join(' ')).toContain('attribution');
  });

  it('takes an explicit kind over the sniff', () => {
    const r = draftLayer({ url: 'https://example.org/tiles/{z}/{x}/{y}.png', format: 'tms' });
    expect(r.ok && r.layer.format).toBe('tms');
    expect(r.ok && r.sniffed).toBe(false);
  });

  it('warns that a raw splat file will not draw', () => {
    // Cesium renders splats packaged as 3D Tiles — the same path `czml.ts`
    // uses. A bare .ply is a silent no-op without this.
    const r = draftLayer({ url: 'https://scans.example/room.ply' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layer.format).toBe('gaussian-splat');
    expect(r.warnings.join(' ')).toContain('tileset.json');
  });

  it('names a layer after the meaningful part of its path', () => {
    expect(nameFromUrl('https://scans.example/scans/lighthouse/tileset.json')).toBe('Lighthouse');
    expect(nameFromUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe('tile.openstreetmap.org');
    expect(nameFromUrl('https://example.org/data/mont_blanc-2019.geojson')).toBe('Mont Blanc 2019');
  });
});

describe('the built-in catalog', () => {
  it('has a unique, stable id per entry', () => {
    const seen = new Set(LAYER_CATALOG.map((e) => e.id));
    expect(seen.size).toBe(LAYER_CATALOG.length);
  });

  it('carries an attribution and a licence for every entry', () => {
    // Not a style rule: ODbL, CC BY-SA and CC BY-NC-SA all make the credit a
    // condition of use, so an entry without one is a licence breach waiting to
    // ship.
    for (const e of LAYER_CATALOG) {
      expect(e.attribution.text.trim().length, e.id).toBeGreaterThan(3);
      expect(e.attribution.licence?.trim().length ?? 0, e.id).toBeGreaterThan(3);
      expect(e.attribution.url ?? '', e.id).toMatch(/^https:\/\//);
    }
  });

  it('needs no API key', () => {
    for (const e of LAYER_CATALOG) {
      expect(e.url, e.id).not.toMatch(/(api_?key|access_?token|apikey)=/i);
    }
  });

  it('validates every entry through the same path a pasted URL takes', () => {
    for (const e of LAYER_CATALOG) {
      const layer = layerFromCatalog(e);
      expect(layer.catalogId).toBe(e.id);
      expect(layer.format).toBe(e.format);
      expect(isLayerFormat(layer.format)).toBe(true);
      expect(layer.attribution?.text).toBe(e.attribution.text);
      // A raster entry that forgot its maximum level turns into a 404 storm the
      // first time somebody zooms past what the service actually serves.
      if (FORMAT_META[e.format].category === 'raster') {
        expect(layer.options?.maximumLevel, e.id).toBeGreaterThan(0);
      }
    }
  });

  it('says when a time-limited source is true', () => {
    const mosaic = LAYER_CATALOG.find((e) => e.id === 'eox-s2cloudless-2016');
    expect(mosaic?.availability).toEqual({ start: '2016-01-01T00:00:00Z', stop: '2016-12-31T23:59:59Z' });
    const gibs = LAYER_CATALOG.find((e) => e.id === 'gibs-modis-truecolor');
    expect(gibs?.availability?.start).toBe('2000-02-24T00:00:00Z'); // Terra's first light
    expect(gibs?.options?.followsClock).toBe(true);
  });

  it('offers no NonCommercial source in one click', () => {
    // This repo ships under CI-Commercial-1.0. EOX relicensed s2cloudless from
    // 2018 onwards to CC BY-NC-SA 4.0, so the catalog carries the 2016 CC BY
    // mosaic and leaves the newer ones to "add by URL", where the user is
    // making the licence decision themselves. `renderers/basemaps.ts` draws the
    // same line for the basemap picker.
    for (const e of LAYER_CATALOG) {
      expect(e.attribution.licence, e.id).not.toMatch(/\bNC\b|non-?commercial/i);
    }
  });

  it('is searchable by name, tag, licence holder and kind', () => {
    expect(searchCatalog('openstreetmap').map((e) => e.id)).toContain('osm-standard');
    expect(searchCatalog('nasa').map((e) => e.id)).toEqual(
      expect.arrayContaining(['gibs-modis-truecolor', 'gibs-viirs-citylights']),
    );
    expect(searchCatalog('night').map((e) => e.id)).toContain('gibs-viirs-citylights');
    expect(searchCatalog('geojson').map((e) => e.id)).toContain('usgs-quakes-day');
    expect(searchCatalog('   ').length).toBe(LAYER_CATALOG.length);
    expect(searchCatalog('definitely not a layer')).toEqual([]);
  });

  it('groups by category for the panel', () => {
    const groups = Object.fromEntries(catalogByCategory().map(([cat, es]) => [cat, es.length]));
    expect(groups.raster).toBeGreaterThan(4);
    expect(groups.vector).toBeGreaterThan(0);
  });
});
