/**
 * KML 2.2 → canonical `Story` items.
 *
 * Like `./geojson`, this produces `Item[]` and not renderer objects: Cesium
 * ships a `KmlDataSource`, but it terminates in Cesium entities, which means a
 * KML import could never be re-exported, collected, or drawn by the WebXR
 * globe. Landing in the model is the whole point.
 *
 * The headline capability here is TIME. Google Earth's own documentation calls
 * time-based KML poorly supported and the desktop client's handling of
 * `<TimeSpan>` on nested features is famously patchy — but `<TimeStamp>`,
 * `<TimeSpan>` and `<gx:Track>` are precisely the information Atlas is built
 * around, so every one of them maps onto `Item.time` / `track.path` and drives
 * the CZML clock. A KML that Google Earth shows as a static pile of pins plays
 * back as a journey here.
 *
 * XML is parsed with `fast-xml-parser`: MIT, no DOM dependency, so the same
 * code path runs in the server (Node) and in the viewer (browser) — importing
 * a dropped .kml must not require a round-trip to the API.
 */
import { XMLParser } from 'fast-xml-parser';
import { STORY_SCHEMA_ID, Story } from './schema.js';
import type { GeoPath, GeoPoint, Item, Story as StoryT, TimeSpec, TrackSample } from './schema.js';

export interface KmlImportOptions {
  /** Prefix for generated ids when a Placemark carries no `id` attribute. Default `kml`. */
  idPrefix?: string;
  /** Applied to Placemarks with no `<TimeStamp>`/`<TimeSpan>` of their own. */
  defaultTime?: TimeSpec;
  /**
   * Record the enclosing `<Folder>`/`<Document>` names as item tags. On by
   * default: folders are how KML authors express layers ("Day 1", "Hotels"),
   * and `tags` is the only field in `Item` that can carry that grouping.
   */
  foldersAsTags?: boolean;
}

export interface KmlStoryOptions extends KmlImportOptions {
  id?: string;
  title?: string;
  description?: string;
}

/**
 * KMZ is a ZIP archive whose first entry is normally `doc.kml`. Unzipping it
 * means pulling in an inflate implementation, which this package deliberately
 * does not do — it is the schema package, not an archive library. Detect it and
 * say exactly what to do instead, because the failure mode otherwise is
 * `fast-xml-parser` choking on binary and reporting a meaningless char offset.
 */
export class KmzUnsupportedError extends Error {
  constructor() {
    super(
      'This looks like a KMZ archive (ZIP), not KML. KMZ is not supported: ' +
        'unzip it and pass the KML entry inside (usually `doc.kml`) to kmlToStory/kmlToItems.',
    );
    this.name = 'KmzUnsupportedError';
  }
}

/** ZIP local-file-header / central-directory / end-of-central-directory magic. */
function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function asText(input: string | Uint8Array | ArrayBuffer): string {
  if (typeof input === 'string') {
    // A KMZ read with the wrong encoding still starts with the same two chars.
    if (/^PK[\x03\x05\x07]/.test(input)) throw new KmzUnsupportedError();
    return input;
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isZip(bytes)) throw new KmzUnsupportedError();
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Tags that must always come back as arrays.
 *
 * fast-xml-parser collapses a single occurrence to a bare object, so without
 * this a one-Placemark document and a two-Placemark document have different
 * shapes and every consumer needs an `Array.isArray` dance. Listing them here
 * once is the cheaper fix.
 */
const ALWAYS_ARRAY = new Set([
  'Document',
  'Folder',
  'Placemark',
  'Style',
  'StyleMap',
  'Pair',
  'MultiGeometry',
  'Point',
  'LineString',
  'LinearRing',
  'Polygon',
  'Track',
  'innerBoundaryIs',
  'when',
  'coord',
]);

/**
 * `removeNSPrefix` strips `kml:` AND `gx:`. Both matter: KML in the wild is
 * written with an explicit `kml:` prefix about as often as with a default
 * namespace, and Google's `gx:` extensions (`gx:Track`, `gx:coord`) are the
 * only faithful representation of a timed path. Flattening them means one set
 * of tag names to handle instead of four spellings of `<Placemark>`.
 *
 * `parseTagValue: false` is load-bearing, not tidiness: KML colours are
 * hex-ish strings like `00000000` and `<width>3</width>` sits next to them.
 * Left on, the parser turns a fully-transparent colour into the number 0 and
 * every colour into a lossy float. Parse numbers where we know we want one.
 *
 * `htmlEntities: true` is what decodes numeric character references — the base
 * entity table only knows the five XML ones, so `Caf&#233;` would otherwise
 * survive as literal text and come back out of `storyToKml` double-escaped as
 * `Caf&amp;#233;`. Google Earth writes accented names this way constantly.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ALWAYS_ARRAY.has(name),
});

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);

/** A tag's text content. fast-xml-parser gives a string for a plain element and
 *  a `{ '#text': … }` object when the element also carried attributes. */
function text(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (isNode(v)) return text(v['#text']);
  return undefined;
}

function numText(v: unknown): number | undefined {
  const s = text(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Read a child that may or may not have been forced into an array. */
function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// ---- colour ---------------------------------------------------------------

/**
 * KML colours are `aabbggrr` — ALPHA FIRST and the RGB triple REVERSED relative
 * to CSS's `#rrggbb`. Reading one as the other silently swaps red and blue, so
 * a red route imports as blue and nobody notices until someone compares against
 * Google Earth. Returns `#rrggbb` plus the alpha as a separate 0..1 number,
 * because `Item` keeps fill colour and fill opacity in separate fields.
 */
export function kmlColorToCss(kml: string | undefined): { color?: string; opacity?: number } {
  const s = kml?.trim().replace(/^#/, '');
  if (!s || !/^[0-9a-f]{8}$/i.test(s)) {
    // Six-digit values appear in hand-edited files; treat them as opaque bbggrr.
    if (s && /^[0-9a-f]{6}$/i.test(s)) {
      return { color: `#${s.slice(4, 6)}${s.slice(2, 4)}${s.slice(0, 2)}`, opacity: 1 };
    }
    return {};
  }
  const aa = parseInt(s.slice(0, 2), 16);
  const bb = s.slice(2, 4);
  const gg = s.slice(4, 6);
  const rr = s.slice(6, 8);
  return { color: `#${rr}${gg}${bb}`, opacity: aa / 255 };
}

/** `#rrggbb`(`aa`) → KML `aabbggrr`. The inverse of `kmlColorToCss`; lives here
 *  so both directions of the byte-order swap sit side by side. */
export function cssToKmlColor(css: string | undefined, opacity?: number): string | undefined {
  let h = css?.trim().replace(/^#/, '');
  if (!h) return undefined;
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6,8}$/i.test(h)) return undefined;
  const embedded = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  const a = opacity != null ? Math.round(Math.min(1, Math.max(0, opacity)) * 255) : embedded;
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `${hex(a)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
}

// ---- styles ---------------------------------------------------------------

interface KmlStyle {
  lineColor?: string;
  lineOpacity?: number;
  lineWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
  iconColor?: string;
}

function readStyle(node: unknown): KmlStyle {
  if (!isNode(node)) return {};
  const out: KmlStyle = {};

  const lineStyle = first(node.LineStyle);
  if (isNode(lineStyle)) {
    const { color, opacity } = kmlColorToCss(text(lineStyle.color));
    out.lineColor = color;
    out.lineOpacity = opacity;
    out.lineWidth = numText(lineStyle.width);
  }

  const polyStyle = first(node.PolyStyle);
  if (isNode(polyStyle)) {
    const { color, opacity } = kmlColorToCss(text(polyStyle.color));
    out.fillColor = color;
    out.fillOpacity = opacity;
    // `<fill>0</fill>` is KML's "outline only". There is no boolean for that in
    // `Item`; opacity 0 says the same thing to every renderer and survives the
    // round-trip back out to `<fill>0</fill>`.
    if (text(polyStyle.fill) === '0') out.fillOpacity = 0;
    if (text(polyStyle.outline) === '0') out.lineWidth = 0;
  }

  const iconStyle = first(node.IconStyle);
  if (isNode(iconStyle)) out.iconColor = kmlColorToCss(text(iconStyle.color)).color;

  return out;
}

/**
 * Collect every `<Style id>` and `<StyleMap id>` in the document, wherever they
 * sit. KML allows shared styles at any container level (and `<styleUrl>` may
 * point forward), so a single deep pass before feature walking is the only
 * correct order — resolving lazily during the walk misses forward references.
 */
function collectStyles(node: unknown, styles: Map<string, KmlStyle>, maps: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectStyles(n, styles, maps);
    return;
  }
  if (!isNode(node)) return;

  for (const s of asArray(node.Style)) {
    const id = text(isNode(s) ? s['@_id'] : undefined);
    if (id) styles.set(id, readStyle(s));
  }
  for (const m of asArray(node.StyleMap)) {
    if (!isNode(m)) continue;
    const id = text(m['@_id']);
    if (!id) continue;
    const pairs = asArray(m.Pair).filter(isNode);
    // A StyleMap is normal/highlight; the globe never draws the mouse-over
    // variant, so `normal` wins and we fall back to the first pair only when a
    // producer omitted the key.
    const normal = pairs.find((p) => text(p.key) === 'normal') ?? pairs[0];
    if (!normal) continue;
    const url = text(normal.styleUrl);
    if (url) maps.set(id, url.replace(/^#/, ''));
    else {
      const inline = first(normal.Style);
      if (inline) styles.set(id, readStyle(inline));
    }
  }

  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectStyles(v, styles, maps);
  }
}

function resolveStyle(
  ref: string | undefined,
  styles: Map<string, KmlStyle>,
  maps: Map<string, string>,
): KmlStyle {
  let id = ref?.replace(/^#/, '');
  // StyleMap→StyleMap chains are legal and, in a corrupt file, cyclic. Bound it.
  for (let hop = 0; id && hop < 8; hop += 1) {
    const direct = styles.get(id);
    if (direct) return direct;
    const next = maps.get(id);
    if (!next) break;
    id = next;
  }
  return {};
}

// ---- time -----------------------------------------------------------------

/**
 * `<TimeStamp><when>` and `<TimeSpan><begin>/<end>` → `TimeSpec`.
 *
 * KML permits truncated instants (`2026`, `2026-05`, `2026-05-09`) which `Date`
 * parses as UTC-midnight boundaries; they are kept verbatim because `Iso8601`
 * only demands parseability and truncating further would fake a precision the
 * author did not claim.
 */
function readTime(node: Node): TimeSpec | undefined {
  const stamp = first(node.TimeStamp);
  if (isNode(stamp)) {
    const when = text(stamp.when);
    if (when && !Number.isNaN(Date.parse(when))) return { at: when };
  }
  const span = first(node.TimeSpan);
  if (isNode(span)) {
    const begin = text(span.begin);
    const end = text(span.end);
    const okBegin = begin && !Number.isNaN(Date.parse(begin)) ? begin : undefined;
    const okEnd = end && !Number.isNaN(Date.parse(end)) ? end : undefined;
    if (okBegin) return okEnd ? { start: okBegin, end: okEnd } : { start: okBegin };
    // An open-start TimeSpan ("everything up to 1945") has no representation in
    // `TimeSpec`, which requires `at` or `start`. It collapses to the instant of
    // its end — LOSSY, and the only alternative was dropping the time entirely.
    if (okEnd) return { at: okEnd };
  }
  return undefined;
}

// ---- geometry -------------------------------------------------------------

/**
 * `<coordinates>` is `lon,lat[,alt]` tuples separated by ANY whitespace — and
 * real files put newlines and tabs between them, and sometimes a stray space
 * after a comma. Split on whitespace, then on commas, and drop anything that
 * doesn't yield two finite numbers rather than emitting NaN positions that
 * crash Cesium's bounding-sphere maths much later.
 */
function parseCoordinates(raw: unknown): GeoPath {
  const s = text(raw);
  if (!s) return [];
  const out: GeoPath = [];
  for (const tuple of s.split(/\s+/)) {
    if (!tuple) continue;
    const parts = tuple.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const alt = parts.length > 2 ? Number(parts[2]) : NaN;
    out.push(Number.isFinite(alt) ? { lat, lon, height: alt } : { lat, lon });
  }
  return out;
}

/** KML rings repeat the first vertex last, same as GeoJSON. See `GeoPath`. */
function openRing(ring: GeoPath): GeoPath {
  if (ring.length < 2) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a.lat === b.lat && a.lon === b.lon && (a.height ?? 0) === (b.height ?? 0)) return ring.slice(0, -1);
  return ring;
}

/** `<gx:coord>` is SPACE-separated `lon lat alt` — not comma-separated like
 *  `<coordinates>`. Two different delimiters in the same document is exactly
 *  the sort of thing a shared parser gets wrong. */
function parseGxCoord(raw: unknown): GeoPoint | undefined {
  const s = text(raw);
  if (!s) return undefined;
  const parts = s.split(/\s+/);
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  const alt = parts.length > 2 ? Number(parts[2]) : NaN;
  return Number.isFinite(alt) ? { lat, lon, height: alt } : { lat, lon };
}

// ---- walk -----------------------------------------------------------------

interface PlacemarkContext {
  title?: string;
  description?: string;
  tags?: string[];
  time?: TimeSpec;
  style: KmlStyle;
}

/** Convert a KML document into canonical items. Throws `KmzUnsupportedError`
 *  when handed a KMZ archive. */
export function kmlToItems(input: string | Uint8Array | ArrayBuffer, opts: KmlImportOptions = {}): Item[] {
  return itemsFromDoc(parser.parse(asText(input)) as Node, opts);
}

/** Shared by `kmlToItems` and `kmlToStory` so a large document is parsed once —
 *  `kmlToStory` also needs the `<Document>` name and would otherwise re-parse. */
function itemsFromDoc(doc: Node, opts: KmlImportOptions): Item[] {
  const styles = new Map<string, KmlStyle>();
  const maps = new Map<string, string>();
  collectStyles(doc, styles, maps);

  const prefix = opts.idPrefix ?? 'kml';
  const foldersAsTags = opts.foldersAsTags ?? true;
  const items: Item[] = [];
  const used = new Set<string>();
  let n = 0;
  // Derived ids stay XML NCName-safe (letters, digits, `.`, `-`, `_`): they are
  // written straight into a Placemark's `id` attribute by `storyToKml`, and
  // `xsd:ID` rejects `#` — so a `#`-suffixed id would export as invalid KML.
  const uniqueId = (want: string): string => {
    let id = want;
    for (let i = 2; used.has(id); i += 1) id = `${want}__${i}`;
    used.add(id);
    return id;
  };

  const emitGeometry = (geom: Node, ctx: PlacemarkContext, baseId: string, part: { i: number }): void => {
    const idFor = (): string => uniqueId(part.i === 0 ? baseId : `${baseId}-${part.i}`);
    const base = { title: ctx.title, description: ctx.description, tags: ctx.tags, time: ctx.time };

    for (const pt of asArray(geom.Point)) {
      const p = isNode(pt) ? parseCoordinates(pt.coordinates)[0] : undefined;
      if (!p) continue;
      items.push({ ...base, id: idFor(), type: 'marker', position: p, color: ctx.style.iconColor });
      part.i += 1;
    }

    for (const ls of asArray(geom.LineString)) {
      const path = isNode(ls) ? parseCoordinates(ls.coordinates) : [];
      if (path.length < 2) continue;
      items.push({
        ...base,
        id: idFor(),
        type: 'line',
        positions: path,
        color: ctx.style.lineColor,
        width: ctx.style.lineWidth,
      });
      part.i += 1;
    }

    for (const poly of asArray(geom.Polygon)) {
      if (!isNode(poly)) continue;
      const outerNode = first(poly.outerBoundaryIs);
      const outer = openRing(parseCoordinates(isNode(outerNode) ? (first(outerNode.LinearRing) as Node)?.coordinates : undefined));
      if (outer.length < 3) continue;
      const holes: GeoPath[] = [];
      for (const inner of asArray(poly.innerBoundaryIs)) {
        if (!isNode(inner)) continue;
        // One `<innerBoundaryIs>` may legally wrap several `<LinearRing>`s.
        for (const ring of asArray(inner.LinearRing)) {
          const h = openRing(parseCoordinates(isNode(ring) ? ring.coordinates : undefined));
          if (h.length >= 3) holes.push(h);
        }
      }
      items.push({
        ...base,
        id: idFor(),
        type: 'polygon',
        positions: outer,
        holes: holes.length ? holes : undefined,
        fillColor: ctx.style.fillColor,
        fillOpacity: ctx.style.fillOpacity,
        outlineColor: ctx.style.lineColor,
        outlineWidth: ctx.style.lineWidth,
      });
      part.i += 1;
    }

    // `<gx:Track>` (namespace-stripped to `Track`) is a timed path: parallel
    // `<when>` and `<gx:coord>` lists. This is the one KML construct that maps
    // onto `track` rather than `line`, and it is why a Google Earth flight log
    // plays back on the Atlas clock instead of sitting still.
    for (const trk of asArray(geom.Track)) {
      if (!isNode(trk)) continue;
      const whens = asArray(trk.when).map((w) => text(w));
      const coords = asArray(trk.coord).map((c) => parseGxCoord(c));
      const path: TrackSample[] = [];
      // The two lists are positional; a mismatched pair means a truncated file,
      // so zip to the shorter of the two rather than emitting undefined samples.
      for (let i = 0; i < Math.min(whens.length, coords.length); i += 1) {
        const when = whens[i];
        const c = coords[i];
        if (!when || !c || Number.isNaN(Date.parse(when))) continue;
        path.push({ lon: c.lon, lat: c.lat, height: c.height, time: when });
      }
      if (!path.length) continue;
      items.push({
        title: ctx.title,
        description: ctx.description,
        tags: ctx.tags,
        id: idFor(),
        type: 'track',
        path,
        color: ctx.style.lineColor,
      });
      part.i += 1;
    }

    // A `<MultiGeometry>` holds any mix of the above. Each becomes its own
    // item — KML's "one feature, many geometries" has no equivalent in `Item`,
    // so this is LOSSY on re-export: N geometries return as N Placemarks.
    for (const mg of asArray(geom.MultiGeometry)) {
      if (isNode(mg)) emitGeometry(mg, ctx, baseId, part);
    }
  };

  const walk = (node: unknown, folders: string[], inheritedStyle: KmlStyle): void => {
    if (!isNode(node)) return;

    for (const pm of asArray(node.Placemark)) {
      if (!isNode(pm)) continue;
      // An inline `<Style>` on the Placemark beats the shared one it points at.
      const inline = pm.Style ? readStyle(first(pm.Style)) : undefined;
      const shared = resolveStyle(text(pm.styleUrl), styles, maps);
      const style: KmlStyle = { ...inheritedStyle, ...shared, ...inline };
      const ctx: PlacemarkContext = {
        title: text(pm.name),
        description: text(pm.description),
        tags: foldersAsTags && folders.length ? [...folders] : undefined,
        time: readTime(pm) ?? opts.defaultTime,
        style,
      };
      const baseId = text(pm['@_id']) ?? `${prefix}_${n}`;
      n += 1;
      emitGeometry(pm, ctx, baseId, { i: 0 });
    }

    for (const key of ['Document', 'Folder'] as const) {
      for (const child of asArray(node[key])) {
        if (!isNode(child)) continue;
        const name = text(child.name);
        // The outermost `<Document>` name is the story title, not a layer, so
        // it is only pushed as a tag for nested containers.
        const nextFolders = name && (key === 'Folder' || folders.length) ? [...folders, name] : folders;
        walk(child, nextFolders, inheritedStyle);
      }
    }
  };

  // The root may be `<kml>`, a bare `<Document>`, or (in fragments pasted from
  // a larger file) a lone `<Placemark>`. Start from whichever is present.
  walk(isNode(doc.kml) ? doc.kml : doc, [], {});
  return items;
}

/** Convert a KML document into a validated `Story` with no scenes. */
export function kmlToStory(input: string | Uint8Array | ArrayBuffer, opts: KmlStoryOptions = {}): StoryT {
  const doc = parser.parse(asText(input)) as Node;
  const items = itemsFromDoc(doc, opts);
  const root = isNode(doc.kml) ? doc.kml : doc;
  const topDoc = first(root.Document);

  return Story.parse({
    schema: STORY_SCHEMA_ID,
    id: opts.id ?? 'kml-import',
    title: opts.title ?? (isNode(topDoc) ? text(topDoc.name) : undefined) ?? 'Imported KML',
    description: opts.description ?? (isNode(topDoc) ? text(topDoc.description) : undefined),
    // No `timeline` — `timelineBounds` derives the window from the imported
    // item times, which is the whole reason the KML times were read.
    items,
    scenes: [],
    provenance: { kind: 'import', source: 'kml', importedAt: new Date().toISOString() },
  });
}
