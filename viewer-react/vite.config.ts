import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { createRequire } from 'node:module';
import path from 'node:path';

// Resolve Cesium wherever it lives — under npm-workspace hoisting it lands in the
// repo-root node_modules, not viewer-react/node_modules, and vite-plugin-cesium's
// default `node_modules/cesium/Build/Cesium` path then misses the runtime assets.
const require = createRequire(import.meta.url);
const cesiumDir = path.dirname(require.resolve('cesium/package.json'));
// vite-plugin-cesium uses cesiumBuildRootPath for dev-serve and cesiumBuildPath
// for the production asset copy — both must point at the resolved Cesium.
const cesiumBuildRootPath = path.join(cesiumDir, 'Build');
const cesiumBuildPath = path.join(cesiumDir, 'Build', 'Cesium');

// Resium/Cesium + React. `vite-plugin-cesium` copies Cesium's static assets and
// sets CESIUM_BASE_URL; `@vitejs/plugin-react` enables JSX/Fast Refresh.
export default defineConfig({
  plugins: [react(), cesium({ cesiumBuildRootPath, cesiumBuildPath })],
  server: { host: '127.0.0.1', port: 4174 },
});
