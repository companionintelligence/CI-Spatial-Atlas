/**
 * The Save path must carry what the user drew.
 *
 * `mergeAuthoredItems` is covered on its own in authoring-store.test.ts. What
 * this file pins is the *composition* AtlasApp's `draftStory` performs, which
 * is where the gap was: drawn shapes reached the Import & export panel through
 * `exportStory`, but Save to Memory and Download serialise `draftStory`, and
 * that built a story from scrapbook entries alone. So an annotation survived an
 * export and vanished from a save — the one direction meant to be durable.
 *
 * localStorage persistence (added alongside) is a convenience, not custody: it
 * is per-browser, cleared by a privacy setting, and invisible to anyone the
 * story is shared with. Save is what actually keeps a drawing.
 */
import { describe, expect, it } from 'vitest';
import { buildScrapbookStory, curateJourney, type Item, type ScrapbookEntry } from '@companion-atlas/story';
import { mergeAuthoredItems } from '../src/authoring/store.js';

// Shaped exactly as AtlasApp's `toEntry` builds one from an AtlasMemory —
// `timeMs`, not an ISO string, which is what buildScrapbookStory expects.
const ENTRIES: ScrapbookEntry[] = [
  {
    id: 'mem-1',
    title: 'Harbour at dusk',
    narrative: 'The light went orange.',
    place: 'Reykjavik',
    timeMs: Date.parse('2019-06-18T19:00:00Z'),
    lat: 64.15,
    lon: -21.93,
  },
];

const DRAWN: Item[] = [
  { id: 'draw-marker-1', type: 'marker', position: { lat: 64.14, lon: -21.9 }, color: '#39c0ff' },
  {
    id: 'draw-polygon-1',
    type: 'polygon',
    positions: [
      { lat: 64.13, lon: -21.97 },
      { lat: 64.13, lon: -21.89 },
      { lat: 64.17, lon: -21.89 },
    ],
    fillColor: '#ff4444',
    fillOpacity: 0.4,
  },
] as unknown as Item[];

/** Exactly what `draftStory` does, for both of its branches. */
const draftStory = (curated: boolean, drawn: Item[]) => {
  const opts = { visibility: 'private' as const, title: 'Trip' };
  const base = curated ? curateJourney(ENTRIES, opts) : buildScrapbookStory(ENTRIES, opts);
  return drawn.length ? mergeAuthoredItems(base, drawn) : base;
};

describe('what Save serialises', () => {
  it('carries drawn shapes into an uncurated save', () => {
    const ids = (draftStory(false, DRAWN).items ?? []).map((i) => i.id);
    expect(ids).toContain('draw-marker-1');
    expect(ids).toContain('draw-polygon-1');
  });

  it('carries them into a curated journey too', () => {
    const ids = (draftStory(true, DRAWN).items ?? []).map((i) => i.id);
    expect(ids).toContain('draw-marker-1');
    expect(ids).toContain('draw-polygon-1');
  });

  it('keeps the drawn geometry and style intact, not just the id', () => {
    const poly = (draftStory(false, DRAWN).items ?? []).find((i) => i.id === 'draw-polygon-1');
    expect(poly).toMatchObject({ type: 'polygon', fillColor: '#ff4444', fillOpacity: 0.4 });
    expect((poly as { positions: unknown[] }).positions).toHaveLength(3);
  });

  it('does not disturb the scrapbook content it was built from', () => {
    const withDrawings = draftStory(false, DRAWN);
    const without = draftStory(false, []);
    expect(withDrawings.scenes.length).toBe(without.scenes.length);
    expect(withDrawings.title).toBe(without.title);
  });

  it('returns the plain scrapbook story when nothing was drawn', () => {
    const s = draftStory(false, []);
    // No empty `items` array bolted on: an unchanged story should be unchanged.
    expect(s.items ?? []).toHaveLength(0);
  });
});
