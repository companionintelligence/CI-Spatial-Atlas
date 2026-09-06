import {
  clampOpacity,
  DEFAULT_OPACITY,
  isLayerFormat,
  makeLayerId,
  normaliseOrder,
  type AtlasLayer,
  type LayerAttribution,
  type LayerAvailability,
  type LayerOptions,
} from './model.js';
import { defaultOptionsFor, nameFromUrl } from './sniff.js';

/**
 * The user's layer stack, kept across reloads.
 *
 * Same pattern as `scrapbook/useScrapbook.ts`, deliberately: one versioned key
 * prefix, a scope suffix, a read that tolerates anything and returns a usable
 * value, and a write that shrugs off a quota error. The two differences from
 * the scrapbook are both about what the data means.
 *
 * **Scoped to the account, not the story.** A scrapbook draft collects memory
 * ids, which only mean something inside one story. A layer stack is the user's
 * own working set — the sources they keep going back to — and it should follow
 * them from story to story. It must *not* follow them across accounts: a shared
 * browser would otherwise show one person's saved layers to the next, and a
 * layer URL can be a private endpoint. Hence the account id as the scope.
 *
 * **It persists when signed out, too.** `useScrapbook` refuses to write against
 * the unscoped key because an unscoped memory-id draft is meaningless; a layer
 * stack is perfectly meaningful before anyone signs in, and losing it on reload
 * would be a bug. Signed-out layers go in the anonymous bucket, and the first
 * read for a freshly signed-in account inherits from it (see `readLayers`) so
 * that signing in does not look like the app threw the user's work away.
 */

const PREFIX = 'atlas.layers.v1';

/** `null` scope = the anonymous bucket (nobody signed in yet). */
export const keyFor = (scope: string | null): string => (scope ? `${PREFIX}:${scope}` : PREFIX);

/** The storage this module talks to. Injected in tests, and *absent* in a
 *  Node/SSR/worker context — every entry point below tolerates that rather than
 *  throwing on a missing global. */
export type LayerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): LayerStorage | null {
  try {
    // Private mode in some browsers throws on *access*, not on use.
    return (globalThis as { localStorage?: LayerStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Coerce one stored entry into a layer, or `null` if it is beyond saving.
 *
 * Nothing here trusts the input. The stored value has three plausible origins —
 * this version of the app, an older one, and a human with the devtools open —
 * and only the first is guaranteed to be well-formed. A field that cannot be
 * repaired falls back to a working default; an entry with no usable URL or an
 * unknown format is dropped, because a layer that cannot be fetched cannot be
 * fixed by guessing.
 */
export function coerceLayer(raw: unknown, index: number): AtlasLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;

  // `url` is the current field; `uri` is what the Story schema calls it, and a
  // stored draft may well have come from a story export someone pasted in.
  const url = typeof p.url === 'string' ? p.url.trim() : typeof p.uri === 'string' ? p.uri.trim() : '';
  if (!url) return null;
  if (!isLayerFormat(p.format)) return null;
  const format = p.format;

  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : nameFromUrl(url);
  const order = typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : index;
  const attribution = coerceAttribution(p.attribution);
  const availability = coerceAvailability(p.availability);

  return {
    id: typeof p.id === 'string' && p.id ? p.id : makeLayerId(name),
    name,
    format,
    url,
    // Absent means visible: a stack read back from an older version that had no
    // visibility flag should show what the user collected, not hide it.
    visible: p.visible !== false,
    opacity: p.opacity == null ? DEFAULT_OPACITY : clampOpacity(p.opacity),
    order,
    ...(attribution ? { attribution } : {}),
    ...(availability ? { availability } : {}),
    ...(p.options && typeof p.options === 'object'
      ? { options: { ...defaultOptionsFor(format).options, ...(p.options as LayerOptions) } }
      : defaultOptionsFor(format)),
    ...(typeof p.catalogId === 'string' ? { catalogId: p.catalogId } : {}),
  };
}

function coerceAttribution(raw: unknown): LayerAttribution | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.text !== 'string' || !a.text.trim()) return null;
  return {
    text: a.text.trim(),
    ...(typeof a.licence === 'string' ? { licence: a.licence } : {}),
    ...(typeof a.url === 'string' ? { url: a.url } : {}),
    ...(a.onScreen === true ? { onScreen: true } : {}),
  };
}

function coerceAvailability(raw: unknown): LayerAvailability | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.start !== 'string' || !a.start) return null;
  // `end` is the older Atlas spelling of `stop`; see `story.ts`.
  const stop = typeof a.stop === 'string' ? a.stop : typeof a.end === 'string' ? a.end : undefined;
  return { start: a.start, ...(stop ? { stop } : {}) };
}

/** Accept either the current envelope or a bare array — an earlier draft, or
 *  someone pasting a layer list straight into the key. */
function entriesOf(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const layers = (parsed as { layers?: unknown }).layers;
    if (Array.isArray(layers)) return layers;
  }
  return [];
}

function readKey(storage: LayerStorage, key: string): AtlasLayer[] | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null; // storage blocked entirely
  }
  if (raw == null) return null; // *absent*, which is different from "stored and empty"
  try {
    const entries = entriesOf(JSON.parse(raw));
    const layers = entries
      .map((e, i) => coerceLayer(e, i))
      .filter((l): l is AtlasLayer => l !== null);
    // Drop duplicate ids before they become duplicate React keys and edits that
    // hit two rows at once. The later entry wins, matching `story.ts` — the
    // stored order is append order, so the last write is the current state.
    const byId = new Map<string, AtlasLayer>();
    for (const l of layers) byId.set(l.id, l);
    return normaliseOrder([...byId.values()]);
  } catch {
    // Truncated by a quota error mid-write, or hand-edited into invalid JSON.
    // An empty stack is a recoverable state; a thrown parse error at mount is
    // a white screen, so this returns "nothing stored" and the user starts over
    // with their layers rather than with the app.
    return [];
  }
}

/**
 * Read the stack for an account.
 *
 * Falls back to the anonymous bucket only when the account has *no* stored
 * value at all — not when it has an empty one. Someone who deliberately removed
 * every layer must not have their signed-out set silently reappear on the next
 * reload; someone who added layers before signing in should keep them.
 */
export function readLayers(scope: string | null, storage: LayerStorage | null = defaultStorage()): AtlasLayer[] {
  if (!storage) return [];
  const own = readKey(storage, keyFor(scope));
  if (own) return own;
  if (scope) return readKey(storage, keyFor(null)) ?? [];
  return [];
}

/** Persist the stack. Silent on failure: a full quota or a private-mode window
 *  must not take the layer panel down with it. */
export function writeLayers(
  scope: string | null,
  layers: readonly AtlasLayer[],
  storage: LayerStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(scope), JSON.stringify({ v: 1, layers: normaliseOrder(layers) }));
  } catch {
    /* quota, private mode, or storage disabled — the session still works */
  }
}

/** Forget one account's stack (used by "remove all", and on sign-out cleanup). */
export function clearLayers(scope: string | null, storage: LayerStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(scope));
  } catch {
    /* nothing to do about it, and nothing depends on it */
  }
}
