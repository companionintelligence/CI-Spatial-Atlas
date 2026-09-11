/**
 * "Click points" measuring, and the note text a two-step click used to lose.
 *
 * Two independent defects, tested together because both are about a click
 * doing the wrong thing to a piece of typed-in state:
 *
 *   - Measuring between two placed pins used to mean re-clicking the globe
 *     near each one and hoping the terrain under your cursor matched — off by
 *     however much the pin's own screen-space offset and the slope added.
 *     "Click points" mode reads the pin's own position instead, so the
 *     assertions here prove exactness by making the terrain under the cursor
 *     and the pin it is rendered over disagree by a wide margin, then
 *     checking which one the reading used.
 *   - A note commits on a single click, so `commit()` resets its own copy of
 *     `noteText` immediately — proven here via the controller's own
 *     `getNoteText()`, without needing the React-side mirror in
 *     `useAuthoring.ts` (covered separately by `Toolbar.tsx`'s zero-state
 *     copy, which reads the same prop).
 *
 * Same fakes as `authoring-measure-history-wiring.test.ts`: Cesium's own
 * `ScreenSpaceEventHandler` runs against stub DOM elements, and a click is
 * "fire mousedown on the canvas, mouseup on the document".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import { createAuthoringController, type AuthoringController } from '../src/authoring/controller.js';

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

const g = globalThis as unknown as Record<string, unknown>;
const documentStub = fakeElement();
const windowStub = fakeElement();
g.document = { ...documentStub, createElement: () => fakeElement(), documentElement: { style: {} } };
g.window = windowStub;
g.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };

const fire = (el: { listeners: Map<string, Set<(e: unknown) => void>> }, type: string, event: unknown): void => {
  for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
};

/** Screen pixels per degree in the stubbed *terrain* pick — deliberately far
 *  from any coordinate a stubbed *entity* pick returns in this file, so a
 *  vertex that came from the wrong one is easy to tell apart from one that
 *  didn't. */
const PX_PER_DEGREE = 20;

let canvas: FakeElement;
/** What `scene.pick` returns for the NEXT click. `null` means "hit nothing" —
 *  the empty-space case a real click on open globe produces. */
let nextPick: { id?: unknown } | null = null;

function fakeViewer() {
  canvas = fakeElement();
  return {
    isDestroyed: () => false,
    dataSources: new Cesium.DataSourceCollection(),
    container: fakeElement(),
    screenSpaceEventHandler: {
      getInputAction: () => undefined,
      setInputAction: () => {},
      removeInputAction: () => {},
      isDestroyed: () => false,
    },
    clock: { currentTime: Cesium.JulianDate.now() },
    camera: {
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
        pick: (ray: { px: number; py: number }) =>
          Cesium.Cartesian3.fromDegrees(ray.px / PX_PER_DEGREE, ray.py / PX_PER_DEGREE, 0),
      },
      pick: () => nextPick ?? undefined,
      screenSpaceCameraController: {
        enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true,
      },
    },
  } as unknown as Cesium.Viewer;
}

const mouse = (x: number, y: number) => ({
  button: 0,
  clientX: x,
  clientY: y,
  preventDefault() {},
  stopPropagation() {},
});

/** One left click at the pixel that terrain-maps to this lon/lat. In "click
 *  points" mode the terrain mapping is irrelevant — only `nextPick` decides
 *  what the click lands on — but reusing it keeps every click call one line. */
function click(terrainLon: number, terrainLat: number): void {
  const x = terrainLon * PX_PER_DEGREE;
  const y = terrainLat * PX_PER_DEGREE;
  fire(canvas, 'mousedown', mouse(x, y));
  fire(g.document as FakeElement, 'mouseup', mouse(x, y));
}

/** A stub entity, positioned exactly at `lon`/`lat` — enough for
 *  `pickEntityPosition` (`.id.position.getValue(time)`), nothing more. */
const entityAt = (lon: number, lat: number): { id: unknown } => ({
  id: { position: { getValue: () => Cesium.Cartesian3.fromDegrees(lon, lat, 0) } },
});

let viewer: Cesium.Viewer;
let controller: AuthoringController;
let changes: unknown[][];

beforeEach(() => {
  viewer = fakeViewer();
  nextPick = null;
  changes = [];
  controller = createAuthoringController(viewer, {
    onChange: (items) => { changes.push(items); },
  });
});

afterEach(() => {
  controller.destroy();
});

describe('measure mode defaults to free draw', () => {
  it('starts in free mode', () => {
    expect(controller.getMeasureMode()).toBe('free');
  });

  it('free mode still reads the terrain, exactly as before this feature', () => {
    controller.setMode('measure');
    click(0, 0);
    click(1, 0);
    // 1 degree of longitude at the equator, from the terrain stub.
    expect(controller.getDraft().lengthMeters).toBeCloseTo(111_195, -1);
  });
});

describe('"click points" reads a pin\'s own position, not the terrain under the click', () => {
  it('uses the entity position even when it disagrees wildly with the terrain pixel', () => {
    controller.setMode('measure');
    controller.setMeasureMode('points');
    expect(controller.getMeasureMode()).toBe('points');

    // Both clicks land on terrain pixels one degree apart (~111 km) — but each
    // pixel is stubbed to have a pin sitting far from where its own terrain
    // pixel would put it.
    nextPick = entityAt(0, 0);
    click(0, 0);
    nextPick = entityAt(50, 0);
    click(1, 0);

    expect(controller.getDraft().vertexCount).toBe(2);
    // ~50 degrees of longitude at the equator is thousands of km — nothing
    // close to the ~111 km the terrain pixels themselves were one degree
    // apart by. A reading anywhere near 111 km would mean the terrain pick
    // won instead of the pin.
    expect(controller.getDraft().lengthMeters).toBeGreaterThan(1_000_000);
  });

  it('does nothing on a click that misses every pin, rather than falling back to terrain', () => {
    controller.setMode('measure');
    controller.setMeasureMode('points');

    nextPick = entityAt(0, 0);
    click(0, 0);
    expect(controller.getDraft().vertexCount).toBe(1);

    nextPick = null; // empty space
    click(5, 5);
    // Still 1 — the miss added nothing, and did not silently take the terrain
    // point under (5, 5) either.
    expect(controller.getDraft().vertexCount).toBe(1);
  });

  it('starts the reading over when the mode is switched mid-draft', () => {
    controller.setMode('measure');
    nextPick = entityAt(0, 0); // scene.pick is consulted regardless of mode; harmless in free mode
    click(0, 0);
    expect(controller.getDraft().vertexCount).toBe(1);

    controller.setMeasureMode('points');
    // A path with some vertices placed freely and others snapped to a pin's
    // exact position has no honest way to show which is which on screen.
    expect(controller.getDraft().vertexCount).toBe(0);
  });

  it('does not disturb an empty draft when the mode is switched', () => {
    controller.setMode('measure');
    controller.setMeasureMode('points');
    expect(controller.getDraft().vertexCount).toBe(0);
    expect(controller.getDraft().warning).toBeNull();
  });
});

describe('a committed note clears its own text before the next one is typed', () => {
  it('resets the controller\'s copy of noteText once the click that places it lands', () => {
    controller.setMode('note');
    controller.setNoteText('Found the old trailhead marker here.');
    click(2, 2);

    expect(controller.getNoteText()).toBe('');
  });

  it('does not let a second note in the same run inherit the first one\'s words', () => {
    controller.setMode('note');
    controller.setNoteText('First note.');
    click(1, 1);

    controller.setMode('note');
    controller.setNoteText('Second note.');
    click(2, 2);

    // `onChange` reports the whole list each time, not a delta — the last
    // call is the final state, and the only one worth reading.
    const finalItems = changes[changes.length - 1] ?? [];
    const notes = finalItems.filter((item): item is { type: string; text: string } =>
      typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'note',
    );
    expect(notes.map((n) => n.text)).toEqual(['First note.', 'Second note.']);
  });
});
