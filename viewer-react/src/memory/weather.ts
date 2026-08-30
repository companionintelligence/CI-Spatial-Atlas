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

/**
 * The hours the archive returned, kept whole rather than reduced to one
 * memory's answer. The cache is keyed by (place, day) and a day holds memories
 * at different hours — collapsing it to a single reading handed a 9 PM dinner
 * the weather of that morning's 9 AM meeting at the same venue.
 */
interface DayHours {
  /** Seconds to add to a UTC instant to get the place's own wall clock. */
  offsetSec: number;
  /** Local ISO stamps, e.g. "2016-03-23T18:00". */
  time: string[];
  tempC: (number | null)[];
  code: (number | null)[];
}

const cache = new Map<string, DayHours | null>();
const inFlight = new Map<string, Promise<DayHours | null>>();

/**
 * One archive lookup per (place, day) — memories cluster heavily on both, so a
 * person's 50 visits to one venue would otherwise be 50 identical requests.
 */
function keyFor(lat: number, lon: number, day: string): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)},${day}`;
}

const DAY_MS = 86_400_000;

/** The UTC calendar date of an instant, as the archive's `YYYY-MM-DD`. */
function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The place's own wall-clock hour for an instant, as `YYYY-MM-DDTHH`. */
function localHourStamp(ms: number, offsetSec: number): string {
  return new Date(ms + offsetSec * 1000).toISOString().slice(0, 13);
}

export async function fetchMemoryWeather(
  lat: number,
  lon: number,
  timeMs: number,
  signal?: AbortSignal,
): Promise<MemoryWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timeMs)) return null;

  const key = keyFor(lat, lon, utcDay(timeMs));

  // Ask for the day either side as well. `timezone=auto` makes the archive
  // answer on the *place's* calendar, while the cache key is a UTC date, and the
  // two disagree for every memory whose local evening falls after UTC midnight —
  // which is every evening in the Americas. Asking for one UTC day therefore
  // returned the wrong day's sky: a 6 PM memory on 23 Mar 2016 in Santa Monica
  // was reported "22°C · Clear" off 24 Mar, when 23 Mar was 21°C and partly
  // cloudy. A three-day window guarantees the memory's own local day is in the
  // response, and `utc_offset_seconds` says which row to read.
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${utcDay(timeMs - DAY_MS)}&end_date=${utcDay(timeMs + DAY_MS)}` +
    `&hourly=temperature_2m,weather_code&timezone=auto`;

  const hours = await loadDayHours(key, url, signal);
  if (!hours) return null;

  // Floor to the hour the memory started in — the archive's row at 18:00 covers
  // 18:00–19:00 local.
  const stamp = localHourStamp(timeMs, hours.offsetSec);
  const i = hours.time.findIndex((t) => t.startsWith(stamp));
  if (i < 0) return null;

  const tempC = hours.tempC[i];
  const code = hours.code[i];
  if (!Number.isFinite(tempC) || !Number.isFinite(code)) return null;
  return { tempC: tempC as number, code: code as number, label: labelFor(code as number) };
}

/** Fetch (or reuse) one place-day's hourly series. */
async function loadDayHours(key: string, url: string, signal?: AbortSignal): Promise<DayHours | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const req = (async (): Promise<DayHours | null> => {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        utc_offset_seconds?: number;
        hourly?: { time?: string[]; temperature_2m?: (number | null)[]; weather_code?: (number | null)[] };
      };
      const time = json.hourly?.time;
      const tempC = json.hourly?.temperature_2m;
      const code = json.hourly?.weather_code;
      if (!Array.isArray(time) || !Array.isArray(tempC) || !Array.isArray(code)) return null;
      return {
        offsetSec: Number.isFinite(json.utc_offset_seconds) ? (json.utc_offset_seconds as number) : 0,
        time,
        tempC,
        code,
      };
    } catch {
      return null; // offline, or a date the archive doesn't cover yet
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, req);
  const result = await req;
  // An aborted request must not poison the cache — the next focus on this same
  // place-day would inherit the null and show no weather for the rest of the
  // session. Only a real answer (or a real refusal) is worth remembering.
  if (!signal?.aborted) cache.set(key, result);
  return result;
}
