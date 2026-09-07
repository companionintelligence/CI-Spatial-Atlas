import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasMemory } from '../src/model/atlasModel.js';
import type { GeoPlace } from '../src/memory/geocode.js';

/**
 * The ⌘K palette, now that it searches places as well as memories.
 *
 * What is worth testing here is everything that can put the user somewhere they
 * did not ask to go. Merging order is the first: the geocoder answers "berlin"
 * with six rows whatever the story holds, so a merge that ranked instead of
 * grouped would bury the user's own memory under a list of German suburbs. The
 * second is the supersede contract — `PlaceSearch.search` resolves `null` for a
 * search a later keystroke overtook, and a UI that treats `null` as "no
 * results" flashes the list empty on every keystroke and, worse, can flash it
 * backwards to an older query. The third is the keyboard, because the arrow
 * keys walk one flat list whose tail arrives asynchronously: an index that
 * means a memory now can mean a place a moment later.
 *
 * There is no DOM in this workspace's test environment (vitest runs the
 * viewer's suites in node; nothing here renders React), so the palette's logic
 * is exported as pure functions and exercised directly. That is not a
 * concession — `paletteKey` and `applyPlaceResults` are the parts with
 * invariants, and asserting them here is a line each instead of a rendered,
 * clicked, awaited ordeal that mostly tests React.
 *
 * The geocoder is reached through the real `createPlaceSearch` with `fetch`
 * stubbed exactly as `test/geocode.test.ts` does it — the supersede case is a
 * property of that module's timing, and a hand-rolled fake would only prove the
 * fake resolves null. Nothing here touches the network, and the module's
 * query cache lives in module scope, so each test imports a fresh copy.
 */

async function load() {
  vi.resetModules();
  const geocode = await import('../src/memory/geocode.js');
  const palette = await import('../src/ui/CommandPalette.js');
  return { ...geocode, ...palette };
}

/** Records every URL asked for, and answers with `body`. */
function stubGeocoder(body: unknown) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

const photon = (...names: string[]) => ({
  type: 'FeatureCollection',
  features: names.map((name, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [13.3888599 + i, 52.5170365] },
    properties: { osm_id: 100 + i, osm_type: 'R', osm_value: 'city', name, country: 'Germany' },
  })),
});

const memory = (id: string, title: string, place?: string): AtlasMemory => ({
  id,
  title,
  timeMs: Date.UTC(2019, 5, 17),
  whenDate: 'Jun 17, 2019',
  whenTime: '7:41 PM',
  tod: 'dusk',
  place,
  gradient: '',
});

/** A place, shaped as the geocoder shapes one, without going through it. */
const place = (id: string, name: string, detail?: string): GeoPlace => ({
  id,
  label: detail ? `${name}, ${detail}` : name,
  name,
  detail,
  lat: 52.5,
  lon: 13.4,
  source: 'photon' as const,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('merging memories and places', () => {
  it('keeps every matching memory above every place', async () => {
    const { paletteItems } = await load();

    const items = paletteItems(
      [memory('a', 'Berlin, 2019'), memory('b', 'Lunch', 'Berlin')],
      [place('p1', 'Berlin', 'Germany'), place('p2', 'Berlin Schönefeld', 'Germany')],
      'berlin',
    );

    // The point of the grouping: a user typing the title of a memory they
    // already have must not have to arrow past six OSM rows to reach it.
    expect(items.map((i) => i.kind)).toEqual(['memory', 'memory', 'place', 'place']);
    expect(items[0]!.label).toBe('Berlin, 2019');
  });

  it('filters memories exactly as before, and never filters places', async () => {
    const { paletteItems } = await load();

    const memories = [memory('a', 'Berlin, 2019'), memory('b', 'Dentist')];
    // The geocoder already answered *this* query; re-filtering its rows against
    // the same string would drop "Schönefeld" for a query of "berlin".
    const items = paletteItems(memories, [place('p1', 'Schönefeld', 'Germany')], 'berlin');

    expect(items.map((i) => i.label)).toEqual(['Berlin, 2019', 'Schönefeld']);
  });

  it('gives places ids that cannot collide with a memory’s', async () => {
    const { paletteItems } = await load();

    // Both lists are keyed into one React list. A story whose memory id is the
    // geocoder's row id is far-fetched right up until an importer starts
    // minting ids from OSM.
    const items = paletteItems([memory('x1', 'Trip')], [place('x1', 'Berlin')], '');
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it('labels the groups and hands each row its flat index', async () => {
    const { paletteItems, paletteGroups } = await load();

    const items = paletteItems([memory('a', 'Berlin, 2019')], [place('p1', 'Berlin')], 'berlin');
    const groups = paletteGroups(items);

    expect(groups.map((g) => g.label)).toEqual(['Memories', 'Places']);
    // The indices are what the arrow keys move through; a grouping that
    // renumbered them would highlight one row and open another.
    expect(groups.flatMap((g) => g.rows.map((r) => r.index))).toEqual([0, 1]);
  });

  it('shows no group heading for a list that has only memories', async () => {
    const { paletteItems, paletteGroups } = await load();
    const groups = paletteGroups(paletteItems([memory('a', 'Trip')], [], ''));
    expect(groups.map((g) => g.key)).toEqual(['memory']);
  });
});

describe('a superseded search leaves the list alone', () => {
  it('resolves the overtaken keystrokes with null, and applies only the last', async () => {
    vi.useFakeTimers();
    const { calls } = stubGeocoder(photon('Berlin'));
    const { createPlaceSearch, applyPlaceResults } = await load();
    const search = createPlaceSearch({ lang: 'en' });

    // What the palette is showing when the user carries on typing.
    let screen: { places: GeoPlace[]; state: string; everAnswered: boolean } = {
      places: [place('old', 'Bern')],
      state: 'ready',
      everAnswered: true,
    };
    const apply = (found: Awaited<ReturnType<typeof search.search>>) => {
      const next = applyPlaceResults(found, screen.everAnswered, true);
      if (next) screen = next;
      return next;
    };

    const a = search.search('be');
    const b = search.search('ber');
    const c = search.search('berlin');
    await vi.advanceTimersByTimeAsync(400);

    // Nothing is applied for the two the user typed past, so the rows from the
    // previous query stay put instead of blanking on each keystroke.
    expect(apply(await a)).toBeNull();
    expect(apply(await b)).toBeNull();
    expect(screen.places.map((p) => p.name)).toEqual(['Bern']);

    expect(apply(await c)).not.toBeNull();
    expect(screen.places.map((p) => p.name)).toEqual(['Berlin']);
    // One typing pause, one request — the debounce is the geocoder's, not a
    // second one layered on top of it.
    expect(calls).toHaveLength(1);
  });

  it('clears the list at once when the query drops below the geocoder’s minimum', async () => {
    const { createPlaceSearch, applyPlaceResults, MIN_QUERY_LENGTH } = await load();
    stubGeocoder(photon('Berlin'));
    const search = createPlaceSearch();

    // Short queries resolve `[]` immediately and send nothing — an emptied box
    // must clear on the same keystroke, not after a debounce.
    const found = await search.search('b'.repeat(MIN_QUERY_LENGTH - 1));
    expect(found).toEqual([]);
    expect(applyPlaceResults(found, true, true)!.places).toEqual([]);
  });
});

describe('searching, empty, and unreachable are three different things', () => {
  it('calls an empty answer "no results" only once the geocoder has proven it works', async () => {
    const { placeStateFor, paletteStatus, paletteItems } = await load();

    // `geocode()` resolves [] for "nothing matched" *and* for a dead host, by
    // design. Before the geocoder has ever answered with anything, the UI has
    // no evidence for either story and must not pick one.
    expect(placeStateFor([], false, true)).toBe('unreachable');
    expect(placeStateFor([], true, true)).toBe('none');
    expect(placeStateFor([place('p1', 'Berlin')], false, true)).toBe('ready');

    const empty = paletteItems([], [], 'qqzz');
    expect(paletteStatus(empty, 'unreachable')).toMatch(/may be unavailable/);
    expect(paletteStatus(empty, 'none')).toBe('No matching memories or places.');
    expect(paletteStatus(empty, 'searching')).toBe('Searching places…');
  });

  it('blames the network, not the query, when the browser is offline', async () => {
    const { placeStateFor, paletteStatus } = await load();

    expect(placeStateFor([], true, false)).toBe('offline');
    expect(paletteStatus([], 'offline')).toMatch(/offline/);
  });

  it('says nothing about places while memories are on screen and found', async () => {
    const { paletteItems, paletteStatus } = await load();

    const items = paletteItems([memory('a', 'Berlin, 2019')], [place('p1', 'Berlin')], 'berlin');
    expect(paletteStatus(items, 'ready')).toBeUndefined();
    // …but a search still running is announced even with rows already up, or
    // an empty Places group looks like an answer.
    expect(paletteStatus(items, 'searching')).toBe('Searching places…');
  });

  it('does not claim to have searched places for a query too short to send', async () => {
    const { paletteStatus } = await load();
    expect(paletteStatus([], 'idle')).toBe('No matches');
  });

  it('remembers that the geocoder works once it has answered', async () => {
    const { applyPlaceResults } = await load();

    const first = applyPlaceResults([place('p1', 'Berlin')], false, true)!;
    expect(first.everAnswered).toBe(true);
    // The next query genuinely has no match; that is now distinguishable.
    const second = applyPlaceResults([], first.everAnswered, true)!;
    expect(second.state).toBe('none');
  });
});

describe('the keyboard walks both groups as one list', () => {
  it('arrows out of the last memory and into the first place', async () => {
    const { paletteItems, paletteKey } = await load();

    const items = paletteItems([memory('a', 'Berlin, 2019')], [place('p1', 'Berlin')], 'berlin');

    expect(paletteKey('ArrowDown', 0, items)).toEqual({ type: 'move', active: 1 });
    // The group boundary is a rendering detail; nothing about it stops the
    // caret, and nothing about it needs a second keypress.
    const down = paletteKey('Enter', 1, items);
    expect(down.type).toBe('run');
    expect(down.type === 'run' && down.item.kind).toBe('place');
    expect(paletteKey('ArrowUp', 1, items)).toEqual({ type: 'move', active: 0 });
  });

  it('clamps at both ends rather than wrapping', async () => {
    const { paletteItems, paletteKey } = await load();
    const items = paletteItems([memory('a', 'Trip')], [place('p1', 'Berlin')], '');

    // Wrapping a list whose tail arrives from the network means ArrowUp from
    // the top lands on whatever the geocoder happened to deliver a moment ago.
    expect(paletteKey('ArrowUp', 0, items)).toEqual({ type: 'move', active: 0 });
    expect(paletteKey('ArrowDown', 1, items)).toEqual({ type: 'move', active: 1 });
  });

  it('runs the row the highlight is on, memory or place', async () => {
    const { paletteItems, paletteKey } = await load();
    const items = paletteItems([memory('a', 'Trip')], [place('p1', 'Berlin')], '');

    const first = paletteKey('Enter', 0, items);
    expect(first.type === 'run' && first.item.kind === 'memory' && first.item.memory.id).toBe('a');
    const second = paletteKey('Enter', 1, items);
    expect(second.type === 'run' && second.item.kind === 'place' && second.item.place.lat).toBe(52.5);
  });

  it('does nothing on Enter over an empty list, and keeps escape and the focus trap', async () => {
    const { paletteKey } = await load();

    expect(paletteKey('Enter', 0, [])).toEqual({ type: 'ignore' });
    expect(paletteKey('ArrowDown', 0, [])).toEqual({ type: 'move', active: 0 });
    expect(paletteKey('Escape', 0, [])).toEqual({ type: 'close' });
    expect(paletteKey('Tab', 0, [])).toEqual({ type: 'trap' });
    // Everything else must fall through to the input, or the box cannot be typed in.
    expect(paletteKey('b', 0, [])).toEqual({ type: 'ignore' });
  });

  it('carries the geocoder’s coordinates through to the row the caller acts on', async () => {
    vi.useFakeTimers();
    stubGeocoder(photon('Berlin'));
    const { createPlaceSearch, applyPlaceResults, paletteItems, paletteKey } = await load();

    const search = createPlaceSearch();
    const pending = search.search('berlin');
    await vi.advanceTimersByTimeAsync(400);
    const found = applyPlaceResults(await pending, false, true)!;

    const items = paletteItems([], found.places, 'berlin');
    const action = paletteKey('Enter', 0, items);
    // GeoJSON is [lon, lat]; the swap is the classic geocoding bug and it fails
    // by flying the camera somewhere real, so the palette asserts it too.
    expect(action.type === 'run' && action.item.kind === 'place' && action.item.place.lat).toBeCloseTo(52.517, 3);
    expect(action.type === 'run' && action.item.kind === 'place' && action.item.place.lon).toBeCloseTo(13.389, 3);
  });
});
