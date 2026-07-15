import { describe, it, expect, vi } from 'vitest';
import { queryLocatedMedia, saveStoryMemory, type CiMemoryClientConfig } from '../src/ci-memory-client.js';
import { loadStory } from '@companion-atlas/story';

function mockFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

const endpoint = 'http://localhost:3030/graphql';

describe('queryLocatedMedia', () => {
  it('POSTs the search query with a bearer token and maps results (origin-prefixed)', async () => {
    const fetchImpl = mockFetch({
      data: {
        search: {
          edges: [
            {
              node: {
                __typename: 'EventType',
                id: 'evt_1',
                title: 'Pin',
                startTime: '2026-05-09T09:14:00Z',
                locationCoordinates: { type: 'Point', coordinates: [-9.1366, 38.7077] },
                previewUrl: '/companion/t.jpg?sig=1',
                mediaUrl: '/companion/f.jpg?sig=1',
                mediaContentType: 'image/jpeg',
              },
            },
          ],
        },
      },
    });
    const cfg: CiMemoryClientConfig = { endpoint, token: 'portal-token', fetchImpl };
    const items = await queryLocatedMedia(cfg, { first: 50 });

    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('mem:evt_1');
    expect(items[0]!.uri).toBe('http://localhost:3030/companion/f.jpg?sig=1'); // relative → absolutized to endpoint origin
    expect(items[0]!.location).toEqual({ lat: 38.7077, lon: -9.1366 });

    // request shape
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(endpoint);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe('Bearer portal-token');
    const sent = JSON.parse((init as { body: string }).body);
    expect(sent.query).toContain('includeTypes: ["event"]');
    expect(sent.variables.first).toBe(50);
  });

  it('throws on a GraphQL error payload', async () => {
    const cfg: CiMemoryClientConfig = { endpoint, fetchImpl: mockFetch({ errors: [{ message: 'boom' }] }) };
    await expect(queryLocatedMedia(cfg)).rejects.toThrow(/boom/);
  });

  it('throws on a non-2xx response', async () => {
    const cfg: CiMemoryClientConfig = { endpoint, fetchImpl: mockFetch({}, false, 401) };
    await expect(queryLocatedMedia(cfg)).rejects.toThrow(/HTTP 401/);
  });
});

describe('saveStoryMemory', () => {
  it('sends a createEvent mutation built from the story', async () => {
    const fetchImpl = mockFetch({ data: { createEvent: { id: 'evt_saved', title: 'T', startTime: 'x' } } });
    const story = loadStory({
      schema: 'companion.atlas/story@1',
      id: 'story-x',
      title: 'My Trip',
      timeline: { start: '2026-01-01T00:00:00Z', stop: '2026-01-02T00:00:00Z' },
      media: [{ id: 'm', kind: 'image', uri: 'u', location: { lat: 1, lon: 2 } }],
      scenes: [],
      access: { visibility: 'unlisted' },
    });
    const res = await saveStoryMemory({ endpoint, token: 't', fetchImpl }, story, 'https://atlas/?story=story-x');
    expect(res?.id).toBe('evt_saved');

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { body: string };
    const sent = JSON.parse(init.body);
    expect(sent.query).toContain('createEvent');
    expect(sent.variables.input.sourceSystem).toBe('companion-atlas');
    expect(sent.variables.input.sourceId).toBe('story-x');
    expect(sent.variables.input.sharingLevel).toBe('household');
    expect(sent.variables.input.locationCoordinates).toEqual({ type: 'Point', coordinates: [2, 1] });
  });
});
