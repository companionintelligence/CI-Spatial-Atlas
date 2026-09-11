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
 * How long a level-zero terrain tile may hang before we call the tileset dead.
 *
 * Deliberately its own number, not the handshake budget below. A level-zero
 * quantized-mesh tile is a few kilobytes, so ten seconds is already an order of
 * magnitude more than a bad mobile connection needs; and the two outcomes are
 * not symmetric. Being wrong (timing out a tile that would have arrived) costs
 * the session its terrain heights and logs loudly — the app's own documented
 * no-token state. Being right too late costs a black planet, because the
 * failure this guards is not a slow globe, it is no globe at all.
 *
 * Note the retry in `watchTerrainFailure` (CesiumStoryViewer) doubles it: the
 * first stall buys a re-request, so the true worst case before the ellipsoid
 * appears is ~20 s.
 */
const ROOT_TILE_TIMEOUT_MS = 10_000;

/**
 * Make a stalled root tile *reject*, because the black-globe fallback can only
 * see rejections.
 *
 * `watchTerrainFailure` in CesiumStoryViewer swaps in the ellipsoid when a
 * level-zero tile fails, and Cesium only tells it about a failure through
 * `terrainProvider.errorEvent`. Follow the chain in Cesium's
 * `GlobeSurfaceTile.requestTileGeometry`: the tile goes to
 * `TerrainState.RECEIVING`, and only the promise's `.catch` runs `failure()`,
 * which is the sole caller of `TileProviderError.reportError` for terrain. A
 * host that accepts the connection and then answers nothing — a blackholed
 * route, a stalled CDN, a captive portal swallowing the request — never
 * rejects. Cesium's `Resource` XHR sets no `timeout`, and `RequestScheduler`
 * imposes none either, so the promise simply stays pending: no error event, no
 * fallback, and the roots are the tiles that cannot be upsampled or fill-meshed
 * around, so the globe draws no surface at all. The 8 s budget in
 * `createTerrain` does not cover this — it wraps only the `layer.json`
 * handshake, which such a host completes perfectly well.
 *
 * So: give the root tiles the timeout the transport does not have, and let the
 * rejection travel the path that already works.
 *
 *   - **Level zero only.** Deeper tiles upsample from a parent or take a
 *     neighbour's fill mesh — a globe with a coarse patch still draws — and a
 *     tile Cesium marks FAILED there is not re-requested. Timing those out
 *     would trade an invisible delay for permanent local damage, which is the
 *     same trade `watchTerrainFailure` refuses when it ignores level > 0.
 *   - **`undefined` passes straight through.** That is Cesium's "the scheduler
 *     deferred this request, ask again next frame", not a request in flight;
 *     starting a clock on it would time out tiles that were never sent.
 *   - **The stalled request is not cancelled.** `request.cancel()` would make
 *     Cesium's `failure()` treat the tile as CANCELLED and quietly return it to
 *     UNLOADED without reporting anything — the tile would be re-requested,
 *     stall again, and loop forever with the same black globe. Leaking one
 *     pending XHR until the browser's own socket timeout is the cheaper half of
 *     that trade.
 *
 * Exported for the test suite, which drives it with a stub provider: there is
 * no globe, no WebGL context and no network in a unit test.
 */
export function guardRootTileStalls<P extends Cesium.TerrainProvider>(
  provider: P,
  timeoutMs: number = ROOT_TILE_TIMEOUT_MS,
): P {
  const inner = provider.requestTileGeometry.bind(provider);
  provider.requestTileGeometry = (x, y, level, request) => {
    const pending = inner(x, y, level, request);
    if (!pending || level !== 0) return pending;
    return new Promise<Cesium.TerrainData>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`terrain root tile ${x}/${y} stalled after ${timeoutMs} ms`)),
        timeoutMs,
      );
      pending.then(
        (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  };
  return provider;
}

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
 *
 * That budget covers the *handshake* only. A host can complete it and then
 * stall on the tiles themselves, which is the worse failure — no `layer.json`
 * means a flat globe, no root tiles means no globe — so both remote providers
 * leave here wrapped in `guardRootTileStalls`, which gives level-zero tile
 * requests the timeout the transport does not have.
 */
export async function createTerrain(
  opts: { env?: ViteEnv; timeoutMs?: number; rootTileTimeoutMs?: number } = {},
): Promise<TerrainChoice> {
  const env = opts.env ?? readEnv();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const rootTileTimeoutMs = opts.rootTileTimeoutMs ?? ROOT_TILE_TIMEOUT_MS;

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
      return {
        provider: guardRootTileStalls(provider, rootTileTimeoutMs),
        source: 'self-hosted',
        detail: `Self-hosted terrain — ${url}`,
      };
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
      // ion is a CDN, not an exception: a stalled edge node produces the same
      // black planet as a stalled self-hosted host, and nothing about an
      // account makes the request settle.
      return {
        provider: guardRootTileStalls(provider, rootTileTimeoutMs),
        source: 'ion',
        detail: 'Cesium ion World Terrain',
      };
    } catch {
      // Silent: no ion terrain is the pre-existing, documented state of this
      // app on a machine with no token or no network.
    }
  }

  return ellipsoid();
}
