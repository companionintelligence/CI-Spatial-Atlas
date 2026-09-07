/**
 * What an uploaded photo becomes.
 *
 * `src/upload/` was written, tested and imported by nothing — its own header
 * said so — so the failure this pins is not in the transfer, which has its own
 * suite. It is in the step after: an upload that produced a URL and stopped
 * there would be invisible to everything that makes Atlas Atlas. Media has to
 * arrive as a canonical `Item` or it cannot be drawn on the globe, cannot be
 * offered by the scene editor's media pool, and cannot leave through KML or
 * story JSON — the same reason `importFile.ts` refuses to build Cesium
 * primitives.
 *
 * And an item needs somewhere to be. There is no way to say "a picture,
 * nowhere" in KML, and defaulting to 0,0 would drop it in the Gulf of Guinea
 * and look like a bug in the uploader. So a positionless upload yields no item
 * and the section says why, rather than inventing coordinates.
 */
import { describe, expect, it } from 'vitest';
import { itemFromUpload } from '../src/interop/MediaUploadSection.js';
import type { UploadedMedia } from '../src/upload/index.js';

const PHOTO: UploadedMedia = {
  url: 'https://atlas.example/media/u/2026/abc123.jpg',
  key: 'u/2026/abc123.jpg',
  contentType: 'image/jpeg',
  kind: 'image',
  bytes: 240_000,
};
const VIDEO: UploadedMedia = { ...PHOTO, key: 'u/2026/clip.mp4', contentType: 'video/mp4', kind: 'video' };
const AT = { lat: 64.15, lon: -21.93 };

describe('an upload becomes a story item', () => {
  it('is a photo item at the given position', () => {
    const item = itemFromUpload(PHOTO, 'harbour.jpg', AT);
    expect(item).toMatchObject({
      type: 'photo',
      title: 'harbour.jpg',
      position: { lat: 64.15, lon: -21.93 },
      media: { url: PHOTO.url },
    });
  });

  it('is a video item when the server said video', () => {
    expect(itemFromUpload(VIDEO, 'clip.mp4', AT)).toMatchObject({ type: 'video' });
  });

  it('carries an id derived from the stored key, so two uploads never collide', () => {
    const a = itemFromUpload(PHOTO, 'a.jpg', AT)!;
    const b = itemFromUpload({ ...PHOTO, key: 'u/2026/other.jpg' }, 'a.jpg', AT)!;
    expect(a.id).not.toEqual(b.id);
  });

  it('keeps that id NCName-safe, because it goes back out through KML', () => {
    // `storyToKml` writes ids into `xsd:ID`, which rejects slashes and colons.
    const item = itemFromUpload({ ...PHOTO, key: 'u/2026/06 18/a b.jpg' }, 'a b.jpg', AT)!;
    expect(item.id).toMatch(/^[A-Za-z_][A-Za-z0-9._-]*$/);
  });
});

describe('an upload with nowhere to go', () => {
  it('yields no item rather than a pin at 0,0', () => {
    expect(itemFromUpload(PHOTO, 'harbour.jpg', null)).toBeNull();
    expect(itemFromUpload(PHOTO, 'harbour.jpg', undefined)).toBeNull();
  });
});
