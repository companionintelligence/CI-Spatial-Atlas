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
 * Build the deck for a story.
 *
 * **Authored order, not chronological order.** `deriveModel` sorts scenes by
 * time because the time machine is a clock and a clock has one direction. A
 * presentation is not a clock: a story that opens on the ending and then goes
 * back six years is a flashback, and sorting it silently rewrites the author's
 * story into a different one. So this reads `story.scenes` exactly as written —
 * which is also why the caller must drive the clock from `slide.timeMs` rather
 * than assume the playhead only moves forwards.
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

export function buildDeck(
  story: Story,
  opts: { reduceMotion?: boolean; memories?: readonly DeckMemory[] } = {},
): DeckSlide[] {
  // Authored scenes always win: an author who wrote an order meant it, and
  // projecting memories over the top would silently replace their deck.
  const scenes = story.scenes.length
    ? story.scenes
    : scenesFromMemories(opts.memories ?? []);
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
