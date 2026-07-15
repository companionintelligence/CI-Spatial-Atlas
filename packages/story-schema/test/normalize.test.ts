import { describe, it, expect } from 'vitest';
import { loadStory, detectFormat, storyEntities, timelineBounds } from '../src/index.js';
import atlas from './fixtures/atlas-story.json';
import scrapbook from './fixtures/earth2-scrapbook.json';

describe('detectFormat', () => {
  it('identifies both legacy shapes and rejects noise', () => {
    expect(detectFormat(atlas)).toBe('atlas');
    expect(detectFormat(scrapbook)).toBe('scrapbook');
    expect(detectFormat({})).toBe('unknown');
    expect(detectFormat(null)).toBe('unknown');
  });
});

describe('loadStory — backward compatibility', () => {
  it('loads a legacy Companion-Atlas Story and projects media into entities', () => {
    const s = loadStory(atlas);
    expect(s.schema).toBe('companion.atlas/story@1');
    expect(s.media?.length).toBe(3);
    expect(s.scenes.length).toBe(3);
    // reykjavik(photo) + accra(video + splat) + singapore(photo + tileset) = 5
    const ents = storyEntities(s);
    expect(ents.length).toBe(5);
    expect(ents.map((e) => e.type).sort()).toEqual(['photo', 'photo', 'splat', 'tileset', 'video']);
  });

  it('loads a legacy CI-Earth-2 Scrapbook and normalizes its vocabulary', () => {
    const s = loadStory(scrapbook);
    expect(s.schema).toBe('companion.atlas/story@1');
    expect(s.items?.length).toBe(5);
    expect(s.scenes.length).toBe(3);
    // timeline.end → canonical timeline.stop
    expect(timelineBounds(s).stop).toBe('2026-05-10T20:00:00Z');
    // scene.caption → scene.narrative
    expect(s.scenes[0].narrative).toMatch(/landed Saturday/);
    // {lon,lat} camera → { location: { lat, lon } }
    expect(s.scenes[0].camera?.location?.lat).toBeCloseTo(38.7077, 3);
    expect(s.scenes[0].camera?.location?.lon).toBeCloseTo(-9.1366, 3);
  });

  it('rejects invalid documents', () => {
    expect(() => loadStory({})).toThrow(/Unrecognized/);
    expect(() =>
      loadStory({
        schema: 'companion.atlas/story@1',
        id: 'x',
        title: 'y',
        timeline: { start: '2026-01-01T00:00:00Z' }, // no stop/end
        scenes: [],
        media: [{ id: 'm', kind: 'image', uri: 'u' }],
      }),
    ).toThrow(/timeline/);
  });

  it('loads a legacy Atlas story with NO timeline and derives the clock window', () => {
    const noTimeline: Record<string, unknown> = { ...(atlas as Record<string, unknown>) };
    delete noTimeline.timeline;
    const s = loadStory(noTimeline);
    expect(s.timeline).toBeUndefined();
    // derived from media capturedAt / scene times: 08:00 .. 09:10
    const b = timelineBounds(s);
    expect(b.start).toBe('2026-03-14T08:00:00.000Z');
    expect(b.stop).toBe('2026-03-14T09:10:00.000Z');
  });
});
