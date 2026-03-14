import * as THREE from 'three';

/**
 * 3D Tiles system — NASA-AMMOS 3DTilesRendererJS (npm: 3d-tiles-renderer).
 *
 * Provider priority:
 *   1. Google Photorealistic 3D Tiles — full globe terrain + buildings + trees.
 *      Uses GoogleCloudAuthPlugin with the GOOGLE_MAP_PLATFORM key.
 *   2. Cesium ION World Terrain (asset 1) — elevation surface mesh.
 *      Uses CesiumIonAuthPlugin with the CESIUM_ION_TOKEN.
 *   3. Disabled — when neither key is present.
 *
 * Key fixes vs naïve approach:
 *   - camera.updateMatrixWorld() called each frame before tiles.update().
 *   - ECEF→Three.js axis remap + globeRadius scale applied to tiles.group.
 *   - GLTFExtensionsPlugin for Cesium RTC and structural metadata.
 *   - TilesFadePlugin for smooth LOD transitions.
 *   - data-tiles attribute on viewportEl for Playwright status detection.
 *
 * All imports are dynamic so this chunk loads lazily and never breaks the
 * main bundle when the 3d-tiles-renderer is unavailable.
 */

declare const __CESIUM_ION_TOKEN__: string;
declare const __GOOGLE_MAP_PLATFORM__: string;

const EARTH_RADIUS_M = 6_371_000;

export interface TilesSystem {
  group: THREE.Group;
  update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

/**
 * ECEF → Three.js coordinate transform matrix.
 *
 * Mapping (right-handed → right-handed):
 *   ECEF_X (equator/prime meridian) → Three.X
 *   ECEF_Y (equator/90°E)           → Three.Z  (depth)
 *   ECEF_Z (north pole)             → Three.Y  (up)
 *
 * Scale brings ECEF metres into our normalised globe units.
 */
function buildEcefToThreeMatrix(globeRadius: number): THREE.Matrix4 {
  const s = globeRadius / EARTH_RADIUS_M;
  return new THREE.Matrix4().set(
    s, 0, 0, 0,
    0, 0, s, 0,
    0, s, 0, 0,
    0, 0, 0, 1
  );
}

function setTilesStatus(el: HTMLElement | null, status: string): void {
  el?.setAttribute('data-tiles', status);
}

export async function initTilesSystem(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  globeRadius: number,
  viewportEl: HTMLElement | null = null
): Promise<TilesSystem | null> {
  // Resolve build-time tokens defensively (may be empty string if unset).
  const googleKey   = typeof __GOOGLE_MAP_PLATFORM__ !== 'undefined' ? __GOOGLE_MAP_PLATFORM__ : '';
  const cesiumToken = typeof __CESIUM_ION_TOKEN__    !== 'undefined' ? __CESIUM_ION_TOKEN__    : '';

  const provider = googleKey ? 'google' : cesiumToken ? 'cesium' : null;

  if (!provider) {
    console.info('[tiles] No API token — 3D tiles disabled.');
    setTilesStatus(viewportEl, 'disabled');
    return null;
  }

  setTilesStatus(viewportEl, 'loading');

  try {
    // Dynamic import keeps the 3d-tiles-renderer code in its own lazy chunk.
    const [
      { TilesRenderer },
      { CesiumIonAuthPlugin, GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TilesFadePlugin }
    ] = await Promise.all([
      import('3d-tiles-renderer'),
      import('3d-tiles-renderer/three/plugins')
    ]);

    const tiles = new TilesRenderer();

    if (provider === 'google') {
      // null sessionOptions → Google Photorealistic 3D Tiles (terrain + buildings).
      tiles.registerPlugin(new GoogleCloudAuthPlugin({
        apiToken: googleKey,
        autoRefreshToken: true,
        useRecommendedSettings: true
      }));
      console.info('[tiles] Google Photorealistic 3D Tiles initialising…');
    } else {
      // Cesium ION asset 1 = World Terrain (elevation mesh, no buildings).
      tiles.registerPlugin(new CesiumIonAuthPlugin({
        apiToken: cesiumToken,
        assetId: '1',
        autoRefreshToken: true
      }));
      console.info('[tiles] Cesium ION World Terrain initialising…');
    }

    // GLTF extension support: Cesium RTC transform, structural metadata, mesh features.
    tiles.registerPlugin(new GLTFExtensionsPlugin({ rtc: true }));

    // Smooth LOD fade transitions between tile detail levels.
    tiles.registerPlugin(new TilesFadePlugin());

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);

    // Apply ECEF → Three.js coordinate transform to translate and scale the
    // tile geometry so it aligns with our normalised globe sphere.
    const ecefToThree = buildEcefToThreeMatrix(globeRadius);
    tiles.group.matrix.copy(ecefToThree);
    tiles.group.matrixAutoUpdate = false;

    // Status hooks for Playwright test detection.
    tiles.addEventListener('load-root-tileset', () => {
      console.info(`[tiles] Root tileset loaded ✓  (${provider})`);
    });
    tiles.addEventListener('load-model', () => {
      setTilesStatus(viewportEl, 'active');
    });
    tiles.addEventListener('error', (e: unknown) => {
      console.warn('[tiles] Tile load error:', e);
      setTilesStatus(viewportEl, 'error');
    });

    scene.add(tiles.group);

    return {
      group: tiles.group,
      update(cam: THREE.PerspectiveCamera, rend: THREE.WebGLRenderer): void {
        // updateMatrixWorld() is required by the tiles renderer before each
        // update call — without it, frustum culling and LOD are incorrect.
        cam.updateMatrixWorld();
        tiles.setCamera(cam);
        tiles.setResolutionFromRenderer(cam, rend);
        tiles.update();
      },
      dispose(): void {
        tiles.dispose();
        scene.remove(tiles.group);
        setTilesStatus(viewportEl, 'disabled');
      }
    };
  } catch (err) {
    console.warn('[tiles] Failed to initialise 3D tiles:', err);
    setTilesStatus(viewportEl, 'error');
    return null;
  }
}
