/**
 * Copies Cesium's static runtime assets (Workers/ThirdParty/Assets/Widgets)
 * from node_modules into public/cesium/, so Vite's own static-file serving
 * (reliable in both dev and build) handles them — see CESIUM_BASE_URL in
 * vite.config.ts. public/cesium is gitignored; re-run this after every
 * `npm install` that changes the cesium version.
 *
 * (An earlier version of this used vite-plugin-static-copy's dev-server
 * middleware, which was found to inconsistently serve nested asset paths —
 * some requests silently fell through to Vite's SPA index.html fallback
 * instead of the real file. Copying into public/ sidesteps that class of bug
 * entirely.)
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cesiumSource = join(root, 'node_modules/cesium/Build/Cesium');
const dest = join(root, 'public/cesium');

if (!existsSync(cesiumSource)) {
  console.error(`cesium package not found at ${cesiumSource} — run npm install first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
  cpSync(join(cesiumSource, dir), join(dest, dir), { recursive: true });
}

console.log(`Copied Cesium static assets to ${dest}`);
