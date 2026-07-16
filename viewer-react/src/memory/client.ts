import { LOCATED_MEDIA_QUERY, SAVE_STORY_MUTATION, createEventInputFromStory, memoryToStory, type Story } from '@companion-atlas/story';

function endpointOf(url: string): { endpoint: string; origin: string } {
  const trimmed = url.replace(/\/+$/, '');
  const endpoint = /\/graphql$/.test(trimmed) ? trimmed : `${trimmed}/graphql`;
  return { endpoint, origin: endpoint.replace(/\/graphql$/, '') };
}

async function gql<T>(src: MemorySource, query: string, variables: Record<string, unknown>): Promise<T> {
  const { endpoint } = endpointOf(src.url);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(src.token ? { authorization: `Bearer ${src.token}` } : {}),
    },
    // Send the CI-Server session cookie when no explicit token is supplied.
    credentials: 'include',
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Companion Memory returned HTTP ${res.status} — check the server URL and that you're signed in.`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? 'Companion Memory GraphQL error');
  return json.data as T;
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
  const data = await gql<unknown>(src, LOCATED_MEDIA_QUERY, { first: src.first ?? 200 });
  // `origin` (without /graphql) prefixes the relative presigned media URLs.
  return memoryToStory(data, { origin, title: 'Companion Memory' });
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
