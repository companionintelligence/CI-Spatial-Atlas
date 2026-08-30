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
