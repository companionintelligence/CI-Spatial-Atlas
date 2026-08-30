import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMemoryWeather } from '../src/memory/weather.js';

/**
 * The archive answers on the *place's* calendar (`timezone=auto`), and these
 * assertions are written so they hold whatever timezone the runner is in — the
 * bug being locked out was precisely that the reading depended on where the
 * viewer's browser happened to be, not on where the memory happened.
 */

const PDT = -25200; // America/Los_Angeles in October

/** Three days of hourly rows; temperature encodes (dayIndex, hour) so a wrong
 *  pick is unmistakable rather than merely a degree or two off. */
function archive(days: string[], offsetSec = PDT, hole?: string) {
  const time: string[] = [];
  const temperature_2m: (number | null)[] = [];
  const weather_code: (number | null)[] = [];
  days.forEach((day, d) => {
    for (let h = 0; h < 24; h++) {
      const stamp = `${day}T${String(h).padStart(2, '0')}:00`;
      time.push(stamp);
      const missing = hole === stamp;
      temperature_2m.push(missing ? null : d * 100 + h);
      weather_code.push(missing ? null : 0);
    }
  });
  return { utc_offset_seconds: offsetSec, hourly: { time, temperature_2m, weather_code } };
}

const OCT = ['2015-10-21', '2015-10-22', '2015-10-23'];

function stubFetch(body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => body } as Response;
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('historical weather', () => {
  it('reads the hour on the place\'s own day, not the UTC one', async () => {
    const calls = stubFetch(archive(OCT));
    // 7:00 PM on 21 Oct in Los Angeles — already 22 Oct in UTC. Asking the
    // archive for the UTC day returned the *next* day's sky.
    const w = await fetchMemoryWeather(33.9560, -118.3707, Date.UTC(2015, 9, 22, 2, 0));

    expect(w?.tempC).toBe(19); // day 0 (21 Oct), hour 19
    // The window has to straddle the UTC day for the local day to be in it.
    expect(calls[0]).toContain('start_date=2015-10-21');
    expect(calls[0]).toContain('end_date=2015-10-23');
  });

  it('gives each memory its own hour from one shared request', async () => {
    const calls = stubFetch(archive(OCT));
    // Same venue, same day, two visits — 09:00 and 13:00 local on 22 Oct.
    const morning = await fetchMemoryWeather(40.1, -74.1, Date.UTC(2015, 9, 22, 16, 0));
    const afternoon = await fetchMemoryWeather(40.1, -74.1, Date.UTC(2015, 9, 22, 20, 0));

    // Caching a single reading per place-day handed every visit to a venue the
    // weather of whichever one was focused first.
    expect(morning?.tempC).toBe(109); // day 1 (22 Oct), hour 09
    expect(afternoon?.tempC).toBe(113);
    expect(calls).toHaveLength(1);
  });

  it('reports nothing when the archive has no reading for that hour', async () => {
    stubFetch(archive(OCT, PDT, '2015-10-21T19:00'));
    // The inspector drops the chip entirely on null — a blank chip would read as
    // a broken lookup rather than an unknown sky.
    await expect(fetchMemoryWeather(51.5, -0.1, Date.UTC(2015, 9, 22, 2, 0))).resolves.toBeNull();
  });

  it('reports nothing when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(fetchMemoryWeather(-33.9, 151.2, Date.UTC(2015, 9, 22, 2, 0))).resolves.toBeNull();
  });
});
