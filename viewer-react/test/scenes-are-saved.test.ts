/**
 * Where authored scenes actually go when a user saves.
 *
 * The question this pins is "are authored scenes saved?", and the first answer
 * was *partly* — which is the worst kind. They persisted to localStorage and
 * reached the Import & export panel, but `draftStory` — which feeds the
 * scrapbook drawer's **Save to Memory**, the only Save button in the app a
 * person would look for — built its document from collected entries alone. Two
 * consequences, both silent:
 *
 *   1. Collect some memories, write some scenes, press Save: the scenes were
 *      dropped from the saved document.
 *   2. Write scenes and collect nothing: Save was *disabled*, because the guard
 *      asked only whether the scrapbook had entries.
 *
 * That was inconsistent with the same file's own reasoning about drawings —
 * "localStorage is a convenience, not custody" — which had already been applied
 * one line above. These tests replicate `draftStory`'s composition so the
 * inconsistency cannot come back.
 *
 * KML is the one exit that legitimately drops scenes: `storyToKml` documents
 * that a Story's scene graph is richer than `<LookAt>` or `gx:Tour` and that
 * mapping it partially would imply a fidelity that is not there. The Import &
 * export panel says so on screen.
 */
import { describe, expect, it } from 'vitest';
import { buildScrapbookStory, curateJourney, storyToKml, type Scene } from '@companion-atlas/story';
import type { ScrapbookEntry, Story } from '@companion-atlas/story';
import { withAuthoredScenes } from '../src/scenes/story.js';

const ENTRIES: ScrapbookEntry[] = [
  {
    id: 'mem-1',
    title: 'Harbour at dusk',
    timeMs: Date.parse('2019-06-18T19:00:00Z'),
    lat: 64.15,
    lon: -21.93,
  },
];

const AUTHORED: Scene[] = [
  {
    id: 'atlas-scene-aaa',
    title: 'Arrival at first light',
    narrative: 'The light went **orange** over the harbour.',
    layout: 'card-left',
    camera: { lon: -21.93, lat: 64.15, height: 900 },
  },
  { id: 'atlas-scene-bbb', title: 'The long way home' },
] as unknown as Scene[];

/** `draftStory`'s composition, minus React. */
const draftStory = (opts: { curated: boolean; entries: ScrapbookEntry[]; scenes: Scene[] }): Story | null => {
  if (opts.entries.length === 0 && opts.scenes.length === 0) return null;
  const o = { visibility: 'private' as const, title: 'Trip' };
  const base = opts.curated ? curateJourney(opts.entries, o) : buildScrapbookStory(opts.entries, o);
  return withAuthoredScenes(base, opts.scenes);
};

describe('Save to Memory carries the authored deck', () => {
  it('keeps both the collected journey and the written scenes', () => {
    const s = draftStory({ curated: false, entries: ENTRIES, scenes: AUTHORED })!;
    const ids = s.scenes.map((sc) => sc.id);
    expect(ids).toContain('atlas-scene-aaa');
    expect(ids).toContain('atlas-scene-bbb');
    // The collected memory's own scene is not displaced by the authored ones.
    expect(s.scenes.length).toBeGreaterThan(AUTHORED.length);
  });

  it('does the same for a curated journey', () => {
    const s = draftStory({ curated: true, entries: ENTRIES, scenes: AUTHORED })!;
    expect(s.scenes.map((sc) => sc.id)).toEqual(expect.arrayContaining(['atlas-scene-aaa', 'atlas-scene-bbb']));
  });

  it('carries the narrative and layout, not just the id', () => {
    const s = draftStory({ curated: false, entries: ENTRIES, scenes: AUTHORED })!;
    const written = s.scenes.find((sc) => sc.id === 'atlas-scene-aaa');
    expect(written).toMatchObject({ title: 'Arrival at first light', layout: 'card-left' });
    expect(written?.narrative).toContain('**orange**');
  });

  it('is saveable with scenes and no collected memories at all', () => {
    // Previously null, which is what disabled the Save button.
    const s = draftStory({ curated: false, entries: [], scenes: AUTHORED });
    expect(s).not.toBeNull();
    expect(s!.scenes.map((sc) => sc.id)).toEqual(['atlas-scene-aaa', 'atlas-scene-bbb']);
  });

  it('is still nothing to save when there is neither', () => {
    expect(draftStory({ curated: false, entries: [], scenes: [] })).toBeNull();
  });

  it('preserves authored order rather than sorting by time', () => {
    // The second scene has no time at all; sorting would move it.
    const s = draftStory({ curated: false, entries: [], scenes: AUTHORED })!;
    expect(s.scenes.map((sc) => sc.title)).toEqual(['Arrival at first light', 'The long way home']);
  });
});

describe('KML is the one exit that legitimately drops scenes', () => {
  it('does not pretend to carry a scene graph', () => {
    const s = draftStory({ curated: false, entries: ENTRIES, scenes: AUTHORED })!;
    const kml = storyToKml(s);
    // The narrative text must not silently reappear as a placemark description:
    // a partial mapping would imply a fidelity KML does not have.
    expect(kml).not.toContain('Arrival at first light');
    expect(kml).not.toContain('The long way home');
  });
});
