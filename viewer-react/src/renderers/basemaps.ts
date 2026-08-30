import * as Cesium from 'cesium';

/**
 * Basemaps Atlas can draw without a Cesium ion token.
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
 * The Esri set is keyless and always present. Mapbox is added on top of it only
 * when `VITE_MAPBOX_TOKEN` is configured — it is the sharper imagery and the
 * only relief-shaded option here, but it is a metered account, so it appears in
 * the picker exactly when it can actually draw.
 */
export interface Basemap {
  id: string;
  label: string;
  /** Shown in the layer switcher under the label. */
  hint: string;
  /**
   * Absent for the offline entry: it is the layer the globe already mounts
   * with, so selecting it means "remove any overlay", not "add one".
   */
  create?: () => Cesium.ImageryProvider;
}

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

const mapboxToken = (): string | undefined => {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const t = env.VITE_MAPBOX_TOKEN?.trim();
  return t ? t : undefined;
};

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
const mapbox = (path: string, credit: string) => () =>
  new Cesium.UrlTemplateImageryProvider({
    url: `https://api.mapbox.com/${path}?access_token=${mapboxToken() ?? ''}`,
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

export const BASEMAPS: Basemap[] = [
  {
    id: 'natural',
    label: 'Natural Earth',
    hint: 'Offline · always available',
  },
  {
    id: 'imagery',
    label: 'Satellite',
    hint: 'Esri World Imagery',
    create: esri(
      'World_Imagery',
      'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    ),
  },
  {
    id: 'streets',
    label: 'Streets',
    hint: 'Esri World Street Map',
    create: esri('World_Street_Map', 'Esri, HERE, Garmin, © OpenStreetMap contributors'),
  },
  {
    id: 'terrain',
    label: 'Terrain',
    hint: 'Esri shaded relief',
    create: esri('World_Terrain_Base', 'Esri, USGS, NOAA'),
  },
  {
    id: 'dark',
    label: 'Dark',
    hint: 'Esri dark grey canvas',
    create: esri('Canvas/World_Dark_Gray_Base', 'Esri, HERE, Garmin, © OpenStreetMap contributors'),
  },
  // Appended, and only when a token exists. Offering a basemap that answers
  // every tile request with 401 is worse than not offering it — the globe would
  // just stop having ground under the pins with no way to tell why — and
  // appending means a missing token drops entries off the end of the picker
  // instead of reshuffling the ones people already know the position of.
  ...(mapboxToken()
    ? ([
        {
          id: 'mapbox-satellite',
          label: 'Mapbox Satellite',
          hint: 'Sharper imagery, down to the street',
          create: mapbox(
            'v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90',
            '© Mapbox © OpenStreetMap © Maxar',
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
          create: mapbox(
            'styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}',
            '© Mapbox © OpenStreetMap',
          ),
        },
      ] satisfies Basemap[])
    : []),
];

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
 * Cesium's bundled offline raster. Only reached when the network is unavailable
 * — it is the "something rather than nothing" case, not a basemap choice.
 */
export async function offlineImagery(): Promise<Cesium.ImageryProvider> {
  return Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
  );
}
