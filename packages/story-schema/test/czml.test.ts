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

const base = {
  schema: 'companion.atlas/story@1',
  id: 's',
  title: 'T',
  timeline: { start: '2026-01-01T00:00:00Z', stop: '2026-01-02T00:00:00Z' },
  scenes: [],
};

describe('storyToCzml — drawn line and polygon', () => {
  it('puts a line in polyline.positions, not the packet position', () => {
    const { czml } = storyToCzml(
      loadStory({
        ...base,
        items: [
          {
            id: 'l',
            type: 'line',
            positions: [
              { lat: 1, lon: 2 },
              { lat: 3, lon: 4 },
            ],
            color: '#ffcc00',
            width: 6,
            time: { at: '2026-01-01T06:00:00Z' },
          },
        ],
      }),
    );
    const line = czml.find((p) => p.id === 'l')!;
    // A top-level `position` here would render nothing, silently.
    expect(line.position).toBeUndefined();
    expect(line.polyline).toEqual({
      positions: { cartographicDegrees: [2, 1, 0, 4, 3, 0] },
      material: { solidColor: { color: { rgba: [255, 204, 0, 255] } } },
      width: 6,
      clampToGround: true,
      arcType: 'GEODESIC',
    });
    expect(line.availability).toBe('2026-01-01T06:00:00.000Z/2026-01-02T00:00:00.000Z');
  });

  it('honours per-vertex heights instead of draping when they are present', () => {
    const { czml } = storyToCzml(
      loadStory({
        ...base,
        items: [{ id: 'l', type: 'line', positions: [{ lat: 1, lon: 2, height: 500 }, { lat: 3, lon: 4, height: 700 }] }],
      }),
    );
    expect((czml.find((p) => p.id === 'l')!.polyline as { clampToGround: boolean }).clampToGround).toBe(false);
  });

  it('emits polygon holes as an array of position lists', () => {
    const { czml } = storyToCzml(
      loadStory({
        ...base,
        items: [
          {
            id: 'p',
            type: 'polygon',
            positions: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }],
            holes: [[{ lat: 0.2, lon: 0.2 }, { lat: 0.2, lon: 0.6 }, { lat: 0.6, lon: 0.6 }]],
            fillColor: '#39c0ff',
            fillOpacity: 0.25,
            outlineColor: '#ffffff',
            outlineWidth: 2,
          },
        ],
      }),
    );
    const poly = czml.find((p) => p.id === 'p')!.polygon as Record<string, unknown>;
    expect(poly.holes).toEqual({ cartographicDegrees: [[0.2, 0.2, 0, 0.6, 0.2, 0, 0.6, 0.6, 0]] });
    expect(poly.fill).toBe(true);
    expect(poly.material).toEqual({ solidColor: { color: { rgba: [57, 192, 255, 64] } } });
    expect(poly.outline).toBe(true);
    expect(poly.outlineWidth).toBe(2);
    // Draped, so per-vertex heights must be off or the shape sinks into terrain.
    expect(poly.perPositionHeight).toBe(false);
  });

  it('treats fillOpacity 0 / outlineWidth 0 as "off", not as unset', () => {
    const { czml } = storyToCzml(
      loadStory({
        ...base,
        items: [
          {
            id: 'p',
            type: 'polygon',
            positions: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }],
            fillOpacity: 0,
            outlineWidth: 0,
          },
        ],
      }),
    );
    const poly = czml.find((p) => p.id === 'p')!.polygon as Record<string, unknown>;
    expect(poly.fill).toBe(false);
    expect(poly.outline).toBe(false);
  });

  it('rejects degenerate geometry at the schema boundary', () => {
    expect(() => loadStory({ ...base, items: [{ id: 'l', type: 'line', positions: [{ lat: 1, lon: 2 }] }] })).toThrow();
    expect(() =>
      loadStory({ ...base, items: [{ id: 'p', type: 'polygon', positions: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }] }),
    ).toThrow();
  });
});
