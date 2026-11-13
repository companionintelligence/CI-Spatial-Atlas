import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, '../src-tauri/tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8'));

test('Atlas desktop bundles the viewer and starts the expected Vite server', () => {
  assert.equal(config.productName, 'Companion Atlas');
  assert.equal(config.build.devUrl, 'http://127.0.0.1:4174');
  assert.equal(path.basename(config.build.frontendDist), 'dist');
  assert.equal(config.build.serverUrl, undefined);
  assert.equal(pkg.devDependencies['@tauri-apps/cli'], '2.12.4');
});

test('Atlas desktop CSP supports Cesium WebAssembly, workers, and HTTPS services', () => {
  const csp = config.app.security.csp;
  assert.match(csp, /connect-src[^;]*https:/);
  assert.match(csp, /script-src[^;]*wasm-unsafe-eval/);
  assert.match(csp, /worker-src[^;]*blob:/);
});

test('desktop build generates all required platform icons', () => {
  assert.deepEqual(config.bundle.icon, ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']);
  assert.match(pkg.scripts.icons, /^tauri icon /);
  assert.match(pkg.scripts.build, /npm run icons && tauri build/);
});
