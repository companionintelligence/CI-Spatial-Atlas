/**
 * Companion Memory (CI-Server) ⇄ canonical Story/MediaItem.
 *
 * Verified against CI-Server `origin/main` (NestJS code-first GraphQL at
 * `/graphql`, MapView's own query). Corrects the earlier CI-Earth-2 PR #8
 * assumptions:
 *   - `includeTypes` is the lowercase slug **`"event"`**, not `"EventType"`
 *     (the capitalized value silently matches zero rows).
 *   - `previewUrl`/`mediaUrl` come back as **relative** presigned paths
 *     (`/companion/…?X-Amz-Signature=…`, ~1h TTL) — prefix with the CI-Server
 *     origin before use.
 *   - Local endpoint is `http://localhost:3030/graphql` (or, via the proxy,
 *     `https://ci-server.localhost/api/graphql`); the `:8000` port was stale.
 *
 * Kept free of `fetch` so every mapping is unit-tested; the server connector
 * (`server/src/connectors.ts`) does the transport with a Portal OIDC bearer.
 */
import { STORY_SCHEMA_ID, type GeoPoint, type Item, type MediaItem, type Story } from './schema.js';
import { loadStory, storyEntities, timelineBounds } from './normalize.js';

/** Located media memories, chronological, paginated. `query:""` takes CI-Server's
 *  "timed" path; `includeTypes:["event"]` + `hasLocation:true` restricts to
 *  located events (the MapView surface). */
export const LOCATED_MEDIA_QUERY = /* GraphQL */ `
  query AtlasLocatedMedia($first: Int = 100, $after: String, $startTime: String, $endTime: String, $bbox: [Float!], $eventTypes: [String!]) {
    search(
      input: {
        query: ""
        includeTypes: ["event"]
        # Left unfiltered by default (null == no filter, confirmed against a
        # live server). This used to hardcode
        # ["capture.photo","capture.video","photo","video"], which is an exact
        # IN match and therefore matched zero rows on a real import — that data
        # types its located events as "event"/"trip"/"order"/"transaction", so
        # Atlas connected successfully and then rendered an empty globe. The
        # capture.* list had already been widened once for the same reason; the
        # taxonomy is open-ended, so enumerating it is the wrong shape. Any
        # located event is a memory worth placing. Callers that genuinely want
        # only photos/videos can pass $eventTypes.
        eventTypes: $eventTypes
        hasLocation: true
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
          ... on EventType {
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
            # 'ingest' means the source gave no date and startTime is only the
            # import wall clock — such rows must not be placed on a timeline.
            timeSource
            location { id name placeKind }
          }
        }
      }
    }
  }
`;

/** Idempotent write-back: save a finished story as a located, timestamped
 *  memory. Dedups on (sourceType, sourceSystem, sourceId) server-side. */
export const SAVE_STORY_MUTATION = /* GraphQL */ `
  mutation AtlasSaveStory($input: CreateEventInput!) {
    createEvent(input: $input) { id title startTime }
  }
`;

/**
 * Read a PostGIS / GeoJSON Point `{ type:'Point', coordinates:[lng, lat] }`.
 * Note the [lng, lat] axis order. Rejects non-numbers, NaN, and the (0,0)
 * null-island sentinel so missing coordinates never render at the Gulf of Guinea.
 */
export function readGeoJsonPoint(value: unknown): GeoPoint | null {
  if (value == null || typeof value !== 'object') return null;
  const coords = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords as unknown[];
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return { lat, lon: lng };
}

interface MemoryPlaceRef {
  id?: string;
  name?: string;
  placeKind?: string;
}

interface MemoryEventNode {
  __typename?: string;
  id?: string;
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  locationName?: string;
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
}

/**
 * CI-Server documents `timeSource: 'ingest'` as "this is not a real date" — the
 * source carried no time and `startTime` holds the import wall clock only
 * because the column is NOT NULL. Placing those on a globe's timeline would
 * scatter a person's history across whatever day the import ran.
 */
function hasRealTime(node: MemoryEventNode): boolean {
  return node.timeSource !== 'ingest';
}

/** Shared place/category fields both projections attach to their item. */
function placeFields(node: MemoryEventNode) {
  return {
    placeId: node.location?.id ?? undefined,
    // Prefer the resolved Place's name over the raw event locationName, which
    // is often the event's own title repeated back ("SUNSESHLA - October 9nd").
    placeName: node.location?.name ?? node.locationName ?? undefined,
    category: node.category ?? undefined,
    durationMinutes: typeof node.durationMinutes === 'number' ? node.durationMinutes : undefined,
  };
}

function mediaKind(node: MemoryEventNode): MediaItem['kind'] | null {
  const ct = node.mediaContentType;
  if (typeof ct === 'string' && ct.length > 0) {
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('video/')) return 'video';
    return null; // audio/other memory rows are not placed as located media here
  }
  return node.previewUrl ? 'image' : null;
}

/** Resolve a CI-Server relative presigned path against the server origin. */
function resolveUrl(url: string | null | undefined, origin?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (!origin) return url; // caller didn't provide an origin — leave relative
  return `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface MemoryMapOptions {
  /** CI-Server origin used to absolutize relative presigned media URLs. */
  origin?: string;
}

/**
 * Map a raw CI-Server GraphQL `search` result to canonical `MediaItem[]`. Only
 * located media events with a displayable thumbnail survive; each carries
 * provenance (`sourceMemoryId`) for `atlas_query_memory` and time/size metadata.
 */
export function mediaItemsFromMemory(result: unknown, opts: MemoryMapOptions = {}): MediaItem[] {
  const edges = (result as { search?: { edges?: unknown } })?.search?.edges;
  if (!Array.isArray(edges)) return [];

  const items: MediaItem[] = [];
  for (const edge of edges) {
    const node = (edge as { node?: MemoryEventNode })?.node;
    if (!node || node.__typename !== 'EventType' || !node.id) continue;

    const kind = mediaKind(node);
    if (!kind) continue;

    const location = readGeoJsonPoint(node.locationCoordinates);
    if (!location) continue;

    const media = resolveUrl(node.mediaUrl, opts.origin);
    const thumb = resolveUrl(node.previewUrl, opts.origin);

    items.push({
      id: `mem:${node.id}`,
      kind,
      uri: media ?? thumb ?? '',
      thumbnailUri: thumb,
      caption: node.title ?? node.locationName ?? undefined,
      description: node.description ?? undefined,
      locationName: node.locationName ?? undefined,
      people: node.participantEntityIds?.length ? node.participantEntityIds : undefined,
      capturedAt: node.startTime ?? undefined,
      location,
      sourceMemoryId: node.id,
      exif:
        node.mediaWidth || node.mediaHeight
          ? { width: node.mediaWidth ?? undefined, height: node.mediaHeight ?? undefined }
          : undefined,
    });
  }
  return items;
}

/**
 * Build a canonical `Story` from a raw CI-Server `search()` result — the read
 * path that lets the globe render **live Companion Memory**. Each located media
 * event becomes a `MediaItem` (which `deriveModel` projects into a memory pin +
 * inspector card); the clock window is derived from their capture times. Pass
 * `opts.origin` so relative presigned media URLs resolve against the server.
 */
export function memoryToStory(
  result: unknown,
  opts: MemoryMapOptions & { id?: string; title?: string } = {},
): Story {
  const media = mediaItemsFromMemory(result, opts);
  const markers = locatedMarkersFromMemory(result);
  const times = [
    ...media.map((m) => m.capturedAt),
    // TimeSpec is `string | { at?, start? }`, so narrow before reading `at`
    // (on the string branch `.at` is String.prototype.at, not a timestamp).
    ...markers.map((k) => (typeof k.time === 'object' && k.time ? k.time.at ?? k.time.start : k.time)),
  ]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  const timeline = times.length
    ? { start: new Date(times[0]!).toISOString(), stop: new Date(times[times.length - 1]!).toISOString() }
    : undefined;
  return loadStory({
    schema: STORY_SCHEMA_ID,
    id: opts.id ?? 'companion-memory',
    title: opts.title ?? 'Companion Memory',
    ...(timeline ? { timeline } : {}),
    media,
    items: markers,
    scenes: [],
  });
}

/**
 * Located events that carry no media, projected as `marker` items.
 *
 * `mediaItemsFromMemory` drops any event `mediaKind` can't classify, which is
 * correct for building *media* — but it meant a real Companion Memory rendered
 * an empty globe. A personal import's located events are overwhelmingly
 * calendar entries, trips and orders with a place and a time but no photo
 * (`mediaContentType`, `previewUrl` and `mediaUrl` all null); every one of them
 * was silently discarded, so the viewer connected, reported success, and showed
 * nothing. A memory with a location and a time is worth a pin whether or not a
 * picture is attached, so those become markers here. Anything media-bearing is
 * left to `mediaItemsFromMemory` so it is not placed twice.
 */
export function locatedMarkersFromMemory(result: unknown): Extract<Item, { type: 'marker' }>[] {
  const edges = (result as { search?: { edges?: unknown } })?.search?.edges;
  if (!Array.isArray(edges)) return [];

  const out: Extract<Item, { type: 'marker' }>[] = [];
  for (const edge of edges) {
    const node = (edge as { node?: MemoryEventNode })?.node;
    if (!node || node.__typename !== 'EventType' || !node.id) continue;
    if (mediaKind(node)) continue; // media-bearing rows belong to mediaItemsFromMemory
    if (!hasRealTime(node)) continue;

    const position = readGeoJsonPoint(node.locationCoordinates);
    if (!position) continue;

    out.push({
      id: `mem:${node.id}`,
      type: 'marker',
      position,
      ...(node.startTime ? { time: { at: node.startTime } } : {}),
      source: { kind: 'ci-memory', memoryId: node.id },
      title: node.title ?? node.locationName ?? undefined,
      description: node.description ?? undefined,
      ...placeFields(node),
    });
  }
  return out;
}

/** The `$input` for the `createEvent` write-back mutation, built from a story. */
export interface CreateEventInput {
  title?: string;
  description?: string;
  eventType: string;
  startTime: string;
  endTime?: string;
  locationName?: string;
  locationCoordinates?: { type: 'Point'; coordinates: [number, number] };
  sourceType: string;
  sourceSystem: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
  sharingLevel?: 'private' | 'household' | 'public';
}

const SHARING: Record<string, CreateEventInput['sharingLevel']> = {
  private: 'private',
  unlisted: 'household',
  public: 'public',
};

/** Build the idempotent `createEvent` input that saves a story as a memory. */
export function createEventInputFromStory(story: Story, opts: { shareUrl?: string } = {}): CreateEventInput {
  const bounds = timelineBounds(story);
  let anchor: GeoPoint | undefined;
  for (const e of storyEntities(story)) {
    if ('position' in e && e.position) {
      anchor = e.position;
      break;
    }
    if (e.type === 'track' && e.path[0]) {
      anchor = { lat: e.path[0].lat, lon: e.path[0].lon, height: e.path[0].height };
      break;
    }
  }
  const vis = story.access?.visibility ?? story.visibility ?? 'private';

  return {
    title: story.title,
    description: story.description,
    eventType: 'atlas-story',
    startTime: bounds.start,
    endTime: bounds.stop !== bounds.start ? bounds.stop : undefined,
    locationName: undefined,
    locationCoordinates: anchor ? { type: 'Point', coordinates: [anchor.lon, anchor.lat] } : undefined,
    sourceType: 'story',
    sourceSystem: 'companion-atlas',
    sourceId: story.id,
    metadata: {
      schema: story.schema,
      sceneCount: story.scenes.length,
      mediaCount: (story.media?.length ?? 0) + (story.items?.length ?? 0),
      // Persist the journey itself. Without the document the saved event is just
      // a title and a dot: it can't be re-opened or replayed, the household sees
      // only that *a* journey exists, and a curator's narratives + agent
      // provenance are lost the moment it's saved.
      story,
      // Hoisted for indexing/queries — who (or what) assembled this journey.
      ...(story.provenance ? { provenance: story.provenance } : {}),
      ...(opts.shareUrl ? { shareUrl: opts.shareUrl } : {}),
    },
    sharingLevel: SHARING[vis] ?? 'private',
  };
}
