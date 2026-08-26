/**
 * Companion Memory (CI-Server) Places ⇄ Atlas.
 *
 * A `Place` is a live CI-Server GraphQL response — a named, room-to-planet
 * geographic entity (PostGIS-backed, with a parent/child hierarchy and visit
 * stats) — never a document persisted inside a Story, so unlike `schema.ts`
 * this is a plain TS shape, not Zod, matching `memory.ts`'s precedent for
 * other live-API surfaces.
 *
 * Field list verified against CI-Server's `PlaceType`/`PlaceVisitStatsType`
 * GraphQL SDL: id, name, description, placeKind, latitude, longitude,
 * parentId, visitStats{visitCount,firstVisitAt,lastVisitAt}. Deliberately
 * excludes `tags` (an extra per-place resolver call) and `properties`/
 * `locationBoundary`/`geolocation` (unused JSON blobs) — this is a point-
 * rendering query, not a full Place editor.
 */

export type PlaceKind =
  | 'room' | 'building' | 'venue' | 'address' | 'neighborhood'
  | 'city' | 'region' | 'country' | 'continent' | 'planet' | 'other';

export interface PlaceVisitStats {
  visitCount: number;
  firstVisitAt?: string;
  lastVisitAt?: string;
}

export interface Place {
  id: string;
  name?: string;
  description?: string;
  placeKind?: PlaceKind;
  latitude?: number;
  longitude?: number;
  parentId?: string;
  visitStats: PlaceVisitStats;
}

/** Relay-paginated `places()`. Unlike `search()` (LOCATED_MEDIA_QUERY, which
 *  CI-Server clamps to 100), `places()`'s Paginator does not clamp `first`
 *  server-side — it loads every candidate row into memory and slices — so
 *  page defensively on the client regardless. */
export const PLACES_QUERY = /* GraphQL */ `
  query AtlasPlaces($first: Int = 200, $after: String) {
    places(first: $first, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id
          name
          description
          placeKind
          latitude
          longitude
          parentId
          visitStats { visitCount firstVisitAt lastVisitAt }
        }
      }
    }
  }
`;

interface PlaceNode {
  id?: string;
  name?: string | null;
  description?: string | null;
  placeKind?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  parentId?: string | null;
  visitStats?: { visitCount?: number | null; firstVisitAt?: string | null; lastVisitAt?: string | null } | null;
}

interface PlacesEnvelope {
  places?: {
    totalCount?: number;
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    edges?: { node?: PlaceNode }[];
  };
}

/**
 * Map a raw CI-Server `places()` result to `Place[]`. Places without
 * coordinates are kept (not every place is point-renderable — a `country` or
 * `planet` row may carry no lat/lng of its own) — the Cesium layer filters
 * those out at render time, not here, so callers that just want the roster
 * (a place picker, a search index) still see every row.
 */
export function placesFromResponse(result: unknown): Place[] {
  const edges = (result as PlacesEnvelope)?.places?.edges;
  if (!Array.isArray(edges)) return [];
  const out: Place[] = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (!node?.id) continue;
    out.push({
      id: node.id,
      name: node.name ?? undefined,
      description: node.description ?? undefined,
      placeKind: (node.placeKind as PlaceKind | null) ?? undefined,
      latitude: typeof node.latitude === 'number' ? node.latitude : undefined,
      longitude: typeof node.longitude === 'number' ? node.longitude : undefined,
      parentId: node.parentId ?? undefined,
      visitStats: {
        visitCount: node.visitStats?.visitCount ?? 0,
        firstVisitAt: node.visitStats?.firstVisitAt ?? undefined,
        lastVisitAt: node.visitStats?.lastVisitAt ?? undefined,
      },
    });
  }
  return out;
}
