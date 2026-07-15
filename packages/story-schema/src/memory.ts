/**
 * Companion Memory (CI-Server) → canonical `MediaItem[]`.
 *
 * Consolidated from CI-Earth-2's live integration (PR #8,
 * `src/utils/photoQuery.js`), which was the only *working* CI-Server Memory
 * wiring across either prior build. Here it targets the canonical `MediaItem`
 * so the server's `atlas_query_memory` connector and the viewer share one path.
 *
 * The query mirrors CI-Server's MemoryPage MapView: media `EventType` rows carry
 * a PostGIS Point in `locationCoordinates` (GeoJSON `[lng, lat]`) plus a
 * `previewUrl` thumbnail. Kept free of `fetch` so every mapping is unit-tested.
 */
import type { GeoPoint, MediaItem } from './schema.js';

/** GraphQL document fetching the most recent located media memories. */
export const LOCATED_MEDIA_QUERY = /* GraphQL */ `
  query AtlasLocatedMedia($first: Int!, $hasLocation: Boolean!) {
    search(
      input: {
        query: ""
        includeTypes: ["EventType"]
        hasLocation: $hasLocation
        sortBy: "time"
        sortOrder: "desc"
        first: $first
      }
    ) {
      edges {
        node {
          __typename
          ... on Node { id }
          ... on EventType {
            title
            startTime
            mapCoordinates: locationCoordinates
            previewUrl
            mediaUrl
            mediaContentType
            locationName
          }
        }
      }
    }
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
  startTime?: string;
  mapCoordinates?: unknown;
  previewUrl?: string | null;
  mediaUrl?: string | null;
  mediaContentType?: string | null;
  locationName?: string | null;
}

function mediaKind(node: MemoryEventNode): MediaItem['kind'] | null {
  const ct = node.mediaContentType;
  if (typeof ct === 'string' && ct.length > 0) {
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('video/')) return 'video';
    return null; // audio/other memory rows are not placed as media here
  }
  // Unknown content type but a preview exists → treat as an image.
  return node.previewUrl ? 'image' : null;
}

/**
 * Map a raw CI-Server GraphQL search result to canonical `MediaItem[]`. Only
 * located media events with a displayable thumbnail survive; each becomes a
 * MediaItem carrying provenance (`sourceMemoryId`) for `atlas_query_memory`.
 */
export function mediaItemsFromMemory(result: unknown): MediaItem[] {
  const edges = (result as { search?: { edges?: unknown } })?.search?.edges;
  if (!Array.isArray(edges)) return [];

  const items: MediaItem[] = [];
  for (const edge of edges) {
    const node = (edge as { node?: MemoryEventNode })?.node;
    if (!node || node.__typename !== 'EventType' || !node.id) continue;

    const kind = mediaKind(node);
    if (!kind) continue;

    const location = readGeoJsonPoint(node.mapCoordinates);
    if (!location) continue;

    items.push({
      id: `mem:${node.id}`,
      kind,
      uri: node.mediaUrl ?? node.previewUrl ?? '',
      thumbnailUri: node.previewUrl ?? undefined,
      caption: node.title ?? node.locationName ?? undefined,
      capturedAt: node.startTime ?? undefined,
      location,
      sourceMemoryId: node.id,
    });
  }
  return items;
}
