import type { Layer } from '@companion-atlas/story';

/**
 * The layer model — what Atlas can draw on top of the globe, and in what order.
 *
 * Why this exists at all: the viewer shipped with five hardcoded basemaps and
 * three booleans. That answers "what does the ground look like", which is a
 * basemap question, not a layer question. A Google-Earth-class atlas has to let
 * a user *bring their own data* — a WMTS of last week's fires, a GeoJSON of a
 * hike, a photogrammetry tileset of one building — stack it, dim it, reorder it
 * and take it away again.
 *
 * ## Relationship to `@companion-atlas/story`
 *
 * The canonical schema already has a `Layer` (`kind` + `uri` + `style` +
 * `opacity` + `availability`), and a Story can carry an array of them. That is
 * the interchange shape and this model does **not** compete with it: see
 * `story.ts` for the round-trip. What the schema's `Layer` cannot say is:
 *
 *   - a human name (a story layer is identified only by its id),
 *   - whether it is currently visible,
 *   - where it sits in the stack (z-order),
 *   - who it must be credited to (a licence obligation, not a nicety),
 *   - *which* raster/vector protocol the `uri` speaks — the schema's `imagery`
 *     covers XYZ, TMS, WMTS and WMS, which need four different Cesium providers
 *     and are not interchangeable.
 *
 * So `AtlasLayer` is a superset, and everything the schema has no field for
 * travels in `style.atlas` where a `Story` round-trip preserves it (Zod strips
 * unknown *top-level* keys; `style` is a `z.record(z.unknown())` bag, so it
 * survives). Nothing here is a class or holds a Cesium object: the model stays
 * plain JSON so it can go into localStorage and into a Story unchanged.
 */

/** Kinds the canonical schema knows. Aliased so a schema change breaks the
 *  mapping below at compile time rather than silently at runtime. */
export type StoryLayerKind = Layer['kind'];

/**
 * The wire protocol a layer's URL speaks.
 *
 * This is finer-grained than the schema's `kind` on purpose. "imagery" is not
 * enough to fetch a tile: an XYZ template, a RESTful WMTS template and a WMS
 * GetMap endpoint are three different request shapes served by three different
 * Cesium providers, and guessing wrong produces the exact failure mode
 * `basemaps.ts` documents — well-formed requests that address tiles which do
 * not exist, a blank globe, and nothing logged to explain it.
 */
export type LayerFormat =
  // Raster
  | 'xyz'
  | 'tms'
  | 'wmts'
  | 'wms'
  // Vector
  | 'geojson'
  | 'kml'
  | 'czml'
  // 3D
  | '3d-tiles'
  | 'gaussian-splat'
  // Terrain
  | 'quantized-mesh';

/** How the layer switcher groups formats for a human. */
export type LayerCategory = 'raster' | 'vector' | '3d' | 'terrain';

export interface LayerFormatMeta {
  category: LayerCategory;
  /** The canonical schema kind this format serialises as. */
  kind: StoryLayerKind;
  label: string;
  /** Shown under the label in the picker, and in "what to try" error text. */
  hint: string;
}

/**
 * Format → everything the rest of the app needs to know about it.
 *
 * Note the lossy edges, which are deliberate and are documented rather than
 * worked around:
 *  - KML and CZML both serialise as the schema's `geojson` kind, because the
 *    schema has no vector kind for them. The real format is kept in
 *    `style.atlas.format`, so a round-trip is lossless *for us* while still
 *    validating against the published schema.
 *  - `gaussian-splat` is a distinct schema kind but reaches Cesium the same way
 *    a 3D Tiles tileset does (see `czml.ts`, which returns both as `tilesets`).
 *    Keeping it separate preserves the story's own vocabulary.
 */
export const FORMAT_META: Record<LayerFormat, LayerFormatMeta> = {
  xyz: { category: 'raster', kind: 'imagery', label: 'XYZ tiles', hint: 'Slippy-map template with {z}/{x}/{y}' },
  tms: { category: 'raster', kind: 'imagery', label: 'TMS tiles', hint: 'Like XYZ, but the Y axis is flipped' },
  wmts: { category: 'raster', kind: 'imagery', label: 'WMTS', hint: 'OGC tiled imagery ({TileMatrix}/{TileRow}/{TileCol})' },
  wms: { category: 'raster', kind: 'imagery', label: 'WMS', hint: 'OGC GetMap — rendered per request, not tiled' },
  geojson: { category: 'vector', kind: 'geojson', label: 'GeoJSON', hint: 'Points, lines and polygons' },
  kml: { category: 'vector', kind: 'geojson', label: 'KML', hint: 'Google Earth vector + ground overlays' },
  czml: { category: 'vector', kind: 'geojson', label: 'CZML', hint: 'Time-dynamic entities — the 4D vector format' },
  '3d-tiles': { category: '3d', kind: '3d-tiles', label: '3D Tiles', hint: 'tileset.json — photogrammetry, BIM, point clouds' },
  'gaussian-splat': { category: '3d', kind: 'gaussian-splat', label: 'Gaussian splat', hint: 'Splat reconstruction packaged as 3D Tiles' },
  'quantized-mesh': { category: 'terrain', kind: 'terrain', label: 'Terrain', hint: 'Quantized-mesh layer.json — real elevation' },
};

/** Every format, in the order the UI offers them. */
export const LAYER_FORMATS = Object.keys(FORMAT_META) as LayerFormat[];

export const isLayerFormat = (v: unknown): v is LayerFormat =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORMAT_META, v);

export const layerKind = (format: LayerFormat): StoryLayerKind => FORMAT_META[format].kind;
export const layerCategory = (format: LayerFormat): LayerCategory => FORMAT_META[format].category;

/**
 * Who the data belongs to.
 *
 * Not optional in spirit, even though the field is: almost every open source in
 * the catalog carries an attribution *obligation* (ODbL, CC BY-SA, the OSM tile
 * usage policy), and `basemaps.ts` already treats the credit as part of the
 * source rather than as decoration. Carrying it on the layer means the scene
 * adapter can hand it to `Cesium.Credit` and the panel can show it, so a layer
 * cannot be drawn without its credit existing somewhere.
 */
export interface LayerAttribution {
  /** The credit line, exactly as the terms require it to read. */
  text: string;
  /** Short licence name, e.g. 'ODbL 1.0', 'CC BY-NC-SA 4.0', 'Public domain'. */
  licence?: string;
  /** Where the terms live, so the panel can link out to them. */
  url?: string;
  /**
   * True when the terms want the credit *on the map*, not merely behind the
   * "Data attribution" disclosure. Mapbox and CC BY-SA sources ask for this;
   * Esri's are content with the collapsed list. Cesium's `Credit` takes exactly
   * this as its second argument.
   */
  onScreen?: boolean;
}

/**
 * When this layer is true.
 *
 * Atlas is 4D: the clock is the point, not a decoration. A layer of 2019 fire
 * perimeters is a lie over a 2024 camera time, so a layer says which slice of
 * the timeline it applies to and the scene hides it outside that. Shape mirrors
 * the schema's `Layer.availability` (`stop` is the canonical field name; `end`
 * is accepted on the way in because older Atlas stories wrote that instead).
 */
export interface LayerAvailability {
  /** ISO 8601. Inclusive. */
  start: string;
  /** ISO 8601. Inclusive. Absent = open-ended (still true today). */
  stop?: string;
}

/**
 * Everything a provider needs beyond the URL.
 *
 * Flat and optional rather than a discriminated union per format: this object
 * goes into localStorage and into a Story, where a hand-edited or older copy
 * will have fields that do not belong to its format. A flat bag degrades to
 * "ignored" instead of "fails to parse".
 */
export interface LayerOptions {
  /**
   * Which pyramid the tiles are indexed against. Defaults to `web-mercator`
   * for XYZ/TMS/WMTS because that is what virtually every slippy source serves
   * — and getting it wrong is the silent-blank-globe bug `basemaps.ts` calls
   * out, so the default matches reality rather than Cesium's (geographic).
   */
  tilingScheme?: 'web-mercator' | 'geographic';
  minimumLevel?: number;
  /** Past this, Cesium stops refining instead of requesting 404s. */
  maximumLevel?: number;
  tileWidth?: number;
  tileHeight?: number;
  /** Characters or names substituted into a `{s}` placeholder. */
  subdomains?: string;
  /** MIME type of the tiles/images, e.g. `image/jpeg`. */
  mimeType?: string;
  /** WMTS: layer identifier, style and tile matrix set. */
  wmtsLayer?: string;
  wmtsStyle?: string;
  tileMatrixSet?: string;
  /** WMS: comma-separated layer and style names. */
  wmsLayers?: string;
  wmsStyles?: string;
  /** WMS/overlay rasters: ask the server for transparency. */
  transparent?: boolean;
  /**
   * Static WMTS dimensions substituted into the template — `{Time}` for NASA
   * GIBS, for example. Cesium's WMTS provider takes these verbatim.
   */
  dimensions?: Record<string, string>;
  /**
   * When true, the `Time` dimension follows the story clock (quantised to the
   * day, because GIBS publishes daily granules and re-creating the provider on
   * every clock tick would thrash the tile cache).
   */
  followsClock?: boolean;
  /** Vector: stroke/fill colour hint, any CSS colour. */
  colour?: string;
  /** Vector: drape geometry on terrain rather than floating it at height 0. */
  clampToGround?: boolean;
}

/** One thing drawn on the globe. Plain JSON — no Cesium objects, ever. */
export interface AtlasLayer {
  id: string;
  /** What a human calls it. Never derived at render time; users rename layers. */
  name: string;
  format: LayerFormat;
  /** Source URL — a tile template, a service endpoint, or a document. */
  url: string;
  visible: boolean;
  /** 0..1. Applied as `ImageryLayer.alpha`, a tile style, or entity alpha. */
  opacity: number;
  /** Draw order: ascending, so the highest number is nearest the viewer. */
  order: number;
  attribution?: LayerAttribution;
  availability?: LayerAvailability;
  options?: LayerOptions;
  /** Set when the layer came from the built-in catalog, so it can be re-found. */
  catalogId?: string;
}

export const DEFAULT_OPACITY = 1;

/** Clamp into 0..1, tolerating strings and NaN from hand-edited storage. */
export function clampOpacity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_OPACITY;
  return Math.min(1, Math.max(0, n));
}

/** Short random suffix; `crypto` where it exists, `Math.random` in old/odd hosts. */
function randomSuffix(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(4));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * A stable, readable id.
 *
 * Readable because these ids end up in a Story document and in localStorage,
 * where `hillshade-3f9a2c01` tells you what broke and `l_17` does not. Suffixed
 * because two layers may legitimately share a name (two dates of the same
 * source) and ids must not collide.
 */
export function makeLayerId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'layer'}-${randomSuffix()}`;
}

// ---- ordering --------------------------------------------------------------

/**
 * Draw order: bottom first.
 *
 * Ties break on id rather than on array position so the result is a total
 * order — two layers that both claim `order: 3` (a hand-edited store, or two
 * catalog adds racing in one render) must not swap places on every re-render,
 * which would make the imagery stack flicker.
 */
export function sortLayers(layers: readonly AtlasLayer[]): AtlasLayer[] {
  return [...layers].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

/**
 * The order the *panel* lists them in: topmost first.
 *
 * Every layer UI people already know — Photoshop, QGIS, Google Earth — puts the
 * layer drawn on top at the top of the list, so "move up" means "in front".
 */
export function stackTopFirst(layers: readonly AtlasLayer[]): AtlasLayer[] {
  return sortLayers(layers).reverse();
}

/** Re-index to a dense 0..n-1 draw order. Run after every mutation so the
 *  numbers never drift into sparse or duplicate values that a hand-edited
 *  store, or a removal, would otherwise leave behind. */
export function normaliseOrder(layers: readonly AtlasLayer[]): AtlasLayer[] {
  return sortLayers(layers).map((l, i) => (l.order === i ? l : { ...l, order: i }));
}

/**
 * Add a layer on top of the stack.
 *
 * Deduplicates on (format, url): adding the same tileset or tile template twice
 * does not make it twice as visible, it makes two identical draws fight over
 * the same pixels — `czml.ts` deduplicates tilesets by URL for exactly this
 * reason. A repeat add raises the existing layer to the top and makes it
 * visible instead, which is what "add it again" actually means.
 */
export function appendLayer(layers: readonly AtlasLayer[], layer: AtlasLayer): AtlasLayer[] {
  const existing = layers.find((l) => l.url === layer.url && l.format === layer.format);
  if (existing) return raiseToTop(setLayerVisible(layers, existing.id, true), existing.id);
  const top = layers.reduce((m, l) => Math.max(m, l.order), -1);
  return normaliseOrder([...layers, { ...layer, order: top + 1 }]);
}

export function removeLayer(layers: readonly AtlasLayer[], id: string): AtlasLayer[] {
  return normaliseOrder(layers.filter((l) => l.id !== id));
}

/**
 * Move a layer one step through the stack.
 *
 * `+1` is towards the viewer ("up" in the panel). Implemented as a swap with
 * the neighbour in draw order rather than as arithmetic on `order`, so it stays
 * correct when the orders are sparse and cannot produce a collision.
 */
export function moveLayer(layers: readonly AtlasLayer[], id: string, delta: 1 | -1): AtlasLayer[] {
  const sorted = normaliseOrder(layers);
  const i = sorted.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sorted.length) return sorted; // already at the end of the stack
  const swapped = [...sorted];
  swapped[i] = { ...sorted[j], order: i };
  swapped[j] = { ...sorted[i], order: j };
  return swapped;
}

export const raiseLayer = (layers: readonly AtlasLayer[], id: string) => moveLayer(layers, id, 1);
export const lowerLayer = (layers: readonly AtlasLayer[], id: string) => moveLayer(layers, id, -1);

/** Put a layer at the front of the stack in one move (used by re-adds). */
export function raiseToTop(layers: readonly AtlasLayer[], id: string): AtlasLayer[] {
  const top = layers.reduce((m, l) => Math.max(m, l.order), -1);
  return normaliseOrder(layers.map((l) => (l.id === id ? { ...l, order: top + 1 } : l)));
}

/** Move a layer to an explicit position in the *panel's* top-first list. This is
 *  what a drag-and-drop reorder lands on; the arrow buttons use `moveLayer`. */
export function moveLayerToIndex(layers: readonly AtlasLayer[], id: string, topFirstIndex: number): AtlasLayer[] {
  const list = stackTopFirst(layers);
  const from = list.findIndex((l) => l.id === id);
  if (from < 0) return normaliseOrder(layers);
  const to = Math.min(list.length - 1, Math.max(0, topFirstIndex));
  if (from === to) return normaliseOrder(layers);
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  // `list` is top-first; draw order is the reverse of it.
  return list.reverse().map((l, i) => ({ ...l, order: i }));
}

// ---- per-layer edits -------------------------------------------------------

const patch = (layers: readonly AtlasLayer[], id: string, fn: (l: AtlasLayer) => AtlasLayer): AtlasLayer[] =>
  layers.map((l) => (l.id === id ? fn(l) : l));

export const setLayerVisible = (layers: readonly AtlasLayer[], id: string, visible: boolean) =>
  patch(layers, id, (l) => ({ ...l, visible }));

export const toggleLayer = (layers: readonly AtlasLayer[], id: string) =>
  patch(layers, id, (l) => ({ ...l, visible: !l.visible }));

export const setLayerOpacity = (layers: readonly AtlasLayer[], id: string, opacity: number) =>
  patch(layers, id, (l) => ({ ...l, opacity: clampOpacity(opacity) }));

export const renameLayer = (layers: readonly AtlasLayer[], id: string, name: string) =>
  patch(layers, id, (l) => ({ ...l, name: name.trim() || l.name }));

// ---- time availability -----------------------------------------------------

/**
 * Parse an ISO instant, tolerating rubbish.
 *
 * Returns `null` rather than `NaN` so callers cannot accidentally compare
 * against a NaN and get `false` for every branch — an unparseable bound must
 * mean "unbounded", not "never visible". A layer that silently stops drawing
 * because someone typed `2019-13-01` is the worst possible failure here: there
 * is nothing on screen to ask a question about.
 */
export function parseInstant(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Is this layer true at `atMs`? No availability window = always true. */
export function isAvailableAt(layer: Pick<AtlasLayer, 'availability'>, atMs: number | null | undefined): boolean {
  const a = layer.availability;
  if (!a || atMs == null || !Number.isFinite(atMs)) return true;
  const start = parseInstant(a.start);
  const stop = parseInstant(a.stop);
  if (start != null && atMs < start) return false;
  if (stop != null && atMs > stop) return false;
  return true;
}

/** The layers a user has switched on that the current clock time excludes. The
 *  panel surfaces these: a layer that is "on" but drawing nothing needs to say
 *  why, or it reads as broken. */
export function layersOutsideWindow(layers: readonly AtlasLayer[], atMs: number | null | undefined): AtlasLayer[] {
  return layers.filter((l) => !isAvailableAt(l, atMs));
}

/** What the scene should actually draw right now. */
export function visibleLayersAt(layers: readonly AtlasLayer[], atMs: number | null | undefined): AtlasLayer[] {
  return sortLayers(layers).filter((l) => l.visible && isAvailableAt(l, atMs));
}

/** Human summary of an availability window, for the panel's badge. */
export function describeAvailability(a: LayerAvailability | undefined): string | null {
  if (!a) return null;
  const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : null);
  const from = day(a.start);
  const to = day(a.stop);
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  return null;
}

// ---- search ----------------------------------------------------------------

/**
 * Case- and accent-insensitive haystack.
 *
 * NFD + strip combining marks so "Sentinel-2 São Paulo" is found by typing
 * "sao" — a search that only matches exact diacritics is a search people stop
 * using.
 */
export const foldForSearch = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Every string worth matching a query against, for one layer. */
function haystack(l: Pick<AtlasLayer, 'name' | 'format' | 'url' | 'attribution'>): string {
  const meta = FORMAT_META[l.format];
  let host = '';
  try { host = new URL(l.url).hostname; } catch { /* a template URL may not parse; the raw url is in the haystack anyway */ }
  return foldForSearch([l.name, meta.label, meta.category, l.attribution?.text ?? '', host, l.url].join(' '));
}

/** Does this layer match a free-text query? All whitespace-separated terms must
 *  match, so "nasa true" narrows rather than widens. */
export function matchesQuery(l: Pick<AtlasLayer, 'name' | 'format' | 'url' | 'attribution'>, query: string): boolean {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = haystack(l);
  return terms.every((t) => hay.includes(t));
}

/** Filter a stack by free text, keeping panel (top-first) order. */
export function searchLayers(layers: readonly AtlasLayer[], query: string): AtlasLayer[] {
  return stackTopFirst(layers).filter((l) => matchesQuery(l, query));
}
