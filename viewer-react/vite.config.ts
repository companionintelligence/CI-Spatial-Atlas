import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// Resium/Cesium + React. `vite-plugin-cesium` copies Cesium's static assets and
// sets CESIUM_BASE_URL; `@vitejs/plugin-react` enables JSX/Fast Refresh.
export default defineConfig({
  plugins: [react(), cesium()],
  server: { host: '127.0.0.1', port: 4174 },
});
