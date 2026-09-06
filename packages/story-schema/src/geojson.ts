/**
 * GeoJSON (RFC 7946) → canonical `Story` items.
 *
 * The output is `Item[]`, deliberately NOT Cesium entities. Everything a user
 * brings in has to land in the model or it is second-class: it can't be
 * exported (`storyToKml`), can't be collected into a scrapbook, can't be
 * validated, and only renders on whichever renderer happened to consume the
 * import. Both globes read `storyEntities()`, so an imported polygon behaves
 * exactly like an authored one on Cesium AND in WebXR the moment it is an
 * `Item`. Importing straight into `Cesium.GeoJsonDataSource` would have been
 * three lines and a dead end.
 *
 * Dependency-free: GeoJSON is already JSON, so there is nothing to parse.
 */
import { STORY_SCHEMA_ID, Story } from './schema.js';
import type { GeoPath, GeoPoint, Item, Story as StoryT, TimeSpec } from './schema.js';

export interface GeoJsonImportOptions {
  /** Prefix for generated ids when a feature carries none. Default `gj`. */
  idPrefix?: string;
  /** Applied to features whose properties carry no recognisable time. */
  defaultTime?: TimeSpec;
}

export interface GeoJsonStoryOptions extends GeoJsonImportOptions {
  id?: string;
  title?: string;
  description?: string;
}

/**
 * simplestyle-spec (mapbox/simplestyle-spec) is what GitHub, geojson.io, Mapbox
 * and every "export as GeoJSON" button emit, so it is the de-facto styling
 * convention and worth honouring even though RFC 7946 §7 says properties are
 * opaque. Anything we don't recognise stays untouched in the source document —
 * we simply don't carry it, since `Item` has no free-form property bag.
 */
interface SimpleStyle {
  'marker-color'?: unknown;
  'marker-symbol'?: unknown;
  stroke?: unknown;
  'stroke-width'?: unknown;
  'stroke-opacity'?: unknown;
  fill?: unknown;
  'fill-opacity'?: unknown;
}

type Props = Record<string, unknown> & SimpleStyle;

/** GeoJSON positions are `[lon, lat, height?]` — LONGITUDE FIRST (RFC 7946 §3.1.1),
 *  the opposite reading order to "lat/long" in English. This function is the only
 *  place that order is decoded; keep it that way. */
function toPoint(pos: unknown): GeoPoint | undefined {
  if (!Array.isArray(pos) || pos.length < 2) return undefined;
  const [lon, lat, height] = pos as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return undefined;
  }
  return typeof height === 'number' && Number.isFinite(height) ? { lat, lon, height } : { lat, lon };
}

function toPath(coords: unknown): GeoPath {
  if (!Array.isArray(coords)) return [];
  const out: GeoPath = [];
  for (const c of coords) {
    const p = toPoint(c);
    if (p) out.push(p);
  }
  return out;
}

/** GeoJSON rings MUST repeat the first position as the last (RFC 7946 §3.1.6).
 *  `GeoPath` stores rings unclosed — see the note there — so drop it on the way
 *  in. Compared by value, not identity: the closing vertex is a separate array. */
function openRing(ring: GeoPath): GeoPath {
  if (ring.length < 2) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a.lat === b.lat && a.lon === b.lon && (a.height ?? 0) === (b.height ?? 0)) return ring.slice(0, -1);
  return ring;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  // Shapefile→GeoJSON converters routinely stringify numeric attributes.
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A colour from properties. simplestyle says "#ace" or "#aaccee"; plenty of
 *  producers drop the `#`, so put it back rather than emitting an unparseable
 *  colour that renders as the `cssToRgba` fallback red. */
function color(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return /^[0-9a-f]{3,8}$/i.test(s) ? `#${s}` : s;
}

/** Common title keys, in the order producers actually use them. `title` first
 *  because simplestyle names it; `name` is what everything else uses. */
const TITLE_KEYS = ['title', 'name', 'Name', 'NAME', 'label'];
const DESCRIPTION_KEYS = ['description', 'Description', 'desc', 'comment', 'note'];

function pick(props: Props, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(props[k]);
    if (v) return v;
  }
  return undefined;
}

function tags(props: Props): string[] | undefined {
  const raw = props.tags ?? props.categories ?? props.keywords;
  if (Array.isArray(raw)) {
    const out = raw.map((t) => str(t)).filter((t): t is string => !!t);
    return out.length ? out : undefined;
  }
  // "a, b,c" — the shape a CSV-derived GeoJSON carries.
  const s = str(raw);
  if (!s) return undefined;
  const out = s.split(',').map((t) => t.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

/**
 * There is no time in RFC 7946 — the spec deliberately punted — so this reads
 * the conventions that grew in its absence: OGC Moving Features / the
 * `when`-style extensions, and the plain `start`/`end` pair every hand-rolled
 * exporter produces. Anything unparseable is ignored rather than thrown: a
 * feature with a junk date should still land on the globe.
 */
function timeOf(props: Props, fallback: TimeSpec | undefined): TimeSpec | undefined {
  const parseable = (v: unknown): string | undefined => {
    const s = str(v);
    return s && !Number.isNaN(Date.parse(s)) ? s : undefined;
  };
  const start = parseable(props.start ?? props.begin ?? props.startTime ?? props.start_time);
  const end = parseable(props.end ?? props.stop ?? props.endTime ?? props.end_time);
  if (start) return end ? { start, end } : { start };
  const at = parseable(props.time ?? props.timestamp ?? props.when ?? props.date ?? props.datetime);
  if (at) return { at };
  // An `end` with no `start` has no `TimeSpec` representation (the union needs
  // `at` or `start`), so it collapses to an instant. Lossy, and deliberately so.
  if (end) return { at: end };
  return fallback;
}

/** Every geometry from one feature shares the feature's non-spatial fields. */
interface FeatureContext {
  id?: string;
  /** Position in the document, used to name features that carry no id. */
  index: number;
  title?: string;
  description?: string;
  tags?: string[];
  time?: TimeSpec;
  props: Props;
}

/**
 * Convert a GeoJSON document (any of: Feature, FeatureCollection, a bare
 * geometry, or a GeometryCollection) into canonical items.
 *
 * Point/MultiPoint become `marker`s rather than `note`s: a note requires `text`
 * and forces a label onto the globe, whereas a marker is the neutral "something
 * is here" primitive and carries the imported title/description in the fields
 * every renderer already reads.
 */
export function geoJsonToItems(doc: unknown, opts: GeoJsonImportOptions = {}): Item[] {
  const prefix = opts.idPrefix ?? 'gj';
  const items: Item[] = [];
  // Ids are the join key scenes reference, so they must be unique within a
  // Story — but a FeatureCollection is free to repeat `id` or omit it. Treat a
  // feature id as a naming hint and let `uniqueId` have the final say.
  let n = 0;
  const used = new Set<string>();
  // Kept XML NCName-safe (letters, digits, `.`, `-`, `_`) because `storyToKml`
  // writes an item id straight into a Placemark's `xsd:ID` attribute, which
  // rejects `#` and most punctuation.
  const uniqueId = (want: string): string => {
    let id = want;
    for (let i = 2; used.has(id); i += 1) id = `${want}__${i}`;
    used.add(id);
    return id;
  };

  const emitGeometry = (geom: unknown, ctx: FeatureContext, part: number): void => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: unknown; coordinates?: unknown; geometries?: unknown };
    const type = str(g.type);
    if (!type) return;

    // One feature may explode into many items (MultiPolygon, GeometryCollection).
    // Suffix rather than renumber so a re-import of the same document is stable.
    const idFor = (i: number): string => {
      const base = ctx.id ?? `${prefix}_${ctx.index}`;
      return uniqueId(part === 0 && i === 0 ? base : `${base}-${part + i}`);
    };
    const base = {
      title: ctx.title,
      description: ctx.description,
      tags: ctx.tags,
      time: ctx.time,
    };

    switch (type) {
      case 'Point': {
        const p = toPoint(g.coordinates);
        if (p) items.push({ ...base, id: idFor(0), type: 'marker', position: p, color: color(ctx.props['marker-color']) });
        break;
      }
      case 'MultiPoint': {
        const pts = toPath(g.coordinates);
        pts.forEach((p, i) => {
          items.push({ ...base, id: idFor(i), type: 'marker', position: p, color: color(ctx.props['marker-color']) });
        });
        break;
      }
      case 'LineString': {
        const path = toPath(g.coordinates);
        if (path.length >= 2) items.push({ ...base, id: idFor(0), type: 'line', ...lineStyle(ctx.props), positions: path });
        break;
      }
      case 'MultiLineString': {
        const parts = Array.isArray(g.coordinates) ? g.coordinates : [];
        parts.forEach((c, i) => {
          const path = toPath(c);
          if (path.length >= 2) items.push({ ...base, id: idFor(i), type: 'line', ...lineStyle(ctx.props), positions: path });
        });
        break;
      }
      case 'Polygon': {
        const poly = polygonFromRings(g.coordinates, ctx.props);
        if (poly) items.push({ ...base, id: idFor(0), ...poly });
        break;
      }
      case 'MultiPolygon': {
        const polys = Array.isArray(g.coordinates) ? g.coordinates : [];
        polys.forEach((rings, i) => {
          const poly = polygonFromRings(rings, ctx.props);
          if (poly) items.push({ ...base, id: idFor(i), ...poly });
        });
        break;
      }
      case 'GeometryCollection': {
        const gs = Array.isArray(g.geometries) ? g.geometries : [];
        // `part` accumulates so nested collections don't collide on `#0`.
        gs.forEach((sub, i) => emitGeometry(sub, ctx, part + i));
        break;
      }
      default:
        // Unknown geometry type (a GeoJSON-ish dialect, or a null geometry on a
        // properties-only feature) — skip rather than throw. A 5000-feature
        // import must not die on one bad row.
        break;
    }
  };

  const emitFeature = (feature: unknown): void => {
    if (!feature || typeof feature !== 'object') return;
    const f = feature as { id?: unknown; properties?: unknown; geometry?: unknown };
    const props = (f.properties && typeof f.properties === 'object' ? f.properties : {}) as Props;
    const ctx: FeatureContext = {
      id: str(f.id) ?? (typeof f.id === 'number' ? `${prefix}_${f.id}` : undefined) ?? str(props.id),
      index: n,
      title: pick(props, TITLE_KEYS),
      description: pick(props, DESCRIPTION_KEYS),
      tags: tags(props),
      time: timeOf(props, opts.defaultTime),
      props,
    };
    n += 1;
    emitGeometry(f.geometry, ctx, 0);
  };

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const d = node as { type?: unknown; features?: unknown };
    const type = str(d.type);
    if (type === 'FeatureCollection') {
      const feats = Array.isArray(d.features) ? d.features : [];
      for (const f of feats) walk(f);
    } else if (type === 'Feature') {
      emitFeature(node);
    } else if (type) {
      // A bare geometry with no Feature wrapper is legal GeoJSON and common in
      // API responses; give it an empty properties bag.
      emitGeometry(node, { props: {} as Props, index: n, time: opts.defaultTime }, 0);
      n += 1;
    }
  };

  walk(doc);
  return items;
}

/** simplestyle stroke properties → the `line` style fields. */
function lineStyle(props: Props): { color?: string; width?: number } {
  return { color: color(props.stroke), width: num(props['stroke-width']) };
}

/**
 * A GeoJSON Polygon's coordinates are `[outerRing, ...innerRings]`. The spec
 * fixes winding (outer counter-clockwise, holes clockwise) but real files
 * violate it constantly, so ring ORDER — not winding — decides which is the
 * hole, exactly as every other reader does it.
 */
function polygonFromRings(
  rings: unknown,
  props: Props,
): Omit<Extract<Item, { type: 'polygon' }>, 'id' | 'title' | 'description' | 'tags' | 'time'> | undefined {
  if (!Array.isArray(rings) || !rings.length) return undefined;
  const outer = openRing(toPath(rings[0]));
  if (outer.length < 3) return undefined;
  const holes = rings
    .slice(1)
    .map((r) => openRing(toPath(r)))
    .filter((r) => r.length >= 3);
  return {
    type: 'polygon',
    positions: outer,
    holes: holes.length ? holes : undefined,
    fillColor: color(props.fill),
    fillOpacity: num(props['fill-opacity']),
    outlineColor: color(props.stroke),
    outlineWidth: num(props['stroke-width']),
  };
}

/** Convert a GeoJSON document into a validated `Story` with no scenes. The
 *  caller decides how to narrate it; import only supplies the geometry. */
export function geoJsonToStory(doc: unknown, opts: GeoJsonStoryOptions = {}): StoryT {
  const items = geoJsonToItems(doc, opts);
  return Story.parse({
    schema: STORY_SCHEMA_ID,
    id: opts.id ?? 'geojson-import',
    title: opts.title ?? titleOf(doc) ?? 'Imported GeoJSON',
    description: opts.description,
    // No `timeline`: `timelineBounds` derives the clock window from the items'
    // own times, and inventing one here would pin every undated import to the
    // epoch and make the scrubber useless.
    items,
    scenes: [],
    provenance: { kind: 'import', source: 'geojson', importedAt: new Date().toISOString() },
  });
}

/** Some producers put a collection-level name on the FeatureCollection itself. */
function titleOf(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const d = doc as { name?: unknown; title?: unknown; properties?: unknown };
  const own = str(d.name) ?? str(d.title);
  if (own) return own;
  const props = d.properties && typeof d.properties === 'object' ? (d.properties as Props) : undefined;
  return props ? pick(props, TITLE_KEYS) : undefined;
}
