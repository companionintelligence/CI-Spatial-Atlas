/**
 * Numbers that contradict each other on the same screen.
 *
 * Three defects an adversarial pass over this branch found, all of the same
 * kind: a reading that is not wrong so much as *inconsistent with the reading
 * next to it*, which is how a person decides a tool cannot be trusted.
 *
 * 1. The metric/imperial toggle governed the measurement readout and the label
 *    drawn on the globe, but not the "Capture this view" line — which sits three
 *    rows above the toggle in the same panel and hard-coded metres. Pressing
 *    Imperial gave "Measured 3280 ft" over "Captured · … · 850 m".
 *
 * 2. Both unit ladders rounded *after* choosing the rung, so a value just short
 *    of a boundary printed in the smaller unit at the larger unit's value:
 *    999.6 m as "1000 m", 9999.9 m² as "10000 m²", and — the one a person would
 *    actually notice — 1609.2 m as "5280 ft", which is a mile, written in feet.
 */
import { describe, expect, it } from 'vitest';
import { formatArea, formatLength } from '../src/authoring/measure.js';
import { cameraFromPose, describeCamera } from '../src/authoring/camera.js';

const at = (height: number) =>
  cameraFromPose({ longitude: 0, latitude: 0, height, heading: 0, pitch: -Math.PI / 2, roll: 0 })!;

describe('the units toggle reaches every distance in the drawing panel', () => {
  it('switches the captured-camera altitude with everything else', () => {
    expect(describeCamera(at(850), 'metric')).toContain('850 m');
    expect(describeCamera(at(850), 'imperial')).toContain('2789 ft');
  });

  it('keeps the metric default, so nothing moves for an author who never touches it', () => {
    // The pre-existing string, unchanged: this fix must not restyle a readout
    // people already read.
    expect(describeCamera(at(1800))).toBe(describeCamera(at(1800), 'metric'));
    expect(describeCamera(at(1800))).toContain('1800 m');
    expect(describeCamera(at(1.8e6))).toContain('1800 km');
  });

  it('climbs to miles at the same rung metric climbs to kilometres', () => {
    // 10 km is where the metric readout switches; imperial switches at the
    // equivalent height rather than at some other number, so the two agree
    // about *when* the format changes even though they disagree about units.
    expect(describeCamera(at(9_500), 'metric')).toContain('9500 m');
    expect(describeCamera(at(12_000), 'metric')).toContain('12 km');
    expect(describeCamera(at(12_000), 'imperial')).toMatch(/\bmi\b/);
  });

  it('still refuses to describe a camera it does not have', () => {
    expect(describeCamera(null, 'imperial')).toMatch(/No view/);
  });
});

describe('a rounded value never prints in the rung below its own', () => {
  it('does not print one kilometre as "1000 m"', () => {
    expect(formatLength(999.6)).toBe('1.00 km');
    expect(formatLength(999.4)).toBe('999 m');
  });

  it('does not print one mile as "5280 ft"', () => {
    // The clearest case: a person checking the tool against a mile they know.
    expect(formatLength(1609.2, 'imperial')).toMatch(/mi$/);
    expect(formatLength(1600, 'imperial')).toBe('5249 ft');
  });

  it('does not print one hectare as "10000 m²"', () => {
    expect(formatArea(9_999.9)).toBe('1.00 ha');
    expect(formatArea(9_000)).toBe('9000 m²');
  });

  it('does not print one acre as a count of square feet', () => {
    // 4046.85 m² is a hair UNDER an acre (4046.8564224 m²), so the old
    // rung-then-round order printed "43560 ft²" — an acre, in square feet.
    expect(formatArea(4046.85, 'imperial')).toMatch(/ac$/);
    expect(formatArea(3000, 'imperial')).toBe('32292 ft²');
  });

  it('leaves ordinary values alone', () => {
    expect(formatLength(1)).toBe('1 m');
    expect(formatLength(432)).toBe('432 m');
    expect(formatLength(47_100)).toBe('47.1 km');
    expect(formatArea(229_420_00 / 100)).toBe('22.94 ha');
  });
});
