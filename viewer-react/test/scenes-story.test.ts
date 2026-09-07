/**
 * The export-only merge, and the trap it exists to stay clear of.
 *
 * `deriveModel` maps **scenes** into the globe's memories when a story has any,
 * and only projects located entities when it has none. So an authored scene
 * that reaches the rendered story collapses a 500-memory archive to one pin per
 * scene — silently. The first test below is the guard for that, expressed the
 * only way a unit test can express it: by running the real `deriveModel` over
 * the merged story and showing what would happen.
 *
 * Everything after it is the merge itself: a Memory archive with no scenes of
 * its own, and a `?story=` document that has some and did not ask for the
 * user's.
 */
import { describe, expect, it } from 'vitest';
import { STORY_SCHEMA_ID, Story as StorySchema, type Scene, type Story } from '@companion-atlas/story';
import { adoptStoryScenes, withAuthoredScenes } from '../src/scenes/story.js';
import { deriveModel } from '../src/model/atlasModel.js';
import { buildDeck } from '../src/ui/sceneDeck.js';

const story = (over: Partial<Story> = {}): Story => ({
  schema: STORY_SCHEMA_ID,
  id: 'story-1',
  title: 'An archive',
  scenes: [],
  ...over,
});

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({ id, title: id, ...over });
const ids = (scenes: readonly Scene[]): string[] => scenes.map((s) => s.id);

/** A Memory archive: located entities, no authored scenes. What every real
 *  Companion Memory session produces. */
const archive = story({
  items: Array.from({ length: 6 }, (_, i) => ({
    type: 'marker' as const,
    id: `mem-${i}`,
    title: `Memory ${i}`,
    position: { lat: 40 + i, lon: -90 + i },
    time: `2020-0${i + 1}-01T00:00:00Z`,
  })),
});

describe('the globe must never see an authored scene', () => {
  it('projects every located memory before the merge, and only the scenes after', () => {
    // This is the failure the whole design is arranged around. `deriveModel`
    // reads `story.scenes.length > 0` as "this story is a deck", so merging
    // three authored scenes into the *rendered* story would leave the user
    // looking at three pins where their archive used to be.
    expect(deriveModel(archive).memories).toHaveLength(6);

    const authored = [scene('atlas-scene-a'), scene('atlas-scene-b'), scene('atlas-scene-c')];
    const merged = withAuthoredScenes(archive, authored)!;
    expect(deriveModel(merged).memories).toHaveLength(3);

    // …and the story the renderer is given is untouched, by identity.
    expect(archive.scenes).toEqual([]);
  });

  it('leaves the story object alone when the deck is empty', () => {
    // Same identity, so the caller can memoise it and the viewer does not
    // rebuild its CZML data source for nothing.
    expect(withAuthoredScenes(archive, [])).toBe(archive);
    expect(withAuthoredScenes(null, [scene('a')])).toBeNull();
  });
});

describe('a Memory archive (no scenes of its own)', () => {
  it('takes the deck verbatim, in the author\'s order', () => {
    const authored = [scene('c'), scene('a'), scene('b')];
    expect(ids(withAuthoredScenes(archive, authored)!.scenes)).toEqual(['c', 'a', 'b']);
  });

  it('produces a document that still parses', () => {
    const merged = withAuthoredScenes(archive, [
      scene('a', { narrative: '# Reykjavik', layout: 'split', camera: { lon: -21.9, lat: 64.1 } }),
    ])!;
    expect(StorySchema.safeParse(merged).success).toBe(true);
  });

  it('feeds the presenter a real deck', () => {
    // The other half of the contract: the deck the Presenter builds comes from
    // this merge, so the authored scenes have to arrive as slides.
    const merged = withAuthoredScenes(archive, [
      scene('a', { title: 'Arrival', narrative: 'We landed at dawn.', camera: { lon: -21.9, lat: 64.1 } }),
      scene('b', { title: 'The drive' }),
    ])!;
    const deck = buildDeck(merged);
    expect(deck.map((s) => s.title)).toEqual(['Arrival', 'The drive']);
    expect(deck[0].camera).toMatchObject({ lon: -21.9, lat: 64.1 });
  });

  it('drops a scene that would make the save throw, and keeps the rest', () => {
    const merged = withAuthoredScenes(archive, [
      scene('good'),
      { id: 'broken', time: 'last Tuesday' } as Scene,
      scene('also-good'),
    ])!;
    expect(ids(merged.scenes)).toEqual(['good', 'also-good']);
    expect(StorySchema.safeParse(merged).success).toBe(true);
  });
});

describe('a document that has scenes of its own', () => {
  const doc = story({ id: 'doc-7', scenes: [scene('intro'), scene('middle'), scene('end')] });

  it('carries the document\'s scenes through and appends the deck', () => {
    // The deck is account-scoped: it outlives this document, so a scene it does
    // not mention is usually not a statement about that scene at all. Dropping
    // them would delete a stranger's story the first time a user with a saved
    // deck opened it.
    const merged = withAuthoredScenes(doc, [scene('atlas-scene-1')])!;
    expect(ids(merged.scenes)).toEqual(['intro', 'middle', 'end', 'atlas-scene-1']);
  });

  it('replaces a matching scene in place, keeping the diff small', () => {
    const merged = withAuthoredScenes(doc, [scene('middle', { title: 'edited' })])!;
    expect(ids(merged.scenes)).toEqual(['intro', 'middle', 'end']);
    expect(merged.scenes[1].title).toBe('edited');
  });

  it('does not treat an unadopted deck\'s silence as a deletion', () => {
    // adoptedFrom names a *different* document, so absences here mean nothing.
    const merged = withAuthoredScenes(doc, [scene('x')], { adoptedFrom: 'some-other-story' })!;
    expect(ids(merged.scenes)).toEqual(['intro', 'middle', 'end', 'x']);
  });
});

describe('adoption is what makes a deletion durable', () => {
  const doc = story({ id: 'doc-7', scenes: [scene('intro'), scene('middle'), scene('end')] });

  it('hands the document\'s scenes over with their ids intact', () => {
    // Verbatim ids are what make the merge replace in place instead of
    // appending a near-duplicate after the original.
    expect(ids(adoptStoryScenes(doc))).toEqual(['intro', 'middle', 'end']);
    expect(adoptStoryScenes(null)).toEqual([]);
  });

  it('a scene removed from an adopted deck stays removed', () => {
    const adopted = adoptStoryScenes(doc).filter((s) => s.id !== 'middle');
    const merged = withAuthoredScenes(doc, adopted, { adoptedFrom: doc.id })!;
    expect(ids(merged.scenes)).toEqual(['intro', 'end']);
  });

  it('reorders an adopted deck', () => {
    const adopted = adoptStoryScenes(doc);
    const moved = [adopted[2], adopted[0], adopted[1]];
    expect(ids(withAuthoredScenes(doc, moved, { adoptedFrom: doc.id })!.scenes))
      .toEqual(['end', 'intro', 'middle']);
  });

  it('a broken edit costs the edit, not the scene', () => {
    // The deck is the only place the edit lives; the document is not. Dropping
    // the scene outright would turn a typo in a date field into permanent
    // deletion of a page of somebody's story.
    const adopted = adoptStoryScenes(doc).map((s) =>
      s.id === 'middle' ? ({ ...s, title: 'edited', time: 'last Tuesday' } as Scene) : s,
    );
    const merged = withAuthoredScenes(doc, adopted, { adoptedFrom: doc.id })!;
    expect(ids(merged.scenes)).toEqual(['intro', 'middle', 'end']);
    expect(merged.scenes[1]).toBe(doc.scenes[1]); // the document's own copy
    expect(StorySchema.safeParse(merged).success).toBe(true);
  });

  it('emptying an adopted deck empties the document', () => {
    const merged = withAuthoredScenes(doc, [], { adoptedFrom: doc.id })!;
    expect(merged.scenes).toEqual([]);
  });

  it('but an empty unadopted deck leaves the document alone', () => {
    expect(withAuthoredScenes(doc, [], { adoptedFrom: null })).toBe(doc);
    expect(withAuthoredScenes(doc, [], { adoptedFrom: 'other' })).toBe(doc);
  });

  it('an adoption claim against another document has no power here', () => {
    // The user adopted story A, then opened story B. B's scenes are not theirs
    // to delete.
    const other = story({ id: 'doc-8', scenes: [scene('theirs')] });
    const merged = withAuthoredScenes(other, [scene('mine')], { adoptedFrom: doc.id })!;
    expect(ids(merged.scenes)).toEqual(['theirs', 'mine']);
  });
});

describe('the clock has to contain the scenes now in it', () => {
  const timed = story({
    timeline: { start: '2020-01-01T00:00:00Z', stop: '2020-12-31T00:00:00Z' },
  });

  it('widens a fixed timeline around a scene outside it', () => {
    // The presenter scrubs to each slide's time and Cesium clamps a scrub
    // outside the window, so the scene would present with the clock parked on
    // the story's start date — "the time machine ignored my scene".
    const merged = withAuthoredScenes(timed, [
      scene('early', { time: '2015-06-01T00:00:00Z' }),
      scene('late', { time: '2024-06-01T00:00:00Z' }),
    ])!;
    expect(merged.timeline?.start).toBe('2015-06-01T00:00:00.000Z');
    expect(merged.timeline?.stop).toBe('2024-06-01T00:00:00.000Z');
  });

  it('only ever widens', () => {
    const merged = withAuthoredScenes(timed, [scene('inside', { time: '2020-06-01T00:00:00Z' })])!;
    expect(merged.timeline).toBe(timed.timeline);
  });

  it('writes back the close key the document already used', () => {
    // `end` is the legacy spelling; switching it on save would show up as a
    // gratuitous diff and could confuse a reader that only knows one.
    const legacy = story({ timeline: { start: '2020-01-01T00:00:00Z', end: '2020-02-01T00:00:00Z' } });
    const merged = withAuthoredScenes(legacy, [scene('late', { time: '2021-01-01T00:00:00Z' })])!;
    expect(merged.timeline?.end).toBe('2021-01-01T00:00:00.000Z');
    expect(merged.timeline?.stop).toBeUndefined();
  });

  it('leaves a story with no timeline alone', () => {
    // `timelineBounds` already derives the window from the scenes themselves.
    const merged = withAuthoredScenes(archive, [scene('a', { time: '1999-01-01T00:00:00Z' })])!;
    expect(merged.timeline).toBeUndefined();
    expect(StorySchema.safeParse(merged).success).toBe(true);
  });
});
