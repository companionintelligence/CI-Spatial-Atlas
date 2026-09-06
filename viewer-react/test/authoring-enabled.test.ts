import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import type { Item } from '@companion-atlas/story';
import { createAuthoringController, type AuthoringController } from '../src/authoring/controller.js';
import { itemEntityId } from '../src/authoring/ids.js';

/**
 * Disarming the tools must not erase the drawings.
 *
 * The defect this file exists for: `useAuthoring` had `enabled` in the
 * controller effect's dependency list, so closing the draw toolbar ran the
 * cleanup, which called `destroy()`, which removes the `CustomDataSource` and
 * every shape in it. The items survived in React state and came back when Draw
 * was re-armed — so the globe went blank for exactly as long as the panel was
 * closed, and it read as "the app deleted my work".
 *
 * The assertion that matters is therefore about *entities on the globe*, not
 * about the item array: the array was never the thing that broke.
 *
 * ## Why this suite can build a controller at all
 *
 * `controller.ts` sits below the Cesium line in `authoring/index.ts`, and the
 * suite runs in Node with no DOM. Two things make it work:
 *
 *   - Cesium is imported *statically*, so its module initialisation runs before
 *     the stubs below exist. That matters: `@cesium/widgets` bundles knockout,
 *     which walks a real `document` at import time if it finds one and dies on
 *     a stub. Defining the globals after the import is the whole trick.
 *   - Nothing here renders. `ScreenSpaceEventHandler` only needs an element
 *     with `addEventListener`, and entities are inspected as data — the same
 *     bargain `authoring-entities.test.ts` and `layers-cesium.test.ts` strike.
 *
 * Input is not synthesised (that would mean faking Cesium's pointer pipeline).
 * What is checked is what the toggle owns: the layer, the handlers, the mode
 * and the selection.
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

const g = globalThis as unknown as Record<string, unknown>;
const windowStub = fakeElement();
g.document ??= { ...fakeElement(), createElement: () => fakeElement(), documentElement: { style: {} } };
// Assigned rather than defaulted: Node has no `window`, and the controller's
// `window.addEventListener` calls have to land somewhere this file can count.
g.window = windowStub;
g.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };
/** How many window listeners the controller is currently holding. `destroy()`
 *  has to take these back — a leaked `keydown` outlives a React remount. */
const windowListeners = (): number =>
  ['keydown', 'pointerup', 'pointercancel'].reduce(
    (n, type) => n + (windowStub.listeners.get(type)?.size ?? 0),
    0,
  );

function fakeViewer() {
  const dataSources = new Cesium.DataSourceCollection();
  return {
    isDestroyed: () => false,
    dataSources,
    container: fakeElement(),
    // A stand-in for the viewer's own handler: the controller only ever reads
    // and restores its LEFT_DOUBLE_CLICK action.
    screenSpaceEventHandler: {
      getInputAction: () => undefined,
      setInputAction: () => {},
      removeInputAction: () => {},
      isDestroyed: () => false,
    },
    scene: {
      canvas: fakeElement(),
      requestRender: () => {},
      screenSpaceCameraController: {
        enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true,
      },
    },
  } as unknown as Cesium.Viewer;
}

const p = (lon: number, lat: number) => ({ lon, lat });
const polygon: Item = {
  id: 'draw-polygon-1',
  type: 'polygon',
  positions: [p(0, 0), p(1, 0), p(1, 1)],
  source: { kind: 'manual' },
} as Item;
const marker: Item = {
  id: 'draw-marker-1',
  type: 'marker',
  position: p(2, 2),
  source: { kind: 'manual' },
} as Item;

/** The controller's own layer, once `dataSources.add` has resolved — the add is
 *  a promise, which is exactly why `destroy()` chains off it rather than
 *  removing synchronously. */
async function drawingLayer(viewer: Cesium.Viewer): Promise<Cesium.DataSource> {
  await Promise.resolve();
  await Promise.resolve();
  return viewer.dataSources.get(0);
}

const drawnIds = (ds: Cesium.DataSource): string[] =>
  ds.entities.values.map((e) => e.id).filter((id) => id.startsWith('authoring:'));

let viewer: Cesium.Viewer;
let controller: AuthoringController;

beforeEach(() => {
  viewer = fakeViewer();
  controller = createAuthoringController(viewer, {});
});

afterEach(() => {
  controller.destroy();
});

describe('enabled gates input, not the drawings', () => {
  it('keeps every finished shape on the globe across a toggle', async () => {
    controller.setItems([polygon, marker]);
    const ds = await drawingLayer(viewer);
    expect(drawnIds(ds)).toContain(itemEntityId(polygon.id));
    expect(drawnIds(ds)).toContain(itemEntityId(marker.id));

    controller.setEnabled(false);
    // The regression: this used to be `destroy()`, and the layer went with it.
    expect(controller.isEnabled()).toBe(false);
    expect(drawnIds(ds)).toContain(itemEntityId(polygon.id));
    expect(drawnIds(ds)).toContain(itemEntityId(marker.id));
    expect(controller.getItems().map((i) => i.id)).toEqual([polygon.id, marker.id]);
    // …and the layer is still the viewer's, not orphaned.
    expect(viewer.dataSources.contains(ds)).toBe(true);

    controller.setEnabled(true);
    expect(drawnIds(ds)).toContain(itemEntityId(polygon.id));
    expect(controller.getItems()).toHaveLength(2);
  });

  it('drops the shape in progress rather than committing it', () => {
    controller.setMode('polygon');
    expect(controller.getMode()).toBe('polygon');

    controller.setEnabled(false);
    // Half a polygon is not work the user asked to keep, and leaving the tool
    // armed would show a live preview over a globe that ignores clicks.
    expect(controller.getMode()).toBe('idle');
    expect(controller.getDraft().vertexCount).toBe(0);
    expect(controller.getItems()).toHaveLength(0);
  });

  it('refuses to arm a tool while disabled', () => {
    controller.setEnabled(false);
    controller.setMode('line');
    expect(controller.getMode()).toBe('idle');

    controller.setEnabled(true);
    controller.setMode('line');
    expect(controller.getMode()).toBe('line');
  });

  it('gives up the selection handles but keeps the shape', async () => {
    controller.setItems([polygon]);
    controller.select({ kind: 'item', id: polygon.id });
    const ds = await drawingLayer(viewer);
    expect(ds.entities.values.some((e) => e.id.startsWith('authoring-vertex:'))).toBe(true);

    controller.setEnabled(false);
    // Handles are drag targets, so they have to go; the shape they belonged to
    // does not.
    expect(controller.getSelection()).toBeNull();
    expect(ds.entities.values.some((e) => e.id.startsWith('authoring-vertex:'))).toBe(false);
    expect(drawnIds(ds)).toContain(itemEntityId(polygon.id));
  });

  it('starts disarmed when constructed that way', () => {
    const c = createAuthoringController(viewer, { enabled: false });
    expect(c.isEnabled()).toBe(false);
    c.setMode('marker');
    expect(c.getMode()).toBe('idle');
    c.destroy();
  });
});

describe('destroy still releases everything', () => {
  it('takes the layer and the window listeners back', async () => {
    controller.setItems([polygon]);
    const ds = await drawingLayer(viewer);
    const held = windowListeners();
    expect(held).toBeGreaterThan(0);

    controller.setEnabled(false); // disabling must NOT be a substitute for this
    expect(windowListeners()).toBe(held);

    controller.destroy();
    await Promise.resolve();
    await Promise.resolve();
    // A leaked handler survives a React remount and double-handles every click:
    // two vertices per click, and nothing in the console to explain it.
    expect(windowListeners()).toBe(0);
    expect(viewer.dataSources.contains(ds)).toBe(false);
  });
});
