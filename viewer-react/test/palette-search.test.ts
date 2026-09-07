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

/**
 * Records every URL asked for (and the abort signal it was given), and answers
 * with `body`. `gated` withholds the answer until `open()` — the only way to
 * observe what happens to a request that is still in flight when the user keeps
 * typing, which is the whole subject of the retire tests below.
 */
function stubGeocoder(body: unknown, { gated = false }: { gated?: boolean } = {}) {
  const calls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!gated) release();

  const fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(String(url));
    signals.push(init?.signal);
    await gate;
    return { ok: true, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, signals, open: () => release() };
}

const photon = (...names: string[]) => ({
  type: 'FeatureCollection',
  features: names.map((name, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [13.3888599 + i, 52.5170365] },
    properties: { osm_id: 100 + i, osm_type: 'R', osm_value: 'city', name, country: 'Germany' },
  })),
});

/** One Nominatim row — the provider whose 1.1 s request floor the freeze test needs. */
const nominatim = (name: string) => [
  {
    place_id: 1,
    osm_type: 'relation',
    osm_id: 62422,
    lat: '52.5170365',
    lon: '13.3888599',
    name,
    display_name: `${name}, Germany`,
    category: 'boundary',
    type: 'administrative',
    boundingbox: ['52.338234', '52.675454', '13.088346', '13.761161'],
  },
];

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

  it('retires the search still running for the query the user backspaced away', async () => {
    vi.useFakeTimers();
    const { calls } = stubGeocoder(photon('Berlin'));
    const { createPlaceSearch, applyPlaceResults } = await load();
    const search = createPlaceSearch();

    // "ber" is searching. The user backspaces to "b", which is below the
    // geocoder's minimum: the palette clears its rows and — this is the part
    // that was missing — retires the search it started, rather than just
    // hiding it and letting it come back.
    const pending = search.search('ber');
    search.cancel();
    await vi.advanceTimersByTimeAsync(2000);

    // Null is the module's "superseded", and `applyPlaceResults` turns that
    // into "apply nothing", so the emptied box stays empty.
    expect(await pending).toBeNull();
    expect(applyPlaceResults(await pending, true, true)).toBeNull();
    // Retired inside the debounce, so nothing was ever asked of the geocoder.
    expect(calls).toHaveLength(0);
  });

  it('drops the answer even when the request was already out', async () => {
    vi.useFakeTimers();
    const { calls, signals, open } = stubGeocoder(photon('Berlin'), { gated: true });
    const { createPlaceSearch, applyPlaceResults } = await load();
    const search = createPlaceSearch();

    // The harsher half of the same bug: the debounce has fired and the request
    // is in the air when the user backspaces. Without the retire, this answer
    // arrived ~300 ms later and repopulated the list with results for a query
    // that is no longer on screen — and they stayed there until the next edit
    // long enough to search.
    const pending = search.search('ber');
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toHaveLength(1);

    search.cancel();
    open(); // the geocoder answers anyway; it never heard about the backspace
    await vi.advanceTimersByTimeAsync(0);

    expect(signals[0]!.aborted).toBe(true);
    expect(await pending).toBeNull();
    expect(applyPlaceResults(await pending, true, true)).toBeNull();
  });
});

describe('the geocoder’s bias is frozen for the life of an open palette', () => {
  it('keeps the reading taken at open while playback marches the focus on', async () => {
    const { holdNear } = await load();

    // `near` is the focused memory, and playback advances the focus roughly
    // once a second (the whole story is compressed into 45 s). Every one of
    // these used to rebuild the searcher.
    let held = holdNear(null, true, { lat: 52.5, lon: 13.4 });
    expect(held?.near).toEqual({ lat: 52.5, lon: 13.4 });
    for (const live of [{ lat: 48.8, lon: 2.3 }, { lat: 41.9, lon: 12.5 }, { lat: 35.7, lon: 139.7 }]) {
      held = holdNear(held, true, live);
      expect(held?.near).toEqual({ lat: 52.5, lon: 13.4 });
    }
  });

  it('releases on close so the next open reads the camera afresh', async () => {
    const { holdNear } = await load();

    const held = holdNear(null, true, { lat: 52.5, lon: 13.4 });
    // Closing releases it; a palette reopened after the story has flown
    // elsewhere should bias toward where the user is now.
    expect(holdNear(held, false, { lat: 48.8, lon: 2.3 })).toBeNull();
    expect(holdNear(null, true, { lat: 48.8, lon: 2.3 })?.near).toEqual({ lat: 48.8, lon: 2.3 });
  });

  it('stays unbiased for the whole session when nothing was focused at open', async () => {
    const { holdNear } = await load();

    // "No bias" is a reading like any other — which is why a held reading is
    // wrapped rather than being the bias itself. Picking a bias up mid-session
    // would rebuild the searcher, which is the failure being fixed.
    const atOpen = holdNear(null, true, undefined);
    expect(atOpen).not.toBeNull();
    expect(atOpen?.near).toBeUndefined();
    expect(holdNear(atOpen, true, { lat: 48.8, lon: 2.3 })?.near).toBeUndefined();
  });

  it('copies the caller’s object rather than holding its reference', async () => {
    const { holdNear } = await load();

    // AtlasApp builds this inline from the focused memory every render; holding
    // the reference would pin that render's memory for as long as the palette
    // is open.
    const live = { lat: 52.5, lon: 13.4 };
    const held = holdNear(null, true, live);
    expect(held?.near).not.toBe(live);
    expect(held?.near).toEqual(live);
  });

  it('lets a debounce longer than the focus interval actually fire', async () => {
    vi.useFakeTimers();
    const { calls } = stubGeocoder(nominatim('Berlin'));
    const { createPlaceSearch, holdNear, applyPlaceResults } = await load();

    // The bug in one test. Nominatim's floor is 1.1 s and the focus advances
    // every ~250 ms, so a searcher rebuilt per focus change never survived long
    // enough for its timer to fire: no request ever went out and the status
    // line sat on "Searching places…" for as long as the palette stayed open.
    let held = holdNear(null, true, { lat: 52.5, lon: 13.4 });
    const search = createPlaceSearch({ provider: 'nominatim', near: held!.near, lang: 'en' });
    const pending = search.search('berl');

    for (let t = 0; t < 1200; t += 250) {
      held = holdNear(held, true, { lat: 35.7 + t / 1000, lon: 139.7 });
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(calls).toHaveLength(1);
    const found = applyPlaceResults(await pending, false, true);
    expect(found!.places.map((p) => p.name)).toEqual(['Berlin']);
    // And the request carried the bias from the moment the palette opened, not
    // wherever the fly-through had reached by the time the timer fired.
    expect(new URL(calls[0]!).searchParams.get('viewbox')).toBe('12.4,53.5,14.4,51.5');
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
