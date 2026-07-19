import { LOCATED_MEDIA_QUERY, SAVE_STORY_MUTATION, createEventInputFromStory, memoryToStory, type Story } from '@companion-atlas/story';

function endpointOf(url: string): { endpoint: string; origin: string } {
  const trimmed = url.replace(/\/+$/, '');
  const endpoint = /\/graphql$/.test(trimmed) ? trimmed : `${trimmed}/graphql`;
  return { endpoint, origin: endpoint.replace(/\/graphql$/, '') };
}

async function gql<T>(src: MemorySource, query: string, variables: Record<string, unknown>): Promise<T> {
  const { endpoint } = endpointOf(src.url);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(src.token ? { authorization: `Bearer ${src.token}` } : {}),
      },
      // Send the CI-Server session cookie when no explicit token is supplied.
      credentials: 'include',
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    // fetch only rejects on network/CORS failures — the response itself never
    // reaches JS when the preflight is refused, so this is the message a user
    // actually gets when CI-Server has no CORS allowlist for this origin.
    throw new Error(
      `Couldn't reach Companion Memory at ${endpoint}. If the server is up, it's likely CORS: ` +
      `CI-Server must allow this origin with credentials (a wildcard is invalid with cookies), ` +
      `or serve Atlas from the same origin.`,
    );
  }

  // GraphQL errors ride on a NON-2xx response too — Apollo/Nest return 400 with a
  // perfectly good { errors: [...] } body for validation failures. Reading the
  // status first threw away the one message that says what's actually wrong.
  const text = await res.text();
  let json: { data?: T; errors?: { message?: string }[] } | undefined;
  try { json = JSON.parse(text) as typeof json; } catch { /* not JSON (proxy/HTML error page) */ }

  if (json?.errors?.length) throw new Error(json.errors[0]?.message ?? 'Companion Memory GraphQL error');
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403
      ? " — sign in, or pass ?token=<jwt>."
      : text ? ` — ${text.slice(0, 160)}` : ' — check the server URL.';
    throw new Error(`Companion Memory returned HTTP ${res.status}${hint}`);
  }
  if (!json) throw new Error(`Companion Memory returned a non-JSON response from ${endpoint}.`);
  return json.data as T;
}

/** CI-Server clamps `first` to this; asking for more silently returns 100. */
const MAX_PAGE_SIZE = 100;
/** Stop runaway paging on a very large memory. */
const HARD_CAP = 2000;

interface SearchEnvelope {
  search?: {
    totalCount?: number;
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    edges?: unknown[];
  };
}

export interface MemorySource {
  /** CI-Server origin (`http://localhost:3030`) or full GraphQL endpoint. */
  url: string;
  /** Portal OIDC bearer token (optional if the CI-Server accepts the session cookie). */
  token?: string;
  /** Page size for the located-media query. */
  first?: number;
}

/**
 * Fetch located Companion Memory from a CI-Server `search()` and return a
 * renderable `Story`. This is the app's connection to real memory — point the
 * viewer at a server with `?memory=<url>` (or `VITE_MEMORY_URL`) and the globe
 * renders your actual located events instead of the bundled sample.
 */
export async function fetchMemoryStory(src: MemorySource): Promise<Story> {
  const { origin } = endpointOf(src.url);
  // Page through the whole located set. `first: 200` was silently clamped to 100
  // server-side and never paged, so anyone with more than 100 located memories
  // just never saw the rest — with `sortOrder: "asc"`, that meant the most recent
  // ones were the ones missing.
  const first = Math.min(src.first ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const edges: unknown[] = [];
  let after: string | undefined;
  let totalCount = 0;
  let pages = 0;

  do {
    const data = await gql<SearchEnvelope>(src, LOCATED_MEDIA_QUERY, { first, after });
    const search = data?.search;
    totalCount = search?.totalCount ?? totalCount;
    const page = Array.isArray(search?.edges) ? search.edges : [];
    edges.push(...page);
    const info = search?.pageInfo;
    after = info?.hasNextPage && info.endCursor ? info.endCursor : undefined;
    pages += 1;
    if (page.length === 0) break; // defensive: a server that lies about hasNextPage
  } while (after && edges.length < HARD_CAP && pages < 50);

  if (totalCount > edges.length) {
    console.warn(`[atlas] Companion Memory reports ${totalCount} located memories; showing ${edges.length}.`);
  }
  // `origin` (without /graphql) prefixes the relative presigned media URLs.
  return memoryToStory({ search: { totalCount, edges } }, { origin, title: 'Companion Memory' });
}

/**
 * Save a story back into Companion Memory as a located `atlas-story` event —
 * the social loop: the story's visibility maps to the event's `sharingLevel`
 * (unlisted → household), so household members' Companions can see it. The
 * write is idempotent server-side on (sourceType, sourceSystem, sourceId).
 */
export async function saveStoryToMemory(
  src: MemorySource,
  story: Story,
  opts: { shareUrl?: string } = {},
): Promise<{ id: string; title?: string }> {
  const input = createEventInputFromStory(story, { shareUrl: opts.shareUrl });
  const data = await gql<{ createEvent?: { id?: string; title?: string } }>(src, SAVE_STORY_MUTATION, { input });
  const created = data?.createEvent;
  if (!created?.id) throw new Error('Companion Memory did not confirm the save.');
  return { id: created.id, title: created.title };
}
