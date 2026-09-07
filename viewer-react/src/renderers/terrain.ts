import * as Cesium from 'cesium';
import type { ViteEnv } from './basemaps.js';

/**
 * Where the globe's *height* comes from, with an open option that needs no
 * account.
 *
 * Imagery has keyless alternatives everywhere (see `basemaps.ts`); terrain does
 * not, because Cesium will only read one wire format — quantized-mesh-1.0 — and
 * nobody publishes a free global quantized-mesh service. Cesium ion's World
 * Terrain is the only turnkey one, and it is an account. So the open path here
 * is necessarily "point at a tileset you built and host yourself", which is why
 * the source is a URL rather than a provider name: a deployment that has built
 * one sets `VITE_TERRAIN_URL` and changes no code.
 *
 * ## What a self-hosted tileset has to be
 *
 * Source data, both free and global:
 *
 *   - **Copernicus DEM GLO-30** (30 m, global, the best free DEM there is).
 *     Free with attribution; the notice is long and belongs to the DEM, not to
 *     us, which is why `VITE_TERRAIN_CREDIT` exists — the deployment that
 *     chooses the DEM is the one that knows what its licence demands. For
 *     GLO-30 that is roughly: "© DLR e.V. 2010-2014 and © Airbus Defence and
 *     Space GmbH 2014-2018 provided under COPERNICUS by the European Union and
 *     ESA; all rights reserved."
 *   - **SRTM 1-arcsecond** (30 m, 60°N-56°S, NASA/USGS, public domain) — no
 *     obligation, but no coverage above the Arctic circle either.
 *
 * Tiling, with `cesium-terrain-builder` (`ctb-tile`) or one of its
 * quantized-mesh forks. The three things that actually decide whether Cesium
 * can read the result:
 *
 *   - **Output format must be the mesh one**, not the legacy heightmap: Cesium
 *     1.143 reads `quantized-mesh-1.0`. `layer.json` at the tileset root must
 *     declare `"format": "quantized-mesh-1.0"`, `"scheme": "tms"`, and the
 *     `available` ranges; CTB will not write `layer.json` as a side effect of
 *     tiling — it is a separate invocation (see the tool's `--help`; the flag
 *     differs between upstream CTB and the quantized-mesh fork).
 *   - **TMS row order.** Tiles are `{z}/{x}/{y}.terrain` with `y` counted from
 *     the *south*, the opposite of the XYZ/slippy convention every imagery URL
 *     in `basemaps.ts` uses. Serving a correctly built tileset through a
 *     y-flipping proxy produces terrain that loads without error and puts the
 *     mountains in the sea.
 *   - **Transfer encoding.** CTB writes the `.terrain` files gzipped. The
 *     server must send `Content-Encoding: gzip` for them (and must not gzip
 *     them a second time); without the header the browser hands Cesium the
 *     compressed bytes and every tile fails to parse.
 *
 * And two that bite later:
 *
 *   - **CORS.** These are XHRs from the viewer's origin, so the tile host needs
 *     `Access-Control-Allow-Origin`. Terrain that works when opened directly
 *     and fails in the app is almost always this.
 *   - **Vertical datum.** Copernicus DEM heights are orthometric (above the
 *     EGM2008 geoid); Cesium terrain heights are above the WGS84 ellipsoid. Tile
 *     the DEM raw and the ground sits up to ~85 m off vertically, worst around
 *     the Indian Ocean geoid low and the North Atlantic high — enough to sink a
 *     coastal memory pin under the sea. Convert first (e.g. `gdalwarp` through
 *     the EGM2008 geoid grid) rather than after anyone notices.
 *
 * Vertex normals are requested but not required: CTB does not generate the
 * `octvertexnormals` extension, and Cesium simply does not ask for it when
 * `layer.json` does not advertise it. The tileset still draws — it just cannot
 * be lit by the terrain normals, so the day/night terminator looks flatter over
 * self-hosted terrain than over ion's.
 */

/** Cesium ships a short-lived shared JWT; `main.tsx` clears it. Matches the viewer's own check. */
const PLACEHOLDER_TOKEN = 'your_cesium_ion_token_here';

const readEnv = (): ViteEnv => (import.meta as unknown as { env?: ViteEnv }).env ?? {};

const setting = (env: ViteEnv, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

export type TerrainSource = 'self-hosted' | 'ion' | 'ellipsoid';

export interface TerrainChoice {
  provider: Cesium.TerrainProvider;
  source: TerrainSource;
  /** One line for the log and for the layer panel's hint. */
  detail: string;
}

/** The configured open tileset root, or undefined. Exported so a UI can say whether one exists. */
export function openTerrainUrl(env: ViteEnv = readEnv()): string | undefined {
  return setting(env, 'VITE_TERRAIN_URL');
}

/**
 * Attribution for the self-hosted DEM, if the deployment declared one.
 *
 * Deliberately not defaulted: we cannot know which DEM someone tiled, and
 * inventing a credit is worse than showing none — it would attribute the wrong
 * data to the wrong people. Shown on screen, because every free global DEM
 * worth using (Copernicus certainly) requires the notice.
 */
export function terrainCredit(env: ViteEnv = readEnv()): string | undefined {
  return setting(env, 'VITE_TERRAIN_CREDIT');
}

const hasIonToken = (): boolean => {
  const token = Cesium.Ion.defaultAccessToken;
  return Boolean(token) && token !== PLACEHOLDER_TOKEN;
};

/**
 * Terrain never fails the globe.
 *
 * Every branch below resolves, including the ones that throw internally: a
 * terrain provider that cannot load is a globe with no height, which is exactly
 * what `EllipsoidTerrainProvider` is — a legitimate, instantaneous, offline
 * answer. There is nothing to be gained by propagating the failure to a caller
 * whose only sane response would be to substitute the same fallback.
 *
 * Degradation order:
 *
 *   1. `VITE_TERRAIN_URL` — the deployment's own quantized-mesh tileset;
 *   2. Cesium ion World Terrain, when an ion token is configured;
 *   3. the smooth ellipsoid: no request, no dependency, always draws.
 *
 * `timeoutMs` matches the viewer's existing 8 s ion budget. Both remote paths
 * fetch `layer.json` before resolving, so a tile host that accepts the
 * connection and then stalls would otherwise hold the globe flat and empty
 * forever with nothing logged.
 */
export async function createTerrain(
  opts: { env?: ViteEnv; timeoutMs?: number } = {},
): Promise<TerrainChoice> {
  const env = opts.env ?? readEnv();
  const timeoutMs = opts.timeoutMs ?? 8000;

  const withTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs),
      ),
    ]);

  const ellipsoid = (): TerrainChoice => ({
    provider: new Cesium.EllipsoidTerrainProvider(),
    source: 'ellipsoid',
    detail: 'Smooth ellipsoid — no terrain heights',
  });

  const url = openTerrainUrl(env);
  if (url) {
    try {
      const credit = terrainCredit(env);
      const provider = await withTimeout(
        Cesium.CesiumTerrainProvider.fromUrl(url, {
          // Asked for, not required — see the header note. Cesium only sends
          // the extension header when layer.json advertises it.
          requestVertexNormals: true,
          // Not asked for: the water mask is another per-tile payload, CTB does
          // not produce one, and Atlas does not render reflective water.
          requestWaterMask: false,
          ...(credit ? { credit: new Cesium.Credit(credit, true) } : {}),
        }),
        'terrain',
      );
      return { provider, source: 'self-hosted', detail: `Self-hosted terrain — ${url}` };
    } catch (e) {
      // Loud, unlike the imagery fallbacks: an operator who configured a
      // terrain URL wants to know it did not load, and the only other symptom
      // is a globe that looks subtly flat.
      console.warn('[terrain] VITE_TERRAIN_URL failed to load, falling back', e);
    }
  }

  if (hasIonToken()) {
    try {
      const provider = await withTimeout(Cesium.createWorldTerrainAsync(), 'ion terrain');
      return { provider, source: 'ion', detail: 'Cesium ion World Terrain' };
    } catch {
      // Silent: no ion terrain is the pre-existing, documented state of this
      // app on a machine with no token or no network.
    }
  }

  return ellipsoid();
}
