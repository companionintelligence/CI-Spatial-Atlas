/**
 * Persistence for the authored deck.
 *
 * The interesting cases are all the ones where the stored value is *not* what
 * this version of the app wrote: a hand-edited key, a write truncated by a
 * quota error, an older envelope. `authoring/persist.ts` sets the precedent —
 * tolerate the input, never throw at mount — and the reason is blunt: a parse
 * error during hydration is a white screen, while a dropped scene is a scene
 * the author writes again.
 *
 * The one rule that is specific to scenes: **nothing crosses a scope**.
 * Narration is content, not a list of sources, and a shared browser must never
 * show one person's half-written story to the next.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Scene } from '@companion-atlas/story';
import {
  clearScenes,
  coerceScenes,
  keyFor,
  readScenes,
  writeScenes,
  type SceneStorage,
} from '../src/scenes/persist.js';

/** A localStorage stand-in: the suite runs in Node, where there isn't one. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  } satisfies SceneStorage & { map: Map<string, string> };
}

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({ id, title: id, ...over });
const ids = (scenes: readonly Scene[]): string[] => scenes.map((s) => s.id);

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => { storage = fakeStorage(); });

describe('round trip', () => {
  it('writes and reads back an identical deck, in order', () => {
    const deck = [
      scene('a', { narrative: '# Arrival', layout: 'fullscreen', time: '2024-01-02T03:04:05Z' }),
      scene('b', { camera: { lon: -21.9, lat: 64.1, height: 900, heading: 12, pitch: -35 } }),
      scene('c', { itemIds: ['mem-1', 'mem-2'], audioUrl: 'https://example.test/a.mp3' }),
    ];
    writeScenes('acct-1', { scenes: deck, adoptedFrom: 'story-9' }, storage);
    const back = readScenes('acct-1', storage);
    expect(back.scenes).toEqual(deck);
    expect(back.adoptedFrom).toBe('story-9');
  });

  it('preserves an order that is not chronological', () => {
    // The flashback again: a reader that sorted on the way back in would rewrite
    // the author's story and look like it had done nothing.
    const deck = [
      scene('end', { time: '2024-06-01T00:00:00Z' }),
      scene('flashback', { time: '2018-01-01T00:00:00Z' }),
    ];
    writeScenes(null, { scenes: deck }, storage);
    expect(ids(readScenes(null, storage).scenes)).toEqual(['end', 'flashback']);
  });

  it('writes an emptied deck rather than removing the key', () => {
    // Deleting the last scene is a deliberate act. A `removeItem` would leave it
    // indistinguishable from "nothing stored yet" and the deck would come back.
    writeScenes('acct-1', { scenes: [scene('a')] }, storage);
    writeScenes('acct-1', { scenes: [] }, storage);
    expect(storage.map.has(keyFor('acct-1'))).toBe(true);
    expect(readScenes('acct-1', storage).scenes).toEqual([]);
  });
});

describe('scoping', () => {
  it('keys the anonymous bucket apart from an account', () => {
    expect(keyFor(null)).toBe('atlas.scenes.v1');
    expect(keyFor('https://memory.example')).toBe('atlas.scenes.v1:https://memory.example');
  });

  it('never inherits the signed-out deck into an account', () => {
    // `layers/store.ts` deliberately does inherit, because a layer stack is a
    // list of *sources*. Narration is content: inheriting it would fold one
    // person's writing into whoever's Companion Memory is connected next.
    writeScenes(null, { scenes: [scene('anon')] }, storage);
    expect(readScenes('acct-1', storage).scenes).toEqual([]);
  });

  it('keeps two accounts on one browser apart', () => {
    writeScenes('a', { scenes: [scene('mine')] }, storage);
    writeScenes('b', { scenes: [scene('theirs')] }, storage);
    expect(ids(readScenes('a', storage).scenes)).toEqual(['mine']);
    expect(ids(readScenes('b', storage).scenes)).toEqual(['theirs']);
  });
});

describe('tolerating what is there', () => {
  it('reads a bare array left by an earlier draft or a hand edit', () => {
    storage.map.set(keyFor(null), JSON.stringify([{ id: 'a' }, { id: 'b' }]));
    expect(ids(readScenes(null, storage).scenes)).toEqual(['a', 'b']);
  });

  it('returns an empty deck for invalid JSON rather than throwing', () => {
    storage.map.set(keyFor(null), '{"v":1,"scenes":[{"id":"a"');
    expect(readScenes(null, storage)).toEqual({ scenes: [], adoptedFrom: null });
  });

  it('drops the entries that would fail Story.parse and keeps the rest', () => {
    storage.map.set(keyFor(null), JSON.stringify({
      v: 1,
      scenes: [
        { id: 'good' },
        { id: 'no-time', time: 'last Tuesday' },
        'not an object',
        { title: 'no id' },
        { id: 'also-good', layout: 'split' },
      ],
    }));
    expect(ids(readScenes(null, storage).scenes)).toEqual(['good', 'also-good']);
  });

  it('strips keys the schema does not know', () => {
    // Otherwise a hand edit or an older build travels straight into an export.
    storage.map.set(keyFor(null), JSON.stringify({ v: 1, scenes: [{ id: 'a', bogus: 1 }] }));
    expect(readScenes(null, storage).scenes[0]).toEqual({ id: 'a' });
  });

  it('drops a duplicate id, first occurrence winning', () => {
    // Two scenes with one id give two rows the same React key and make
    // `indexOfScene` resume a presentation on the wrong slide.
    expect(ids(coerceScenes([{ id: 'a', title: 'first' }, { id: 'a', title: 'second' }]))).toEqual(['a']);
    expect(coerceScenes([{ id: 'a', title: 'first' }, { id: 'a', title: 'second' }])[0].title).toBe('first');
  });

  it('discards a stale adoption claim when nothing survived', () => {
    // An `adoptedFrom` with no scenes left tells the export merge that every
    // scene of the re-opened document was deleted — the document would come
    // back empty.
    storage.map.set(keyFor(null), JSON.stringify({ v: 1, scenes: [], adoptedFrom: 'story-9' }));
    expect(readScenes(null, storage).adoptedFrom).toBeNull();
  });

  it('ignores a non-string adoption claim', () => {
    storage.map.set(keyFor(null), JSON.stringify({ v: 1, scenes: [{ id: 'a' }], adoptedFrom: 7 }));
    expect(readScenes(null, storage).adoptedFrom).toBeNull();
  });
});

describe('a storage that fights back', () => {
  it('survives a private window that throws on every access', () => {
    const hostile: SceneStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    expect(readScenes('a', hostile)).toEqual({ scenes: [], adoptedFrom: null });
    expect(() => writeScenes('a', { scenes: [scene('x')] }, hostile)).not.toThrow();
    expect(() => clearScenes('a', hostile)).not.toThrow();
  });

  it('survives a full quota without taking the editor down', () => {
    const full = { ...fakeStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => writeScenes('a', { scenes: [scene('x')] }, full)).not.toThrow();
  });

  it('does nothing at all when there is no storage (SSR, a worker)', () => {
    expect(readScenes('a', null)).toEqual({ scenes: [], adoptedFrom: null });
    expect(() => writeScenes('a', { scenes: [] }, null)).not.toThrow();
    expect(() => clearScenes('a', null)).not.toThrow();
  });
});

describe('clearScenes', () => {
  it('forgets one scope and leaves the others', () => {
    writeScenes('a', { scenes: [scene('x')] }, storage);
    writeScenes('b', { scenes: [scene('y')] }, storage);
    clearScenes('a', storage);
    expect(readScenes('a', storage).scenes).toEqual([]);
    expect(ids(readScenes('b', storage).scenes)).toEqual(['y']);
  });
});
