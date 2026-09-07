import type { Item } from '@companion-atlas/story';

/**
 * Undo/redo over committed authoring actions.
 *
 * ## What this is NOT
 *
 * It is not `undoVertex`. That one pops a point off the shape *in progress* —
 * a different gesture, at a different altitude, bound to a different key
 * (Backspace), and it stays exactly as it was. This is the level above: the
 * shapes that already exist. "Take that last point back" and "bring back the
 * polygon I deleted" are not two strengths of the same command, and collapsing
 * them onto one key would make Backspace-while-drawing occasionally resurrect a
 * deleted shape instead.
 *
 * ## Snapshots, not inverse operations
 *
 * Each entry holds the whole `Item[]` **after** its action. The alternative — a
 * log of inverse operations — is the textbook answer and is wrong here.
 *
 * An inverse log has to be exactly right for every operation, forever. Get one
 * inverse subtly wrong (a `moveItem` that clamped at the pole and is therefore
 * not reversible by negating the delta, a restyle that dropped a field Zod
 * strips) and the corruption is silent: undo appears to work and quietly
 * produces geometry that never existed. This codebase has already paid for one
 * "finished" feature that did nothing; a plausible-looking wrong undo is the
 * same failure wearing a better disguise.
 *
 * The cost of snapshots is memory, and here that cost is not real. The drawing
 * layer holds shapes a person made by hand — tens of items, each tens of
 * vertices. Fifty snapshots of that is a few hundred kilobytes against a Cesium
 * scene measured in hundreds of megabytes. And because `store.ts` is persistent
 * (every operation returns a new array and shares the untouched items by
 * reference), fifty snapshots of a list where one item changed is fifty arrays
 * of pointers, not fifty deep copies.
 *
 * ## Granularity
 *
 * One entry per *gesture*, never per event. Two mechanisms, because there are
 * two kinds of rapid-fire source:
 *
 *   - A drag emits a new geometry on every pointer move. The controller records
 *     nothing during the drag and one entry on release, so a drag is one entry
 *     by construction — there is no coalescing to get wrong.
 *   - A slider (fill opacity) emits on every pixel of travel and there is no
 *     "release" the controller sees. Those pass a `coalesceKey`, and
 *     consecutive entries sharing one within `COALESCE_WINDOW_MS` collapse into
 *     the latest. The time window is what stops "restyle it, walk away, restyle
 *     it again" from folding two separate decisions into one undo.
 *
 * ## What must never enter history
 *
 *   - **Measurements.** A measurement is a question, not content — it never
 *     touches `items`, so it cannot reach this module even by accident.
 *   - **Mode changes.** Arming the polygon tool changed nothing about the
 *     story; an undo that merely re-selected a previous tool would burn a step
 *     the user wanted to spend on their actual work.
 *   - **Selection.** Same reason.
 *   - **External adoption** — hydrating from storage, loading a story, a scope
 *     change on sign-in. Those `resetHistory` instead. Undoing *back through* a
 *     story load would restore a different document's shapes, and undoing back
 *     through a scope change would restore another account's.
 */

export type HistoryActionKind =
  /** The state a history starts from. Never undoable, never recorded — it only
   *  exists so `entries[index]` is always the live list, with no special case
   *  for "before the first action". */
  | 'baseline'
  | 'create'
  | 'delete'
  | 'move'
  | 'vertex'
  | 'restyle';

export interface HistoryAction {
  kind: HistoryActionKind;
  /** Shown on the undo button's tooltip: "Undo delete area". Written for a
   *  person, so it is a phrase and not an enum name. */
  label: string;
  /**
   * Consecutive entries with the same key, inside `COALESCE_WINDOW_MS`, are one
   * entry. Absent means "this gesture is atomic, never merge it".
   */
  coalesceKey?: string;
}

export interface HistoryEntry extends HistoryAction {
  /** The item list as it stood **after** this action. */
  items: Item[];
  /** When it was recorded, for the coalescing window. */
  at: number;
}

export interface HistoryState {
  /** Oldest first. `entries[0]` is the baseline — the state before anything
   *  undoable happened — and is never itself undoable. */
  entries: HistoryEntry[];
  /** Which entry is live. `entries[index].items` is the current state. */
  index: number;
}

/**
 * How many steps back the user can go.
 *
 * Fifty, not "unbounded". Unbounded is a slow leak in a tab people leave open
 * for a day, and nobody undoes fifty hand-drawn shapes — past about a dozen the
 * user reaches for the delete key on the specific thing they regret instead.
 */
export const HISTORY_LIMIT = 50;

/** How long two same-keyed actions stay one gesture, in ms. Long enough to
 *  cover a slider being dragged across its track with a pause in the middle;
 *  short enough that changing a colour, thinking, and changing it back are two
 *  undos, because they were two decisions. */
export const COALESCE_WINDOW_MS = 1200;

/** A fresh history with `items` as the baseline. */
export function createHistory(items: Item[] = []): HistoryState {
  return {
    entries: [{ items: [...items], kind: 'baseline', label: 'Initial state', at: 0 }],
    index: 0,
  };
}

/** The item list the history currently points at. Always defined — a history
 *  always has at least its baseline. */
export function currentItems(history: HistoryState): Item[] {
  return history.entries[history.index]?.items ?? [];
}

export function canUndo(history: HistoryState): boolean {
  return history.index > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.index < history.entries.length - 1;
}

/** "Delete area", or null when there is nothing to undo. The caller renders
 *  "Undo delete area"; the verb is not baked in so the same label can serve a
 *  tooltip, an `aria-label` and a status line. */
export function undoLabel(history: HistoryState): string | null {
  return canUndo(history) ? history.entries[history.index]?.label ?? null : null;
}

export function redoLabel(history: HistoryState): string | null {
  return canRedo(history) ? history.entries[history.index + 1]?.label ?? null : null;
}

/**
 * Two item lists that are the same list.
 *
 * Reference equality on the array, then on every element — which is exactly
 * what `store.ts`'s persistent operations give: an edit produces a new array
 * with one new element and the rest shared, and a no-op returns the input
 * untouched. So this is O(n) pointer compares, and it is what stops a drag that
 * ended where it started, or a restyle that set a field to the value it already
 * had, from burning an undo step on nothing.
 *
 * Deliberately NOT a deep compare: two structurally identical items produced by
 * two separate edits are two different edits, and the user is entitled to undo
 * the second one.
 */
export function sameItems(a: Item[], b: Item[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Record one committed action.
 *
 * Returns the same state object when nothing changed, so a caller can use
 * identity to decide whether to re-render.
 *
 * `now` is injected rather than read from `Date.now()` inside, because the
 * coalescing window is behaviour and behaviour gets a test — one that must not
 * depend on how fast the machine running it happens to be.
 */
export function record(
  history: HistoryState,
  items: Item[],
  action: HistoryAction,
  now: number = Date.now(),
): HistoryState {
  const live = currentItems(history);
  if (sameItems(live, items)) return history;

  const top = history.entries[history.index];
  const snapshot: HistoryEntry = { ...action, items: [...items], at: now };

  // Coalesce: same gesture, still in flight. Replaces the top entry rather than
  // pushing, so the state BEFORE the gesture is still the one entry below —
  // which is what makes a single undo take back the whole slider drag rather
  // than one pixel of it.
  const mergeable =
    !!top &&
    !!action.coalesceKey &&
    top.coalesceKey === action.coalesceKey &&
    // Only ever merge into the newest entry. Coalescing into an entry that has
    // been undone past would silently rewrite history the user has already
    // stepped back through.
    history.index === history.entries.length - 1 &&
    now - top.at <= COALESCE_WINDOW_MS;

  if (mergeable) {
    const entries = [...history.entries];
    entries[history.index] = snapshot;
    return { entries, index: history.index };
  }

  // A new action after an undo forks the timeline: the redo branch is gone.
  // This is the universal convention and the only defensible one — keeping it
  // would mean a redo could reinstate a shape from a future that no longer
  // contains the thing the user just did.
  const kept = history.entries.slice(0, history.index + 1);
  kept.push(snapshot);

  // Trim from the oldest end. The baseline goes with it, which is correct: past
  // the limit, that state is simply no longer reachable.
  const overflow = Math.max(0, kept.length - (HISTORY_LIMIT + 1));
  const entries = overflow > 0 ? kept.slice(overflow) : kept;
  return { entries, index: entries.length - 1 };
}

/** Step back. Returns the same state when there is nothing to undo, so the
 *  caller can tell a consumed keystroke from an ignored one — which is what
 *  decides whether to `preventDefault` and steal Ctrl+Z from the browser. */
export function undo(history: HistoryState): HistoryState {
  return canUndo(history) ? { entries: history.entries, index: history.index - 1 } : history;
}

export function redo(history: HistoryState): HistoryState {
  return canRedo(history) ? { entries: history.entries, index: history.index + 1 } : history;
}

/**
 * Throw the history away and start again from `items`.
 *
 * For every arrival of an item list the user did not author *in this session*:
 * hydration from storage, a story being loaded, a sign-in changing the scope.
 * See the header — an undo that steps back through one of those restores
 * someone else's document, or someone else's account.
 */
export function resetHistory(_history: HistoryState, items: Item[]): HistoryState {
  return createHistory(items);
}

/** What a toolbar needs to render the two buttons, with no `Item[]` in it —
 *  so a React consumer holds primitives and re-renders only when the *answer*
 *  changes, not on every snapshot. */
export interface HistorySummary {
  canUndo: boolean;
  canRedo: boolean;
  /** The action a press of undo would take back, e.g. `"delete area"`. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** How many steps back are available. Used by tests and by nothing else. */
  depth: number;
}

export function summarize(history: HistoryState): HistorySummary {
  return {
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undoLabel: undoLabel(history),
    redoLabel: redoLabel(history),
    depth: history.index,
  };
}

export function sameSummary(a: HistorySummary, b: HistorySummary): boolean {
  return (
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.undoLabel === b.undoLabel &&
    a.redoLabel === b.redoLabel &&
    a.depth === b.depth
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Human wording for the toolbar, in the app's own vocabulary — a polygon is
 *  an "area" everywhere the user can see, so it is an "area" here too. */
const TYPE_WORD: Record<string, string> = {
  marker: 'marker',
  note: 'note',
  line: 'line',
  polygon: 'area',
};

export function describeAction(kind: HistoryActionKind, itemType?: string): string {
  const what = (itemType && TYPE_WORD[itemType]) || 'shape';
  switch (kind) {
    case 'create': return `add ${what}`;
    case 'delete': return `delete ${what}`;
    case 'move': return `move ${what}`;
    case 'vertex': return `reshape ${what}`;
    case 'restyle': return `restyle ${what}`;
    default: return 'edit';
  }
}
