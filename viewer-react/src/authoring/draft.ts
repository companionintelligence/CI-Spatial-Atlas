import type { GeoPath, GeoPoint, Item, TimeSpec } from '@companion-atlas/story';
import {
  centroid,
  dedupePath,
  isFinitePoint,
  pathLengthMeters,
  pathSelfIntersects,
  ringAreaMeters,
  ringSelfIntersects,
  samePoint,
} from './geometry.js';
import { DEFAULT_STYLE, type AuthoringStyle } from './style.js';

/**
 * The drawing state machine.
 *
 * Pure: no Cesium, no DOM, no React, no ids generated from a global counter.
 * Everything the controller does to a shape while it is being drawn happens
 * here as a state → state function, which is what makes "click, click,
 * backspace, click, enter" a test rather than a thing you verify by hand in a
 * browser with terrain loaded.
 *
 * The controller's job on top of this is only the parts that genuinely need a
 * viewer: turning a pixel into a `GeoPoint`, drawing the preview, and deciding
 * that two clicks six pixels apart were one double-click.
 */

export type AuthoringMode = 'idle' | 'marker' | 'line' | 'polygon' | 'note';

/** The modes that actually place geometry, in toolbar order. */
export const DRAW_MODES: readonly AuthoringMode[] = ['marker', 'line', 'polygon', 'note'];

/** How many vertices each mode needs before it is a legal `Item`. These are the
 *  schema's own minimums (`GeoPath.min(2)`, `.min(3)`), restated so the tool can
 *  enable "Finish" without waiting for a Zod failure to find out. */
export const MIN_VERTICES: Record<AuthoringMode, number> = {
  idle: 0,
  marker: 1,
  note: 1,
  line: 2,
  polygon: 3,
};

/** Modes that finish on the first click — there is nothing to rubber-band. */
export const SINGLE_CLICK_MODES: readonly AuthoringMode[] = ['marker', 'note'];

export interface DraftState {
  mode: AuthoringMode;
  /** Committed vertices, in click order. Never contains the cursor. */
  vertices: GeoPath;
  /** Where the cursor is now — the rubber band's free end. Not a vertex. */
  hover: GeoPoint | null;
  /** Live validity note, or null. Shown by the toolbar as it is drawn, which is
   *  the only moment a self-intersection is cheap to fix. */
  warning: string | null;
}

/** What the toolbar needs to render, with no geometry in it. Deliberately flat
 *  and serialisable: the React layer should never hold a `GeoPath` it might
 *  mutate, and a primitive snapshot makes the toolbar's re-render cheap. */
export interface DraftSnapshot {
  mode: AuthoringMode;
  vertexCount: number;
  canFinish: boolean;
  warning: string | null;
  /** Metres, for a line (and for a polygon's perimeter). */
  lengthMeters: number;
  /** Square metres, for a polygon. Zero otherwise. */
  areaMeters: number;
}

export const isDrawingMode = (mode: AuthoringMode): boolean => mode !== 'idle';

export function createDraft(mode: AuthoringMode = 'idle'): DraftState {
  return { mode, vertices: [], hover: null, warning: null };
}

/**
 * Switch tools.
 *
 * A half-drawn shape is ABANDONED, not committed. The alternative — auto-
 * finishing whatever was in progress — means clicking "polygon" while three
 * vertices of a line are down silently creates a line the user never asked to
 * keep, and they find it later with no idea where it came from. Cancelling is
 * recoverable (draw it again); a spurious item in a saved story is not.
 */
export function setMode(draft: DraftState, mode: AuthoringMode): DraftState {
  return draft.mode === mode && draft.vertices.length === 0 ? draft : createDraft(mode);
}

/** Escape: drop the shape, keep the tool. Matches every drawing app — you
 *  wanted to redo the polygon, not to stop drawing polygons. */
export function cancelDraft(draft: DraftState): DraftState {
  return draft.vertices.length === 0 && draft.hover === null && draft.warning === null
    ? draft
    : { mode: draft.mode, vertices: [], hover: null, warning: null };
}

/**
 * Add a vertex.
 *
 * Silently ignores three things, each for a reason that has bitten a drawing
 * tool before:
 *
 *  - `idle` mode: a stray click while no tool is armed is a selection, not a
 *    vertex.
 *  - A non-finite point: a click that missed the globe (pointing at space)
 *    picks nothing, and `undefined → NaN` would otherwise put a vertex at the
 *    centre of the Earth. The controller ignores those before they get here;
 *    this is the second gate, for imports and for tests.
 *  - An exact duplicate of the previous vertex: see `samePoint`. A
 *    double-click delivers CLICK, CLICK, DOUBLE_CLICK, so the finishing
 *    gesture would otherwise leave a zero-length final segment. (Screen-space
 *    de-duplication in the controller catches the near-duplicates; this
 *    catches the exact ones.)
 */
export function addVertex(draft: DraftState, point: GeoPoint): DraftState {
  if (!isDrawingMode(draft.mode) || !isFinitePoint(point)) return draft;
  const last = draft.vertices[draft.vertices.length - 1];
  if (last && samePoint(last, point)) return draft;
  // A single-click mode holds exactly one vertex: clicking again MOVES the
  // marker rather than accumulating a list the item type cannot represent.
  const vertices = SINGLE_CLICK_MODES.includes(draft.mode) ? [point] : [...draft.vertices, point];
  return { ...draft, vertices, warning: warningFor(draft.mode, vertices) };
}

/** Backspace: take the last vertex back. Never removes the shape itself — an
 *  empty draft is what Escape is for, and a Backspace that silently ended the
 *  whole gesture would be a very expensive typo. */
export function undoVertex(draft: DraftState): DraftState {
  if (draft.vertices.length === 0) return draft;
  const vertices = draft.vertices.slice(0, -1);
  return { ...draft, vertices, warning: warningFor(draft.mode, vertices) };
}

/** Move the rubber band's free end. Cheap and called on every mouse move, so it
 *  returns the same object when nothing changed — this is what keeps a
 *  `useSyncExternalStore`-style subscription from re-rendering the toolbar at
 *  pointer-move frequency. */
export function setHover(draft: DraftState, point: GeoPoint | null): DraftState {
  if (!isDrawingMode(draft.mode)) return draft.hover === null ? draft : { ...draft, hover: null };
  const next = point && isFinitePoint(point) ? point : null;
  if (next === draft.hover) return draft;
  if (next && draft.hover && samePoint(next, draft.hover)) return draft;
  return { ...draft, hover: next };
}

export function canFinish(draft: DraftState): boolean {
  return isDrawingMode(draft.mode) && draft.vertices.length >= MIN_VERTICES[draft.mode];
}

/**
 * The polyline to draw right now: the committed vertices plus the cursor.
 *
 * The cursor is appended rather than being a separate "ghost segment" entity
 * because Cesium re-uploads a polyline's whole position buffer on any change
 * anyway — two entities would cost two uploads per frame and could disagree at
 * the join for one frame, which reads as a flicker at the pointer.
 */
export function previewPath(draft: DraftState): GeoPath {
  if (!isDrawingMode(draft.mode)) return [];
  return draft.hover ? [...draft.vertices, draft.hover] : [...draft.vertices];
}

/** The provisional ring for the polygon preview: the preview path, implicitly
 *  closed by Cesium. Kept UNCLOSED here, so the preview and the committed item
 *  are literally the same array shape — the canonical convention holds even for
 *  something that only ever exists for 400 ms. */
export function previewRing(draft: DraftState): GeoPath {
  const path = previewPath(draft);
  return path.length >= 3 ? path : [];
}

/** A snapshot for the toolbar. */
export function snapshot(draft: DraftState): DraftSnapshot {
  const v = draft.vertices;
  return {
    mode: draft.mode,
    vertexCount: v.length,
    canFinish: canFinish(draft),
    warning: draft.warning,
    lengthMeters: draft.mode === 'polygon' ? pathLengthMeters([...v, ...(v[0] ? [v[0]] : [])]) : pathLengthMeters(v),
    areaMeters: draft.mode === 'polygon' && v.length >= 3 ? ringAreaMeters(v) : 0,
  };
}

/**
 * The live warning, recomputed on every vertex change.
 *
 * A polygon's warning is about the ring *as it will be closed*, not about the
 * open path — which is why it can appear the moment the third vertex lands even
 * though nothing visibly crosses yet. That is the useful moment to say it: one
 * Backspace away from fixed, rather than after the shape is committed and the
 * fill has already gone to pieces.
 */
export function warningFor(mode: AuthoringMode, vertices: GeoPath): string | null {
  if (mode === 'polygon' && vertices.length >= 4 && ringSelfIntersects(vertices)) {
    return 'This outline crosses itself — the fill will not render.';
  }
  if (mode === 'line' && vertices.length >= 4 && pathSelfIntersects(vertices)) {
    // Legal, and often intentional (a loop walk). Said once, not refused.
    return 'This line crosses itself.';
  }
  return null;
}

export interface FinishOptions {
  /** Required — ids are the caller's to allocate (see `store.ts`). */
  id: string;
  style?: AuthoringStyle;
  title?: string;
  description?: string;
  /** `note` only. A note with no text is refused. */
  text?: string;
  /** Stamped onto the item so a drawn shape sits on the story's timeline
   *  alongside imported memories rather than defaulting to the whole span. */
  time?: TimeSpec;
  /**
   * Commit a self-intersecting ring anyway.
   *
   * Present because "reject" and "warn" are both wrong on their own: refusing
   * outright loses work the user may have spent a minute on and can fix by
   * dragging one vertex, while committing silently produces the garbage fill
   * `ringSelfIntersects` documents. So the default refuses and explains, and
   * this is the escape hatch the toolbar offers alongside the explanation.
   */
  allowSelfIntersecting?: boolean;
}

export type DraftResult =
  | { ok: true; item: Item }
  | { ok: false; reason: 'idle' | 'too-few-vertices' | 'self-intersecting' | 'no-text'; message: string };

/**
 * Commit the draft to a canonical `Item`.
 *
 * The returned value is a plain object that `Item.parse` accepts — that is the
 * contract this whole module exists to keep, and the test suite parses every
 * shape it produces rather than asserting on field names.
 *
 * `source: { kind: 'manual' }` is stamped on everything drawn here. It is the
 * difference between "the user drew this boundary" and "an importer inferred
 * it", and it is the only way a later merge with a re-imported source can know
 * which shapes are safe to replace.
 */
export function finishDraft(draft: DraftState, opts: FinishOptions): DraftResult {
  const mode = draft.mode;
  if (!isDrawingMode(mode)) {
    return { ok: false, reason: 'idle', message: 'No drawing tool is active.' };
  }

  // Dedupe first: the committed geometry, not the click log, is what has to be
  // valid. A path of five clicks two of which landed on the same pixel is a
  // four-vertex path, and the minimum has to be counted after that.
  const vertices = dedupePath(draft.vertices, { ring: mode === 'polygon' });
  const min = MIN_VERTICES[mode];
  if (vertices.length < min) {
    return {
      ok: false,
      reason: 'too-few-vertices',
      message: `A ${mode} needs at least ${min} point${min === 1 ? '' : 's'}.`,
    };
  }

  const style = opts.style ?? DEFAULT_STYLE;
  const base = {
    id: opts.id,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.time ? { time: opts.time } : {}),
    source: { kind: 'manual' as const },
  };

  switch (mode) {
    case 'marker': {
      const item: Item = {
        ...base,
        type: 'marker',
        position: vertices[0]!,
        ...(style.color ? { color: style.color } : {}),
        ...(style.icon ? { icon: style.icon } : {}),
      };
      return { ok: true, item };
    }
    case 'note': {
      const text = opts.text?.trim();
      if (!text) {
        return { ok: false, reason: 'no-text', message: 'A note needs some text.' };
      }
      return { ok: true, item: { ...base, type: 'note', position: vertices[0]!, text } };
    }
    case 'line': {
      const item: Item = {
        ...base,
        type: 'line',
        positions: vertices,
        ...(style.color ? { color: style.color } : {}),
        ...(Number.isFinite(style.width) ? { width: style.width } : {}),
        ...(style.clampToGround == null ? {} : { clampToGround: style.clampToGround }),
      };
      return { ok: true, item };
    }
    case 'polygon': {
      if (!opts.allowSelfIntersecting && ringSelfIntersects(vertices)) {
        return {
          ok: false,
          reason: 'self-intersecting',
          message: 'This outline crosses itself. Move a point, or keep it anyway.',
        };
      }
      const item: Item = {
        ...base,
        type: 'polygon',
        positions: vertices,
        ...(style.color ? { fillColor: style.color } : {}),
        // `?? `, never `||`: 0 means outline-only and is a value someone
        // deliberately picks.
        ...(Number.isFinite(style.fillOpacity) ? { fillOpacity: style.fillOpacity } : {}),
        ...(style.outlineColor ? { outlineColor: style.outlineColor } : {}),
        ...(Number.isFinite(style.outlineWidth) ? { outlineWidth: style.outlineWidth } : {}),
        ...(style.clampToGround == null ? {} : { clampToGround: style.clampToGround }),
      };
      return { ok: true, item };
    }
    default:
      return { ok: false, reason: 'idle', message: 'No drawing tool is active.' };
  }
}

/** The vertices an existing item exposes for editing, in the order the handles
 *  are drawn. One entry for a placed item, the whole ring/path for geometry —
 *  so the controller has a single code path for "drag handle number 3". */
export function editableVertices(item: Item): GeoPath {
  switch (item.type) {
    case 'line':
    case 'polygon':
      return item.positions;
    case 'marker':
    case 'note':
    case 'photo':
    case 'video':
    case 'model':
      return [item.position];
    case 'splat':
    case 'tileset':
      return item.position ? [item.position] : [];
    default:
      return [];
  }
}

/** Where an item's "move the whole thing" handle sits. */
export function itemAnchor(item: Item): GeoPoint | null {
  const v = editableVertices(item);
  return v.length === 1 ? v[0]! : centroid(v);
}
