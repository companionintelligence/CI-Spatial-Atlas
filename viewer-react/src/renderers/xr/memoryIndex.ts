/**
 * What the wrist menu shows, in what order, and where travelling to a memory
 * puts the globe.
 *
 * The immersive path could reach six memories. Pins are drawn for all of them,
 * but only the handful nearest the gaze get a readable card, and the only way to
 * bring a different one round was to grab the planet and hunt for it by hand —
 * so an archive of 290 memories was, in practice, an archive of six. Everything
 * that fixes that is a *list* problem (which memories, in what order, on which
 * page) plus one piece of geometry (where the chosen one ends up), and none of
 * it needs a headset to be correct.
 *
 * So it all lives here, pure, and `WristMenu.tsx` is only the panel that draws
 * it. See `test/xr-memory-index.test.ts`.
 */
import { Vector3 } from 'three';
import type { AtlasMemory } from '../../model/atlasModel.js';
import {
  earthToGeodetic,
  EARTH_RADIUS_M,
  frameGlobe,
  playerToEarth,
  type WorldTransform,
} from './worldTransform.js';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export type MemoryOrder = 'recent' | 'nearby';

export interface MemoryQuery {
  /** Free text, from dictation or wherever else it came. */
  text: string;
  order: MemoryOrder;
  /** `category` filter, or null for everything. */
  category: string | null;
  /** First letter of the title, or null for any. The keyboard-free text filter. */
  initial: string | null;
  /** Where "nearby" is measured from — the point of the globe facing the viewer. */
  origin: GeoPoint | null;
}

export const EMPTY_QUERY: MemoryQuery = {
  text: '',
  order: 'recent',
  category: null,
  initial: null,
  origin: null,
};

/** Great-circle distance in kilometres. A sphere is plenty for ranking. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371.0088;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Only memories with coordinates can be listed: the menu's whole job is to fly
 * the globe to one, and a memory with no location has nowhere to fly to. They
 * are already absent from the pins for the same reason.
 */
export function located(memories: readonly AtlasMemory[]): AtlasMemory[] {
  return memories.filter((m) => m.lat != null && m.lon != null);
}

/** The searchable text of a memory. Date included so "2019" and "jun" work. */
function haystack(m: AtlasMemory): string {
  return `${m.title} ${m.place ?? ''} ${m.category ?? ''} ${m.whenDate}`.toLowerCase();
}

/**
 * Every whitespace-separated token has to appear somewhere. Dictation returns a
 * phrase in whatever order the speaker said it ("dinner tokyo"), and requiring
 * the whole phrase as a substring throws away most of what voice search is for.
 */
export function matchesText(m: AtlasMemory, text: string): boolean {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = haystack(m);
  return tokens.every((t) => hay.includes(t));
}

/** The `category` values actually present, sorted, for the filter to cycle. */
export function categories(memories: readonly AtlasMemory[]): string[] {
  const seen = new Set<string>();
  for (const m of located(memories)) if (m.category) seen.add(m.category);
  return [...seen].sort();
}

/**
 * The title initials actually present.
 *
 * This is the non-voice text filter. A full A–Z is 26 pulls of a trigger to
 * reach Z and most of them land on nothing; offering only the letters the
 * archive really uses keeps it to a few pulls and never dead-ends.
 */
export function initials(memories: readonly AtlasMemory[]): string[] {
  const seen = new Set<string>();
  for (const m of located(memories)) {
    const c = m.title?.trim()?.[0]?.toUpperCase();
    if (c) seen.add(/[A-Z]/.test(c) ? c : '#');
  }
  return [...seen].sort();
}

function initialOf(m: AtlasMemory): string {
  const c = m.title?.trim()?.[0]?.toUpperCase() ?? '#';
  return /[A-Z]/.test(c) ? c : '#';
}

/** Filter, then order. Ties break on id so the list never shuffles under a pointer. */
export function selectMemories(memories: readonly AtlasMemory[], query: MemoryQuery): AtlasMemory[] {
  const origin = query.origin;
  const matched = located(memories).filter(
    (m) =>
      (!query.category || m.category === query.category) &&
      (!query.initial || initialOf(m) === query.initial) &&
      matchesText(m, query.text),
  );

  if (query.order === 'nearby' && origin) {
    const km = new Map<string, number>();
    for (const m of matched) km.set(m.id, haversineKm(origin, { lat: m.lat!, lon: m.lon! }));
    return matched.sort((a, b) => km.get(a.id)! - km.get(b.id)! || a.id.localeCompare(b.id));
  }
  // No origin yet (nothing has been rendered) falls back to recency rather than
  // to an arbitrary order — the list must never come back empty-looking.
  return matched.sort((a, b) => b.timeMs - a.timeMs || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// The panel's rows
// ---------------------------------------------------------------------------

export type MenuAction =
  | { kind: 'voice' }
  | { kind: 'clear' }
  | { kind: 'order'; order: MemoryOrder }
  | { kind: 'category'; category: string | null }
  | { kind: 'initial'; initial: string | null }
  | { kind: 'page'; page: number }
  | { kind: 'select'; memory: AtlasMemory }
  | { kind: 'none' };

export interface MenuRow {
  label: string;
  action: MenuAction;
}

export interface MenuView {
  heading: string;
  rows: MenuRow[];
  /** How many memories matched, across all pages. */
  total: number;
  page: number;
  pages: number;
}

export interface MenuState extends MemoryQuery {
  page: number;
  pageSize: number;
  /** Dictation is running right now. */
  listening: boolean;
  /** This browser has a speech recogniser at all. */
  voiceAvailable: boolean;
}

export const DEFAULT_PAGE_SIZE = 6;

export function initialMenuState(overrides: Partial<MenuState> = {}): MenuState {
  return {
    ...EMPTY_QUERY,
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    listening: false,
    voiceAvailable: false,
    ...overrides,
  };
}

/** null → first → … → last → null, so every cycle can be undone by carrying on. */
function cycle<T>(values: readonly T[], current: T | null): T | null {
  if (current == null) return values[0] ?? null;
  const i = values.indexOf(current);
  return i < 0 || i === values.length - 1 ? null : values[i + 1]!;
}

export function isFiltered(query: MemoryQuery): boolean {
  return query.text.trim() !== '' || query.category != null || query.initial != null;
}

function formatKm(km: number): string {
  if (km < 1) return 'here';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

/**
 * A row: what it is, and where it sits in the order you asked for.
 *
 * It used to be title · place · date · distance, and measured against a real
 * 290-memory archive that ran to 58 characters at the median and 71 at the 90th
 * percentile — against a card that held 58. Something like two rows in five were
 * already being ellipsised, and the field that got cut was always the last one,
 * so *the sort key itself* disappeared from the rows it was ordering.
 *
 * The panel is now hand-sized (`wristPanel.ts`), which holds 43 characters, so
 * the row had to give something up rather than truncate harder. It gives up
 * whichever field you did not sort by: recency shows the date, proximity shows
 * the distance, and both fit whole. Place is the loss, and it is the right one —
 * the pin, the peek plate and the inspector all carry it already, and it is the
 * field a real archive most often has no value for (see the note in
 * `atlasModel.ts`: 147 of 791 located memories resolved to no place at all).
 */
function memoryLabel(m: AtlasMemory, state: MenuState): string {
  const title = m.title?.trim() || 'Untitled memory';
  const nearby = state.order === 'nearby' && state.origin && m.lat != null && m.lon != null;
  return nearby
    ? `${title} · ${formatKm(haversineKm(state.origin!, { lat: m.lat!, lon: m.lon! }))}`
    : `${title} · ${m.whenDate}`;
}

function searchRow(state: MenuState): MenuRow {
  if (state.listening) return { label: 'Listening — say a place, a year, a name', action: { kind: 'voice' } };
  if (state.text.trim()) return { label: `Search: “${state.text.trim()}” — speak again`, action: { kind: 'voice' } };
  // Speech recognition is missing in most non-Chromium browsers and in the
  // emulator, so the row says so rather than pretending; the filters below it
  // are the path that always exists.
  return state.voiceAvailable
    ? { label: 'Search: pull the trigger and speak', action: { kind: 'voice' } }
    : { label: 'Search: no voice here — use the filters', action: { kind: 'none' } };
}

/**
 * The whole panel, as lines of text plus what selecting each one does.
 *
 * Rows carry the action they *will* perform rather than a value to interpret,
 * so the pointer code is one switch and the interesting behaviour — what the
 * next category is, which page "Next" goes to — is testable without a scene.
 */
export function buildMenu(memories: readonly AtlasMemory[], state: MenuState): MenuView {
  const matched = selectMemories(memories, state);
  const pageSize = Math.max(1, state.pageSize);
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(0, state.page), pages - 1);
  const start = page * pageSize;
  const shown = matched.slice(start, start + pageSize);

  const rows: MenuRow[] = [searchRow(state)];
  rows.push({
    label: state.order === 'recent' ? 'Sort: most recent first' : 'Sort: nearest to this view',
    action: { kind: 'order', order: state.order === 'recent' ? 'nearby' : 'recent' },
  });

  const cats = categories(memories);
  if (cats.length > 1) {
    rows.push({
      label: `Kind: ${state.category ?? 'everything'}`,
      action: { kind: 'category', category: cycle(cats, state.category) },
    });
  }
  const letters = initials(memories);
  if (letters.length > 1) {
    rows.push({
      label: `Starts with: ${state.initial ?? 'any letter'}`,
      action: { kind: 'initial', initial: cycle(letters, state.initial) },
    });
  }
  if (isFiltered(state)) rows.push({ label: 'Clear the filters', action: { kind: 'clear' } });

  if (shown.length === 0) rows.push({ label: 'Nothing matches — clear a filter', action: { kind: 'none' } });
  for (const m of shown) rows.push({ label: memoryLabel(m, state), action: { kind: 'select', memory: m } });

  if (page > 0) rows.push({ label: 'Previous page', action: { kind: 'page', page: page - 1 } });
  if (page < pages - 1) rows.push({ label: 'Next page', action: { kind: 'page', page: page + 1 } });

  const heading = matched.length
    ? `Memories ${start + 1}–${start + shown.length} of ${matched.length}`
    : `Memories · 0 of ${located(memories).length}`;
  return { heading, rows, total: matched.length, page, pages };
}

/** Apply a row's action to the menu state. Selecting a memory is the caller's job. */
export function applyAction(state: MenuState, action: MenuAction): MenuState {
  switch (action.kind) {
    // Filtering changes what is on page 1, so staying on page 7 would show an
    // empty-looking list that the viewer has no reason to suspect is page 7.
    case 'order':
      return { ...state, order: action.order, page: 0 };
    case 'category':
      return { ...state, category: action.category, page: 0 };
    case 'initial':
      return { ...state, initial: action.initial, page: 0 };
    case 'clear':
      return { ...state, text: '', category: null, initial: null, page: 0 };
    case 'page':
      return { ...state, page: action.page };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

/**
 * The rendered radius the globe arrives at, in player metres.
 *
 * Travel keeps whatever zoom the viewer had, clamped into a band that is still
 * a graspable object in front of them. Without the clamp, choosing a memory
 * from a street-level view arrives with the planet the size of a planet — the
 * chosen memory is technically in front of you and there is nothing to see, and
 * no way back except a long two-handed zoom. Without keeping the zoom at all,
 * every pick would yank a viewer who was reading a city back out to a marble.
 */
export const TRAVEL_RADIUS_M = { min: 0.42, max: 1.1 };

export function travelRadius(currentRadiusM: number): number {
  if (!Number.isFinite(currentRadiusM) || currentRadiusM <= 0) return TRAVEL_RADIUS_M.min;
  return Math.min(TRAVEL_RADIUS_M.max, Math.max(TRAVEL_RADIUS_M.min, currentRadiusM));
}

/** How far in front of the head the chosen memory lands, and how far below eye level. */
export const ARRIVE = { distance: 1.15, drop: 0.08 };

const _forward = new Vector3();
const _at = new Vector3();
const _up = new Vector3();
const _centre = new Vector3();
const _earth = new Vector3();

/**
 * Where the world has to be for `lat`/`lon` to be the thing in front of you.
 *
 * `frameGlobe` turns a coordinate towards a viewer given where the globe's
 * *centre* goes; what a traveller cares about is where the *memory* goes. So
 * place the memory first — an arm's length ahead, a little below eye level —
 * and put the centre a radius behind it along the line back to the head.
 *
 * `forward` is flattened to the horizontal because the viewer is usually
 * looking down at a wrist panel when they pick. Honouring their pitch would
 * park the planet at their feet.
 */
export function framingForMemory(
  target: WorldTransform,
  opts: { lat: number; lon: number; head: Vector3; forward: Vector3; radius: number; distance?: number; drop?: number },
): WorldTransform {
  _forward.copy(opts.forward);
  _forward.y = 0;
  if (_forward.lengthSq() < 1e-8) _forward.set(0, 0, -1);
  _forward.normalize();

  const distance = opts.distance ?? ARRIVE.distance;
  _at.copy(opts.head).addScaledVector(_forward, distance);
  _at.y -= opts.drop ?? ARRIVE.drop;

  // The memory's surface normal has to point back at the head, so the centre
  // sits one rendered radius along that line, behind the memory.
  _up.copy(opts.head).sub(_at);
  if (_up.lengthSq() < 1e-12) _up.copy(_forward).negate();
  _up.normalize();
  _centre.copy(_at).addScaledVector(_up, -opts.radius);

  return frameGlobe(target, {
    lat: opts.lat,
    lon: opts.lon,
    centre: _centre,
    facing: opts.head,
    radius: opts.radius,
  });
}

/**
 * The coordinate the viewer is currently over — the point of the globe nearest
 * their head, which for a globe held in front of them is exactly the bit facing
 * them. This is what "nearest to this view" is measured from.
 */
export function viewAnchor(t: WorldTransform, head: Vector3): GeoPoint {
  playerToEarth(t, head, _earth);
  const g = earthToGeodetic(_earth);
  return { lat: g.lat, lon: g.lon };
}

/** The globe's rendered radius in player metres, for `travelRadius`. */
export function renderedRadius(t: WorldTransform): number {
  return EARTH_RADIUS_M * t.scale;
}
