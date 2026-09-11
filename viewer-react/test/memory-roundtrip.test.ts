/**
 * Story → Companion Memory → Story.
 *
 * The claim this suite has to keep honest is the one in `export.ts`'s header:
 * re-importing an exported story reconstructs an *equivalent* story. That only
 * holds because the canonical document rides in `metadata` — CI-Server has no
 * columns for scenes, cameras, narrative or media URLs — so the round-trip is
 * exactly as good as that metadata, and these tests pin both the parts that
 * survive and the parts that provably don't.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORY_SCHEMA_ID, loadStory, type Story } from '@companion-atlas/story';
import { exportStoryToMemory, planExport, placesFromStory } from '../src/memory/export.js';
import { importFromMemory, resetMemoryCapabilities } from '../src/memory/import.js';
import { startFakeMemory, type FakeMemoryServer } from './memory-server.js';

let mem: FakeMemoryServer;

/** A story with all four things the export has to carry: curated scenes and
 *  narrative, authored media, a place, and one entity borrowed from memory. */
function sampleStory(): Story {
  return loadStory({
    schema: STORY_SCHEMA_ID,
    id: 'pacific-journey',
    title: 'Pacific Journey',
    description: 'Four days along the coast.',
    visibility: 'unlisted',
    timeline: { start: '2019-06-01T00:00:00Z', stop: '2019-06-05T00:00:00Z' },
    media: [
      {
        id: 'photo-1',
        kind: 'image',
        uri: 'https://cdn.example/1.jpg',
        thumbnailUri: 'https://cdn.example/1-thumb.jpg',
        caption: 'Sunset at the pier',
        description: 'The light went orange all at once.',
        capturedAt: '2019-06-01T02:00:00Z',
        location: { lat: 37.8083, lon: -122.4098 },
        people: ['person-1', 'person-2'],
        exif: { width: 4032, height: 3024, iso: 100 },
      },
    ],
    items: [
      {
        id: 'note-1',
        type: 'note',
        text: 'We waited an hour for a table and it was worth it.',
        position: { lat: 37.7955, lon: -122.3937 },
        time: { at: '2019-06-02T01:30:00Z' },
        placeId: 'p-adler',
        placeName: 'Adler Theater',
      },
      {
        // Borrowed from the user's own Companion Memory — already a server row.
        id: 'mem:e42',
        type: 'marker',
        position: { lat: 37.7949, lon: -122.3941 },
        time: { at: '2019-06-02T03:00:00Z' },
        source: { kind: 'ci-memory', memoryId: 'e42' },
        placeId: 'p-adler',
        placeName: 'Adler Theater',
      },
    ],
    scenes: [
      {
        id: 'scene-1',
        title: 'Day one',
        narrative: 'We arrived just as the fog gave up.',
        time: { at: '2019-06-01T02:00:00Z' },
        camera: { location: { lat: 37.8083, lon: -122.4098 }, range: 800, heading: 12 },
        itemIds: ['photo-1'],
        layout: 'card-left',
      },
    ],
  });
}

beforeEach(() => { resetMemoryCapabilities(); });
afterEach(async () => { await mem?.close(); });

describe('export: the plan (pure, no network)', () => {
  it('writes authored entities and leaves borrowed memories alone', () => {
    const plan = planExport(sampleStory());

    expect(plan.media.map((e) => e.sourceId)).toEqual([
      'pacific-journey:note-1',
      'pacific-journey:photo-1',
    ]);
    // Re-writing a row that came from Companion Memory would double every pin
    // on the next import.
    expect(plan.skipped.map((s) => s.id)).toContain('mem:e42');
    expect(plan.skipped.find((s) => s.id === 'mem:e42')?.reason).toMatch(/already a Companion Memory/i);

    const photo = plan.media.find((e) => e.sourceId === 'pacific-journey:photo-1')!;
    expect(photo.eventType).toBe('atlas-media');
    expect(photo.locationCoordinates).toEqual({ type: 'Point', coordinates: [-122.4098, 37.8083] });
    expect(photo.sharingLevel).toBe('household'); // unlisted → household
    expect((photo.metadata as Record<string, unknown>).people).toEqual(['person-1', 'person-2']);
    expect((photo.metadata as Record<string, unknown>).exif).toMatchObject({ iso: 100 });
  });

  it('states its own losses rather than reporting a clean save', () => {
    const plan = planExport(sampleStory());
    const text = plan.lossy.join('\n');

    expect(text).toMatch(/Media bytes are not uploaded/i);
    expect(text).toMatch(/anchored at one point/i);
    expect(text).toMatch(/sharingLevel "household"/i);
    expect(text).toMatch(/not self-contained/i);
  });

  it('copies borrowed memories too when asked for a self-contained export', () => {
    const plan = planExport(sampleStory(), { media: 'all' });
    expect(plan.media.map((e) => e.sourceId)).toContain('pacific-journey:mem:e42');
  });

  it('writes only the story document when media is "none"', () => {
    expect(planExport(sampleStory(), { media: 'none' }).media).toEqual([]);
  });

  it('derives a place roster from the story when the caller has no live one', () => {
    const places = placesFromStory(sampleStory());
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ id: 'p-adler', name: 'Adler Theater' });
    expect(places[0]!.visitStats.visitCount).toBe(2);
    expect(places[0]!.latitude).toBeCloseTo(37.7952, 3);
  });
});

describe('story → memory → story', () => {
  it('reconstructs an equivalent story from what the server kept', async () => {
    mem = await startFakeMemory();
    const original = sampleStory();

    const saved = await exportStoryToMemory({ url: mem.url }, original, { shareUrl: 'https://atlas.example/s/pacific' });
    expect(saved.ok).toBe(true);
    expect(saved.storyEventId).toBeTruthy();
    expect(saved.mediaEventIds).toHaveLength(2);
    expect(saved.failed).toEqual([]);

    const back = await importFromMemory({ url: mem.url });

    expect(back.connected).toBe(true);
    expect(back.stories).toHaveLength(1);
    // The whole document, not an approximation of it: scenes, narrative,
    // camera, media references, visibility.
    expect(back.stories[0]).toEqual(original);

    // The authored entities come back as themselves — a photo with its URL, not
    // an anonymous pin at a coordinate.
    const ids = (back.story.items ?? []).map((i) => i.id).sort();
    expect(ids).toEqual(['note-1', 'photo-1']);
    const photo = back.story.items?.find((i) => i.id === 'photo-1');
    expect(photo?.type).toBe('photo');
    expect(photo && 'media' in photo ? photo.media.url : undefined).toBe('https://cdn.example/1.jpg');

    // Atlas's own rows must not ALSO surface through the generic mapping.
    expect(back.story.media ?? []).toEqual([]);
    expect(ids.some((id) => id.startsWith('mem:ev'))).toBe(false);

    // The place roster travelled with the story even though this server has no
    // Place rows of its own.
    expect(back.places.map((p) => p.id)).toContain('p-adler');
  });

  it('updates instead of duplicating when the same story is exported twice', async () => {
    mem = await startFakeMemory();
    const story = sampleStory();

    const first = await exportStoryToMemory({ url: mem.url }, story);
    const second = await exportStoryToMemory({ url: mem.url }, { ...story, title: 'Pacific Journey (edited)' });

    // Idempotent on (sourceType, sourceSystem, sourceId) — three rows, twice.
    expect(mem.created).toHaveLength(3);
    expect(second.storyEventId).toBe(first.storyEventId);

    const back = await importFromMemory({ url: mem.url });
    expect(back.stories).toHaveLength(1);
    expect(back.stories[0]?.title).toBe('Pacific Journey (edited)');
  });

  it('round-trips a story whose entities all came from memory', async () => {
    mem = await startFakeMemory();
    const borrowed = loadStory({
      schema: STORY_SCHEMA_ID,
      id: 'borrowed',
      title: 'A day out',
      timeline: { start: '2019-06-02T00:00:00Z', stop: '2019-06-02T12:00:00Z' },
      items: [{
        id: 'mem:e7', type: 'marker', position: { lat: 37.7, lon: -122.4 },
        time: { at: '2019-06-02T01:00:00Z' }, source: { kind: 'ci-memory', memoryId: 'e7' },
      }],
      scenes: [{ id: 's1', narrative: 'Nothing much happened, which was the point.' }],
    });

    const saved = await exportStoryToMemory({ url: mem.url }, borrowed);
    expect(saved.ok).toBe(true);
    expect(saved.mediaEventIds).toEqual([]); // nothing authored to write

    const back = await importFromMemory({ url: mem.url });
    // The story document survives whole even when no media event was written —
    // its entities are expected to still be in the archive they came from.
    expect(back.stories[0]).toEqual(borrowed);
  });
});

describe('export: degraded servers', () => {
  it('does not throw when the server refuses the write', async () => {
    mem = await startFakeMemory({ mode: 'unauth' });

    const r = await exportStoryToMemory({ url: mem.url }, sampleStory());

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sign in|token/i);
    // Each media row that failed is named, rather than a save that silently
    // dropped two photos and reported success.
    expect(r.failed).toHaveLength(2);
  });

  it('keeps the story when one media row fails', async () => {
    mem = await startFakeMemory();
    const original = sampleStory();
    // Refuse exactly one row: the note. (The server rejects any event whose
    // sourceId ends in `note-1`.)
    const url = mem.url;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('pacific-journey:note-1')) {
        return new Response(JSON.stringify({ errors: [{ message: 'Event validation failed' }] }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const r = await exportStoryToMemory({ url }, original);
      expect(r.ok).toBe(true); // the story document still landed
      expect(r.failed.map((f) => f.id)).toEqual(['pacific-journey:note-1']);
      expect(r.mediaEventIds).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
    }

    // …and the round-trip still returns the whole story, because the document
    // never depended on the per-entity rows.
    const back = await importFromMemory({ url });
    expect(back.stories[0]).toEqual(original);
  });

  it('warns, once, when the server has no createPlace mutation', async () => {
    mem = await startFakeMemory({ supportsCreatePlace: false });

    const r = await exportStoryToMemory({ url: mem.url }, sampleStory(), { createPlaces: true });

    expect(r.ok).toBe(true);
    expect(r.placeIds).toEqual([]);
    expect(r.warnings.filter((w) => /createPlace/.test(w))).toHaveLength(1);
    expect(r.lossy.join('\n')).toMatch(/travel as story metadata/i);
  });

  it('creates Place rows on a server that does have the mutation', async () => {
    mem = await startFakeMemory({ supportsCreatePlace: true });

    const r = await exportStoryToMemory({ url: mem.url }, sampleStory(), { createPlaces: true });

    expect(r.ok).toBe(true);
    expect(r.placeIds).toHaveLength(1);
  });

  it('never puts the bearer token in an export error', async () => {
    const token = 'eyJhbGciOiJFZERTQSJ9.another-secret.sig';
    mem = await startFakeMemory({ mode: 'echoauth' });

    const r = await exportStoryToMemory({ url: mem.url, token }, sampleStory());

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(token);
    expect(r.error).toContain('<token>');
  });

  it('reports progress across places, media and the story event', async () => {
    mem = await startFakeMemory();
    const phases: string[] = [];

    await exportStoryToMemory({ url: mem.url }, sampleStory(), {
      onProgress: (p) => { phases.push(p.phase); throw new Error('a throwing setState must not stop the write'); },
    });

    expect(new Set(phases)).toEqual(new Set(['media', 'story']));
    expect(mem.created).toHaveLength(3);
  });
});
