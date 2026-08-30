/**
 * Historical weather for a memory, from Open-Meteo's archive API.
 *
 * The archive endpoint is keyless and sends `Access-Control-Allow-Origin: *`,
 * so the browser can call it directly — no proxy, no credential, nothing for an
 * operator to provision. That matters here: every other candidate (Google,
 * Cesium ion) needs a key someone has to widen or pay for.
 *
 * Deliberately the *archive*, not a forecast. These memories are years old; what
 * makes "9:52 AM, October 2016" feel real is the weather that was actually
 * happening then, not today's. Reanalysis data starts in 1940 and lags real time
 * by ~5 days, so very recent memories legitimately return nothing — treated as
 * "unknown" rather than an error.
 */

export interface MemoryWeather {
  /** Celsius at the memory's hour. */
  tempC: number;
  /** WMO weather code. */
  code: number;
  label: string;
}

/** WMO 4677 weather codes, grouped to the distinctions a person would notice. */
function labelFor(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

const cache = new Map<string, MemoryWeather | null>();
const inFlight = new Map<string, Promise<MemoryWeather | null>>();

/**
 * One archive lookup per (place, day) — memories cluster heavily on both, so a
 * person's 50 visits to one venue would otherwise be 50 identical requests.
 */
function keyFor(lat: number, lon: number, day: string): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)},${day}`;
}

export async function fetchMemoryWeather(
  lat: number,
  lon: number,
  timeMs: number,
  signal?: AbortSignal,
): Promise<MemoryWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timeMs)) return null;

  const d = new Date(timeMs);
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const key = keyFor(lat, lon, day);

  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${day}&end_date=${day}&hourly=temperature_2m,weather_code&timezone=auto`;

  const req = (async (): Promise<MemoryWeather | null> => {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        hourly?: { time?: string[]; temperature_2m?: (number | null)[]; weather_code?: (number | null)[] };
      };
      const temps = json.hourly?.temperature_2m;
      const codes = json.hourly?.weather_code;
      if (!Array.isArray(temps) || !Array.isArray(codes)) return null;

      // `timezone=auto` returns local hours, so index by the local hour of the
      // memory rather than UTC — otherwise an evening event reads as its
      // morning weather.
      const hour = Math.min(23, Math.max(0, d.getHours()));
      const tempC = temps[hour];
      const code = codes[hour];
      if (typeof tempC !== 'number' || typeof code !== 'number') return null;
      return { tempC, code, label: labelFor(code) };
    } catch {
      return null; // offline, or a date the archive doesn't cover yet
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, req);
  const result = await req;
  cache.set(key, result);
  return result;
}
