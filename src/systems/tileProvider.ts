/**
 * Multi-source map tile URL provider.
 *
 * Base imagery priority:
 *   1. Mapbox Satellite (best quality) — requires MAPBOX_API_KEY
 *   2. ESRI World Imagery (Maxar/Nearmap, high resolution) — requires ESRI_API_KEY
 *   3. Google Maps Tile API (satellite) — requires GOOGLE_MAP_PLATFORM;
 *      session token is pre-fetched and cached on initialisation.
 *   4. OpenStreetMap — free fallback, no key needed.
 *
 * Overlay tile URL helpers:
 *   - selectHillshadeTileUrl  — ESRI Elevation/World_Hillshade (terrain shading)
 *   - selectLabelsTileUrl     — ESRI Reference/World_Boundaries_and_Places (country/city names)
 *   - selectOceanTileUrl      — ESRI Ocean/World_Ocean_Base (ocean depth)
 *
 * Note: ESRI tile coordinates use {z}/{y}/{x} order (not z/x/y).
 *
 * Build-time constants are injected by vite.config.ts via the `define` block.
 */

declare const __MAPBOX_API_KEY__: string;
declare const __GOOGLE_MAP_PLATFORM__: string;
declare const __ESRI_API_KEY__: string;

let googleSessionToken: string | null = null;
let googleSessionPending = false;

async function fetchGoogleSession(): Promise<void> {
  if (googleSessionPending || googleSessionToken) return;
  if (!__GOOGLE_MAP_PLATFORM__) return;

  googleSessionPending = true;
  try {
    const res = await fetch(
      `https://tile.googleapis.com/v1/createSession?key=${__GOOGLE_MAP_PLATFORM__}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' })
      }
    );
    if (res.ok) {
      const json = (await res.json()) as { session?: string };
      googleSessionToken = json.session ?? null;
    }
  } catch {
    // Session fetch unavailable — will fall through to OSM.
  } finally {
    googleSessionPending = false;
  }
}

// Kick off Google session acquisition eagerly so it's ready by the time tiles load.
if (typeof __GOOGLE_MAP_PLATFORM__ !== 'undefined' && __GOOGLE_MAP_PLATFORM__) {
  void fetchGoogleSession();
}

/**
 * Return a base imagery tile URL for the given tile coordinates.
 * Priority: Mapbox → ESRI World Imagery → Google → OSM
 */
export function selectTileUrl(z: number, x: number, y: number): string {
  // Priority 1: Mapbox satellite
  if (__MAPBOX_API_KEY__) {
    return `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${__MAPBOX_API_KEY__}`;
  }

  // Priority 2: ESRI World Imagery (Maxar). ESRI uses z/y/x tile order.
  if (__ESRI_API_KEY__) {
    return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${__ESRI_API_KEY__}`;
  }

  // Priority 3: Google satellite (available once session acquired)
  if (googleSessionToken && __GOOGLE_MAP_PLATFORM__) {
    return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${googleSessionToken}&key=${__GOOGLE_MAP_PLATFORM__}`;
  }

  // Fallback: OpenStreetMap
  const servers = ['a', 'b', 'c'] as const;
  const s = servers[(x + y) % 3];
  return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/**
 * ESRI terrain hillshade overlay tile URL.
 * Returns null when no ESRI key is configured.
 * Renders mountains, valleys, and river basins with light+shadow shading.
 */
export function selectHillshadeTileUrl(z: number, x: number, y: number): string | null {
  if (!__ESRI_API_KEY__) return null;
  return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${z}/${y}/${x}?token=${__ESRI_API_KEY__}`;
}

/**
 * ESRI World Boundaries and Places overlay tile URL.
 * Returns public (no-auth) ArcGIS reference tiles as fallback.
 * Shows country borders, major city labels, and administrative boundaries.
 */
export function selectLabelsTileUrl(z: number, x: number, y: number): string {
  if (__ESRI_API_KEY__) {
    return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}?token=${__ESRI_API_KEY__}`;
  }
  // Public fallback (no auth required)
  return `https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
}

/**
 * ESRI World Ocean Base overlay tile URL.
 * Returns null when no ESRI key is configured.
 * Displays ocean depth, seafloor relief, and bathymetric contours.
 */
export function selectOceanTileUrl(z: number, x: number, y: number): string | null {
  if (!__ESRI_API_KEY__) return null;
  return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}?token=${__ESRI_API_KEY__}`;
}

