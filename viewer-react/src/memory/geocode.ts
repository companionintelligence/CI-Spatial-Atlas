/**
 * Place search — "jump to a place" — against an open geocoder.
 *
 * The rest of the viewer's place lookups go through Google (Street View,
 * Photorealistic 3D Tiles). Search does not have to: Photon, Nominatim and
 * Pelias all answer the same question from OpenStreetMap data, all three are
 * self-hostable, and none of them needs a key. That matters more here than for
 * imagery, because a search box is where the user's *typing* goes — every
 * keystroke of "the hospital where dad was" would otherwise be egress to a
 * third party under their terms, tied to the browsing session.
 *
 * Photon (Komoot) is the default: it is built for exactly this — type-ahead
 * over OSM, tolerant of half-typed words, no key, CORS open, and a documented
 * self-hosting path (`photon.komoot.io` is a courtesy instance, not an SLA).
 * Nominatim and Pelias are adapters rather than a rewrite, because a deployment
 * that already runs one of them should not have to run a second geocoder.
 *
 * ## Usage policy, and what a browser can actually do about it
 *
 * All three public instances ask not to be hammered. What this module does:
 *
 *   - debounces typing (`createPlaceSearch`), and never falls below the
 *     provider's own documented floor — Nominatim's is one request per second,
 *     which no 300 ms debounce respects;
 *   - asks for a handful of results, not a page of fifty;
 *   - caches recent answers, so backspacing through a query re-queries nothing;
 *   - sends nothing until there are at least two characters to search for;
 *   - aborts the in-flight request when a newer keystroke supersedes it.
 *
 * Identifying the caller is the awkward one. Nominatim's policy asks for an
 * identifying `User-Agent` — which a browser will not let anyone set, and
 * setting any custom header here would turn every search into a CORS preflight
 * that the public instances answer with a 403. So identification rides on the
 * two channels that survive: the `Referer` the browser sends by itself, and
 * Nominatim's documented `email=` parameter, which a deployment opts into with
 * `VITE_GEOCODER_EMAIL`. That address is only ever sent to a Nominatim
 * endpoint — Photon and Pelias neither want nor get it.
 *
 * Nothing here throws at the UI. A search box whose geocoder is down should go
 * quiet, not red: every failure path resolves to an empty list, because "no
 * results" is a state the UI already has to draw and "the geocoder 502'd" is
 * not one worth teaching it.
 */

export type GeocoderProvider = 'photon' | 'nominatim' | 'pelias';

/**
 * A bounding box in degrees, named rather than positional.
 *
 * Every geocoder here orders its bbox differently — Photon's `extent` is
 * [west, north, east, south], Nominatim's `boundingbox` is [south, north, west,
 * east] *as strings*, Pelias's `bbox` is [west, south, east, north]. A tuple
 * would make all three look alike at the call site and let one wrong index ship
 * as a camera that flies to the antipodes. Named fields also drop straight into
 * `Cesium.Rectangle.fromDegrees(west, south, east, north)`.
 */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GeoPlace {
  /** Stable within a result set — safe as a React key. */
  id: string;
  /** One line, the whole thing: "Berlin, Germany". */
  label: string;
  /** The place itself: "Berlin". */
  name: string;
  /** Everything after the name: "Germany". Absent when the label is just the name. */
  detail?: string;
  lat: number;
  lon: number;
  /**
   * Whatever extent the provider volunteered, faithfully, and *not* a promise
   * that the row is bigger than a doorway.
   *
   * The tempting reading — "present for a city, absent for an address" — is
   * only true of Photon, which emits `extent` for ways and relations and
   * nothing for a point. Nominatim's jsonv2 attaches a `boundingbox` to *every*
   * row including house numbers and POIs, so a street address arrives here with
   * a box about 1e-4 degrees (~10 m) across. A UI that flies to `bounds`
   * whenever it exists therefore ends up inside the roof on exactly the search
   * the distinction was invented for.
   *
   * So the box is data and the decision is a separate question: ask
   * `isFramableBounds` before framing, and fall back to the point at a fixed
   * altitude when it says no.
   */
  bounds?: GeoBounds;
  /** OSM-ish class: "city", "restaurant", "administrative". For an icon or a filter. */
  kind?: string;
  source: GeocoderProvider;
}

/**
 * The smallest box worth pointing a camera at, in degrees — ~550 m of latitude.
 *
 * Chosen as "a city block or larger". Below it the interesting thing on screen
 * is the surroundings, not the footprint, and a camera framed to a 10 m
 * rectangle sits at roof height (or under the terrain, which is worse: the
 * globe fills the screen with brown and the user cannot tell they arrived).
 */
export const MIN_FRAME_SPAN_DEG = 0.005;

/**
 * Is this box something a camera can usefully frame?
 *
 * Three ways it is not, and they fail differently:
 *
 *   - degenerate (a provider that repeated one corner) — `Rectangle.fromDegrees`
 *     accepts it and the camera dives at a zero-area target;
 *   - inverted, i.e. `east < west` — the only honest reading of that from a
 *     geocoder is a box crossing the antimeridian, and Cesium reads the
 *     rectangle the long way round instead, framing most of the planet;
 *   - real but tiny, which is the common one: see `GeoPlace.bounds`.
 *
 * `!(span > 0)` rather than `span <= 0` so a NaN from a malformed response is
 * rejected rather than silently passing a comparison.
 *
 * Either span is enough. Cesium frames a rectangle by its larger dimension, so
 * a long thin street (wide in longitude, a hair tall) still yields a sane
 * altitude; requiring both would push every road back to the 1,800 km fallback.
 */
export function isFramableBounds(b: GeoBounds | undefined): boolean {
  if (!b) return false;
  const width = b.east - b.west;
  const height = b.north - b.south;
  if (!(width > 0) || !(height > 0)) return false;
  return width >= MIN_FRAME_SPAN_DEG || height >= MIN_FRAME_SPAN_DEG;
}

export interface GeocodeOptions {
  /** Default 6. The list is a dropdown, not a results page. */
  limit?: number;
  signal?: AbortSignal;
  /** Photon/Pelias language hint, e.g. "en". Defaults to the browser's. */
  lang?: string;
  /** Bias results towards where the camera is looking. Cheap, and hugely improves short queries. */
  near?: { lat: number; lon: number };
  /** Overrides the configured provider/endpoint. Mostly for tests and for a deployment with two geocoders. */
  provider?: GeocoderProvider;
  endpoint?: string;
}

export const MIN_QUERY_LENGTH = 2;
export const DEFAULT_LIMIT = 6;

/**
 * Per-provider request floor, in ms — the minimum spacing `createPlaceSearch`
 * will allow between requests.
 *
 * Nominatim's is not a suggestion: its usage policy caps absolute use at one
 * request per second and blocks by origin above it. Photon asks only to be
 * treated fairly; 300 ms is roughly "one request per typing pause".
 */
const MIN_INTERVAL_MS: Record<GeocoderProvider, number> = {
  photon: 300,
  nominatim: 1100,
  pelias: 300,
};

const DEFAULT_ENDPOINTS: Record<GeocoderProvider, string> = {
  photon: 'https://photon.komoot.io/api',
  nominatim: 'https://nominatim.openstreetmap.org/search',
  pelias: 'https://api.geocode.earth/v1/search',
};

/** The search path each provider serves, appended when the configured URL is a bare origin. */
const DEFAULT_PATHS: Record<GeocoderProvider, string> = {
  photon: '/api',
  nominatim: '/search',
  pelias: '/v1/search',
};

type ViteEnv = Record<string, string | undefined>;
const readEnv = (): ViteEnv => (import.meta as unknown as { env?: ViteEnv }).env ?? {};
const setting = (env: ViteEnv, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

export interface GeocoderConfig {
  provider: GeocoderProvider;
  endpoint: string;
  /** Nominatim only. See the header note on identifying a browser caller. */
  email?: string;
}

/**
 * Resolve the configured geocoder.
 *
 * `VITE_GEOCODER_URL` may be a bare origin (`https://photon.example.org`) or a
 * full search endpoint (`https://photon.example.org/api`); the provider's own
 * path is appended only in the first case, so a deployment behind a path prefix
 * or an odd route is not second-guessed.
 *
 * `VITE_GEOCODER_PROVIDER` names the dialect. When it is unset the URL is
 * sniffed — a courtesy for the common case of pointing at a public instance,
 * and no more than that: anything unrecognised is treated as Photon, which is
 * the default the endpoint list is built around.
 */
export function geocoderConfig(env: ViteEnv = readEnv()): GeocoderConfig {
  const raw = setting(env, 'VITE_GEOCODER_URL');
  const named = setting(env, 'VITE_GEOCODER_PROVIDER')?.toLowerCase();
  const provider: GeocoderProvider =
    named === 'nominatim' || named === 'pelias' || named === 'photon'
      ? named
      : sniffProvider(raw);
  return {
    provider,
    endpoint: raw ? endpointFor(raw, provider) : DEFAULT_ENDPOINTS[provider],
    email: setting(env, 'VITE_GEOCODER_EMAIL'),
  };
}

function sniffProvider(url: string | undefined): GeocoderProvider {
  if (!url) return 'photon';
  const u = url.toLowerCase();
  if (u.includes('nominatim')) return 'nominatim';
  if (u.includes('pelias') || u.includes('geocode.earth')) return 'pelias';
  return 'photon';
}

function endpointFor(raw: string, provider: GeocoderProvider): string {
  const trimmed = raw.replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    // A bare origin means "you know where the search path is"; anything else is
    // taken literally, prefix and all.
    return u.pathname === '' || u.pathname === '/'
      ? `${u.origin}${DEFAULT_PATHS[provider]}`
      : trimmed;
  } catch {
    // Not parseable as absolute (a relative path behind the app's own origin,
    // say). Nothing sensible to add, so leave it exactly as configured.
    return trimmed;
  }
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

function buildUrl(
  query: string,
  cfg: GeocoderConfig,
  opts: GeocodeOptions,
  limit: number,
  lang: string | undefined,
): string {
  const url = new URL(cfg.endpoint, globalThis.location?.href ?? 'http://localhost');
  const p = url.searchParams;
  if (cfg.provider === 'nominatim') {
    p.set('q', query);
    // jsonv2 over json: it carries `name` and `category` separately from
    // `display_name`, so the list can show a place without re-splitting a
    // comma-joined string.
    p.set('format', 'jsonv2');
    p.set('limit', String(limit));
    p.set('addressdetails', '0');
    if (lang) p.set('accept-language', lang);
    if (opts.near) {
      // viewbox is x1,y1,x2,y2 = lon,lat,lon,lat. Unbounded: a bias, not a filter —
      // a search for a city you are not looking at must still find it.
      const { lat, lon } = opts.near;
      p.set('viewbox', `${lon - 1},${lat + 1},${lon + 1},${lat - 1}`);
      p.set('bounded', '0');
    }
    if (cfg.email) p.set('email', cfg.email);
  } else if (cfg.provider === 'pelias') {
    p.set('text', query);
    p.set('size', String(limit));
    if (lang) p.set('lang', lang);
    if (opts.near) {
      p.set('focus.point.lat', String(opts.near.lat));
      p.set('focus.point.lon', String(opts.near.lon));
    }
  } else {
    p.set('q', query);
    p.set('limit', String(limit));
    if (lang) p.set('lang', lang);
    if (opts.near) {
      p.set('lat', String(opts.near.lat));
      p.set('lon', String(opts.near.lon));
    }
  }
  return url.toString();
}

const browserLang = (): string | undefined => {
  const l = globalThis.navigator?.language;
  return l ? l.split('-')[0] : undefined;
};

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const finite = (n: unknown): number | undefined => {
  const v = typeof n === 'string' ? Number.parseFloat(n) : typeof n === 'number' ? n : Number.NaN;
  return Number.isFinite(v) ? v : undefined;
};

/** Degrees only. A geocoder that answers with a swapped lat/lon puts the pin in the sea; drop it instead. */
const validLatLon = (lat: number, lon: number): boolean =>
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

function boundsOf(
  west: unknown,
  south: unknown,
  east: unknown,
  north: unknown,
): GeoBounds | undefined {
  const w = finite(west);
  const s = finite(south);
  const e = finite(east);
  const n = finite(north);
  if (w === undefined || s === undefined || e === undefined || n === undefined) return undefined;
  if (!validLatLon(s, w) || !validLatLon(n, e)) return undefined;
  return { west: w, south: s, east: e, north: n };
}

/**
 * Clean up a label's parts: drop blanks, and drop a part that repeats the one
 * before it.
 *
 * The repeat is not hypothetical — OSM's administrative hierarchy is full of
 * city-states and self-named regions, so Photon answers "Berlin" with
 * name=Berlin, state=Berlin, country=Germany, and the naive join reads
 * "Berlin, Berlin, Germany". Only *consecutive* repeats are collapsed: "Paris,
 * Texas, United States" is not the same claim twice, and a genuinely repeated
 * name further down the hierarchy is usually disambiguating.
 */
function labelParts(parts: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw?.trim();
    if (!part) continue;
    if (out[out.length - 1] === part) continue;
    out.push(part);
  }
  return out;
}

const joinParts = (parts: (string | undefined)[]): string => labelParts(parts).join(', ');

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  osm_id?: number | string;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  extent?: unknown[];
}

function parsePhoton(body: unknown, index: number): GeoPlace | undefined {
  const f = body as { geometry?: { coordinates?: unknown[] }; properties?: PhotonProps };
  const coords = f.geometry?.coordinates;
  // GeoJSON is [lon, lat]. Getting this backwards is the single most common
  // geocoding bug there is, and it fails quietly — the pin lands somewhere real.
  const lon = finite(coords?.[0]);
  const lat = finite(coords?.[1]);
  if (lat === undefined || lon === undefined || !validLatLon(lat, lon)) return undefined;

  const p = f.properties ?? {};
  const street = joinParts([p.housenumber, p.street]);
  // First field that actually says something. Photon omits `name` for plain
  // addresses and for some administrative rows, and `??` alone would settle on
  // an empty string as though it were an answer.
  const name =
    [p.name, street, p.city, p.state, p.country].map((s) => s?.trim()).find((s) => s) ??
    'Unnamed place';
  // Assembled once and split, rather than built twice: the label and the detail
  // line have to agree about which parts were dropped, or the row reads
  // "Berlin / Berlin, Germany".
  const parts = labelParts([
    name,
    p.name && street ? street : undefined,
    p.district,
    p.city,
    p.county,
    p.state,
    p.country,
  ]);
  const detail = parts.slice(1).join(', ');

  return {
    // Photon repeats osm ids across layers (a city and its boundary relation),
    // so the array index is part of the key rather than a hope.
    id: `photon:${p.osm_type ?? ''}${p.osm_id ?? ''}:${index}`,
    label: parts.join(', '),
    name,
    detail: detail || undefined,
    lat,
    lon,
    // Photon's `extent` is [minLon, maxLat, maxLon, minLat] — west, NORTH,
    // east, SOUTH. Not the GeoJSON bbox order, and not anyone else's either.
    bounds: Array.isArray(p.extent) && p.extent.length === 4
      ? boundsOf(p.extent[0], p.extent[3], p.extent[2], p.extent[1])
      : undefined,
    kind: p.osm_value ?? p.type,
    source: 'photon',
  };
}

function parseNominatim(body: unknown, index: number): GeoPlace | undefined {
  const r = body as {
    place_id?: number | string;
    osm_type?: string;
    osm_id?: number | string;
    lat?: string;
    lon?: string;
    name?: string;
    display_name?: string;
    category?: string;
    type?: string;
    boundingbox?: unknown[];
  };
  // Nominatim returns coordinates as strings, always.
  const lat = finite(r.lat);
  const lon = finite(r.lon);
  if (lat === undefined || lon === undefined || !validLatLon(lat, lon)) return undefined;

  const display = r.display_name?.trim() ?? '';
  const segments = display ? display.split(',').map((s) => s.trim()) : [];
  const name = r.name?.trim() || segments[0] || 'Unnamed place';
  const detail = joinParts(segments.slice(name === segments[0] ? 1 : 0));

  return {
    id: `nominatim:${r.place_id ?? `${r.osm_type ?? ''}${r.osm_id ?? ''}`}:${index}`,
    label: display || joinParts([name, detail]),
    name,
    detail: detail || undefined,
    lat,
    lon,
    // boundingbox is [south, north, west, east], as strings.
    bounds: Array.isArray(r.boundingbox) && r.boundingbox.length === 4
      ? boundsOf(r.boundingbox[2], r.boundingbox[0], r.boundingbox[3], r.boundingbox[1])
      : undefined,
    kind: r.type ?? r.category,
    source: 'nominatim',
  };
}

function parsePelias(body: unknown, index: number): GeoPlace | undefined {
  const f = body as {
    bbox?: unknown[];
    geometry?: { coordinates?: unknown[] };
    properties?: { id?: string; gid?: string; name?: string; label?: string; layer?: string };
  };
  const lon = finite(f.geometry?.coordinates?.[0]);
  const lat = finite(f.geometry?.coordinates?.[1]);
  if (lat === undefined || lon === undefined || !validLatLon(lat, lon)) return undefined;

  const p = f.properties ?? {};
  const name = p.name?.trim() || p.label?.trim() || 'Unnamed place';
  const label = p.label?.trim() || name;
  // Pelias's label already starts with the name, so the detail is the remainder.
  const detail = label.startsWith(name) ? label.slice(name.length).replace(/^,\s*/, '') : label;

  return {
    id: `pelias:${p.gid ?? p.id ?? index}`,
    label,
    name,
    detail: detail || undefined,
    lat,
    lon,
    // GeoJSON bbox order: [west, south, east, north].
    bounds: Array.isArray(f.bbox) && f.bbox.length === 4
      ? boundsOf(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3])
      : undefined,
    kind: p.layer,
    source: 'pelias',
  };
}

function parse(provider: GeocoderProvider, payload: unknown, limit: number): GeoPlace[] {
  // Photon and Pelias answer with a FeatureCollection, Nominatim with a bare
  // array. A provider that answers with neither (an HTML error page from a
  // proxy, most likely) yields no rows rather than an exception.
  const rows: unknown[] =
    provider === 'nominatim'
      ? Array.isArray(payload)
        ? payload
        : []
      : Array.isArray((payload as { features?: unknown[] })?.features)
        ? ((payload as { features: unknown[] }).features)
        : [];

  const parseRow =
    provider === 'nominatim' ? parseNominatim : provider === 'pelias' ? parsePelias : parsePhoton;

  const out: GeoPlace[] = [];
  for (const [i, row] of rows.entries()) {
    const place = parseRow(row, i);
    if (place) out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Recent answers, bounded.
 *
 * Type-ahead re-asks the same question constantly — every backspace replays a
 * query that was just answered — and the public instances are somebody's
 * goodwill. 50 entries is a few minutes of typing; insertion order makes the
 * eviction the oldest key, which for a search box is the query furthest from
 * what is being typed now.
 *
 * Only successes are stored. A cached failure would turn one 502 into a
 * permanently empty search box for that word.
 */
const cache = new Map<string, GeoPlace[]>();
const CACHE_MAX = 50;

const cacheKey = (cfg: GeocoderConfig, query: string, limit: number, lang?: string) =>
  `${cfg.provider}|${cfg.endpoint}|${limit}|${lang ?? ''}|${query.toLowerCase()}`;

function remember(key: string, places: GeoPlace[]): void {
  cache.set(key, places);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * One search, one request. Resolves to `[]` for anything that goes wrong —
 * network, CORS, 429, an HTML error page where JSON was promised — because a
 * search box has exactly one way to say "nothing": an empty list.
 *
 * This is the un-paced primitive. Anything driven by typing should go through
 * `createPlaceSearch`, which debounces and respects the provider's request
 * floor; calling this per keystroke is what gets an origin blocked.
 */
export async function geocode(query: string, opts: GeocodeOptions = {}): Promise<GeoPlace[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const base = geocoderConfig();
  const provider = opts.provider ?? base.provider;
  const cfg: GeocoderConfig = {
    provider,
    // An explicit endpoint wins; otherwise the configured one, but only when it
    // is for the provider being asked for — overriding the provider without an
    // endpoint means "the public instance of *that* one", not "my Photon server
    // spoken to in Nominatim".
    endpoint:
      opts.endpoint ??
      (provider === base.provider ? base.endpoint : DEFAULT_ENDPOINTS[provider]),
    // The email is Nominatim's identification channel and nobody else's; a
    // provider override that lands on Photon must not carry it along.
    email: provider === 'nominatim' ? base.email : undefined,
  };
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 20));
  const lang = opts.lang ?? browserLang();

  const key = cacheKey(cfg, q, limit, lang);
  const hit = cache.get(key);
  // A copy: list UIs sort and splice what they are handed, and the cached array
  // would otherwise come back reordered — or emptied — for the next caller.
  if (hit) return hit.slice();

  try {
    const res = await fetch(buildUrl(q, cfg, opts, limit, lang), {
      signal: opts.signal,
      // `accept` is CORS-safelisted, so it adds no preflight. Any other header
      // would, and the public instances answer preflights from unknown origins
      // with a 403 — see the header note.
      headers: { accept: 'application/json' },
      // No credentials: this is a third party being asked where a place is, and
      // it has no business receiving this app's cookies.
      credentials: 'omit',
    });
    if (!res.ok) return [];
    const places = parse(cfg.provider, await res.json(), limit);
    remember(key, places);
    return places.slice();
  } catch {
    // Includes AbortError. A superseded keystroke is not a failure, and the
    // caller that aborted is not waiting on this answer anyway — see
    // `createPlaceSearch`, which distinguishes the two for the UI.
    return [];
  }
}

export interface PlaceSearch {
  /**
   * Resolves to the results for `query`, or to `null` when a newer call (or
   * `cancel()`) superseded this one.
   *
   * `null` rather than `[]` on purpose: a superseded search must leave whatever
   * is on screen alone. Resolving `[]` would blank the list on every keystroke
   * and make the results flash; throwing would make every caller write a catch
   * for something that is not an error. So the UI's whole contract is
   * `if (results) setResults(results)`.
   *
   * A query shorter than `MIN_QUERY_LENGTH` resolves to `[]` immediately and
   * sends nothing — an emptied box should clear its results at once, not after
   * a debounce.
   */
  search(query: string): Promise<GeoPlace[] | null>;
  /** Drop the pending search and abort any request in flight. Call from the component's cleanup. */
  cancel(): void;
}

/**
 * A debounced, self-superseding search for a text box.
 *
 * The pacing is the point. `waitMs` is raised to the provider's floor rather
 * than trusted, because the tempting number (200-300 ms, "feels instant") is
 * four times what Nominatim's usage policy permits, and the failure mode is not
 * a slow search box — it is the deployment's IP blocked for everyone on it.
 */
export function createPlaceSearch(
  opts: Omit<GeocodeOptions, 'signal'> & { waitMs?: number } = {},
): PlaceSearch {
  const provider = opts.provider ?? geocoderConfig().provider;
  const wait = Math.max(opts.waitMs ?? MIN_INTERVAL_MS[provider], MIN_INTERVAL_MS[provider]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let pending: ((r: GeoPlace[] | null) => void) | undefined;

  /**
   * Retire whatever is outstanding. The pending promise is *resolved* with null
   * rather than dropped: a promise that is simply abandoned never settles, and
   * an `await` on it in a keystroke handler would leave that handler — and
   * everything it closed over — alive for the life of the page.
   */
  const retire = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    pending?.(null);
    pending = undefined;
  };

  return {
    cancel: retire,
    search(query: string): Promise<GeoPlace[] | null> {
      retire();
      const q = query.trim();
      if (q.length < MIN_QUERY_LENGTH) return Promise.resolve([]);

      return new Promise<GeoPlace[] | null>((resolve) => {
        pending = resolve;
        const mine = () => pending === resolve;
        timer = setTimeout(() => {
          timer = undefined;
          const c = new AbortController();
          controller = c;
          void geocode(q, { ...opts, signal: c.signal }).then((places) => {
            // `mine()` and not a captured flag: `retire()` has already resolved
            // this promise with null if it ran, and resolving twice is a silent
            // no-op that would otherwise look like the result was delivered.
            if (!mine()) return;
            pending = undefined;
            controller = undefined;
            resolve(places);
          });
        }, wait);
      });
    },
  };
}
