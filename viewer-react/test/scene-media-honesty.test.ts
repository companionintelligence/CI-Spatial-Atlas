/**
 * Two defects an adversarial review found in the first cut of scene media, and
 * one thing it correctly upheld. Both defects were the same failure in
 * different clothes: a control that says one thing while the document holds
 * another.
 *
 * 1. The narration field validated per keystroke and *returned early* on a
 *    refused URL rather than clearing. Since a schemeless fragment reads as a
 *    relative path, every accepted prefix of a rejected URL was written first —
 *    typing `data:audio/mpeg;base64,…` left `audioUrl: "data"` on the scene,
 *    rendered a player and a Clear button beside the rejection warning, and
 *    exported that string. Pasting had the mirror problem: no intermediates
 *    fire, so the previous good URL stayed attached and kept playing while the
 *    field showed refused text.
 *
 * 2. The empty picker blamed internal `ci-memory://` addresses for every entry
 *    it could not use, including a video whose only URL was a perfectly
 *    fetchable https link and had merely no poster frame. That sends an author
 *    hunting a pipeline bug that does not exist — the same class of misleading
 *    explanation this whole feature exists to avoid.
 */
import { describe, expect, it } from 'vitest';
import { sceneMediaPool, sceneMediaEmptyMessage } from '../src/scenes/sceneMedia.js';
import type { Story } from '@companion-atlas/story';

const story = (parts: Partial<Story>): Story =>
  ({ schema: 'companion.atlas/story@1', id: 's', title: 'S', scenes: [], ...parts }) as unknown as Story;

describe('the empty picker explains the real reason', () => {
  it('blames internal addresses only when a URL actually carried one', () => {
    const s = story({
      items: [{ id: 'p1', type: 'photo', position: { lat: 1, lon: 2 }, media: { url: 'ci-memory://abc/photo.jpg' } }],
    } as Partial<Story>);
    const pool = sceneMediaPool(s);
    expect(pool.candidates).toHaveLength(0);
    expect(pool.atInternalAddresses).toBe(1);
    expect(pool.withoutAStill).toBe(0);
    expect(sceneMediaEmptyMessage(pool)).toContain('ci-memory');
  });

  it('does NOT blame addresses for a posterless video on a fetchable URL', () => {
    // The defect: this used to produce "their media sits at internal
    // addresses", which is simply untrue of https://cdn.example.com/clip.mp4.
    const s = story({
      items: [{ id: 'v1', type: 'video', position: { lat: 1, lon: 2 }, media: { url: 'https://cdn.example.com/clip.mp4' } }],
    } as Partial<Story>);
    const pool = sceneMediaPool(s);
    expect(pool.candidates).toHaveLength(0);
    expect(pool.atInternalAddresses).toBe(0);
    expect(pool.withoutAStill).toBe(1);
    const msg = sceneMediaEmptyMessage(pool);
    expect(msg).not.toContain('ci-memory');
    expect(msg).toMatch(/poster frame|still image/i);
  });

  it('says both when a story has both problems', () => {
    const s = story({
      items: [
        { id: 'p1', type: 'photo', position: { lat: 1, lon: 2 }, media: { url: 'ci-memory://abc/p.jpg' } },
        { id: 'v1', type: 'video', position: { lat: 1, lon: 2 }, media: { url: 'https://cdn.example.com/clip.mp4' } },
      ],
    } as Partial<Story>);
    const pool = sceneMediaPool(s);
    expect(pool.unreachable).toBe(2);
    expect(pool.atInternalAddresses).toBe(1);
    expect(pool.withoutAStill).toBe(1);
    expect(sceneMediaEmptyMessage(pool)).toMatch(/1 other|no still/i);
  });

  it('still says "nothing to attach" for a story with no pictures at all', () => {
    const pool = sceneMediaPool(story({ items: [{ id: 'm1', type: 'marker', position: { lat: 1, lon: 2 } }] } as Partial<Story>));
    expect(pool.unreachable).toBe(0);
    expect(sceneMediaEmptyMessage(pool)).toMatch(/no photos or videos/i);
  });

  it('a resolvable photo is offered rather than counted as a problem', () => {
    const s = story({
      items: [{ id: 'p1', type: 'photo', position: { lat: 1, lon: 2 }, media: { url: 'https://cdn.example.com/p.jpg' } }],
    } as Partial<Story>);
    const pool = sceneMediaPool(s);
    expect(pool.candidates.map((c) => c.id)).toEqual(['p1']);
    expect(pool.unreachable).toBe(0);
  });
});
