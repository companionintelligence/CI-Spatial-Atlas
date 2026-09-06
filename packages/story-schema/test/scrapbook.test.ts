import { describe, it, expect } from 'vitest';
import { buildScrapbookStory, createEventInputFromStory, curateJourney, journeyTitle, storyEntities, type ScrapbookEntry } from '../src/index.js';

const ENTRIES: ScrapbookEntry[] = [
  {
    id: 'm-rey', title: 'First light over Reykjavík', place: 'Reykjavík, Iceland',
    timeMs: Date.parse('2026-03-14T08:00:00Z'), lat: 64.1466, lon: -21.9426,
    narrative: 'Dawn at the old harbour.', people: ['person:amara'],
    media: { url: 'https://srv/media/rey.jpg', thumbnailUrl: 'https://srv/media/rey_t.jpg', kind: 'image' },
  },
  {
    id: 'm-acc', title: 'Market morning in Accra', place: 'Accra, Ghana',
    timeMs: Date.parse('2026-03-14T11:20:00Z'), lat: 5.6037, lon: -0.187,
    media: { url: 'ci-memory://demo/accra.mp4', kind: 'video' }, // non-http → no media entry
  },
  {
    id: 'm-sfo', title: 'Fog rolling over the bridge', place: 'San Francisco, USA',
    timeMs: Date.parse('2026-03-20T01:10:00Z'), lat: 37.8199, lon: -122.4783,
    media: { url: 'https://srv/media/sfo.jpg', kind: 'image' },
  },
];

describe('buildScrapbookStory', () => {
  it('builds a valid Story: chronological scenes, http-only media, visibility + provenance', () => {
    const story = buildScrapbookStory(ENTRIES, { visibility: 'unlisted' });
    expect(story.schema).toBe('companion.atlas/story@1');
    expect(story.scenes.map((s) => s.id)).toEqual(['sb-m-rey', 'sb-m-acc', 'sb-m-sfo']);
    // non-http media dropped from `media`, but the scene keeps the place
    expect(story.media!.map((m) => m.id)).toEqual(['sb-media-m-rey', 'sb-media-m-sfo']);
    expect(story.media![0]!.people).toEqual(['person:amara']);
    expect(story.timeline!.start).toBe('2026-03-14T08:00:00.000Z');
    expect(story.timeline!.stop).toBe('2026-03-20T01:10:00.000Z');
    expect(story.visibility).toBe('unlisted');
    expect(story.provenance!.kind).toBe('manual');
    // every scene is a renderable located memory
    expect(storyEntities(story).length).toBeGreaterThan(0);
  });

  it('titles the journey from first → last place and date range', () => {
    expect(journeyTitle(ENTRIES)).toBe('Reykjavík → San Francisco · Mar 14–20, 2026');
    expect(journeyTitle([])).toBe('My journey');
  });
});

describe('curateJourney (on-device curator)', () => {
  it('fills missing narratives from place + solar time and stamps agent provenance', () => {
    const story = curateJourney(ENTRIES);
    expect(story.provenance!.agent).toBe('atlas-curator');
    expect(story.provenance!.kind).toBe('ci-memory');
    // Accra had no narrative → curator writes one from its local morning
    const accra = story.scenes.find((s) => s.id === 'sb-m-acc')!;
    expect(accra.narrative).toMatch(/Daylight over Accra, Ghana/);
    // authored narrative is preserved
    const rey = story.scenes.find((s) => s.id === 'sb-m-rey')!;
    expect(rey.narrative).toBe('Dawn at the old harbour.');
    expect(story.title).toBe('Reykjavík → San Francisco · Mar 14–20, 2026');
  });
});

describe('write-back carries the journey', () => {
  const A = { id: 'a', title: 'A', place: 'Reykjavík, Iceland', timeMs: Date.parse('2026-03-14T08:00:00Z'), lat: 64.1, lon: -21.9 };
  const B = { id: 'b', title: 'B', place: 'Accra, Ghana', timeMs: Date.parse('2026-03-15T08:00:00Z'), lat: 5.6, lon: -0.18 };
  const C = { id: 'c', title: 'C', place: 'Lisbon', timeMs: Date.parse('2026-03-16T08:00:00Z'), lat: 38.7, lon: -9.1 };

  it('persists the story document so a saved journey can be re-opened', () => {
    const input = createEventInputFromStory(curateJourney([A, B]));
    const story = (input.metadata as any).story;
    expect(story).toBeDefined();
    expect(story.scenes).toHaveLength(2);
    // the curator's narrative survives the write-back
    expect(story.scenes[0].narrative).toMatch(/stop 1 of 2/);
  });

  it('carries agent provenance for a curated journey', () => {
    const input = createEventInputFromStory(curateJourney([A, B]));
    expect((input.metadata as any).provenance).toMatchObject({ kind: 'ci-memory', agent: 'atlas-curator' });
    const manual = createEventInputFromStory(buildScrapbookStory([A, B]));
    expect((manual.metadata as any).provenance).toMatchObject({ kind: 'manual' });
  });

  it('gives different memory sets different idempotency keys', () => {
    // sourceId is the server-side dedup key: a collision silently overwrites.
    const ab = createEventInputFromStory(buildScrapbookStory([A, B])).sourceId;
    const ac = createEventInputFromStory(buildScrapbookStory([A, C])).sourceId;
    expect(ab).not.toBe(ac);
    // …and the same set is stable (re-saving updates rather than duplicating)
    expect(createEventInputFromStory(buildScrapbookStory([B, A])).sourceId).toBe(ab);
  });

  it('pins the idempotency key: the id hash must not drift between releases', () => {
    // Already-saved journeys dedup on this exact string. Anything that changes the
    // hash - notably the '\x00' separator in scrapbookId - re-saves every existing
    // journey as a new event instead of updating it. Update these literals only
    // with a deliberate migration.
    expect(createEventInputFromStory(buildScrapbookStory([A, B])).sourceId).toBe('scrapbook-2-4pbs2a');
    // The separator is load-bearing: without it ['ab','c'] and ['a','bc'] collide.
    const mk = (ids: string[]) => ids.map((id, i) => ({ id, title: id, timeMs: 1000 + i }));
    expect(buildScrapbookStory(mk(['ab', 'c'])).id).toBe('scrapbook-2-1ughu7b');
    expect(buildScrapbookStory(mk(['a', 'bc'])).id).toBe('scrapbook-2-qstin7');
  });

  it('maps visibility to sharingLevel', () => {
    expect(createEventInputFromStory(buildScrapbookStory([A], { visibility: 'unlisted' })).sharingLevel).toBe('household');
    expect(createEventInputFromStory(buildScrapbookStory([A], { visibility: 'public' })).sharingLevel).toBe('public');
    expect(createEventInputFromStory(buildScrapbookStory([A])).sharingLevel).toBe('private');
  });
});
