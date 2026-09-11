/**
 * Companion Memory → Atlas: the complete import path.
 *
 * `fetchMemoryStory()` (client.ts) is the one-call read the app boots with: a
 * single located `search()`, mapped to a Story. This module is the *import*
 * — the peer of the KML/GeoJSON importers in `@companion-atlas/story` — and it
 * pulls the three things a spatial archive is actually made of:
 *
 *   1. **Places** — the named, room-to-planet entities memories happen *in*,
 *      with their own coordinates and visit stats, as first-class rows rather
 *      than a denormalised `placeName` string repeated on every event.
 *   2. **Memories** — located events with media (thumbnail, kind, caption,
 *      EXIF, participants) or without (markers), filtered by time window and
 *      bounding box so a user can import "this trip" instead of everything.
 *   3. **Atlas's own rows** — stories previously written back by
 *      `exportStoryToMemory()`, reconstructed from their event metadata into
 *      real `Story` documents, which is what closes the round-trip.
 *
 * Three properties this module is built around, all learned the hard way:
 *
 * - **It never throws.** Every one of these calls crosses a network to a
 *   server that may be absent, slow, unauthenticated, or an older build. A
 *   rejected promise inside a React effect is an unhandled rejection and a
 *   blank globe; `importFromMemory` resolves with `connected: false` and a
 *   message, and always hands back a *valid* (possibly empty) Story so the
 *   caller can render unconditionally.
 * - **It degrades by phase.** A server with no `places()` still imports its
 *   memories; a server whose `EventType` has no `metadata` still imports
 *   everything except previously-saved Atlas stories. Each degradation lands
 *   in `warnings[]` rather than failing the whole import.
 * - **It follows the cursor.** `search()` is Relay-paged and CI-Server clamps
 *   `first` to 100. Not paging meant a large archive silently imported only
 *   its first page — and with `sortOrder: "asc"` the rows that went missing
 *   were the most recent ones, i.e. the ones a person would notice last.
 */
import {
  loadStory,
  memoryToStory,
  readGeoJsonPoint,
  STORY_SCHEMA_ID,
  type GeoPoint,
  type Item,
  type MediaItem,
  type Place,
  type Story,
} from '@companion-atlas/story';
import { MAX_PAGE_SIZE, fetchPlaces, memoryGraphQL, memoryOrigin, type MemorySource } from './client.js';

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * The `EventType` selection. Deliberately identical to `LOCATED_MEDIA_QUERY`'s
 * in `@companion-atlas/story` (that field list is the one verified against a
 * live CI-Server); this module needs its own query only because it varies two
 * things that query hardcodes — `hasLocation` (an `atlas-story` event with no
 * located entity carries no coordinates and would be filtered out) and the
 * optional `metadata` field.
 */
const EVENT_FIELDS = `
            id
            title
            description
            startTime
            endTime
            locationName
            locationCoordinates
            participantEntityIds
            mediaContentType
            previewUrl
            mediaUrl
            mediaWidth
            mediaHeight
            category
            durationMinutes
            sourceSystem
            timeSource
            location { id name placeKind }`;

/**
 * `metadata` is where Atlas's own write-back parks the whole Story document
 * (see `createEventInputFromStory`), so reading it is what makes the round-trip
 * lossless. It is a *probe*, not a requirement: `CreateEventInput.metadata`
 * exists on every CI-Server we know of, but whether `EventType` exposes it back
 * on read is unverified against a live server. Asking for a field a server
 * doesn't have fails the ENTIRE query with a validation error — one absent
 * field would otherwise take the whole import down — so the caller falls back
 * to the metadata-free selection on exactly that error and carries on.
 */
function searchQuery(withMetadata: boolean): string {
  return /* GraphQL */ `
  query AtlasMemoryImport(
    $first: Int = 100, $after: String,
    $startTime: String, $endTime: String, $bbox: [Float!],
    $eventTypes: [String!], $hasLocation: Boolean
  ) {
    search(
      input: {
        query: ""
        includeTypes: ["event"]
        eventTypes: $eventTypes
        # null == no filter (verified against a live server). Only the saved-story
        # pass leaves this null, because a story with no located entity has no
        # coordinates and hasLocation:true would hide it from its own author.
        hasLocation: $hasLocation
        startTime: $startTime
        endTime: $endTime
        bbox: $bbox
        sortBy: "time"
        sortOrder: "asc"
        first: $first
        after: $after
      }
    ) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          __typename
          ... on EventType {${EVENT_FIELDS}${withMetadata ? '\n            metadata' : ''}
          }
        }
      }
    }
  }
`;
}

/** A GraphQL *validation* failure — the server does not have that field/arg —
 *  as opposed to a runtime error, which retrying with fewer fields won't fix. */
const UNKNOWN_FIELD = /cannot query field|unknown field|unknown type|unknown argument|has no field|is not defined by type|did you mean/i;

/**
 * True when an error says "this server's schema doesn't have that" — the one
 * class of failure worth answering by asking for less. Shared with the export
 * path, which probes for an optional Place mutation the same way.
 */
export function isSchemaGap(e: unknown): boolean {
  return UNKNOWN_FIELD.test(e instanceof Error ? e.message : String(e));
}

/**
 * Per-endpoint memo of "does this server return `EventType.metadata`?".
 * Module-level because a React hook re-runs on every dependency change and
 * re-probing would cost a failed round-trip each time; keyed by endpoint so
 * switching servers (`?memory=`) re-probes the new one.
 */
const metadataCapability = new Map<string, boolean>();

/** Test seam: forget what we learned about every server. */
export function resetMemoryCapabilities(): void {
  metadataCapability.clear();
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Server-side narrowing, so a user imports "this trip" and not an entire life. */
export interface MemoryImportFilter {
  /** ISO-8601 lower bound on event time (inclusive, server-side). */
  start?: string;
  /** ISO-8601 upper bound on event time (inclusive, server-side). */
  end?: string;
  /**
   * `[west, south, east, north]` in EPSG:4326 degrees — CI-Server's `bbox`
   * argument order. A malformed box is dropped with a warning rather than sent,
   * because a server that ignores a bad filter silently returns *everything*,
   * which reads to the user as "the trip filter did nothing".
   */
  bbox?: [number, number, number, number];
  /** Restrict to specific CI-Server event types (`["photo","video"]`). Omit for
   *  every located event — a real archive types its memories `trip`/`order`/
   *  `transaction`, and enumerating that open taxonomy matches zero rows. */
  eventTypes?: string[];
}

export type MemoryImportPhase = 'places' | 'memories' | 'stories';

export interface MemoryImportProgress {
  phase: MemoryImportPhase;
  /** Pages fetched so far in this phase (1-based). */
  page: number;
  /** Rows accumulated so far in this phase. */
  loaded: number;
  /** The server's `totalCount` for this phase, when it reported one. */
  total?: number;
  /** True on the final callback for the phase. */
  done: boolean;
}

export interface MemoryImportOptions extends MemoryImportFilter {
  /** Import the named-Place roster too (default true). */
  includePlaces?: boolean;
  /** Reconstruct previously-exported Atlas stories (default true). */
  includeSavedStories?: boolean;
  /** Rows per request. Clamped to CI-Server's server-side maximum of 100. */
  pageSize?: number;
  /** Bound on pages per phase (default 50) — a runaway cursor is a hung tab. */
  maxPages?: number;
  /** Bound on rows per phase (default 5000). Exceeding it sets `truncated`. */
  maxItems?: number;
  /** Cancel in flight (an unmounting component, a superseded filter change). */
  signal?: AbortSignal;
  /** Progress ticks, one per page per phase. Never trusted to not throw. */
  onProgress?: (p: MemoryImportProgress) => void;
}

export interface MemoryImportStats {
  /** Located media memories in the derived story. */
  media: number;
  /** Typed entities in the derived story: located non-media memories
   *  (markers), plus any entity restored from a previous Atlas export. */
  markers: number;
  places: number;
  /** Previously-exported Atlas stories reconstructed from event metadata. */
  stories: number;
  /** Pages fetched across every phase. */
  pages: number;
  /** The server's reported located total, when it gave one. */
  totalCount?: number;
  /** True when a page/row bound stopped the import short of the whole archive. */
  truncated: boolean;
}

export interface MemoryImport {
  /** False when the server could not be reached or refused the query. Render
   *  "not connected" on this, not on `story.media.length === 0` — an archive
   *  legitimately has zero located rows, and the two states read differently. */
  connected: boolean;
  /** Always a valid Story, empty when nothing imported, so callers can render
   *  unconditionally instead of branching on null. */
  story: Story;
  /** The named-place roster: server rows first, plus any place referenced by an
   *  event that `places()` didn't return (or couldn't, on an older server). */
  places: Place[];
  /** Stories previously written back by `exportStoryToMemory`, newest last. */
  stories: Story[];
  /**
   * `memoryId → place identity`, keyed by the story-entity id (`mem:<id>`).
   *
   * The exact place join for *media* memories, which cannot carry it any other
   * way: `MediaItem` has no `placeId` field (only `Item` does), so a photo's
   * link to the Place it was taken at is lost the moment it becomes a
   * `MediaItem` — the pins group correctly but the photos all fall into "no
   * place". Apply it to the derived model with `applyMemoryPlaces()`.
   */
  placeOfMemory: Map<string, { placeId?: string; placeName?: string }>;
  stats: MemoryImportStats;
  /** Degradations worth showing the user (no `places()`, no `metadata`, a bad
   *  bbox, a truncated archive). Never contains a token or a header. */
  warnings: string[];
  /** Set when `connected` is false. Already scrubbed of any credential. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

interface SearchEnvelope {
  search?: {
    totalCount?: number;
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    edges?: unknown[];
  };
}

interface MemoryPlaceRef {
  id?: string | null;
  name?: string | null;
  placeKind?: string | null;
}

interface EventNode {
  __typename?: string;
  id?: string;
  title?: string | null;
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  locationName?: string | null;
  locationCoordinates?: unknown;
  participantEntityIds?: string[] | null;
  mediaContentType?: string | null;
  previewUrl?: string | null;
  mediaUrl?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  category?: string | null;
  durationMinutes?: number | null;
  sourceSystem?: string | null;
  timeSource?: string | null;
  location?: MemoryPlaceRef | null;
  metadata?: unknown;
}

const nodeOf = (edge: unknown): EventNode | undefined => {
  const node = (edge as { node?: EventNode } | null)?.node;
  return node && node.__typename === 'EventType' && node.id ? node : undefined;
};

interface PageResult {
  edges: unknown[];
  totalCount?: number;
  pages: number;
  truncated: boolean;
}

/**
 * Follow `pageInfo.endCursor` to the end of a `search()`, bounded four ways.
 *
 * Three of the four guards exist because a paginated API is trusted to
 * terminate and doesn't always: a server that reports `hasNextPage: true` on an
 * empty page, or that returns the same `endCursor` forever, spins this loop
 * until the tab dies. `maxPages`/`maxItems` bound the honest-but-enormous case.
 */
async function collectPages(
  src: MemorySource,
  query: string,
  variables: Record<string, unknown>,
  ctl: { maxPages: number; maxItems: number; signal?: AbortSignal },
  report: (p: Omit<MemoryImportProgress, 'phase'>) => void,
): Promise<PageResult> {
  const edges: unknown[] = [];
  let after: string | undefined;
  let seenCursor: string | undefined;
  let totalCount: number | undefined;
  let pages = 0;
  let truncated = false;

  for (;;) {
    if (ctl.signal?.aborted) break;
    const data = await memoryGraphQL<SearchEnvelope>(src, query, { ...variables, after }, { signal: ctl.signal });
    const search = data?.search;
    // A partial/garbled response (`data: null`, `search: {}`, `edges` a string)
    // must read as "no more rows", not blow up on `.length` — CI-Server behind a
    // proxy that rewrites errors is exactly where this happens.
    const page = Array.isArray(search?.edges) ? search!.edges! : [];
    if (typeof search?.totalCount === 'number') totalCount = search.totalCount;
    edges.push(...page);
    pages += 1;
    report({ page: pages, loaded: edges.length, total: totalCount, done: false });

    const info = search?.pageInfo;
    const next = info?.hasNextPage && info.endCursor ? info.endCursor : undefined;
    if (page.length === 0) break;          // server lied about hasNextPage
    if (!next) break;                      // honest end of the set
    if (next === seenCursor) break;         // cursor not advancing — would loop forever
    if (pages >= ctl.maxPages || edges.length >= ctl.maxItems) { truncated = true; break; }
    seenCursor = next;
    after = next;
  }

  report({ page: pages, loaded: edges.length, total: totalCount, done: true });
  return { edges, totalCount, pages, truncated };
}

/**
 * Run one search phase, retrying without `metadata` if the server rejects it.
 * The retry costs one wasted round-trip on an older server, once per endpoint
 * (see `metadataCapability`) — cheaper than either giving up the round-trip or
 * requiring an operator to configure which fields their server has.
 */
async function searchPhase(
  src: MemorySource,
  variables: Record<string, unknown>,
  ctl: { maxPages: number; maxItems: number; signal?: AbortSignal },
  report: (p: Omit<MemoryImportProgress, 'phase'>) => void,
  warnings: string[],
): Promise<PageResult & { hasMetadata: boolean }> {
  const key = memoryOrigin(src);
  const believed = metadataCapability.get(key);
  if (believed !== false) {
    try {
      const out = await collectPages(src, searchQuery(true), variables, ctl, report);
      metadataCapability.set(key, true);
      return { ...out, hasMetadata: true };
    } catch (e) {
      if (ctl.signal?.aborted) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!UNKNOWN_FIELD.test(msg)) throw e; // a real failure — don't mask it as a capability gap
      metadataCapability.set(key, false);
      warnings.push(
        'This Companion Memory does not expose `EventType.metadata`; ' +
        'stories previously saved from Atlas will import as plain pins.',
      );
    }
  }
  const out = await collectPages(src, searchQuery(false), variables, ctl, report);
  return { ...out, hasMetadata: false };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** `[west, south, east, north]`, or nothing plus a warning. */
function validBbox(bbox: MemoryImportFilter['bbox'], warnings: string[]): number[] | undefined {
  if (!bbox) return undefined;
  const ok =
    Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!ok) {
    warnings.push('Ignoring an invalid bounding box (expects [west, south, east, north] in degrees).');
    return undefined;
  }
  const [w, s, e, n] = bbox;
  if (s > n) {
    warnings.push('Ignoring a bounding box whose south edge is north of its north edge.');
    return undefined;
  }
  // West > east is legal: that's a box crossing the antimeridian, and CI-Server's
  // PostGIS predicate handles it. Latitude has no such wrap, hence the asymmetry.
  return [w, s, e, n];
}

/** CI-Server may hand `metadata` back as a JSON scalar (object) or as a string. */
function readMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch { /* a metadata blob that isn't JSON is not an error worth surfacing */ }
  }
  return undefined;
}

/**
 * Atlas's own write-back rows, recognised by `sourceSystem`.
 *
 * They must not go through the generic media/marker mapping: an `atlas-story`
 * event would land on the globe as an anonymous pin at its anchor coordinate,
 * and an `atlas-media` event would lose its image entirely (CI-Server's
 * `createEvent` has no media fields, so the URL lives in `metadata`). The
 * saved-story pass reconstructs both from their metadata instead.
 */
const isAtlasOwned = (node: EventNode): boolean => node.sourceSystem === 'companion-atlas';

/**
 * Places that events reference but `places()` did not return — either because
 * the server has no `places()` at all, or because the roster is scoped
 * differently from the search. Without this a whole archive can come back with
 * an empty place list while every pin names a place.
 *
 * Coordinates are the mean of the referencing events' own coordinates, and are
 * attached ONLY to places absent from the server roster. A roster row that
 * carries no coordinates carries none deliberately (a `country` or `planet` has
 * no single point), and filling it in from a visit centroid would render a
 * confident pin in the middle of a country the person never stood in.
 */
function placesFromEvents(edges: unknown[], known: Set<string>): Place[] {
  const acc = new Map<string, { name?: string; kind?: string; lat: number; lon: number; n: number; visits: number; first?: string; last?: string }>();
  for (const edge of edges) {
    const node = nodeOf(edge);
    const id = node?.location?.id;
    if (!node || !id || known.has(id)) continue;
    const cur = acc.get(id) ?? { lat: 0, lon: 0, n: 0, visits: 0 };
    cur.name ??= node.location?.name ?? undefined;
    cur.kind ??= node.location?.placeKind ?? undefined;
    cur.visits += 1;
    const p = readGeoJsonPoint(node.locationCoordinates);
    if (p) { cur.lat += p.lat; cur.lon += p.lon; cur.n += 1; }
    const t = node.startTime ?? undefined;
    if (t && node.timeSource !== 'ingest') {
      if (!cur.first || t < cur.first) cur.first = t;
      if (!cur.last || t > cur.last) cur.last = t;
    }
    acc.set(id, cur);
  }
  return [...acc.entries()].map(([id, v]) => ({
    id,
    name: v.name,
    placeKind: v.kind as Place['placeKind'],
    latitude: v.n ? v.lat / v.n : undefined,
    longitude: v.n ? v.lon / v.n : undefined,
    visitStats: { visitCount: v.visits, firstVisitAt: v.first, lastVisitAt: v.last },
  }));
}

/**
 * Improve the media rows `mediaItemsFromMemory` produced, using facts that only
 * the raw nodes carry.
 *
 * - `locationName` becomes the *resolved* Place name where there is one. The
 *   raw `locationName` on a real archive is frequently the event's own title
 *   echoed back ("SUNSESHLA - October 9nd"), and `deriveModel` reads exactly
 *   this field for a photo's place chip — so without this pass the marker pins
 *   show a real venue and the photos beside them show a garbled title.
 * - `kind` becomes `image-set` when the source says a single memory holds
 *   several frames. `mediaContentType` alone can't express that, so this reads
 *   `metadata.mediaCount`/`metadata.assetCount` — an assumption about a real
 *   server's metadata keys, and a no-op when they're absent.
 * - `exif` gains whatever the source kept (`metadata.exif`), on top of the
 *   width/height the base mapping already carries.
 */
function enrichMedia(media: MediaItem[], byMemoryId: Map<string, EventNode>): MediaItem[] {
  return media.map((m) => {
    const node = m.sourceMemoryId ? byMemoryId.get(m.sourceMemoryId) : undefined;
    if (!node) return m;
    const meta = readMetadata(node.metadata);
    const count = Number(meta?.mediaCount ?? meta?.assetCount ?? 0);
    const exif = meta?.exif && typeof meta.exif === 'object' ? (meta.exif as Record<string, unknown>) : undefined;
    return {
      ...m,
      locationName: node.location?.name ?? m.locationName,
      kind: m.kind === 'image' && count > 1 ? 'image-set' : m.kind,
      ...(exif ? { exif: { ...(m.exif ?? {}), ...exif } } : {}),
    };
  });
}

/** Reconstruct the canonical `Item` an `atlas-media` export parked in metadata. */
function itemFromAtlasMedia(node: EventNode): Item | undefined {
  const meta = readMetadata(node.metadata);
  const raw = meta?.item;
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Item & { position?: GeoPoint };
  if (!item.id || !item.type) return undefined;
  return item;
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

const EMPTY_STORY = (title: string): Story =>
  loadStory({ schema: STORY_SCHEMA_ID, id: 'companion-memory', title, media: [], items: [], scenes: [] });

/** Message text safe to put on screen: no token, no header, no cookie. */
function scrub(e: unknown, src: MemorySource): string {
  const msg = e instanceof Error ? e.message : String(e);
  const token = src.token;
  // Belt and braces. Nothing in this module puts a token in a message, but an
  // upstream layer (or a server echoing the Authorization header back in an
  // error) can, and this is the last place before the string reaches the DOM.
  return token ? msg.split(token).join('<token>') : msg;
}

/**
 * Import Places, memories and previously-saved stories from Companion Memory.
 *
 * Resolves — never rejects. Check `connected`; show `warnings`; render `story`
 * regardless.
 *
 * ```ts
 * const r = await importFromMemory(
 *   { url: memoryUrl, token },
 *   { start: '2019-06-01T00:00:00Z', end: '2019-06-30T23:59:59Z',
 *     bbox: [-123.2, 37.6, -122.3, 37.9], onProgress: (p) => setProgress(p) },
 * );
 * ```
 */
export async function importFromMemory(
  src: MemorySource,
  opts: MemoryImportOptions = {},
): Promise<MemoryImport> {
  const warnings: string[] = [];
  const title = 'Companion Memory';
  const ctl = {
    maxPages: Math.max(1, opts.maxPages ?? 50),
    maxItems: Math.max(1, opts.maxItems ?? 5000),
    signal: opts.signal,
  };
  const first = Math.min(Math.max(1, opts.pageSize ?? src.first ?? MAX_PAGE_SIZE), MAX_PAGE_SIZE);
  // A progress callback is somebody's `setState`. If it throws (a stale
  // component, a bad selector), that must not abort a network import that has
  // already paid for its pages.
  const report = (phase: MemoryImportPhase) => (p: Omit<MemoryImportProgress, 'phase'>) => {
    try { opts.onProgress?.({ phase, ...p }); } catch { /* the caller's problem, not the import's */ }
  };

  const filters = {
    first,
    startTime: opts.start,
    endTime: opts.end,
    bbox: validBbox(opts.bbox, warnings),
    eventTypes: opts.eventTypes,
  };

  let pages = 0;
  let places: Place[] = [];

  // --- Phase 1: the named-place roster ------------------------------------
  // Non-fatal on purpose. An older CI-Server without `places()` still has a
  // perfectly good archive of located events, and refusing to import it because
  // the roster query 400s would be the connector's failure, not the data's.
  if (opts.includePlaces !== false) {
    report('places')({ page: 0, loaded: 0, done: false });
    try {
      places = await fetchPlaces({ ...src, first });
    } catch (e) {
      if (ctl.signal?.aborted) return aborted(title, places, warnings);
      warnings.push(`Places unavailable (${scrub(e, src)}). Pins fall back to per-event labels.`);
    }
    report('places')({ page: 1, loaded: places.length, done: true });
  }

  // --- Phase 2: located memories ------------------------------------------
  let result: (PageResult & { hasMetadata: boolean }) | undefined;
  try {
    result = await searchPhase(
      src,
      { ...filters, hasLocation: true },
      ctl,
      report('memories'),
      warnings,
    );
  } catch (e) {
    if (ctl.signal?.aborted) return aborted(title, places, warnings);
    // The memories phase is the import. Failing it means "not connected".
    return {
      connected: false,
      story: EMPTY_STORY(title),
      places,
      stories: [],
      placeOfMemory: new Map(),
      stats: { media: 0, markers: 0, places: places.length, stories: 0, pages: 0, truncated: false },
      warnings,
      error: scrub(e, src),
    };
  }
  pages += result.pages;
  if (result.truncated) {
    warnings.push(
      `Stopped after ${result.edges.length} memories — narrow the time range or bounding box to import the rest.`,
    );
  }

  // Atlas's own rows are reconstructed by phase 3, not mapped as generic media.
  const foreign = result.edges.filter((edge) => {
    const node = nodeOf(edge);
    return !!node && !isAtlasOwned(node);
  });

  // --- Phase 3: stories Atlas previously wrote back ------------------------
  // A second pass, not a filter over phase 2's rows: those are `hasLocation:
  // true` and a story with no located entity carries no coordinates. It should
  // be a cheap query — `eventTypes` narrows it server-side to Atlas's own
  // handful of rows — but it is bounded like any other phase in case a server
  // ignores the filter, and `includeSavedStories: false` skips it entirely for
  // callers that only want the archive.
  const stories: Story[] = [];
  const authored: Item[] = [];
  if (opts.includeSavedStories !== false && result.hasMetadata) {
    try {
      const saved = await searchPhase(
        src,
        // `hasLocation: null` — an unlocated story is still the author's story.
        { ...filters, hasLocation: null, eventTypes: ['atlas-story', 'atlas-media'] },
        ctl,
        report('stories'),
        warnings,
      );
      pages += saved.pages;
      for (const edge of saved.edges) {
        const node = nodeOf(edge);
        if (!node || !isAtlasOwned(node)) continue;
        const meta = readMetadata(node.metadata);
        if (meta?.story) {
          try {
            stories.push(loadStory(meta.story));
          } catch (e) {
            // A story document written by a newer Atlas than this viewer. Say so
            // once; don't fail an import of 900 good memories over one row.
            warnings.push(`Skipped a saved story that didn't validate (${scrub(e, src)}).`);
          }
          const savedPlaces = meta.places;
          if (Array.isArray(savedPlaces)) {
            const have = new Set(places.map((p) => p.id));
            for (const p of savedPlaces as Place[]) {
              if (p && typeof p.id === 'string' && !have.has(p.id)) { places.push(p); have.add(p.id); }
            }
          }
        } else {
          const item = itemFromAtlasMedia(node);
          if (item) authored.push(item);
        }
      }
    } catch (e) {
      if (ctl.signal?.aborted) return aborted(title, places, warnings);
      // Everything real already imported; saved stories are the bonus.
      warnings.push(`Couldn't read saved Atlas stories (${scrub(e, src)}).`);
    }
  }

  // --- Assemble ------------------------------------------------------------
  const origin = memoryOrigin(src);
  const base = memoryToStory(
    { search: { totalCount: result.totalCount ?? foreign.length, edges: foreign } },
    { origin, title },
  );

  const byMemoryId = new Map<string, EventNode>();
  const placeOfMemory = new Map<string, { placeId?: string; placeName?: string }>();
  for (const edge of foreign) {
    const node = nodeOf(edge);
    if (!node?.id) continue;
    byMemoryId.set(node.id, node);
    const placeId = node.location?.id ?? undefined;
    const placeName = node.location?.name ?? node.locationName ?? undefined;
    if (placeId || placeName) placeOfMemory.set(`mem:${node.id}`, { placeId, placeName });
  }

  // Event-referenced places the roster didn't cover (see `placesFromEvents`).
  const known = new Set(places.map((p) => p.id));
  places = [...places, ...placesFromEvents(foreign, known)];

  const items = [...(base.items ?? [])];
  const seen = new Set(items.map((i) => i.id));
  for (const item of authored) if (!seen.has(item.id)) { items.push(item); seen.add(item.id); }

  const media = enrichMedia(base.media ?? [], byMemoryId);
  // Re-validate rather than trusting our own edits: this is the document every
  // renderer downstream reads, and a bad enrichment should fail here, loudly,
  // and not three layers away in a Cesium entity.
  let story: Story;
  try {
    story = loadStory({ ...base, media, items });
  } catch (e) {
    warnings.push(`Kept the unenriched import (${scrub(e, src)}).`);
    story = base;
  }

  return {
    connected: true,
    story,
    places,
    stories,
    placeOfMemory,
    stats: {
      media: story.media?.length ?? 0,
      markers: story.items?.length ?? 0,
      places: places.length,
      stories: stories.length,
      pages,
      totalCount: result.totalCount,
      truncated: result.truncated,
    },
    warnings,
  };
}

/** A cancelled import is not a failed one — it just has nothing to say. */
function aborted(title: string, places: Place[], warnings: string[]): MemoryImport {
  return {
    connected: false,
    story: EMPTY_STORY(title),
    places,
    stories: [],
    placeOfMemory: new Map(),
    stats: { media: 0, markers: 0, places: places.length, stories: 0, pages: 0, truncated: false },
    warnings,
    error: 'Import cancelled.',
  };
}

/**
 * Apply the exact place join to a derived model.
 *
 * `deriveModel` gives every memory a `placeId`/`place` where the entity carried
 * one — which markers do and photos structurally cannot (see `placeOfMemory`).
 * This fills that gap from the ids the server actually returned, so
 * `placeSummaries()` groups a visit's photos under the same place as the visit
 * itself instead of stranding them in "no place".
 *
 * Runs *before* `nameUnplacedMemories()`, whose 150 m proximity guess is the
 * fallback for memories the server never resolved a place for at all.
 */
export function applyMemoryPlaces<T extends { id: string; place?: string; placeId?: string }>(
  memories: T[],
  index: Map<string, { placeId?: string; placeName?: string }>,
): T[] {
  if (index.size === 0) return memories;
  return memories.map((m) => {
    const hit = index.get(m.id);
    if (!hit) return m;
    return { ...m, placeId: m.placeId ?? hit.placeId, place: m.place ?? hit.placeName };
  });
}
