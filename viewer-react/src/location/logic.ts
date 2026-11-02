/**
 * Device location and nearby-memory alerts, as pure logic.
 *
 * No DOM, Capacitor or Cesium imports: the platform edge lives in ./platform.ts
 * and the React wiring in ./useDeviceLocation.ts, so everything here is testable
 * under Vitest without a browser.
 *
 * Privacy: a device position is held in memory by the viewer. It draws a marker
 * and decides whether a memory is nearby, and that is all. No function here
 * stores or transmits a position.
 */

/** Distance, in metres, inside which a located memory counts as nearby. */
export const NEARBY_RADIUS_METRES = 300;

/** Mean Earth radius for the haversine formula, in metres. */
export const EARTH_RADIUS_METRES = 6_371_008.8;

export interface LatLon {
  lat: number;
  lon: number;
}

/** A device fix. Lives in memory only. */
export interface DevicePosition extends LatLon {
  /** Radius of uncertainty in metres, when the platform reports one. */
  accuracyMetres: number | null;
}

/** The fields a memory needs for the nearby check. `AtlasMemory` satisfies it. */
export interface LocatedMemory {
  id: string;
  title: string;
  lat?: number;
  lon?: number;
}

export interface NearbyMemory {
  id: string;
  title: string;
  distanceMetres: number;
}

/** A platform position in the shape both `GeolocationPosition` and Capacitor use. */
export interface PositionFix {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
}

/** Permission as the platform reports it, reduced to what the viewer needs. */
export type LocationAccess = 'granted' | 'denied' | 'prompt' | 'unavailable';
export type NotificationAccess = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** What the "Show my location" control is doing. */
export type LocationStatus =
  | 'off'
  | 'requesting'
  | 'waiting'
  | 'tracking'
  | 'denied'
  | 'unavailable'
  | 'error';

/** What the "Nearby memories" control can do. */
export type NotifyStatus = 'off' | 'on' | 'blocked' | 'unsupported';

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in metres (haversine). */
export function haversineMetres(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  // The clamp guards against rounding pushing `h` a hair above 1 for antipodes.
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A usable coordinate, or null: finite numbers inside the valid ranges. */
export function validLatLon(lat: unknown, lon: unknown): LatLon | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Located memories within `radiusMetres` of `position`, nearest first. A memory
 * without a usable coordinate is skipped, never placed at 0,0.
 */
export function nearbyMemories(
  position: LatLon,
  memories: readonly LocatedMemory[],
  radiusMetres: number = NEARBY_RADIUS_METRES,
): NearbyMemory[] {
  const found: NearbyMemory[] = [];
  for (const memory of memories) {
    const point = validLatLon(memory.lat, memory.lon);
    if (!point) continue;
    const distanceMetres = haversineMetres(position, point);
    if (distanceMetres <= radiusMetres) {
      found.push({ id: memory.id, title: memory.title, distanceMetres });
    }
  }
  return found.sort((a, b) => a.distanceMetres - b.distanceMetres);
}

/**
 * Once-per-session dedupe. Returns the candidates not announced yet and records
 * them in `announced`. The caller keeps that set for the life of the page, so a
 * reload starts a new session, which is the intended scope.
 */
export function takeUnannounced(
  announced: Set<string>,
  candidates: readonly NearbyMemory[],
): NearbyMemory[] {
  const fresh: NearbyMemory[] = [];
  for (const candidate of candidates) {
    if (announced.has(candidate.id)) continue;
    announced.add(candidate.id);
    fresh.push(candidate);
  }
  return fresh;
}

/**
 * A stable notification id for a memory. Capacitor wants a 32-bit integer, so
 * this is FNV-1a folded to a positive 31-bit value (never 0).
 */
export function notificationIdFor(memoryId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < memoryId.length; i += 1) {
    hash ^= memoryId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}

export interface NearbyNotice {
  title: string;
  body: string;
}

/**
 * The words of a nearby alert. It names the memory and the radius, and gives no
 * exact distance, since a notification can show on a locked screen.
 */
export function nearbyNotice(memory: { title: string }): NearbyNotice {
  const name = String(memory.title ?? '').trim() || 'A memory';
  return {
    title: 'Memory nearby',
    body: `${name} is within ${NEARBY_RADIUS_METRES} m of you.`,
  };
}

/** Parse a platform fix. Null when the coordinates are not usable. */
export function devicePositionFrom(fix: PositionFix | null | undefined): DevicePosition | null {
  const point = validLatLon(fix?.coords?.latitude, fix?.coords?.longitude);
  if (!point) return null;
  const accuracy = fix?.coords?.accuracy;
  const accuracyMetres =
    typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
  return { ...point, accuracyMetres };
}

/**
 * Capacitor's permission strings ('prompt-with-rationale' included) and the
 * local-notifications `display` values, reduced to the three the viewer uses.
 * An unrecognised value is treated as unavailable, so the viewer never loops on
 * a prompt it does not understand.
 */
export function locationAccessFromState(state: unknown): LocationAccess {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  if (state === 'prompt' || state === 'prompt-with-rationale') return 'prompt';
  return 'unavailable';
}

export function notificationAccessFromState(state: unknown): NotificationAccess {
  if (state === 'granted') return 'granted';
  if (state === 'prompt') return 'prompt';
  // 'denied', and anything unrecognised: do not post what the user may have refused.
  return 'denied';
}

/**
 * The status after a permission check. A prompt that was answered without a
 * grant counts as denied: the user dismissed it, and a tap on the control asks
 * again.
 */
export function statusForLocationAccess(access: LocationAccess): LocationStatus {
  if (access === 'granted') return 'waiting';
  if (access === 'unavailable') return 'unavailable';
  return 'denied';
}

export function statusForNotificationAccess(access: NotificationAccess): NotifyStatus {
  if (access === 'granted') return 'on';
  if (access === 'denied') return 'blocked';
  if (access === 'unsupported') return 'unsupported';
  return 'off';
}

/**
 * A watch error, as the status to show. Accepts the web `GeolocationPositionError`
 * (numeric `code`) and the Capacitor plugin's `OS-PLUG-GLOC-NNNN` string codes.
 */
export function statusForGeolocationError(error: unknown): LocationStatus {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === 1) return 'denied';
  if (code === 2) return 'unavailable';
  if (code === 3) return 'waiting';
  if (typeof code === 'string') {
    const match = /^OS-PLUG-GLOC-(\d{4})$/.exec(code);
    switch (match?.[1]) {
      case '0003': // location permission request was denied
      case '0008': // location use restricted on the device
        return 'denied';
      case '0007': // location services are off
      case '0009': // the user declined to turn location on
      case '0017': // network and location are both off
        return 'unavailable';
      case '0010': // no fix in time
        return 'waiting';
      default:
        return 'error';
    }
  }
  return 'error';
}

/** Short user-facing message for a location status, or null when none is needed. */
export function locationNote(status: LocationStatus): string | null {
  switch (status) {
    case 'waiting':
      return 'Finding your position.';
    case 'denied':
      return 'Location is off for Companion Atlas. Allow it in your device settings to show where you are.';
    case 'unavailable':
      return 'Your position is not available right now.';
    case 'error':
      return 'Could not read your position.';
    default:
      return null;
  }
}

/** Short user-facing message for a notification status, or null when none is needed. */
export function notifyNote(status: NotifyStatus): string | null {
  switch (status) {
    case 'blocked':
      return 'Notifications are blocked for Companion Atlas. Allow them in your device settings to get nearby alerts.';
    case 'unsupported':
      return 'This browser cannot show notifications, so nearby alerts are off.';
    default:
      return null;
  }
}
