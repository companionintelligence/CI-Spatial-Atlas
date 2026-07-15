import { describe, it, expect } from 'vitest';
import { loadStory, storyToCzml } from '../src/index.js';
import atlas from './fixtures/atlas-story.json';
import scrapbook from './fixtures/earth2-scrapbook.json';

describe('storyToCzml', () => {
  it('emits a document/clock packet spanning the timeline', () => {
    const { czml } = storyToCzml(loadStory(scrapbook));
    expect(czml[0]?.id).toBe('document');
    expect((czml[0] as any).clock.interval).toBe(
      '2026-05-09T08:00:00.000Z/2026-05-10T20:00:00.000Z',
    );
  });

  it('emits typed entity packets and separates 3D tilesets', () => {
    const { czml, tilesets } = storyToCzml(loadStory(scrapbook));

    const track = czml.find((p) => p.id === 'trk_walk_day1');
    expect(track?.path).toBeTruthy();
    expect((track?.position as any).epoch).toBe('2026-05-09T09:20:00.000Z');

    const photo = czml.find((p) => p.id === 'ph_comercio');
    expect(photo?.billboard).toBeTruthy();

    // The Jerónimos splat is not expressible in CZML → returned as a tileset.
    const jer = tilesets.find((t) => t.id === 'splat_jeronimos');
    expect(jer?.kind).toBe('gaussian-splat');
    expect(czml.find((p) => p.id === 'splat_jeronimos')).toBeUndefined();
  });

  it('projects Atlas media reconstructions + layers into tilesets', () => {
    const { tilesets } = storyToCzml(loadStory(atlas));
    const urls = tilesets.map((t) => t.url);
    expect(urls).toContain('https://tiles.example.com/accra/tileset.json');
    expect(urls).toContain('https://tiles.example.com/singapore/tileset.json');
  });
});
