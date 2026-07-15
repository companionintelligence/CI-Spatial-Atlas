import { describe, it, expect } from 'vitest';
import { sceneInstantFromTime, haversineMeters } from '../src/compose.js';

describe('compose helpers', () => {
  it('sceneInstantFromTime parses ISO, defaults missing/invalid to +Inf', () => {
    expect(sceneInstantFromTime('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(sceneInstantFromTime(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(sceneInstantFromTime('nonsense')).toBe(Number.POSITIVE_INFINITY);
  });

  it('haversineMeters is 0 for a point and ~111 km per degree of latitude', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    const deg = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(deg).toBeGreaterThan(110_000);
    expect(deg).toBeLessThan(112_000);
  });
});
