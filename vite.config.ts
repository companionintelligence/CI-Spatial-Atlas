import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022'
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/Cesium')
  },
  server: {
    port: 5173,
    open: true
  }
});
