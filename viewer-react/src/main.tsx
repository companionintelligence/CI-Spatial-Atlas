import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleMaps, Ion } from 'cesium';
import './theme/theme.css';
import './theme/atlas.css';
import { AtlasApp } from './AtlasApp.js';
import { rendererForDevice } from './renderers/rendererForDevice.js';

// Use the configured Cesium ion token for real World Imagery / World Terrain.
// Without one, clear Cesium's *bundled* default token (a short-lived shared JWT)
// so the viewer detects "no ion" and loads the offline basemap immediately,
// instead of stalling on an ion request that will 401 or hang.
const ionToken = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_CESIUM_ION_TOKEN;
Ion.defaultAccessToken = ionToken ?? '';

// Google Maps Platform key, used for Photorealistic 3D Tiles (the buildings
// layer) and Street View. Cesium reads it off this global rather than taking it
// per-call, so it has to be set before any viewer mounts.
const googleKey = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_GOOGLE_MAPS_API_KEY;
if (googleKey) GoogleMaps.defaultApiKey = googleKey;

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
const reactRoot = createRoot(root);

// Choose the renderer before mounting. Resium/Cesium and the R3F/WebXR globe
// are separate app roots (ADR-0001) rather than two views of one shell, because
// nothing in the desktop chrome — rails, drawers, the scrubber — exists inside
// an immersive session. Importing the XR root only when it wins keeps 3D Tiles
// and WebXR out of the bundle every desktop visitor downloads.
void rendererForDevice().then(async (kind) => {
  const App = kind === 'xr' ? (await import('./renderers/xr/XRAtlasApp.js')).XRAtlasApp : AtlasApp;
  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
