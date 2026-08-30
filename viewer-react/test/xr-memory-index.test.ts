import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AtlasMemory } from '../src/model/atlasModel.js';
import {
  applyAction,
  ARRIVE,
  buildMenu,
  categories,
  framingForMemory,
  haversineKm,
  initialMenuState,
  initials,
  located,
  matchesText,
  renderedRadius,
  selectMemories,
  TRAVEL_RADIUS_M,
  travelRadius,
  viewAnchor,
  type MenuState,
} from '../src/renderers/xr/memoryIndex.js';
import { rowAtPoint } from '../src/renderers/xr/labelCard.js';
import {
  createWorldTransform,
  EARTH_RADIUS_M,
  earthToPlayer,
  frameGlobe,
  geodeticToEarth,
} from '../src/renderers/xr/worldTransform.js';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

const SF = { lat: 37.7749, lon: -122.4194 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };
const PARIS = { lat: 48.8566, lon: 2.3522 };

const DAY = 86_400_000;

function mem(over: Partial<AtlasMemory> & { id: string }): AtlasMemory {
  return {
    title: 'Untitled',
    timeMs: 0,
    whenDate: 'Jan 1, 2020',
    whenTime: '12:00 PM',
    tod: 'day',
    gradient: '',
    ...over,
  };
}

const ARCHIVE: AtlasMemory[] = [
  mem({ id: 'a', title: 'Coffee on Valencia', place: 'Four Barrel', category: 'calendar', timeMs: 3 * DAY, ...SF }),
  mem({ id: 'b', title: 'Dinner in Shibuya', place: 'Tokyo', category: 'travel', timeMs: 5 * DAY, ...TOKYO }),
  mem({ id: 'c', title: 'Bookshop on the quay', place: 'Paris', category: 'travel', timeMs: 1 * DAY, ...PARIS }),
  mem({ id: 'd', title: 'Coffee near the office', place: 'Paris', category: 'commerce', timeMs: 9 * DAY, ...PARIS }),
  // No coordinates: on no globe, so on no list either.
  mem({ id: 'e', title: 'A thought', timeMs: 12 * DAY }),
];

describe('the index only holds what can be travelled to', () => {
  it('drops memories with no coordinates', () => {
    expect(located(ARCHIVE).map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(selectMemories(ARCHIVE, initialMenuState()).map((m) => m.id)).not.toContain('e');
  });
});

describe('ordering', () => {
  it('sorts by recency, newest first', () => {
    const order = selectMemories(ARCHIVE, initialMenuState()).map((m) => m.id);
    expect(order).toEqual(['d', 'b', 'a', 'c']);
  });

  it('sorts by proximity to the current view', () => {
    const fromTokyo = selectMemories(ARCHIVE, initialMenuState({ order: 'nearby', origin: TOKYO }));
    expect(fromTokyo.map((m) => m.id)).toEqual(['b', 'a', 'c', 'd']);

    const fromParis = selectMemories(ARCHIVE, initialMenuState({ order: 'nearby', origin: PARIS }));
    // Paris has two memories; either may come first, but SF and Tokyo trail them.
    expect(fromParis.slice(0, 2).map((m) => m.id).sort()).toEqual(['c', 'd']);
    expect(fromParis[3]!.id).toBe('b');
  });

  it('falls back to recency when nothing has been rendered yet', () => {
    const noOrigin = selectMemories(ARCHIVE, initialMenuState({ order: 'nearby', origin: null }));
    expect(noOrigin.map((m) => m.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('measures great-circle distance', () => {
    // SF→Tokyo is ~8,270 km; the classic textbook figure.
    expect(haversineKm(SF, TOKYO)).toBeGreaterThan(8_200);
    expect(haversineKm(SF, TOKYO)).toBeLessThan(8_350);
    expect(haversineKm(SF, SF)).toBeCloseTo(0, 9);
  });
});

describe('filtering', () => {
  it('matches every token, in any order, over title, place, category and date', () => {
    const tokyo = ARCHIVE[1]!;
    expect(matchesText(tokyo, 'shibuya')).toBe(true);
    expect(matchesText(tokyo, 'TOKYO dinner')).toBe(true); // order-independent, case-insensitive
    expect(matchesText(tokyo, 'travel')).toBe(true); // category
    expect(matchesText(tokyo, '2020')).toBe(true); // date
    expect(matchesText(tokyo, 'dinner paris')).toBe(false); // every token must land
    expect(matchesText(tokyo, '   ')).toBe(true); // an empty query is not a filter
  });

  it('filters by category and by initial', () => {
    expect(categories(ARCHIVE)).toEqual(['calendar', 'commerce', 'travel']);
    expect(initials(ARCHIVE)).toEqual(['B', 'C', 'D']); // 'A thought' has no location

    const travel = selectMemories(ARCHIVE, initialMenuState({ category: 'travel' }));
    expect(travel.map((m) => m.id)).toEqual(['b', 'c']);

    const cs = selectMemories(ARCHIVE, initialMenuState({ initial: 'C' }));
    expect(cs.map((m) => m.id)).toEqual(['d', 'a']);
  });

  it('combines text with the other filters', () => {
    const both = selectMemories(ARCHIVE, initialMenuState({ text: 'coffee', category: 'calendar' }));
    expect(both.map((m) => m.id)).toEqual(['a']);
  });
});

describe('the panel', () => {
  const state = (over: Partial<MenuState> = {}) => initialMenuState({ pageSize: 2, ...over });
  const kinds = (rows: { action: { kind: string } }[]) => rows.map((r) => r.action.kind);
  const pick = (view: ReturnType<typeof buildMenu>, kind: string) =>
    view.rows.filter((r) => r.action.kind === kind);

  it('pages the list and says where you are in it', () => {
    const first = buildMenu(ARCHIVE, state());
    expect(first.heading).toBe('Memories 1–2 of 4');
    expect(first.pages).toBe(2);
    expect(pick(first, 'select').map((r) => (r.action as { memory: AtlasMemory }).memory.id)).toEqual(['d', 'b']);
    // Nowhere to go back to on page one.
    expect(kinds(first.rows)).toContain('page');
    expect(first.rows.filter((r) => r.action.kind === 'page')).toHaveLength(1);

    const second = buildMenu(ARCHIVE, state({ page: 1 }));
    expect(second.heading).toBe('Memories 3–4 of 4');
    expect(second.rows.filter((r) => r.action.kind === 'page')).toHaveLength(1); // only "previous"
    expect((second.rows.find((r) => r.action.kind === 'page')!.action as { page: number }).page).toBe(0);
  });

  it('clamps a page past the end rather than showing an empty list', () => {
    const view = buildMenu(ARCHIVE, state({ page: 99 }));
    expect(view.page).toBe(1);
    expect(pick(view, 'select')).toHaveLength(2);
  });

  it('reaches every located memory by paging alone — no voice, no filters', () => {
    const seen = new Set<string>();
    const pages = buildMenu(ARCHIVE, state()).pages;
    for (let p = 0; p < pages; p++) {
      for (const row of buildMenu(ARCHIVE, state({ page: p })).rows) {
        if (row.action.kind === 'select') seen.add(row.action.memory.id);
      }
    }
    expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('offers voice when it exists and says so plainly when it does not', () => {
    const without = buildMenu(ARCHIVE, state({ voiceAvailable: false }));
    // Inert rather than a button that silently does nothing when pulled.
    expect(without.rows[0]!.action.kind).toBe('none');
    expect(without.rows[0]!.label).toMatch(/no voice/i);

    const with_ = buildMenu(ARCHIVE, state({ voiceAvailable: true }));
    expect(with_.rows[0]!.action.kind).toBe('voice');

    const listening = buildMenu(ARCHIVE, state({ voiceAvailable: true, listening: true }));
    expect(listening.rows[0]!.label).toMatch(/^Listening/);
  });

  it('shows how far away things are once the list is sorted by distance', () => {
    const view = buildMenu(ARCHIVE, state({ order: 'nearby', origin: TOKYO, pageSize: 4 }));
    const labels = pick(view, 'select').map((r) => r.label);
    expect(labels[0]).toMatch(/Dinner in Shibuya/);
    expect(labels[0]).toMatch(/here$/); // you are standing on it
    expect(labels[1]).toMatch(/8,2\d\d km$/);
  });

  it('says so when nothing matches, instead of going blank', () => {
    const view = buildMenu(ARCHIVE, state({ text: 'submarine' }));
    expect(view.total).toBe(0);
    expect(view.heading).toBe('Memories · 0 of 4');
    expect(view.rows.some((r) => /Nothing matches/.test(r.label))).toBe(true);
    expect(view.rows.some((r) => r.action.kind === 'clear')).toBe(true);
  });

  it('cycles a filter through its values and back to off', () => {
    let s = state();
    const next = (st: MenuState) =>
      buildMenu(ARCHIVE, st).rows.find((r) => r.action.kind === 'category')!.action;

    expect(next(s)).toEqual({ kind: 'category', category: 'calendar' });
    s = applyAction(s, next(s));
    expect(next(s)).toEqual({ kind: 'category', category: 'commerce' });
    s = applyAction(s, next(s));
    s = applyAction(s, next(s)); // → travel
    expect(s.category).toBe('travel');
    s = applyAction(s, next(s)); // → off again
    expect(s.category).toBeNull();
  });

  it('returns to page one whenever the list under it changes', () => {
    const s = applyAction(state({ page: 1 }), { kind: 'category', category: 'travel' });
    expect(s.page).toBe(0);
    expect(applyAction(state({ page: 1 }), { kind: 'page', page: 1 }).page).toBe(1);
    expect(applyAction(state({ page: 3, text: 'x', initial: 'C' }), { kind: 'clear' })).toMatchObject({
      page: 0,
      text: '',
      initial: null,
      category: null,
    });
  });
});

describe('pointing at a row', () => {
  const rows = [
    { top: 0, bottom: 0.25 },
    { top: 0.25, bottom: 0.5 },
    { top: 0.5, bottom: 0.75 },
  ];

  it('maps a point on the card to the row drawn there', () => {
    expect(rowAtPoint(rows, 0.5, 0.1)).toBe(0);
    expect(rowAtPoint(rows, 0.5, 0.3)).toBe(1);
    expect(rowAtPoint(rows, 0.02, 0.74)).toBe(2);
  });

  it('misses off the card, and below the last row', () => {
    expect(rowAtPoint(rows, 0.5, 0.9)).toBe(-1); // the card's bottom padding
    expect(rowAtPoint(rows, -0.01, 0.3)).toBe(-1);
    expect(rowAtPoint(rows, 1.2, 0.3)).toBe(-1);
    expect(rowAtPoint(undefined, 0.5, 0.3)).toBe(-1);
  });
});

describe('travelling to a memory', () => {
  const head = v(0, 1.6, 0);
  const forward = v(0, 0, -1);

  /** Where the memory's own patch of ground ends up, in player space. */
  const ground = (t: ReturnType<typeof createWorldTransform>, at: { lat: number; lon: number }) =>
    earthToPlayer(t, geodeticToEarth(at.lat, at.lon, 0, new Vector3()), new Vector3());

  it('puts the chosen memory in front of the viewer, facing them', () => {
    const t = createWorldTransform();
    framingForMemory(t, { ...TOKYO, head, forward, radius: 0.45 });

    const spot = ground(t, TOKYO);
    const expected = v(0, head.y - ARRIVE.drop, -ARRIVE.distance);
    // Two millimetres, and the two millimetres are the ellipsoid: a surface
    // point's *radius* vector and its *normal* differ by up to 0.19° at mid
    // latitudes, and the framing aligns the normal. Everything below carries
    // the same residual for the same reason.
    expect(spot.distanceTo(expected)).toBeLessThan(0.002);

    // In front, not merely somewhere: the head-to-memory direction is the view
    // direction, and the memory's surface normal points back at the head.
    const toMemory = spot.clone().sub(head).normalize();
    expect(toMemory.dot(forward)).toBeGreaterThan(0.99);

    const normal = earthToPlayer(t, geodeticToEarth(TOKYO.lat, TOKYO.lon, 1e6, new Vector3()), new Vector3())
      .sub(spot)
      .normalize();
    expect(normal.angleTo(head.clone().sub(spot).normalize())).toBeLessThan(0.002); // 0.11°

    // And it arrives at the size it was asked for, in reach.
    expect(renderedRadius(t)).toBeCloseTo(0.45, 6);
    expect(t.position.distanceTo(head)).toBeCloseTo(ARRIVE.distance + 0.45, 2);
  });

  it('ignores how far down the viewer is looking', () => {
    // Picking from a wrist panel means looking down. Honouring that pitch would
    // park the planet at their feet.
    const t = createWorldTransform();
    framingForMemory(t, { ...SF, head, forward: v(0, -0.9, -0.44).normalize(), radius: 0.45 });
    const spot = ground(t, SF);
    // Same place a level gaze would have put it, not down by the viewer's feet.
    expect(spot.distanceTo(v(0, head.y - ARRIVE.drop, -ARRIVE.distance))).toBeLessThan(0.002);
  });

  it('brings a memory on the far side of the planet round to the front', () => {
    const t = createWorldTransform();
    // Framed on San Francisco, so its antipode is the far pole of the globe:
    // over the horizon, no pin drawn, and — before the wrist menu — unreachable
    // without hunting for it by hand.
    const ANTIPODE = { lat: -SF.lat, lon: SF.lon + 180 };
    frameGlobe(t, { ...SF, centre: v(0, 1.52, -1.15), facing: head, radius: 0.45 });

    const normalTo = (spot: Vector3) =>
      earthToPlayer(t, geodeticToEarth(ANTIPODE.lat, ANTIPODE.lon, 1e6, new Vector3()), new Vector3())
        .sub(spot)
        .normalize()
        .dot(head.clone().sub(spot).normalize());

    const before = ground(t, ANTIPODE);
    expect(normalTo(before)).toBeLessThan(-0.99); // facing directly away
    expect(before.distanceTo(head)).toBeGreaterThan(1.5);

    framingForMemory(t, { ...ANTIPODE, head, forward, radius: 0.45 });
    const after = ground(t, ANTIPODE);
    expect(normalTo(after)).toBeGreaterThan(0.99); // now facing the viewer
    expect(after.distanceTo(head)).toBeLessThan(1.2);
    expect(after.clone().sub(head).normalize().dot(forward)).toBeGreaterThan(0.99);
  });

  it('keeps the arrival zoom in a band you can still hold', () => {
    // Standing in a street (life size) — arriving there again would show a wall.
    expect(travelRadius(EARTH_RADIUS_M * 1)).toBe(TRAVEL_RADIUS_M.max);
    // Zoomed all the way out to a marble — too small to read a pin on.
    expect(travelRadius(0.02)).toBe(TRAVEL_RADIUS_M.min);
    // Anything sensible is left alone, so travelling does not undo a zoom.
    expect(travelRadius(0.7)).toBe(0.7);
    expect(travelRadius(NaN)).toBe(TRAVEL_RADIUS_M.min);
  });

  it('reads back the coordinate the viewer is looking at', () => {
    const t = createWorldTransform();
    framingForMemory(t, { lat: 0, lon: 12, head, forward, radius: 0.45 });
    const equator = viewAnchor(t, head);
    // On the equator the radius and the normal coincide, so this is exact.
    expect(equator.lat).toBeCloseTo(0, 6);
    expect(equator.lon).toBeCloseTo(12, 6);

    framingForMemory(t, { ...PARIS, head, forward, radius: 0.45 });
    const paris = viewAnchor(t, head);
    // Off the equator it is the sub-head point, which the normal/radius split
    // biases poleward by up to 0.19° — about 21 km. Longitude is untouched. That
    // is noise against the thousands of kilometres "nearest to this view" ranks
    // over, and this is the only thing the anchor is used for.
    expect(Math.abs(paris.lat - PARIS.lat)).toBeLessThan(0.2);
    expect(paris.lon).toBeCloseTo(PARIS.lon, 6);
  });
});
