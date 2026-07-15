import { describe, it, expect } from 'vitest';
import { mediaItemsFromMemory, readGeoJsonPoint } from '../src/index.js';

const sampleResult = {
  search: {
    edges: [
      {
        node: {
          __typename: 'EventType',
          id: 'evt_lisbon',
          title: 'Praça do Comércio',
          startTime: '2026-05-09T09:14:00Z',
          mapCoordinates: { type: 'Point', coordinates: [-9.1366, 38.7077] },
          previewUrl: 'https://cdn/lisbon_thumb.jpg',
          mediaUrl: 'https://cdn/lisbon.jpg',
          mediaContentType: 'image/jpeg',
          locationName: 'Lisbon',
        },
      },
      // null-island → rejected
      { node: { __typename: 'EventType', id: 'evt_bad', mapCoordinates: { type: 'Point', coordinates: [0, 0] }, previewUrl: 'x' } },
      // not an EventType → skipped
      { node: { __typename: 'FileType', id: 'file_1' } },
      // located video → kept as video
      {
        node: {
          __typename: 'EventType',
          id: 'evt_vid',
          startTime: '2026-05-09T10:00:00Z',
          mapCoordinates: { type: 'Point', coordinates: [-9.13, 38.71] },
          previewUrl: 'https://cdn/v_thumb.jpg',
          mediaUrl: 'https://cdn/v.mp4',
          mediaContentType: 'video/mp4',
        },
      },
    ],
  },
};

describe('mediaItemsFromMemory', () => {
  it('maps located media events to canonical MediaItems and drops the rest', () => {
    const items = mediaItemsFromMemory(sampleResult);
    expect(items.length).toBe(2);

    const photo = items[0]!;
    expect(photo.id).toBe('mem:evt_lisbon');
    expect(photo.kind).toBe('image');
    expect(photo.location).toEqual({ lat: 38.7077, lon: -9.1366 });
    expect(photo.sourceMemoryId).toBe('evt_lisbon');
    expect(photo.capturedAt).toBe('2026-05-09T09:14:00Z');

    expect(items[1]!.kind).toBe('video');
  });

  it('rejects null-island and malformed points', () => {
    expect(readGeoJsonPoint({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(readGeoJsonPoint({ coordinates: ['x', 1] })).toBeNull();
    expect(readGeoJsonPoint(null)).toBeNull();
    expect(readGeoJsonPoint({ type: 'Point', coordinates: [-9.1, 38.7] })).toEqual({ lat: 38.7, lon: -9.1 });
  });

  it('returns [] for a shapeless result', () => {
    expect(mediaItemsFromMemory({})).toEqual([]);
    expect(mediaItemsFromMemory(null)).toEqual([]);
  });
});
