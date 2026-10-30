import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertPwa } from './scripts/check-pwa.mjs';

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
// same-origin — no preflight at all — and preserves request metadata. CI-Server's
// guarded GraphQL path still requires a bearer/API key; the viewer obtains a
// scoped bearer with its in-viewer sign-in flow.
const memoryProxyTarget = process.env.VITE_DEV_MEMORY_PROXY;
// Vite rejects non-local Host headers by default. Keep hostname access
// explicit rather than opening every host, so a developer can expose the
// viewer over Tailscale with `VITE_DEV_ALLOWED_HOSTS=machine.tailnet.ts.net`.
const devAllowedHosts = (process.env.VITE_DEV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

/**
 * Fail the production build when the installable-app files disagree: public/sw.js against the
 * files it precaches, and the worker, those files and the registration in the built output
 * (scripts/check-pwa.mjs, which says what is checked and what the kill switch is excused from).
 * It is a plugin so that every path to a build runs it: `npm run build`, the Docker image and
 * the deploy workflow all go through `vite build`.
 */
function pwaCheck(): Plugin {
  let publicDir = '';
  let outDir: string | null = null;
  let written = false;
  return {
    name: 'ci-atlas-pwa-check',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
      outDir = config.build.ssr ? null : path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      written = true;
    },
    closeBundle() {
      // A build that failed has no output to check, and its own error is the one to show.
      if (outDir && written) assertPwa({ publicDir, dist: outDir });
    },
  };
}

export default defineConfig({
  // pwaCheck() stays last so it checks the output after every other plugin has had its say.
  plugins: [react(), cesium({ cesiumBuildRootPath, cesiumBuildPath }), pwaCheck()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 4174,
    allowedHosts: devAllowedHosts.length > 0 ? devAllowedHosts : undefined,
    proxy: memoryProxyTarget
      ? {
          '/memory': {
            target: memoryProxyTarget,
            changeOrigin: true,
            // Keep the browser's address visible through a nested dev proxy.
            // CI-Server binds sessions to IP + user-agent; without forwarding
            // this hop, a login on the Companion UI and a read from Atlas look
            // like two different clients and the viewer reports Unauthorized.
            xfwd: true,
            rewrite: (p) => p.replace(/^\/memory/, ''),
          },
        }
      : undefined,
  },
});
