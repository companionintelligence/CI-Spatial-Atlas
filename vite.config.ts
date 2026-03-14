import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      __CESIUM_ION_TOKEN__: JSON.stringify(env.CESIUM_ION_TOKEN ?? ''),
      __GOOGLE_MAP_PLATFORM__: JSON.stringify(env.GOOGLE_MAP_PLATFORM ?? ''),
      __MAPBOX_API_KEY__: JSON.stringify(env.MAPBOX_API_KEY ?? ''),
      __ESRI_API_KEY__: JSON.stringify(env.ESRI_API_KEY ?? ''),
      __ESRI_API_ID__: JSON.stringify(env.ESRI_API_ID ?? '')
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
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