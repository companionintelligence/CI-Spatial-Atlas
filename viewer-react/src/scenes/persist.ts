/**
 * The deck the user is writing, kept across reloads.
 *
 * Same pattern as `authoring/persist.ts` and `layers/store.ts`: one versioned
 * key prefix, a scope suffix, a read that tolerates anything and still returns
 * a usable value, and a write that shrugs off a quota error. The three
 * decisions that are specific to *this* data:
 *
 * **localStorage is the right home.** The size objection that rules it out for
 * imported geometry (`interop/useImported.ts` — a dropped GeoJSON is routinely
 * tens of megabytes against a ~5 MB origin cap) does not apply: a scene is a
 * title, a paragraph of Markdown, six numbers of camera and a handful of ids.
 * A long story is a few kilobytes. Drawn shapes made the same call for the same
 * reason.
 *
 * **Scoped to the account, not the story** — matching `useLayers` and the
 * drawing tools. A deck in progress is the user's own work and should still be
 * there when they come back, but it must not follow them across accounts: a
 * shared browser would otherwise show one person's half-written narration to
 * the next. `adoptedFrom` (below) is what keeps that scope from quietly
 * grafting one document's scenes onto another's export.
 *
 * **Nothing is inherited from the signed-out bucket.** `layers/store.ts`
 * deliberately hands the anonymous stack to the first account that reads it,
 * because a layer stack is a list of *sources*. Scenes are *content* — narration
 * the user wrote — and content that leaks across a sign-in boundary gets folded
 * into `exportStory` and written into whoever's Companion Memory is connected.
 * `authoring/persist.ts` refuses the same inheritance for the same reason.
 */
import { Scene as SceneSchema, type Scene } from '@companion-atlas/story';
import { dedupeScenes } from './model.js';

const PREFIX = 'atlas.scenes.v1';

/** `null` scope = the anonymous bucket (no memory connected yet). */
export const keyFor = (scope: string | null): string => (scope ? `${PREFIX}:${scope}` : PREFIX);

/** The storage this module talks to. Injected in tests, and *absent* in a
 *  Node/SSR/worker context — every entry point below tolerates that rather than
 *  throwing on a missing global. */
export type SceneStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): SceneStorage | null {
  try {
    // Private mode in some browsers throws on *access*, not on use.
    return (globalThis as { localStorage?: SceneStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * What one scope holds.
 *
 * `adoptedFrom` is the id of the document whose scenes this deck was seeded
 * from, or `null` when the deck was written from scratch. It has to be stored
 * next to the scenes rather than recomputed, because it is what makes a
 * deletion durable: with an account-scoped bucket and no provenance, the export
 * merge cannot tell "the user removed this document's third scene" from "these
 * scenes belong to a different document and this one's are none of their
 * business" — and guessing wrong either resurrects a deleted scene on every
 * reload or deletes a stranger's. See `withAuthoredScenes` in `./story.ts`.
 */
export interface SceneBucket {
  scenes: Scene[];
  adoptedFrom: string | null;
}

export const EMPTY_BUCKET: SceneBucket = { scenes: [], adoptedFrom: null };

/** Accept the current envelope or a bare array — an earlier draft, or someone
 *  pasting a scene list straight into the key with devtools open. */
function entriesOf(parsed: unknown): { entries: unknown[]; adoptedFrom: string | null } {
  if (Array.isArray(parsed)) return { entries: parsed, adoptedFrom: null };
  if (parsed && typeof parsed === 'object') {
    const p = parsed as { scenes?: unknown; adoptedFrom?: unknown };
    const from = typeof p.adoptedFrom === 'string' && p.adoptedFrom ? p.adoptedFrom : null;
    if (Array.isArray(p.scenes)) return { entries: p.scenes, adoptedFrom: from };
  }
  return { entries: [], adoptedFrom: null };
}

/**
 * Coerce stored entries into canonical `Scene`s, dropping anything that is not.
 *
 * Validation is the schema's, exactly as `coerceItems` does it for drawn
 * geometry, and for the same reason: these values are spliced into a `Story` by
 * `withAuthoredScenes` and then serialised, exported and rendered, so anything
 * that would fail `Story.parse` on the way out has to be refused on the way in
 * — while the user still gets the rest of their deck back. A partially
 * recovered story is a story the author can repair; a throw during hydration is
 * a white screen.
 *
 * `parsed.data` rather than the raw entry, so unknown keys a hand edit or an
 * older build left behind are stripped here instead of travelling into an
 * export. Order is preserved verbatim — it is the author's, and re-sorting it
 * by time would turn their flashback into a prologue (see `buildDeck`).
 */
export function coerceScenes(parsed: unknown): Scene[] {
  const out: Scene[] = [];
  for (const entry of entriesOf(parsed).entries) {
    const result = SceneSchema.safeParse(entry);
    if (result.success) out.push(result.data as Scene);
  }
  // A duplicate id gives two rows one React key and makes `indexOfScene` resume
  // a presentation on the wrong slide; first occurrence wins, so the surviving
  // scene keeps the position the author put it in.
  return dedupeScenes(out);
}

/** Read one scope's deck. Never throws, and never falls back to another scope's
 *  bucket — see the note at the top about content vs. sources. */
export function readScenes(
  scope: string | null,
  storage: SceneStorage | null = defaultStorage(),
): SceneBucket {
  if (!storage) return { ...EMPTY_BUCKET };
  let raw: string | null;
  try {
    raw = storage.getItem(keyFor(scope));
  } catch {
    return { ...EMPTY_BUCKET }; // storage blocked entirely
  }
  if (raw == null) return { ...EMPTY_BUCKET };
  try {
    const parsed = JSON.parse(raw);
    const scenes = coerceScenes(parsed);
    // An `adoptedFrom` with nothing left to adopt is a stale claim, and keeping
    // it would make the export merge treat every scene of a re-opened document
    // as deleted — the document would come back empty.
    const adoptedFrom = scenes.length ? entriesOf(parsed).adoptedFrom : null;
    return { scenes, adoptedFrom };
  } catch {
    // Truncated by a quota error mid-write, or hand-edited into invalid JSON.
    return { ...EMPTY_BUCKET };
  }
}

/**
 * Persist one scope's deck.
 *
 * Silent on failure: a full quota or a private-mode window must not take the
 * scene editor down with it, and the deck is still in memory and still in
 * `exportStory` for this session either way. An empty array is *written*, not
 * removed — deleting the last scene is a deliberate act and must survive a
 * reload, which a `removeItem` would leave indistinguishable from "nothing
 * stored yet".
 */
export function writeScenes(
  scope: string | null,
  bucket: { scenes: readonly Scene[]; adoptedFrom?: string | null },
  storage: SceneStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      keyFor(scope),
      JSON.stringify({ v: 1, scenes: bucket.scenes, adoptedFrom: bucket.adoptedFrom ?? null }),
    );
  } catch {
    /* quota, private mode, or storage disabled — the session still works */
  }
}

/** Forget one scope's deck. */
export function clearScenes(
  scope: string | null,
  storage: SceneStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(scope));
  } catch {
    /* nothing to do about it, and nothing depends on it */
  }
}
