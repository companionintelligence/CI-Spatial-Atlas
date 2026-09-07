import { describe, expect, it } from 'vitest';
import { Item as ItemSchema } from '@companion-atlas/story';
import {
  addVertex,
  cancelDraft,
  canFinish,
  createDraft,
  DRAW_MODES,
  editableVertices,
  finishDraft,
  isDrawingMode,
  itemAnchor,
  MIN_VERTICES,
  previewPath,
  previewRing,
  setHover,
  setMode,
  snapshot,
  undoVertex,
  warningFor,
  type DraftState,
} from '../src/authoring/draft.js';
import { DEFAULT_STYLE } from '../src/authoring/style.js';

/**
 * The drawing state machine — "click, click, backspace, click, Enter".
 *
 * The contract this file exists to prove is the last one: every shape the tools
 * produce is a value `Item.parse` accepts. That is checked by actually parsing,
 * not by asserting on field names, because the failure mode is not a wrong
 * field — it is a shape that looks right in the viewer, renders fine, and is
 * rejected the moment someone tries to save it to CI-Server or export it.
 */

const p = (lon: number, lat: number, height?: number) =>
  height == null ? { lon, lat } : { lon, lat, height };

/** Replay a click sequence, the way the controller would. */
const clicks = (draft: DraftState, ...points: { lon: number; lat: number }[]): DraftState =>
  points.reduce(addVertex, draft);

/** Parse through the canonical schema and hand back the parsed value. Anything
 *  the schema strips or rejects shows up here rather than at save time. */
const parsed = (item: unknown) => ItemSchema.parse(item);

describe('modes', () => {
  it('starts idle and knows which modes draw', () => {
    expect(createDraft().mode).toBe('idle');
    expect(isDrawingMode('idle')).toBe(false);
    for (const m of DRAW_MODES) expect(isDrawingMode(m)).toBe(true);
  });

  it('mirrors the schema minimums, so Finish enables without waiting for Zod', () => {
    expect(MIN_VERTICES.line).toBe(2);     // GeoPath.min(2)
    expect(MIN_VERTICES.polygon).toBe(3);  // GeoPath.min(3)
    expect(MIN_VERTICES.marker).toBe(1);
    expect(MIN_VERTICES.note).toBe(1);
  });

  it('ABANDONS a half-drawn shape when the tool changes', () => {
    // Auto-finishing here would silently create a line the user never chose to
    // keep, and they would find it later with no idea where it came from.
    const half = clicks(createDraft('line'), p(0, 0), p(1, 1));
    const switched = setMode(half, 'polygon');
    expect(switched.mode).toBe('polygon');
    expect(switched.vertices).toEqual([]);
  });

  it('is a no-op when the mode is already armed and nothing is drawn', () => {
    const draft = createDraft('polygon');
    expect(setMode(draft, 'polygon')).toBe(draft);
  });

  it('re-arms a tool that had vertices, even for the same mode', () => {
    const half = clicks(createDraft('polygon'), p(0, 0));
    expect(setMode(half, 'polygon').vertices).toEqual([]);
  });

  it('Escape drops the shape and KEEPS the tool', () => {
    const half = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1));
    const cancelled = cancelDraft(half);
    expect(cancelled.mode).toBe('polygon');
    expect(cancelled.vertices).toEqual([]);
    expect(cancelled.hover).toBeNull();
  });

  it('does not allocate a new state for an Escape with nothing to cancel', () => {
    const empty = createDraft('line');
    expect(cancelDraft(empty)).toBe(empty);
  });
});

describe('vertex accumulation and undo', () => {
  it('accumulates in click order', () => {
    const draft = clicks(createDraft('line'), p(0, 0), p(1, 1), p(2, 0));
    expect(draft.vertices).toEqual([p(0, 0), p(1, 1), p(2, 0)]);
  });

  it('ignores a click while no tool is armed', () => {
    const idle = createDraft('idle');
    expect(addVertex(idle, p(1, 1))).toBe(idle);
  });

  it('ignores the NaN a click that missed the globe would produce', () => {
    const draft = createDraft('line');
    expect(addVertex(draft, { lon: Number.NaN, lat: 12 })).toBe(draft);
  });

  it('drops the duplicate second click of a double-click', () => {
    // Cesium delivers CLICK, CLICK, DOUBLE_CLICK, so the finishing gesture
    // tries to add the same vertex twice.
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1), p(1, 1));
    expect(draft.vertices).toHaveLength(3);
  });

  it('MOVES the point rather than accumulating one, for a single-click tool', () => {
    const draft = clicks(createDraft('marker'), p(0, 0), p(5, 5));
    expect(draft.vertices).toEqual([p(5, 5)]);
  });

  it('takes back exactly one vertex per undo', () => {
    let draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1));
    draft = undoVertex(draft);
    expect(draft.vertices).toEqual([p(0, 0), p(1, 0)]);
    draft = undoVertex(draft);
    draft = undoVertex(draft);
    expect(draft.vertices).toEqual([]);
    // Undo past the start never ends the gesture — that is what Escape is for.
    expect(undoVertex(draft).mode).toBe('polygon');
    expect(undoVertex(draft)).toBe(draft);
  });

  it('clears a warning that undo has fixed', () => {
    // Bow-tie: fourth vertex makes the ring cross itself.
    let draft = clicks(createDraft('polygon'), p(0, 0), p(2, 2), p(2, 0), p(0, 2));
    expect(draft.warning).toMatch(/crosses itself/);
    draft = undoVertex(draft);
    expect(draft.warning).toBeNull();
  });
});

describe('the rubber band', () => {
  it('appends the cursor to the committed vertices', () => {
    const draft = setHover(clicks(createDraft('line'), p(0, 0), p(1, 1)), p(2, 2));
    expect(previewPath(draft)).toEqual([p(0, 0), p(1, 1), p(2, 2)]);
    // The cursor is NOT a vertex — undo must not have to skip it.
    expect(draft.vertices).toHaveLength(2);
  });

  it('returns the SAME state for a pointer that has not moved', () => {
    // This is what keeps a resting pointer from re-rendering the toolbar at
    // 60 Hz — the controller compares by identity.
    const draft = setHover(createDraft('line'), p(1, 1));
    expect(setHover(draft, p(1, 1))).toBe(draft);
  });

  it('has no rubber band while idle', () => {
    expect(previewPath(setHover(createDraft('idle'), p(1, 1)))).toEqual([]);
  });

  it('shows a provisional fill only once there are three points, and keeps it unclosed', () => {
    const two = setHover(clicks(createDraft('polygon'), p(0, 0), p(1, 0)), p(1, 1));
    expect(previewRing(two)).toHaveLength(3);
    // Unclosed even for something that exists for 400 ms: the preview and the
    // committed item are literally the same array shape.
    expect(previewRing(two)[0]).not.toEqual(previewRing(two)[2]);
    const one = clicks(createDraft('polygon'), p(0, 0));
    expect(previewRing(one)).toEqual([]);
  });
});

describe('live warnings', () => {
  it('says nothing about a simple shape', () => {
    expect(warningFor('polygon', [p(0, 0), p(1, 0), p(1, 1), p(0, 1)])).toBeNull();
  });

  it('warns about a ring that crosses itself', () => {
    expect(warningFor('polygon', [p(0, 0), p(2, 2), p(2, 0), p(0, 2)])).toMatch(/crosses itself/);
  });

  it('mentions a self-crossing line without calling it wrong', () => {
    const w = warningFor('line', [p(0, 0), p(2, 2), p(2, 0), p(0, 2)]);
    expect(w).toBe('This line crosses itself.');
  });
});

describe('finishing → a canonical Item', () => {
  it('refuses before the minimum is met, and says what is missing', () => {
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0));
    expect(canFinish(draft)).toBe(false);
    const result = finishDraft(draft, { id: 'draw-polygon-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too-few-vertices');
      expect(result.message).toMatch(/at least 3 points/);
    }
  });

  it('counts the minimum AFTER de-duplication', () => {
    // Three clicks, two of them on the same spot, is a two-vertex ring.
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 0));
    const result = finishDraft(draft, { id: 'x' });
    expect(result.ok).toBe(false);
  });

  it('produces a marker that parses', () => {
    const draft = clicks(createDraft('marker'), p(-21.9426, 64.1466, 61));
    const result = finishDraft(draft, { id: 'draw-marker-1', style: DEFAULT_STYLE, title: 'Hallgrímskirkja' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = parsed(result.item);
    expect(item.type).toBe('marker');
    expect(item).toMatchObject({
      id: 'draw-marker-1',
      title: 'Hallgrímskirkja',
      position: { lon: -21.9426, lat: 64.1466, height: 61 },
      color: DEFAULT_STYLE.color,
      icon: DEFAULT_STYLE.icon,
      source: { kind: 'manual' },
    });
  });

  it('produces a note that parses, and refuses one with no text', () => {
    const draft = clicks(createDraft('note'), p(1, 2));
    expect(finishDraft(draft, { id: 'n1' }).ok).toBe(false);
    const blank = finishDraft(draft, { id: 'n1', text: '   ' });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.reason).toBe('no-text');

    const ok = finishDraft(draft, { id: 'n1', text: '  we sat here  ' });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const item = parsed(ok.item);
    expect(item).toMatchObject({ type: 'note', text: 'we sat here' });
  });

  it('produces a line that parses, with style on canonical fields', () => {
    const draft = clicks(createDraft('line'), p(0, 0, 10), p(1, 1, 20), p(2, 0, 30));
    const result = finishDraft(draft, {
      id: 'draw-line-1',
      style: { ...DEFAULT_STYLE, color: '#ff8d6e', width: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = parsed(result.item);
    expect(item).toMatchObject({
      type: 'line',
      color: '#ff8d6e',
      width: 5,
      clampToGround: true,
    });
    if (item.type !== 'line') throw new Error('narrowing');
    expect(item.positions).toHaveLength(3);
    // Heights survive, because KML and GeoJSON exports want real elevations
    // even when the shape is draped for rendering.
    expect(item.positions[1]!.height).toBe(20);
  });

  it('produces a polygon whose ring is stored UNCLOSED', () => {
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1), p(0, 1));
    const result = finishDraft(draft, { id: 'draw-polygon-1', style: DEFAULT_STYLE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = parsed(result.item);
    if (item.type !== 'polygon') throw new Error('narrowing');
    expect(item.positions).toHaveLength(4);
    expect(item.positions[0]).not.toEqual(item.positions[3]);
    expect(item).toMatchObject({
      fillColor: DEFAULT_STYLE.color,
      fillOpacity: DEFAULT_STYLE.fillOpacity,
      outlineColor: DEFAULT_STYLE.outlineColor,
      outlineWidth: DEFAULT_STYLE.outlineWidth,
    });
  });

  it('strips a closing vertex a user drew by hand', () => {
    // Clicking back onto the first point is how people close a shape in every
    // other drawing tool. It must not become a repeated final vertex.
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1), p(0, 0));
    const result = finishDraft(draft, { id: 'ring' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = parsed(result.item);
    if (item.type !== 'polygon') throw new Error('narrowing');
    expect(item.positions).toEqual([p(0, 0), p(1, 0), p(1, 1)]);
  });

  it('keeps fillOpacity 0 — outline-only is a real choice, not a falsy one', () => {
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1));
    const result = finishDraft(draft, { id: 'p', style: { ...DEFAULT_STYLE, fillOpacity: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parsed(result.item)).toMatchObject({ fillOpacity: 0 });
  });

  it('REFUSES a self-intersecting ring by default, and commits it on request', () => {
    const draft = clicks(createDraft('polygon'), p(0, 0), p(2, 2), p(2, 0), p(0, 2));
    const refused = finishDraft(draft, { id: 'bowtie' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('self-intersecting');

    const forced = finishDraft(draft, { id: 'bowtie', allowSelfIntersecting: true });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(parsed(forced.item).type).toBe('polygon');
  });

  it('never commits from idle', () => {
    const result = finishDraft(createDraft('idle'), { id: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('idle');
  });

  it('carries the story time through, so a drawn shape sits on the timeline', () => {
    const draft = clicks(createDraft('marker'), p(0, 0));
    const result = finishDraft(draft, { id: 'm', time: '2026-03-14T09:00:00Z' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(parsed(result.item).time).toBe('2026-03-14T09:00:00Z');
  });
});

describe('snapshot, for the toolbar', () => {
  it('reports the running length of a line', () => {
    const draft = clicks(createDraft('line'), p(0, 0), p(0, 1));
    const s = snapshot(draft);
    expect(s.vertexCount).toBe(2);
    expect(s.canFinish).toBe(true);
    expect(s.areaMeters).toBe(0);
    expect(s.lengthMeters / 1000).toBeCloseTo(111.2, 0);
  });

  it('reports area AND perimeter for a polygon', () => {
    const draft = clicks(createDraft('polygon'), p(0, 0), p(1, 0), p(1, 1), p(0, 1));
    const s = snapshot(draft);
    expect(s.areaMeters).toBeGreaterThan(0);
    // The perimeter closes the ring, so it is four sides and not three.
    expect(s.lengthMeters / 1000).toBeCloseTo(444, -1);
  });

  it('carries the warning so the toolbar can show it as it is drawn', () => {
    const draft = clicks(createDraft('polygon'), p(0, 0), p(2, 2), p(2, 0), p(0, 2));
    expect(snapshot(draft).warning).toMatch(/crosses itself/);
  });
});

describe('editable vertices', () => {
  it('exposes one handle for a placed item and the whole ring for geometry', () => {
    expect(editableVertices({ id: 'm', type: 'marker', position: p(1, 2) })).toEqual([p(1, 2)]);
    expect(
      editableVertices({ id: 'l', type: 'line', positions: [p(0, 0), p(1, 1)] }),
    ).toHaveLength(2);
  });

  it('anchors a placed item on itself and a shape on its vertex mean', () => {
    expect(itemAnchor({ id: 'm', type: 'marker', position: p(1, 2) })).toEqual(p(1, 2));
    expect(
      itemAnchor({ id: 'p', type: 'polygon', positions: [p(0, 0), p(2, 0), p(2, 2), p(0, 2)] }),
    ).toEqual({ lon: 1, lat: 1 });
  });
});
