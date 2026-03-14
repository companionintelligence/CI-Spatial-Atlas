import * as THREE from 'three';

/**
 * Cesium ION terrain tiles system.
 *
 * Uses dynamic imports so the 3d-tiles-renderer chunk loads asynchronously
 * and cannot break the main bundle if the module or token is unavailable.
 */

declare const __CESIUM_ION_TOKEN__: string;

export interface TilesSystem {
  group: THREE.Group;
  update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

// ECEF → Three.js axis remap + scale matrix
function buildEcefToThreeMatrix(scale: number): THREE.Matrix4 {
  // Swap axes: ThreeX=ECEFX, ThreeY=ECEFZ, ThreeZ=ECEFY
  return new THREE.Matrix4().set(
    scale, 0, 0, 0,
    0, 0, scale, 0,
    0, scale, 0, 0,
    0, 0, 0, 1
  );
}

export async function initTilesSystem(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  globeRadius: number
): Promise<TilesSystem | null> {
  const token = __CESIUM_ION_TOKEN__;

  if (!token) {
    console.info('[tiles] CESIUM_ION_TOKEN not set — terrain tiles disabled.');
    return null;
  }

  try {
    const [{ TilesRenderer }, { CesiumIonAuthPlugin }] = await Promise.all([
      import('3d-tiles-renderer'),
      import('3d-tiles-renderer/three/plugins')
    ]);

    const tiles = new TilesRenderer();
    tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId: '1' }));

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);

    // Apply coordinate transform
    const scale = globeRadius / 6_371_000;
    const transform = buildEcefToThreeMatrix(scale);
    tiles.group.applyMatrix4(transform);

    scene.add(tiles.group);

    console.info('[tiles] Cesium World Terrain tiles initialised ✓');

    return {
      group: tiles.group,
      update(cam: THREE.PerspectiveCamera, rend: THREE.WebGLRenderer): void {
        tiles.setCamera(cam);
        tiles.setResolutionFromRenderer(cam, rend);
        tiles.update();
      },
      dispose(): void {
        tiles.dispose();
        scene.remove(tiles.group);
      }
    };
  } catch (err) {
    console.warn('[tiles] Failed to initialise Cesium tiles:', err);
    return null;
  }
}
