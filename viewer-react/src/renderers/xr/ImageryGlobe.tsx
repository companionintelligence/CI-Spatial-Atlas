/**
 * Real imagery on the immersive globe, streamed as 3D Tiles.
 *
 * Two sources, both real, chosen by `?tiles=`:
 *
 *  - **Esri World Imagery** (`esri`) through `XYZTilesPlugin` in ellipsoid mode,
 *    which turns an ordinary slippy-tile pyramid into a WGS84 globe with proper
 *    LOD. Keyless, and the same source the Cesium renderer's "Satellite"
 *    basemap uses (`basemaps.ts`), so both renderers show the same Earth.
 *  - **Google Photorealistic 3D Tiles** (`google`) when a Maps Platform key is
 *    configured — actual 3D geometry, which is what makes leaning in over a
 *    memory feel like Earth VR rather than a textured ball.
 *
 * `auto` (the default) prefers Google when a key exists and falls back to Esri
 * if that tileset fails to load, because a globe that silently renders nothing
 * is indistinguishable from a broken app — and the Maps Tiles API is a separate
 * enablement from the other Maps products this key is used for.
 *
 * Attribution is not optional for either source. Both are third-party imagery
 * whose terms require the credit, and in a headset there is no DOM to put it
 * in, so the attributions are lifted out to the caller to render in-scene.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackSide, Color, DoubleSide } from 'three';
import { TilesPlugin, TilesRenderer } from '3d-tiles-renderer/r3f';
import { GoogleCloudAuthPlugin, TileCompressionPlugin, TilesFadePlugin, XYZTilesPlugin } from '3d-tiles-renderer/plugins';
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three';
import { EARTH_RADIUS_M } from './worldTransform.js';

/** WGS84 polar radius over equatorial radius — the ellipsoid's flattening. */
const POLAR_RATIO = 6_356_752.314245 / 6_378_137;

const ESRI_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
/** Esri's World Imagery cache tops out here; asking beyond it only 404s. */
const ESRI_MAX_LEVEL = 18;

export type TileSource = 'esri' | 'google';

export interface ImageryGlobeProps {
  source: TileSource;
  /**
   * Screen-space error to aim for, in pixels. Higher is coarser: a headset
   * renders the scene twice at a high framerate, so the desktop-grade default
   * of ~6 buys detail nobody can hold still enough to see.
   */
  errorTarget?: number;
  onAttributions?: (lines: string[]) => void;
  /** Called when the chosen source cannot load, so the caller can fall back. */
  onFailed?: (source: TileSource) => void;
}

/**
 * The solid body of the planet, under the tiles.
 *
 * Tiles stream in over seconds; without this the globe is a scattering of
 * disconnected patches over empty space for the whole of that time, and you can
 * see straight through to pins on the far side.
 *
 * The 1% inset is not arbitrary. A raster tile is a subdivided plane pushed out
 * onto the ellipsoid, and its latitude rows are coarse — 15 spans across a
 * level-1 tile, so the surface chords dip ~7.9 km below true radius between
 * rows. At 0.999 the body sits 6.4 km down and punches through those dips as a
 * lattice of dark triangles across the imagery. 0.99 clears it with room to
 * spare and is still invisible from orbit and 64 km underfoot at street level.
 */
function GlobeBody() {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, POLAR_RATIO, 1]}>
      <sphereGeometry args={[EARTH_RADIUS_M * 0.99, 64, 32]} />
      <meshBasicMaterial color="#062434" side={DoubleSide} />
    </mesh>
  );
}

/**
 * A thin shell of atmosphere. Physically it is a rim term — brightest where the
 * line of sight grazes the limb — which reads as the blue edge from orbit and
 * as horizon haze from the ground, from the same six lines.
 */
function Atmosphere() {
  const uniforms = useMemo(() => ({ uColor: { value: new Color('#7fd4e8') } }), []);
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, POLAR_RATIO, 1]} renderOrder={2}>
      <sphereGeometry args={[EARTH_RADIUS_M * 1.02, 48, 24]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={BackSide}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = -mv.xyz;
            vNormal = normalMatrix * normal;
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={`
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float grazing = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
            gl_FragColor = vec4(uColor, pow(grazing, 3.0) * 0.9);
          }
        `}
      />
    </mesh>
  );
}

/** Pull the human-readable credits off a tile set as it loads. */
function useAttributions(onAttributions: ((lines: string[]) => void) | undefined, extra: string[]) {
  const [tiles, setTiles] = useState<TilesRendererImpl | null>(null);

  useEffect(() => {
    if (!onAttributions) return;
    const publish = () => {
      const lines = tiles
        ? tiles
            .getAttributions()
            .filter((a) => a.type === 'string' && a.value)
            .map((a) => String(a.value))
        : [];
      onAttributions([...extra, ...lines]);
    };
    publish();
    if (!tiles) return;
    tiles.addEventListener('load-tileset', publish);
    return () => tiles.removeEventListener('load-tileset', publish);
    // `extra` is a literal array from the caller; depending on its contents
    // rather than its identity keeps this from re-subscribing every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, onAttributions, extra.join('|')]);

  return setTiles;
}

export function ImageryGlobe({ source, errorTarget = 8, onAttributions, onFailed }: ImageryGlobeProps) {
  const google = source === 'google';
  const setTiles = useAttributions(onAttributions, google ? ['Imagery © Google'] : [ESRI_CREDIT]);

  // A single failed tile is normal — a request is cancelled the moment the
  // viewer turns away from it. What is worth falling back over is a source that
  // never delivers anything at all, so count errors against successes and only
  // give up while the count of successes is still zero.
  const health = useRef({ errors: 0, loaded: 0 });
  useEffect(() => {
    health.current = { errors: 0, loaded: 0 };
  }, [source]);
  const onLoadError = useCallback(() => {
    health.current.errors += 1;
    if (health.current.loaded === 0 && health.current.errors >= 3) onFailed?.(source);
  }, [onFailed, source]);
  const onLoadContent = useCallback(() => {
    health.current.loaded += 1;
  }, []);

  // These have to be referentially stable. `<TilesPlugin>` compares `args` one
  // level deep, so a fresh `[{ … }]` literal counts as a change and the plugin
  // is torn down and rebuilt on every render of this component. The rebuilt
  // instance never gets `loadRootTileset` again — the tile set is already
  // loaded — so it comes up with no tiling scheme and every tile fetch dies in
  // `getTileBounds`. The globe stays empty and nothing says why.
  const esriArgs = useMemo(
    () => [
      {
        levels: ESRI_MAX_LEVEL,
        shape: 'ellipsoid' as const,
        // The plugin's "recommended" preset pins errorTarget to 1, which is a
        // desktop map viewer's budget, not a headset's.
        useRecommendedSettings: false,
      },
    ],
    [],
  );
  const googleArgs = useMemo(() => [{ apiToken: googleApiKey() ?? '', autoRefreshToken: true }], []);

  return (
    <>
      <GlobeBody />
      {google ? (
        <TilesRenderer
          key="google"
          ref={setTiles}
          errorTarget={errorTarget}
          onLoadError={onLoadError}
          onLoadContent={onLoadContent}
        >
          <TilesPlugin plugin={GoogleCloudAuthPlugin} args={googleArgs} />
          {/* Google's tiles arrive as uncompressed glTF; packing the attributes
              on load is the difference between a comfortable frame budget and
              a stuttering one on standalone headsets. */}
          <TilesPlugin plugin={TileCompressionPlugin} />
          <TilesPlugin plugin={TilesFadePlugin} />
        </TilesRenderer>
      ) : (
        <TilesRenderer
          key="esri"
          ref={setTiles}
          url={ESRI_URL}
          errorTarget={errorTarget}
          onLoadError={onLoadError}
          onLoadContent={onLoadContent}
        >
          <TilesPlugin plugin={XYZTilesPlugin} args={esriArgs} />
        </TilesRenderer>
      )}
      <Atmosphere />
    </>
  );
}

/** The Maps Platform key, if one is configured. Never logged, never rendered. */
export function googleApiKey(): string | undefined {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  return env.VITE_GOOGLE_MAPS_API_KEY || undefined;
}

/** Resolve `?tiles=` against what is actually configured. */
export function initialTileSource(): TileSource {
  const wanted = new URLSearchParams(window.location.search).get('tiles');
  if (wanted === 'esri' || wanted === 'google') return wanted === 'google' && !googleApiKey() ? 'esri' : wanted;
  return googleApiKey() ? 'google' : 'esri';
}
