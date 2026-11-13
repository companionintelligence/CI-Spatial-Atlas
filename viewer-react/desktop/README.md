# Companion Atlas desktop shell

Tauri 2 packages the Atlas viewer for macOS and Windows. It bundles the built
viewer and does not run a Companion Memory server. Configure `VITE_MEMORY_URL`
and any restricted map-service keys in `viewer-react/.env` before building.

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

The identifier `computer.ci.atlas` is provisional. Before store submission,
reserve the permanent bundle ID and complete privacy declarations, artwork,
code signing, macOS notarization, and a manual release workflow. This shell is
not a submitted or store-ready binary.
