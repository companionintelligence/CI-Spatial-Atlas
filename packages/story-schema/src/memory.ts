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
import type { GeoPoint, MediaItem, Story } from './schema.js';
import { storyEntities, timelineBounds } from './normalize.js';

/** Located media memories, chronological, paginated. `query:""` takes CI-Server's
 *  "timed" path; `includeTypes:["event"]` + `hasLocation:true` restricts to
 *  located events (the MapView surface). */
export const LOCATED_MEDIA_QUERY = /* GraphQL */ `
  query AtlasLocatedMedia($first: Int = 100, $after: String, $startTime: String, $endTime: String, $bbox: [Float!]) {
    search(
      input: {
        query: ""
        includeTypes: ["event"]
        eventTypes: ["photo", "video"]
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
            mediaContentType
            previewUrl
            mediaUrl
            mediaWidth
            mediaHeight
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

interface MemoryEventNode {
  __typename?: string;
  id?: string;
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  locationName?: string;
  locationCoordinates?: unknown;
  mediaContentType?: string | null;
  previewUrl?: string | null;
  mediaUrl?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
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
      ...(opts.shareUrl ? { shareUrl: opts.shareUrl } : {}),
    },
    sharingLevel: SHARING[vis] ?? 'private',
  };
}
