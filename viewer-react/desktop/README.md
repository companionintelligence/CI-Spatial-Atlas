# Companion Atlas desktop shell

Tauri 2 packages the Atlas viewer for macOS, Windows and Linux. It bundles the
built viewer and does not run a Companion Memory server.

The desktop app is demo only for now. It opens the bundled sample journey,
labelled Demo data, and the files you import (KML, GeoJSON, stories). It cannot
connect to Companion Memory and has no sign-in: the Connect to Companion Memory
item is offered only in the Capacitor shells, and the published builds set no
`VITE_MEMORY_URL` and no `VITE_OIDC_*`. A local build made with `VITE_MEMORY_URL`
in `viewer-react/.env` loads that server's memories instead, if the server's CORS
settings accept the shell's origin (`tauri://localhost` on macOS and Linux,
`http://tauri.localhost` on Windows); that has not been tried. Whatever
`viewer-react/.env` holds is baked into the build and can be read back out of
it, so release builds use no keys or tokens at all.

```sh
cd viewer-react/desktop
npm install
npm run dev
npm run build
```

From the repository root, the equivalent commands are:

```sh
npm install --prefix viewer-react/desktop
npm run dev --prefix viewer-react/desktop
npm run build --prefix viewer-react/desktop
```

The desktop viewer uses the system WebView and WebGL. Its WebXR entry point
requires a browser or headset runtime and is not provided by this shell. Confirm
Cesium, memory connection, auth, external-link behavior, and GPU rendering on
physical macOS and Windows devices before release.

Where that check stands for the 0.2.0 pre-release:

- **Windows, checked** on a Windows 11 PC (Intel UHD Graphics, Direct3D 11
  through ANGLE) with the CI-built MSI. The globe draws with its imagery, the
  demo story's markers and journey arc show, the console stays clean, and a
  click on a new-tab link (the Cesium credit) opens it in the default browser
  while the app stays put. The check found and fixed two bugs first: the CSP
  stopped CesiumJS from loading, and then stopped its workers.
- **macOS, not checked.** The owner waived the Mac check for GitHub
  pre-releases; the release notes say macOS is untested.
- **Memory connection and sign-in** are not part of this desktop app yet: it
  ships the demo story only.

The identifier `computer.ci.atlas` is provisional. Before store submission,
reserve the permanent bundle ID and complete privacy declarations, artwork,
code signing and macOS notarization. This shell is not a submitted or
store-ready binary.

## What a build produces

| Platform | Built on | Files | Signing |
| --- | --- | --- | --- |
| Windows | `windows-latest` | NSIS installer (`.exe`) and `.msi` | none |
| macOS 12 or later | `macos-latest` | one universal app and `.dmg` (Apple silicon and Intel): `npm run build -- --target universal-apple-darwin` | ad hoc (`bundle.macOS.signingIdentity` is `-`), not notarized |
| Linux | `ubuntu-22.04` | `.deb` and `.rpm` | none |

`bundle.targets` lists these formats, and each OS builds its own. There is no
AppImage: it would bundle the LGPL WebKitGTK and GTK libraries, while the `.deb`
and `.rpm` depend on the system's. Packages built on Ubuntu 22.04 need that
release or a newer one. A Linux build needs the WebKitGTK development packages:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Ad-hoc signing matters on Apple silicon: a downloaded app with no signature at
all is reported as damaged, while an ad-hoc signed one can be opened from
Privacy & Security.

`npm run build` runs `npm run icons` (the icons come from
`viewer-react/public/icons/icon-512.png`) and `npm run notices`, then `tauri
build`, which builds the web bundle first. `npm run notices` writes the app's
`LICENSE.md` and `THIRD-PARTY-NOTICES.txt` to `src-tauri/notices`, from the
lockfiles (`scripts/third-party-notices.mjs` at the repository root, which
needs `cargo`). The installers put both files in a `licenses` folder: next to
the executable on Windows and Linux, and in `Contents/Resources/licenses` on
macOS.

## Links

Story links and map credits open in a new tab (`target="_blank"`). The shell
sends them, and any link that would navigate the window to another site, to
the system browser (`src-tauri/src/main.rs`, through `tauri-plugin-opener`).
Only `http`, `https`, `mailto` and `tel` links leave the app. The page has no
opener permission of its own: its capability is still `core:default`.

## Dropping files

The viewer imports KML, KMZ, GeoJSON and story files dropped on the globe
through HTML5 drag and drop. Tauri's own file-drop handler would take those
drops away from the page on Windows, so the main window sets
`dragDropEnabled: false` in `tauri.conf.json`. `main.rs` builds the window from
that entry, which is what applies the setting.

## Content Security Policy

`tauri.conf.json` sets the CSP. Tauri adds nonces and hashes to it at build
time; `dangerousDisableAssetCspModification` keeps it from doing so for
`style-src`, because a nonce there would make the WebView ignore
`'unsafe-inline'` and drop the inline styles of the boot screen in
`viewer-react/index.html`. Scripts still get Tauri's nonces and hashes.

`script-src` allows `'unsafe-eval'`: the prebuilt CesiumJS bundle
(`public/cesium/Cesium.js`) evaluates a string as code while it loads. Without it
the bundle throws an `EvalError`, `window.Cesium` is never defined, and the
window stays on "Loading Companion Atlas…". It also allows `blob:`: Cesium's
workers start from `blob:` URLs and load more `blob:` code with `importScripts`,
which `script-src` governs, and without them the globe's surface never draws.
Scripts still come only from the app itself (`'self'`) or the blobs it makes.

## Releases

[`desktop-build.yml`](../../.github/workflows/desktop-build.yml) builds all three
platforms as workflow artifacts (manual dispatch). Pre-releases for download
come from
[`native-release.yml`](../../.github/workflows/native-release.yml), which builds
the same installers and the Android APK from one commit and publishes them on
the repository's Releases page with the licence files and `SHA256SUMS.txt`. The
version is in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
`package.json` (0.2.1); keep the three equal, as `npm run test:native` checks.
