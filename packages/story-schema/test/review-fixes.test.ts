import { describe, it, expect } from 'vitest';
import {
  loadStory,
  storyToCzml,
  storyEntities,
  mediaToEntities,
  sceneNarrative,
} from '../src/index.js';
import atlas from './fixtures/atlas-story.json';

const base = {
  schema: 'companion.atlas/story@1',
  id: 's',
  title: 'T',
  timeline: { start: '2026-01-01T00:00:00Z', stop: '2026-01-02T00:00:00Z' },
};

describe('review fixes — schema flexibility', () => {
  it('loads a layers-only Atlas story (content in layers/scenes, empty media)', () => {
    const s = loadStory({ ...base, media: [], layers: [{ id: 'l', kind: '3d-tiles', uri: 'https://x/t.json' }], scenes: [{ id: 'sc', title: 'a' }] });
    expect(s.layers?.length).toBe(1);
  });

  it('loads a scenes-only Scrapbook (empty items)', () => {
    const s = loadStory({ version: '0.1.0', id: 'sb', title: 'T', timeline: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }, items: [], scenes: [{ id: 'sc', caption: 'hi' }] });
    expect(s.items?.length).toBe(0);
    expect(sceneNarrative(s.scenes[0]!)).toBe('hi');
  });

  it('loads an empty draft story (no media/items/scenes)', () => {
    const s = loadStory({ ...base, scenes: [] });
    expect(storyEntities(s)).toEqual([]);
  });

  it('rejects an unparseable timestamp that used to slip through', () => {
    expect(() => loadStory({ ...base, timeline: { start: 'not-a-date', stop: 'also-bad' }, scenes: [] })).toThrow();
  });
});

describe('review fixes — provenance + visibility + audio', () => {
  it('preserves extra provenance keys from a Scrapbook source', () => {
    const s = loadStory({ version: '0.1.0', id: 'sb', title: 'T', timeline: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }, items: [{ id: 'n', type: 'note', position: { lat: 1, lon: 2 }, text: 'x' }], scenes: [], source: { kind: 'import', batchId: 'b99', operator: 'liam' } });
    expect((s.provenance as Record<string, unknown>).batchId).toBe('b99');
    expect((s.provenance as Record<string, unknown>).operator).toBe('liam');
  });

  it('reconciles access.visibility → top-level visibility (and vice versa)', () => {
    const s = loadStory(atlas); // access.visibility 'unlisted', no top-level visibility
    expect(s.visibility).toBe('unlisted');
    expect(s.access?.visibility).toBe('unlisted');
  });

  it('keeps the audio uri on the projected marker entity', () => {
    const [ent] = mediaToEntities({ id: 'a', kind: 'audio', uri: 'https://x/s.mp3', caption: 'Birds', location: { lat: 1, lon: 2 } });
    expect(ent!.type).toBe('marker');
    expect((ent as { description?: string }).description).toBe('https://x/s.mp3');
  });
});

describe('review fixes — CZML robustness', () => {
  it('deduplicates tilesets by url (media#derived + layer to the same asset)', () => {
    const { tilesets } = storyToCzml(loadStory(atlas));
    const urls = tilesets.map((t) => t.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('emits a typed video item’s derived3d as a tileset', () => {
    const { tilesets } = storyToCzml(loadStory({ ...base, items: [{ id: 'v', type: 'video', position: { lat: 1, lon: 2 }, media: { url: 'v.mp4' }, derived3d: { kind: 'gaussian-splat', uri: 'https://x/v/tileset.json' } }], scenes: [] }));
    expect(tilesets.find((t) => t.url === 'https://x/v/tileset.json')?.kind).toBe('gaussian-splat');
  });

  it('extends a single-sample track’s availability to the doc stop', () => {
    const { czml } = storyToCzml(loadStory({ ...base, items: [{ id: 't', type: 'track', path: [{ lat: 1, lon: 2, time: '2026-01-01T06:00:00Z' }] }], scenes: [] }));
    const track = czml.find((p) => p.id === 't');
    expect(track!.availability).toBe('2026-01-01T06:00:00.000Z/2026-01-02T00:00:00.000Z');
  });
});
