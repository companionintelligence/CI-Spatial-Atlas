/**
 * The "journey (time-ordered)" route line `buildMemoryLayer` always drew.
 *
 * Nothing renders here — same bargain as `authoring-entities.test.ts`: the
 * function builds a `Cesium.CustomDataSource` and this inspects the entities
 * in it, in Node, with no DOM or WebGL context.
 *
 * The defect this exists for: the route line (and its moving "traveler" dot)
 * ran straight through wherever a note was about to land, unconditionally,
 * because nothing about placing a note ever asked whether the line should be
 * there. It read as something the note tool had just drawn. `showRoute`
 * (threaded from `CesiumStoryViewer`'s `hideJourneyRoute` prop, true while
 * the Note tool is armed) is the fix — this file is the property that must
 * hold for it to actually be one: the pins and their labels are unaffected,
 * only the route arc and the traveler disappear.
 */
import { describe, expect, it } from 'vitest';
import { buildMemoryLayer } from '../src/renderers/CesiumStoryViewer.js';
import type { AtlasMemory } from '../src/model/atlasModel.js';

const mem = (over: Partial<AtlasMemory> & { id: string }): AtlasMemory => ({
  title: over.id,
  timeMs: 0,
  whenDate: '', whenTime: '', tod: 'day',
  gradient: '',
  ...over,
});

const TWO_LOCATED: AtlasMemory[] = [
  mem({ id: 'a', lat: 0, lon: 0, timeMs: 1000 }),
  mem({ id: 'b', lat: 1, lon: 1, timeMs: 2000 }),
];

describe('buildMemoryLayer: the journey route', () => {
  it('is drawn, with its traveler, when showRoute is true and 2+ memories are located', () => {
    const ds = buildMemoryLayer(TWO_LOCATED, null, true);
    const withPolyline = ds.entities.values.filter((e) => e.polyline);
    expect(withPolyline).toHaveLength(1);
    expect(ds.entities.getById('atlas-traveler')).toBeTruthy();
  });

  it('is omitted entirely when showRoute is false — the note-mode case', () => {
    const ds = buildMemoryLayer(TWO_LOCATED, null, false);
    expect(ds.entities.values.filter((e) => e.polyline)).toHaveLength(0);
    expect(ds.entities.getById('atlas-traveler')).toBeFalsy();
  });

  it('still draws every pin and its label when the route is suppressed', () => {
    // Hiding the route must not read as hiding memories — only the line.
    const shown = buildMemoryLayer(TWO_LOCATED, null, false);
    expect(shown.entities.getById('mem:a')).toBeTruthy();
    expect(shown.entities.getById('mem:b')).toBeTruthy();
    expect(shown.entities.getById('mem:a')?.label).toBeTruthy();
  });

  it('never draws a route for fewer than two located memories, regardless of showRoute', () => {
    const one = buildMemoryLayer([mem({ id: 'a', lat: 0, lon: 0, timeMs: 1000 })], null, true);
    expect(one.entities.values.filter((e) => e.polyline)).toHaveLength(0);
    expect(one.entities.getById('atlas-traveler')).toBeFalsy();
  });
});
