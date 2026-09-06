import { draftLayer } from './sniff.js';
import type {
  AtlasLayer,
  LayerAttribution,
  LayerAvailability,
  LayerCategory,
  LayerFormat,
  LayerOptions,
} from './model.js';
import { FORMAT_META, foldForSearch, layerCategory } from './model.js';

/**
 * The built-in catalog: open data a user can put on the globe in one click.
 *
 * ## Rules for anything added here
 *
 * 1. **No API key, ever.** A catalog entry that needs a key is a catalog entry
 *    that answers every tile request with 401 for most people — `basemaps.ts`
 *    makes the same call for Mapbox and only offers it when a token exists. A
 *    keyed source belongs in the "add by URL" flow, not here.
 * 2. **Attribution is mandatory and must be right.** Every source below is
 *    licensed, and most of those licences are conditional on the credit: ODbL
 *    and CC BY-SA are share-alike with attribution, CC BY-NC-SA additionally
 *    forbids commercial use. Getting the credit text wrong is a licence breach,
 *    not a typo, so each entry carries the wording its terms ask for and a link
 *    to those terms.
 * 3. **Every URL here was fetched and checked**, including the zoom level in
 *    `maximumLevel` — an optimistic maximum turns into a storm of 404s the
 *    moment someone zooms in, and Cesium will happily keep asking.
 * 4. **Say when the data is true.** Annual mosaics and daily satellite passes
 *    get an `availability` window, because this is a 4D atlas: a 2023 mosaic
 *    drawn under a 1998 camera time is a confident lie.
 *
 * Overlap with `renderers/basemaps.ts` is expected and fine: that file answers
 * "what does the ground look like" with one exclusive choice, this one answers
 * "what else do you want on top", and a user may reasonably want OpenStreetMap
 * in either role.
 */
export interface CatalogEntry {
  id: string;
  name: string;
  /** One line, shown under the name in the catalog list. */
  description: string;
  format: LayerFormat;
  url: string;
  /** Required here, unlike on a user-added layer — see rule 2 above. */
  attribution: LayerAttribution;
  availability?: LayerAvailability;
  options?: LayerOptions;
  /** Extra words the search should match that are not in the name. */
  tags?: string[];
  /** Overlays default to less than full opacity so the basemap stays legible. */
  opacity?: number;
}

/** WMTS options are verbose and identical in shape for every RESTful service. */
const restfulWmts = (layer: string, opts: Partial<LayerOptions> & { maximumLevel: number }): LayerOptions => ({
  tilingScheme: 'web-mercator',
  wmtsLayer: layer,
  wmtsStyle: 'default',
  tileMatrixSet: 'GoogleMapsCompatible',
  mimeType: 'image/jpeg',
  ...opts,
});

/** OpenStreetMap's data licence, which a dozen derived styles below inherit. */
const OSM_TERMS = 'https://www.openstreetmap.org/copyright';

export const LAYER_CATALOG: CatalogEntry[] = [
  // ---- Raster: street & topographic ---------------------------------------
  {
    id: 'osm-standard',
    name: 'OpenStreetMap',
    description: 'The standard OSM map — streets, buildings, paths, everywhere.',
    format: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    // The OSMF Tile Usage Policy allows a small app like this one but forbids
    // bulk downloading and asks for the credit on the map. It is a *policy*,
    // not a licence: heavy use is expected to move to its own tile server, so
    // this entry is a good default and a bad foundation.
    options: { tilingScheme: 'web-mercator', maximumLevel: 19 },
    attribution: {
      text: '© OpenStreetMap contributors',
      licence: 'ODbL 1.0 (data) · tiles under the OSMF Tile Usage Policy',
      url: OSM_TERMS,
      onScreen: true,
    },
    tags: ['osm', 'streets', 'roads', 'vector map'],
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    description: 'Topographic style over OSM + SRTM — contours, hillshade, trails.',
    format: 'xyz',
    // `{s}` is required by OpenTopoMap's own documentation to spread load over
    // its three servers; the model refuses an {s} template without subdomains
    // precisely so this cannot ship as a literal "{s}.tile..." hostname.
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { tilingScheme: 'web-mercator', subdomains: 'abc', maximumLevel: 17 },
    attribution: {
      text: 'Map data © OpenStreetMap contributors, SRTM · Map style © OpenTopoMap (CC BY-SA)',
      licence: 'CC BY-SA 3.0 (style) · ODbL 1.0 (data)',
      url: 'https://opentopomap.org/about',
      onScreen: true,
    },
    tags: ['topo', 'contours', 'hiking', 'relief', 'elevation'],
  },
  {
    id: 'carto-dark',
    name: 'CARTO Dark Matter',
    description: 'Near-black street canvas — the one that disappears under data.',
    format: 'xyz',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    options: { tilingScheme: 'web-mercator', maximumLevel: 20 },
    attribution: {
      text: '© OpenStreetMap contributors © CARTO',
      licence: 'CC BY 3.0 (style) · ODbL 1.0 (data)',
      url: 'https://carto.com/attribution/',
      onScreen: true,
    },
    tags: ['dark', 'basemap', 'night', 'canvas'],
  },

  // ---- Raster: satellite ---------------------------------------------------
  {
    id: 'eox-s2cloudless-2016',
    name: 'Sentinel-2 cloudless 2016',
    description: 'Cloud-free 10 m satellite mosaic of the whole planet for 2016.',
    format: 'wmts',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    // The 2016 mosaic specifically, and not one of the prettier recent ones.
    // EOX relicensed the series: 2016 and 2017 are CC BY 4.0, while 2018
    // onwards are CC BY-**NC**-SA 4.0. This repo ships under CI-Commercial-1.0,
    // so a NonCommercial layer offered in one click from the product's own
    // catalog is a licence breach waiting to happen, however much better 2023
    // looks. A user who has their own arrangement with EOX can still paste the
    // newer layer's URL into "add by URL" — that is their decision to make,
    // and `renderers/basemaps.ts` draws the same line for the basemap picker.
    // Native resolution is 10 m/px ≈ zoom 14; EOX serves one upsampled level
    // above that, which reads better than a hard stop when you fly in close.
    options: restfulWmts('s2cloudless_3857', { maximumLevel: 15 }),
    // It is a 2016 annual mosaic. Saying so is the whole point of a 4D atlas:
    // switched on over a 1998 camera time it would be a confident lie, so the
    // scene hides it and the panel says why instead.
    availability: { start: '2016-01-01T00:00:00Z', stop: '2016-12-31T23:59:59Z' },
    attribution: {
      // EOX's required wording: CC BY 4.0 §3(a) wants the creator, the source
      // and the licence named.
      text: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH — contains modified Copernicus Sentinel data 2016',
      licence: 'CC BY 4.0',
      url: 'https://s2maps.eu/',
      onScreen: true,
    },
    tags: ['satellite', 'imagery', 'sentinel', 'copernicus', 'esa', 'cloudless'],
  },
  {
    id: 'eox-terrain-light',
    name: 'EOX Terrain Light',
    description: 'Muted shaded-relief world map — a calm base under bright data.',
    format: 'wmts',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/GoogleMapsCompatible/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    options: restfulWmts('terrain-light_3857', { maximumLevel: 13 }),
    attribution: {
      text: 'Terrain Light: data © OpenStreetMap contributors and others, rendering © EOX',
      licence: 'CC BY-SA 4.0',
      url: 'https://maps.eox.at/',
      onScreen: true,
    },
    tags: ['relief', 'hillshade', 'basemap', 'muted'],
  },
  {
    id: 'gibs-modis-truecolor',
    name: 'MODIS Terra true colour (daily)',
    description: 'What the planet actually looked like on a given day, since 2000.',
    format: 'wmts',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible_Level9/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    options: {
      ...restfulWmts('MODIS_Terra_CorrectedReflectance_TrueColor', { maximumLevel: 8 }),
      tileMatrixSet: 'GoogleMapsCompatible_Level9',
      // GIBS publishes one granule per day, so the `{Time}` dimension follows
      // the story clock quantised to the day. Without the quantisation the
      // provider would be rebuilt on every clock tick and the tile cache would
      // be thrown away sixty times a second.
      dimensions: { Time: '2023-06-01' },
      followsClock: true,
    },
    // Terra's first published imagery. Before this there is no granule to ask
    // for, and GIBS answers out-of-range dates with an empty tile.
    availability: { start: '2000-02-24T00:00:00Z' },
    attribution: {
      text: 'NASA EOSDIS Global Imagery Browse Services (GIBS) / Earth Observing System Data and Information System',
      licence: 'NASA open data — free to use, credit requested',
      url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/data-information-policy',
    },
    tags: ['nasa', 'gibs', 'satellite', 'daily', 'weather', 'clouds', 'modis', 'time'],
  },
  {
    id: 'gibs-viirs-citylights',
    name: 'Earth at night (VIIRS 2012)',
    description: 'The Black Marble night-lights composite — cities from orbit.',
    format: 'wmts',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    options: {
      ...restfulWmts('VIIRS_CityLights_2012', { maximumLevel: 7 }),
      tileMatrixSet: 'GoogleMapsCompatible_Level8',
    },
    attribution: {
      text: 'NASA Earth Observatory / NOAA NGDC — Suomi NPP VIIRS, via NASA GIBS',
      licence: 'NASA open data — free to use, credit requested',
      url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/data-information-policy',
    },
    tags: ['nasa', 'night', 'lights', 'black marble', 'viirs', 'cities'],
  },
  {
    id: 'usgs-imagery',
    name: 'USGS Imagery (United States)',
    description: 'High-resolution aerial imagery of the US, from The National Map.',
    format: 'xyz',
    // ArcGIS caches address tiles as {z}/{y}/{x} — row before column, the
    // opposite of the slippy convention. Transposing them silently returns the
    // wrong part of the world rather than an error.
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    options: { tilingScheme: 'web-mercator', maximumLevel: 16 },
    attribution: {
      text: 'USGS The National Map',
      licence: 'Public domain (work of the US Government)',
      url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    },
    tags: ['usgs', 'aerial', 'united states', 'naip', 'satellite'],
  },
  {
    id: 'usgs-topo',
    name: 'USGS Topo (United States)',
    description: 'The classic US quadrangle topographic sheets, tiled.',
    format: 'xyz',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    options: { tilingScheme: 'web-mercator', maximumLevel: 16 },
    attribution: {
      text: 'USGS The National Map',
      licence: 'Public domain (work of the US Government)',
      url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    },
    tags: ['usgs', 'topo', 'contours', 'united states', 'quadrangle'],
  },
  {
    id: 'openseamap',
    name: 'OpenSeaMap seamarks',
    description: 'Transparent overlay: buoys, lights, harbours and shipping marks.',
    format: 'xyz',
    url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    options: { tilingScheme: 'web-mercator', maximumLevel: 18, transparent: true },
    attribution: {
      text: '© OpenSeaMap contributors',
      licence: 'CC BY-SA 2.0 (tiles) · ODbL 1.0 (data)',
      url: 'https://www.openseamap.org/index.php?id=impressum',
      onScreen: true,
    },
    tags: ['sea', 'marine', 'nautical', 'overlay', 'harbour', 'buoys'],
  },

  // ---- Vector --------------------------------------------------------------
  {
    id: 'usgs-quakes-day',
    name: 'Earthquakes, past 24 hours',
    description: 'Live USGS feed — every recorded quake in the last day.',
    format: 'geojson',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    options: {
      // A CSS custom property rather than a hex literal: the scene adapter
      // resolves it against the live theme, so this stays one colour system
      // with the rest of the shell (see `theme/atlas.css`).
      colour: 'var(--atlas-coral)',
      clampToGround: false,
    },
    attribution: {
      text: 'U.S. Geological Survey — Earthquake Hazards Program',
      licence: 'Public domain (work of the US Government)',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/',
    },
    tags: ['usgs', 'earthquake', 'seismic', 'live', 'geojson', 'hazard'],
  },

  // ---- Terrain and 3D ------------------------------------------------------
  // Deliberately empty, and worth saying why rather than shipping a broken row:
  // there is no keyless, publicly hosted quantized-mesh terrain service or 3D
  // Tiles dataset we could verify. Cesium will read exactly one terrain wire
  // format and nobody publishes a free global one — `renderers/terrain.ts`
  // documents the self-hosting route and reads `VITE_TERRAIN_URL` for a
  // deployment that has built its own. Google's Photorealistic 3D Tiles need a
  // Maps key (that is the existing "3D buildings" toggle) and ion assets need a
  // token, so neither can be a one-click entry here under rule 1.
  //
  // Both formats are fully supported through "add by URL": a self-hosted Cesium
  // Terrain Builder `layer.json`, or any `tileset.json`, works today.
];

/** Catalog entries grouped the way the panel lists them, in catalog order. */
export function catalogByCategory(entries: readonly CatalogEntry[] = LAYER_CATALOG): Array<[LayerCategory, CatalogEntry[]]> {
  const groups = new Map<LayerCategory, CatalogEntry[]>();
  for (const e of entries) {
    const cat = layerCategory(e.format);
    const bucket = groups.get(cat);
    if (bucket) bucket.push(e);
    else groups.set(cat, [e]);
  }
  return [...groups.entries()];
}

/**
 * Turn a catalog entry into a layer ready to append to the stack.
 *
 * Routed through `draftLayer` rather than hand-built so the catalog is held to
 * exactly the same validation as a URL a user pastes — a malformed entry fails
 * the suite instead of failing on someone's globe. It throws, because a bad
 * entry here is a bug in this file, not a user error.
 */
export function layerFromCatalog(entry: CatalogEntry): AtlasLayer {
  const draft = draftLayer({
    url: entry.url,
    format: entry.format,
    name: entry.name,
    attribution: entry.attribution,
    availability: entry.availability,
    options: entry.options,
    opacity: entry.opacity,
    catalogId: entry.id,
  });
  if (!draft.ok) throw new Error(`catalog entry "${entry.id}" is invalid: ${draft.problem} ${draft.suggestion}`);
  return draft.layer;
}

/** Free-text search over the catalog, matching name, description, tags,
 *  attribution and format label. Same "every term must match" rule as the
 *  layer-stack search, so the two search boxes behave identically. */
export function searchCatalog(query: string, entries: readonly CatalogEntry[] = LAYER_CATALOG): CatalogEntry[] {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...entries];
  return entries.filter((e) => {
    const hay = foldForSearch(
      [e.name, e.description, FORMAT_META[e.format].label, layerCategory(e.format), e.attribution.text, ...(e.tags ?? [])].join(' '),
    );
    return terms.every((t) => hay.includes(t));
  });
}
