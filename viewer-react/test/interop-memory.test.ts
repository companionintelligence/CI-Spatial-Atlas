/**
 * Companion Memory in the Import & export panel — the decision layer.
 *
 * The panel itself is a `.tsx` and this suite has no DOM (no jsdom, no
 * testing-library), which is why everything worth asserting lives in
 * `src/interop/memoryTransfer.ts`. What is tested here is the part that is
 * actually easy to get wrong and impossible to notice: the day boundary on a
 * date filter, a half-typed bounding box that would import an entire archive,
 * and whether the importer's degradation signals — `warnings`,
 * `stats.truncated`, the export's `lossy` — survive the trip to a sentence.
 *
 * Nothing reaches the network: `startFakeMemory()` listens on 127.0.0.1 and
 * reproduces CI-Server's real behaviours (a 100-row clamp, HTTP 400 with a
 * valid `{errors:[…]}` body, an unknown field failing the whole query).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStory, type Story } from '@companion-atlas/story';
import { resetMemoryCapabilities, type MemoryImport } from '../src/memory/import.js';
import type { MemoryExportResult } from '../src/memory/export.js';
import {
  EMPTY_MEMORY_FILTER,
  exportProgressLabel,
  exportStoryWithReport,
  exportSummary,
  importFilteredMemory,
  importProgressLabel,
  importProgressPercent,
  importSummary,
  isUnfiltered,
  parseMemoryFilter,
  truncationNote,
  type MemoryFilterDraft,
} from '../src/interop/memoryTransfer.js';
import {
  markerEvent,
  photoEvent,
  startFakeMemory,
  type FakeMemoryServer,
} from './memory-server.js';

const draft = (over: Partial<MemoryFilterDraft> = {}): MemoryFilterDraft => ({
  ...EMPTY_MEMORY_FILTER,
  ...over,
});

let mem: FakeMemoryServer;

beforeEach(() => {
  // The importer memoises "does this server have EventType.metadata?" per
  // endpoint. A fresh ephemeral port per test would hide a leak across servers,
  // so clear it explicitly rather than relying on the port changing.
  resetMemoryCapabilities();
});
afterEach(async () => { await mem?.close(); });

// ---------------------------------------------------------------------------
// The filter form
// ---------------------------------------------------------------------------

describe('parseMemoryFilter', () => {
  it('makes the end date inclusive of its own day', () => {
    // The bug this exists for: `endTime: "2019-06-30"` compares against
    // midnight, so a trip's last day silently falls outside the window the user
    // typed and they conclude the filter is broken.
    const { filter, problems } = parseMemoryFilter(draft({ start: '2019-06-01', end: '2019-06-30' }));
    expect(problems).toEqual([]);
    expect(filter.start).toBe('2019-06-01T00:00:00.000Z');
    expect(filter.end).toBe('2019-06-30T23:59:59.999Z');
  });

  it('anchors the window in UTC, not the browser timezone', () => {
    // Converting through local time would shift the window by the viewer's
    // offset — a different window for every user, none of them the typed one.
    const { filter } = parseMemoryFilter(draft({ start: '2019-06-01' }));
    expect(filter.start).toMatch(/Z$/);
  });

  it('refuses a start after its end', () => {
    const { problems } = parseMemoryFilter(draft({ start: '2019-07-01', end: '2019-06-01' }));
    expect(problems.join(' ')).toMatch(/start date is after/i);
  });

  it('refuses a partial bounding box instead of importing everything', () => {
    // A server handed no bbox returns the whole archive, so a dropped box reads
    // as "the area filter did nothing" rather than as an error.
    const { filter, problems } = parseMemoryFilter(draft({ west: '-123.2', south: '37.6' }));
    expect(filter.bbox).toBeUndefined();
    expect(problems.join(' ')).toMatch(/all four edges/i);
  });

  it('accepts a complete box in the importer\'s [w, s, e, n] order', () => {
    const { filter, problems } = parseMemoryFilter(
      draft({ west: '-123.2', south: '37.6', east: '-122.3', north: '37.9' }),
    );
    expect(problems).toEqual([]);
    expect(filter.bbox).toEqual([-123.2, 37.6, -122.3, 37.9]);
  });

  it('allows a box crossing the antimeridian but not an inverted latitude', () => {
    // West > east is a real box (PostGIS handles the wrap); south > north is not
    // a box at all, and latitude has no equivalent wrap.
    expect(parseMemoryFilter(draft({ west: '170', south: '-20', east: '-170', north: '20' })).problems)
      .toEqual([]);
    expect(parseMemoryFilter(draft({ west: '-1', south: '40', east: '1', north: '30' })).problems.join(' '))
      .toMatch(/South is north of North/i);
  });

  it('rejects degrees outside the globe, naming the edge', () => {
    const { problems } = parseMemoryFilter(draft({ west: '-123', south: '99', east: '-122', north: '100' }));
    expect(problems.join(' ')).toMatch(/South must be between/);
  });

  it('rejects a field that is not a number rather than sending NaN', () => {
    const { problems } = parseMemoryFilter(draft({ west: 'west-ish', south: '1', east: '2', north: '3' }));
    expect(problems.join(' ')).toMatch(/West is not a number/);
  });
});

describe('isUnfiltered', () => {
  it('is true only for a wholly empty draft', () => {
    expect(isUnfiltered(EMPTY_MEMORY_FILTER)).toBe(true);
    expect(isUnfiltered(draft({ start: '2019-06-01' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Running an import
// ---------------------------------------------------------------------------

describe('importFilteredMemory', () => {
  it('never reaches the server with a filter it already knows is broken', async () => {
    mem = await startFakeMemory({ events: [photoEvent(1)] });
    const outcome = await importFilteredMemory({ url: mem.url }, draft({ west: '-123' }));
    expect(outcome.ok).toBe(false);
    // The whole point: a bad box would otherwise be dropped server-side and come
    // back as the entire archive, which looks like a successful import.
    expect(mem.searches).toEqual([]);
  });

  it('sends the parsed window and box, and follows the cursor past one page', async () => {
    const events = Array.from({ length: 150 }, (_, i) => photoEvent(i));
    mem = await startFakeMemory({ events });
    const outcome = await importFilteredMemory(
      { url: mem.url },
      draft({ start: '2019-06-01', end: '2019-06-30', west: '-180', south: '-90', east: '180', north: '90' }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const first = mem.searches[0]!;
    expect(first.startTime).toBe('2019-06-01T00:00:00.000Z');
    expect(first.endTime).toBe('2019-06-30T23:59:59.999Z');
    expect(first.bbox).toEqual([-180, -90, 180, 90]);
    // 150 rows past a server-side clamp of 100 is the regression `fetchMemoryStory`
    // had: without paging, the second half of the archive simply never arrives.
    expect(outcome.result.stats.media).toBe(150);
    expect(outcome.result.stats.pages).toBeGreaterThan(1);
  });

  it('narrows to a trip rather than importing everything', async () => {
    mem = await startFakeMemory({
      events: [
        photoEvent(1, { startTime: '2019-06-10T12:00:00Z' }),
        photoEvent(2, { startTime: '2021-01-04T12:00:00Z' }),
      ],
    });
    const outcome = await importFilteredMemory(
      { url: mem.url },
      draft({ start: '2019-06-01', end: '2019-06-30' }),
    );
    expect(outcome.ok && outcome.result.stats.media).toBe(1);
  });

  it('reports every phase as it goes, with counts', async () => {
    mem = await startFakeMemory({
      events: [photoEvent(1), markerEvent(2)],
      places: [{ id: 'p1', name: 'Harbour', latitude: 64.1, longitude: -21.9 }],
    });
    const seen: string[] = [];
    const outcome = await importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER, {
      onProgress: (p) => seen.push(`${p.phase}:${p.loaded}:${p.done}`),
    });
    expect(outcome.ok).toBe(true);
    // A silent import is indistinguishable from a hung one — every phase must
    // announce itself and must announce that it finished.
    expect(seen.some((s) => s.startsWith('places:'))).toBe(true);
    expect(seen).toContain('memories:2:true');
    expect(seen.some((s) => s.startsWith('stories:'))).toBe(true);
  });

  it('cancels in flight without rejecting', async () => {
    mem = await startFakeMemory({ events: Array.from({ length: 300 }, (_, i) => photoEvent(i)) });
    const ctl = new AbortController();
    const running = importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER, {
      signal: ctl.signal,
      onProgress: () => ctl.abort(),
    });
    // A cancelled import is a resolved one carrying "cancelled", not a throw a
    // click handler would leak as an unhandled rejection.
    await expect(running).resolves.toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Degradations reaching the screen
// ---------------------------------------------------------------------------

describe('surfacing what the importer degraded', () => {
  it('keeps the warning from a server with no places()', async () => {
    mem = await startFakeMemory({ events: [photoEvent(1)], supportsPlaces: false });
    const outcome = await importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The import succeeded; the roster did not. Swallowing this turns "no place
    // names anywhere" into a mystery.
    expect(outcome.result.connected).toBe(true);
    expect(outcome.result.warnings.join(' ')).toMatch(/Places unavailable/i);
  });

  it('keeps the warning from a server with no EventType.metadata', async () => {
    mem = await startFakeMemory({ events: [photoEvent(1)], supportsMetadata: false });
    const outcome = await importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER);
    expect(outcome.ok && outcome.result.warnings.join(' ')).toMatch(/metadata/i);
  });

  it('turns stats.truncated into a sentence that says what to do', () => {
    const partial = { stats: { truncated: true, pages: 50 } } as unknown as MemoryImport;
    expect(truncationNote(partial)).toMatch(/partial import/i);
    expect(truncationNote(partial)).toMatch(/Narrow the dates or the area/i);
    expect(truncationNote({ stats: { truncated: false, pages: 2 } } as unknown as MemoryImport)).toBeNull();
  });

  it('never puts a credential on screen, even when the server echoes it back', async () => {
    mem = await startFakeMemory({ mode: 'echoauth' });
    const outcome = await importFilteredMemory({ url: mem.url, token: 'sekrit-jwt' }, EMPTY_MEMORY_FILTER);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const onScreen = [importSummary(outcome.result), ...outcome.result.warnings].join(' ');
    expect(onScreen).not.toContain('sekrit-jwt');
    expect(onScreen).toContain('<token>');
  });

  it('says "nothing here" for an empty archive and "not connected" for a dead one', async () => {
    mem = await startFakeMemory({ mode: 'empty' });
    const empty = await importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER);
    expect(empty.ok && importSummary(empty.result)).toMatch(/Nothing located/i);
    await mem.close();

    mem = await startFakeMemory({ mode: 'unauth' });
    const dead = await importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER);
    expect(dead.ok && dead.result.connected).toBe(false);
    // The two states read differently on purpose — an archive with zero located
    // rows is not a broken connection.
    expect(dead.ok && importSummary(dead.result)).toMatch(/HTTP 401/);
  });
});

describe('progress in words', () => {
  it('names the phase and the running count', () => {
    expect(importProgressLabel({ phase: 'memories', page: 4, loaded: 340, total: 791, done: false }))
      .toBe('Memories — 340 of 791 · page 4');
    expect(importProgressLabel({ phase: 'places', page: 1, loaded: 12, done: true }))
      .toBe('Places — 12');
  });

  it('has no percentage when the server reported no total', () => {
    expect(importProgressPercent({ phase: 'memories', page: 1, loaded: 10, done: false })).toBeNull();
    expect(importProgressPercent({ phase: 'memories', page: 1, loaded: 10, total: 40, done: false })).toBe(25);
    // A server's totalCount can lag the rows it is already handing back.
    expect(importProgressPercent({ phase: 'memories', page: 9, loaded: 90, total: 40, done: false })).toBe(100);
  });

  it('labels an export phase too', () => {
    expect(exportProgressLabel({ phase: 'media', written: 3, total: 12, done: false })).toBe('Media — 3 of 12');
  });
});

describe('importSummary', () => {
  it('counts from stats, and drops the zeros', () => {
    const r = { connected: true, stats: { media: 2, markers: 0, places: 5, stories: 1 } } as unknown as MemoryImport;
    expect(importSummary(r)).toBe('2 photos · 5 places · 1 saved story');
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const STORY: Story = loadStory({
  schema: 'companion.atlas/story@1',
  id: 'trip',
  title: 'Reykjavík',
  scenes: [],
  items: [
    { id: 'a', type: 'marker', title: 'Harbour', position: { lat: 64.15, lon: -21.94 }, time: '2019-06-10T12:00:00Z' },
  ],
});

describe('exportStoryWithReport', () => {
  it('writes the story and hands back the lossiness report', async () => {
    mem = await startFakeMemory();
    const r = await exportStoryWithReport({ url: mem.url }, STORY);
    expect(r.ok).toBe(true);
    expect(exportSummary(r)).toMatch(/^Saved to Companion Memory/);
    // `lossy` is written to be read by a person and is the answer to "why is my
    // photo gone next week" — an export that reports a clean save without it is
    // the thing this feature exists to prevent.
    expect(r.lossy.length).toBeGreaterThan(0);
    expect(r.lossy.join(' ')).toMatch(/expire/i);
  });

  it('reports a refused save rather than claiming success', async () => {
    mem = await startFakeMemory({ mode: 'unauth' });
    const r = await exportStoryWithReport({ url: mem.url }, STORY);
    expect(r.ok).toBe(false);
    expect(exportSummary(r)).toMatch(/HTTP 401/);
  });

  it('round-trips: what is exported comes back on the next import', async () => {
    mem = await startFakeMemory();
    await exportStoryWithReport({ url: mem.url }, STORY);
    const back = await importFilteredMemory({ url: mem.url }, EMPTY_MEMORY_FILTER);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.result.stories.map((s) => s.title)).toContain('Reykjavík');
  });

  it('summarises a partial write instead of hiding the failures', () => {
    const r = {
      ok: true, mediaEventIds: ['e1'], placeIds: [], skipped: [], lossy: [], warnings: [],
      failed: [{ id: 'trip:a', reason: 'nope' }],
    } as unknown as MemoryExportResult;
    expect(exportSummary(r)).toMatch(/1 media event/);
    expect(exportSummary(r)).toMatch(/1 entity the server refused/);
  });
});
