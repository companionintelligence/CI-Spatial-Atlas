/**
 * The regression these exist for: an imported KML placemark was parsed, merged
 * into the story, and exported back to KML correctly — and never drawn, because
 * the globe's CZML filter dropped every packet the memory-pin layer was assumed
 * to redraw. The pin layer only draws entities derived from `story.scenes`, so
 * that assumption was wrong for everything that arrives as a sceneless item.
 */
import { describe, expect, it } from 'vitest';
import { storyToCzml, type Item, type Story } from '@companion-atlas/story';
import { keepForGlobe } from '../src/renderers/globeCzml.js';

const NONE: ReadonlySet<string> = new Set();

describe('keepForGlobe', () => {
  it('keeps the document packet, which carries the clock', () => {
    expect(keepForGlobe({ id: 'document' }, NONE)).toBe(true);
  });

  it('keeps tracks and 3D models, as it always did', () => {
    expect(keepForGlobe({ id: 't', path: {} }, NONE)).toBe(true);
    expect(keepForGlobe({ id: 'm', model: {} }, NONE)).toBe(true);
  });

  it('keeps drawn geometry — no pin has ever stood in for a shape', () => {
    expect(keepForGlobe({ id: 'l', polyline: {} }, NONE)).toBe(true);
    expect(keepForGlobe({ id: 'p', polygon: {} }, NONE)).toBe(true);
  });

  it('still drops a located memory the pin layer redraws', () => {
    expect(keepForGlobe({ id: 'photo-1', billboard: {} }, NONE)).toBe(false);
    expect(keepForGlobe({ id: 'photo-2', point: {} }, NONE)).toBe(false);
  });

  it('keeps a sceneless point once it is named as a passthrough', () => {
    const ids = new Set(['imported-1']);
    expect(keepForGlobe({ id: 'imported-1', point: {} }, ids)).toBe(true);
    expect(keepForGlobe({ id: 'other', point: {} }, ids)).toBe(false);
  });

  describe('a passthrough billboard — a photo or video with no scene', () => {
    const ids = new Set(['photo-1']);

    it('is dropped by default, even once named as a passthrough', () => {
      // An upload used to reach the globe the instant it had no scene, with no
      // way to turn it back off. Omitting `opts` entirely must be as safe as
      // passing `{ showImages: false }` explicitly.
      expect(keepForGlobe({ id: 'photo-1', billboard: {} }, ids)).toBe(false);
      expect(keepForGlobe({ id: 'photo-1', billboard: {} }, ids, { showImages: false })).toBe(false);
    });

    it('is kept once the caller opts in, but only when it is also a named passthrough', () => {
      expect(keepForGlobe({ id: 'photo-1', billboard: {} }, ids, { showImages: true })).toBe(true);
      expect(keepForGlobe({ id: 'other', billboard: {} }, ids, { showImages: true })).toBe(false);
    });

    it('does not gate anything else on showImages — a plain point ignores it', () => {
      expect(keepForGlobe({ id: 'imported-1', point: {} }, new Set(['imported-1']), { showImages: false })).toBe(true);
    });
  });
});

describe('an imported KML story survives the filter', () => {
  // Exactly the shape the interop path produces: sceneless items, no scenes.
  const items: Item[] = [
    { id: 'kml-1', type: 'marker', position: { lat: 64.15, lon: -21.93 } },
    {
      id: 'kml-2',
      type: 'line',
      positions: [{ lat: 64.14, lon: -21.99 }, { lat: 64.17, lon: -21.9 }],
    },
    {
      id: 'kml-3',
      type: 'polygon',
      positions: [
        { lat: 64.13, lon: -21.97 },
        { lat: 64.13, lon: -21.89 },
        { lat: 64.17, lon: -21.89 },
      ],
    },
  ] as Item[];

  const story = {
    schema: 'companion.atlas/story@1',
    id: 'imported',
    title: 'Imported',
    scenes: [],
    items,
  } as unknown as Story;

  it('renders every imported feature', () => {
    const { czml } = storyToCzml(story);
    const ids = new Set(items.map((i) => i.id));
    const kept = czml.filter((p) => keepForGlobe(p, ids)).map((p) => String(p.id));

    for (const item of items) {
      expect(kept, `${item.type} ${item.id} must reach the globe`).toContain(item.id);
    }
  });

  it('renders the shapes even when nothing is declared a passthrough', () => {
    // Drawn geometry must not depend on the caller remembering to pass ids —
    // an authored story with a polygon and no import has the same need.
    const { czml } = storyToCzml(story);
    const kept = czml.filter((p) => keepForGlobe(p, NONE)).map((p) => String(p.id));
    expect(kept).toContain('kml-2');
    expect(kept).toContain('kml-3');
  });
});
