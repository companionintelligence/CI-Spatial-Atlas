/**
 * CI-Server Companion Memory GraphQL client.
 *
 * Verified against CI-Server `origin/main`: POST GraphQL to `/graphql`
 * (`http://localhost:3030/graphql` locally, or `https://ci-server.localhost/api/graphql`
 * through the proxy) with `Authorization: Bearer <PortalOIDCToken>` or
 * CI-Server's dedicated `x-api-key` header. The query,
 * mutation, node→MediaItem mapping, and story→createEvent input all live in the
 * shared `@companion-atlas/story` package (single source of truth); this module
 * is just the transport.
 */
import {
  LOCATED_MEDIA_QUERY,
  SAVE_STORY_MUTATION,
  mediaItemsFromMemory,
  createEventInputFromStory,
  type MediaItem,
  type Story,
} from '@companion-atlas/story';

export interface CiMemoryClientConfig {
  /** GraphQL endpoint (e.g. `http://localhost:3030/graphql`). */
  endpoint: string;
  /** Origin used to absolutize CI-Server's relative presigned media URLs.
   *  Defaults to the endpoint's origin. */
  origin?: string;
  /** Portal OIDC bearer token or CI-Server JWT. */
  token?: string;
  /** CI-Server scoped API key, sent through its dedicated x-api-key header. */
  apiKey?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface LocatedMediaParams {
  first?: number;
  after?: string;
  startTime?: string;
  endTime?: string;
  /** [minLon, minLat, maxLon, maxLat] (EPSG:4326). */
  bbox?: [number, number, number, number];
}

function originOf(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).origin;
  } catch {
    return undefined;
  }
}

async function graphql<T>(cfg: CiMemoryClientConfig, query: string, variables: Record<string, unknown>): Promise<T> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const res = await doFetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`CI-Server memory: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`CI-Server memory GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  if (!json.data) throw new Error('CI-Server memory: empty response');
  return json.data;
}

/** Query located photo/video memories → canonical `MediaItem[]` (one page). */
export async function queryLocatedMedia(cfg: CiMemoryClientConfig, params: LocatedMediaParams = {}): Promise<MediaItem[]> {
  const data = await graphql<unknown>(cfg, LOCATED_MEDIA_QUERY, {
    first: params.first ?? 100,
    after: params.after,
    startTime: params.startTime,
    endTime: params.endTime,
    bbox: params.bbox,
  });
  return mediaItemsFromMemory(data, { origin: cfg.origin ?? originOf(cfg.endpoint) });
}

/** Save a finished story back as an idempotent, located memory (`createEvent`). */
export async function saveStoryMemory(
  cfg: CiMemoryClientConfig,
  story: Story,
  shareUrl?: string,
): Promise<{ id: string } | null> {
  const input = createEventInputFromStory(story, { shareUrl });
  const data = await graphql<{ createEvent?: { id: string } }>(cfg, SAVE_STORY_MUTATION, { input });
  return data.createEvent ?? null;
}
