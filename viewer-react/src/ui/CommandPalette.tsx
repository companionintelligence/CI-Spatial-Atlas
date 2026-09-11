import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlobeIcon, PinIcon, SearchIcon } from './icons.js';
import type { AtlasMemory } from '../model/atlasModel.js';
import { createPlaceSearch, MIN_QUERY_LENGTH, type GeoPlace, type PlaceSearch } from '../memory/geocode.js';

/**
 * A row in the palette. Memories come from the loaded story; places come from
 * the geocoder and exist only for as long as the query that found them.
 *
 * One flat list, not two: the keyboard, `aria-activedescendant` and the
 * scroll-into-view all index into a single array, and a pair of parallel lists
 * would give each of them its own chance to disagree about which row is
 * highlighted. The grouping in the DOM is derived from this order (see
 * `paletteGroups`), never the other way round.
 */
export type PaletteItem =
  | { kind: 'memory'; id: string; label: string; sub: string; memory: AtlasMemory }
  | { kind: 'place'; id: string; label: string; sub: string; place: GeoPlace };

/**
 * What the geocoder is doing, as far as the status line is concerned.
 *
 * `none` and `unreachable` are the same event as far as `geocode()` is
 * concerned — it resolves `[]` for "nothing matched" and for "the host 502'd,
 * the DNS failed, CORS refused", by design, because a search box has one way to
 * say nothing. That leaves the UI to tell the two apart from the outside, and
 * the honest answer is that it often cannot: see `placeStateFor`.
 */
export type PlaceState =
  /** Nothing asked for — the query is below the geocoder's minimum length. */
  | 'idle'
  | 'searching'
  /** Rows on screen. */
  | 'ready'
  /** The geocoder answered, and it genuinely had nothing for this query. */
  | 'none'
  /** Empty, from a geocoder that has never once answered with anything. */
  | 'unreachable'
  /** The browser itself says there is no network, so nothing was reachable. */
  | 'offline';

const LIST_ID = 'atlas-cmdk-list';
const optId = (i: number) => `atlas-cmdk-opt-${i}`;
const STATUS_ID = 'atlas-cmdk-status';

/**
 * Merge the story's memories and the geocoder's places into the palette's rows.
 *
 * Memories first, always. A user typing the title of a memory they already have
 * is the common case and the geocoder is the speculative one; interleaving by
 * some score would let "Berlin" the OSM city outrank "Berlin, 2019" the memory
 * on the strength of nothing but a shorter string.
 */
export function paletteItems(
  memories: readonly AtlasMemory[],
  places: readonly GeoPlace[],
  query: string,
): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const items: PaletteItem[] = memories
    .filter((m) => !q || `${m.title} ${m.place ?? ''} ${m.narrative ?? ''}`.toLowerCase().includes(q))
    .map((m) => ({
      kind: 'memory',
      id: `m:${m.id}`,
      label: m.title,
      sub: `${m.place ?? 'Memory'} · ${m.whenDate}`,
      memory: m,
    }));
  for (const p of places) {
    items.push({
      // The geocoder's own id is unique within a result set but says nothing
      // about which list it came from, and a memory id could collide with it.
      id: `p:${p.id}`,
      kind: 'place',
      label: p.name,
      sub: p.detail ?? p.kind ?? 'Place',
      place: p,
    });
  }
  return items;
}

export interface PaletteGroup {
  key: PaletteItem['kind'];
  label: string;
  /** `index` is the row's position in the flat list — what the keyboard moves through. */
  rows: { item: PaletteItem; index: number }[];
}

const GROUP_LABEL: Record<PaletteItem['kind'], string> = {
  memory: 'Memories',
  place: 'Places',
};

/**
 * Split the flat list into labelled runs, carrying each row's flat index along.
 *
 * A fold over *consecutive* kinds rather than two filters: the flat order is
 * what the arrow keys walk, so a grouping that could reorder rows relative to
 * their indices would highlight one row and open another.
 */
export function paletteGroups(items: readonly PaletteItem[]): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  items.forEach((item, index) => {
    const tail = groups[groups.length - 1];
    if (tail && tail.key === item.kind) tail.rows.push({ item, index });
    else groups.push({ key: item.kind, label: GROUP_LABEL[item.kind], rows: [{ item, index }] });
  });
  return groups;
}

export type PaletteKeyAction =
  | { type: 'ignore' }
  | { type: 'close' }
  /** Tab: put focus back on the input. The palette is a modal with one tab stop. */
  | { type: 'trap' }
  | { type: 'move'; active: number }
  | { type: 'run'; item: PaletteItem };

/**
 * The palette's keyboard, as a pure function of the key and the current list.
 *
 * Pure because this is the part worth testing and the part a DOM test cannot
 * reach cheaply: arrowing from the last memory into the first place is a
 * one-line invariant here and a rendered-and-clicked ordeal anywhere else.
 *
 * Movement clamps rather than wraps. Wrapping in a list whose tail is fetched
 * asynchronously means ArrowUp from the top lands on whatever the geocoder
 * happened to deliver a moment ago.
 */
export function paletteKey(
  key: string,
  active: number,
  items: readonly PaletteItem[],
): PaletteKeyAction {
  switch (key) {
    case 'Escape':
      return { type: 'close' };
    case 'Tab':
      return { type: 'trap' };
    case 'ArrowDown':
      return { type: 'move', active: items.length ? Math.min(items.length - 1, active + 1) : 0 };
    case 'ArrowUp':
      return { type: 'move', active: items.length ? Math.max(0, active - 1) : 0 };
    case 'Enter': {
      const item = items[active];
      return item ? { type: 'run', item } : { type: 'ignore' };
    }
    default:
      return { type: 'ignore' };
  }
}

/**
 * Read a resolved place search as a status.
 *
 * `everAnswered` is the only evidence available that the geocoder exists at
 * all: it is set the first time a search comes back with rows. An empty answer
 * from a geocoder that has already produced rows is a real "nothing matched";
 * an empty answer from one that never has is indistinguishable from a host that
 * is down, and the message for that state says exactly that rather than picking
 * a side. Guessing "no results" there is how a broken deployment looks like a
 * user who cannot spell.
 */
export function placeStateFor(
  results: readonly GeoPlace[],
  everAnswered: boolean,
  online: boolean,
): PlaceState {
  if (results.length > 0) return 'ready';
  if (!online) return 'offline';
  return everAnswered ? 'none' : 'unreachable';
}

export interface PlaceResult {
  places: GeoPlace[];
  state: PlaceState;
  everAnswered: boolean;
}

/**
 * Fold one resolved search into the palette's place state.
 *
 * `null` in, `null` out — and "out" means *apply nothing*. `PlaceSearch.search`
 * resolves `null` for a search a later keystroke superseded, and the rows it
 * would have replaced are the ones currently on screen; writing `[]` (or even
 * "searching") for a superseded answer makes the list flash empty between every
 * pair of keystrokes and, when two searches land out of order, flash backwards
 * to an older query's results.
 */
export function applyPlaceResults(
  found: readonly GeoPlace[] | null,
  everAnswered: boolean,
  online: boolean,
): PlaceResult | null {
  if (found === null) return null;
  const answered = everAnswered || found.length > 0;
  return { places: found.slice(), state: placeStateFor(found, answered, online), everAnswered: answered };
}

/** Where the camera is looking, as a bias for the geocoder. */
export interface NearBias {
  lat: number;
  lon: number;
}

/**
 * A reading of `near`, or `null` for "no reading taken".
 *
 * The wrapper is what separates "the palette is closed, nothing is held" from
 * "the palette is open and the reading it took was *no bias*" — two states a
 * bare `NearBias | null` cannot tell apart, and conflating them would let a
 * session that opened with nothing focused pick a bias up halfway through, i.e.
 * exactly the rebuild this freeze exists to prevent.
 */
export type HeldNear = { near?: NearBias } | null;

/**
 * The `near` bias one open palette searches with — taken when it opens, held
 * until it closes.
 *
 * The bias cannot be allowed to follow the camera, and that is not a
 * preference. `near` is the focused memory's position, and during playback the
 * focus advances every time the clock crosses a memory — a whole story
 * compressed into 45 seconds, so a few dozen memories means a new `near` about
 * once a second. The searcher is built from it, so every change tore down the
 * debounce and started it again; against Nominatim's 1.1 s request floor the
 * timer never survived long enough to fire, and the palette sat on "Searching
 * places…" for as long as the user kept it open. Freezing it here rather than
 * pausing the clock keeps the palette free of side effects on the globe: it is
 * a search box, and opening one should not stop the story.
 *
 * Idempotent while open, so the freeze is a property of the function and not of
 * how carefully the caller wired its dependency array — the version of this bug
 * that shipped was a dependency array.
 *
 * Pure, and separate from the component, because "the bias does not move while
 * the palette is open" is the whole invariant and this workspace's tests have
 * no DOM to observe it through.
 */
export function holdNear(held: HeldNear, open: boolean, live: NearBias | undefined): HeldNear {
  // Released on close so the *next* open takes a fresh reading — a palette
  // reopened after the story has flown elsewhere should bias toward there.
  if (!open) return null;
  if (held) return held;
  // Copied, not aliased: the caller builds this object inline from the focused
  // memory, and holding their reference would hold the memory too.
  return { near: live ? { lat: live.lat, lon: live.lon } : undefined };
}

/** The one line under the list. `undefined` when the rows speak for themselves. */
export function paletteStatus(items: readonly PaletteItem[], state: PlaceState): string | undefined {
  if (state === 'searching') return 'Searching places…';
  if (state === 'offline') return 'Places can’t be searched while you are offline.';
  if (state === 'unreachable') return 'No places found — the place search may be unavailable.';
  if (items.length > 0) return undefined;
  // Nothing at all. `idle` means the query is still too short for the geocoder,
  // so promising it searched places would be a lie.
  return state === 'idle' ? 'No matches' : 'No matching memories or places.';
}

/** The ⌘K palette — the redesign's replacement for XR SavedSearches: jump to a
 *  memory or place by keyboard. Implemented as an ARIA
 *  combobox+listbox (focus stays on the input; the active option is announced
 *  via aria-activedescendant) inside a focus-trapped modal dialog. */
export function CommandPalette({ open, memories, onClose, onSelect, onSelectPlace, near }: {
  open: boolean;
  memories: AtlasMemory[];
  onClose: () => void;
  onSelect: (m: AtlasMemory) => void;
  /**
   * Fly the camera to a geocoded place. Optional, and its absence turns the
   * geocoder off entirely rather than showing rows that do nothing when
   * clicked — a palette that cannot move the camera has no business sending a
   * user's keystrokes to a third party.
   *
   * The palette does not close itself here, exactly as it does not for
   * `onSelect`: the owner decides whether a jump ends the search.
   */
  onSelectPlace?: (place: GeoPlace) => void;
  /**
   * Where the camera is looking, to bias short queries. Cheap, and it is the
   * difference between "springfield" meaning the one nearby and the one in
   * Illinois.
   *
   * Read once per open and then held (see `holdNear`); a caller is free to let
   * this move with the camera, and it moves constantly during playback.
   */
  near?: NearBias;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [placeState, setPlaceState] = useState<PlaceState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<PlaceSearch | null>(null);
  /** Has this geocoder ever returned a row? See `placeStateFor`. */
  const answeredRef = useRef(false);
  /** The geocoder bias, frozen for the life of one open palette. See `holdNear`. */
  const heldNearRef = useRef<HeldNear>(null);

  // Reset + focus on open (before paint, so no stale-results flash); restore
  // focus to the trigger on close. Places are reset too — they belong to a
  // query, and last session's "Berlin" under an empty box is a ghost.
  useLayoutEffect(() => {
    // Take (or release) the bias here, and *only* here. `near` is deliberately
    // not a dependency: not re-running when it changes is precisely what
    // freezes it, and this effect runs before the passive effect below in the
    // same commit, so the searcher is always built from the reading taken at
    // the moment the palette opened.
    heldNearRef.current = holdNear(heldNearRef.current, open, near);
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setActive(0);
      setPlaces([]);
      setPlaceState('idle');
      inputRef.current?.focus();
    } else if (restoreRef.current) {
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  // Keep the highlighted option visible — the list is a fixed-height scroller,
  // so arrowing past the first screenful would otherwise lose the selection.
  useLayoutEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const placesEnabled = Boolean(onSelectPlace);

  // One searcher for the life of the open palette. `createPlaceSearch` *is* the
  // debounce, the request-floor pacing and the abort-on-supersede, and all of
  // that state lives in the instance: a new one per keystroke would race the
  // old one instead of superseding it, and would fire a request per letter at
  // an endpoint whose usage policy is somebody's goodwill.
  //
  // The deps are the two booleans and nothing else, which is the same argument
  // one step further. `onSelectPlace` is a prop a parent may rebuild every
  // render; `near` follows the focused memory and therefore changes about once
  // a second while the story plays. Either as a dependency tears the searcher
  // down mid-flight — cancelling the search the user is waiting for, restarting
  // a debounce that (at Nominatim's 1.1 s floor) then never gets to fire, and
  // leaving "Searching places…" on screen forever. The bias is read from the
  // ref the layout effect froze instead.
  //
  // Declared *above* the query effect: effects run in source order within a
  // commit, so the searcher exists before the first query effect looks for it.
  useEffect(() => {
    if (!open || !placesEnabled) return;
    const bias = heldNearRef.current?.near;
    const searcher = createPlaceSearch(bias ? { near: bias } : {});
    searchRef.current = searcher;
    return () => {
      // Retires the pending promise as well as the request in flight, so a
      // closed palette leaves nothing awaiting behind it.
      searcher.cancel();
      searchRef.current = null;
    };
  }, [open, placesEnabled]);

  useEffect(() => {
    const searcher = searchRef.current;
    if (!open || !searcher) return;
    if (query.trim().length < MIN_QUERY_LENGTH) {
      // Retire whatever is outstanding *first*. Clearing the list without it
      // only clears the list: the search started for the longer query is still
      // running, and when it lands `applyPlaceResults` sees a non-null answer
      // and repopulates the rows the user just backspaced away — "ber" wiped to
      // "b" fills the box with Berlin a moment later, and it stays there until
      // the next edit long enough to search. `cancel` resolves that pending
      // promise with null, which is the module's word for "superseded", so the
      // `.then` below returns without touching anything.
      searcher.cancel();
      // The geocoder resolves a too-short query with `[]` and sends nothing;
      // mirror that here so an emptied box clears on the same keystroke rather
      // than after a debounce that never runs.
      setPlaces([]);
      setPlaceState('idle');
      return;
    }
    setPlaceState('searching');
    void searcher.search(query).then((found) => {
      // `navigator.onLine` is only trustworthy in one direction — false really
      // does mean nothing left the machine — which is exactly the direction
      // that lets the status line stop blaming the query for a dead network.
      const next = applyPlaceResults(found, answeredRef.current, globalThis.navigator?.onLine !== false);
      if (!next) return; // superseded; whatever is on screen stays there
      answeredRef.current = next.everAnswered;
      setPlaces(next.places);
      setPlaceState(next.state);
    });
    // Only what a search actually depends on. `near` used to be listed here to
    // re-issue the search the effect above had just cancelled by rebuilding the
    // searcher; now that the bias is frozen for the open palette there is
    // nothing to re-issue, and keeping it would restart the debounce on every
    // step of the playback fly-through.
  }, [open, query, placesEnabled]);

  const items = useMemo<PaletteItem[]>(
    () => paletteItems(memories, places, query),
    [query, memories, places],
  );
  const groups = useMemo(() => paletteGroups(items), [items]);
  const status = paletteStatus(items, placeState);

  if (!open) return null;

  const run = (it: PaletteItem | undefined) => {
    if (!it) return;
    if (it.kind === 'memory') onSelect(it.memory);
    else onSelectPlace?.(it.place);
  };

  // Handled on the dialog so it works regardless of which descendant has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const action = paletteKey(e.key, active, items);
    if (action.type === 'ignore') return;
    e.preventDefault();
    if (action.type === 'close') onClose();
    else if (action.type === 'trap') inputRef.current?.focus(); // one tab stop: the input
    else if (action.type === 'move') setActive(action.active);
    else run(action.item);
  };

  return (
    <div className="atlas-cmdk-backdrop" onClick={onClose}>
      <div
        className="atlas-cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        // Clicking chrome (the esc badge, an option, the icon) must not blur the
        // input — every key handler lives on this dialog and needs focus inside.
        onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); }}
      >
        <div className="cmdk-input">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to a place, date, memory…"
            aria-label="Search memories and places"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-describedby={status ? STATUS_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? optId(active) : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              // Back to the top on every edit. Places are appended after the
              // memories, so an index that survived a keystroke would drift
              // onto a different row as the geocoder's tail changes under it.
              setActive(0);
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <ul className="cmdk-list" id={LIST_ID} role="listbox" aria-label="Results">
          {groups.map((g) => (
            // role="group" rather than a bare header row: a listbox owns options
            // and groups, and a screen reader reading "Places" as the group name
            // is what keeps a geocoder result from being announced as if it were
            // one of the user's own memories. The inner ul is role="none", so
            // the options remain the group's children in the a11y tree.
            <li key={g.key} role="group" aria-label={g.label} className="cmdk-group">
              <div
                aria-hidden="true"
                style={{
                  padding: '8px 12px 2px',
                  font: '600 10px/1.4 var(--atlas-mono)',
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  color: 'var(--atlas-fg-dim)',
                }}
              >
                {g.label}
              </div>
              <ul role="none" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.rows.map(({ item, index }) => (
                  <li
                    key={item.id}
                    id={optId(index)}
                    role="option"
                    aria-selected={index === active}
                    className={`cmdk-item${index === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(item)}
                  >
                    <span className="cmdk-ico">{item.kind === 'place' ? <GlobeIcon /> : <PinIcon />}</span>
                    <span className="cmdk-label">{item.label}</span>
                    <span className="cmdk-sub">{item.sub}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {status && (
          // Outside the listbox, and a live region: "Searching places…" has to
          // be announced when it changes, and a listbox that owns anything but
          // options and groups loses the option count screen readers read out.
          <div
            id={STATUS_ID}
            role="status"
            className="cmdk-empty"
            style={{ borderTop: items.length ? '1px solid var(--atlas-line)' : undefined }}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
