import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.join(here, '../src-tauri');
const config = JSON.parse(await readFile(path.join(tauriDir, 'tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8'));
const capability = JSON.parse(await readFile(path.join(tauriDir, 'capabilities/default.json'), 'utf8'));
const cargoToml = await readFile(path.join(tauriDir, 'Cargo.toml'), 'utf8');
const cargoLock = await readFile(path.join(tauriDir, 'Cargo.lock'), 'utf8');
const mainRs = await readFile(path.join(tauriDir, 'src/main.rs'), 'utf8');

/** The version Cargo.lock records for a crate (the lock has one entry per crate here). */
function lockedVersion(name) {
  const match = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`).exec(cargoLock);
  return match?.[1];
}

/** The exact version Cargo.toml pins a dependency to (`name = "=x"` or `{ version = "=x" }`). */
function pinnedVersion(name) {
  const match = new RegExp(`^${name} = (?:\\{ version = )?"=([^"]+)"`, 'm').exec(cargoToml);
  return match?.[1];
}

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

// Tauri adds a nonce for each <style> element to style-src, and a page whose style-src has a
// nonce ignores 'unsafe-inline', which would drop the inline style attributes of the boot
// screen in viewer-react/index.html. Scripts keep Tauri's nonces and hashes.
test('Atlas desktop keeps inline styles allowed and lets Tauri harden scripts only', () => {
  assert.match(config.app.security.csp, /style-src[^;]*'unsafe-inline'/);
  assert.deepEqual(config.app.security.dangerousDisableAssetCspModification, ['style-src']);
});

test('Atlas desktop opens new-tab and off-site links in the system browser', () => {
  const main = config.app.windows.find((window) => window.label === 'main');
  // Built in main.rs instead, where the new-window and navigation handlers are attached.
  assert.equal(main.create, false);
  assert.match(mainRs, /const MAIN_WINDOW: &str = "main";/);
  assert.match(mainRs, /\.plugin\(tauri_plugin_opener::init\(\)\)/);
  assert.match(mainRs, /\.on_new_window\(/);
  assert.match(mainRs, /\.on_navigation\(/);
  assert.match(mainRs, /NewWindowResponse::Deny/);
  // The page gets no opener commands: only the Rust handlers open links.
  assert.deepEqual(capability.permissions, ['core:default']);
});

// Cargo.toml once pinned tauri-build to a version that does not exist, and nothing noticed
// because the shell had never been built. Each exact pin must be the version Cargo.lock has.
test('desktop Cargo pins match the lockfile', () => {
  for (const name of ['tauri', 'tauri-build', 'tauri-plugin-opener']) {
    assert.ok(pinnedVersion(name), `${name} is pinned to an exact version in Cargo.toml`);
    assert.equal(pinnedVersion(name), lockedVersion(name), `${name} in Cargo.toml and Cargo.lock`);
  }
});

test('desktop build generates all required platform icons', () => {
  assert.deepEqual(config.bundle.icon, ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']);
  assert.match(pkg.scripts.icons, /^tauri icon /);
  assert.match(pkg.scripts.build, /npm run icons && tauri build/);
});
