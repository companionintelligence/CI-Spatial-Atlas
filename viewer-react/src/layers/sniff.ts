import {
  clampOpacity,
  DEFAULT_OPACITY,
  FORMAT_META,
  isLayerFormat,
  makeLayerId,
  type AtlasLayer,
  type LayerAttribution,
  type LayerAvailability,
  type LayerFormat,
  type LayerOptions,
} from './model.js';

/**
 * "Here is a URL — what is it, and can we draw it?"
 *
 * Two jobs, kept apart on purpose:
 *
 *  1. **Sniff** the format from the URL (cheap, offline, deterministic) and, if
 *     that fails, from the response's `Content-Type` (one request).
 *  2. **Validate** the URL *against* the chosen format, and when it fails, say
 *     what was wrong and what to try. "Invalid URL" is not a message — it tells
 *     the user that something they cannot see is unacceptable for a reason they
 *     cannot guess. Every failure below names the mismatch and shows the shape
 *     of a URL that would work.
 *
 * The sniffing is deliberately conservative. Guessing wrong is worse than not
 * guessing: a WMTS template mounted as XYZ produces well-formed requests for
 * tiles that do not exist, so the globe stays blank with nothing logged — the
 * exact trap `basemaps.ts` documents for tiling schemes. When the URL is
 * ambiguous we say so and let the user pick.
 */

/** Placeholders that identify a slippy/XYZ tile template. */
const XYZ_TOKENS = /\{z\}|\{x\}|\{y\}|\{-y\}|\{zoom\}/i;
/** RESTful WMTS templates address tiles by matrix/row/col instead. */
const WMTS_TOKENS = /\{tilematrix\}|\{tilerow\}|\{tilecol\}|\{tilematrixset\}/i;

/**
 * Lowercased path, plus a case-insensitive query lookup.
 *
 * OGC service parameters are defined as case-insensitive *names* with
 * case-sensitive *values* — real endpoints write `SERVICE=WMS`, `service=wms`
 * and `Service=WMS` interchangeably, while `LAYERS=OSM-WMS` means a layer whose
 * identifier really is upper-case. So the name is matched folded and the value
 * is handed back untouched.
 */
function parts(url: string): { path: string; param: (name: string) => string | null; ok: boolean } {
  try {
    // A tile template's braces are legal in a URL string but not in a parsed
    // pathname, so parse a placeholder-free copy — we only need the shape.
    const u = new URL(url.replace(/\{[^}]*\}/g, '_'));
    const param = (name: string) => {
      const want = name.toLowerCase();
      for (const [k, v] of u.searchParams) if (k.toLowerCase() === want) return v;
      return null;
    };
    return { path: u.pathname.toLowerCase(), param, ok: true };
  } catch {
    return { path: url.toLowerCase(), param: () => null, ok: false };
  }
}

/**
 * Best guess at a layer's format from its URL alone. `null` when the URL does
 * not say — the caller must then probe the response or ask the user.
 *
 * Order matters: the most specific signals (OGC service parameters, exact
 * filenames) are tested before the generic extension rules, because
 * `...?service=WMTS&request=GetTile&format=image/png` ends in neither `.png`
 * nor a template and would otherwise fall through to "unknown".
 */
export function sniffLayerFormat(url: string): LayerFormat | null {
  const raw = url.trim();
  if (!raw) return null;
  const { path, param } = parts(raw);
  const service = (param('service') ?? '').toLowerCase();
  const request = (param('request') ?? '').toLowerCase();

  // ---- OGC services, by their own query parameters --------------------------
  if (service === 'wmts' || request === 'gettile') return 'wmts';
  if (service === 'wms' || request === 'getmap') return 'wms';
  // A capabilities document is not a layer, but it is unambiguous about which
  // service it belongs to, and mounting it is a better error than "unknown".
  if (path.includes('wmtscapabilities')) return 'wmts';
  if (path.includes('/wmts/') || path.endsWith('/wmts')) return 'wmts';
  if (path.includes('/wms')) return 'wms';

  // ---- templates ------------------------------------------------------------
  if (WMTS_TOKENS.test(raw)) return 'wmts';
  if (XYZ_TOKENS.test(raw)) {
    // `{-y}` is Leaflet/OpenLayers shorthand for a flipped Y axis, which is the
    // one thing that actually distinguishes TMS from XYZ in a template.
    return /\{-y\}/i.test(raw) || /\/tms\//.test(path) ? 'tms' : 'xyz';
  }
  if (path.endsWith('tilemapresource.xml')) return 'tms';

  // ---- documents, by filename ----------------------------------------------
  if (path.endsWith('tileset.json')) return '3d-tiles';
  // Cesium Terrain Builder / quantized-mesh always publishes `layer.json`; it
  // is the only well-known terrain manifest name, which is why terrain is
  // sniffable at all.
  if (path.endsWith('layer.json')) return 'quantized-mesh';
  if (path.endsWith('.geojson') || path.endsWith('.json.geojson')) return 'geojson';
  if (path.endsWith('.topojson')) return null; // real format, no Cesium loader — see validation
  if (path.endsWith('.kml') || path.endsWith('.kmz')) return 'kml';
  if (path.endsWith('.czml')) return 'czml';
  if (path.endsWith('.splat') || path.endsWith('.ksplat') || path.endsWith('.ply') || path.endsWith('.spz')) {
    return 'gaussian-splat';
  }
  // A bare `.json` is the ambiguous case: GeoJSON, a tileset, a terrain layer
  // manifest and a TileJSON all end that way. Only claim GeoJSON when the name
  // says so; otherwise leave it to the response sniff or the user.
  if (path.endsWith('.json') && /geojson|features|feed/.test(path)) return 'geojson';

  // Raster extensions with no template are a single image, not a tile source.
  return null;
}

/**
 * Format from a `Content-Type`, for the case the URL would not say.
 *
 * Servers are careless with these (`application/json` for GeoJSON is normal and
 * legal), so this only resolves the cases a MIME type genuinely settles.
 */
export function sniffLayerFormatFromContentType(contentType: string | null | undefined): LayerFormat | null {
  const ct = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ct) return null;
  if (ct === 'application/geo+json' || ct === 'application/vnd.geo+json') return 'geojson';
  if (ct === 'application/vnd.google-earth.kml+xml' || ct === 'application/vnd.google-earth.kmz') return 'kml';
  if (ct === 'application/czml+json') return 'czml';
  // `application/json` stays ambiguous on purpose: tileset.json, layer.json and
  // GeoJSON all serve it. `probeLayerFormat` looks at the body for those.
  return null;
}

/**
 * Format from the first bytes of a JSON document.
 *
 * The three JSON manifests Atlas cares about are trivially distinguishable by
 * their required top-level members, and *only* by them — the URL and MIME type
 * are both `application/json` for all three.
 */
export function sniffLayerFormatFromBody(body: string): LayerFormat | null {
  const head = body.slice(0, 4096);
  if (/"asset"\s*:\s*\{[^}]*"version"/.test(head) && /"geometricError"|"root"\s*:/.test(head)) return '3d-tiles';
  if (/"tilejson"\s*:/.test(head)) return 'xyz'; // TileJSON — the tile template lives inside; see validation
  if (/"tiles"\s*:\s*\[/.test(head) && /"format"\s*:\s*"(quantized-mesh|terrain)/.test(head)) return 'quantized-mesh';
  if (/"type"\s*:\s*"(FeatureCollection|Feature|GeometryCollection|Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon)"/.test(head)) {
    return 'geojson';
  }
  // CZML is a JSON *array* whose first packet is the document packet.
  if (/^\s*\[\s*\{[^}]*"id"\s*:\s*"document"/.test(head)) return 'czml';
  return null;
}

export interface ProbeOptions {
  /** Injected in tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Abort after this long — a dead host must not hang the "Add" button. */
  timeoutMs?: number;
}

/**
 * Ask the server what it is serving, when the URL would not say.
 *
 * A `GET` rather than a `HEAD`: many tile and static-file hosts (S3 website
 * endpoints, some CDNs, several of the catalog's own sources) answer `HEAD`
 * with 403 or 405 while serving `GET` perfectly, so a HEAD probe would report
 * "unreachable" for URLs that work. The body is read only far enough to
 * classify a JSON manifest, then the response is dropped.
 *
 * Never called for a URL the user has already classified — a probe is a request
 * to a third party, which is egress this repo takes seriously
 * (`docs/architecture/third-party-egress.md`).
 */
export async function probeLayerFormat(url: string, opts: ProbeOptions = {}): Promise<LayerFormat | null> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (!doFetch) return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000) : undefined;
  try {
    const res = await doFetch(url, { signal: controller?.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const byType = sniffLayerFormatFromContentType(res.headers?.get?.('content-type'));
    if (byType) return byType;
    const ct = (res.headers?.get?.('content-type') ?? '').toLowerCase();
    if (ct.includes('json') || ct.includes('text/plain')) {
      const text = await res.text();
      return sniffLayerFormatFromBody(text);
    }
    if (ct.includes('xml')) {
      const text = await res.text();
      if (/<kml\b/i.test(text)) return 'kml';
      if (/<Capabilities\b/i.test(text) && /wmts/i.test(text)) return 'wmts';
      if (/<WMT_MS_Capabilities|<WMS_Capabilities/i.test(text)) return 'wms';
      if (/<TileMap\b/i.test(text)) return 'tms';
      return null;
    }
    return null;
  } catch {
    // Offline, CORS-blocked or timed out. The caller falls back to "pick a kind"
    // rather than refusing the layer: many perfectly good tile servers block
    // cross-origin reads of the manifest while serving images fine, and a probe
    // failure must not be the reason a user cannot add their own data.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- validation ------------------------------------------------------------

export interface LayerDraftInput {
  url: string;
  /** `undefined` / 'auto' asks for sniffing. */
  format?: LayerFormat | 'auto';
  name?: string;
  attribution?: LayerAttribution;
  availability?: LayerAvailability;
  options?: LayerOptions;
  opacity?: number;
  visible?: boolean;
  id?: string;
  catalogId?: string;
}

export interface LayerDraftFailure {
  ok: false;
  /** What is wrong, in the user's terms. */
  problem: string;
  /** What to do instead — a concrete example wherever one exists. */
  suggestion: string;
}

export interface LayerDraftSuccess {
  ok: true;
  layer: AtlasLayer;
  /** Non-fatal things the user should know before wondering why it looks odd. */
  warnings: string[];
  /** True when the format was inferred rather than chosen. */
  sniffed: boolean;
}

export type LayerDraftResult = LayerDraftFailure | LayerDraftSuccess;

const fail = (problem: string, suggestion: string): LayerDraftFailure => ({ ok: false, problem, suggestion });

/**
 * A readable name when the user did not give one.
 *
 * The last meaningful path segment beats the hostname: `tileset.json` under
 * `/scans/lighthouse/` should be called "lighthouse", not "storage.example.com".
 */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url.replace(/\{[^}]*\}/g, '_'));
    const segs = u.pathname.split('/').filter((s) => s && s !== '_');
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i]!.replace(/\.[a-z0-9]+$/i, '');
      // Skip the manifest filenames — every tileset is called "tileset".
      if (/^(tileset|layer|index|default|tiles?|wmts|wms|_)$/i.test(seg)) continue;
      const pretty = decodeURIComponent(seg).replace(/[-_+]+/g, ' ').trim();
      if (pretty) return pretty.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'Layer';
  }
}

/**
 * Turn a URL (+ optional explicit format) into a layer, or into an explanation.
 *
 * Synchronous: it never touches the network. `addLayerByUrl` in `useLayers.ts`
 * wraps this with a probe for the one case that needs it (format 'auto' and a
 * URL that does not say).
 */
export function draftLayer(input: LayerDraftInput): LayerDraftResult {
  const url = input.url.trim();
  if (!url) {
    return fail(
      'No URL yet.',
      'Paste a tile template, a service endpoint or a data file — for example https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
  }

  // Parse with placeholders neutralised: `{z}` is not legal in a parsed URL but
  // is exactly what a tile template must contain.
  let parsed: URL;
  try {
    parsed = new URL(url.replace(/\{[^}]*\}/g, '_'));
  } catch {
    return fail(
      `“${truncate(url)}” is not a complete web address.`,
      'Include the scheme and host, e.g. https://example.org/tiles/{z}/{x}/{y}.png — a path on its own has nothing to fetch from.',
    );
  }

  const scheme = parsed.protocol.replace(':', '');
  if (scheme !== 'https' && scheme !== 'http') {
    return fail(
      `Atlas cannot load ${scheme}: addresses.`,
      'Layers are fetched by the browser, so the URL has to be http or https. For a local file, serve the folder over http first.',
    );
  }

  const warnings: string[] = [];
  // Mixed content: an https page cannot fetch http subresources — the browser
  // blocks them silently, which looks exactly like a layer that "does not work".
  // Warn rather than refuse: on an http dev server it is fine.
  if (scheme === 'http' && globalThis.location?.protocol === 'https:') {
    warnings.push('This is an http:// URL on an https page — the browser will block it. Ask the host for an https address.');
  }

  const requested = input.format && input.format !== 'auto' ? input.format : undefined;
  if (input.format && input.format !== 'auto' && !isLayerFormat(input.format)) {
    return fail(`“${input.format}” is not a layer kind Atlas knows.`, `Choose one of: ${Object.keys(FORMAT_META).join(', ')}.`);
  }

  const sniffed = sniffLayerFormat(url);
  const format = requested ?? sniffed ?? undefined;
  if (!format) {
    const lower = url.toLowerCase();
    if (/\.topojson(\?|$)/.test(lower)) {
      return fail(
        'That looks like TopoJSON, which Cesium cannot read directly.',
        'Convert it to GeoJSON first (`topo2geo`, or QGIS “Export → GeoJSON”), then add the .geojson URL.',
      );
    }
    if (/\.(png|jpe?g|webp|gif|tiff?)(\?|$)/.test(lower)) {
      return fail(
        'That is a single image, not a tile source — Atlas has nowhere to put one picture on a globe.',
        'Use the tile template it comes from (…/{z}/{x}/{y}.png), or publish the image as a georeferenced WMS/WMTS.',
      );
    }
    return fail(
      'The URL does not say what kind of layer this is.',
      'Pick a kind explicitly, or use a URL that says: …/{z}/{x}/{y}.png for tiles, tileset.json for 3D Tiles, layer.json for terrain, or a .geojson / .kml / .czml file.',
    );
  }

  // ---- per-format checks ---------------------------------------------------
  const check = validateForFormat(url, format, input.options);
  if (check) return check;

  if (format === 'gaussian-splat' && /\.(splat|ksplat|ply|spz)(\?|$)/i.test(url)) {
    // Honest about what the renderer can do: the Cesium path mounts splats as
    // 3D Tiles (see `czml.ts`, which hands both kinds to `Cesium3DTileset`), so
    // a bare splat dump will not draw and must be packaged first.
    warnings.push('Cesium draws Gaussian splats packaged as 3D Tiles. A raw .splat/.ply file will not render — convert it to a tileset.json first.');
  }
  if (!input.attribution?.text) {
    warnings.push('No attribution set. Most open sources require a credit line — add one before sharing a story that uses this layer.');
  }

  const name = (input.name ?? '').trim() || nameFromUrl(url);
  const layer: AtlasLayer = {
    id: input.id ?? makeLayerId(name),
    name,
    format,
    url,
    visible: input.visible ?? true,
    opacity: input.opacity == null ? DEFAULT_OPACITY : clampOpacity(input.opacity),
    // Placed by `appendLayer`; a draft on its own has no position in a stack.
    order: 0,
    ...(input.attribution ? { attribution: input.attribution } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
    ...(input.options ? { options: withFormatDefaults(format, input.options) } : defaultOptionsFor(format)),
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
  };

  return { ok: true, layer, warnings, sniffed: !requested };
}

/** Format-specific "this URL cannot possibly work" checks. */
function validateForFormat(url: string, format: LayerFormat, options: LayerOptions | undefined): LayerDraftFailure | null {
  const { param } = parts(url);
  switch (format) {
    case 'xyz':
    case 'tms': {
      if (!XYZ_TOKENS.test(url)) {
        return fail(
          `This is set to ${FORMAT_META[format].label}, but the URL has no {z}/{x}/{y} placeholders, so every tile request would ask for the same picture.`,
          'Use the template form, e.g. https://tile.openstreetmap.org/{z}/{x}/{y}.png — the tile server’s docs usually show it.',
        );
      }
      if (/\{s\}/i.test(url) && !options?.subdomains) {
        return fail(
          'The URL has an {s} subdomain placeholder but no subdomains were given, so the host name would be literally “{s}”.',
          'Add the subdomains the provider lists (often “abc”), or use a URL without {s}.',
        );
      }
      return null;
    }
    case 'wmts': {
      const restful = WMTS_TOKENS.test(url);
      const kvp = (param('service') ?? '').toLowerCase() === 'wmts' || (param('request') ?? '').toLowerCase() === 'gettile';
      const templated = XYZ_TOKENS.test(url);
      if (!restful && !kvp && !templated) {
        return fail(
          'This is set to WMTS, but the URL is neither a RESTful tile template nor a WMTS endpoint.',
          'Use the RESTful form …/{TileMatrix}/{TileRow}/{TileCol}.jpg, or the KVP endpoint with ?SERVICE=WMTS&REQUEST=GetTile.',
        );
      }
      if (restful && !options?.wmtsLayer) {
        return fail(
          'A RESTful WMTS template needs the layer identifier as well as the URL — the server cannot infer it.',
          'Set the layer name from the service’s WMTSCapabilities.xml (for example “MODIS_Terra_CorrectedReflectance_TrueColor”).',
        );
      }
      return null;
    }
    case 'wms': {
      const layers = options?.wmsLayers ?? param('layers');
      if (!layers) {
        return fail(
          'A WMS request has to name which layers to draw, and this URL names none.',
          'Add the layer names from the service’s GetCapabilities document, e.g. layers=OSM-WMS.',
        );
      }
      if (XYZ_TOKENS.test(url)) {
        return fail(
          'This is set to WMS, but the URL is a tile template — WMS renders an arbitrary bounding box, it does not take {z}/{x}/{y}.',
          'Choose XYZ tiles for a template URL, or give the WMS endpoint without placeholders.',
        );
      }
      return null;
    }
    case '3d-tiles':
    case 'gaussian-splat': {
      if (XYZ_TOKENS.test(url)) {
        return fail(
          'A 3D Tiles layer points at one tileset manifest, not at a tile template.',
          'Use the tileset.json URL — the tileset addresses its own children from there.',
        );
      }
      return null;
    }
    case 'quantized-mesh': {
      if (XYZ_TOKENS.test(url)) {
        return fail(
          'A terrain layer points at the tileset’s layer.json, not at a tile template.',
          'Give the folder’s layer.json URL (Cesium Terrain Builder and ion both publish one); Cesium reads the tile pattern from it.',
        );
      }
      return null;
    }
    case 'geojson':
    case 'kml':
    case 'czml': {
      if (XYZ_TOKENS.test(url)) {
        return fail(
          `A ${FORMAT_META[format].label} layer is one document, but this URL is a tile template.`,
          'Point at the file itself, or add it as XYZ tiles instead if it really is a raster source.',
        );
      }
      return null;
    }
  }
}

/**
 * Sensible provider defaults per format.
 *
 * The tiling scheme default is the load-bearing one: Cesium defaults
 * `UrlTemplateImageryProvider` to a *geographic* scheme, while essentially
 * every {z}/{x}/{y} source on the open web is Web Mercator. Taking Cesium's
 * default is the documented silent-blank-globe bug, so the model's default is
 * reality's, not the library's.
 */
export function defaultOptionsFor(format: LayerFormat): { options?: LayerOptions } {
  switch (format) {
    case 'xyz':
    case 'tms':
    case 'wmts':
      return { options: { tilingScheme: 'web-mercator' } };
    case 'wms':
      // WMS servers happily reproject, and 1.3.0 CRS:84 / geographic is the
      // safer default for one: it is what an unconfigured server assumes.
      return { options: { tilingScheme: 'geographic', transparent: true } };
    default:
      return {};
  }
}

function withFormatDefaults(format: LayerFormat, options: LayerOptions): LayerOptions {
  const base = defaultOptionsFor(format).options ?? {};
  return { ...base, ...options };
}

const truncate = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
