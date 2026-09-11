/**
 * A journey's stops are not only collected memories.
 *
 * The Scenes panel already lets someone write a scene with its own narrative
 * and camera — a story in miniature — and there was no way to make it a stop
 * in the journey the scrapbook curates/plays/saves, only a way to have it
 * tacked on the end of the saved document, unordered relative to whatever the
 * journey itself contains. Checking a scene into the journey (`AtlasApp`'s
 * `journeySceneIds`) weaves it into the same chronological line collected
 * memories already sort into.
 *
 * An adversarial review of the first cut found three failure modes here, all
 * silent, and all pinned below:
 *
 *   1. A double-write. `buildScrapbookStory`/`curateJourney` re-id every entry
 *      as `sb-<id>`, so a scene fed in as a journey entry AND left in the
 *      unconditional trailing scene-append would appear twice — once at its
 *      rightful chronological place, once more under its own id at the end.
 *   2. An id collision. A scene already embedded in the open document renders
 *      as an ordinary pin (`deriveModel` turns every `story.scenes` entry into
 *      a ordinary memory), so it can be Collected like any other memory AND
 *      separately checked into the journey — landing the SAME id in both
 *      `sbEntries` and `journeySceneMemories` with no dedup between them,
 *      producing two `Scene` objects sharing one id in the saved document.
 *   3. Play showed everything, not the journey. `draftStory` — which
 *      unconditionally appends every OTHER authored scene, correctly, because
 *      Save must never silently drop a scene nobody checked in — was ALSO
 *      what got played, so an unchecked scene played as part of "the journey"
 *      exactly as if it had been checked. Checking a box changed nothing
 *      anyone watching could see.
 *
 * Fixed by, respectively: deduping `journeySources` by id (the checked-in
 * scene's live copy wins over a stale `sbEntries` copy of the same id); and
 * splitting the composition in two — `journeyBase` (played) stops at the
 * journey's own entries, `draftStory` (saved) is `journeyBase` plus the
 * scenes NOT checked in.
 */
import { describe, expect, it } from 'vitest';
import { buildScrapbookStory, curateJourney, type Scene } from '@companion-atlas/story';
import type { ScrapbookEntry, Story } from '@companion-atlas/story';
import { withAuthoredScenes } from '../src/scenes/story.js';
import { deriveModel } from '../src/model/atlasModel.js';
import type { AtlasMemory } from '../src/model/atlasModel.js';

const toEntry = (m: AtlasMemory): ScrapbookEntry => ({
  id: m.id, title: m.title, narrative: m.narrative, place: m.place,
  timeMs: m.timeMs, lat: m.lat, lon: m.lon, people: m.people, media: m.media,
});

const MEMORY: AtlasMemory = {
  id: 'mem-1', title: 'Harbour at dusk', timeMs: Date.parse('2019-06-18T19:00:00Z'),
  whenDate: 'Jun 18, 2019', whenTime: '7:00 PM', tod: 'evening', lat: 64.15, lon: -21.93,
  gradient: 'g1',
};

const EARLY_SCENE: Scene = {
  id: 'atlas-scene-early', title: 'Before dawn',
  narrative: 'The town before anyone woke.',
  time: '2019-06-18T04:00:00Z',
  camera: { location: { lat: 64.1, lon: -21.9 } },
} as unknown as Scene;

const UNSELECTED_SCENE: Scene = { id: 'atlas-scene-other', title: 'A different story' } as unknown as Scene;

const BASE_STORY = { schema: 'companion.atlas/story@1', id: 'base', title: 'Base', scenes: [] } as unknown as Story;

/**
 * `AtlasApp`'s composition, replicated "minus React" — same pattern
 * `scenes-are-saved.test.ts` uses for `draftStory` itself, now split into
 * `journeyBase` (played) and `draftStory` (saved) the way the real code is.
 */
const compose = (opts: {
  curated: boolean;
  memories: AtlasMemory[];
  allScenes: Scene[];
  journeySceneIds: ReadonlySet<string>;
}): { journeyStory: Story | null; savedStory: Story | null; journeySources: AtlasMemory[] } => {
  const selected = opts.allScenes.filter((sc) => opts.journeySceneIds.has(sc.id));
  const sceneMemories = selected.length ? deriveModel({ ...BASE_STORY, scenes: selected }).memories : [];
  // The dedup: a memory sharing an id with a checked-in scene loses to the
  // scene's own (live) copy.
  const checkedIn = new Set(sceneMemories.map((m) => m.id));
  const memories = opts.memories.filter((m) => !checkedIn.has(m.id));
  const journeySources = [...memories, ...sceneMemories].sort((a, b) => a.timeMs - b.timeMs);

  if (journeySources.length === 0 && opts.allScenes.length === 0) {
    return { journeyStory: null, savedStory: null, journeySources };
  }

  const o = { visibility: 'private' as const, title: 'Trip' };
  const journeyStory = journeySources.length
    ? (opts.curated ? curateJourney(journeySources.map(toEntry), o) : buildScrapbookStory(journeySources.map(toEntry), o))
    : null;

  if (opts.memories.length === 0 && opts.allScenes.length === 0) return { journeyStory, savedStory: null, journeySources };

  const remaining = opts.allScenes.filter((sc) => !opts.journeySceneIds.has(sc.id));
  const base = journeyStory ?? (opts.curated ? curateJourney([], o) : buildScrapbookStory([], o));
  const savedStory = withAuthoredScenes(base, remaining);
  return { journeyStory, savedStory, journeySources };
};

describe('a scene checked into the journey', () => {
  it('appears once in the saved document, not twice', () => {
    const { savedStory } = compose({
      curated: false, memories: [MEMORY], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(savedStory!.scenes.filter((sc) => sc.title === 'Before dawn')).toHaveLength(1);
  });

  it('sorts into the journey by its own time, not appended after it', () => {
    const { savedStory } = compose({
      curated: false, memories: [MEMORY], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    // EARLY_SCENE is 04:00Z; MEMORY is 19:00Z the same day — the scene's stop
    // must come first.
    expect(savedStory!.scenes[0]!.title).toBe('Before dawn');
    expect(savedStory!.scenes[1]!.title).toBe(MEMORY.title);
  });

  it('carries its own narrative into the journey, not a generated one', () => {
    const { savedStory } = compose({
      curated: true, memories: [MEMORY], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    const stop = savedStory!.scenes.find((sc) => sc.title === 'Before dawn')!;
    expect(stop.narrative).toBe('The town before anyone woke.');
  });

  it('makes a journey saveable from scenes alone, with nothing collected', () => {
    const { savedStory } = compose({
      curated: false, memories: [], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(savedStory).not.toBeNull();
    expect(savedStory!.scenes.map((sc) => sc.title)).toEqual(['Before dawn']);
  });
});

describe('the same scene collected AND checked in at once', () => {
  // The id-collision an already-embedded scene creates: `deriveModel` renders
  // any scene already in the open document as an ordinary collectible pin, so
  // the identical id can arrive in `memories` (an ordinary Collect click) and
  // in the checklist's own derivation at the same time.
  const COLLIDING_MEMORY: AtlasMemory = {
    ...MEMORY, id: 'atlas-scene-early', title: 'Whatever the pin said', timeMs: Date.parse('2019-06-18T23:00:00Z'),
  };

  it('is written once, not twice, in the saved document', () => {
    const { savedStory } = compose({
      curated: false, memories: [COLLIDING_MEMORY], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(savedStory!.scenes.filter((sc) => sc.id.includes('atlas-scene-early'))).toHaveLength(1);
  });

  it('keeps the scene checklist entry, not the stale collected copy', () => {
    // The scene's OWN narrative/time should win — it is the live, deliberately
    // checked-in copy — over whatever the ordinary Collect click happened to
    // grab.
    const { journeySources } = compose({
      curated: false, memories: [COLLIDING_MEMORY], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(journeySources).toHaveLength(1);
    expect(journeySources[0]!.title).toBe('Before dawn');
  });
});

describe('a scene left unchecked', () => {
  it('still saves, appended after the journey — unchanged from before this feature', () => {
    const { savedStory } = compose({
      curated: false, memories: [MEMORY], allScenes: [EARLY_SCENE, UNSELECTED_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(savedStory!.scenes.map((sc) => sc.title)).toEqual(['Before dawn', MEMORY.title, 'A different story']);
  });

  it('is not silently dropped by having its sibling selected', () => {
    const { savedStory } = compose({
      curated: false, memories: [], allScenes: [UNSELECTED_SCENE],
      journeySceneIds: new Set(),
    });
    expect(savedStory!.scenes.map((sc) => sc.id)).toEqual(['atlas-scene-other']);
  });

  // This is the blocker an adversarial review found: Play used to reuse the
  // SAVE document, which includes every unchecked scene too.
  it('does NOT play — the played journey holds only checked-in stops', () => {
    const { journeyStory } = compose({
      curated: false, memories: [MEMORY], allScenes: [EARLY_SCENE, UNSELECTED_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(journeyStory!.scenes.map((sc) => sc.title)).toEqual(['Before dawn', MEMORY.title]);
    expect(journeyStory!.scenes.some((sc) => sc.title === 'A different story')).toBe(false);
  });

  it('is still absent from Play even when it is the ONLY authored scene', () => {
    const { journeyStory } = compose({
      curated: false, memories: [MEMORY], allScenes: [UNSELECTED_SCENE],
      journeySceneIds: new Set(),
    });
    expect(journeyStory!.scenes.map((sc) => sc.title)).toEqual([MEMORY.title]);
  });
});

describe('nothing chosen for the journey', () => {
  it('gives Play nothing to play even when other scenes exist to save', () => {
    const { journeyStory } = compose({
      curated: false, memories: [], allScenes: [UNSELECTED_SCENE],
      journeySceneIds: new Set(),
    });
    expect(journeyStory).toBeNull();
  });
});

describe('the journeyMapRef alignment `playStory` depends on', () => {
  it('produces journeySources in the same order curateJourney sorts its own scenes into', () => {
    // This is the bug: `s.scenes` is ALWAYS time-sorted (curateJourney/
    // buildScrapbookStory sort internally); `journeySources[i]` has to match
    // that order for `playStory`'s index-paired map to name the right memory.
    const { journeyStory, journeySources } = compose({
      curated: false, memories: [MEMORY], allScenes: [EARLY_SCENE],
      journeySceneIds: new Set(['atlas-scene-early']),
    });
    expect(journeySources.map((m) => m.title)).toEqual(['Before dawn', MEMORY.title]);
    expect(journeyStory!.scenes.map((sc) => sc.title)).toEqual(journeySources.map((m) => m.title));
  });
});
