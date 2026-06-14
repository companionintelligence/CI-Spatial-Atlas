/**
 * Auto-composition helpers — turn a bag of geolocated media into an ordered
 * narrative. Used by the `atlas_auto_compose` MCP tool and the REST endpoint.
 */

/** Parse an optional ISO time to a sortable instant (missing → end of list). */
export function sceneInstantFromTime(time?: string): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(time);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Haversine distance in metres — used to pace camera flight durations. */
export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
