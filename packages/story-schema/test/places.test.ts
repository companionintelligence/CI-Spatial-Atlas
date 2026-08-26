import { describe, it, expect } from 'vitest';
import { placesFromResponse } from '../src/index.js';

const sample = {
  places: {
    totalCount: 3,
    pageInfo: { hasNextPage: false, endCursor: null },
    edges: [
      {
        cursor: 'p1',
        node: {
          id: 'p1',
          name: 'Lisbon',
          description: 'Capital of Portugal',
          placeKind: 'city',
          latitude: 38.7,
          longitude: -9.1,
          parentId: 'p0',
          visitStats: { visitCount: 3, firstVisitAt: '2026-01-01T00:00:00Z', lastVisitAt: '2026-05-01T00:00:00Z' },
        },
      },
      // no coordinates (e.g. a country-level row without its own point) — kept
      {
        cursor: 'p2',
        node: { id: 'p2', name: 'Portugal', placeKind: 'country', visitStats: { visitCount: 0 } },
      },
      // missing id — dropped
      { cursor: 'p3', node: { name: 'No id', visitStats: { visitCount: 0 } } },
    ],
  },
};

describe('placesFromResponse', () => {
  it('maps places, keeping ones without coordinates and dropping ones without an id', () => {
    const places = placesFromResponse(sample);
    expect(places).toHaveLength(2);

    const lisbon = places[0]!;
    expect(lisbon).toMatchObject({ id: 'p1', name: 'Lisbon', placeKind: 'city', latitude: 38.7, longitude: -9.1, parentId: 'p0' });
    expect(lisbon.visitStats).toEqual({ visitCount: 3, firstVisitAt: '2026-01-01T00:00:00Z', lastVisitAt: '2026-05-01T00:00:00Z' });

    const portugal = places[1]!;
    expect(portugal.id).toBe('p2');
    expect(portugal.latitude).toBeUndefined();
    expect(portugal.visitStats).toEqual({ visitCount: 0, firstVisitAt: undefined, lastVisitAt: undefined });
  });

  it('returns [] for a shapeless result', () => {
    expect(placesFromResponse({})).toEqual([]);
    expect(placesFromResponse(null)).toEqual([]);
  });
});
