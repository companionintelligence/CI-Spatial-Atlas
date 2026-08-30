import { defineConfig, loadEnv } from 'vite';

// Cesium ships its Workers/ThirdParty/Assets/Widgets as static files that
// must be served from a known base URL at runtime (Cesium reads the global
// `CESIUM_BASE_URL` to resolve them). scripts/copy-cesium-assets.ts copies
// them into public/cesium/, which Vite serves natively in dev and build —
// see src/cesium/cesiumScene.ts and that script's header comment for why
// this is a plain file copy rather than a static-copy plugin.
const CESIUM_BASE_URL = '/cesium/';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      port: Number(process.env.PORT) || 5173
    },
    define: {
      __CESIUM_ION_TOKEN__: JSON.stringify(env.CESIUM_ION_TOKEN ?? ''),
      __GOOGLE_MAP_PLATFORM__: JSON.stringify(env.GOOGLE_MAP_PLATFORM ?? ''),
      __MAPBOX_API_KEY__: JSON.stringify(env.MAPBOX_API_KEY ?? ''),
      __ESRI_API_KEY__: JSON.stringify(env.ESRI_API_KEY ?? ''),
      __ESRI_API_ID__: JSON.stringify(env.ESRI_API_ID ?? ''),
      CESIUM_BASE_URL: JSON.stringify(CESIUM_BASE_URL)
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Cesium's actual source lives in its @cesium/* sub-packages
            // (engine, widgets); the top-level `cesium` package just re-exports.
            if (id.includes('/node_modules/cesium/') || id.includes('/node_modules/@cesium/')) {
              return 'cesium';
            }

            if (id.includes('/node_modules/three/')) {
              return 'three';
            }

            if (id.includes('/node_modules/3d-tiles-renderer')) {
              return 'tiles';
            }

            if (id.includes('/node_modules/')) {
              return 'vendor';
            }

            return undefined;
          }
        }
      }
    }
  };
});