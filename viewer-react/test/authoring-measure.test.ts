import { describe, expect, it } from 'vitest';
import { Item as ItemSchema } from '@companion-atlas/story';
import {
  describeMeasurement,
  formatArea,
  formatLength,
  measurementOf,
  measurementWarning,
  MEASURE_UNITS,
  MIN_MEASURE_POINTS,
} from '../src/authoring/measure.js';
import {
  addVertex,
  createDraft,
  finishDraft,
  isDrawingMode,
  isMeasureMode,
  MIN_VERTICES,
  snapshot,
  TOOL_MODES,
  DRAW_MODES,
} from '../src/authoring/draft.js';
import { MEASURE_LINE_ID, parsePickedId, measureVertexEntityId } from '../src/authoring/ids.js';

/**
 * The measure tool.
 *
 * The load-bearing property is a negative one — **a measurement never becomes an
 * `Item`** — so most of what is asserted here is that a path which produces
 * geometry for every other tool produces none for this one. That is the failure
 * this feature exists to prevent: before it, the only way to read a distance was
 * to draw a line, and the line stayed in the story.
 *
 * The arithmetic itself is not re-tested — `distanceMeters` and
 * `ringAreaMeters` have their own suite in `authoring-geometry.test.ts` and this
 * module only arranges them. What is tested is which of them gets used where,
 * because reporting a closed perimeter as a walking distance is wrong in a way
 * that looks entirely plausible.
 */

const p = (lon: number, lat: number) => ({ lon, lat });

/** One degree of latitude at the equator, in metres — the yardstick every
 *  assertion below is calibrated against. */
const DEG_LAT_M = 111_195;

const clicks = (mode: Parameters<typeof createDraft>[0], ...pts: { lon: number; lat: number }[]) =>
  pts.reduce((d, pt) => addVertex(d, pt), createDraft(mode));

describe('measure is a mode, but not a drawing mode', () => {
  it('is armed and disarmed like every other tool', () => {
    expect(isDrawingMode('measure')).toBe(true);
    expect(isMeasureMode('measure')).toBe(true);
    expect(isMeasureMode('polygon')).toBe(false);
  });

  it('is offered by the toolbar but is NOT in DRAW_MODES', () => {
    // `DRAW_MODES` means "modes that produce an Item". Everything that maps a
    // mode onto an item type iterates it, so a measure entry there would be a
    // measurement with an id.
    expect(DRAW_MODES).not.toContain('measure');
    expect(TOOL_MODES).toContain('measure');
    expect(TOOL_MODES[0]).toBe('idle');
  });

  it('needs two points, like a line', () => {
    expect(MIN_VERTICES.measure).toBe(MIN_MEASURE_POINTS);
  });
});

describe('a measurement never becomes an Item', () => {
  it('refuses to finish, however many points are down', () => {
    for (const pts of [
      [p(0, 0), p(0, 1)],
      [p(0, 0), p(1, 0), p(1, 1), p(0, 1)],
    ]) {
      const draft = clicks('measure', ...pts);
      const result = finishDraft(draft, { id: 'should-never-exist' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('measure');
        // Not the generic "no drawing tool is active" — that message would send
        // whoever hit this looking in the wrong place entirely.
        expect(result.message).toMatch(/never saved as an item/i);
      }
    }
  });

  it('produces a value that would not survive Item.parse', () => {
    const m = measurementOf([p(0, 0), p(0, 1)]);
    expect(m).not.toBeNull();
    // Enforced by construction rather than by a flag: there is no `type`, no
    // `id` and no `source`, so it cannot be mistaken for story content by
    // anything downstream — including a future careless spread into an array of
    // items.
    expect(ItemSchema.safeParse(m).success).toBe(false);
    expect(m as unknown as Record<string, unknown>).not.toHaveProperty('id');
    expect(m as unknown as Record<string, unknown>).not.toHaveProperty('source');
  });

  it('its globe entities are pickable as "measure", never as an item', () => {
    // A measurement drawn across a shape must not swallow clicks meant for it,
    // and must never arm the vertex-drag path — the drag writes through
    // `setVertex`, which only knows how to edit an `Item`.
    expect(parsePickedId(MEASURE_LINE_ID)).toEqual({ kind: 'measure' });
    expect(parsePickedId(measureVertexEntityId(3))).toEqual({ kind: 'measure' });
    expect(parsePickedId('authoring-measure-label')).toEqual({ kind: 'measure' });
  });
});

describe('what a measurement reports', () => {
  it('two points give a distance and no area', () => {
    const m = measurementOf([p(0, 0), p(0, 1)])!;
    expect(m.lengthMeters / DEG_LAT_M).toBeCloseTo(1, 2);
    expect(m.areaMeters).toBe(0);
    expect(m.perimeterMeters).toBe(0);
  });

  it('is null below two points, rather than a confident zero', () => {
    expect(measurementOf([])).toBeNull();
    expect(measurementOf([p(0, 0)])).toBeNull();
    // Two clicks on the same spot are one point once de-duplicated.
    expect(measurementOf([p(2, 2), p(2, 2)])).toBeNull();
  });

  it('reports length along the path as clicked, NOT the closed lap', () => {
    // Three sides of a unit square. Walking it is 3 degrees; the lap is 4.
    const m = measurementOf([p(0, 0), p(1, 0), p(1, 1), p(0, 1)])!;
    expect(m.lengthMeters / DEG_LAT_M).toBeCloseTo(3, 1);
    expect(m.perimeterMeters / DEG_LAT_M).toBeCloseTo(4, 1);
    expect(m.perimeterMeters).toBeGreaterThan(m.lengthMeters);
  });

  it('reports the area of the ring the path would close into', () => {
    const m = measurementOf([p(0, 0), p(1, 0), p(1, 1), p(0, 1)])!;
    // A one-degree square at the equator is ~12,300 km².
    expect(m.areaMeters / 1e6).toBeCloseTo(12_300, -3);
    expect(m.crosses).toBe(false);
  });

  it('refuses an area for a ring that crosses itself', () => {
    // A bow-tie. The spherical-excess sum returns a number for this — the lobes
    // cancel — and that number looks entirely plausible in a readout.
    const m = measurementOf([p(0, 0), p(2, 2), p(2, 0), p(0, 2)])!;
    expect(m.crosses).toBe(true);
    expect(m.areaMeters).toBe(0);
    expect(measurementWarning(m)).toMatch(/no area to report/i);
    // The distance is still real and is still reported.
    expect(m.lengthMeters).toBeGreaterThan(0);
  });

  it('treats a three-click there-and-back as a path, not a triangle', () => {
    const m = measurementOf([p(0, 0), p(0, 1), p(0, 0)])!;
    expect(m.areaMeters).toBe(0);
    expect(m.perimeterMeters).toBe(0);
    expect(m.lengthMeters / DEG_LAT_M).toBeCloseTo(2, 1);
  });
});

describe('the live readout while measuring', () => {
  it('reports the open path, where a polygon reports the closed perimeter', () => {
    const pts = [p(0, 0), p(1, 0), p(1, 1)] as const;
    const measuring = snapshot(clicks('measure', ...pts));
    const drawing = snapshot(clicks('polygon', ...pts));
    // Same three clicks, deliberately different numbers: "how far did I walk"
    // and "how long is this boundary" are different questions.
    expect(measuring.lengthMeters).toBeLessThan(drawing.lengthMeters);
    expect(measuring.areaMeters).toBeGreaterThan(0);
  });

  it('withholds the area once the ring crosses itself, in either mode', () => {
    expect(snapshot(clicks('measure', p(0, 0), p(2, 2), p(2, 0), p(0, 2))).areaMeters).toBe(0);
    expect(snapshot(clicks('polygon', p(0, 0), p(2, 2), p(2, 0), p(0, 2))).areaMeters).toBe(0);
  });

  it('warns about a crossing measure ring without mentioning a fill it has not got', () => {
    const s = snapshot(clicks('measure', p(0, 0), p(2, 2), p(2, 0), p(0, 2)));
    expect(s.warning).toMatch(/no area to report/i);
    expect(s.warning).not.toMatch(/fill/i);
  });
});

describe('units are one setting, applied once', () => {
  it('offers exactly two, metric first', () => {
    expect([...MEASURE_UNITS]).toEqual(['metric', 'imperial']);
  });

  it('formats length in each system', () => {
    expect(formatLength(940)).toBe('940 m');
    expect(formatLength(1500)).toBe('1.50 km');
    expect(formatLength(42_000)).toBe('42.0 km');
    expect(formatLength(0)).toBe('0 m');

    expect(formatLength(304.8, 'imperial')).toBe('1000 ft');
    expect(formatLength(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatLength(48_280.32, 'imperial')).toBe('30.0 mi');
    expect(formatLength(0, 'imperial')).toBe('0 ft');
  });

  it('formats area in each system', () => {
    expect(formatArea(850)).toBe('850 m²');
    expect(formatArea(25_000)).toBe('2.50 ha');
    expect(formatArea(3_400_000)).toBe('3.40 km²');

    // One acre exactly, and one square mile exactly.
    expect(formatArea(4046.8564224, 'imperial')).toBe('1.00 ac');
    expect(formatArea(2_589_988.110336, 'imperial')).toBe('1.00 mi²');
    expect(formatArea(92.90304, 'imperial')).toBe('1000 ft²');
    expect(formatArea(0, 'imperial')).toBe('0 ft²');
  });

  it('round-trips a length through the imperial branch without drift', () => {
    // The conversion constants are exact definitions, not approximations, so a
    // value that formats to a round number of feet is exactly that many feet.
    expect(formatLength(1 * 0.3048, 'imperial')).toBe('1 ft');
    expect(formatLength(5280 * 0.3048, 'imperial')).toBe('1.00 mi');
  });

  it('describes a measurement identically wherever it is rendered', () => {
    const line = measurementOf([p(0, 0), p(0, 1)])!;
    expect(describeMeasurement(line)).toBe(formatLength(line.lengthMeters));
    expect(describeMeasurement(line, 'imperial')).toBe(formatLength(line.lengthMeters, 'imperial'));

    const ring = measurementOf([p(0, 0), p(1, 0), p(1, 1), p(0, 1)])!;
    // Area first, then the lap — and the lap is labelled, so it cannot be read
    // as the distance walked.
    expect(describeMeasurement(ring)).toContain(formatArea(ring.areaMeters));
    expect(describeMeasurement(ring)).toContain('around');

    expect(describeMeasurement(null)).toBe('');
  });
});
