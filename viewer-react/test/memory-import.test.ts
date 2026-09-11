/**
 * The Companion Memory import path (`viewer-react/src/memory/import.ts`).
 *
 * Every case here is a failure this connector has to survive on a real server:
 * an archive bigger than one page, a filtered "just this trip" import, a place
 * roster the search doesn't fully cover, zero results, a proxy that mangles the
 * response, an older server missing a field, and a credential that must never
 * reach the screen. Nothing touches the network — `startFakeMemory()` listens
 * on 127.0.0.1.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveModel, nameUnplacedMemories, placeSummaries } from '../src/model/atlasModel.js';
import {
  applyMemoryPlaces,
  importFromMemory,
  resetMemoryCapabilities,
  type MemoryImportProgress,
} from '../src/memory/import.js';
import {
  markerEvent,
  photoEvent,
  startFakeMemory,
  type FakeMemoryServer,
} from './memory-server.js';

let mem: FakeMemoryServer;

beforeEach(() => {
  // The metadata probe is memoised per endpoint; a fresh port per test would
  // hide a regression where the memo leaks across servers.
  resetMemoryCapabilities();
});
afterEach(async () => { await mem?.close(); });

describe('import: paging', () => {
  it('follows the cursor across every page (the server clamps first to 100)', async () => {
    const N = 250;
    mem = await startFakeMemory({ events: Array.from({ length: N }, (_, i) => photoEvent(i)) });

    const r = await importFromMemory({ url: mem.url }, { pageSize: 200 });

    expect(r.connected).toBe(true);
    // Asking for 200 is clamped to 100 with no error. Before paging, memories
    // 101+ simply never appeared — and sorted ascending, the missing ones were
    // the most recent.
    expect(r.story.media).toHaveLength(N);
    expect(r.stats.media).toBe(N);
    expect(r.stats.totalCount).toBe(N);
    expect(r.stats.pages).toBeGreaterThanOrEqual(3);
    expect(r.stats.truncated).toBe(false);
    // The cursor actually advanced rather than re-requesting page one.
    const cursors = mem.searches.map((v) => v.after).filter(Boolean);
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  it('reports progress per page and survives a callback that throws', async () => {
    mem = await startFakeMemory({ events: Array.from({ length: 120 }, (_, i) => photoEvent(i)) });
    const seen: MemoryImportProgress[] = [];

    const r = await importFromMemory({ url: mem.url }, {
      onProgress: (p) => {
        seen.push(p);
        // Somebody's setState on an unmounted component. It must not abort an
        // import that has already paid for its pages.
        if (p.phase === 'memories' && p.page === 1) throw new Error('setState on unmounted');
      },
    });

    expect(r.connected).toBe(true);
    expect(r.story.media).toHaveLength(120);
    expect(seen.some((p) => p.phase === 'memories' && p.page === 2)).toBe(true);
    expect(seen.filter((p) => p.done).map((p) => p.phase)).toContain('memories');
  });

  it('stops, and says so, when a bound cuts the archive short', async () => {
    mem = await startFakeMemory({ events: Array.from({ length: 300 }, (_, i) => photoEvent(i)) });

    const r = await importFromMemory({ url: mem.url }, { maxPages: 2 });

    expect(r.stats.truncated).toBe(true);
    expect(r.story.media).toHaveLength(200);
    expect(r.warnings.join(' ')).toMatch(/narrow the time range/i);
  });

  it('terminates against a server whose cursor never advances', async () => {
    mem = await startFakeMemory({ events: [photoEvent(1)], mode: 'stuck' });

    // hasNextPage is true forever and endCursor never changes. Without the
    // cursor guard this runs to maxPages (or, with none, forever).
    const r = await importFromMemory({ url: mem.url }, { maxPages: 50 });

    expect(r.connected).toBe(true);
    // Two requests per phase (the second repeats the cursor and stops), not the
    // 50 `maxPages` would otherwise allow.
    expect(mem.searches).toHaveLength(4);
    expect(r.stats.pages).toBe(4);
  });
});

describe('import: filters', () => {
  it('sends the time window and bounding box to the server', async () => {
    mem = await startFakeMemory({
      events: [
        photoEvent(1, { startTime: '2019-06-01T10:00:00Z', locationCoordinates: { type: 'Point', coordinates: [-122.41, 37.77] } }),
        photoEvent(2, { startTime: '2019-06-02T10:00:00Z', locationCoordinates: { type: 'Point', coordinates: [-122.42, 37.78] } }),
        // Right window, wrong hemisphere.
        photoEvent(3, { startTime: '2019-06-02T12:00:00Z', locationCoordinates: { type: 'Point', coordinates: [151.2, -33.8] } }),
        // Right place, wrong year.
        photoEvent(4, { startTime: '2021-01-01T10:00:00Z', locationCoordinates: { type: 'Point', coordinates: [-122.43, 37.79] } }),
      ],
    });

    const r = await importFromMemory({ url: mem.url }, {
      start: '2019-06-01T00:00:00Z',
      end: '2019-06-30T23:59:59Z',
      bbox: [-123.2, 37.6, -122.3, 37.9],
    });

    // Filtering is server-side: the client must pass it through, not post-filter.
    const vars = mem.searches[0]!;
    expect(vars.startTime).toBe('2019-06-01T00:00:00Z');
    expect(vars.endTime).toBe('2019-06-30T23:59:59Z');
    expect(vars.bbox).toEqual([-123.2, 37.6, -122.3, 37.9]);
    expect(r.story.media?.map((m) => m.sourceMemoryId)).toEqual(['e1', 'e2']);
  });

  it('passes eventTypes through when the caller narrows to photos', async () => {
    mem = await startFakeMemory({ events: [photoEvent(1), markerEvent(2)] });

    const r = await importFromMemory({ url: mem.url }, { eventTypes: ['photo'] });

    expect(mem.searches[0]!.eventTypes).toEqual(['photo']);
    expect(r.story.media).toHaveLength(1);
    expect(r.story.items).toHaveLength(0);
  });

  it('drops an invalid bounding box instead of sending it', async () => {
    mem = await startFakeMemory({ events: [photoEvent(1)] });

    // A server that ignores a malformed filter returns EVERYTHING, which the
    // user reads as "the trip filter did nothing" rather than "bad input".
    const r = await importFromMemory({ url: mem.url }, { bbox: [Number.NaN, 37.6, -122.3, 37.9] });

    expect(mem.searches[0]!.bbox).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/invalid bounding box/i);
  });
});

describe('import: places', () => {
  const roster = [
    { id: 'p-adler', name: 'Adler Theater', placeKind: 'venue', latitude: 37.78, longitude: -122.41, visitStats: { visitCount: 12 } },
    // A country row with no coordinates of its own — deliberate, and must stay that way.
    { id: 'p-usa', name: 'United States', placeKind: 'country', latitude: null, longitude: null, visitStats: { visitCount: 800 } },
  ];

  it('imports the roster and joins media to it by place id', async () => {
    mem = await startFakeMemory({
      places: roster,
      events: [
        photoEvent(1, {
          // The raw label a real archive carries: the event's own title echoed back.
          locationName: 'SUNSESHLA - October 9nd',
          location: { id: 'p-adler', name: 'Adler Theater', placeKind: 'venue' },
        }),
        markerEvent(2, { location: { id: 'p-adler', name: 'Adler Theater', placeKind: 'venue' } }),
      ],
    });

    const r = await importFromMemory({ url: mem.url });

    expect(r.places.map((p) => p.id)).toEqual(['p-adler', 'p-usa']);
    expect(r.places.find((p) => p.id === 'p-adler')?.latitude).toBeCloseTo(37.78);
    // A place the server says has no point keeps none — a visit centroid would
    // pin "United States" wherever this person happened to go.
    expect(r.places.find((p) => p.id === 'p-usa')?.latitude).toBeUndefined();

    // The marker carries the place natively; the photo can't (MediaItem has no
    // placeId), so the index is the join.
    expect(r.placeOfMemory.get('mem:e1')).toEqual({ placeId: 'p-adler', placeName: 'Adler Theater' });
    // …and the resolved name replaces the echoed title on the media row, which
    // is the field `deriveModel` shows as a photo's place.
    expect(r.story.media?.[0]?.locationName).toBe('Adler Theater');
  });

  it('groups a place\'s photos with its visits once the index is applied', async () => {
    mem = await startFakeMemory({
      places: roster,
      events: [
        photoEvent(1, { location: { id: 'p-adler', name: 'Adler Theater' } }),
        markerEvent(2, { location: { id: 'p-adler', name: 'Adler Theater' } }),
      ],
    });

    const r = await importFromMemory({ url: mem.url });
    const model = deriveModel(r.story);

    // Without the join the photo lands in "no place" and the venue reads as one
    // visit instead of two.
    const before = placeSummaries(model.memories).find((p) => p.id === 'p-adler');
    expect(before?.visits).toBe(1);

    const joined = applyMemoryPlaces(model.memories, r.placeOfMemory);
    const after = placeSummaries(joined).find((p) => p.id === 'p-adler');
    expect(after?.visits).toBe(2);
    expect(after?.name).toBe('Adler Theater');
  });

  it('synthesises places the roster never returned, from the events that name them', async () => {
    mem = await startFakeMemory({
      places: [],
      events: [
        photoEvent(1, {
          location: { id: 'p-ghost', name: 'Ghost Cafe', placeKind: 'venue' },
          locationCoordinates: { type: 'Point', coordinates: [-122.4, 37.8] },
        }),
        photoEvent(2, {
          location: { id: 'p-ghost', name: 'Ghost Cafe', placeKind: 'venue' },
          locationCoordinates: { type: 'Point', coordinates: [-122.2, 37.6] },
        }),
      ],
    });

    const r = await importFromMemory({ url: mem.url });

    const ghost = r.places.find((p) => p.id === 'p-ghost');
    expect(ghost?.name).toBe('Ghost Cafe');
    expect(ghost?.visitStats.visitCount).toBe(2);
    expect(ghost?.longitude).toBeCloseTo(-122.3); // centroid of the two visits
    expect(ghost?.latitude).toBeCloseTo(37.7);
  });

  it('still imports memories when the server has no places() at all', async () => {
    mem = await startFakeMemory({ supportsPlaces: false, events: [photoEvent(1), markerEvent(2)] });

    const r = await importFromMemory({ url: mem.url });

    expect(r.connected).toBe(true);
    expect(r.story.media).toHaveLength(1);
    expect(r.story.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/Places unavailable/i);
  });

  it('leaves the proximity fallback for memories with no place at all', async () => {
    mem = await startFakeMemory({
      places: [{ id: 'p-adler', name: 'Adler Theater', latitude: 37.7701, longitude: -122.4001, visitStats: { visitCount: 1 } }],
      // An Amazon-delivery-shaped row: coordinates, no resolved place.
      events: [markerEvent(0, { locationCoordinates: { type: 'Point', coordinates: [-122.4, 37.77] } })],
    });

    const r = await importFromMemory({ url: mem.url });
    const joined = applyMemoryPlaces(deriveModel(r.story).memories, r.placeOfMemory);
    expect(joined[0]?.place).toBeUndefined();

    const named = nameUnplacedMemories(joined, r.places);
    expect(named[0]?.place).toBe('Adler Theater');
  });
});

describe('import: degraded servers', () => {
  it('returns a valid, empty, connected story for a zero-result archive', async () => {
    // The exact shape verify_empty.ts documents: totalCount 0, no edges.
    mem = await startFakeMemory({ mode: 'empty' });

    const r = await importFromMemory({ url: mem.url });

    expect(r.connected).toBe(true);        // connected-with-nothing, not disconnected
    expect(r.error).toBeUndefined();
    expect(r.story.media).toEqual([]);
    expect(r.story.items).toEqual([]);
    expect(r.stats).toMatchObject({ media: 0, markers: 0, stories: 0, totalCount: 0, truncated: false });
    // The whole point of returning a Story rather than null: the shell renders.
    expect(() => deriveModel(r.story)).not.toThrow();
    expect(deriveModel(r.story).memories).toEqual([]);
  });

  it('survives a malformed/partial response instead of throwing into React', async () => {
    mem = await startFakeMemory({ mode: 'malformed' });

    const r = await importFromMemory({ url: mem.url });

    // `edges` is a string and `pageInfo` is missing — read as "no rows", and the
    // loop must still terminate.
    expect(r.connected).toBe(true);
    expect(r.story.media).toEqual([]);
    // One page for memories, one for saved stories — and no second request in
    // either phase, because a missing `pageInfo` means "no more".
    expect(r.stats.pages).toBe(2);
  });

  it('falls back to the metadata-free query on an older server, once', async () => {
    mem = await startFakeMemory({ supportsMetadata: false, events: [photoEvent(1)] });

    const r = await importFromMemory({ url: mem.url });

    expect(r.connected).toBe(true);
    expect(r.story.media).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/does not expose .?EventType.metadata/i);
    // One probe, one retry — and no saved-story pass, since it needs metadata.
    expect(mem.searches).toHaveLength(2);

    // The capability is memoised: a second import doesn't pay for the probe again.
    mem.searches.length = 0;
    await importFromMemory({ url: mem.url });
    expect(mem.searches).toHaveLength(1);
  });

  it('reports "not connected" — with a renderable story — when the server is unreachable', async () => {
    mem = await startFakeMemory();
    const url = mem.url;
    await mem.close();

    const r = await importFromMemory({ url });

    expect(r.connected).toBe(false);
    expect(r.error).toMatch(/CORS|Couldn't reach/i);
    expect(r.story.media).toEqual([]);
    expect(() => deriveModel(r.story)).not.toThrow();
  });

  it('gives the actionable message on 401 rather than a bare failure', async () => {
    mem = await startFakeMemory({ mode: 'unauth' });

    const r = await importFromMemory({ url: mem.url });

    expect(r.connected).toBe(false);
    expect(r.error).toMatch(/sign in|token/i);
  });

  it('never puts the bearer token in an error message', async () => {
    const token = 'eyJhbGciOiJFZERTQSJ9.super-secret-jwt.sig';
    mem = await startFakeMemory({ mode: 'echoauth' });

    const r = await importFromMemory({ url: mem.url, token });

    expect(r.connected).toBe(false);
    // The server quoted the Authorization header straight back at us; that
    // string is headed for the DOM and any log the host collects.
    expect(r.error).not.toContain(token);
    expect(r.error).toContain('<token>');
    expect(JSON.stringify(r.warnings)).not.toContain(token);
  });
});
