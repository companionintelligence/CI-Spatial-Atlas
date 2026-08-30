import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleMaps, Ion } from 'cesium';
import './theme/theme.css';
import './theme/atlas.css';
import { AtlasApp } from './AtlasApp.js';

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
createRoot(root).render(
  <StrictMode>
    <AtlasApp />
  </StrictMode>,
);
