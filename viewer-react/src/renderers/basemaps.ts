import * as Cesium from 'cesium';

/**
 * Basemaps Atlas can draw, and the rules for which of them a given deployment
 * is allowed to offer.
 *
 * The viewer previously fell back to Cesium's bundled NaturalEarthII texture
 * whenever no ion token was configured, which is a two-level offline raster —
 * fine as a last resort, unreadable as the actual map (it blurs into colour
 * mush past a few hundred kilometres, so a memory pin had no recognisable
 * ground under it).
 *
 * CI-Server's own map already solved this: it renders Esri World Imagery
 * straight from ArcGIS Online with no key (see its
 * `frontend/apps/web/src/components/Map/Map.tsx`). Atlas uses the same source
 * so both surfaces show the user the same Earth.
 *
 * Attribution is not optional. These tiles are a third party's, every tile
 * request is egress to them, and Esri's World Imagery terms require the credit
 * — CI-Server documents this in `docs/architecture/third-party-egress.md` and
 * keeps its attribution control on for exactly this reason. Each entry below
 * therefore carries the `credit` Cesium renders in the on-screen attribution.
 *
 * ## Three tiers, and why the order in this list matters
 *
 * 1. **Keyless + openly licensed.** EOX Sentinel-2 cloudless (CC BY 4.0 for the
 *    years we default to), NASA GIBS (US Government work, effectively public
 *    domain), OpenStreetMap raster (ODbL). No account, no key, no metering, and
 *    a self-hostable server behind each one.
 * 2. **Keyless but proprietary.** The Esri ArcGIS Online caches. Free to call
 *    and no key, but they are Esri's tiles under Esri's terms — a deployment
 *    that wants to be provider-independent cannot rely on them.
 * 3. **Keyed.** Mapbox, and (in the viewer, not here) Cesium ion and Google.
 *    Sharper, but metered and account-bound.
 *
 * Entries are ordered so that the *unconditional* ones never move. Anything
 * that appears only when a key is configured is appended, because a missing
 * token must drop entries off the end of the picker rather than reshuffle the
 * ones people already know the position of. The open tier is unconditional, so
 * it slots in after the Esri block and before the keyed block.
 */
export interface Basemap {
  id: string;
  label: string;
  /** Shown in the layer switcher under the label. */
  hint: string;
  /**
   * Absent for the offline entry: it is the layer the globe already mounts
   * with, so selecting it means "remove any overlay", not "add one".
   *
   * The options bag is optional and every provider ignores what it does not
   * understand, so `entry.create()` with no arguments stays correct — the
   * viewer's basemap effect calls it exactly that way. It exists so the
   * date-aware GIBS layer can be handed the story clock without every other
   * entry having to care.
   */
  create?: (opts?: BasemapOptions) => Cesium.ImageryProvider;
  /**
   * Licence of the *tiles*, not of this code. Carried on the entry as well as
   * inside `create` so a licence audit (and the test suite) can read it without
   * constructing a provider and without a WebGL context.
   */
  licence?: string;
  /**
   * The credit text Cesium renders, duplicated here for the same reason. Every
   * entry with a `create` must have one: for CC BY, ODbL and Esri's terms alike
   * the attribution is a condition of use, so an entry without it is a licence
   * breach waiting to ship. `test/basemaps.test.ts` asserts exactly that.
   */
  attribution?: string;
}

/**
 * Per-provider knobs, all optional.
 *
 * Only GIBS reads any of them today. Kept as one bag rather than a generic
 * because the viewer's basemap effect passes the same object to whichever entry
 * is selected and must not have to know which provider it got.
 */
export interface BasemapOptions {
  /**
   * GIBS: the UTC day to draw, `YYYY-MM-DD`. Defaults to `gibsDefaultDate()`.
   * Ignored when `clock`/`times` are supplied — then the clock drives the date.
   */
  date?: string;
  /**
   * GIBS: drive the imagery date from a Cesium clock (the story clock, so
   * scrubbing the timeline scrubs the satellite imagery under the pins). Both
   * of these must be given together — Cesium throws if only one is present —
   * and `gibsDailyTimes()` builds the collection.
   */
  clock?: Cesium.Clock;
  times?: Cesium.TimeIntervalCollection;
}

export type ViteEnv = Record<string, string | undefined>;

/**
 * Vite freezes `import.meta.env` when it resolves the config, so this is a
 * snapshot, not a live read — which is fine, and is why the list-building below
 * takes the env as an argument instead of reaching for it. That keeps
 * `buildBasemaps()` a pure function of its input and testable without the
 * `import.meta.env` stubbing dance that `test/streetview.test.ts` had to work
 * around (see its `load()` comment).
 */
const readEnv = (): ViteEnv => (import.meta as unknown as { env?: ViteEnv }).env ?? {};

/** An env var, or undefined when unset *or* set to whitespace/empty. */
const setting = (env: ViteEnv, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

const esri = (path: string, credit: string) => () =>
  new Cesium.UrlTemplateImageryProvider({
    url: `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`,
    credit: new Cesium.Credit(credit, false),
    maximumLevel: 18,
    // ArcGIS Online serves these caches in Web Mercator (EPSG:3857).
    // UrlTemplateImageryProvider defaults to a GeographicTilingScheme
    // (EPSG:4326), whose {z}/{y}/{x} indices address entirely different tiles —
    // the requests are well-formed but never match the cache, so the globe stays
    // blank with no error to explain it. This must match the service.
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
  });

/**
 * Mapbox raster tiles. Same Web Mercator trap as ArcGIS above — without the
 * explicit tiling scheme the requests are well-formed and address tiles that do
 * not exist, and the globe stays blank with nothing logged to explain it.
 *
 * Both sources here serve 512px images over the *standard* slippy pyramid
 * (verified by fetching `10/175/408` from each and comparing the ground): the
 * "512 vs 256" choice changes how much detail is drawn into a tile, not which
 * tile the indices address. So one tiling scheme covers both, and tileWidth /
 * tileHeight must say 512 or Cesium's LOD maths refines a level too far and
 * fetches four times the tiles it needs.
 */
const mapbox = (path: string, credit: string, token: string) => () =>
  new Cesium.UrlTemplateImageryProvider({
    url: `https://api.mapbox.com/${path}?access_token=${token}`,
    // On screen, unlike the Esri credits: Mapbox's attribution terms ask for the
    // notice on the map itself, not only behind the "Data attribution" link.
    credit: new Cesium.Credit(credit, true),
    // Both tilesets report maxzoom 22, and serve it — checked against the v4
    // TileJSON and by requesting a z22 tile from each.
    maximumLevel: 22,
    tileWidth: 512,
    tileHeight: 512,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
  });

// ---------------------------------------------------------------------------
// Open tier 1: EOX Sentinel-2 cloudless
// ---------------------------------------------------------------------------

/**
 * WMTS root of the EOX Maps instance. A deployment can point this at its own
 * (`VITE_EOX_TILE_URL`) — EOX publish the recipe, and the public instance is a
 * courtesy, not a CDN we are entitled to hammer. The RESTful WMTS path is
 * `{root}/{layer}/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
 * i.e. z/y/x, which is what UrlTemplateImageryProvider's `{z}/{y}/{x}` gives.
 */
const EOX_WMTS = 'https://tiles.maps.eox.at/wmts/1.0.0';

/**
 * The 2016 mosaic, and the only sensible default — see `s2cloudlessLicence`.
 * `_3857` is the Web Mercator variant; EOX also publish an EPSG:4326 variant
 * under the un-suffixed name, which would need a GeographicTilingScheme.
 */
const EOX_DEFAULT_LAYER = 's2cloudless_3857';

/**
 * **Licence trap, and the reason this file does not simply take the newest
 * mosaic.** EOX relicensed Sentinel-2 cloudless partway through the series.
 * Read straight from their WMTS GetCapabilities on 2026-09-05:
 *
 *   - `s2cloudless` / `s2cloudless_3857` (2016)  → CC BY 4.0
 *   - `s2cloudless-2017[_3857]`                  → CC BY 4.0
 *   - `s2cloudless-2018` … `s2cloudless-2025`    → CC BY-**NC**-SA 4.0
 *
 * Atlas ships under CI-Commercial-1.0 (see the repo root `package.json`), so
 * the NonCommercial years are not usable in a shipped build no matter how much
 * better 2025 looks than 2016. They stay reachable — a non-commercial or
 * internal deployment is entitled to them — but only by explicitly naming the
 * layer in `VITE_EOX_S2_LAYER`, and the credit then says NC out loud so nobody
 * ships one by accident. For commercial use of the recent mosaics EOX sell a
 * licence: https://cloudless.eox.at.
 */
const S2_CC_BY_LAYERS = new Set([
  's2cloudless',
  's2cloudless_3857',
  's2cloudless-2017',
  's2cloudless-2017_3857',
]);

export function s2cloudlessLicence(layer: string): 'CC-BY-4.0' | 'CC-BY-NC-SA-4.0' {
  return S2_CC_BY_LAYERS.has(layer) ? 'CC-BY-4.0' : 'CC-BY-NC-SA-4.0';
}

/** `s2cloudless-2021_3857` → `2021`; the un-suffixed base layer is the 2016 mosaic. */
export function s2cloudlessYear(layer: string): string {
  return /s2cloudless-(\d{4})/.exec(layer)?.[1] ?? '2016';
}

/**
 * The attribution EOX require, near enough verbatim to their own
 * GetCapabilities abstract, plus the licence.
 *
 * CC BY 4.0 §3(a) wants the creator, a copyright notice, a licence notice with
 * a URI, and an indication that the material is modified — the Sentinel data
 * *is* modified (that is what "cloudless" means), so saying so is not optional.
 * Hence the anchors: a bare string cannot carry the licence URI, and Cesium's
 * Credit renders (sanitised) HTML precisely so it can.
 */
export function s2cloudlessAttribution(layer: string): string {
  const year = s2cloudlessYear(layer);
  const nc = s2cloudlessLicence(layer) === 'CC-BY-NC-SA-4.0';
  const licence = nc
    ? '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0 (non-commercial)</a>'
    : '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>';
  return (
    `<a href="https://s2maps.eu">Sentinel-2 cloudless ${year}</a> by EOX IT Services GmbH ` +
    `(contains modified Copernicus Sentinel data ${year}) — ${licence}`
  );
}

const s2cloudless = (root: string, layer: string) => () =>
  new Cesium.UrlTemplateImageryProvider({
    url: `${root}/${layer}/default/g/{z}/{y}/{x}.jpg`,
    // On screen: CC BY asks for attribution "in any reasonable manner for the
    // medium". For a full-bleed map the reasonable manner is the map itself,
    // not a collapsed panel behind a "Data attribution" click.
    credit: new Cesium.Credit(s2cloudlessAttribution(layer), true),
    // EOX's `g` tile matrix set is EPSG:900913 (Web Mercator) with a 1x1 root
    // and 256px tiles — the Cesium default geometry, but the tiling scheme
    // still has to be said or the {z}/{y}/{x} indices address 4326 tiles that
    // do not exist. Same trap as the Esri and Mapbox providers above.
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    // Sentinel-2 is 10 m/px; z14 is 9.55 m/px at the equator, so 14 is the last
    // level carrying real detail. The server answers z15+ (the matrix set
    // declares 21 levels) but only by upsampling, which costs 4x the requests
    // per level for pixels it invented. Capping here makes Cesium stretch one
    // real tile instead — same blur, a quarter of the traffic per level.
    maximumLevel: 14,
  });

// ---------------------------------------------------------------------------
// Open tier 2: NASA GIBS (date-aware)
// ---------------------------------------------------------------------------

/**
 * GIBS is the interesting one for a 4D product: every tile request carries a
 * date, so the ground under a memory can be the ground *on the day of the
 * memory* rather than a timeless mosaic.
 *
 * The EPSG:4326 endpoint is used rather than 3857 because its tile matrix sets
 * are a 2x1 root — exactly Cesium's GeographicTilingScheme — so no reprojection
 * and no tiling-scheme surprise. Tiles are 512px (checked in GetCapabilities);
 * saying 256 here would make Cesium's LOD maths refine a level too far, the
 * same four-times-the-tiles bug documented on the Mapbox provider above.
 */
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

/** Suomi-NPP VIIRS true colour: global, daily, 250 m — the "Earth today" layer. */
export const GIBS_DEFAULT_LAYER = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';

/** The `250m` matrix set has 9 levels, 0-8. Level 8 is ~250 m/px: coarse, and honest about it. */
const GIBS_MAX_LEVEL = 8;

/**
 * Two UTC days back, `YYYY-MM-DD`.
 *
 * Not "today": GIBS builds the current day's mosaic as the satellite flies, so
 * a request for today returns a half-empty Earth with a ragged edge where the
 * swaths stop, and the browser's idea of "today" can be a day either side of
 * UTC anyway. Two days back is always a complete global mosaic.
 *
 * Note there are still gaps in the archive (the layer's GetCapabilities lists
 * its available ranges, e.g. 2024-06-01..03 are simply missing). A missing day
 * answers with a blank tile rather than an error, so a date-scrubbing UI should
 * treat "grey Earth" as normal and not as a failure.
 */
export function gibsDefaultDate(now: Date = new Date()): string {
  const d = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * One interval per UTC day, each carrying the `Time` dimension GIBS wants.
 *
 * This is the optional date axis: hand the result plus the viewer's clock to
 * `create({ clock, times })` and Cesium re-requests imagery as the clock moves.
 * Bounded at ~30 years of days so a story with a nonsense date range cannot
 * allocate a million intervals.
 */
export function gibsDailyTimes(from: Date, to: Date): Cesium.TimeIntervalCollection {
  const DAY = 24 * 60 * 60 * 1000;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const days = Math.min(Math.max(Math.round((end - start) / DAY), 0), 11000);
  const intervals: Cesium.TimeInterval[] = [];
  for (let i = 0; i <= days; i += 1) {
    const dayStart = new Date(start + i * DAY);
    intervals.push(
      new Cesium.TimeInterval({
        start: Cesium.JulianDate.fromDate(dayStart),
        stop: Cesium.JulianDate.fromDate(new Date(start + (i + 1) * DAY)),
        isStopIncluded: false,
        data: { Time: dayStart.toISOString().slice(0, 10) },
      }),
    );
  }
  return new Cesium.TimeIntervalCollection(intervals);
}

/**
 * NASA GIBS/EOSDIS imagery is a US Government work: no copyright, no licence to
 * comply with. NASA nonetheless *ask* for the acknowledgement, and it costs
 * nothing to give it, so the credit is present — just not forced on screen the
 * way the CC BY and ODbL ones are, because there is no obligation behind it.
 */
const GIBS_CREDIT =
  'Imagery courtesy of <a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a> (public domain)';

const gibs = (layer: string, fallbackDate: string) => (opts: BasemapOptions = {}) => {
  // Cesium throws if exactly one of clock/times is present, and a viewer that
  // passes neither is the common case — so the pair is spread in or left out
  // wholesale, and the static date is only used when no clock is driving.
  const driven = Boolean(opts.clock && opts.times);
  return new Cesium.WebMapTileServiceImageryProvider({
    // The `{Time}` placeholder is filled from `dimensions` (or from the clock's
    // current interval when one is attached) — this is why GIBS is a
    // WebMapTileServiceImageryProvider and not a UrlTemplateImageryProvider
    // like everything else here: the URL-template provider has no dimension
    // support, so the date would be frozen at construction.
    url: `${GIBS_WMTS}/${layer}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
    layer,
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: '250m',
    tileWidth: 512,
    tileHeight: 512,
    maximumLevel: GIBS_MAX_LEVEL,
    tilingScheme: new Cesium.GeographicTilingScheme(),
    credit: new Cesium.Credit(GIBS_CREDIT, false),
    ...(driven
      ? { clock: opts.clock, times: opts.times }
      : { dimensions: { Time: opts.date ?? fallbackDate } }),
  });
};

// ---------------------------------------------------------------------------
// Open tier 3: OpenStreetMap raster
// ---------------------------------------------------------------------------

/**
 * The OSM Foundation's own tiles, which exist so that *developers* can get
 * going — their tile usage policy forbids heavy use, forbids bulk downloading,
 * and can block an origin without warning.
 *
 * So this default is a development convenience, and `VITE_OSM_TILE_URL` is the
 * thing a real deployment sets: its own `openstreetmap-tile-server` (or any
 * XYZ endpoint — Carto, Thunderforest, a self-hosted style). The template is
 * taken whole rather than assembled so `{s}` subdomains, `@2x` and `.jpg`
 * endpoints all work without a code change. `{s}` is expanded from `abc` when
 * the template contains it, and ignored when it does not.
 *
 * Cesium ships an `OpenStreetMapImageryProvider`, deliberately unused: it
 * hardcodes its own URL shape and credit, which is exactly the pair a
 * deployment needs to override.
 */
const OSM_DEFAULT_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * ODbL 1.0 requires attribution of the *data*, and the OSMF attribution
 * guidelines are explicit that the credit belongs on the map itself, with the
 * copyright page reachable — hence `showOnScreen: true` and the anchor.
 */
const OSM_CREDIT =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)';

const osm = (template: string) => () =>
  new Cesium.UrlTemplateImageryProvider({
    url: template,
    credit: new Cesium.Credit(OSM_CREDIT, true),
    subdomains: 'abc',
    // Standard OSM Carto renders to z19. Beyond that the tile server 404s, and
    // Cesium paints holes rather than stretching the parent tile.
    maximumLevel: 19,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
  });

// ---------------------------------------------------------------------------

/**
 * The whole picker, as a pure function of configuration.
 *
 * Exported for the tests — the module-level `BASEMAPS` is this applied to the
 * frozen `import.meta.env`, which is the only reason the env is threaded
 * through as an argument rather than read where it is used.
 */
export function buildBasemaps(env: ViteEnv = readEnv()): Basemap[] {
  const mapboxToken = setting(env, 'VITE_MAPBOX_TOKEN');
  const eoxRoot = setting(env, 'VITE_EOX_TILE_URL')?.replace(/\/+$/, '') ?? EOX_WMTS;
  const s2Layer = setting(env, 'VITE_EOX_S2_LAYER') ?? EOX_DEFAULT_LAYER;
  const gibsLayer = setting(env, 'VITE_GIBS_LAYER') ?? GIBS_DEFAULT_LAYER;
  const gibsDate = setting(env, 'VITE_GIBS_DATE') ?? gibsDefaultDate();
  const osmUrl = setting(env, 'VITE_OSM_TILE_URL') ?? OSM_DEFAULT_URL;

  return [
    {
      id: 'natural',
      label: 'Natural Earth',
      hint: 'Offline · always available',
      // No licence/attribution: it is Cesium's bundled asset, already credited
      // by Cesium itself, and no request leaves the machine to draw it.
    },
    {
      id: 'imagery',
      label: 'Satellite',
      hint: 'Esri World Imagery',
      licence: 'Esri terms of use',
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      create: esri(
        'World_Imagery',
        'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      ),
    },
    {
      id: 'streets',
      label: 'Streets',
      hint: 'Esri World Street Map',
      licence: 'Esri terms of use',
      attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
      create: esri('World_Street_Map', 'Esri, HERE, Garmin, © OpenStreetMap contributors'),
    },
    {
      id: 'terrain',
      label: 'Terrain',
      hint: 'Esri shaded relief',
      licence: 'Esri terms of use',
      attribution: 'Esri, USGS, NOAA',
      create: esri('World_Terrain_Base', 'Esri, USGS, NOAA'),
    },
    {
      id: 'dark',
      label: 'Dark',
      hint: 'Esri dark grey canvas',
      licence: 'Esri terms of use',
      attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
      create: esri(
        'Canvas/World_Dark_Gray_Base',
        'Esri, HERE, Garmin, © OpenStreetMap contributors',
      ),
    },
    // --- open tier: no key, no account, self-hostable ------------------------
    {
      id: 's2cloudless',
      label: 'Sentinel-2',
      hint: `Cloudless mosaic ${s2cloudlessYear(s2Layer)} · open`,
      licence: s2cloudlessLicence(s2Layer),
      attribution: s2cloudlessAttribution(s2Layer),
      create: s2cloudless(eoxRoot, s2Layer),
    },
    {
      id: 'gibs',
      label: 'Earth today',
      hint: 'NASA VIIRS · daily, 250 m',
      licence: 'Public domain (US Government work)',
      attribution: GIBS_CREDIT,
      create: gibs(gibsLayer, gibsDate),
    },
    {
      id: 'osm',
      label: 'OpenStreetMap',
      hint: 'Community streets · ODbL',
      licence: 'ODbL-1.0',
      attribution: OSM_CREDIT,
      create: osm(osmUrl),
    },
    // Appended, and only when a token exists. Offering a basemap that answers
    // every tile request with 401 is worse than not offering it — the globe would
    // just stop having ground under the pins with no way to tell why — and
    // appending means a missing token drops entries off the end of the picker
    // instead of reshuffling the ones people already know the position of.
    ...(mapboxToken
      ? ([
          {
            id: 'mapbox-satellite',
            label: 'Mapbox Satellite',
            hint: 'Sharper imagery, down to the street',
            licence: 'Mapbox ToS (metered)',
            attribution: '© Mapbox © OpenStreetMap © Maxar',
            create: mapbox(
              'v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90',
              '© Mapbox © OpenStreetMap © Maxar',
              mapboxToken,
            ),
          },
          {
            id: 'mapbox-outdoors',
            // Outdoors rather than Streets: on a globe you are usually looking at
            // ground, not at a junction. Streets renders that ground as near-white
            // paper, while Outdoors carries hillshade, landcover and contours, so
            // a memory pin sits on terrain you can recognise from orbit as well as
            // from a rooftop.
            label: 'Mapbox Outdoors',
            hint: 'Relief, contours & trails',
            licence: 'Mapbox ToS (metered)',
            attribution: '© Mapbox © OpenStreetMap',
            create: mapbox(
              'styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}',
              '© Mapbox © OpenStreetMap',
              mapboxToken,
            ),
          },
        ] satisfies Basemap[])
      : []),
  ];
}

export const BASEMAPS: Basemap[] = buildBasemaps();

/**
 * Default to satellite imagery, not the bundled offline raster.
 *
 * NaturalEarthII ships only two zoom levels, so it renders a recognisable Earth
 * from orbit and nothing at all once the camera drops to the few-hundred-km
 * altitude a memory pin is actually viewed from — the globe simply goes black,
 * which is the "looks broken" state this viewer shipped with. Esri's cache goes
 * to level 18, so there is real ground under a pin at every altitude. The
 * offline raster stays mounted underneath as the no-network floor.
 */
export const DEFAULT_BASEMAP = 'imagery';

/**
 * The entry that means "draw nothing on top of the mounted base layer". Held as
 * a constant because the degradation order below has to end somewhere that
 * always exists, and this is the only entry that needs no network at all.
 */
export const OFFLINE_BASEMAP = 'natural';

/**
 * Which basemap to actually draw for a requested id — never undefined, never a
 * blank globe.
 *
 * The caller's id can be stale in ways that are nobody's fault: it is persisted
 * across sessions and comes back after a deployment dropped `VITE_MAPBOX_TOKEN`
 * or renamed a layer, and `BASEMAPS.find(...)` then answers `undefined`. The
 * viewer reads that as "no overlay", which silently leaves the globe on the
 * two-level offline raster — the exact unreadable state the rest of this file
 * exists to avoid, with nothing on screen to explain it.
 *
 * Degradation order, defined once here rather than at each call site:
 *
 *   1. the requested id, if the list still has it;
 *   2. `DEFAULT_BASEMAP` (keyless Esri imagery, always in the list);
 *   3. the first entry that can draw anything at all;
 *   4. the offline entry — no network, always available, always pickable.
 */
export function resolveBasemap(id: string | undefined, list: Basemap[] = BASEMAPS): Basemap {
  const offline: Basemap = list.find((b) => !b.create) ?? {
    id: OFFLINE_BASEMAP,
    label: 'Natural Earth',
    hint: 'Offline · always available',
  };
  if (!id) return list.find((b) => b.id === DEFAULT_BASEMAP) ?? offline;
  return (
    list.find((b) => b.id === id) ??
    list.find((b) => b.id === DEFAULT_BASEMAP) ??
    list.find((b) => b.create) ??
    offline
  );
}

/**
 * Cesium's bundled offline raster. Only reached when the network is unavailable
 * — it is the "something rather than nothing" case, not a basemap choice.
 */
export async function offlineImagery(): Promise<Cesium.ImageryProvider> {
  return Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
  );
}
