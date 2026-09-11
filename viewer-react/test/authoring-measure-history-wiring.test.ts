import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import type { Item } from '@companion-atlas/story';
import { createAuthoringController, type AuthoringController } from '../src/authoring/controller.js';
import type { Measurement } from '../src/authoring/measure.js';
import { itemEntityId, MEASURE_LINE_ID, MEASURE_PREFIX } from '../src/authoring/ids.js';

/**
 * The wiring, driven through real input.
 *
 * `authoring-measure.test.ts` and `authoring-history.test.ts` prove the logic.
 * This file exists because that is not the same as the feature working: the
 * recurring failure in this codebase is a control that is present, looks armed,
 * and is connected to nothing. So this suite clicks the globe through Cesium's
 * own event pipeline and then asks the questions a user would:
 *
 *   - I clicked twice with the measure tool and double-clicked. Did I get a
 *     reading, and did I get an item I did not ask for?
 *   - I pressed Delete and then Ctrl+Z. Is my polygon back **on the globe**,
 *     not merely back in an array?
 *   - I pressed Ctrl+Z while typing in the note field. Did it stay out of it?
 *
 * ## How input is synthesised
 *
 * `authoring-enabled.test.ts` declined to do this and stuck to the API, which
 * was right for what it tests (the enable toggle owns no input). Here the input
 * path IS the thing under test, so the fakes go one level deeper:
 *
 *   - `ScreenSpaceEventHandler` registers `mousedown`/`dblclick` on the canvas
 *     and `mouseup`/`mousemove` on `document`. Both stubs record their
 *     listeners, so a click is "fire mousedown on the canvas, mouseup on the
 *     document" and Cesium's real handler does the rest — including the click
 *     pixel tolerance, which is part of what is being tested.
 *   - The pick is stubbed so a screen pixel maps linearly to lon/lat at
 *     `PX_PER_DEGREE`. That scale is not cosmetic: the controller drops a click
 *     within `DOUBLE_CLICK_PIXELS` (6) of the previous one, so a 1:1 mapping
 *     would make two vertices one degree apart read as a double-click and every
 *     shape below would silently come out a vertex short. `pick.ts` has its own
 *     suite for the strategies it chooses between.
 */

interface FakeElement {
  listeners: Map<string, Set<(e: unknown) => void>>;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
  classList: { add(): void; remove(): void; toggle(): void };
  style: Record<string, string>;
  setAttribute(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

function fakeElement(): FakeElement {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
}

// Cesium is imported statically above so its module init runs against a real
// (absent) document; the stubs are installed after. See the long note in
// `authoring-enabled.test.ts` — knockout dies on a partial `document` at import
// time, and defining these afterwards is the whole trick.
const g = globalThis as unknown as Record<string, unknown>;
const documentStub = fakeElement();
const windowStub = fakeElement();
g.document = { ...documentStub, createElement: () => fakeElement(), documentElement: { style: {} } };
g.window = windowStub;
g.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };

const fire = (el: { listeners: Map<string, Set<(e: unknown) => void>> }, type: string, event: unknown): void => {
  for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
};

let canvas: FakeElement;

function fakeViewer() {
  canvas = fakeElement();
  const dataSources = new Cesium.DataSourceCollection();
  return {
    isDestroyed: () => false,
    dataSources,
    container: fakeElement(),
    screenSpaceEventHandler: {
      getInputAction: () => undefined,
      setInputAction: () => {},
      removeInputAction: () => {},
      isDestroyed: () => false,
    },
    camera: {
      // Carries the pixel through to the globe stub below. `pick.ts` reuses a
      // scratch ray, so a fresh object here is the honest stand-in.
      getPickRay: (pos: Cesium.Cartesian2) => ({ px: pos.x, py: pos.y }),
      pickEllipsoid: () => undefined,
    },
    scene: {
      canvas,
      requestRender: () => {},
      pickPositionSupported: false,
      globe: {
        show: true,
        ellipsoid: Cesium.Ellipsoid.WGS84,
        // Pixel → degrees, linearly. Deliberately exact, so every assertion
        // below reads in whole degrees.
        pick: (ray: { px: number; py: number }) =>
          Cesium.Cartesian3.fromDegrees(ray.px / PX_PER_DEGREE, ray.py / PX_PER_DEGREE, 0),
      },
      pick: () => undefined,
      screenSpaceCameraController: {
        enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true,
      },
    },
  } as unknown as Cesium.Viewer;
}

/** Screen pixels per degree in the stubbed pick. Comfortably above
 *  `DOUBLE_CLICK_PIXELS` so that adjacent test vertices are adjacent clicks. */
const PX_PER_DEGREE = 20;

const mouse = (x: number, y: number) => ({
  button: 0,
  clientX: x,
  clientY: y,
  preventDefault() {},
  stopPropagation() {},
});

/** One left click at a lon/lat, through Cesium's own pipeline. */
function click(lon: number, lat: number): void {
  const x = lon * PX_PER_DEGREE;
  const y = lat * PX_PER_DEGREE;
  fire(canvas, 'mousedown', mouse(x, y));
  fire(g.document as FakeElement, 'mouseup', mouse(x, y));
}

/**
 * A real double-click: two clicks, then the browser's `dblclick`.
 *
 * All three are fired because that is what a browser delivers, and the second
 * click is precisely the one the controller's `withinDoubleClick` guard has to
 * swallow — a test that fired only `dblclick` would pass while the guard was
 * broken and the finishing gesture was leaving a spurious extra vertex.
 */
function doubleClick(lon: number, lat: number): void {
  click(lon, lat);
  click(lon, lat);
  fire(canvas, 'dblclick', mouse(lon * PX_PER_DEGREE, lat * PX_PER_DEGREE));
}

/** A keystroke on `window`, where the controller's shortcuts live. Returns
 *  whether the controller claimed it. */
function key(init: Record<string, unknown>): boolean {
  let prevented = false;
  fire(windowStub, 'keydown', {
    key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    target: { tagName: 'CANVAS' },
    preventDefault() { prevented = true; },
    ...init,
  });
  return prevented;
}

const p = (lon: number, lat: number) => ({ lon, lat });
const polygon: Item = {
  id: 'draw-polygon-1',
  type: 'polygon',
  positions: [p(0, 0), p(1, 0), p(1, 1)],
  // An EXPLICIT colour, because that is what the re-arm test is about. An item
  // with no `fillColor` reports `undefined` from `styleOf`, and `mergeStyle`
  // deliberately ignores undefined (a colour input hands back "" mid-edit) — so
  // selecting a shape that never stated a colour leaves the tool on whatever it
  // had, which is the same before and after an undo.
  fillColor: '#72ddd4',
  source: { kind: 'manual' },
} as Item;

async function layer(viewer: Cesium.Viewer): Promise<Cesium.DataSource> {
  await Promise.resolve();
  await Promise.resolve();
  return viewer.dataSources.get(0);
}

const idsWithPrefix = (ds: Cesium.DataSource, prefix: string): string[] =>
  ds.entities.values.map((e) => e.id).filter((id) => id.startsWith(prefix));

let viewer: Cesium.Viewer;
let controller: AuthoringController;
let changes: Item[][];
let measurements: (Measurement | null)[];

beforeEach(() => {
  viewer = fakeViewer();
  changes = [];
  measurements = [];
  controller = createAuthoringController(viewer, {
    onChange: (items) => { changes.push(items); },
    onMeasure: (m) => { measurements.push(m); },
  });
});

afterEach(() => {
  controller.destroy();
});

describe('measuring, end to end', () => {
  it('answers "how far" without producing an item', () => {
    controller.setMode('measure');
    click(0, 0);
    click(0, 1);
    expect(controller.getDraft().vertexCount).toBe(2);

    doubleClick(0, 1);

    const m = controller.getMeasurement();
    expect(m).not.toBeNull();
    expect(m!.points).toHaveLength(2);
    // One degree of latitude.
    expect(m!.lengthMeters / 111_195).toBeCloseTo(1, 2);

    // The whole point of the feature: nothing was authored.
    expect(controller.getItems()).toEqual([]);
    expect(changes).toEqual([]);
    expect(measurements).toEqual([m]);
  });

  it('reports an area for a closed measure ring, still with no item', () => {
    controller.setMode('measure');
    click(0, 0);
    click(1, 0);
    doubleClick(1, 1);

    const m = controller.getMeasurement()!;
    expect(m.points).toHaveLength(3);
    expect(m.areaMeters).toBeGreaterThan(0);
    expect(m.perimeterMeters).toBeGreaterThan(m.lengthMeters);
    expect(controller.getItems()).toEqual([]);
  });

  it('draws the reading on the globe, under ids nothing can select as an item', async () => {
    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 2);
    const ds = await layer(viewer);

    expect(idsWithPrefix(ds, MEASURE_PREFIX)).toContain(MEASURE_LINE_ID);
    expect(idsWithPrefix(ds, MEASURE_PREFIX)).toContain('authoring-measure-label');
    // Nothing in the item namespace, so the layer cannot be read as content.
    expect(idsWithPrefix(ds, 'authoring:')).toEqual([]);
  });

  it('writes the label in the chosen units, and rewrites it when they change', async () => {
    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 1);
    const ds = await layer(viewer);

    const labelText = () => {
      const e = ds.entities.getById('authoring-measure-label');
      return e?.label?.text?.getValue(Cesium.JulianDate.now()) as string | undefined;
    };
    expect(labelText()).toMatch(/km$/);

    controller.setUnits('imperial');
    // A units toggle that changed the panel and left the globe saying "111 km"
    // would be two answers to one question.
    expect(labelText()).toMatch(/mi$/);
    expect(controller.getUnits()).toBe('imperial');
  });

  it('keeps the reading when another tool is armed — that is what it is for', async () => {
    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 1);
    const held = controller.getMeasurement();

    // Measure a setback, then draw the shape that respects it.
    controller.setMode('polygon');
    expect(controller.getMeasurement()).toEqual(held);
    const ds = await layer(viewer);
    expect(idsWithPrefix(ds, MEASURE_PREFIX)).toContain(MEASURE_LINE_ID);
  });

  it('replaces the previous reading rather than stacking them up', async () => {
    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 1);
    click(5, 5);
    doubleClick(5, 8);

    const ds = await layer(viewer);
    // One line, one label — a pile of stale measurements over a globe is
    // indistinguishable from drawn content.
    expect(idsWithPrefix(ds, MEASURE_PREFIX).filter((id) => id === MEASURE_LINE_ID)).toHaveLength(1);
    // The newest reading, not the first: `toBeCloseTo` because the value has
    // been through Cartesian3 and back, which is what a real pick does too.
    expect(controller.getMeasurement()!.points[0]!.lon).toBeCloseTo(5, 6);
    expect(controller.getMeasurement()!.points[0]!.lat).toBeCloseTo(5, 6);
  });

  it('clears on demand, and when the tools are disarmed', async () => {
    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 1);
    const ds = await layer(viewer);

    controller.clearMeasurement();
    expect(controller.getMeasurement()).toBeNull();
    expect(idsWithPrefix(ds, MEASURE_PREFIX)).toEqual([]);

    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 1);
    expect(controller.getMeasurement()).not.toBeNull();

    // Closing the panel takes the reading with it: a measurement floating over
    // a globe with no toolbar to explain or clear it is the stray-annotation
    // confusion the feature exists to avoid. Finished SHAPES still stay.
    controller.setEnabled(false);
    expect(controller.getMeasurement()).toBeNull();
    expect(idsWithPrefix(ds, MEASURE_PREFIX)).toEqual([]);
  });

  it('refuses to finish a measurement of one point, and says so', () => {
    controller.setMode('measure');
    click(3, 3);
    expect(controller.finish()).toBeNull();
    expect(controller.getMeasurement()).toBeNull();
    expect(controller.getDraft().warning).toMatch(/at least two points/i);
  });
});

describe('undo and redo, end to end', () => {
  it('brings a deleted shape back onto the globe', async () => {
    controller.setItems([polygon]);
    const ds = await layer(viewer);
    controller.select({ kind: 'item', id: polygon.id });

    expect(controller.deleteSelected()).toBe(true);
    expect(idsWithPrefix(ds, 'authoring:')).toEqual([]);
    expect(controller.getHistory().canUndo).toBe(true);
    expect(controller.getHistory().undoLabel).toBe('delete area');

    expect(controller.undo()).toBe(true);
    // In the array AND on the globe. The array was never the thing that broke.
    expect(controller.getItems().map((i) => i.id)).toEqual([polygon.id]);
    expect(idsWithPrefix(ds, 'authoring:')).toContain(itemEntityId(polygon.id));

    expect(controller.redo()).toBe(true);
    expect(idsWithPrefix(ds, 'authoring:')).toEqual([]);
  });

  it('undoes a shape that was just drawn', async () => {
    controller.setMode('polygon');
    click(0, 0);
    click(1, 0);
    doubleClick(1, 1);

    const drawn = controller.getItems();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.type).toBe('polygon');
    expect(controller.getHistory().undoLabel).toBe('add area');

    const ds = await layer(viewer);
    expect(controller.undo()).toBe(true);
    expect(controller.getItems()).toEqual([]);
    expect(idsWithPrefix(ds, 'authoring:')).toEqual([]);
  });

  it('re-arms the tool and the panel with the shape an undo restored', () => {
    const selections: unknown[] = [];
    controller.destroy();
    controller = createAuthoringController(viewer, { onSelect: (sel) => { selections.push(sel); } });
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.restyleSelected({ color: '#ff8d6e' });
    expect(controller.getStyle().color).toBe('#ff8d6e');

    selections.length = 0;
    controller.undo();
    // The shape is teal again, so the swatch must be too — otherwise the panel
    // says orange over a teal shape, and the next shape drawn comes out orange.
    expect(controller.getStyle().color).toBe(polygon.fillColor ?? '#72ddd4');
    // And the selection was re-emitted even though its id never changed, so a
    // panel bound to `selection.item` is not a step behind.
    expect(selections).toHaveLength(1);
    expect((selections[0] as { item?: { fillColor?: string } }).item?.fillColor)
      .toBe(polygon.fillColor);
  });

  it('collapses a restyle drag into one step', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    // What a range input does: one call per pixel of travel.
    for (let i = 1; i <= 12; i++) controller.restyleSelected({ fillOpacity: i / 12 });

    expect(controller.getHistory().depth).toBe(1);
    controller.undo();
    expect(controller.getItems()[0]).toEqual(polygon);
  });

  it('drops a selection whose item an undo removed, so no handles are left over a ghost', async () => {
    controller.setMode('marker');
    click(4, 4);
    // A marker stages on the click and commits on Finish — the click alone used
    // to produce the item, and the button that was supposed to commit it could
    // therefore never be pressed. See `marker-staging.test.ts`.
    controller.finish();
    const id = controller.getItems()[0]!.id;
    // Back to the select tool: handles are suppressed while a drawing tool is
    // armed, so that they cannot swallow the first click of the next shape.
    controller.setMode('idle');
    controller.select({ kind: 'item', id });
    const ds = await layer(viewer);
    expect(idsWithPrefix(ds, 'authoring-vertex:')).not.toEqual([]);

    controller.undo();
    // Stale handles are live drag targets and would write through `setVertex`
    // to an item that no longer exists.
    expect(controller.getSelection()).toBeNull();
    expect(idsWithPrefix(ds, 'authoring-vertex:')).toEqual([]);
  });

  it('re-bases rather than recording when a story is loaded into it', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.deleteSelected();
    expect(controller.getHistory().canUndo).toBe(true);

    // A story load, a scope change on sign-in, hydration from storage.
    controller.setItems([polygon]);
    expect(controller.getHistory().canUndo).toBe(false);
    expect(controller.getHistory().canRedo).toBe(false);
  });

  it('never records a measurement', () => {
    controller.setItems([polygon]);
    const before = controller.getHistory();
    controller.setMode('measure');
    click(0, 0);
    doubleClick(0, 1);
    expect(controller.getHistory()).toEqual(before);
    expect(controller.getHistory().canUndo).toBe(false);
  });

  it('never records a mode change', () => {
    controller.setItems([polygon]);
    controller.setMode('line');
    controller.setMode('polygon');
    controller.setMode('idle');
    expect(controller.getHistory().canUndo).toBe(false);
  });
});

describe('the keyboard, mounted by the controller itself', () => {
  it('undoes on Ctrl+Z and redoes on Ctrl+Shift+Z', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.deleteSelected();

    expect(key({ ctrlKey: true })).toBe(true);
    expect(controller.getItems().map((i) => i.id)).toEqual([polygon.id]);

    expect(key({ ctrlKey: true, shiftKey: true, key: 'Z' })).toBe(true);
    expect(controller.getItems()).toEqual([]);
  });

  it('works on Cmd+Z too', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.deleteSelected();
    expect(key({ metaKey: true })).toBe(true);
    expect(controller.getItems()).toHaveLength(1);
  });

  it('leaves the keystroke alone when there is nothing to undo', () => {
    controller.setItems([polygon]);
    // No `preventDefault`, so the rest of the page still gets its Ctrl+Z.
    expect(key({ ctrlKey: true })).toBe(false);
    expect(key({ ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('stays out of a text field — the browser owns undo there', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.deleteSelected();

    expect(key({ ctrlKey: true, target: { tagName: 'INPUT' } })).toBe(false);
    expect(key({ ctrlKey: true, target: { tagName: 'TEXTAREA' } })).toBe(false);
    expect(key({ ctrlKey: true, target: { isContentEditable: true } })).toBe(false);
    // The shape is still deleted: nothing was undone behind the typing.
    expect(controller.getItems()).toEqual([]);
  });

  it('stays out of it entirely while the tools are disarmed', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.deleteSelected();
    controller.setEnabled(false);

    expect(key({ ctrlKey: true })).toBe(false);
    expect(controller.getItems()).toEqual([]);

    // …and the history survived the disarm, so re-arming restores the offer.
    controller.setEnabled(true);
    expect(key({ ctrlKey: true })).toBe(true);
    expect(controller.getItems()).toHaveLength(1);
  });

  it('does not fire after destroy — a leaked listener outlives a remount', () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    controller.deleteSelected();
    controller.destroy();
    expect(key({ ctrlKey: true })).toBe(false);
  });
});
