/**
 * Presenting a deck that is being written *while it is being presented*.
 *
 * Two things changed under the presenter when scene authoring arrived, and each
 * of them is invisible until it has already ruined somebody's afternoon.
 *
 * **Scenes now come from three places.** The deck the user is authoring, the
 * scenes the open document arrived with, and the memories the app projects when
 * it has neither. They cannot simply be concatenated (a deck adopted from a
 * `?story=` document holds that document's own scenes, so appending shows every
 * scene twice) and the authored deck cannot be merged into the story either —
 * `deriveModel` reads `story.scenes` first, so an authored scene reaching the
 * rendered story collapses a 500-memory globe to one pin per scene. Hence
 * `buildDeck`'s third source, and hence the precedence asserted here.
 *
 * **The deck can now change while it is on screen.** Every index the presenter
 * held was previously a stable address; a reorder or a delete turns it into a
 * pointer at the wrong scene. `followSceneIndex` and `slideEnterKey` are the
 * two rules that keep a live presentation pointed at the scene the reader is
 * actually reading, and both are pure precisely so the failures they prevent —
 * a presentation jumping slides, a narration restarting from the top — can be
 * argued about here rather than found by hand in a browser.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Story } from '@companion-atlas/story';
import {
  buildDeck,
  DEFAULT_LAYOUT,
  deckCursor,
  deckScenes,
  deckSignature,
  followSceneIndex,
  reconcileCursor,
  sameCursor,
  slideEnterKey,
  type DeckMemory,
  type DeckSlide,
} from '../src/ui/sceneDeck.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const scene = (id: string, extra: Partial<Scene> = {}): Scene =>
  ({ id, title: id, ...extra }) as Scene;

/** A Companion Memory archive: located media, no authored narrative. */
const memoryStory = (): Story =>
  ({
    schema: 'companion.atlas/story@1',
    id: 'companion-memory',
    title: 'Companion Memory',
    scenes: [],
    media: [
      { id: 'media-harbour', kind: 'image', uri: 'https://cdn.example/harbour.jpg' },
    ],
  }) as unknown as Story;

/** A `?story=` document somebody else wrote, opened for editing. */
const documentStory = (): Story =>
  ({
    schema: 'companion.atlas/story@1',
    id: 'story-pacific',
    title: 'Pacific Crossing',
    scenes: [
      scene('doc-1', { title: 'Leaving', time: '2026-03-14T08:00:00Z' }),
      scene('doc-2', { title: 'Arriving', time: '2026-03-14T09:00:00Z' }),
    ],
  }) as unknown as Story;

const MEMORIES: DeckMemory[] = [
  { id: 'm-a', title: 'Ridge', timeMs: Date.parse('2019-06-17T07:00:00Z'), lat: 64.1, lon: -21.8 },
  { id: 'm-b', title: 'Harbour', timeMs: Date.parse('2019-06-18T19:00:00Z'), lat: 64.15, lon: -21.93 },
];

const titles = (deck: DeckSlide[]) => deck.map((s) => s.title);
const ids = (deck: DeckSlide[]) => deck.map((s) => s.id);

// ---------------------------------------------------------------------------
// Which scenes the deck is built from
// ---------------------------------------------------------------------------

describe('deck source precedence', () => {
  it('presents the authored deck rather than the archive it was written on', () => {
    // The whole point of Present for an author: it shows the work, not the
    // 500 memories the work is about.
    const authored = [scene('atlas-scene-1', { title: 'Chapter one' })];
    const { source } = deckScenes(memoryStory(), { authored, memories: MEMORIES });
    expect(source).toBe('authored');
    expect(titles(buildDeck(memoryStory(), { authored, memories: MEMORIES }))).toEqual(['Chapter one']);
  });

  it('does not append projected memories behind an authored scene', () => {
    const deck = buildDeck(memoryStory(), {
      authored: [scene('atlas-scene-1')],
      memories: MEMORIES,
    });
    expect(deck).toHaveLength(1);
    expect(ids(deck)).not.toContain('m-a');
  });

  it('replaces the document’s scenes rather than presenting both copies', () => {
    // A deck adopted from this document holds its scenes by their own ids, with
    // the user's edits applied. Concatenating would present every scene twice —
    // once as written, once as edited — which is how a merge bug looks from the
    // reader's chair.
    const authored = [
      scene('doc-2', { title: 'Arriving (rewritten)' }),
      scene('doc-1', { title: 'Leaving (rewritten)' }),
    ];
    const deck = buildDeck(documentStory(), { authored });
    expect(ids(deck)).toEqual(['doc-2', 'doc-1']);
    expect(titles(deck)).toEqual(['Arriving (rewritten)', 'Leaving (rewritten)']);
  });

  it('falls back to the document’s own scenes for a reader who is not authoring', () => {
    for (const authored of [undefined, null, [] as Scene[]]) {
      const { source } = deckScenes(documentStory(), { authored, memories: MEMORIES });
      expect(source).toBe('story');
      expect(ids(buildDeck(documentStory(), { authored, memories: MEMORIES }))).toEqual(['doc-1', 'doc-2']);
    }
  });

  it('falls back to projected memories only when neither source has a scene', () => {
    const { source } = deckScenes(memoryStory(), { authored: [], memories: MEMORIES });
    expect(source).toBe('memories');
    expect(ids(buildDeck(memoryStory(), { memories: MEMORIES }))).toEqual(['m-a', 'm-b']);
  });

  it('survives a story whose scenes array never made it through normalisation', () => {
    // `?story=<url>` documents reach the viewer down paths that normalise
    // rather than parse, so an absent array is reachable and must not throw
    // inside a render.
    const loose = { schema: 'companion.atlas/story@1', id: 'x', title: 'x' } as unknown as Story;
    expect(() => buildDeck(loose)).not.toThrow();
    expect(deckScenes(loose, { memories: MEMORIES }).source).toBe('memories');
    expect(deckScenes(loose, { authored: [scene('a')] }).source).toBe('authored');
  });
});

// ---------------------------------------------------------------------------
// Authored scenes get the same slide treatment as a document's
// ---------------------------------------------------------------------------

describe('slides built from an authored deck', () => {
  it('keeps the author’s order even when it runs backwards in time', () => {
    // A deck that re-sorted by time would turn a flashback into a prologue and
    // look entirely normal doing it.
    const authored = [
      scene('atlas-scene-2', { title: 'The ending', time: '2026-05-01T00:00:00Z' }),
      scene('atlas-scene-1', { title: 'Six years earlier', time: '2020-05-01T00:00:00Z' }),
    ];
    expect(titles(buildDeck(memoryStory(), { authored }))).toEqual(['The ending', 'Six years earlier']);
  });

  it('gives a scene with no layout the same default a document’s scene gets', () => {
    const deck = buildDeck(memoryStory(), { authored: [scene('atlas-scene-1')] });
    expect(deck[0]!.layout).toBe(DEFAULT_LAYOUT);
  });

  it('parses the authored body as Markdown and titles an untitled scene by position', () => {
    const authored = [scene('atlas-scene-1', { title: '  ', narrative: '## Reykjavík\n\nThe light went orange.' })];
    const slide = buildDeck(memoryStory(), { authored })[0]!;
    expect(slide.title).toBe('Scene 1');
    expect(slide.summary).toContain('light went orange');
    expect(slide.body.length).toBeGreaterThan(0);
  });

  it('honours reduced motion for an authored transition, like any other', () => {
    const authored = [scene('atlas-scene-1', { transition: { kind: 'fly', durationMs: 4000 } } as Partial<Scene>)];
    expect(buildDeck(memoryStory(), { authored })[0]!.transition).toEqual({ kind: 'fly', durationMs: 4000 });
    expect(buildDeck(memoryStory(), { authored, reduceMotion: true })[0]!.transition)
      .toEqual({ kind: 'cut', durationMs: 0 });
  });

  it('resolves a background from the story the scene was authored on', () => {
    // The authored deck carries ids; the media they refer to lives in the story
    // the author is looking at, which is why the story is still an argument.
    const authored = [scene('atlas-scene-1', { mediaIds: ['media-harbour'] } as Partial<Scene>)];
    expect(buildDeck(memoryStory(), { authored })[0]!.backgroundUrl).toBe('https://cdn.example/harbour.jpg');
  });

  it('numbers and tints slides by position, so a reorder renumbers them', () => {
    const authored = [scene('atlas-scene-1'), scene('atlas-scene-2')];
    const deck = buildDeck(memoryStory(), { authored });
    expect(deck.map((s) => s.index)).toEqual([0, 1]);
    const moved = buildDeck(memoryStory(), { authored: [authored[1]!, authored[0]!] });
    expect(moved.map((s) => s.id)).toEqual(['atlas-scene-2', 'atlas-scene-1']);
    expect(moved.map((s) => s.index)).toEqual([0, 1]);
    expect(moved[0]!.tintClass).toBe(deck[0]!.tintClass);
  });
});

// ---------------------------------------------------------------------------
// The deck changing under a live presentation
// ---------------------------------------------------------------------------

describe('followSceneIndex', () => {
  const deckOf = (...sceneIds: string[]) =>
    buildDeck(memoryStory(), { authored: sceneIds.map((id) => scene(id)) });

  it('follows the scene the reader is on when it is dragged elsewhere', () => {
    // The failure this prevents: the author drags scene 3 to the top, and the
    // reader — still "on index 2" — is silently looking at a different scene
    // while the globe flies somewhere they never asked to go.
    const after = deckOf('c', 'a', 'b');
    expect(followSceneIndex(after, 'c', 2)).toBe(0);
  });

  it('follows the current scene when another is inserted in front of it', () => {
    expect(followSceneIndex(deckOf('new', 'a', 'b'), 'b', 1)).toBe(2);
  });

  it('stays put when the current scene is deleted, so the deck closes over the gap', () => {
    // Position, not identity, is the fallback: the neighbour that took the slot
    // is the next thing to read. Snapping to scene 1 would restart a
    // presentation because somebody deleted a scene near the end of it.
    expect(followSceneIndex(deckOf('a', 'c'), 'b', 1)).toBe(1);
  });

  it('clamps when the deleted scene was the last one', () => {
    expect(followSceneIndex(deckOf('a', 'b'), 'c', 2)).toBe(1);
  });

  it('answers 0 for a deck that has been emptied', () => {
    expect(followSceneIndex([], 'a', 3)).toBe(0);
  });

  it('clamps a missing or absent anchor rather than guessing', () => {
    const deck = deckOf('a', 'b', 'c');
    expect(followSceneIndex(deck, null, 1)).toBe(1);
    expect(followSceneIndex(deck, undefined, 99)).toBe(2);
    expect(followSceneIndex(deck, 'not-here', -4)).toBe(0);
  });

  it('is a fixed point once the cursor has caught up', () => {
    // The presenter re-runs this during render whenever the deck reference
    // changes; a rule that kept moving would be an infinite render loop.
    const deck = deckOf('a', 'b', 'c');
    const once = followSceneIndex(deck, 'b', 0);
    expect(followSceneIndex(deck, deck[once]!.id, once)).toBe(once);
  });
});

describe('deckSignature', () => {
  const deckFor = (scenes: Scene[]) => buildDeck(memoryStory(), { authored: scenes });

  it('is equal for two rebuilds of the same deck', () => {
    // The reconciliation runs during render, so what it compares is also what
    // it stores. Comparing array identity would make a caller that rebuilds its
    // `authoredScenes` array every render queue a state update from every
    // render — a re-render loop, not a slow component.
    const scenes = [scene('a'), scene('b')];
    expect(deckSignature(deckFor(scenes))).toBe(deckSignature(deckFor([...scenes])));
  });

  it('ignores edits that cannot move the reader', () => {
    const before = deckFor([scene('a', { title: 'Draft' }), scene('b')]);
    const after = deckFor([
      scene('a', { title: 'Reykjavík', narrative: 'rewritten', audioUrl: 'https://cdn.example/a.mp3' } as Partial<Scene>),
      scene('b'),
    ]);
    expect(deckSignature(after)).toBe(deckSignature(before));
  });

  it('changes on a reorder, an insertion and a deletion', () => {
    const base = deckSignature(deckFor([scene('a'), scene('b'), scene('c')]));
    expect(deckSignature(deckFor([scene('c'), scene('a'), scene('b')]))).not.toBe(base);
    expect(deckSignature(deckFor([scene('a'), scene('x'), scene('b'), scene('c')]))).not.toBe(base);
    expect(deckSignature(deckFor([scene('a'), scene('c')]))).not.toBe(base);
    expect(deckSignature([])).not.toBe(base);
  });
});

describe('reconcileCursor', () => {
  const deckOf = (...sceneIds: string[]) =>
    buildDeck(memoryStory(), { authored: sceneIds.map((id) => scene(id)) });

  const base = deckOf('a', 'b', 'c');
  const key = deckSignature;

  it('opens on the scene the reader had selected', () => {
    expect(reconcileCursor({
      deck: base, deckKey: key(base), seenKey: key(base), open: true, wasOpen: false,
      cursor: { index: 0, id: null }, initialSceneId: 'c',
    })).toEqual({ index: 2, id: 'c' });
  });

  it('opens at the top when that scene is not in this deck', () => {
    expect(reconcileCursor({
      deck: base, deckKey: key(base), seenKey: key(base), open: true, wasOpen: false,
      cursor: { index: 2, id: 'c' }, initialSceneId: 'not-in-deck',
    })).toEqual({ index: 0, id: 'a' });
  });

  it('prefers the requested scene over following, when both happen at once', () => {
    // Opening the editor is what builds the deck, so "open" and "the deck
    // changed" routinely land on the same render. Following the cursor left
    // over from the previous presentation would open somewhere nobody asked
    // for.
    const next = deckOf('x', 'a', 'b', 'c');
    expect(reconcileCursor({
      deck: next, deckKey: key(next), seenKey: key(base), open: true, wasOpen: false,
      cursor: { index: 2, id: 'c' }, initialSceneId: 'x',
    })).toEqual({ index: 0, id: 'x' });
  });

  it('leaves the cursor alone when the deck is the same array', () => {
    // The step regression: right after a step the cursor names the scene the
    // reader just left, so a follow on every render would walk them backwards
    // one slide per keypress.
    const cursor = { index: 1, id: 'b' };
    expect(reconcileCursor({
      deck: base, deckKey: key(base), seenKey: key(base), open: true, wasOpen: true, cursor,
    })).toBe(cursor);
  });

  it('follows the scene when the deck was edited under a live presentation', () => {
    const reordered = deckOf('c', 'a', 'b');
    expect(reconcileCursor({
      deck: reordered, deckKey: key(reordered), seenKey: key(base), open: true, wasOpen: true,
      cursor: { index: 2, id: 'c' },
    })).toEqual({ index: 0, id: 'c' });
  });

  it('does not chase the deck while the presentation is closed', () => {
    const cursor = { index: 2, id: 'c' };
    expect(reconcileCursor({
      deck: deckOf('a'), deckKey: key(deckOf('a')), seenKey: key(base), open: false, wasOpen: true, cursor,
    })).toBe(cursor);
    expect(reconcileCursor({
      deck: deckOf('a'), deckKey: key(deckOf('a')), seenKey: key(base), open: false, wasOpen: false, cursor,
    })).toBe(cursor);
  });

  it('settles in one pass, so reconciling during render cannot loop', () => {
    const edited = deckOf('c', 'a');
    const once = reconcileCursor({
      deck: edited, deckKey: key(edited), seenKey: key(base), open: true, wasOpen: true,
      cursor: { index: 2, id: 'c' },
    });
    const twice = reconcileCursor({
      deck: edited, deckKey: key(edited), seenKey: key(edited), open: true, wasOpen: true, cursor: once,
    });
    expect(twice).toEqual(once);
    expect(sameCursor(once, twice)).toBe(true);
  });

  it('reports an emptied deck as a cursor pointing at nothing', () => {
    // Which is what tells the presenter to leave: a deck with no scenes has no
    // slide to render, and staying "open" over nothing is a trap with no exit.
    expect(reconcileCursor({
      deck: [], deckKey: key([]), seenKey: key(base), open: true, wasOpen: true, cursor: { index: 1, id: 'b' },
    })).toEqual({ index: 0, id: null });
    expect(deckCursor([], 3)).toEqual({ index: 0, id: null });
  });
});

// ---------------------------------------------------------------------------
// When a rebuilt deck means the caller has to act
// ---------------------------------------------------------------------------

describe('slideEnterKey', () => {
  const slideFor = (s: Scene, at = 0, deckScenesIn: Scene[] = [s]) =>
    buildDeck(memoryStory(), { authored: deckScenesIn })[at]!;

  const camera = { location: { lat: 64.1, lon: -21.8 }, heading: 10, pitch: -40 };

  it('is unchanged when an identical deck is rebuilt', () => {
    // Every edit anywhere in the deck rebuilds every slide, so slide object
    // identity says nothing. Re-announcing on a rebuild would re-fly the camera
    // and restart the narration for a scene nothing happened to.
    const s = scene('atlas-scene-1', { camera, audioUrl: 'https://cdn.example/a.mp3' } as Partial<Scene>);
    expect(slideEnterKey(slideFor(s))).toBe(slideEnterKey(slideFor(s)));
  });

  it('is unchanged when the scene only moved position', () => {
    const a = scene('atlas-scene-1', { camera } as Partial<Scene>);
    const b = scene('atlas-scene-2');
    expect(slideEnterKey(slideFor(a, 0, [a, b]))).toBe(slideEnterKey(slideFor(a, 1, [b, a])));
  });

  it('is unchanged when only the words changed', () => {
    // Retitling and rewriting update the card, which is rebuilt regardless.
    // They are no reason to move the globe.
    const before = scene('atlas-scene-1', { title: 'Draft', narrative: 'one', camera } as Partial<Scene>);
    const after = scene('atlas-scene-1', { title: 'Reykjavík', narrative: 'two', camera } as Partial<Scene>);
    expect(slideEnterKey(slideFor(after))).toBe(slideEnterKey(slideFor(before)));
  });

  it('changes when the camera is re-captured, which is what moves the globe', () => {
    const before = scene('atlas-scene-1', { camera } as Partial<Scene>);
    const after = scene('atlas-scene-1', {
      camera: { location: { lat: 40.7, lon: -74 }, heading: 10, pitch: -40 },
    } as Partial<Scene>);
    expect(slideEnterKey(slideFor(after))).not.toBe(slideEnterKey(slideFor(before)));
  });

  it('changes when only the heading changed, not just the position', () => {
    const before = scene('atlas-scene-1', { camera } as Partial<Scene>);
    const after = scene('atlas-scene-1', {
      camera: { location: { lat: 64.1, lon: -21.8 }, heading: 275, pitch: -40 },
    } as Partial<Scene>);
    expect(slideEnterKey(slideFor(after))).not.toBe(slideEnterKey(slideFor(before)));
  });

  it('changes when the scene is given a time, so the clock catches up', () => {
    const before = scene('atlas-scene-1', { camera } as Partial<Scene>);
    const after = scene('atlas-scene-1', { camera, time: '2026-03-14T08:00:00Z' } as Partial<Scene>);
    expect(slideEnterKey(slideFor(after))).not.toBe(slideEnterKey(slideFor(before)));
  });

  it('changes when the narration track changes', () => {
    const before = scene('atlas-scene-1', { audioUrl: 'https://cdn.example/a.mp3' } as Partial<Scene>);
    const after = scene('atlas-scene-1', { audioUrl: 'https://cdn.example/b.mp3' } as Partial<Scene>);
    expect(slideEnterKey(slideFor(after))).not.toBe(slideEnterKey(slideFor(before)));
  });

  it('changes when a different scene takes the position — a swapped story', () => {
    expect(slideEnterKey(slideFor(scene('doc-1'))))
      .not.toBe(slideEnterKey(slideFor(scene('doc-2'))));
  });

  it('distinguishes a scene with no camera from one that has one', () => {
    const located = scene('atlas-scene-1', { camera } as Partial<Scene>);
    expect(slideEnterKey(slideFor(scene('atlas-scene-1'))))
      .not.toBe(slideEnterKey(slideFor(located)));
  });
});
