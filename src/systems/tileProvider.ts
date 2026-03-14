/**
 * Multi-source map tile URL provider.
 *
 * Priority:
 *   1. Mapbox Satellite (best quality) — requires MAPBOX_API_KEY
 *   2. Google Maps Tile API (satellite) — requires GOOGLE_MAP_PLATFORM;
 *      session token is pre-fetched and cached on initialisation.
 *   3. OpenStreetMap — free fallback, no key needed.
 *
 * The constants __MAPBOX_API_KEY__ and __GOOGLE_MAP_PLATFORM__ are injected
 * at build time by vite.config.ts via the `define` block.
 */

declare const __MAPBOX_API_KEY__: string;
declare const __GOOGLE_MAP_PLATFORM__: string;

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
 * Return a tile image URL for the given tile coordinates.
 * Uses Mapbox satellite if key is set, then Google satellite if session acquired,
 * then OSM road tiles as fallback.
 */
export function selectTileUrl(z: number, x: number, y: number): string {
  // Priority 1: Mapbox satellite
  if (__MAPBOX_API_KEY__) {
    return `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${__MAPBOX_API_KEY__}`;
  }

  // Priority 2: Google satellite (available once session acquired)
  if (googleSessionToken && __GOOGLE_MAP_PLATFORM__) {
    return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${googleSessionToken}&key=${__GOOGLE_MAP_PLATFORM__}`;
  }

  // Fallback: OpenStreetMap
  const servers = ['a', 'b', 'c'] as const;
  const s = servers[(x + y) % 3];
  return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}
