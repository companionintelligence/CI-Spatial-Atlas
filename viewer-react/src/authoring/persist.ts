import { Item as ItemSchema, type Item, type Story } from '@companion-atlas/story';
import { authoredItems, upsertItem } from './store.js';

/**
 * The shapes the user has drawn, kept across reloads.
 *
 * Same pattern as `layers/store.ts` and `scrapbook/useScrapbook.ts`: one
 * versioned key prefix, a scope suffix, a read that tolerates anything and
 * still returns a usable value, and a write that shrugs off a quota error.
 * Three things about *this* data made the choices differ, and all three are the
 * reason drawn shapes get persisted at all while imported geometry does not.
 *
 * **Why localStorage is the right home, when it was the wrong one for imports.**
 * `interop/useImported.ts` deliberately keeps imported features in memory only,
 * because a dropped GeoJSON is routinely tens of megabytes and localStorage caps
 * out around 5 MB per origin — a persisted import would look successful and then
 * vanish on reload. Hand-drawn shapes are the opposite end of the size
 * distribution: a marker is ~100 bytes, and a polygon someone clicked out by
 * hand is tens of vertices, not tens of thousands. A whole session of drawing
 * is a few kilobytes, so the failure mode that ruled localStorage out for
 * imports simply is not reachable here.
 *
 * **Scoped to the account, not the story.** A scrapbook draft holds memory ids,
 * which only mean something inside one story, so it is story-scoped. Drawn
 * shapes are the user's own work-in-progress and should still be there after
 * they open a different story — but they must not follow them across accounts,
 * because a shared browser would otherwise show one person's annotations to the
 * next. So the scope is the connected memory (the account), matching
 * `useLayers`.
 *
 * **No inheritance from the signed-out bucket** — and this is where it parts
 * company with `layers/store.ts`, which deliberately hands the anonymous stack
 * to the first account that reads. A layer stack is a list of *sources*; drawn
 * shapes are *content*, and content that leaks across a sign-in boundary gets
 * merged into `exportStory` and written into whoever's Companion Memory happens
 * to be connected. Inheriting someone else's annotations into your own saved
 * story is not a cosmetic bug, so each scope — the anonymous bucket included —
 * keeps strictly to itself.
 */

const PREFIX = 'atlas.drawn.v1';

/** `null` scope = the anonymous bucket (no memory connected yet). */
export const keyFor = (scope: string | null): string => (scope ? `${PREFIX}:${scope}` : PREFIX);

/** The storage this module talks to. Injected in tests, and *absent* in a
 *  Node/SSR/worker context — every entry point below tolerates that rather
 *  than throwing on a missing global. */
export type AuthoringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): AuthoringStorage | null {
  try {
    // Private mode in some browsers throws on *access*, not on use.
    return (globalThis as { localStorage?: AuthoringStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Accept either the current envelope or a bare array — an earlier draft, or
 *  someone pasting an item list straight into the key with devtools open. */
function entriesOf(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const items = (parsed as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

/**
 * Coerce stored entries into canonical `Item`s, dropping anything that isn't.
 *
 * Validation is the schema's, not a hand-written shape check: these values are
 * merged straight into a `Story` by `mergeAuthoredItems` and then serialised,
 * exported to KML and rendered — so anything that would fail `Story.parse` on
 * the way out has to be refused on the way *in*, while the user can still see
 * and fix the rest. A partially recovered set is a recoverable state; a throw
 * during hydration is a white screen.
 *
 * `source.kind` is stamped when it is missing because that flag is what
 * `authoredItems()` uses to decide a shape is the user's own and therefore
 * editable. A stored item without it would come back as read-only geometry the
 * user drew themselves and can no longer touch.
 */
export function coerceItems(parsed: unknown): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const entry of entriesOf(parsed)) {
    const result = ItemSchema.safeParse(entry);
    if (!result.success) continue;
    const item = result.data as Item;
    // A duplicate id makes `EntityCollection.add` throw and blanks the whole
    // drawing layer (`redrawItems` guards the same hazard). Order here is draw
    // order and later shapes paint over earlier ones, so the first occurrence
    // keeps its position and the duplicate is dropped rather than reordered.
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item.source?.kind ? item : { ...item, source: { ...item.source, kind: 'manual' } });
  }
  return out;
}

/** Read one scope's drawn shapes. Never throws, and never falls back to another
 *  scope's bucket — see the note at the top about content vs. sources. */
export function readItems(
  scope: string | null,
  storage: AuthoringStorage | null = defaultStorage(),
): Item[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(keyFor(scope));
  } catch {
    return []; // storage blocked entirely
  }
  if (raw == null) return [];
  try {
    return coerceItems(JSON.parse(raw));
  } catch {
    // Truncated by a quota error mid-write, or hand-edited into invalid JSON.
    return [];
  }
}

/**
 * Persist one scope's drawn shapes.
 *
 * Silent on failure: a full quota or a private-mode window must not take the
 * drawing tools down with it, and the shapes are still on the globe and still
 * in `exportStory` for this session either way. An empty array is *written*,
 * not removed — deleting the last shape is a deliberate act and must survive a
 * reload, which a `removeItem` would leave indistinguishable from "nothing
 * stored yet".
 */
export function writeItems(
  scope: string | null,
  items: readonly Item[],
  storage: AuthoringStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(scope), JSON.stringify({ v: 1, items }));
  } catch {
    /* quota, private mode, or storage disabled — the session still works */
  }
}

/** Forget one scope's shapes. */
export function clearItems(
  scope: string | null,
  storage: AuthoringStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(scope));
  } catch {
    /* nothing to do about it, and nothing depends on it */
  }
}

/**
 * The set to adopt when a scope resolves: the shapes the loaded story already
 * carries, with the stored bucket merged on top.
 *
 * Stored wins on an id collision. Both describe the same drawn shape — the ids
 * are allocated by `nextItemId` and travel with the item into `Scene.itemIds` —
 * and the stored copy is the one that can hold edits made after the last save,
 * because saving is a button and drawing is not. Anything in the story that was
 * never drawn in this browser survives rather than being replaced by an empty
 * bucket, which is what makes opening a shared story on a second machine show
 * its author's shapes instead of nothing.
 */
export function hydrateItems(story: Story | null | undefined, stored: readonly Item[]): Item[] {
  return stored.reduce<Item[]>(upsertItem, authoredItems(story));
}
