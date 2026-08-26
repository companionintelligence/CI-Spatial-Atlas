import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPlaces } from '../src/memory/client.js';

const PORT = 4612;
const N = 220; // deliberately more than one page, even though CI-Server doesn't clamp `first`
let mode: 'ok' | 'gqlerror' | 'unauth' = 'ok';

const mk = (i: number) => ({
  cursor: `p${i}`,
  node: {
    id: `p${i}`,
    name: `Place ${i}`,
    description: null,
    placeKind: i % 7 === 0 ? 'country' : 'city',
    // every 5th place has no coordinates, like a country-level row
    latitude: i % 5 === 0 ? null : (i % 180) - 90,
    longitude: i % 5 === 0 ? null : (i % 360) - 180,
    parentId: null,
    visitStats: { visitCount: i % 4, firstVisitAt: null, lastVisitAt: null },
  },
});
const ALL = Array.from({ length: N }, (_, i) => mk(i));

const server = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const { variables = {} } = JSON.parse(b || '{}');
  if (mode === 'gqlerror') {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ errors: [{ message: 'Unknown argument "sort" on field "places".' }] }));
  }
  if (mode === 'unauth') {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ errors: [] }));
  }
  // Unlike `search()`, this fake server does NOT clamp `first` — proving
  // fetchPlaces pages defensively on its own, not because the server forces it.
  const first = variables.first ?? 200;
  const start = variables.after ? Number(String(variables.after).slice(1)) + 1 : 0;
  const slice = ALL.slice(start, start + first);
  const last = slice[slice.length - 1];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: { places: {
    totalCount: N,
    pageInfo: { hasNextPage: start + first < N, endCursor: last ? last.cursor : null },
    edges: slice,
  } } }));
});

beforeAll(() => new Promise<void>((r) => server.listen(PORT, r)));
afterAll(() => new Promise<void>((r) => { server.close(() => r()); }));

const src = { url: `http://localhost:${PORT}` };

describe('Companion Memory Places client', () => {
  it('pages through every place and keeps rows without coordinates', async () => {
    mode = 'ok';
    const places = await fetchPlaces(src);
    expect(places).toHaveLength(N);
    expect(places.filter((p) => p.latitude == null)).toHaveLength(Math.ceil(N / 5));
  });

  it('surfaces a GraphQL error returned with HTTP 400', async () => {
    mode = 'gqlerror';
    await expect(fetchPlaces(src)).rejects.toThrow(/Unknown argument "sort"/);
  });

  it('gives an actionable message on 401', async () => {
    mode = 'unauth';
    await expect(fetchPlaces(src)).rejects.toThrow(/sign in|token/i);
  });

  it('explains CORS/network failure instead of a bare TypeError', async () => {
    await expect(fetchPlaces({ url: 'http://localhost:4998' })).rejects.toThrow(/CORS|Couldn't reach/i);
  });
});
