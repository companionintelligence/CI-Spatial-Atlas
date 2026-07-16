import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Ion } from 'cesium';
import './theme/theme.css';
import { AtlasApp } from './AtlasApp.js';

// Use the configured Cesium ion token for real World Imagery / World Terrain /
// OSM Buildings. Without it, Cesium falls back to its bundled offline imagery.
const ionToken = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_CESIUM_ION_TOKEN;
if (ionToken) Ion.defaultAccessToken = ionToken;

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <AtlasApp />
  </StrictMode>,
);
