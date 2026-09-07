import { describe, expect, it } from 'vitest';
import type { Item } from '@companion-atlas/story';
import {
  canRedo,
  canUndo,
  COALESCE_WINDOW_MS,
  createHistory,
  currentItems,
  describeAction,
  HISTORY_LIMIT,
  record,
  redo,
  redoLabel,
  resetHistory,
  sameItems,
  sameSummary,
  summarize,
  undo,
  undoLabel,
  type HistoryState,
} from '../src/authoring/history.js';
import { historyIntent, typingInFormField } from '../src/authoring/gesture.js';
import { moveItem, removeItem, upsertItem } from '../src/authoring/store.js';

/**
 * Undo/redo over committed authoring actions.
 *
 * Before this existed the only undo in the feature was `undoVertex`, which pops
 * a point off the shape *in progress* — so a deleted polygon was gone
 * permanently. That is the behaviour under test: not "the array can be stepped
 * backwards", but "the specific losses a person actually suffers are
 * recoverable, and the specific things that must NOT be undoable are not".
 *
 * Two areas get disproportionate attention because both fail invisibly:
 *
 *  - **Granularity.** A drag emits geometry on every pointer sample. If each
 *    became an entry, undo would walk the shape back one pixel at a time and be
 *    useless — but it would still *look* like it worked.
 *  - **The keyboard gate.** Ctrl+Z inside a text field must belong to the
 *    browser. Stealing it there is unrecoverable in both directions: the typing
 *    is gone and a shape the user never asked about comes back.
 */

const p = (lon: number, lat: number) => ({ lon, lat });

const marker = (id: string, lon = 0, lat = 0): Item => ({
  id, type: 'marker', position: p(lon, lat), source: { kind: 'manual' },
});

const polygon = (id: string): Item => ({
  id,
  type: 'polygon',
  positions: [p(0, 0), p(1, 0), p(1, 1)],
  source: { kind: 'manual' },
});

/** Record a create, for brevity. */
const created = (h: HistoryState, items: Item[], type = 'marker', at = 0) =>
  record(h, items, { kind: 'create', label: describeAction('create', type) }, at);

describe('the shape of a history', () => {
  it('starts on its baseline with nothing to undo or redo', () => {
    const h = createHistory([marker('m1')]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(currentItems(h)).toHaveLength(1);
    expect(undoLabel(h)).toBeNull();
    expect(redoLabel(h)).toBeNull();
  });

  it('copies the baseline, so a later mutation of the caller\'s array cannot rewrite the past', () => {
    const items = [marker('m1')];
    const h = createHistory(items);
    items.push(marker('m2'));
    expect(currentItems(h)).toHaveLength(1);
  });
});

describe('recording, undoing and redoing the five authoring actions', () => {
  it('brings back a deleted shape — the loss this feature exists for', () => {
    const shape = polygon('draw-polygon-1');
    let h = createHistory([shape]);
    h = record(h, removeItem([shape], shape.id), { kind: 'delete', label: 'delete area' }, 100);

    expect(currentItems(h)).toEqual([]);
    h = undo(h);
    expect(currentItems(h)).toEqual([shape]);
    // And the exact same object, not a reconstruction of it — a snapshot
    // history cannot lose a field an inverse operation would have had to
    // reconstruct correctly.
    expect(currentItems(h)[0]).toBe(shape);
  });

  it('undoes a create, a move, a vertex edit and a restyle', () => {
    const a = marker('m1');
    let h = createHistory([]);
    h = created(h, [a], 'marker', 10);

    const moved = moveItem(a, 1, 1);
    h = record(h, upsertItem([a], moved), { kind: 'move', label: 'move marker' }, 20);

    const reshaped = { ...moved, position: p(5, 5) };
    h = record(h, upsertItem([moved], reshaped), { kind: 'vertex', label: 'reshape marker' }, 30);

    const restyled = { ...reshaped, color: '#ff8d6e' };
    h = record(h, upsertItem([reshaped], restyled), { kind: 'restyle', label: 'restyle marker' }, 40);

    expect(currentItems(h)).toEqual([restyled]);
    h = undo(h); expect(currentItems(h)).toEqual([reshaped]);
    h = undo(h); expect(currentItems(h)).toEqual([moved]);
    h = undo(h); expect(currentItems(h)).toEqual([a]);
    h = undo(h); expect(currentItems(h)).toEqual([]);
    expect(canUndo(h)).toBe(false);

    // …and all the way forward again.
    h = redo(h); h = redo(h); h = redo(h); h = redo(h);
    expect(currentItems(h)).toEqual([restyled]);
    expect(canRedo(h)).toBe(false);
  });

  it('returns the SAME state when there is nothing to step to', () => {
    // Identity is what tells the key handler it did not consume the keystroke,
    // which is what stops it stealing Ctrl+Z from a page that could use it.
    const h = createHistory([]);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('drops the redo branch when a new action lands after an undo', () => {
    let h = createHistory([]);
    h = created(h, [marker('m1')], 'marker', 10);
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    h = created(h, [marker('m2')], 'marker', 20);
    // The future that contained m1 no longer contains the present.
    expect(canRedo(h)).toBe(false);
    expect(currentItems(h).map((i) => i.id)).toEqual(['m2']);
  });

  it('labels what the next step would do, for the button', () => {
    let h = createHistory([]);
    h = record(h, [polygon('p1')], { kind: 'create', label: describeAction('create', 'polygon') }, 10);
    expect(undoLabel(h)).toBe('add area');
    h = undo(h);
    expect(redoLabel(h)).toBe('add area');
    expect(undoLabel(h)).toBeNull();
  });

  it('uses the words the user sees — a polygon is an "area"', () => {
    expect(describeAction('create', 'polygon')).toBe('add area');
    expect(describeAction('delete', 'line')).toBe('delete line');
    expect(describeAction('move', 'marker')).toBe('move marker');
    expect(describeAction('vertex', 'polygon')).toBe('reshape area');
    expect(describeAction('restyle', 'note')).toBe('restyle note');
    // An unknown or absent type still reads as English.
    expect(describeAction('delete')).toBe('delete shape');
  });
});

describe('granularity — one entry per gesture, never per event', () => {
  it('records nothing for a change that changed nothing', () => {
    const items = [marker('m1')];
    const h = createHistory(items);
    // A drag that ended where it began: `store.ts` returns the input untouched,
    // so the entry would be a step that undoes to itself.
    const same = record(h, items, { kind: 'move', label: 'move marker' }, 10);
    expect(same).toBe(h);
    expect(canUndo(same)).toBe(false);
  });

  it('collapses a slider drag into one entry, inside the window', () => {
    const base = polygon('p1');
    let h = createHistory([base]);
    // What the fill-opacity range input does: one event per pixel of travel.
    for (let i = 1; i <= 20; i++) {
      const next = { ...base, fillOpacity: i / 20 };
      h = record(h, [next], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' }, i * 30);
    }
    // One undo, not twenty — and it lands on the state before the drag.
    expect(summarize(h).depth).toBe(1);
    h = undo(h);
    expect(currentItems(h)).toEqual([base]);
  });

  it('does not collapse two decisions separated by a pause', () => {
    const base = polygon('p1');
    let h = createHistory([base]);
    const first = { ...base, fillColor: '#ff8d6e' };
    h = record(h, [first], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' }, 0);
    const second = { ...first, fillColor: '#72ddd4' };
    h = record(
      h, [second],
      { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' },
      COALESCE_WINDOW_MS + 1,
    );
    expect(summarize(h).depth).toBe(2);
    h = undo(h);
    expect(currentItems(h)).toEqual([first]);
  });

  it('never coalesces across different items', () => {
    let h = createHistory([polygon('p1'), polygon('p2')]);
    h = record(h, [polygon('p1'), polygon('p2')], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' }, 0);
    h = record(h, [polygon('p1'), polygon('p2')], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p2' }, 10);
    expect(summarize(h).depth).toBe(2);
  });

  it('never coalesces an action with no key — a drag release is atomic', () => {
    const a = marker('m1');
    let h = createHistory([a]);
    h = record(h, [moveItem(a, 1, 0)], { kind: 'move', label: 'move marker' }, 0);
    h = record(h, [moveItem(a, 2, 0)], { kind: 'move', label: 'move marker' }, 5);
    expect(summarize(h).depth).toBe(2);
  });

  it('never coalesces into an entry the user has already stepped back through', () => {
    const base = polygon('p1');
    let h = createHistory([base]);
    h = record(h, [{ ...base, fillOpacity: 0.5 }], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' }, 0);
    h = record(h, [{ ...base, fillOpacity: 0.6 }], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' }, 10);
    h = undo(h);
    // Now at the baseline with a redo available. A same-keyed action here must
    // fork rather than silently rewrite the entry that redo points at.
    h = record(h, [{ ...base, fillOpacity: 0.9 }], { kind: 'restyle', label: 'restyle area', coalesceKey: 'restyle:p1' }, 20);
    expect(canRedo(h)).toBe(false);
    expect(currentItems(h)[0]).toMatchObject({ fillOpacity: 0.9 });
    h = undo(h);
    expect(currentItems(h)).toEqual([base]);
  });
});

describe('bounds', () => {
  it('keeps at most HISTORY_LIMIT undoable steps, dropping the oldest', () => {
    let h = createHistory([]);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) {
      h = created(h, [marker(`m${i}`)], 'marker', i);
    }
    expect(summarize(h).depth).toBe(HISTORY_LIMIT);
    // Still exactly reversible within the window.
    for (let i = 0; i < HISTORY_LIMIT; i++) h = undo(h);
    expect(canUndo(h)).toBe(false);
    // And what it landed on is a real recorded state, not an empty baseline
    // invented by the trim.
    expect(currentItems(h)).toHaveLength(1);
  });
});

describe('what must never be undoable', () => {
  it('re-bases on an external item list rather than recording it', () => {
    let h = createHistory([marker('m1')]);
    h = created(h, [marker('m1'), marker('m2')], 'marker', 10);
    expect(canUndo(h)).toBe(true);

    // A story load / a sign-in scope change / hydration from storage.
    h = resetHistory(h, [marker('other-account-1')]);
    // Undoing back through that would restore a different document's shapes.
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(currentItems(h).map((i) => i.id)).toEqual(['other-account-1']);
  });

  it('has no entry point for a measurement', () => {
    // Enforced by types as much as by this test: `record` takes `Item[]`, and a
    // `Measurement` is not an `Item` and has no id — see `measure.ts`. This
    // asserts the consequence: an unchanged item list records nothing, which is
    // the only thing a measurement could ever hand it.
    const items = [marker('m1')];
    const h = createHistory(items);
    expect(record(h, items, { kind: 'move', label: 'move marker' }, 1)).toBe(h);
  });
});

describe('sameItems — what counts as a change', () => {
  it('is reference-based, matching store.ts\'s persistent operations', () => {
    const a = marker('m1');
    expect(sameItems([a], [a])).toBe(true);
    expect(sameItems([a], [{ ...a }])).toBe(false); // a real second edit
    expect(sameItems([a], [])).toBe(false);
    const list = [a];
    expect(sameItems(list, list)).toBe(true);
  });
});

describe('the summary a toolbar renders', () => {
  it('only reports a difference when the answer actually moved', () => {
    let h = createHistory([]);
    h = created(h, [marker('m1')], 'marker', 10);
    const first = summarize(h);
    h = created(h, [marker('m1'), marker('m2')], 'marker', 20);
    const second = summarize(h);
    // Both say "you can undo", but the depth and the label moved, so a consumer
    // that repaints on difference still repaints — the guard is against
    // *identical* summaries, not against every second action.
    expect(sameSummary(first, second)).toBe(false);
    expect(sameSummary(first, { ...first })).toBe(true);
  });
});

describe('the keyboard gate', () => {
  const chord = (over: Record<string, unknown> = {}) =>
    ({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

  it('reads Ctrl+Z and Cmd+Z as undo', () => {
    expect(historyIntent(chord({ ctrlKey: true }))).toBe('undo');
    expect(historyIntent(chord({ metaKey: true }))).toBe('undo');
  });

  it('reads Ctrl/Cmd+Shift+Z as redo, including the capital Z browsers report', () => {
    expect(historyIntent(chord({ ctrlKey: true, shiftKey: true }))).toBe('redo');
    // With Shift held, `event.key` is 'Z'. A case-sensitive test here makes redo
    // silently do nothing, which is exactly the kind of dead control this
    // codebase has paid for before.
    expect(historyIntent(chord({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('honours Ctrl+Y on Windows but leaves Cmd+Y to the browser', () => {
    expect(historyIntent(chord({ key: 'y', ctrlKey: true }))).toBe('redo');
    // Cmd+Y is Safari/Chrome's History window on macOS.
    expect(historyIntent(chord({ key: 'y', metaKey: true }))).toBeNull();
  });

  it('never fires inside a text field — the browser owns undo there', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(typingInFormField({ tagName })).toBe(true);
      expect(historyIntent(chord({ ctrlKey: true, target: { tagName } }))).toBeNull();
    }
    expect(historyIntent(chord({ ctrlKey: true, target: { isContentEditable: true } }))).toBeNull();
    // …but a keystroke aimed at anything else is ours.
    expect(historyIntent(chord({ ctrlKey: true, target: { tagName: 'CANVAS' } }))).toBe('undo');
  });

  it('ignores AltGr combinations, which report as Ctrl+Alt', () => {
    expect(historyIntent(chord({ ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('ignores a bare z, and anything that is not z or y', () => {
    expect(historyIntent(chord())).toBeNull();
    expect(historyIntent(chord({ key: 'a', ctrlKey: true }))).toBeNull();
    expect(historyIntent(null)).toBeNull();
    expect(historyIntent({} as never)).toBeNull();
  });
});
