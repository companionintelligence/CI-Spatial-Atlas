import { describe, expect, it } from 'vitest';
import { haversineMetres, nameUnplacedMemories } from '../src/model/atlasModel.js';
import type { AtlasMemory } from '../src/model/atlasModel.js';

const memory = (over: Partial<AtlasMemory>): AtlasMemory => ({
  id: 'm1', title: 'Amazon order — 9 items', timeMs: 0,
  whenDate: 'Jan 1, 2020', whenTime: '9:00 AM', tod: 'day',
  gradient: '', ...over,
});

// The hotel that a real delivery in this archive resolved to, 1m from its point.
const HOTEL = { id: 'p1', name: 'Comfort Inn & Suites SFO North', latitude: 37.61911, longitude: -122.38163 };

describe('nameUnplacedMemories', () => {
  it('names a memory from a Place a few metres away', () => {
    const [m] = nameUnplacedMemories([memory({ lat: 37.61911, lon: -122.38163 })], [HOTEL]);
    expect(m!.place).toBe(HOTEL.name);
    expect(m!.placeId).toBe('p1');
  });

  it('leaves a memory unnamed rather than borrowing a distant name', () => {
    // ~1.5km away: naming it would assert something false.
    const [m] = nameUnplacedMemories([memory({ lat: 37.6325, lon: -122.38163 })], [HOTEL]);
    expect(m!.place).toBeUndefined();
  });

  it('never overwrites a place the server already resolved', () => {
    const [m] = nameUnplacedMemories(
      [memory({ lat: 37.61911, lon: -122.38163, place: 'Real Venue', placeId: 'server' })],
      [HOTEL],
    );
    expect(m!.place).toBe('Real Venue');
    expect(m!.placeId).toBe('server');
  });

  it('picks the nearest when several are in range', () => {
    const near = { id: 'p2', name: 'Nearer', latitude: 37.61912, longitude: -122.38163 };
    const [m] = nameUnplacedMemories([memory({ lat: 37.61911, lon: -122.38163 })], [HOTEL, near]);
    expect(m!.place).toBe(HOTEL.name); // hotel is closer than 'Nearer'
  });

  it('ignores places with no coordinates or no name', () => {
    const [m] = nameUnplacedMemories(
      [memory({ lat: 37.61911, lon: -122.38163 })],
      [{ id: 'x', name: undefined, latitude: 37.61911, longitude: -122.38163 }],
    );
    expect(m!.place).toBeUndefined();
  });
});

describe('haversineMetres', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMetres(37.6, -122.4, 37.6, -122.4)).toBeLessThan(0.001);
  });
  it('matches a known separation', () => {
    // 0.01 degrees of latitude is ~1113m anywhere on Earth.
    expect(haversineMetres(37.6, -122.4, 37.61, -122.4)).toBeGreaterThan(1100);
    expect(haversineMetres(37.6, -122.4, 37.61, -122.4)).toBeLessThan(1120);
  });
});
