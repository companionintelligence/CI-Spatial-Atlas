import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoPlace } from '../src/memory/geocode.js';

/**
 * Open geocoding: coordinate order, usage policy, and never throwing at the UI.
 *
 * Three things are worth a test here and they are all things that fail
 * *quietly*. Coordinate order is the first: every provider hands back its
 * bounding box in a different sequence and GeoJSON is [lon, lat], so a wrong
 * index does not crash — it flies the camera somewhere real and plausible. The
 * second is request volume: the public Photon and Nominatim instances are
 * somebody's goodwill, and a search box that fires per keystroke gets an origin
 * blocked rather than rate-limited. The third is failure: a geocoder that is
 * down must leave the search box empty and quiet, not throw into a keystroke
 * handler.
 *
 * The module holds a query cache in module scope, so each test imports a fresh
 * copy (`vi.resetModules()`) rather than reaching in to clear it — the same
 * pattern `test/streetview.test.ts` uses for its lookup cache.
 *
 * Nothing here touches the network: `fetch` is stubbed in every test, and the
 * one test that must not even resolve a hostname says so.
 */

async function load() {
  vi.resetModules();
  return import('../src/memory/geocode.js');
}

/**
 * Records every URL asked for, and answers with `body`. `gated` withholds the
 * answer until `open()`, which is how a test observes the state of a request
 * that is still in flight.
 */
function stubGeocoder(
  body: unknown,
  { ok = true, gated = false }: { ok?: boolean; gated?: boolean } = {},
) {
  const calls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!gated) release();

  const fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(String(url));
    signals.push(init?.signal);
    if (body === null) throw new Error('network down');
    await gate;
    return {
      ok,
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected token < in JSON');
        return body;
      },
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, signals, open: () => release() };
}

/** One Photon feature: Berlin, with its extent. */
const photonBerlin = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [13.3888599, 52.5170365] },
      properties: {
        osm_id: 240109189,
        osm_type: 'R',
        osm_key: 'place',
        osm_value: 'city',
        name: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        countrycode: 'DE',
        // [minLon, maxLat, maxLon, minLat] — west, NORTH, east, SOUTH.
        extent: [13.088346, 52.675454, 13.761161, 52.338234],
      },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Photon (the default)', () => {
  it('asks the public Photon instance, with a small limit', async () => {
    const { calls } = stubGeocoder(photonBerlin);
    const { geocode } = await load();

    await geocode('berlin', { lang: 'en' });

    const url = new URL(calls[0]!);
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api');
    expect(url.searchParams.get('q')).toBe('berlin');
    // A dropdown, not a results page.
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('lang')).toBe('en');
  });

  it('reads GeoJSON coordinates as [lon, lat], not [lat, lon]', async () => {
    stubGeocoder(photonBerlin);
    const { geocode } = await load();

    const [berlin] = (await geocode('berlin')) as GeoPlace[];
    // Swapping these puts Berlin in the Indian Ocean off Somalia — a real
    // place, no error, and nobody notices until a memory pin lands there.
    expect(berlin!.lat).toBeCloseTo(52.517, 3);
    expect(berlin!.lon).toBeCloseTo(13.389, 3);
  });

  it('unpicks Photon’s west/north/east/south extent into named bounds', async () => {
    stubGeocoder(photonBerlin);
    const { geocode } = await load();

    const [berlin] = await geocode('berlin');
    expect(berlin!.bounds).toEqual({
      west: 13.088346,
      south: 52.338234,
      east: 13.761161,
      north: 52.675454,
    });
    // The invariant the naming exists to protect: south < north, and the box
    // actually contains the point it came with.
    expect(berlin!.bounds!.south).toBeLessThan(berlin!.bounds!.north);
    expect(berlin!.lat).toBeGreaterThan(berlin!.bounds!.south);
    expect(berlin!.lat).toBeLessThan(berlin!.bounds!.north);
  });

  it('builds a label a list row can render without further work', async () => {
    stubGeocoder(photonBerlin);
    const { geocode } = await load();

    const [berlin] = await geocode('berlin');
    expect(berlin!.name).toBe('Berlin');
    // Photon answers Berlin with name=Berlin, state=Berlin, country=Germany.
    // The naive join reads "Berlin, Berlin, Germany"; the repeat is collapsed,
    // and the label and the detail line agree about it.
    expect(berlin!.detail).toBe('Germany');
    expect(berlin!.label).toBe('Berlin, Germany');
    expect(berlin!.kind).toBe('city');
    expect(berlin!.source).toBe('photon');
    expect(berlin!.id).toBeTruthy();
  });

  it('biases towards the camera when told where it is looking', async () => {
    const { calls } = stubGeocoder(photonBerlin);
    const { geocode } = await load();

    await geocode('museum', { near: { lat: 52.5, lon: 13.4 } });
    const url = new URL(calls[0]!);
    expect(url.searchParams.get('lat')).toBe('52.5');
    expect(url.searchParams.get('lon')).toBe('13.4');
  });

  it('drops rows whose coordinates are missing or out of range', async () => {
    stubGeocoder({
      features: [
        { geometry: { coordinates: [200, 95] }, properties: { name: 'Nowhere' } },
        { geometry: {}, properties: { name: 'Also nowhere' } },
        photonBerlin.features[0],
      ],
    });
    const { geocode } = await load();

    const places = await geocode('berlin');
    expect(places).toHaveLength(1);
    expect(places[0]!.name).toBe('Berlin');
  });
});

describe('other providers drop in without a rewrite', () => {
  it('speaks Nominatim, string coordinates and [south, north, west, east] box', async () => {
    const { calls } = stubGeocoder([
      {
        place_id: 1,
        osm_type: 'relation',
        osm_id: 62422,
        lat: '52.5170365',
        lon: '13.3888599',
        name: 'Berlin',
        display_name: 'Berlin, Germany',
        category: 'boundary',
        type: 'administrative',
        boundingbox: ['52.338234', '52.675454', '13.088346', '13.761161'],
      },
    ]);
    const { geocode } = await load();

    const [berlin] = await geocode('berlin', { provider: 'nominatim', lang: 'en' });

    const url = new URL(calls[0]!);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('6');
    // No VITE_GEOCODER_EMAIL is configured in the suite, so nothing is sent —
    // an address must never be invented on a user's behalf.
    expect(url.searchParams.get('email')).toBeNull();

    expect(berlin!.lat).toBeCloseTo(52.517, 3);
    expect(berlin!.lon).toBeCloseTo(13.389, 3);
    expect(berlin!.bounds).toEqual({
      west: 13.088346,
      south: 52.338234,
      east: 13.761161,
      north: 52.675454,
    });
    expect(berlin!.name).toBe('Berlin');
    expect(berlin!.detail).toBe('Germany');
    expect(berlin!.source).toBe('nominatim');
  });

  it('speaks Pelias, whose bbox is the GeoJSON order', async () => {
    const { calls } = stubGeocoder({
      features: [
        {
          type: 'Feature',
          bbox: [13.088346, 52.338234, 13.761161, 52.675454],
          geometry: { coordinates: [13.3888599, 52.5170365] },
          properties: {
            gid: 'whosonfirst:locality:101748283',
            name: 'Berlin',
            label: 'Berlin, Germany',
            layer: 'locality',
          },
        },
      ],
    });
    const { geocode } = await load();

    const [berlin] = await geocode('berlin', { provider: 'pelias' });

    expect(new URL(calls[0]!).searchParams.get('text')).toBe('berlin');
    expect(new URL(calls[0]!).searchParams.get('size')).toBe('6');
    expect(berlin!.bounds).toEqual({
      west: 13.088346,
      south: 52.338234,
      east: 13.761161,
      north: 52.675454,
    });
    expect(berlin!.detail).toBe('Germany');
    expect(berlin!.source).toBe('pelias');
  });
});

describe('endpoint configuration', () => {
  it('appends the provider’s search path to a bare origin, and leaves a full URL alone', async () => {
    const { geocoderConfig } = await load();

    expect(geocoderConfig({ VITE_GEOCODER_URL: 'https://photon.example.org' }).endpoint).toBe(
      'https://photon.example.org/api',
    );
    expect(geocoderConfig({ VITE_GEOCODER_URL: 'https://photon.example.org/' }).endpoint).toBe(
      'https://photon.example.org/api',
    );
    // A deployment behind a path prefix knows better than we do.
    expect(
      geocoderConfig({ VITE_GEOCODER_URL: 'https://gw.example.org/geo/api' }).endpoint,
    ).toBe('https://gw.example.org/geo/api');
  });

  it('takes the named provider, and sniffs the URL only when none is named', async () => {
    const { geocoderConfig } = await load();

    expect(geocoderConfig({}).provider).toBe('photon');
    expect(
      geocoderConfig({ VITE_GEOCODER_URL: 'https://nominatim.example.org' }).provider,
    ).toBe('nominatim');
    expect(
      geocoderConfig({ VITE_GEOCODER_URL: 'https://pelias.example.org' }).endpoint,
    ).toBe('https://pelias.example.org/v1/search');
    // An explicit setting always wins over the sniff.
    expect(
      geocoderConfig({
        VITE_GEOCODER_URL: 'https://search.example.org',
        VITE_GEOCODER_PROVIDER: 'nominatim',
      }).provider,
    ).toBe('nominatim');
  });

  it('sends the Nominatim identification address only to Nominatim', async () => {
    const { geocoderConfig } = await load();
    const env = { VITE_GEOCODER_EMAIL: 'ops@example.org', VITE_GEOCODER_PROVIDER: 'nominatim' };
    expect(geocoderConfig(env).email).toBe('ops@example.org');
  });
});

describe('failure is silence, not an exception', () => {
  it('answers a dead geocoder with no results', async () => {
    stubGeocoder(null);
    const { geocode } = await load();
    await expect(geocode('berlin')).resolves.toEqual([]);
  });

  it('answers a 429 or a 502 with no results', async () => {
    stubGeocoder(photonBerlin, { ok: false });
    const { geocode } = await load();
    await expect(geocode('berlin')).resolves.toEqual([]);
  });

  it('answers a proxy’s HTML error page with no results', async () => {
    stubGeocoder(undefined); // res.json() throws
    const { geocode } = await load();
    await expect(geocode('berlin')).resolves.toEqual([]);
  });

  it('answers a well-formed response of the wrong shape with no results', async () => {
    stubGeocoder({ error: 'unauthorized' });
    const { geocode } = await load();
    await expect(geocode('berlin')).resolves.toEqual([]);
  });
});

describe('usage policy', () => {
  it('sends nothing for a query too short to mean anything', async () => {
    const { calls } = stubGeocoder(photonBerlin);
    const { geocode } = await load();

    expect(await geocode('b')).toEqual([]);
    expect(await geocode('   ')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('re-asks nothing for a query it has already answered', async () => {
    const { calls } = stubGeocoder(photonBerlin);
    const { geocode } = await load();

    await geocode('berlin');
    await geocode('berlin');
    // Backspacing through a query replays it constantly; case included.
    await geocode('Berlin');

    expect(calls).toHaveLength(1);
  });

  it('does not cache a failure', async () => {
    const { calls } = stubGeocoder(null);
    const { geocode } = await load();

    await geocode('berlin');
    vi.unstubAllGlobals();
    const second = stubGeocoder(photonBerlin);
    const places = await geocode('berlin');

    // One 502 must not turn into a permanently empty search box for that word.
    expect(calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
    expect(places).toHaveLength(1);
  });

  it('sends no credentials to a third party', async () => {
    stubGeocoder(photonBerlin);
    const { geocode } = await load();
    await geocode('berlin');

    const init = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as {
      credentials?: string;
      headers?: Record<string, string>;
    };
    expect(init.credentials).toBe('omit');
    // `accept` is CORS-safelisted, so it adds no preflight. Any other header
    // would, and the public instances answer an unknown origin's preflight
    // with a 403.
    expect(Object.keys(init.headers ?? {})).toEqual(['accept']);
  });
});

describe('a box worth flying to', () => {
  it('rejects the ~10 m box Nominatim attaches to a house number', async () => {
    // The reason this predicate exists, taken from a real jsonv2 row: Nominatim
    // returns a `boundingbox` for *every* result, addresses included, so a
    // caller that frames `bounds` whenever it is present puts the camera at
    // roof height — or under the terrain — on exactly the search that the
    // "cities get framed, points get an altitude" rule was written for.
    stubGeocoder([
      {
        place_id: 2,
        osm_type: 'node',
        osm_id: 1,
        lat: '52.5170365',
        lon: '13.3888599',
        name: '10',
        display_name: '10, Unter den Linden, Berlin, Germany',
        category: 'place',
        type: 'house',
        boundingbox: ['52.5169865', '52.5170865', '13.3888099', '13.3889099'],
      },
    ]);
    const { geocode, isFramableBounds } = await load();

    const [house] = await geocode('unter den linden 10', { provider: 'nominatim' });

    // The box is still carried through — it is what the provider said.
    expect(house!.bounds).toBeDefined();
    // It is simply not something to point a camera at.
    expect(isFramableBounds(house!.bounds)).toBe(false);
  });

  it('accepts a city, and a street that is wide in only one direction', async () => {
    const { isFramableBounds, MIN_FRAME_SPAN_DEG } = await load();

    expect(isFramableBounds({ west: 13.088, south: 52.338, east: 13.761, north: 52.675 })).toBe(true);
    // Cesium frames a rectangle by its larger dimension, so a long thin road
    // still gives a sane altitude; requiring both spans would send every street
    // back to the 1,800 km fallback.
    expect(
      isFramableBounds({ west: 13.0, south: 52.5, east: 13.0 + MIN_FRAME_SPAN_DEG * 4, north: 52.5001 }),
    ).toBe(true);
  });

  it('rejects a missing, degenerate, inverted or malformed box', async () => {
    const { isFramableBounds } = await load();

    expect(isFramableBounds(undefined)).toBe(false);
    expect(isFramableBounds({ west: 13, south: 52, east: 13, north: 52 })).toBe(false);
    // east < west from a geocoder means a box crossing the antimeridian, and
    // Cesium reads that rectangle the long way round — framing most of the
    // planet instead of the place.
    expect(isFramableBounds({ west: 179.9, south: -17, east: -179.9, north: -16 })).toBe(false);
    // `!(span > 0)` rather than `span <= 0`, so a NaN out of a malformed
    // response is rejected instead of quietly passing a comparison.
    expect(isFramableBounds({ west: Number.NaN, south: 52, east: 14, north: 53 })).toBe(false);
  });
});

describe('createPlaceSearch — one request per typing pause', () => {
  it('collapses a burst of keystrokes into a single request', async () => {
    vi.useFakeTimers();
    const { calls } = stubGeocoder(photonBerlin);
    const { createPlaceSearch } = await load();
    const search = createPlaceSearch({ lang: 'en' });

    const a = search.search('be');
    const b = search.search('ber');
    const c = search.search('berlin');
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(400);

    // The superseded calls resolve — with null, not [] — so a keystroke
    // handler awaiting one is never left pending for the life of the page, and
    // the list it is showing is not blanked on the way to the next answer.
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect((await c)!.map((p) => p.name)).toEqual(['Berlin']);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).searchParams.get('q')).toBe('berlin');
  });

  it('clears the list at once when the box is emptied, without a request', async () => {
    vi.useFakeTimers();
    const { calls } = stubGeocoder(photonBerlin);
    const { createPlaceSearch } = await load();
    const search = createPlaceSearch();

    // Resolves immediately — no debounce to wait out, because an emptied box
    // should not keep showing the previous query's results for 300 ms.
    await expect(search.search('')).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('aborts the request in flight when cancelled', async () => {
    vi.useFakeTimers();
    // Gated, so the request is genuinely still open when cancel() lands — the
    // component-unmount case, not a race the test happened to win.
    const { signals, open } = stubGeocoder(photonBerlin, { gated: true });
    const { createPlaceSearch } = await load();
    const search = createPlaceSearch();

    const pending = search.search('berlin');
    await vi.advanceTimersByTimeAsync(400);
    search.cancel();

    expect(await pending).toBeNull();
    expect(signals[0]?.aborted).toBe(true);
    open();
  });

  it('never paces faster than the provider’s own floor', async () => {
    vi.useFakeTimers();
    const { calls } = stubGeocoder([]);
    const { createPlaceSearch } = await load();
    // Nominatim's usage policy caps absolute use at one request per second, so
    // the tempting "feels instant" 50 ms is four times over the line and the
    // penalty is a blocked origin, not a slow search box.
    const search = createPlaceSearch({ provider: 'nominatim', waitMs: 50 });

    const pending = search.search('berlin');
    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toHaveLength(1);
    expect(await pending).toEqual([]);
  });
});
