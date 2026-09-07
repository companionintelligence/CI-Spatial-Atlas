/**
 * Which story entities the scene editor may offer as a slide background, and
 * whether a narration URL will ever be heard.
 *
 * Both are rules that fail *invisibly*, which is why they are tested rather
 * than looked at. A picker that offers an id `sceneBackground` will not resolve
 * produces a tile the author clicks and a slide that does not change; a
 * narration field that accepts `ci-memory://…` produces a scene which claims to
 * be narrated and plays silence. Neither shows up in a screenshot, and neither
 * throws.
 *
 * The load-bearing assertions below are the ones that compare this module to
 * `sceneBackground` itself rather than to a hand-written expectation: the whole
 * design rests on the picker mirroring the presenter, so the mirror is what
 * gets checked.
 */
import { describe, expect, it } from 'vitest';
import { STORY_SCHEMA_ID, type Item, type MediaItem, type Scene, type Story } from '@companion-atlas/story';
import { sceneBackground } from '../src/ui/sceneDeck.js';
import { patchScene } from '../src/scenes/model.js';
import {
  AUDIO_URL_REJECTED,
  AUDIO_URL_RELATIVE,
  backgroundCandidate,
  checkAudioUrl,
  playableAudioUrl,
  sceneAttachedIds,
  sceneMediaCandidates,
  sceneMediaEmptyMessage,
  sceneMediaPool,
  toggleAttachment,
  unresolvedAttachedIds,
} from '../src/scenes/sceneMedia.js';

const story = (parts: Partial<Story>): Story =>
  ({ schema: STORY_SCHEMA_ID, id: 'story-1', title: 'A story', scenes: [], ...parts }) as Story;

const photo = (id: string, media: Record<string, string>, extra: Record<string, unknown> = {}): Item =>
  ({ id, type: 'photo', position: { lat: 64.14, lon: -21.94 }, media, ...extra }) as Item;

const video = (id: string, media: Record<string, string>): Item =>
  ({ id, type: 'video', position: { lat: 64.14, lon: -21.94 }, media }) as Item;

const mediaItem = (id: string, kind: MediaItem['kind'], parts: Partial<MediaItem> = {}): MediaItem =>
  ({ id, kind, uri: `https://cdn.example.com/${id}.bin`, ...parts }) as MediaItem;

const attach = (ids: string[]): Scene => ({ id: 'scene-1', itemIds: ids });

describe('the candidate pool', () => {
  it('offers exactly what the presenter will resolve, and resolves it to the same URL', () => {
    // The one assertion the whole feature rests on. Every other rule below is a
    // consequence of this: if a tile and the slide could disagree, the picker
    // would be a control that sometimes silently does nothing.
    const s = story({
      items: [
        photo('p1', { url: 'https://cdn.example.com/harbour.jpg' }),
        video('v1', { url: 'https://cdn.example.com/clip.mp4', posterUrl: 'https://cdn.example.com/clip.jpg' }),
      ],
      media: [mediaItem('m1', 'image', { uri: 'https://cdn.example.com/reykjavik.jpg' })],
    });
    const candidates = sceneMediaCandidates(s);
    expect(candidates.map((c) => c.id)).toEqual(['p1', 'v1', 'm1']);
    for (const c of candidates) {
      expect(sceneBackground(s, attach([c.id]))).toBe(c.backgroundUrl);
    }
  });

  it('offers a video by its poster and never by its own URL', () => {
    // An <img> cannot show an .mp4: offering it would paint a broken-image
    // glyph across a full-screen slide. `sceneBackground` skips it, so this
    // must too.
    const s = story({
      items: [video('v1', { url: 'https://cdn.example.com/clip.mp4', posterUrl: 'https://cdn.example.com/clip.jpg' })],
    });
    const [c] = sceneMediaCandidates(s);
    expect(c!.backgroundUrl).toBe('https://cdn.example.com/clip.jpg');
    expect(c!.isPoster).toBe(true);
    expect(sceneBackground(s, attach(['v1']))).toBe(c!.backgroundUrl);
  });

  it('does not offer a video with nothing but its own URL', () => {
    const s = story({ items: [video('v1', { url: 'https://cdn.example.com/clip.mp4' })] });
    expect(sceneMediaCandidates(s)).toEqual([]);
    expect(sceneBackground(s, attach(['v1']))).toBeUndefined();
  });

  it('falls through a photo’s unfetchable original to its thumbnail', () => {
    // The Companion Memory shape: the original lives at an internal address the
    // pipeline resolves, and only the derived thumbnail is on the web.
    const s = story({
      items: [photo('p1', { url: 'ci-memory://demo/reykjavik.jpg', thumbnailUrl: 'https://cdn.example.com/t.jpg' })],
    });
    const [c] = sceneMediaCandidates(s);
    expect(c!.backgroundUrl).toBe('https://cdn.example.com/t.jpg');
    expect(sceneBackground(s, attach(['p1']))).toBe(c!.backgroundUrl);
  });

  it('drops an entry a browser cannot fetch, and counts it so the empty picker can explain itself', () => {
    const s = story({
      items: [photo('p1', { url: 'ci-memory://demo/reykjavik.jpg' })],
      media: [mediaItem('m1', 'image', { uri: 'ci-memory://demo/accra.jpg' })],
    });
    const pool = sceneMediaPool(s);
    expect(pool.candidates).toEqual([]);
    expect(pool.unreachable).toBe(2);
    expect(sceneMediaEmptyMessage(pool)).toContain('ci-memory://');
  });

  it('says something different when the story simply has no pictures', () => {
    // A KML import: places, no media. "None of them can be shown" would be a
    // lie, and would send the author looking for a bug.
    const pool = sceneMediaPool(story({ items: [{ id: 'mk', type: 'marker', position: { lat: 0, lon: 0 } } as Item] }));
    expect(pool.unreachable).toBe(0);
    expect(sceneMediaEmptyMessage(pool)).toContain('no photos or videos');
  });

  it('does not count an audio track without artwork as a picture that failed', () => {
    const pool = sceneMediaPool(story({ media: [mediaItem('a1', 'audio')] }));
    expect(pool.candidates).toEqual([]);
    expect(pool.unreachable).toBe(0);
  });

  it('reads a media entry’s video/audio thumbnail only, never its uri', () => {
    const s = story({
      media: [
        mediaItem('mv', 'video', { uri: 'https://cdn.example.com/clip.mp4', thumbnailUri: 'https://cdn.example.com/clip.jpg' }),
        mediaItem('ma', 'audio', { uri: 'https://cdn.example.com/song.mp3' }),
      ],
    });
    const candidates = sceneMediaCandidates(s);
    expect(candidates.map((c) => c.id)).toEqual(['mv']);
    expect(candidates[0]!.backgroundUrl).toBe('https://cdn.example.com/clip.jpg');
    expect(sceneBackground(s, attach(['ma']))).toBeUndefined();
  });

  it('offers the same photo once when it is in both of the story’s entity arrays', () => {
    // A Companion Memory import writes the `media` entry; a later Earth-2 pass
    // writes the `items` one. Two identical tiles for one photo is a picker the
    // author cannot trust.
    const s = story({
      items: [photo('same', { url: 'https://cdn.example.com/a.jpg' })],
      media: [mediaItem('same', 'image', { uri: 'https://cdn.example.com/a.jpg' })],
    });
    const candidates = sceneMediaCandidates(s);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.source).toBe('items');
  });

  it('takes the media copy when the items copy of the same id resolves to nothing', () => {
    // `sceneBackground` does not stop at the first *entry* with a matching id,
    // it stops at the first loadable URL — so deduplication has to be by
    // resolved id, not by id seen.
    const s = story({
      items: [photo('same', { url: 'ci-memory://demo/a.jpg' })],
      media: [mediaItem('same', 'image', { uri: 'https://cdn.example.com/a.jpg' })],
    });
    const candidates = sceneMediaCandidates(s);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.source).toBe('media');
    expect(sceneBackground(s, attach(['same']))).toBe(candidates[0]!.backgroundUrl);
  });

  it('sanitises every URL it hands over', () => {
    // A story is untrusted input; these URLs become `src` attributes in the
    // drawer, not only in the presentation.
    const s = story({
      items: [photo('p1', { url: 'javascript:alert(1)', thumbnailUrl: 'https://cdn.example.com/ok.jpg' })],
    });
    const [c] = sceneMediaCandidates(s);
    expect(c!.backgroundUrl).toBe('https://cdn.example.com/ok.jpg');
    expect(c!.thumbUrl).toBe('https://cdn.example.com/ok.jpg');
  });

  it('prefers a small rendition for the tile while keeping the slide’s own URL', () => {
    // Forty full-size originals painted at 64px, over a live globe, is a cost
    // the author would feel while judging the camera.
    const s = story({
      items: [photo('p1', { url: 'https://cdn.example.com/big.jpg', thumbnailUrl: 'https://cdn.example.com/small.jpg' })],
    });
    const [c] = sceneMediaCandidates(s);
    expect(c!.backgroundUrl).toBe('https://cdn.example.com/big.jpg');
    expect(c!.thumbUrl).toBe('https://cdn.example.com/small.jpg');
  });

  it('always has something to call a tile, and dates it in solar time', () => {
    const s = story({
      items: [
        photo('p1', { url: 'https://cdn.example.com/a.jpg' }, { title: 'The harbour', placeName: 'Reykjavik', time: '2024-05-01T00:30:00Z' }),
        photo('p2', { url: 'https://cdn.example.com/b.jpg' }),
      ],
    });
    const [a, b] = sceneMediaCandidates(s);
    expect(a!.label).toBe('The harbour');
    // Solar local at 21.9° W is an hour and a half behind UTC, which is why
    // half past midnight UTC is still the previous day *there* — the same
    // convention the slide's own eyebrow uses, so the two never disagree.
    expect(a!.detail).toBe('Reykjavik · Apr 30, 2024');
    // No title, no place: the id is at least addressable. A blank tile is not.
    expect(b!.label).toBe('p2');
    expect(b!.detail).toBeUndefined();
  });
});

describe('which attached id is on the slide', () => {
  const s = story({
    items: [
      photo('first', { url: 'https://cdn.example.com/first.jpg' }),
      photo('second', { url: 'https://cdn.example.com/second.jpg' }),
    ],
  });

  it('is decided by the story’s order, not the scene’s', () => {
    // The trap this exists to avoid: telling an author that reordering
    // `itemIds` changes the background. `sceneBackground` scans the story and
    // asks which ids are in the set, so it does not.
    const candidates = sceneMediaCandidates(s);
    const ids = ['second', 'first'];
    expect(backgroundCandidate(candidates, ids)!.id).toBe('first');
    expect(sceneBackground(s, attach(ids))).toBe('https://cdn.example.com/first.jpg');
  });

  it('is nothing when the scene attaches nothing resolvable', () => {
    expect(backgroundCandidate(sceneMediaCandidates(s), [])).toBeNull();
    expect(backgroundCandidate(sceneMediaCandidates(s), ['ghost'])).toBeNull();
  });

  it('names the attached ids no tile can show', () => {
    // `sceneFromMemory` seeds a scene with the memory's id whether or not it
    // has a picture, so this is the common case rather than a corrupt document.
    expect(unresolvedAttachedIds(sceneMediaCandidates(s), ['first', 'ghost'])).toEqual(['ghost']);
  });
});

describe('changing the attachment', () => {
  it('appends and removes without re-ordering the author’s list', () => {
    expect(toggleAttachment(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleAttachment(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    // Ids with no tile are part of the list and are not silently dropped.
    expect(toggleAttachment(['ghost'], 'a')).toEqual(['ghost', 'a']);
  });

  it('reads a scene’s attachment in whichever spelling it arrived', () => {
    // A scene adopted from an Earth-2 or memory-derived document carries the
    // legacy list; a picker reading only `itemIds` would show nothing attached
    // beside a slide with a photo on it.
    expect(sceneAttachedIds({ id: 's', itemIds: ['a'] })).toEqual(['a']);
    expect(sceneAttachedIds({ id: 's', items: ['b'] } as Scene)).toEqual(['b']);
    expect(sceneAttachedIds({ id: 's', mediaIds: ['c'] } as Scene)).toEqual(['c']);
    expect(sceneAttachedIds(null)).toEqual([]);
  });

  it('clears back to nothing, including the legacy lists underneath', () => {
    // The bug this pins: `sceneHighlightIds` falls through `itemIds` → `items`
    // → `mediaIds`, so removing only `itemIds` uncovers a legacy list and the
    // background the author just detached comes straight back.
    const legacy = { id: 's', mediaIds: ['m1'] } as Scene;
    const cleared = patchScene(legacy, { itemIds: null });
    expect(sceneAttachedIds(cleared)).toEqual([]);
    expect(sceneBackground(
      story({ media: [mediaItem('m1', 'image', { uri: 'https://cdn.example.com/a.jpg' })] }),
      cleared,
    )).toBeUndefined();
  });
});

describe('the narration URL', () => {
  it('accepts what the presenter will play', () => {
    expect(checkAudioUrl('https://cdn.example.com/narration.mp3'))
      .toEqual({ state: 'ok', url: 'https://cdn.example.com/narration.mp3' });
  });

  it('refuses what the presenter would silently drop', () => {
    // Each of these makes `safeMediaUrl` return null, so `buildDeck` stores
    // `undefined` and the scene plays nothing with nothing logged.
    for (const bad of [
      'ci-memory://demo/track.mp3',
      'data:audio/mpeg;base64,AAAA',
      'file:///Users/me/track.mp3',
      'javascript:alert(1)',
      // Live payload: browsers drop the tab while resolving the URL, so a naive
      // scheme test passes it. The sanitiser strips first, and this check is
      // the sanitiser.
      'java\tscript:alert(1)',
    ]) {
      expect(checkAudioUrl(bad)).toEqual({ state: 'rejected', reason: AUDIO_URL_REJECTED });
      expect(playableAudioUrl(bad)).toBeNull();
    }
    expect(AUDIO_URL_REJECTED).toContain('http');
  });

  it('accepts a root-relative link outright — bundled stories use them', () => {
    // `/stories/…` is how a story shipped with the app addresses its own
    // assets, and `isLoadableMedia` already treats it as fetchable. Refusing it
    // would break a working case.
    expect(checkAudioUrl('/stories/demo/narration.mp3'))
      .toEqual({ state: 'ok', url: '/stories/demo/narration.mp3' });
  });

  it('accepts a document-relative link but warns where it will and will not play', () => {
    // The presenter does play it — `safeMediaUrl` allows a schemeless URL — so
    // refusing it would be a lie. But it resolves against whatever page the
    // story is opened from, so it is silence for everyone the story is shared
    // with, and that has to be said at entry rather than discovered.
    expect(checkAudioUrl('narration.mp3'))
      .toEqual({ state: 'relative', url: 'narration.mp3', note: AUDIO_URL_RELATIVE });
    expect(playableAudioUrl('narration.mp3')).toBe('narration.mp3');
  });

  it('treats an emptied field as a clear rather than as an error', () => {
    expect(checkAudioUrl('')).toEqual({ state: 'empty' });
    expect(checkAudioUrl('   ')).toEqual({ state: 'empty' });
    expect(checkAudioUrl(null)).toEqual({ state: 'empty' });
    expect(checkAudioUrl(undefined)).toEqual({ state: 'empty' });
  });
});
