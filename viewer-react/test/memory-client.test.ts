import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchMemoryStory } from '../src/memory/client.js';

const PORT = 4611;
const N = 250; // deliberately more than one server page
let mode: 'ok' | 'gqlerror' | 'unauth' = 'ok';

const mk = (i: number) => ({
  cursor: `c${i}`,
  node: {
    __typename: 'EventType', id: `e${i}`, title: `Memory ${i}`, description: null,
    startTime: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000).toISOString(), endTime: null,
    locationName: `Place ${i}`,
    locationCoordinates: { type: 'Point', coordinates: [(i % 180) - 90, (i % 80) - 40] },
    participantEntityIds: [], mediaContentType: 'image/jpeg',
    previewUrl: `/media/e${i}.png`, mediaUrl: `/media/e${i}.png`, mediaWidth: 10, mediaHeight: 10,
  },
});
const ALL = Array.from({ length: N }, (_, i) => mk(i));

const server = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const { variables = {} } = JSON.parse(b || '{}');
  if (mode === 'gqlerror') { // Apollo/Nest return 400 WITH a valid errors body
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ errors: [{ message: 'Unknown argument "bbox" on field "search".' }] }));
  }
  if (mode === 'unauth') {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ errors: [] }));
  }
  const first = Math.min(variables.first ?? 100, 100); // the server CLAMPS to 100
  const start = variables.after ? Number(String(variables.after).slice(1)) + 1 : 0;
  const slice = ALL.slice(start, start + first);
  const last = slice[slice.length - 1];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: { search: {
    totalCount: N,
    pageInfo: { hasNextPage: start + first < N, endCursor: last ? last.cursor : null },
    edges: slice,
  } } }));
});

beforeAll(() => new Promise<void>((r) => server.listen(PORT, r)));
afterAll(() => new Promise<void>((r) => { server.close(() => r()); }));

const src = { url: `http://localhost:${PORT}` };

describe('Companion Memory client', () => {
  it('pages through every located memory (server clamps first to 100)', async () => {
    mode = 'ok';
    const story = await fetchMemoryStory(src);
    // Asking for 200 used to be clamped to 100 with no paging: memory 101+ vanished.
    expect(story.media).toHaveLength(N);
  });

  it('surfaces a GraphQL error returned with HTTP 400', async () => {
    mode = 'gqlerror';
    // Checking res.ok first threw away the only message that says what's wrong.
    await expect(fetchMemoryStory(src)).rejects.toThrow(/Unknown argument "bbox"/);
  });

  it('gives an actionable message on 401', async () => {
    mode = 'unauth';
    await expect(fetchMemoryStory(src)).rejects.toThrow(/sign in|token/i);
  });

  it('explains CORS/network failure instead of a bare TypeError', async () => {
    await expect(fetchMemoryStory({ url: 'http://localhost:4999' })).rejects.toThrow(/CORS|Couldn't reach/i);
  });
});
