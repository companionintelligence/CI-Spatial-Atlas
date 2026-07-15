import { describe, it, expect } from 'vitest';
import { mediaItemsFromMemory, readGeoJsonPoint, createEventInputFromStory, loadStory } from '../src/index.js';
import atlas from './fixtures/atlas-story.json';

const sampleResult = {
  search: {
    edges: [
      {
        node: {
          __typename: 'EventType',
          id: 'evt_lisbon',
          title: 'Praça do Comércio',
          startTime: '2026-05-09T09:14:00Z',
          locationCoordinates: { type: 'Point', coordinates: [-9.1366, 38.7077] },
          previewUrl: '/companion/x_thumb.jpg?sig=1',
          mediaUrl: '/companion/x.jpg?sig=1',
          mediaContentType: 'image/jpeg',
          locationName: 'Lisbon',
          mediaWidth: 4032,
          mediaHeight: 3024,
        },
      },
      // null-island → rejected
      { node: { __typename: 'EventType', id: 'evt_bad', locationCoordinates: { type: 'Point', coordinates: [0, 0] }, previewUrl: 'x' } },
      // not an EventType → skipped
      { node: { __typename: 'FileType', id: 'file_1' } },
      // located video → kept
      {
        node: {
          __typename: 'EventType',
          id: 'evt_vid',
          startTime: '2026-05-09T10:00:00Z',
          locationCoordinates: { type: 'Point', coordinates: [-9.13, 38.71] },
          previewUrl: '/c/v_thumb.jpg',
          mediaUrl: '/c/v.mp4',
          mediaContentType: 'video/mp4',
        },
      },
    ],
  },
};

describe('mediaItemsFromMemory', () => {
  it('maps located events, drops the rest, and absolutizes relative presigned URLs', () => {
    const items = mediaItemsFromMemory(sampleResult, { origin: 'https://ci-server.localhost' });
    expect(items.length).toBe(2);

    const photo = items[0]!;
    expect(photo.id).toBe('mem:evt_lisbon');
    expect(photo.kind).toBe('image');
    expect(photo.location).toEqual({ lat: 38.7077, lon: -9.1366 });
    expect(photo.uri).toBe('https://ci-server.localhost/companion/x.jpg?sig=1');
    expect(photo.thumbnailUri).toBe('https://ci-server.localhost/companion/x_thumb.jpg?sig=1');
    expect(photo.capturedAt).toBe('2026-05-09T09:14:00Z');
    expect(photo.exif).toEqual({ width: 4032, height: 3024 });

    expect(items[1]!.kind).toBe('video');
  });

  it('leaves URLs relative when no origin is given', () => {
    const [photo] = mediaItemsFromMemory(sampleResult);
    expect(photo!.uri).toBe('/companion/x.jpg?sig=1');
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

describe('createEventInputFromStory (write-back)', () => {
  it('builds an idempotent createEvent input anchored at the first located entity', () => {
    const input = createEventInputFromStory(loadStory(atlas), { shareUrl: 'https://atlas/?story=x' });
    expect(input.eventType).toBe('atlas-story');
    expect(input.sourceSystem).toBe('companion-atlas');
    expect(input.sourceId).toBe('story-pacific-journey');
    expect(input.startTime).toBe('2026-03-14T08:00:00Z');
    expect(input.endTime).toBe('2026-03-14T09:10:00Z');
    // access.visibility 'unlisted' → CI-Server 'household'
    expect(input.sharingLevel).toBe('household');
    // GeoJSON [lng, lat] of the first media (Reykjavik)
    expect(input.locationCoordinates).toEqual({ type: 'Point', coordinates: [-21.9426, 64.1466] });
    expect(input.metadata!.shareUrl).toBe('https://atlas/?story=x');
  });
});
