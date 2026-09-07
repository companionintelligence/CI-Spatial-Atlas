/**
 * What a scene may attach: the story entities that can actually stand behind a
 * slide, and the check that says whether a narration URL will ever be heard.
 *
 * ## Why this exists at all
 *
 * `Scene.itemIds` and `Scene.audioUrl` have had working consumers for as long
 * as the presenter has existed — `sceneBackground` turns the first into a slide
 * background, `sceneAudio.ts` plays the second on scene enter — and there has
 * been no way to *write* either one. This module is the authoring half's rules.
 *
 * ## The one rule that makes the picker honest
 *
 * `Scene.itemIds` is a list of ids into `story.items` / `story.media`, and an id
 * only produces a background when it names an entry of the right shape **in the
 * story the globe is rendering**. So a free-text id box, or a picker fed from
 * the derived view-model, would both be controls that silently do nothing: the
 * author types an id, the slide stays on its tint, and nothing anywhere says
 * why. The resolver below therefore walks the story in `sceneBackground`'s exact
 * order and by its exact rules — including the video-poster subtlety, where a
 * video's own `url` is skipped because an `<img>` cannot show it — and offers
 * only what will resolve.
 *
 * That mirroring is load-bearing twice over. Because the candidate list is
 * produced in resolution order, "which of the attached ids is actually on the
 * slide" is answered by the *first candidate in this list that the scene
 * attaches* — the same answer `sceneBackground` arrives at by scanning the
 * story, without this module re-deriving that scan a second (and eventually
 * different) way.
 *
 * Pure and DOM-free, like the rest of `scenes/` except the hook: everything
 * here is the kind of rule that is wrong invisibly — a picker offering a
 * `ci-memory://` address that paints nothing, a narration URL accepted at entry
 * and dropped at playback — so it is the part that gets tested.
 */
import { sceneHighlightIds, type MediaItem, type Scene, type Story } from '@companion-atlas/story';
import { isLoadableMedia, safeMediaUrl } from '../ui/safeUrl.js';
import { solarLocal } from '../model/atlasModel.js';

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * What kind of thing a candidate is — enough for the picker to label it, not a
 * copy of the schema's two type vocabularies.
 *
 * `Item.type` and `MediaItem.kind` are different enumerations for overlapping
 * things (a photo is `type: 'photo'` in one and `kind: 'image'` in the other),
 * and the picker only ever needs to answer "what am I looking at, and is the
 * picture the thing itself or a still of it". `other` is deliberately a bucket:
 * a `model3d` or `pointcloud` entry whose `uri` happens to be loadable *is*
 * offered, because `sceneBackground` would resolve it, and mirroring beats
 * inventing a rule the presenter does not share.
 */
export type SceneMediaKind = 'photo' | 'video' | 'audio' | 'pano' | 'image' | 'other';

/** The picker's badge for each kind. Here rather than in the component so the
 *  vocabulary and the resolver that produces it stay in one file. */
export const SCENE_MEDIA_KIND_LABEL: Record<SceneMediaKind, string> = {
  photo: 'Photo',
  video: 'Video',
  audio: 'Audio',
  pano: '360°',
  image: 'Image',
  other: 'File',
};

export interface SceneMediaCandidate {
  /** The id to write into `Scene.itemIds`. */
  id: string;
  /** Which of the story's two entity forms this was resolved from. Reported so
   *  a test (and a bug report) can say *why* a candidate exists, rather than
   *  inferring it from the shape of the URL. */
  source: 'items' | 'media';
  kind: SceneMediaKind;
  /** Something an author recognises. Never empty — falls back to the id, which
   *  is at least addressable, rather than to a blank tile. */
  label: string;
  /** Place and/or date, when the entry knows them. The dominant real archive is
   *  forty photos of the same place, so the tile needs a second line to be
   *  pickable at all. */
  detail?: string;
  /**
   * Exactly the URL `sceneBackground` will resolve for this id — already
   * through `safeMediaUrl`, already past `isLoadableMedia`.
   */
  backgroundUrl: string;
  /**
   * The cheapest loadable rendition of the same asset, for the picker tile.
   *
   * A separate field because the drawer paints these at thumbnail size over a
   * live globe, and pulling forty full-resolution originals to do it is a
   * visible cost on the frame rate the author is judging their camera by. It is
   * always the *same asset* as `backgroundUrl` — a rendition, never a different
   * picture — and falls back to it when the entry carries only one URL.
   */
  thumbUrl: string;
  /**
   * True when the picture is a still standing in for something that is not a
   * still: a video's poster, an audio track's artwork. The tile has to say so,
   * because "attach the harbour video" and "attach a frame of it" look
   * identical in a 64px square and only one of them is what the slide shows.
   */
  isPoster: boolean;
}

export interface SceneMediaPool {
  /** In `sceneBackground`'s own resolution order — see the header. */
  candidates: SceneMediaCandidate[];
  /**
   * How many picture-bearing entries were examined and produced nothing
   * loadable.
   *
   * The difference between the two empty states, and the reason the empty
   * picker can explain itself: a KML import has no pictures at all, while a
   * Companion Memory archive is *full* of them at `ci-memory://` addresses the
   * pipeline resolves and a browser cannot fetch. Those are the same blank box
   * and completely different problems. Audio-only entries are not counted: an
   * audio track without artwork is not a photo that failed.
   */
  unreachable: number;
  /** Of those, how many carried a URL a browser cannot fetch (ci-memory://…) —
   *  a pipeline-address problem the author may be able to act on. */
  atInternalAddresses: number;
  /** And how many simply had no still image: a video with no poster frame, a
   *  3D asset with no picture. Nothing is wrong with those addresses. */
  withoutAStill: number;
}

/** The first of `urls` a browser could actually load, sanitised — the exact
 *  test `sceneBackground` applies, and the only place this module decides
 *  whether a URL is usable. */
function firstLoadable(urls: readonly (string | undefined)[]): string | null {
  for (const u of urls) if (isLoadableMedia(u)) return safeMediaUrl(u)!;
  return null;
}

/**
 * Did this entry carry a URL a browser simply cannot fetch — an internal
 * `ci-memory://` address the pipeline resolves — as opposed to carrying nothing
 * usable as a *still*?
 *
 * The distinction is the difference between two very different pieces of advice.
 * A posterless video whose `media.url` is a perfectly fetchable https link is
 * not an address problem, and telling its author to go looking for one sends
 * them after a bug that does not exist. This feature exists to stop controls
 * lying about why they are empty; the explanation has to hold to the same
 * standard.
 */
function hasInternalAddress(urls: readonly (string | undefined)[]): boolean {
  return urls.some((u) => typeof u === 'string' && u.trim() !== '' && !isLoadableMedia(u) && /^[a-z][a-z0-9+.-]*:/i.test(u.trim()));
}

const trimmed = (...parts: (string | undefined)[]): string | undefined => {
  for (const p of parts) {
    const t = typeof p === 'string' ? p.trim() : '';
    if (t) return t;
  }
  return undefined;
};

type TimeLike = string | { at?: string; start?: string; end?: string; stop?: string } | undefined;

/**
 * A date for the tile's second line, in *local solar* time at the entry's
 * longitude — the same convention `whenLabel` uses for a slide's eyebrow, so
 * the picker and the slide never disagree about what day a photo is from.
 * Deterministic (it does the arithmetic in UTC and shifts), which is also what
 * makes it assertable in a suite that does not control the machine's zone.
 */
function whenText(time: TimeLike, lon?: number): string | undefined {
  const iso = typeof time === 'string' ? time : (time?.at ?? time?.start);
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : solarLocal(ms, lon).whenDate;
}

const detailOf = (place: string | undefined, when: string | undefined, usedAsLabel: string) =>
  [place && place !== usedAsLabel ? place : undefined, when].filter(Boolean).join(' · ') || undefined;

/** `MediaItem.kind` → the picker's vocabulary. */
function mediaKind(kind: MediaItem['kind']): SceneMediaKind {
  switch (kind) {
    case 'image': case 'image-set': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'pano360': return 'pano';
    default: return 'other';
  }
}

/**
 * Every entity in a story that can serve as a slide background.
 *
 * Walks `story.items` then `story.media`, exactly as `sceneBackground` does,
 * and keeps the **first** resolution for any id — which is not the same as
 * keeping the first *entry* with that id. The same photo commonly appears in
 * both arrays (a Companion Memory import writes the `MediaItem`, a later
 * Earth-2 pass writes the `Item`), and if the `items` copy resolves to nothing
 * loadable while the `media` copy does, `sceneBackground` falls through to the
 * `media` copy — so this does too, and the deduplication is by *resolved id*
 * rather than by id seen.
 */
export function sceneMediaPool(story: Story | null | undefined): SceneMediaPool {
  const candidates: SceneMediaCandidate[] = [];
  const resolved = new Set<string>();
  const examined = new Set<string>();
  // Why an examined entry produced nothing, so the empty message can say the
  // true thing rather than the most common one.
  const internal = new Set<string>();
  const noStill = new Set<string>();

  for (const item of story?.items ?? []) {
    if (item.type !== 'photo' && item.type !== 'video') continue;
    examined.add(item.id);
    if (resolved.has(item.id)) continue;
    // A video's poster is a still; its `url` is not something an <img> shows.
    // Skipping it here is the whole reason the picker cannot offer a tile that
    // paints a broken-image glyph across a full-screen slide.
    const own = item.type === 'photo' ? item.media?.url : undefined;
    const tried = [own, item.media?.posterUrl, item.media?.thumbnailUrl];
    const backgroundUrl = firstLoadable(tried);
    if (!backgroundUrl) {
      // A video whose only URL is its (fetchable) `media.url` has no still —
      // that is a missing poster frame, not an address problem.
      if (hasInternalAddress(tried)) internal.add(item.id);
      else noStill.add(item.id);
      continue;
    }
    resolved.add(item.id);
    const label = trimmed(item.title, item.placeName) ?? item.id;
    candidates.push({
      id: item.id,
      source: 'items',
      kind: item.type,
      label,
      detail: detailOf(item.placeName, whenText(item.time as TimeLike, item.position?.lon), label),
      backgroundUrl,
      thumbUrl: firstLoadable([item.media?.thumbnailUrl, item.media?.posterUrl, own]) ?? backgroundUrl,
      isPoster: item.type === 'video',
    });
  }

  for (const m of story?.media ?? []) {
    // A `video`/`audio` entry can only ever contribute its thumbnail — the
    // `uri` is the track itself. Same branch as `sceneBackground`.
    const still = m.kind === 'video' || m.kind === 'audio';
    if (m.kind !== 'audio') examined.add(m.id);
    if (resolved.has(m.id)) continue;
    const tried = still ? [m.thumbnailUri] : [m.uri, m.thumbnailUri];
    const backgroundUrl = firstLoadable(tried);
    if (!backgroundUrl) {
      if (hasInternalAddress(tried)) internal.add(m.id);
      else noStill.add(m.id);
      continue;
    }
    resolved.add(m.id);
    const label = trimmed(m.caption, m.locationName) ?? m.id;
    candidates.push({
      id: m.id,
      source: 'media',
      kind: mediaKind(m.kind),
      label,
      detail: detailOf(m.locationName, whenText(m.capturedAt, m.location?.lon), label),
      backgroundUrl,
      thumbUrl: firstLoadable([m.thumbnailUri, still ? undefined : m.uri]) ?? backgroundUrl,
      isPoster: still,
    });
  }

  let unreachable = 0;
  let atInternalAddresses = 0;
  let withoutAStill = 0;
  for (const id of examined) {
    if (resolved.has(id)) continue;
    unreachable++;
    if (internal.has(id)) atInternalAddresses++;
    else if (noStill.has(id)) withoutAStill++;
  }
  return { candidates, unreachable, atInternalAddresses, withoutAStill };
}

/** The candidates alone, for a caller that does not need to explain an empty
 *  picker. */
export const sceneMediaCandidates = (story: Story | null | undefined): SceneMediaCandidate[] =>
  sceneMediaPool(story).candidates;

/**
 * What the picker says when it has nothing to offer.
 *
 * An empty box is the one outcome that teaches nothing, and both of the ways to
 * get here are ordinary: a KML or GeoJSON import brings places and no pictures,
 * and a Companion Memory archive brings hundreds of pictures at addresses only
 * the pipeline can resolve. Naming which one it is turns "this feature is
 * broken" into "this document has nothing to attach, and here is why".
 */
export function sceneMediaEmptyMessage(pool: SceneMediaPool): string {
  // Only claim the internal-address cause when at least one dropped entry
  // actually carried a non-http scheme. Asserting it for a posterless video
  // sends the author hunting a pipeline bug that is not there.
  if (pool.atInternalAddresses > 0) {
    const n = pool.atInternalAddresses;
    const rest = pool.unreachable - n;
    const tail = rest > 0
      ? ` ${rest} other${rest === 1 ? ' has' : 's have'} no still image to show.`
      : '';
    return `This story has ${n} item${n === 1 ? '' : 's'} whose media sits at an internal address (ci-memory://…) that the pipeline resolves and a browser cannot load.${tail}`;
  }
  if (pool.withoutAStill > 0) {
    const n = pool.withoutAStill;
    return `This story has ${n} item${n === 1 ? '' : 's'} with no still image to put behind a slide — a video needs a poster frame, and a 3D asset has no picture of its own.`;
  }
  return 'This story carries no photos or videos, so there is nothing to put behind a slide. Places imported from KML or GeoJSON, and shapes drawn on the globe, have no picture to attach.';
}

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

/**
 * The ids a scene currently highlights, whichever spelling they arrived in.
 *
 * Reads `sceneHighlightIds`, i.e. `itemIds ?? items ?? mediaIds`, because the
 * editor has to show what the *presenter* is using and a scene adopted from an
 * open document may well carry the legacy spelling — a picker that only looked
 * at `itemIds` would show nothing attached beside a slide that plainly has a
 * photo on it. Writes always go back as `itemIds` (see `patchScene`, which
 * drops both legacy lists on the first edit so an export cannot carry two
 * contradicting answers).
 */
export const sceneAttachedIds = (scene: Scene | null | undefined): string[] =>
  scene ? sceneHighlightIds(scene) : [];

/**
 * Which attached id is actually painting the slide.
 *
 * The first candidate the scene attaches — which is the answer *because* the
 * candidate list is in `sceneBackground`'s resolution order. Note what this is
 * not: the first of the scene's `itemIds`. `sceneBackground` scans the story
 * and asks which ids are in the set, so the winner is decided by the story's
 * order, not the scene's, and an author told otherwise would reorder ids to no
 * effect.
 */
export function backgroundCandidate(
  candidates: readonly SceneMediaCandidate[],
  ids: readonly string[],
): SceneMediaCandidate | null {
  const set = new Set(ids);
  return candidates.find((c) => set.has(c.id)) ?? null;
}

/**
 * Attached ids that no candidate accounts for.
 *
 * Not an error — `itemIds` highlights entities, and a scene created from a
 * memory is seeded with that memory's id whether or not it has a loadable
 * picture (`sceneFromMemory` does exactly this). But they are invisible in a
 * picker made of thumbnails, so the panel has to mention them rather than let
 * "Use none" look like it is clearing something that was never shown.
 */
export function unresolvedAttachedIds(
  candidates: readonly SceneMediaCandidate[],
  ids: readonly string[],
): string[] {
  const known = new Set(candidates.map((c) => c.id));
  return ids.filter((id) => !known.has(id));
}

/**
 * Add or remove one id, preserving everything else in the author's own order.
 *
 * Appends rather than inserts, and never re-sorts: `itemIds` is a list the
 * author owns, ids this picker cannot show are part of it (see
 * `unresolvedAttachedIds`), and quietly dropping them because they have no
 * thumbnail would delete data the author never saw.
 */
export function toggleAttachment(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

/**
 * Why a narration URL was refused.
 *
 * One message rather than one per scheme, on purpose. Naming the offending
 * scheme would mean re-deriving it here, and `safeMediaUrl` deliberately
 * normalises away the tabs, newlines and C0 controls that make
 * `java\tscript:…` a live payload *before* it reads a scheme — so a second,
 * simpler parse in this file would sooner or later disagree with the sanitiser
 * about what the user typed. The one place that decides stays the one place
 * that decides.
 */
export const AUDIO_URL_REJECTED =
  'Narration must be an http:// or https:// link. Anything else — a data:, file: or ci-memory:// address, or a javascript: URL — is dropped before the slide ever plays it, so it would be silence.';

/** Accepted, but only against whatever page the story is opened from. */
export const AUDIO_URL_RELATIVE =
  'This link has no address of its own, so it resolves against whatever page the story is opened from — it will play here and be silent for anyone you share the story with. A full https:// link, or one starting with “/”, plays everywhere.';

export type AudioUrlCheck =
  /** Nothing typed — the field is being cleared, which is legitimate. */
  | { state: 'empty' }
  | { state: 'ok'; url: string; tidied: boolean }
  | { state: 'relative'; url: string; note: string; tidied: boolean }
  | { state: 'rejected'; reason: string };

/**
 * Whether a narration URL will ever be heard, checked with the presenter's own
 * sanitiser.
 *
 * `buildDeck` stores `safeMediaUrl(scene.audioUrl)` and `sceneAudio` plays
 * that, so a URL this refuses is a URL the presenter would drop **in silence**
 * — the author attaches a track, presents, hears nothing, and there is no
 * message anywhere. Refusing at entry, with the reason, is the difference
 * between a typo and a mystery.
 *
 * `relative` is a third answer rather than a refusal because the deck really
 * does accept it — `safeMediaUrl` allows a schemeless URL, which is how a story
 * bundled with the app addresses its own assets. `isLoadableMedia` is the
 * stricter test the *background* applies, and it draws the line at a leading
 * `/`: `/stories/demo/narration.mp3` is fetchable from any page and passes,
 * while a document-relative `narration.mp3` resolves against whatever page the
 * story happens to be opened from. Refusing that would block a case that works;
 * accepting it in silence would ship a story that is narrated on the author's
 * machine and nowhere else.
 */
export function checkAudioUrl(raw: string | null | undefined): AudioUrlCheck {
  const typed = typeof raw === 'string' ? raw.trim() : '';
  if (!typed) return { state: 'empty' };
  const url = safeMediaUrl(typed);
  if (!url) return { state: 'rejected', reason: AUDIO_URL_REJECTED };
  // `tidied` is not cosmetic. The sanitiser strips C0 controls, spaces, NBSP
  // and the BOM from ANYWHERE in the string, not just its ends — so a URL
  // pasted out of a document or a chat window with a zero-width character in
  // the middle, or one with an accidental internal space, is stored pointing at
  // a *different host or path* than the one the field is showing. Silently
  // holding an address the author never typed is the same class of dishonesty
  // as storing a refused one; the caller uses this to reconcile the two.
  const tidied = url !== typed;
  if (!isLoadableMedia(url)) return { state: 'relative', url, note: AUDIO_URL_RELATIVE, tidied };
  return { state: 'ok', url, tidied };
}

/** Said when the stored link differs from what was typed. Names the change
 *  rather than just asserting one, because "we cleaned it up" is not something
 *  an author can check. */
export const AUDIO_URL_TIDIED =
  'Invisible characters were removed from this link before it was stored — spaces, or something pasted in from a document. The field now shows exactly what the story holds.';

/** The URL an author can press play on, or null when there is nothing to hear.
 *  Same sanitiser as the deck, so the preview cannot succeed where the
 *  presentation will fail. */
export function playableAudioUrl(raw: string | null | undefined): string | null {
  const check = checkAudioUrl(raw);
  return check.state === 'ok' || check.state === 'relative' ? check.url : null;
}
