/**
 * Companion Atlas — canonical 4D `Story` schema (single source of truth).
 *
 * This package is the CONSOLIDATION of two prior, divergent data models:
 *   - Companion-Atlas `src/atlas/schema.ts` (`Story`: `media[]` + `layers[]`,
 *     pipeline-centric, Zod-mirrored on the server), and
 *   - CI-Earth-2 `packages/scrapbook` (`Scrapbook`: typed `items[]`,
 *     viewer/CZML-centric, JSON-Schema-first, with a working CZML converter).
 *
 * The canonical `Story` is a **superset**: it keeps Atlas's `schema` identity
 * (`companion.atlas/story@1`) and its `media[]`/`layers[]`, and adds Earth-2's
 * typed `items[]`. Legacy documents of *either* shape load through the
 * normalizers in `./normalize` — see that file and the tests for proof both
 * historical sample documents round-trip.
 *
 * Zod is the single source of truth. TypeScript types are inferred from it, and
 * `schema/story.schema.json` (JSON Schema draft 2020-12) is GENERATED from it
 * (`npm run gen:schema`) so external validators get an artifact without a second
 * hand-maintained model.
 */
import { z } from 'zod';

export const STORY_SCHEMA_ID = 'companion.atlas/story@1' as const;

/** ISO-8601 / RFC-3339 timestamp, e.g. "2026-03-14T09:00:00Z". Permissive on
 *  format (legacy docs are not all strict RFC-3339) but must be **parseable** by
 *  `Date` — otherwise the CZML converter (`new Date(x).toISOString()`) would
 *  throw on a document that validated. */
export const Iso8601 = z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), {
  message: 'must be a parseable date/time',
});

/** WGS84 geographic point. `height` is metres above the ellipsoid. */
export const GeoPoint = z.object({
  lat: z.number(),
  lon: z.number(),
  height: z.number().optional(),
});

export const Visibility = z.enum(['private', 'unlisted', 'public']);

export const Author = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    avatarUrl: z.string().optional(),
  }),
]);

/** A scene's time: an instant OR an interval. Both `end` and `stop` are
 *  accepted for the interval close (Earth-2 used `end`, Atlas used `stop`). */
export const TimeSpec = z.union([
  Iso8601,
  z
    .object({
      at: Iso8601.optional(),
      start: Iso8601.optional(),
      end: Iso8601.optional(),
      stop: Iso8601.optional(),
    })
    .refine((t) => t.at || t.start, 'time interval needs `at` or `start`'),
]);

/** Playback clock. Canonical close is `stop`; `end` is accepted as an alias. */
export const Timeline = z
  .object({
    start: Iso8601,
    stop: Iso8601.optional(),
    end: Iso8601.optional(),
    current: Iso8601.optional(),
    /** Seconds of story time per real second. */
    multiplier: z.number().optional(),
    loop: z.boolean().optional(),
  })
  .refine((t) => t.stop || t.end, 'timeline needs `stop` (or legacy `end`)');

/** Camera framing. Supports both the Atlas orbit form (`location` + `range`)
 *  and the Earth-2 free form (`lon`/`lat`/`height` + heading/pitch/roll).
 *  `normalizeCamera` collapses either into a resolved pose at render time. */
export const Camera = z
  .object({
    location: GeoPoint.optional(),
    lon: z.number().optional(),
    lat: z.number().optional(),
    height: z.number().optional(),
    heading: z.number().optional(),
    pitch: z.number().optional(),
    roll: z.number().optional(),
    /** Orbit distance from the target in metres (Atlas). */
    range: z.number().optional(),
    durationMs: z.number().optional(),
  })
  .refine((c) => c.location || (c.lon != null && c.lat != null), 'camera needs a location');

export const Media = z.object({
  url: z.string(),
  mimeType: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  posterUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
});

export const ProvenanceKind = z.enum(['manual', 'upload', 'ci-memory', 'hermes', 'openclaw', 'import']);

export const Provenance = z
  .object({
    kind: ProvenanceKind.optional(),
    /** Source record id in CI-Server / Hermes memory. */
    memoryId: z.string().optional(),
    query: z.string().optional(),
    importedAt: z.string().optional(),
  })
  .passthrough();

/** A processed 3D asset produced by the reconstruction pipeline (Atlas). */
export const Derived3d = z.object({
  kind: z.enum(['3d-tiles', 'gaussian-splat', 'gltf', 'pointcloud']),
  /** tileset.json, .splat/.ksplat, .glb, or .laz served from the object store. */
  uri: z.string(),
  job: z.string().optional(),
});

export const TrackSample = z.object({
  lon: z.number(),
  lat: z.number(),
  height: z.number().optional(),
  time: Iso8601,
});

const itemBase = {
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  time: TimeSpec.optional(),
  source: Provenance.optional(),
  /**
   * The named place this happened at. Intrinsic to a located item ("this
   * happened at the Adler Theater"), and the key that lets a viewer group a
   * person's memories by where they keep going back to — which is the dominant
   * structure in a real archive: 50 visits to one venue, 19 to an airport.
   * `placeName` is denormalised so a story renders standalone; `placeId` is the
   * join key when a live Companion Memory is connected.
   */
  placeId: z.string().optional(),
  placeName: z.string().optional(),
  /** e.g. calendar | travel | commerce — how this memory came to exist. */
  category: z.string().optional(),
  /** Minutes, when the source knew a duration. */
  durationMinutes: z.number().optional(),
};

/** Typed renderable entities (from Earth-2). `photo`/`video` may additionally
 *  carry a `derived3d` link (from Atlas `MediaItem`) so a reconstruction travels
 *  with its source media. */
export const Item = z.discriminatedUnion('type', [
  z.object({ ...itemBase, type: z.literal('photo'), position: GeoPoint, media: Media, heading: z.number().optional(), derived3d: Derived3d.optional() }),
  z.object({ ...itemBase, type: z.literal('video'), position: GeoPoint, media: Media, derived3d: Derived3d.optional() }),
  z.object({ ...itemBase, type: z.literal('marker'), position: GeoPoint, icon: z.string().optional(), color: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('note'), position: GeoPoint, text: z.string() }),
  z.object({ ...itemBase, type: z.literal('track'), path: z.array(TrackSample).min(1), color: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('model'), position: GeoPoint, gltf: z.string(), scale: z.number().optional() }),
  z.object({ ...itemBase, type: z.literal('splat'), position: GeoPoint.optional(), tileset: z.string().optional(), splatUrl: z.string().optional() }),
  z.object({ ...itemBase, type: z.literal('tileset'), position: GeoPoint.optional(), tileset: z.string() }),
]);

/** Atlas source-media form (kept for provenance + the processing pipeline). */
export const MediaItem = z.object({
  id: z.string(),
  kind: z.enum(['image', 'image-set', 'video', 'pano360', 'gaussian-splat', 'model3d', 'pointcloud', 'audio']),
  uri: z.string(),
  thumbnailUri: z.string().optional(),
  caption: z.string().optional(),
  /** Longer narrative (e.g. a memory event's description). */
  description: z.string().optional(),
  /** Human place label (e.g. a memory event's `locationName`). */
  locationName: z.string().optional(),
  /** Participant entity ids from Companion Memory (`participantEntityIds`). */
  people: z.array(z.string()).optional(),
  capturedAt: Iso8601.optional(),
  location: GeoPoint.optional(),
  heading: z.number().optional(),
  exif: z.record(z.unknown()).optional(),
  derived3d: Derived3d.optional(),
  sourceMemoryId: z.string().optional(),
});

/**
 * The credit a layer's source requires, carried with the layer.
 *
 * This is a licence **condition**, not presentation polish. Nearly every open
 * source a layer can point at is attribution-conditioned — OpenStreetMap
 * (ODbL), EOX and CARTO (CC BY), OpenSeaMap (CC BY-SA) — so a story that
 * carries the layer but drops the credit is a story that cannot lawfully be
 * published. Publishing stories is what this document format exists for, which
 * is why this lives on `Layer` itself rather than in the free-form `style` bag
 * where a server round-trip or a renderer that ignores unknown style keys can
 * silently lose it.
 */
export const LayerAttribution = z.object({
  /** The credit line to display, e.g. "© OpenStreetMap contributors". */
  text: z.string(),
  /** Licence name or identifier, e.g. "ODbL-1.0", "CC BY 4.0", "CC BY-SA 2.0". */
  licence: z.string().optional(),
  /** Link for the credit — the source's page or the licence deed. */
  url: z.string().optional(),
  /**
   * True when the licence requires the notice on the map itself rather than
   * behind an attribution control (Mapbox's terms ask for this; Esri's do not).
   */
  onScreen: z.boolean().optional(),
});

/**
 * How to actually fetch and decode a layer's `uri`.
 *
 * `kind` says what the layer *is* for the scene graph; it does not say how to
 * load it, and it is lossy in both directions that matter. `kind: 'imagery'`
 * spans four mutually incompatible tile protocols (XYZ, TMS, WMTS, WMS) that
 * cannot be told apart from a URL at fetch time, and `kind: 'geojson'` is also
 * where KML and CZML land. Guessing wrong produces no error — the requests are
 * well-formed and simply address tiles that do not exist, so the globe stays
 * blank with nothing logged to explain it (the same failure mode
 * `viewer-react/src/renderers/basemaps.ts` documents for a mismatched tiling
 * scheme). `format` is the non-lossy statement of what the endpoint speaks.
 */
export const LayerFormat = z.enum([
  'xyz',
  'tms',
  'wmts',
  'wms',
  'geojson',
  'kml',
  'czml',
  '3d-tiles',
  'gaussian-splat',
  'quantized-mesh',
]);

export const Layer = z.object({
  id: z.string(),
  kind: z.enum(['imagery', 'terrain', '3d-tiles', 'gaussian-splat', 'geojson', 'model', 'pin']),
  /** Human label for a layer list; `id` is a key, not something to show. */
  name: z.string().optional(),
  uri: z.string().optional(),
  /** Wire format of `uri`. See `LayerFormat` — `kind` cannot stand in for it. */
  format: LayerFormat.optional(),
  /** Required credit for the layer's source. See `LayerAttribution`. */
  attribution: LayerAttribution.optional(),
  style: z.record(z.unknown()).optional(),
  availability: z.object({ start: Iso8601, stop: Iso8601.optional(), end: Iso8601.optional() }).optional(),
  opacity: z.number().optional(),
  /** Drawn state. Absent means visible — a layer in the document is shown. */
  visible: z.boolean().optional(),
  /**
   * Draw order, low to high. Array position is not durable across a server
   * round-trip (stores and JSON transports are free to reorder), and there was
   * no z-order field at all, so overlay stacking could not be expressed.
   */
  order: z.number().optional(),
});

export const Basemap = z.object({
  imagery: z.string().optional(),
  terrain: z.boolean().optional(),
  provider: z.string().optional(),
});

export const SceneView = z.object({
  camera: Camera.optional(),
  basemap: z.string().optional(),
  terrain: z.string().optional(),
});

export const Scene = z.object({
  id: z.string(),
  title: z.string().optional(),
  /** Markdown narration. `caption` (Earth-2) is accepted and folded in. */
  narrative: z.string().optional(),
  caption: z.string().optional(),
  time: TimeSpec.optional(),
  camera: Camera.optional(),
  /** Entity ids highlighted on this page (into `items`/`media`). */
  itemIds: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
  mediaIds: z.array(z.string()).optional(),
  layerIds: z.array(z.string()).optional(),
  transition: z.object({ kind: z.enum(['fly', 'flyTo', 'cut']).optional(), type: z.enum(['flyTo', 'cut']).optional(), durationMs: z.number().optional() }).optional(),
  layout: z.enum(['card-left', 'card-right', 'card-bottom', 'fullscreen', 'split']).optional(),
  audioUrl: z.string().optional(),
});

/** The canonical, viewer-agnostic 4D unit. Renders on CesiumJS (via CZML +
 *  `Clock` + 3D Tiles), the R3F/WebXR globe, or MapLibre+deck.gl. */
export const Story = z
  .object({
    schema: z.literal(STORY_SCHEMA_ID),
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    author: Author.optional(),
    createdAt: Iso8601.optional(),
    updatedAt: Iso8601.optional(),
    visibility: Visibility.optional(),
    cover: z.string().optional(),
    /** Optional: legacy Atlas stories may omit it — `timelineBounds` derives the
     *  clock window from scene/entity times when it is absent. */
    timeline: Timeline.optional(),
    basemap: Basemap.optional(),
    view: SceneView.optional(),
    /** Atlas source-media form. At least one of `media`/`items` should be present. */
    media: z.array(MediaItem).optional(),
    /** Earth-2 typed entity form. */
    items: z.array(Item).optional(),
    layers: z.array(Layer).optional(),
    scenes: z.array(Scene),
    access: z.object({ visibility: Visibility, oidcSubject: z.string().optional() }).optional(),
    provenance: Provenance.extend({ source: z.string().optional(), memoryQuery: z.string().optional(), agent: z.string().optional() }).partial().optional(),
  });
// NOTE: no "must have media or items" refine — content may live only in `layers`
// (a guided tour of imagery/3D-Tiles) or `scenes` (a narrated flythrough), and
// the server builds a story incrementally from an empty draft. `storyEntities`
// simply returns [] when there are none.

// ---- inferred canonical types (the single source of truth) -----------------

export type GeoPoint = z.infer<typeof GeoPoint>;
export type Visibility = z.infer<typeof Visibility>;
export type Author = z.infer<typeof Author>;
export type TimeSpec = z.infer<typeof TimeSpec>;
export type Timeline = z.infer<typeof Timeline>;
export type Camera = z.infer<typeof Camera>;
export type Media = z.infer<typeof Media>;
export type Provenance = z.infer<typeof Provenance>;
export type Derived3d = z.infer<typeof Derived3d>;
export type TrackSample = z.infer<typeof TrackSample>;
export type Item = z.infer<typeof Item>;
export type ItemType = Item['type'];
export type MediaItem = z.infer<typeof MediaItem>;
export type LayerAttribution = z.infer<typeof LayerAttribution>;
export type LayerFormat = z.infer<typeof LayerFormat>;
export type Layer = z.infer<typeof Layer>;
export type Basemap = z.infer<typeof Basemap>;
export type Scene = z.infer<typeof Scene>;
export type Story = z.infer<typeof Story>;
