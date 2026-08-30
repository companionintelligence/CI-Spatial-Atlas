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
// Dev-only proxy to Companion Memory (CI-Server). Point it at a running server
// with VITE_DEV_MEMORY_PROXY (e.g. http://localhost:8642/api), then load Atlas
// with `?memory=/memory` so requests go to this origin and Vite forwards them.
//
// Why a proxy rather than calling CI-Server directly: CI-Server's
// CORS_ALLOWED_ORIGINS defaults to empty, so a cross-origin browser call from
// :4174 fails preflight, and a wildcard is invalid once credentials are in play
// (client.ts sends `credentials: 'include'`). Proxying makes the browser request
// same-origin — no preflight at all — while the session cookie still rides along,
// because cookies are scoped by host and ignore the port, so a cookie set by the
// Companion UI on localhost is sent to localhost:4174 too and forwarded upstream.
const memoryProxyTarget = process.env.VITE_DEV_MEMORY_PROXY;

export default defineConfig({
  plugins: [react(), cesium({ cesiumBuildRootPath, cesiumBuildPath })],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 4174,
    proxy: memoryProxyTarget
      ? {
          '/memory': {
            target: memoryProxyTarget,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/memory/, ''),
          },
        }
      : undefined,
  },
});
