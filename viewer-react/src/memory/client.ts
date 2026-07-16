import { LOCATED_MEDIA_QUERY, memoryToStory, type Story } from '@companion-atlas/story';

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
  const trimmed = src.url.replace(/\/+$/, '');
  const endpoint = /\/graphql$/.test(trimmed) ? trimmed : `${trimmed}/graphql`;
  const origin = endpoint.replace(/\/graphql$/, '');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(src.token ? { authorization: `Bearer ${src.token}` } : {}),
    },
    // Send the CI-Server session cookie when no explicit token is supplied.
    credentials: 'include',
    body: JSON.stringify({ query: LOCATED_MEDIA_QUERY, variables: { first: src.first ?? 200 } }),
  });

  if (!res.ok) {
    throw new Error(`Companion Memory returned HTTP ${res.status} — check the server URL and that you're signed in.`);
  }
  const json = (await res.json()) as { data?: unknown; errors?: { message?: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? 'Companion Memory GraphQL error');
  }
  // `origin` (without /graphql) prefixes the relative presigned media URLs.
  return memoryToStory(json.data, { origin, title: 'Companion Memory' });
}
