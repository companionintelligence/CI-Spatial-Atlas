/**
 * Street View imagery for a memory's place.
 *
 * This is the "real preview" a located memory was missing. A personal archive's
 * events are overwhelmingly calendar entries with no photo of their own, so the
 * inspector had nothing to show and used to paint an invented gradient. Street
 * View gives the actual venue — the theatre you went to fifty times, as it
 * looks from the street.
 *
 * Metadata is checked before requesting a picture. The Static API bills per
 * image and returns a grey "no imagery here" placeholder rather than an error
 * when a location has no panorama, so asking first is both cheaper and the only
 * way to avoid showing that placeholder as though it were the place. Metadata
 * requests are free and documented as such.
 */

const META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMAGE = 'https://maps.googleapis.com/maps/api/streetview';

export interface StreetViewShot {
  url: string;
  /** e.g. "2025-09" — when Google captured it, which is rarely the memory's date. */
  captured?: string;
}

const cache = new Map<string, StreetViewShot | null>();
const inFlight = new Map<string, Promise<StreetViewShot | null>>();

const apiKey = (): string | undefined => {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const k = env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  return k ? k : undefined;
};

export const streetViewAvailable = (): boolean => Boolean(apiKey());

/** One lookup per ~11m cell; memories at one venue share a panorama. */
const keyFor = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

export async function fetchStreetView(
  lat: number,
  lon: number,
  opts: { width?: number; height?: number; signal?: AbortSignal } = {},
): Promise<StreetViewShot | null> {
  const key = apiKey();
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const id = keyFor(lat, lon);
  if (cache.has(id)) return cache.get(id) ?? null;
  const pending = inFlight.get(id);
  if (pending) return pending;

  const req = (async (): Promise<StreetViewShot | null> => {
    try {
      const res = await fetch(`${META}?location=${lat},${lon}&key=${key}`, { signal: opts.signal });
      if (!res.ok) return null;
      const meta = (await res.json()) as { status?: string; date?: string };
      // ZERO_RESULTS is normal and common — plenty of real places have no
      // panorama (indoors, private, rural). Not an error worth surfacing.
      if (meta.status !== 'OK') return null;

      const w = opts.width ?? 640;
      const h = opts.height ?? 320;
      return {
        url: `${IMAGE}?size=${w}x${h}&location=${lat},${lon}&fov=80&pitch=0&key=${key}`,
        captured: meta.date,
      };
    } catch {
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();

  inFlight.set(id, req);
  const result = await req;
  cache.set(id, result);
  return result;
}
