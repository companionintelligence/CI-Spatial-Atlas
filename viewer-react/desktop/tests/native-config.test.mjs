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
const repoRoot = path.join(here, '../../..');
const licenseMd = await readFile(path.join(repoRoot, 'LICENSE.md'), 'utf8');
const rootPkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

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
  // The prebuilt CesiumJS bundle (public/cesium/Cesium.js) evaluates a string as code while it
  // loads. Without 'unsafe-eval' it throws an EvalError, window.Cesium never exists, and the
  // window stays on "Loading Companion Atlas…" (seen on Windows with the 0.2.0 CI build).
  assert.match(csp, /script-src[^;]*'unsafe-eval'/);
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

// The viewer imports KML, KMZ, GeoJSON and story files dropped on the globe through HTML5 drag
// and drop (viewer-react/src/interop/useFileDrop.ts). Tauri's own drop handler takes file drops
// away from the page on Windows (WebView2), so the main window turns it off. main.rs builds the
// window from this config entry, which is what applies the setting.
test('Atlas desktop leaves file drops to the viewer', () => {
  const main = config.app.windows.find((window) => window.label === 'main');
  assert.equal(main.dragDropEnabled, false);
  assert.match(mainRs, /WebviewWindowBuilder::from_config\(app\.handle\(\), &config\)/);
  assert.doesNotMatch(mainRs, /WebviewWindowBuilder::new\(/);
});

// Cargo.toml once pinned tauri-build to a version that does not exist, and nothing noticed
// because the shell had never been built. Each exact pin must be the version Cargo.lock has.
test('desktop Cargo pins match the lockfile', () => {
  for (const name of ['tauri', 'tauri-build', 'tauri-plugin-opener']) {
    assert.ok(pinnedVersion(name), `${name} is pinned to an exact version in Cargo.toml`);
    assert.equal(pinnedVersion(name), lockedVersion(name), `${name} in Cargo.toml and Cargo.lock`);
  }
});

// The release workflow names files after this version and checks the tag against it. The MSI
// format needs it numeric (major.minor.patch).
test('desktop version is the same in tauri.conf.json, Cargo and package.json', () => {
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(/^version = "([^"]+)"/m.exec(cargoToml)?.[1], config.version);
  assert.equal(lockedVersion('companion-atlas-desktop'), config.version);
  assert.equal(pkg.version, config.version);
});

// Each OS builds only its own formats from this list. No AppImage: it would bundle the LGPL
// WebKitGTK and GTK libraries, while a .deb or .rpm only depends on the system's copies.
test('desktop bundles Windows, macOS and Linux installers, without an AppImage', () => {
  assert.deepEqual([...config.bundle.targets].sort(), ['app', 'deb', 'dmg', 'msi', 'nsis', 'rpm']);
  assert.ok(!config.bundle.targets.includes('appimage'));
});

// Ad hoc: no certificate. A downloaded unsigned app on Apple silicon is reported as damaged;
// an ad-hoc signed one can be allowed in Privacy & Security.
test('desktop macOS app is ad-hoc signed', () => {
  assert.equal(config.bundle.macOS.signingIdentity, '-');
});

// Without a publisher, Tauri names the second part of the identifier ("ci") as the company in
// the Windows executable and as the installers' manufacturer. The copyright holder is the one
// in LICENSE.md's Required Notice, and the licence is the repository's.
test('desktop installers name the publisher, the copyright holder and the licence', () => {
  const holder = /^> Required Notice: (Copyright .+?) \(https?:\/\/[^)]+\)\r?$/m.exec(licenseMd)?.[1];
  assert.ok(holder, 'LICENSE.md has a Required Notice line');
  assert.equal(config.bundle.publisher, 'Companion Intelligence');
  assert.equal(config.bundle.copyright, holder);
  assert.equal(config.bundle.license, 'PolyForm-Noncommercial-1.0.0');
  assert.equal(config.bundle.license, rootPkg.license);
  assert.match(cargoToml, /^authors = \["Companion Intelligence"\]\r?$/m);
  assert.match(cargoToml, /^license = "PolyForm-Noncommercial-1\.0\.0"\r?$/m);
});

test('desktop build generates all required platform icons', () => {
  assert.deepEqual(config.bundle.icon, ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico']);
  assert.match(pkg.scripts.icons, /^tauri icon /);
  assert.match(pkg.scripts.build, /npm run icons && npm run notices && tauri build/);
});

// The licence of the app and the third-party notices go into every installer, in a licenses
// folder next to the executable (Contents/Resources/licenses on macOS). `npm run notices`
// writes them from the lockfiles before each build; Tauri fails the build if they are missing.
test('desktop installers carry the licence and the third-party notices', () => {
  assert.deepEqual(config.bundle.resources, {
    'notices/LICENSE.md': 'licenses/LICENSE.md',
    'notices/THIRD-PARTY-NOTICES.txt': 'licenses/THIRD-PARTY-NOTICES.txt',
  });
  assert.match(pkg.scripts.notices, /scripts\/third-party-notices\.mjs --scope web,desktop --out src-tauri\/notices$/);
  for (const script of ['dev', 'build', 'build:debug']) {
    assert.match(pkg.scripts[script], /npm run notices && tauri (dev|build)/, script);
  }
});
