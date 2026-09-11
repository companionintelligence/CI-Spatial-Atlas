/**
 * The presentation deck: everything about stepping through `story.scenes[]`
 * that is not React.
 *
 * `Scene.layout`, `Scene.transition` and `Scene.audioUrl` have been in the
 * canonical schema since the two data models were consolidated and no renderer
 * has ever read any of them. This module is where they finally mean something,
 * and it is deliberately pure: the viewer's suites run in node with no DOM, so
 * the bounds arithmetic, the layout fallbacks, the transition normalisation and
 * the keyboard map are all testable without mounting anything.
 *
 * The React layer (`SceneLayout.tsx`, `Presenter.tsx`) renders what this
 * produces and owns no rules of its own.
 */
import {
  normalizeCamera,
  sceneHighlightIds,
  sceneNarrative,
  type Camera,
  type Scene,
  type Story,
} from '@companion-atlas/story';
import { parseMarkdown, plainText, type MdBlock } from './markdown.js';
import { isLoadableMedia, safeMediaUrl } from './safeUrl.js';
import { solarLocal } from '../model/atlasModel.js';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const SCENE_LAYOUTS = ['card-left', 'card-right', 'card-bottom', 'fullscreen', 'split'] as const;
export type SceneLayout = (typeof SCENE_LAYOUTS)[number];

/**
 * The layout a scene gets when it does not ask for one.
 *
 * `card-left`, because that is the only one of the five that leaves the globe
 * both fully visible and unobstructed on the side the camera usually frames a
 * memory towards — and because a story authored before `layout` existed (every
 * story in the wild today) is a narrated flythrough, which is what a docked card
 * over a live globe *is*.
 */
export const DEFAULT_LAYOUT: SceneLayout = 'card-left';

const LAYOUTS = new Set<string>(SCENE_LAYOUTS);

/** Read a scene's layout, falling back for absent *and* unrecognised values. */
export function sceneLayout(scene: Pick<Scene, 'layout'> | null | undefined): SceneLayout {
  const l = scene?.layout;
  // Zod validated the story on load, but stories also arrive from
  // `?story=<url>` through paths that only normalise — so an unknown string
  // here is reachable, and must not render an unstyled slide.
  return typeof l === 'string' && LAYOUTS.has(l) ? (l as SceneLayout) : DEFAULT_LAYOUT;
}

/** Layouts whose card is opaque and covers the globe (so the caller can stop
 *  paying for a camera flight nobody can see). */
export function layoutHidesGlobe(layout: SceneLayout): boolean {
  return layout === 'fullscreen';
}

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

export interface SlideTransition {
  /** `fly` — animate the camera there. `cut` — jump. */
  kind: 'fly' | 'cut';
  /** Milliseconds. Always 0 for a cut, so a caller can pass it straight to
   *  Cesium's `duration` (in seconds) without a second branch. */
  durationMs: number;
}

export const DEFAULT_FLY_MS = 1600;
/** Beyond this a "flight" is just a stall the reader cannot skip. */
export const MAX_FLY_MS = 12_000;

/**
 * Normalise `Scene.transition` across both legacy spellings.
 *
 * The schema carries `kind: 'fly' | 'flyTo' | 'cut'` *and* `type: 'flyTo' |
 * 'cut'` because the two consolidated data models disagreed and both spellings
 * survive in stored documents — `sample-pacific-journey.json` uses `kind:
 * 'fly'`, the Earth-2 fixtures use `type: 'flyTo'`. Collapsing them here means
 * no renderer has to know that history.
 */
export function sceneTransition(
  scene: Pick<Scene, 'transition' | 'camera'> | null | undefined,
  reduceMotion = false,
): SlideTransition {
  // Reduced motion is not a preference about *this* control — it is a statement
  // that flying the camera across the globe makes the reader ill. A cut still
  // arrives at the same place; it just does not swing the world to get there.
  if (reduceMotion) return { kind: 'cut', durationMs: 0 };

  const t = scene?.transition;
  const raw = t?.kind ?? t?.type;
  const kind: 'fly' | 'cut' = raw === 'cut' ? 'cut' : 'fly';
  if (kind === 'cut') return { kind, durationMs: 0 };

  // `Camera.durationMs` is the older place to say the same thing, and a story
  // that sets it and no `transition` still means it.
  const asked = t?.durationMs ?? scene?.camera?.durationMs;
  const ms = typeof asked === 'number' && Number.isFinite(asked) && asked >= 0 ? asked : DEFAULT_FLY_MS;
  return { kind, durationMs: Math.min(MAX_FLY_MS, ms) };
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

/** A camera pose resolved into the one shape a renderer can fly to. */
export interface SlideCamera {
  lon: number;
  lat: number;
  height?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  range?: number;
}

export interface DeckSlide {
  /** The scene this came from, for anything the slide does not model. */
  scene: Scene;
  id: string;
  /** 0-based position in the deck. */
  index: number;
  title: string;
  /** `narrative` (or the legacy `caption`) parsed as Markdown. */
  body: MdBlock[];
  /** One line of the narrative, for the contents list and aria labels. */
  summary: string;
  layout: SceneLayout;
  /** Background image for `fullscreen` / `split`, when the story has a loadable
   *  one. Absent means "use the tint". */
  backgroundUrl?: string;
  /** Class carrying the flat colour a slide falls back to (see presenter.css). */
  tintClass: string;
  /** The scene's instant, or null when it is untimed. */
  timeMs: number | null;
  /** Pre-formatted date/time for the slide's eyebrow, or null when untimed. */
  when: { date: string; time: string } | null;
  camera: SlideCamera | null;
  transition: SlideTransition;
  /** Sanitised `Scene.audioUrl`. */
  audioUrl?: string;
}

/** Five tints, cycled — the same device the scrapbook uses for a memory with no
 *  photo, so a story that mixes the two does not look like two apps. */
const TINTS = 5;

type TimeLike = string | { at?: string; start?: string; end?: string; stop?: string } | undefined;

/** A scene's instant in epoch ms, or null when it has no parseable time. */
export function sceneTimeMs(time: TimeLike): number | null {
  const iso = typeof time === 'string' ? time : (time?.at ?? time?.start);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Collapse either camera spelling into a pose with a guaranteed lon/lat. */
export function slideCamera(camera: Camera | undefined): SlideCamera | null {
  const c = normalizeCamera(camera);
  const loc = c?.location;
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return null;
  return {
    lon: loc.lon,
    lat: loc.lat,
    height: loc.height,
    heading: c!.heading,
    pitch: c!.pitch,
    roll: c!.roll,
    range: c!.range,
  };
}

/**
 * The image a slide shows behind its title.
 *
 * Resolved from the entities the scene already highlights (`itemIds` / the
 * legacy `items` / `mediaIds`) rather than from a new schema field, because the
 * schema has no per-scene image and adding one would fork the format. Falls back
 * to the story's cover.
 *
 * Everything is filtered through `isLoadableMedia`: a real archive is full of
 * `ci-memory://demo/reykjavik.jpg`, an internal address the pipeline resolves
 * and an `<img>` cannot. Handing one to the DOM paints a broken-image glyph
 * across a full-screen slide; treating it as absent paints the tint, which
 * looks intentional.
 */
export function sceneBackground(story: Story, scene: Scene): string | undefined {
  const ids = new Set(sceneHighlightIds(scene));

  for (const item of story.items ?? []) {
    if (!ids.has(item.id)) continue;
    if (item.type !== 'photo' && item.type !== 'video') continue;
    // A video's poster is a still; its `url` is not something an <img> shows.
    const candidate = item.type === 'photo' ? item.media?.url : undefined;
    for (const u of [candidate, item.media?.posterUrl, item.media?.thumbnailUrl]) {
      if (isLoadableMedia(u)) return safeMediaUrl(u)!;
    }
  }

  for (const m of story.media ?? []) {
    if (!ids.has(m.id)) continue;
    if (m.kind === 'video' || m.kind === 'audio') {
      if (isLoadableMedia(m.thumbnailUri)) return safeMediaUrl(m.thumbnailUri)!;
      continue;
    }
    for (const u of [m.uri, m.thumbnailUri]) {
      if (isLoadableMedia(u)) return safeMediaUrl(u)!;
    }
  }

  return isLoadableMedia(story.cover) ? safeMediaUrl(story.cover)! : undefined;
}

/**
 * **Authored order, not chronological order** — the rule every source below is
 * read under.
 *
 * `deriveModel` sorts scenes by time because the time machine is a clock and a
 * clock has one direction. A presentation is not a clock: a story that opens on
 * the ending and then goes back six years is a flashback, and sorting it
 * silently rewrites the author's story into a different one. So both scene
 * sources — the document's and the deck the user is writing — are read exactly
 * as written, which is also why the caller must drive the clock from
 * `slide.timeMs` rather than assume the playhead only moves forwards. Only
 * projected memories are ordered, and only because they were never sequenced by
 * anybody in the first place.
 */
/**
 * A memory the app has already derived, offered as a deck when a story carries
 * no authored scenes of its own. Structurally the subset of `AtlasMemory` a
 * slide needs — taken as a parameter rather than imported, so this module stays
 * free of the view-model and testable on its own.
 */
export interface DeckMemory {
  id: string;
  title: string;
  narrative?: string;
  timeMs: number;
  lat?: number;
  lon?: number;
  place?: string;
  media?: { url?: string; thumbnailUrl?: string };
}

/**
 * Project memories into scenes, for a story that has none.
 *
 * `memoryToStory` returns `scenes: []` — a Companion Memory archive is located
 * media and markers, not an authored narrative — so gating the presenter on
 * `story.scenes.length` hid it from every real story and left it reachable only
 * from the bundled demo. `deriveModel` already solves the same problem the same
 * way for the globe (its zero-scenes branch projects located entities into
 * memories); this keeps the presenter consistent with what the rest of the
 * shell is showing rather than inventing a second rule.
 *
 * The camera is derived from the memory's own position, because a projected
 * scene has no authored viewpoint — and a slide that does not move the globe
 * is not a presentation.
 */
function scenesFromMemories(memories: readonly DeckMemory[]): Scene[] {
  return [...memories]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((m) => ({
      id: m.id,
      title: m.title,
      narrative: m.narrative,
      time: new Date(m.timeMs).toISOString(),
      // card-left keeps the globe visible beside the text. A projected memory
      // has a place worth looking at; fullscreen would hide it.
      layout: 'card-left' as const,
      ...(m.lat != null && m.lon != null
        ? { camera: { lon: m.lon, lat: m.lat, range: 90_000, pitch: -40, durationMs: 2200 } }
        : {}),
      ...(m.media?.url || m.media?.thumbnailUrl
        ? { mediaIds: [m.id] }
        : {}),
    }));
}

export interface BuildDeckOptions {
  reduceMotion?: boolean;
  /** Derived memories, projected into slides only when nothing else claims the
   *  deck. See `scenesFromMemories`. */
  memories?: readonly DeckMemory[];
  /**
   * The scenes the user is authoring right now, already reconciled with the
   * open document — see `deckScenes` for the precedence and for why this is a
   * separate argument rather than scenes merged into `story`.
   */
  authored?: readonly Scene[] | null;
}

/** Which of the three sources a deck was built from. Returned so a caller (and
 *  a test) can assert *why* a deck looks the way it does, rather than inferring
 *  it from the slides. */
export type DeckSource = 'authored' | 'story' | 'memories';

/**
 * Which list of scenes a deck is built from, and why in that order.
 *
 * Three sources can each claim to be "the story": the deck the user is
 * authoring, the scenes the open document arrived with, and the memories the
 * app projected when it had neither. They are not three alternatives of equal
 * standing — they are the same question asked at three removes from the user,
 * so the nearest one wins.
 *
 * 1. **Authored scenes win outright.** They are the only one of the three the
 *    user is actively making, and Present is how they check the work; a preview
 *    that showed anything else would be a preview of someone else's story. Note
 *    what winning does *not* mean here: authored scenes are not concatenated
 *    with the document's own. Someone editing a `?story=` document is editing
 *    *those* scenes — the deck adopted them, ids and all — so appending would
 *    show every scene twice, once as written and once as edited. Someone
 *    authoring on a Memory archive is writing the first scenes that document
 *    has ever had, and there is nothing to reconcile at all. The caller passes
 *    an array that the export merge (`withAuthoredScenes` /
 *    `SceneControl.toStory`) has already reconciled against the document, so
 *    what Present shows and what a download contains cannot drift apart, and
 *    that merge stays in the one module that owns it instead of being
 *    re-derived — differently, eventually — here.
 *    Projected memories lose to an authored deck for the same reason: a user
 *    who has written one scene must not find 500 slides they did not write
 *    stacked behind it.
 * 2. **The document's own scenes**, for the reader who is not authoring at all.
 *    That is the overwhelmingly common case and the behaviour every story in
 *    the wild already depends on, so it must survive this feature untouched.
 * 3. **Projected memories**, so Present is not a button that opens an empty
 *    presentation on a Memory archive — the regression `presenter-memories`
 *    exists for.
 *
 * ## Why `authored` is an argument and not scenes merged into `story`
 *
 * Because `deriveModel` reads `story.scenes` first: while that array is
 * non-empty the globe's memories *are* the scenes, and everything else in the
 * archive stops being drawn. An authored deck that reached the rendered story
 * would therefore collapse a 500-memory globe to three pins with no error and
 * nothing to click on to get it back. Taking the scenes as an argument means no
 * merged `Story` object needs to exist in the render tree at all, so there is
 * nothing for a later caller to hand to the globe by mistake — the structural
 * version of the rule, not the remembered one. `scenes/story.ts` documents the
 * same trap from the export side.
 */
export function deckScenes(
  story: Story,
  opts: BuildDeckOptions = {},
): { scenes: readonly Scene[]; source: DeckSource } {
  if (opts.authored?.length) return { scenes: opts.authored, source: 'authored' };
  // `story.scenes` is required by the schema, but stories also arrive from
  // `?story=<url>` through paths that only normalise — so an absent array is
  // reachable and must not throw on `.length`.
  if (story.scenes?.length) return { scenes: story.scenes, source: 'story' };
  return { scenes: scenesFromMemories(opts.memories ?? []), source: 'memories' };
}

export function buildDeck(story: Story, opts: BuildDeckOptions = {}): DeckSlide[] {
  const { scenes } = deckScenes(story, opts);
  return scenes.map((scene, index) => {
    const body = parseMarkdown(sceneNarrative(scene));
    const timeMs = sceneTimeMs(scene.time as TimeLike);
    const camera = slideCamera(scene.camera);
    return {
      scene,
      id: scene.id,
      index,
      title: scene.title?.trim() || `Scene ${index + 1}`,
      body,
      summary: plainText(body, 110),
      layout: sceneLayout(scene),
      backgroundUrl: sceneBackground(story, scene),
      tintClass: `pr-tint-${index % TINTS}`,
      timeMs,
      when: timeMs == null ? null : whenLabel(timeMs, camera?.lon),
      camera,
      transition: sceneTransition(scene, opts.reduceMotion),
      audioUrl: safeMediaUrl(scene.audioUrl) ?? undefined,
    };
  });
}

/** Date/time for a slide's eyebrow, in *local solar* time at the scene's
 *  longitude — the same convention the rest of the shell uses, so a slide and
 *  the time machine never disagree about what hour it was there. */
export function whenLabel(ms: number, lon?: number): { date: string; time: string } {
  const s = solarLocal(ms, lon);
  return { date: s.whenDate, time: s.whenTime };
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/**
 * Step to the next/previous slide, clamped at both ends.
 *
 * Deliberately does not wrap. Wrapping past the last scene restarts the story
 * without saying so — the reader who pressed Right once too often is now
 * looking at the opening slide with no signal that anything ended, which is
 * exactly the confusion the position indicator exists to prevent. Google
 * Earth's presenter stops too.
 */
export function stepIndex(index: number, dir: -1 | 1, count: number): number {
  return clampIndex(clampIndex(index, count) + dir, count);
}

/** Whether a step in `dir` would actually move (drives the disabled state). */
export function canStep(index: number, dir: -1 | 1, count: number): boolean {
  if (count <= 0) return false;
  const i = clampIndex(index, count);
  return dir === 1 ? i < count - 1 : i > 0;
}

/** Index of a scene by id, or -1. Used to resume a presentation on the scene
 *  the reader had selected before opening it. */
export function indexOfScene(deck: readonly DeckSlide[], sceneId: string | null | undefined): number {
  if (!sceneId) return -1;
  return deck.findIndex((s) => s.id === sceneId);
}

/**
 * Where a presentation should sit after the deck changed underneath it.
 *
 * The deck used to be immutable while it was on screen: it came from a document
 * that had already loaded, so the only way it changed was a whole new story. It
 * is now editable *while it is being presented* — Present is how an author
 * checks the scene they just wrote — and that turns a stored index into a lie.
 * Drag scene 5 to the top while the reader is on scene 5 and a raw index keeps
 * them on slot 5, which is now a different scene: the presentation appears to
 * jump for no reason, and the camera flies somewhere the reader did not ask to
 * go. So the position is re-derived from the scene's **identity**: the reader
 * follows the scene they are reading, wherever it moved to.
 *
 * When the scene is gone — deleted from the editor, or never in this deck
 * because the whole story was swapped — the old *position* is the best answer
 * left, clamped into the new deck. The deck closes over the gap and the
 * neighbour that took the slot is the next thing to read; snapping back to
 * scene 1 would restart a presentation because someone deleted a scene at the
 * end of it.
 */
export function followSceneIndex(
  deck: readonly DeckSlide[],
  sceneId: string | null | undefined,
  index: number,
): number {
  if (deck.length === 0) return 0;
  const found = indexOfScene(deck, sceneId);
  return found >= 0 ? found : clampIndex(index, deck.length);
}

/**
 * Where a presentation is: a position *and* the scene that was at it.
 *
 * The pair travels together because neither half is sufficient once the deck is
 * editable. The index alone cannot survive a reorder (it addresses a slot, and
 * slots now change hands); the id alone cannot survive a delete (there is no
 * scene left to point at, and the position is the only clue about where the
 * reader was). Holding both, in one value, is also what stops a render landing
 * between two separate updates and following the wrong scene.
 */
export interface DeckCursor {
  index: number;
  id: string | null;
}

/** The cursor for a position in a deck, clamped. `id` is null only when the
 *  deck is empty, which presents nothing. */
export function deckCursor(deck: readonly DeckSlide[], index: number): DeckCursor {
  const i = clampIndex(index, deck.length);
  return { index: i, id: deck[i]?.id ?? null };
}

export const sameCursor = (a: DeckCursor, b: DeckCursor): boolean =>
  a.index === b.index && a.id === b.id;

/** Where a presentation starts: the scene the reader had selected when they
 *  pressed Present, or the top of the deck when that scene is not in it. */
export function openingCursor(
  deck: readonly DeckSlide[],
  initialSceneId?: string | null,
): DeckCursor {
  const found = indexOfScene(deck, initialSceneId);
  return deckCursor(deck, found >= 0 ? found : 0);
}

/**
 * Where a presentation is after the deck changed underneath it.
 *
 * Applied on exactly the renders where the deck reference changed, and on no
 * others: run unconditionally it would fight the reader, because immediately
 * after a step the cursor's id is still the scene they just left and following
 * it would drag them straight back to it. It is a fixed point — applying it to
 * its own result cannot move again — which is what makes it safe to run during
 * render, where a value that kept changing would be an infinite loop.
 */
export function followCursor(deck: readonly DeckSlide[], cursor: DeckCursor): DeckCursor {
  return deckCursor(deck, followSceneIndex(deck, cursor.id, cursor.index));
}

/**
 * A deck's shape as one comparable value: which scenes, in which order.
 *
 * Object identity would be the obvious signal and is the wrong one. The
 * presenter reconciles its cursor *during render* (see `reconcileCursor`), so
 * whatever it compares also has to be what it stores — and storing a deck that
 * is rebuilt on every render, which is what a caller passing a fresh
 * `authoredScenes` array produces, would queue a state update from every render
 * and hang the component in a re-render loop. Comparing content instead makes
 * an unmemoised caller merely wasteful rather than fatal.
 *
 * Ids and order only: they are the entire input to following a cursor. Editing
 * a scene's words, camera or audio cannot move the reader — that is
 * `slideEnterKey`'s job, and it is asked a different question.
 */
export function deckSignature(deck: readonly DeckSlide[]): string {
  return deck.map((s) => s.id).join('~');
}

export interface CursorReconcile {
  /** The deck as of this render. */
  deck: readonly DeckSlide[];
  /** `deckSignature(deck)`, and the signature the cursor was last reconciled
   *  against. Equal signatures mean there is nothing to follow. */
  deckKey: string;
  seenKey: string;
  open: boolean;
  wasOpen: boolean;
  cursor: DeckCursor;
  initialSceneId?: string | null;
}

/**
 * The one place that decides where a presentation is pointing, for the two
 * events that can move it without the reader touching anything.
 *
 * The interlock between them is the whole reason this is a function rather than
 * two `if`s in a component: **opening beats following**. A reader who pressed
 * Present on scene 5 asked for scene 5, and if the deck also changed on that
 * render — it usually has, since opening the editor is what produced the deck —
 * following the cursor left over from the *last* presentation would land them
 * somewhere they did not ask for. Following only ever applies to a presentation
 * that is already open.
 *
 * Equally important is what this does *not* react to: a render where the deck
 * holds the same scenes in the same order. Immediately after a step, the cursor
 * names the scene the reader just left; "following" it then would drag the
 * presentation back one slide every time they pressed Right. Hence the two
 * signatures — the caller remembers which deck the cursor already accounts for.
 *
 * Returns the given cursor unchanged when there is nothing to do, so the caller
 * can compare and skip the state update.
 */
export function reconcileCursor(input: CursorReconcile): DeckCursor {
  const { deck, deckKey, seenKey, open, wasOpen, cursor, initialSceneId } = input;
  if (open && !wasOpen) return openingCursor(deck, initialSceneId);
  // A closing presentation keeps its cursor: it is about to render nothing, and
  // re-opening resolves from `initialSceneId` anyway.
  if (!open) return cursor;
  return deckKey === seenKey ? cursor : followCursor(deck, cursor);
}

/**
 * The identity of "the scene the presenter has already announced", for deciding
 * whether a rebuilt deck means anything the caller has to act on.
 *
 * `onSceneEnter` is not a notification, it is a command: it pauses the clock,
 * scrubs the playhead and flies the camera, and the presenter re-arms the
 * narration alongside it. Firing it again is therefore expensive and *visible*
 * — a camera flight restarting, a voice starting over — so it must fire when
 * something it acts on changed, and only then.
 *
 * Every edit to the deck rebuilds every slide, so slide object identity is
 * useless here and the index is actively wrong: reordering scenes behind the
 * reader shifts the current scene's position without changing one thing about
 * the scene, and re-entering on that would restart a narration the reader is
 * halfway through. What the caller actually consumes is the id, the camera
 * pose, the instant and the audio track — so those, and nothing else, make the
 * key. Retitling a slide or rewriting its body updates the rendered card
 * (the slide is rebuilt regardless) without disturbing the globe; re-capturing
 * its camera moves the globe, which is exactly the feedback an author expects
 * from "capture this view".
 */
export function slideEnterKey(slide: DeckSlide): string {
  const c = slide.camera;
  const pose = c
    ? [c.lon, c.lat, c.height, c.heading, c.pitch, c.roll, c.range].map((n) => n ?? '').join(',')
    : '';
  return [slide.id, pose, slide.timeMs ?? '', slide.audioUrl ?? ''].join('|');
}

/** "Scene 3 of 7" — the visible position indicator, and its aria text. */
export function positionLabel(index: number, count: number): string {
  return count > 0 ? `Scene ${clampIndex(index, count) + 1} of ${count}` : 'No scenes';
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export type DeckCommand = 'next' | 'prev' | 'first' | 'last' | 'exit' | 'contents' | 'audio';

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Map a keystroke to a deck command, or null to let it through.
 *
 * Returning null rather than swallowing everything is the whole point: the
 * presenter listens at the document (see `Presenter.tsx` for why), so any key
 * it claims is a key the rest of the app has lost. ⌘K must still open the
 * command palette while presenting, so anything carrying a Ctrl/Cmd/Alt
 * modifier is passed straight through.
 */
export function keyToCommand(e: KeyLike): DeckCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case 'n': case 'N':
      return 'next';
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'p': case 'P':
      return 'prev';
    // Space pages forward the way it does in every slide deck; with Shift it
    // pages back, the way it does in every browser.
    case ' ': case 'Spacebar':
      return e.shiftKey ? 'prev' : 'next';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Escape': return 'exit';
    case 'c': case 'C': return 'contents';
    case 'm': case 'M': return 'audio';
    default: return null;
  }
}

/**
 * Whether a keystroke belongs to something the reader is typing into.
 *
 * Without this, typing "no" into the scrapbook's title field while the
 * presenter is open advances two slides and the caret never moves.
 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
